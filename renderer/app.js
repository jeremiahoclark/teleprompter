// DOM elements
const videoSourceSelect = document.getElementById('video-source');
const audioSourceSelect = document.getElementById('audio-source');
const cameraPreview = document.getElementById('camera-preview');
const recIndicator = document.getElementById('rec-indicator');
const prompterEdit = document.getElementById('prompter-edit');
const prompterDisplay = document.getElementById('prompter-display');
const prompterText = document.getElementById('prompter-text');
const toggleEditBtn = document.getElementById('toggle-edit-btn');
const speedSlider = document.getElementById('speed-slider');
const recordBtn = document.getElementById('record-btn');
const stopBtn = document.getElementById('stop-btn');
const publishBtn = document.getElementById('publish-btn');
const progressBar = document.getElementById('progress-bar');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const segmentsContainer = document.getElementById('segments-container');
const noSegments = document.getElementById('no-segments');
const previewModal = document.getElementById('preview-modal');
const previewVideo = document.getElementById('preview-video');
const previewClose = document.getElementById('preview-close');
const previewBackdrop = document.getElementById('preview-backdrop');

// State
let currentStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let segments = [];
let isEditing = true;
let scrollAnimationId = null;
let scrollPosition = 0;
let isRecording = false;
let rotation = 0; // 0, 90, 180, 270

// Initialize
async function init() {
  await enumerateDevices();
  await startCamera();

  videoSourceSelect.addEventListener('change', startCamera);
  audioSourceSelect.addEventListener('change', startCamera);
}

// Device enumeration
async function enumerateDevices() {
  // Request permission first to get labeled devices
  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    tempStream.getTracks().forEach((t) => t.stop());
  } catch (e) {
    // Permission denied - we'll work with what we have
  }

  const devices = await navigator.mediaDevices.enumerateDevices();

  videoSourceSelect.innerHTML = '';
  audioSourceSelect.innerHTML = '';

  devices.forEach((device) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.text = device.label || `${device.kind} (${device.deviceId.slice(0, 8)})`;

    if (device.kind === 'videoinput') {
      videoSourceSelect.appendChild(option);
    } else if (device.kind === 'audioinput') {
      audioSourceSelect.appendChild(option);
    }
  });
}

// Camera
async function startCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
  }

  const constraints = {
    video: {
      deviceId: videoSourceSelect.value ? { exact: videoSourceSelect.value } : undefined,
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: {
      deviceId: audioSourceSelect.value ? { exact: audioSourceSelect.value } : undefined,
    },
  };

  try {
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    cameraPreview.srcObject = currentStream;
  } catch (err) {
    console.error('Camera error:', err);
  }
}

// Rotation
const rotateBtn = document.getElementById('rotate-btn');
const cameraPanel = document.getElementById('camera-panel');

function applyRotation() {
  if (rotation === 0) {
    cameraPreview.style.transform = '';
  } else if (rotation === 180) {
    cameraPreview.style.transform = 'rotate(180deg)';
  } else {
    // For 90/270, scale down so the rotated video fits within the panel
    const panelW = cameraPanel.clientWidth;
    const panelH = cameraPanel.clientHeight;
    const scale = Math.min(panelW / panelH, panelH / panelW);
    cameraPreview.style.transform = `rotate(${rotation}deg) scale(${scale})`;
  }
}

rotateBtn.addEventListener('click', () => {
  rotation = (rotation + 90) % 360;
  applyRotation();
});

window.addEventListener('resize', () => {
  if (rotation === 90 || rotation === 270) applyRotation();
});

// Recording
recordBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);

function startRecording() {
  if (!currentStream) return;

  recordedChunks = [];

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : 'video/webm';

  mediaRecorder = new MediaRecorder(currentStream, { mimeType });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    const blob = new Blob(recordedChunks, { type: mimeType });
    await saveSegment(blob);
  };

  mediaRecorder.start(100); // collect data every 100ms
  isRecording = true;

  recordBtn.disabled = true;
  stopBtn.disabled = false;
  recIndicator.classList.remove('hidden');

  startPrompterScroll();
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  isRecording = false;
  recordBtn.disabled = false;
  stopBtn.disabled = true;
  recIndicator.classList.add('hidden');

  stopPrompterScroll();
}

async function saveSegment(blob) {
  const timestamp = Date.now();
  const fileName = `segment-${timestamp}.webm`;
  const buffer = await blob.arrayBuffer();
  const filePath = await window.api.saveRecording(fileName, buffer);

  const segment = {
    id: timestamp,
    fileName,
    filePath,
    blob,
    duration: 0,
    rotation,
  };

  // Get duration from blob
  const url = URL.createObjectURL(blob);
  const tempVideo = document.createElement('video');
  tempVideo.src = url;
  tempVideo.preload = 'metadata';

  await new Promise((resolve) => {
    tempVideo.onloadedmetadata = () => {
      // webm duration can be Infinity initially, seek to get real duration
      if (tempVideo.duration === Infinity) {
        tempVideo.currentTime = Number.MAX_SAFE_INTEGER;
        tempVideo.ontimeupdate = () => {
          tempVideo.ontimeupdate = null;
          segment.duration = tempVideo.duration;
          tempVideo.currentTime = 0;
          resolve();
        };
      } else {
        segment.duration = tempVideo.duration;
        resolve();
      }
    };
    tempVideo.onerror = resolve;
  });

  // Capture thumbnail (rotated if needed)
  segment.thumbnailUrl = await captureThumbnail(url, segment.rotation);

  URL.revokeObjectURL(url);
  segments.push(segment);
  renderSegments();
}

function captureThumbnail(videoUrl, rot) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.src = videoUrl;
    video.muted = true;
    video.currentTime = 0.5;

    video.onseeked = () => {
      const isPortrait = rot === 90 || rot === 270;
      const canvas = document.createElement('canvas');
      canvas.width = isPortrait ? 62 : 160;
      canvas.height = isPortrait ? 110 : 90;
      const ctx = canvas.getContext('2d');

      if (rot) {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((rot * Math.PI) / 180);
        const drawW = isPortrait ? canvas.height : canvas.width;
        const drawH = isPortrait ? canvas.width : canvas.height;
        ctx.drawImage(video, -drawW / 2, -drawH / 2, drawW, drawH);
      } else {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }

      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };

    video.onerror = () => resolve(null);
    video.onloadeddata = () => {
      video.currentTime = 0.5;
    };
  });
}

// Segments UI
function renderSegments() {
  segmentsContainer.innerHTML = '';
  noSegments.classList.toggle('hidden', segments.length > 0);
  publishBtn.disabled = segments.length === 0;

  segments.forEach((seg, index) => {
    const card = document.createElement('div');
    const isPortrait = seg.rotation === 90 || seg.rotation === 270;
    card.className = 'segment-card' + (isPortrait ? ' segment-portrait' : '');
    card.addEventListener('click', () => previewSegment(seg));

    const thumb = document.createElement('div');
    thumb.className = 'segment-thumb';
    if (seg.thumbnailUrl) {
      const img = document.createElement('img');
      img.src = seg.thumbnailUrl;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      thumb.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'segment-info';

    const duration = document.createElement('span');
    duration.className = 'segment-duration';
    duration.textContent = `#${index + 1} - ${formatDuration(seg.duration)}`;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'segment-delete';
    deleteBtn.textContent = '\u00d7';
    deleteBtn.title = 'Delete segment';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSegment(seg);
    });

    const saveBtn = document.createElement('button');
    saveBtn.className = 'segment-save';
    saveBtn.textContent = '\u2913';
    saveBtn.title = 'Save segment as MP4';
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportSingleSegment(seg);
    });

    info.appendChild(duration);
    info.appendChild(saveBtn);
    info.appendChild(deleteBtn);
    card.appendChild(thumb);
    card.appendChild(info);
    segmentsContainer.appendChild(card);
  });
}

function formatDuration(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function exportSingleSegment(segment) {
  const outputPath = await window.api.showSaveDialogWebm();
  if (!outputPath) return;
  try {
    await window.api.exportSegment(segment.filePath, outputPath, segment.rotation);
  } catch (err) {
    console.error('Segment export error:', err);
  }
}

async function deleteSegment(segment) {
  await window.api.deleteFile(segment.filePath);
  segments = segments.filter((s) => s.id !== segment.id);
  renderSegments();
}

function previewSegment(segment) {
  const url = URL.createObjectURL(segment.blob);
  previewVideo.src = url;

  // Apply rotation to preview video
  const rot = segment.rotation;
  if (rot === 90 || rot === 270) {
    previewVideo.style.transform = `rotate(${rot}deg)`;
    previewVideo.style.maxWidth = '70vh';
    previewVideo.style.maxHeight = '80vw';
  } else if (rot === 180) {
    previewVideo.style.transform = 'rotate(180deg)';
    previewVideo.style.maxWidth = '';
    previewVideo.style.maxHeight = '';
  } else {
    previewVideo.style.transform = '';
    previewVideo.style.maxWidth = '';
    previewVideo.style.maxHeight = '';
  }

  previewModal.classList.remove('hidden');

  const cleanup = () => {
    previewModal.classList.add('hidden');
    previewVideo.pause();
    previewVideo.src = '';
    previewVideo.style.transform = '';
    previewVideo.style.maxWidth = '';
    previewVideo.style.maxHeight = '';
    URL.revokeObjectURL(url);
  };

  previewClose.onclick = cleanup;
  previewBackdrop.onclick = cleanup;
}

// Teleprompter
toggleEditBtn.addEventListener('click', togglePrompterMode);
prompterText.addEventListener('click', () => {
  if (!isRecording) togglePrompterMode();
});

function togglePrompterMode() {
  isEditing = !isEditing;

  if (isEditing) {
    prompterEdit.classList.remove('hidden');
    prompterDisplay.classList.add('hidden');
    toggleEditBtn.textContent = 'Preview';
  } else {
    prompterText.textContent = prompterEdit.value || '(No script entered)';
    prompterEdit.classList.add('hidden');
    prompterDisplay.classList.remove('hidden');
    prompterDisplay.scrollTop = 0;
    toggleEditBtn.textContent = 'Edit';
  }
}

// Sync scrollPosition when user manually scrolls
prompterDisplay.addEventListener('scroll', () => {
  if (!scrollAnimationId) {
    scrollPosition = prompterDisplay.scrollTop;
  }
});

function startPrompterScroll() {
  // Switch to display mode if in edit mode
  if (isEditing && prompterEdit.value.trim()) {
    togglePrompterMode();
  }

  if (prompterDisplay.classList.contains('hidden')) return;

  scrollPosition = prompterDisplay.scrollTop;

  const scroll = () => {
    const speed = parseInt(speedSlider.value, 10);
    scrollPosition += speed * 0.15;
    prompterDisplay.scrollTop = Math.round(scrollPosition);
    scrollAnimationId = requestAnimationFrame(scroll);
  };

  scrollAnimationId = requestAnimationFrame(scroll);
}

function stopPrompterScroll() {
  if (scrollAnimationId) {
    cancelAnimationFrame(scrollAnimationId);
    scrollAnimationId = null;
  }
}

// Publish
publishBtn.addEventListener('click', publishVideo);

async function publishVideo() {
  if (segments.length === 0) return;

  const outputPath = await window.api.showSaveDialog();
  if (!outputPath) return;

  publishBtn.disabled = true;
  progressBar.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = '0%';

  window.api.onExportProgress((percent) => {
    progressFill.style.width = `${percent}%`;
    progressText.textContent = `${percent}%`;
  });

  try {
    const videoSegments = segments.map((s) => ({ filePath: s.filePath, rotation: s.rotation }));
    await window.api.combineVideos(videoSegments, outputPath);
    progressFill.style.width = '100%';
    progressText.textContent = 'Done!';
    setTimeout(() => {
      progressBar.classList.add('hidden');
      publishBtn.disabled = false;
    }, 2000);
  } catch (err) {
    console.error('Export error:', err);
    progressText.textContent = 'Error!';
    progressFill.style.width = '100%';
    progressFill.style.background = '#e63946';
    setTimeout(() => {
      progressBar.classList.add('hidden');
      progressFill.style.background = '';
      publishBtn.disabled = false;
    }, 3000);
  }
}

// Start
init();
