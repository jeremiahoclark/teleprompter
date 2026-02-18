# Teleprompter

A desktop app for recording video with a teleprompter overlay. Record multiple takes, delete the bad ones, and publish the remaining segments as a single combined video.

Built for content creators who need a simple, distraction-free recording setup — especially for vertical video (TikTok, Reels, Shorts).

![Electron](https://img.shields.io/badge/Electron-40-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Teleprompter** — paste your script, set the scroll speed, and read naturally while recording. The teleprompter sits at the top of the screen so your eyes stay near the camera lens.
- **Camera & mic selection** — choose from available video and audio input devices.
- **Vertical video support** — rotate button for webcams that can shoot in portrait orientation. Rotation is baked into the final export.
- **Multi-segment workflow** — record as many takes as you need. Delete bad ones, keep the good ones.
- **Per-segment export** — save individual segments as MP4 without restarting.
- **Publish** — combine all remaining segments into a single MP4 with one click. Uses ffmpeg under the hood for reliable encoding.
- **Dark theme** — easy on the eyes during recording sessions.

## Screenshot

```
┌──────────────────────────────────────────┐
│  Camera: [▾]  Mic: [▾]  [Rotate]         │
├─────────────────────────────┬────────────┤
│                             │            │
│       TELEPROMPTER          │   CAMERA   │
│       (scrolling text)      │  PREVIEW   │
│                             │            │
│     [Preview]  Speed: ████░ │            │
├─────────────────────────────┴────────────┤
│  [● Record] [■ Stop]        [📤 Publish]  │
├──────────────────────────────────────────┤
│  Seg 1 │ Seg 2 │ Seg 3 │ ...             │
└──────────────────────────────────────────┘
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Bun](https://bun.sh/) (or npm/yarn)

### Install

```bash
git clone https://github.com/jeremiahoclark/teleprompter.git
cd teleprompter
bun install
```

### Run

```bash
bun run start
```

## How It Works

1. **Paste your script** into the teleprompter panel and click "Preview"
2. **Select your camera and mic** from the dropdowns. Hit "Rotate" if shooting vertical.
3. **Press Record** — the teleprompter starts scrolling automatically. A red REC indicator appears on the camera preview.
4. **Press Stop** when done. The segment appears in the bottom strip.
5. **Repeat** as many times as you need. Delete bad takes by clicking the × button.
6. **Press Publish** to combine all segments into a single MP4. You'll be prompted to choose a save location.

## Tech Stack

- **Electron** — cross-platform desktop app
- **MediaRecorder API** — browser-native video recording (WebM)
- **ffmpeg-static** + **fluent-ffmpeg** — video rotation, conversion, and concatenation to MP4
- **Vanilla HTML/CSS/JS** — no framework, minimal dependencies

## Project Structure

```
teleprompter/
├── main.js          # Electron main process + IPC handlers
├── preload.js       # Context bridge (renderer ↔ main)
├── renderer/
│   ├── index.html   # App UI
│   ├── styles.css   # Dark theme styling
│   └── app.js       # Camera, recording, teleprompter, segments
├── recordings/      # Auto-created; stores segment files
└── package.json
```

## License

MIT
