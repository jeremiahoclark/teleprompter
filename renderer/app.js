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
const toastContainer = document.getElementById('toast-container');
const wpmDisplay = document.getElementById('wpm-display');
const speedDownBtn = document.getElementById('speed-down');
const speedUpBtn = document.getElementById('speed-up');
const recordTimer = document.getElementById('record-timer');
const redDot = document.querySelector('.red-dot');
const eyelineIndicator = document.getElementById('eyeline-indicator');
const deviceBar = document.getElementById('device-bar');
const denoiseToggle = document.getElementById('denoise-toggle');
const denoiseStatus = document.getElementById('denoise-status');

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
let dragSrcIndex = null;
let sentenceSpans = [];

// Toast notifications
function showToast(message, type = 'error') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  // Trigger reflow for animation
  toast.offsetHeight;
  toast.classList.add('toast-visible');
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function updateWpmDisplay() {
  wpmDisplay.textContent = speedSlider.value;
}

speedSlider.addEventListener('input', updateWpmDisplay);
speedDownBtn.addEventListener('click', () => {
  speedSlider.value = Math.max(parseInt(speedSlider.min), parseInt(speedSlider.value) - parseInt(speedSlider.step));
  updateWpmDisplay();
});
speedUpBtn.addEventListener('click', () => {
  speedSlider.value = Math.min(parseInt(speedSlider.max), parseInt(speedSlider.value) + parseInt(speedSlider.step));
  updateWpmDisplay();
});

function formatTimer(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

let recordingTimerId = null;
let recordingStartTime = 0;

// Initialize
async function init() {
  await enumerateDevices();
  await startCamera();

  videoSourceSelect.addEventListener('change', () => {
    if (isRecording) return; // Block device changes during recording
    startCamera();
  });
  audioSourceSelect.addEventListener('change', () => {
    if (isRecording) return; // Block device changes during recording
    startCamera();
  });

  setupKeyboardShortcuts();

  // Check SAM-Audio availability
  const samStatus = await window.api.checkSamAudio();
  if (samStatus.available) {
    denoiseToggle.disabled = false;
    denoiseStatus.textContent = '';
  } else {
    denoiseToggle.disabled = true;
    denoiseToggle.checked = false;
    denoiseStatus.textContent = 'Not set up';
    denoiseStatus.title = samStatus.reason;
  }
}

// Keyboard shortcuts
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Don't capture shortcuts when typing in the prompter textarea
    if (e.target === prompterEdit) return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (isRecording) {
          stopRecording();
        } else {
          startRecording();
        }
        break;
      case 'KeyE':
        if (!isRecording) togglePrompterMode();
        break;
      case 'KeyR':
        if (!isRecording) {
          rotation = (rotation + 90) % 360;
          applyRotation();
        }
        break;
      case 'Escape':
        if (!previewModal.classList.contains('hidden')) {
          closePreview();
        }
        break;
    }
  });
}

// Device enumeration
async function enumerateDevices() {
  // Request permission first to get labeled devices
  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    tempStream.getTracks().forEach((t) => t.stop());
  } catch (e) {
    showToast('Camera/microphone access denied. Please grant permission and restart.', 'error');
    return;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();

  videoSourceSelect.innerHTML = '';
  audioSourceSelect.innerHTML = '';

  let hasVideo = false;
  let hasAudio = false;

  devices.forEach((device) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.text = device.label || `${device.kind} (${device.deviceId.slice(0, 8)})`;

    if (device.kind === 'videoinput') {
      videoSourceSelect.appendChild(option);
      hasVideo = true;
    } else if (device.kind === 'audioinput') {
      audioSourceSelect.appendChild(option);
      hasAudio = true;
    }
  });

  if (!hasVideo) showToast('No camera found.', 'error');
  if (!hasAudio) showToast('No microphone found.', 'error');
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
    showToast('Failed to start camera. Check device permissions.', 'error');
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

// Debounced resize handler
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (rotation === 90 || rotation === 270) {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyRotation, 150);
  }
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

  // Disable device selects during recording
  videoSourceSelect.disabled = true;
  audioSourceSelect.disabled = true;
  deviceBar.classList.add('hidden');

  recordingStartTime = Date.now();
  recordTimer.textContent = '00:00:00';
  recordingTimerId = setInterval(() => {
    recordTimer.textContent = formatTimer(Date.now() - recordingStartTime);
  }, 1000);
  redDot.classList.add('recording');

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

  // Re-enable device selects
  videoSourceSelect.disabled = false;
  audioSourceSelect.disabled = false;
  deviceBar.classList.remove('hidden');

  if (recordingTimerId) {
    clearInterval(recordingTimerId);
    recordingTimerId = null;
  }
  redDot.classList.remove('recording');
  recordTimer.textContent = '00:00:00';

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
  try {
    const tempVideo = document.createElement('video');
    tempVideo.src = url;
    tempVideo.preload = 'metadata';

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Fallback if metadata never loads
        resolve();
      }, 5000);

      tempVideo.onloadedmetadata = () => {
        // webm duration can be Infinity initially, seek to get real duration
        if (tempVideo.duration === Infinity) {
          tempVideo.currentTime = Number.MAX_SAFE_INTEGER;
          tempVideo.ontimeupdate = () => {
            tempVideo.ontimeupdate = null;
            segment.duration = tempVideo.duration;
            tempVideo.currentTime = 0;
            clearTimeout(timeout);
            resolve();
          };
        } else {
          segment.duration = tempVideo.duration;
          clearTimeout(timeout);
          resolve();
        }
      };
      tempVideo.onerror = () => {
        clearTimeout(timeout);
        resolve();
      };
    });

    // Capture thumbnail (rotated if needed)
    segment.thumbnailUrl = await captureThumbnail(url, segment.rotation);
  } finally {
    URL.revokeObjectURL(url);
  }

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

    // Drag-to-reorder
    card.draggable = true;
    card.dataset.index = index;
    card.addEventListener('dragstart', (e) => {
      dragSrcIndex = index;
      card.classList.add('segment-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('segment-dragging');
      dragSrcIndex = null;
      // Remove all drag-over indicators
      document.querySelectorAll('.segment-drag-over').forEach((el) =>
        el.classList.remove('segment-drag-over')
      );
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('segment-drag-over');
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('segment-drag-over');
    });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('segment-drag-over');
      if (dragSrcIndex === null || dragSrcIndex === index) return;
      // Move segment from dragSrcIndex to index
      const [moved] = segments.splice(dragSrcIndex, 1);
      segments.splice(index, 0, moved);
      renderSegments();
    });

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

    const actions = document.createElement('div');
    actions.className = 'segment-actions';
    actions.appendChild(saveBtn);
    actions.appendChild(deleteBtn);

    info.appendChild(duration);
    info.appendChild(actions);
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
  try {
    const outputPath = await window.api.showSaveDialogWebm();
    if (!outputPath) return;
    await window.api.exportSegment(segment.filePath, outputPath, segment.rotation);
    showToast('Segment exported successfully.', 'success');
  } catch (err) {
    console.error('Segment export error:', err);
    showToast('Failed to export segment.', 'error');
  }
}

async function deleteSegment(segment) {
  try {
    await window.api.deleteFile(segment.filePath);
  } catch (err) {
    console.error('Delete error:', err);
    showToast('Failed to delete segment file.', 'error');
  }
  segments = segments.filter((s) => s.id !== segment.id);
  renderSegments();
}

let closePreview = null;

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

  closePreview = () => {
    previewModal.classList.add('hidden');
    previewVideo.pause();
    previewVideo.src = '';
    previewVideo.style.transform = '';
    previewVideo.style.maxWidth = '';
    previewVideo.style.maxHeight = '';
    URL.revokeObjectURL(url);
    closePreview = null;
  };

  previewClose.onclick = closePreview;
  previewBackdrop.onclick = closePreview;
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
    eyelineIndicator.classList.add('hidden');
    toggleEditBtn.textContent = 'Preview Script';
  } else {
    sentenceSpans = [];
    prompterText.innerHTML = '';
    const text = prompterEdit.value || '(No script entered)';
    
    // Split by newlines to preserve paragraph structure
    const lines = text.split('\n');
    lines.forEach(line => {
      const p = document.createElement('div');
      p.className = 'prompter-line';
      p.style.minHeight = '1em'; // keep empty lines
      
      if (line.trim().length > 0) {
        // Split by sentences using a simple regex (punctuation or end of string)
        const blocks = line.match(/[^.!?]+[.!?]*/g) || [line];
        
        blocks.forEach(block => {
          if (block.trim().length > 0) {
            const span = document.createElement('span');
            span.textContent = block;
            span.className = 'prompter-sentence';
            span.addEventListener('click', (e) => {
              e.stopPropagation();
              // Scroll to this span so it sits right under the eyeline
              // Eyeline is at top: 160px. Prompter padding top is 100px.
              // So we offset by 60px to place the top of the span exactly on the line.
              scrollPosition = span.offsetTop - 60;
              prompterDisplay.scrollTop = Math.max(0, scrollPosition);
              
              if (isRecording) {
                stopRecording();
                setTimeout(() => startRecording(), 300);
              } else {
                startRecording();
              }
            });
            p.appendChild(span);
            sentenceSpans.push(span);
          } else {
            p.appendChild(document.createTextNode(block));
          }
        });
      } else {
        p.textContent = line;
      }
      prompterText.appendChild(p);
    });

    prompterEdit.classList.add('hidden');
    prompterDisplay.classList.remove('hidden');
    eyelineIndicator.classList.remove('hidden');
    prompterDisplay.scrollTop = 0;
    toggleEditBtn.textContent = 'Edit Script';
    
    // Initial highlight check
    setTimeout(updateActiveSentence, 50);
  }
}

function updateActiveSentence() {
  if (!sentenceSpans.length || isEditing) return;

  const targetY = prompterDisplay.scrollTop + 160;
  let closestSpan = null;
  let minDistance = Infinity;

  for (const span of sentenceSpans) {
    const centerY = span.offsetTop + 100 + (span.offsetHeight / 2);
    const distance = Math.abs(centerY - targetY);
    
    if (distance < minDistance) {
      minDistance = distance;
      closestSpan = span;
    }
  }

  if (closestSpan && !closestSpan.classList.contains('active-sentence')) {
    sentenceSpans.forEach(s => s.classList.remove('active-sentence'));
    closestSpan.classList.add('active-sentence');
  }
}

// Manual scroll during auto-scroll: pause briefly, then resume from new position
let userScrolling = false;
let userScrollTimer = null;

prompterDisplay.addEventListener('wheel', () => {
  if (!scrollAnimationId) return;
  userScrolling = true;
  clearTimeout(userScrollTimer);
  userScrollTimer = setTimeout(() => {
    scrollPosition = prompterDisplay.scrollTop;
    userScrolling = false;
  }, 400);
}, { passive: true });

prompterDisplay.addEventListener('touchmove', () => {
  if (!scrollAnimationId) return;
  userScrolling = true;
  clearTimeout(userScrollTimer);
  userScrollTimer = setTimeout(() => {
    scrollPosition = prompterDisplay.scrollTop;
    userScrolling = false;
  }, 400);
}, { passive: true });

// Sync scrollPosition when not auto-scrolling
prompterDisplay.addEventListener('scroll', () => {
  if (!scrollAnimationId) {
    scrollPosition = prompterDisplay.scrollTop;
  }
  updateActiveSentence();
});

// Measure actual pixels-per-word from rendered content
function getPixelsPerWord() {
  const text = prompterText.textContent || '';
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount === 0) return 1;
  // Total scrollable distance = content height minus one viewport (we stop at the bottom)
  const scrollableHeight = prompterText.scrollHeight;
  return scrollableHeight / wordCount;
}

function startPrompterScroll() {
  // Switch to display mode if in edit mode
  if (isEditing && prompterEdit.value.trim()) {
    togglePrompterMode();
  }

  if (prompterDisplay.classList.contains('hidden')) return;

  const pixelsPerWord = getPixelsPerWord();
  scrollPosition = prompterDisplay.scrollTop;
  let lastTime = performance.now();

  const scroll = (timestamp) => {
    const dt = timestamp - lastTime;
    lastTime = timestamp;

    // WPM → pixels/second using actual measured layout
    const wpm = parseInt(speedSlider.value, 10);
    const pixelsPerSecond = (wpm * pixelsPerWord) / 60;

    if (dt < 100 && !userScrolling) {
      scrollPosition += pixelsPerSecond * (dt / 1000);
      prompterDisplay.scrollTop = Math.round(scrollPosition);
    }
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
  progressFill.style.background = '';
  progressText.textContent = '0%';

  window.api.onExportProgress((percent) => {
    progressFill.style.width = `${percent}%`;
    progressText.textContent = `${percent}%`;
  });

  window.api.onExportProgressStatus((status) => {
    progressText.textContent = status;
  });

  const shouldDenoise = denoiseToggle.checked && !denoiseToggle.disabled;

  try {
    const videoSegments = segments.map((s) => ({ filePath: s.filePath, rotation: s.rotation }));
    await window.api.combineVideos(videoSegments, outputPath, shouldDenoise);
    progressFill.style.width = '100%';
    progressText.textContent = 'Done!';
    showToast('Video exported successfully!', 'success');
    setTimeout(() => {
      progressBar.classList.add('hidden');
      publishBtn.disabled = false;
    }, 2000);
  } catch (err) {
    console.error('Export error:', err);
    progressText.textContent = 'Error!';
    progressFill.style.width = '100%';
    progressFill.style.background = '#e63946';
    showToast('Export failed. Check that all segments are valid.', 'error');
    setTimeout(() => {
      progressBar.classList.add('hidden');
      progressFill.style.background = '';
      publishBtn.disabled = false;
    }, 3000);
  }
}

// Start
init();
