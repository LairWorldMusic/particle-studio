# Particle Studio

Transform your webcam into stunning visual effects with real-time particle processing.

## Features

- **Particle Effects** — Real-time edge detection with particle trails
- **Surveillance Mode** — Motion tracking with object detection overlay
- **Audio Reactive** — Visual effects that respond to system audio
- **Bloom Effect** — Cinematic glow post-processing
- **Theme Support** — Dark and light themes
- **Virtual Camera** — Use effects in Zoom, Discord, OBS via window capture

## Quick Start

### Development

```bash
cd app
npm install
npm run electron:dev
```

### Production Build

```bash
cd app
npm run dist
```

This creates an installer in `app/dist/` folder.

## Controls

| Key | Action |
|-----|--------|
| `Z` | Hide/show UI controls |
| `ESC` | Exit application |

## Control Panel

- ✨ **Particles** — Toggle particle effect
- 📹 **Tracking** — Toggle surveillance/motion tracking
- 🎵 **Audio** — Toggle audio-reactive visualizer
- 💡 **Bloom** — Toggle glow effect
- 📷 **Camera** — Toggle camera on/off
- 🌙 **Theme** — Switch dark/light theme
- ⚙️ **Settings** — Open settings panel

## Using as Virtual Camera

1. Install [OBS Studio](https://obsproject.com)
2. Add Window Capture source → Select "Particle Studio"
3. Click "Start Virtual Camera" in OBS
4. Select "OBS Virtual Camera" in Zoom/Discord/etc.

## Project Structure

```
├── app/
│   ├── electron/       # Electron main process
│   │   ├── main.js     # Main process entry
│   │   ├── preload.js  # Preload script
│   │   └── icon.ico    # App icon
│   ├── main.js         # Renderer process (Three.js)
│   ├── index.html      # Main HTML
│   └── package.json    # Dependencies & build config
├── website/            # Landing page
└── README.md
```

## Tech Stack

- **Electron** — Desktop app framework
- **Three.js** — 3D graphics & particle system
- **Vite** — Build tool
- **electron-builder** — Installer creation
~
## Requirements

- Node.js 18+
- Windows 10/11 (for .exe build)

## License

MIT
