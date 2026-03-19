const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

const recordingsDir = path.join(__dirname, 'recordings');
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir);
}

// SAM-Audio denoise script
const denoiseScript = path.join(__dirname, 'scripts', 'denoise.sh');

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
  // Clean up temp files before quitting
  cleanupTempFiles();
  app.quit();
});

function cleanupTempFiles() {
  try {
    const files = fs.readdirSync(recordingsDir);
    for (const file of files) {
      if (file.startsWith('rotated-') || file.startsWith('audio-') || file.startsWith('clean-') || file.startsWith('residual-') || file.startsWith('denoised-') || file === 'concat-list.txt') {
        const filePath = path.join(recordingsDir, file);
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
    }
  } catch (e) {
    // recordings dir may not exist
  }
}

// IPC Handlers

ipcMain.handle('get-recordings-dir', () => {
  return recordingsDir;
});

ipcMain.handle('save-recording', async (event, { fileName, buffer }) => {
  const filePath = path.join(recordingsDir, fileName);
  await fs.promises.writeFile(filePath, Buffer.from(buffer));
  return filePath;
});

ipcMain.handle('delete-file', async (event, filePath) => {
  try {
    await fs.promises.access(filePath);
    await fs.promises.unlink(filePath);
  } catch (e) {
    // file doesn't exist or can't be deleted
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

// SAM-Audio noise removal

ipcMain.handle('check-sam-audio', async () => {
  try {
    await fs.promises.access(denoiseScript, fs.constants.X_OK);
    return { available: true };
  } catch (e) {
    return { available: false, reason: 'Denoise script not found at scripts/denoise.sh' };
  }
});

function extractAudio(videoPath, audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .noVideo()
      .outputOptions(['-c:a', 'pcm_s16le', '-ar', '16000', '-ac', '1'])
      .output(audioPath)
      .on('end', () => resolve(audioPath))
      .on('error', (err) => reject(err.message))
      .run();
  });
}

function runSamAudio(inputAudio, targetOut, residualOut) {
  return new Promise((resolve, reject) => {
    execFile(
      denoiseScript,
      [
        '--input', inputAudio,
        '--description', 'the person speaking',
        '--out-target', targetOut,
        '--out-residual', residualOut,
        '--device', 'auto',
      ],
      { timeout: 300000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(`SAM-Audio failed: ${stderr || error.message}`);
        } else {
          resolve(targetOut);
        }
      }
    );
  });
}

function remixAudio(videoPath, cleanAudioPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(cleanAudioPath)
      .outputOptions([
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-movflags', '+faststart',
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err.message))
      .run();
  });
}

async function denoiseSegment(segmentPath, index, tempFiles) {
  const ts = Date.now();
  const extractedAudio = path.join(recordingsDir, `audio-${index}-${ts}.wav`);
  const cleanAudio = path.join(recordingsDir, `clean-${index}-${ts}.wav`);
  const residualAudio = path.join(recordingsDir, `residual-${index}-${ts}.wav`);
  const denoisedVideo = path.join(recordingsDir, `denoised-${index}-${ts}.mp4`);

  tempFiles.push(extractedAudio, cleanAudio, residualAudio, denoisedVideo);

  // Extract audio from segment
  await extractAudio(segmentPath, extractedAudio);

  // Run SAM-Audio to isolate voice
  await runSamAudio(extractedAudio, cleanAudio, residualAudio);

  // Remix clean audio back onto video
  await remixAudio(segmentPath, cleanAudio, denoisedVideo);

  return denoisedVideo;
}

ipcMain.handle('combine-videos', async (event, { videoSegments, outputPath, denoise }) => {
  const tempFiles = [];

  const cleanup = async () => {
    for (const f of tempFiles) {
      try { await fs.promises.unlink(f); } catch (e) { /* ignore */ }
    }
  };

  try {
    // Phase 1: Denoise audio if enabled (0-30%)
    let segmentPaths = videoSegments.map((s) => s.filePath);
    if (denoise) {
      for (let i = 0; i < videoSegments.length; i++) {
        mainWindow.webContents.send(
          'export-progress-status',
          `Cleaning audio ${i + 1}/${videoSegments.length}...`
        );
        mainWindow.webContents.send(
          'export-progress',
          Math.round((i / videoSegments.length) * 30)
        );
        try {
          const denoised = await denoiseSegment(segmentPaths[i], i, tempFiles);
          segmentPaths[i] = denoised;
        } catch (err) {
          // If denoise fails for a segment, fall back to original audio
          mainWindow.webContents.send(
            'export-progress-status',
            `Audio cleaning failed for segment ${i + 1}, using original`
          );
        }
      }
    }

    // Phase 2: Rotate any segments that need it (30-50%)
    mainWindow.webContents.send('export-progress-status', 'Processing video...');
    const processedPaths = [];
    for (let i = 0; i < videoSegments.length; i++) {
      const seg = { ...videoSegments[i], filePath: segmentPaths[i] };
      mainWindow.webContents.send(
        'export-progress',
        30 + Math.round((i / (videoSegments.length + 1)) * 20)
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
              mainWindow.webContents.send('export-progress', 50 + Math.round(progress.percent * 0.5));
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
      await fs.promises.writeFile(listPath, listContent);

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(listPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart'])
          .output(outputPath)
          .on('progress', (progress) => {
            if (progress.percent) {
              mainWindow.webContents.send('export-progress', 50 + Math.round(progress.percent * 0.5));
            }
          })
          .on('end', resolve)
          .on('error', (err) => reject(err.message))
          .run();
      });
    }

    // Clean up temp files
    await cleanup();
    return outputPath;
  } catch (err) {
    await cleanup();
    throw err;
  }
});
