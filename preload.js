const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getRecordingsDir: () => ipcRenderer.invoke('get-recordings-dir'),
  saveRecording: (fileName, buffer) =>
    ipcRenderer.invoke('save-recording', { fileName, buffer }),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  showSaveDialog: () => ipcRenderer.invoke('show-save-dialog'),
  showSaveDialogWebm: () => ipcRenderer.invoke('show-save-dialog-webm'),
  exportSegment: (filePath, outputPath, rotation) =>
    ipcRenderer.invoke('export-segment', { filePath, outputPath, rotation }),
  combineVideos: (videoSegments, outputPath, denoise) =>
    ipcRenderer.invoke('combine-videos', { videoSegments, outputPath, denoise }),
  checkSamAudio: () => ipcRenderer.invoke('check-sam-audio'),
  onExportProgress: (callback) => {
    // Remove all previous listeners to prevent accumulation
    ipcRenderer.removeAllListeners('export-progress');
    ipcRenderer.on('export-progress', (event, percent) => callback(percent));
  },
  onExportProgressStatus: (callback) => {
    ipcRenderer.removeAllListeners('export-progress-status');
    ipcRenderer.on('export-progress-status', (event, status) => callback(status));
  },
});
