<div align="center">

# 🎬 wxhb — AI One-Click Video Maker

**AI-Powered Short Video Production Tool**

English | [中文](./README.md)

A pipeline-based one-click video generation tool integrating Agnes AI's text, image, and video models. From a single topic description, it automatically generates storyboard scripts, reference images, video clips, and concatenates them into a final video.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4-06B6D4?logo=tailwindcss)
![FFmpeg.wasm](https://img.shields.io/badge/FFmpeg.wasm-0.12-007808)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎬 **One-Click Pipeline** | Enter a topic → auto-generate storyboard → reference images → video clips → final MP4 |
| 🤖 **Script Generation** | `agnes-2.0-flash` — splits topic into 4-6 structured shots (copy + visual prompt + duration) |
| 🎨 **Image Generation** | `agnes-image-2.1-flash` — generates reference images per shot (concurrency: 3) |
| 🎥 **Video Generation** | `agnes-video-v2.0` — async task creation + polling, image-to-video support (concurrency: 2, 10min timeout) |
| ✂️ **Video Concatenation** | FFmpeg.wasm client-side concat demuxer for final MP4 output |
| 📋 **Multi-Project** | Create / switch / delete / duplicate projects, localStorage persistence |
| 📊 **History Log** | Last 200 operation records, grouped by date |
| 🔄 **Single Shot Retry** | Retry individual failed shots without re-running the entire pipeline |
| 📐 **Aspect Ratios** | 16:9 (landscape), 9:16 (portrait), 1:1 (square) |
| 🌐 **i18n** | Built-in lightweight i18n — switch between Chinese and English instantly |
| 🔧 **Swappable Models** | Centralized model identifiers — swap models by editing the `MODELS` constant |

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18
- npm >= 9

### Install & Run

```bash
# Clone the repo
git clone https://github.com/your-username/wxhb.git
cd wxhb

# Install dependencies
npm install

# Start dev server (default: http://127.0.0.1:5173)
npm run dev

# Build for production
npm run build

# Preview production build (port 5180)
npm run preview
```

### Configure API Key

1. Launch the app and click **Settings**
2. Enter your **API Key** (Agnes AI or any OpenAI-compatible key)
3. Verify the **API Base URL** (default: `https://apihub.agnes-ai.com/v1`)
4. Save settings

> 💡 API keys are stored in browser localStorage and only sent to the configured endpoint when making API calls.

## 📖 Usage Guide

### Workflow

1. **Create Project** — Click "New Project" in the left panel, select aspect ratio
2. **Enter Topic** — Describe your short video topic in the script panel
3. **Generate Storyboard** — Click generate, AI splits it into 4-6 shots automatically
4. **Run Pipeline** — Click run, Pipeline completes: image generation → video generation → concatenation
5. **Preview & Download** — Watch the final video in the final preview section and download

### UI Layout

```
┌────────────┬────────────────────────┬──────────────────┐
│ Left Panel │    Center Preview      │  Right Editor    │
│            │                        │                  │
│ · Projects │  · Single shot preview │  · Shot copy     │
│ · Shots    │  · Image/Video toggle  │  · Visual prompt │
│ · History  │  · Final video + DL    │  · Duration      │
│            │                        │  · Retry button  │
└────────────┴────────────────────────┴──────────────────┘
```

### Pipeline Phases

| Phase | Description | Concurrency |
|-------|-------------|-------------|
| 📝 Script | Call text model to generate 4-6 structured shots | 1 |
| 🖼️ Image | Generate reference image per shot | 3 |
| 🎥 Video | Generate video per shot (async create + 5s polling) | 2 |
| ✂️ Render | FFmpeg.wasm concat demuxer → final MP4 | 1 |

## 🏗️ Project Structure

```
src/
├── i18n/                          # Lightweight i18n (zero dependencies)
│   └── index.ts                   # zh/en translation dict + useT hook
├── pages/
│   └── ProjectWorkspace.tsx       # Main page (3-column: shots | preview | editor)
├── features/
│   ├── script/
│   │   └── ScriptPanel.tsx        # Topic input + generate storyboard button
│   ├── shots/
│   │   ├── ShotList.tsx           # Left shot list (status badges + thumbnails)
│   │   └── ShotEditor.tsx         # Right shot editor (copy / prompt / duration)
│   ├── preview/
│   │   ├── ShotPreview.tsx        # Single shot preview (image + video)
│   │   └── FinalPreview.tsx       # Final preview (FFmpeg concat + download)
│   ├── projects/
│   │   └── ProjectSidebar.tsx     # Project management panel
│   └── history/
│       └── HistoryPanel.tsx       # Operation history panel
├── services/                      # Pipeline service layer
│   ├── pipelineService.ts         # Orchestrator (script → image → video, concurrency control)
│   ├── scriptService.ts           # Text model call, structured storyboard generation
│   ├── imageService.ts            # Image generation (single)
│   ├── videoService.ts            # Video generation (async create + polling)
│   └── renderService.ts           # FFmpeg.wasm video concatenation
├── stores/                        # Zustand stores
│   ├── projectStore.ts            # Multi-project management (localStorage, v1→v2 migration)
│   └── settingsStore.ts           # Global settings (apiKey/baseUrl/language, localStorage)
├── providers/                     # AI model abstraction layer
│   ├── types.ts                   # ModelProvider interface
│   └── agnes/
│       └── AgnesAdapter.ts        # Agnes AI adapter (text/image/video)
├── lib/
│   ├── models.ts                  # AI model identifier constants
│   ├── resolveBaseUrl.ts          # API URL resolver
│   └── validation.ts              # Validation utilities (frame calc, prompt sanitize)
├── components/
│   ├── SettingsDialog.tsx         # Settings dialog (API Key / language)
│   ├── ApiKeyBanner.tsx           # API key missing banner
│   └── ui/                        # Shared UI components
│       ├── ConfirmDialog.tsx      # Confirmation dialog
│       ├── ContextMenu.tsx        # Context menu
│       ├── HelpTooltip.tsx        # Help tooltip
│       ├── Lightbox.tsx           # Image lightbox
│       ├── NumberInput.tsx        # Number input
│       └── IMEAwareTextarea.tsx   # IME-aware textarea
├── styles/
│   └── globals.css                # Global styles
├── App.tsx                        # Root component
└── main.tsx                       # Entry point
```

## 🔧 Swapping Models

Model identifiers are centralized in `src/lib/models.ts`:

```typescript
export const MODELS = {
  text: "agnes-2.0-flash",
  image: "agnes-image-2.1-flash",
  video: "agnes-video-v2.0",
} as const;
```

To swap models, simply edit this constant. All services (scriptService / imageService / videoService) reference models from here automatically.

## 🛠️ Tech Stack

| Category | Technology |
|----------|------------|
| Framework | React 19 + TypeScript 6 |
| Build | Vite 8 |
| State | Zustand v5 (localStorage persistence) |
| Styles | TailwindCSS v4 + Framer Motion |
| Video | FFmpeg.wasm 0.12 |
| Icons | Lucide React |

## 📄 License

MIT License

## 🤝 Contributing

Issues and pull requests are welcome!

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'feat: add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request
