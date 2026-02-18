const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

const recordingsDir = path.join(__dirname, 'recordings');
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir);
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Teleprompter',
    backgroundColor: '#1a1a2e',
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

// IPC Handlers

ipcMain.handle('get-recordings-dir', () => {
  return recordingsDir;
});

ipcMain.handle('save-recording', async (event, { fileName, buffer }) => {
  const filePath = path.join(recordingsDir, fileName);
  fs.writeFileSync(filePath, Buffer.from(buffer));
  return filePath;
});

ipcMain.handle('delete-file', async (event, filePath) => {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
});

ipcMain.handle('show-save-dialog', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Combined Video',
    defaultPath: `teleprompter-${Date.now()}.mp4`,
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('show-save-dialog-webm', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Segment',
    defaultPath: `segment-${Date.now()}.mp4`,
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('export-segment', async (event, { filePath, outputPath, rotation }) => {
  const filter = getRotateFilter(rotation);
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg().input(filePath);
    if (filter) cmd = cmd.videoFilters(filter);
    cmd
      .outputOptions(['-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart'])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err.message))
      .run();
  });
});

// Map rotation degrees to ffmpeg transpose values
// transpose=1 is 90° clockwise, transpose=2 is 90° counter-clockwise,
// hflip+vflip is 180°
function getRotateFilter(rotation) {
  switch (rotation) {
    case 90: return 'transpose=1';
    case 180: return 'transpose=1,transpose=1';
    case 270: return 'transpose=2';
    default: return null;
  }
}

function preprocessSegment(segment, index) {
  const filter = getRotateFilter(segment.rotation);
  if (!filter) return Promise.resolve(segment.filePath);

  const outPath = path.join(recordingsDir, `rotated-${index}-${Date.now()}.mp4`);
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(segment.filePath)
      .videoFilters(filter)
      .outputOptions(['-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart'])
      .output(outPath)
      .on('end', () => resolve(outPath))
      .on('error', (err) => reject(err.message))
      .run();
  });
}

ipcMain.handle('combine-videos', async (event, { videoSegments, outputPath }) => {
  const tempFiles = [];

  try {
    // Pre-process: rotate any segments that need it
    const processedPaths = [];
    for (let i = 0; i < videoSegments.length; i++) {
      const seg = videoSegments[i];
      mainWindow.webContents.send(
        'export-progress',
        Math.round(((i) / (videoSegments.length + 1)) * 30)
      );
      const processed = await preprocessSegment(seg, i);
      processedPaths.push(processed);
      if (processed !== seg.filePath) tempFiles.push(processed);
    }

    // If only one segment and no concat needed
    if (processedPaths.length === 1) {
      // Still re-encode to mp4 for consistency
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(processedPaths[0])
          .outputOptions(['-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart'])
          .output(outputPath)
          .on('progress', (progress) => {
            if (progress.percent) {
              mainWindow.webContents.send('export-progress', 30 + Math.round(progress.percent * 0.7));
            }
          })
          .on('end', resolve)
          .on('error', (err) => reject(err.message))
          .run();
      });
    } else {
      // Write concat list file
      const listPath = path.join(recordingsDir, 'concat-list.txt');
      tempFiles.push(listPath);
      const listContent = processedPaths
        .map((fp) => `file '${fp.replace(/'/g, "'\\''")}'`)
        .join('\n');
      fs.writeFileSync(listPath, listContent);

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(listPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart'])
          .output(outputPath)
          .on('progress', (progress) => {
            if (progress.percent) {
              mainWindow.webContents.send('export-progress', 30 + Math.round(progress.percent * 0.7));
            }
          })
          .on('end', resolve)
          .on('error', (err) => reject(err.message))
          .run();
      });
    }

    // Clean up temp files
    tempFiles.forEach((f) => { if (fs.existsSync(f)) fs.unlinkSync(f); });
    return outputPath;
  } catch (err) {
    tempFiles.forEach((f) => { if (fs.existsSync(f)) fs.unlinkSync(f); });
    throw err;
  }
});
