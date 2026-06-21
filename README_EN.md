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
<div align="center">

# 🎨 AI Canvas Creator

**An Infinite Canvas Workstation for AI Creation**

English | [中文](./README.md)

A node-based AI workflow editor built on React Flow, integrating Agnes AI's text, image, and video models with drag-and-drop orchestration, topological execution, and i18n support.

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite)
![React Flow](https://img.shields.io/badge/React_Flow-12-FF0072)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4-06B6D4?logo=tailwindcss)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🖼️ **Infinite Canvas** | Node-based canvas powered by React Flow — zoom, pan, minimap |
| 🤖 **Text Generation** | `agnes-2.0-flash` model with system prompts and custom parameters |
| 🎨 **Image Generation** | `agnes-image-2.1-flash` — text-to-image and image-to-image (URL pipeline, batch 1-10) |
| 🎬 **Video Generation** | `agnes-video-v2.0` — async task creation with progress polling |
| 📤 **Image Upload** | Drag-and-drop or click to upload local images as base64 |
| 🔗 **Smart Connections** | Rule-based handle validation, right-click to delete edges |
| 📐 **Preset Sizes** | Image/Video support multiple preset sizes (1:1, 16:9, 9:16, etc.) |
| 📦 **Batch Generation** | Image batch 1-10, Video batch 1-5 |
| ⚡ **Workflow Execution** | Topological sort + cycle detection + cascading failure + partial execution |
| 💾 **Task Management** | Folder tree, multi-canvas switching, auto-save + backup recovery |
| 🌐 **i18n** | Built-in lightweight i18n — switch between Chinese and English instantly |
| 🔧 **Swappable Models** | Abstract provider layer — swap models by changing the registry or implementing an adapter |

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18
- npm >= 9

### Install & Run

```bash
# Clone the repo
git clone https://github.com/your-username/ai-canvas-creator.git
cd ai-canvas-creator

# Install dependencies
npm install

# Start dev server (default: http://localhost:3000)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Configure API Key

1. Launch the app and click **Settings** at the bottom of the left sidebar
2. Enter your **API Key** (Agnes AI or any OpenAI-compatible key)
3. Verify the **API Base URL** (default: `https://apihub.agnes-ai.com/v1`)
4. Click **Test Connection**, then **Save Settings**

> 💡 API keys are stored in your browser locally and only sent to the configured endpoint when making API calls.

## 📖 Usage Guide

### Canvas Controls

| Action | Method |
|--------|--------|
| Add node | Drag from the left palette onto the canvas |
| Connect nodes | Drag from an output handle to an input handle |
| Delete connection | Right-click the edge, then select Delete |
| Select node | Click a node — the right panel shows editable properties |
| Canvas controls | Bottom-left toolbar: zoom in, zoom out, fit view |

### Node Types

| Node | Function | Input | Output |
|------|----------|-------|--------|
| **Prompt** | Freeform text input | — | Text |
| **Text** | LLM text generation | Text | Text |
| **Image** | AI image generation (batch 1-10, preset sizes) | Text + Image (optional) | Image |
| **Video** | AI video generation (batch 1-5, auto frame calc) | Image (optional) | Video |
| **Upload** | Local image upload | — | Image |

### Connection Rules

```
Prompt ──→ Text ──→ Image ──→ Video
                    ↑        ↑
Upload ─────────────┘────────┘
```

- `prompt-out` → `text-in` (Prompt outputs text to Text node)
- `text-out` → `text-in` (Text can be chained)
- `image-out` → `image-in` (Image can be chained, supports img2img)
- `image-out` → `video-in` (Image as video input)
- `video-out` → `video-in` (Video can be chained)
- Upload node outputs `image-out`, connectable to Image or Video nodes

### Task Management

- **New task**: Right-click the empty area in the task tree, select New Task or New Folder
- **Switch task**: Click a task name (auto-saves current canvas before switching)
- **Auto-save**: Canvas changes are auto-saved 500ms after the last edit
- **Rename / Delete**: Right-click a task or folder for context menu actions
- **Data recovery**: If task data is lost, the system auto-recovers from localStorage backup

## 🏗️ Project Structure

```
src/
├── i18n/                      # Internationalization
│   └── index.ts               # zh/en translation dict + useT hook
├── canvas/                    # Canvas core
│   ├── CanvasWorkspace.tsx    # Main canvas (React Flow)
│   ├── types.ts               # Node types, model registry
│   ├── validateConnection.ts  # Connection validation rules
│   ├── hooks/
│   │   └── useWorkflowRunner.ts  # Workflow execution engine
│   ├── nodes/                 # 5 custom node types
│   │   ├── PromptNode.tsx
│   │   ├── TextNode.tsx
│   │   ├── ImageNode.tsx
│   │   ├── VideoNode.tsx
│   │   └── UploadNode.tsx
│   ├── edges/                 # Custom edge styling
│   └── panels/                # Property editing panel
├── components/                # UI components
│   ├── Sidebar.tsx            # Left panel (settings + clear canvas)
│   ├── TaskTreeView.tsx       # Tree task manager (folders + tasks + context menu)
│   ├── SettingsDialog.tsx     # Settings dialog
│   ├── ApiKeyBanner.tsx       # API key prompt banner
│   └── ui/                    # Shared UI components
│       ├── ConfirmDialog.tsx  # Confirmation dialog
│       ├── ContextMenu.tsx    # Context menu
│       ├── HelpTooltip.tsx    # Help tooltip
│       ├── Lightbox.tsx       # Image lightbox
│       └── NumberInput.tsx    # Number input
├── stores/                    # State management (Zustand)
│   ├── canvasStore.ts         # Canvas state (IndexedDB persistence + localStorage backup)
│   ├── settingsStore.ts       # Global settings (localStorage)
│   └── taskStore.ts           # Task management (folders + multi-canvas, localStorage)
├── providers/                 # AI model abstraction layer
│   ├── types.ts               # ModelProvider interface
│   └── agnes/
│       └── AgnesAdapter.ts    # Agnes AI adapter
├── lib/
│   ├── resolveBaseUrl.ts      # API base URL resolver
│   └── validation.ts          # Validation utilities (frame calc, prompt sanitize)
├── styles/
│   └── globals.css            # Global styles + React Flow overrides
├── App.tsx                    # Root component
└── main.tsx                   # Entry point
```

## 🔧 Swapping Models

### Edit the Registry

Modify `MODEL_REGISTRY` in `src/canvas/types.ts`:

```typescript
export const MODEL_REGISTRY: Record<Modality, ModelEntry[]> = {
  text: [
    { id: "agnes-2.0-flash", name: "Agnes 2.0 Flash", modality: "text" },
    // Add more text models...
  ],
  image: [
    { id: "agnes-image-2.1-flash", name: "Agnes Image 2.1", modality: "image" },
  ],
  video: [
    { id: "agnes-video-v2.0", name: "Agnes Video v2.0", modality: "video" },
  ],
};
```

### Integrate a Custom Provider

Implement the `ModelProvider` interface in `src/providers/types.ts`:

```typescript
export interface ModelProvider {
  readonly name: string;
  discover(apiKey: string, baseUrl: string): Promise<AIModel[]>;
  generateText(apiKey: string, baseUrl: string, params: TextParams): Promise<TextResult>;
  generateImage(apiKey: string, baseUrl: string, params: ImageParams): Promise<ImageResult>;
  createVideoTask(apiKey: string, baseUrl: string, params: VideoParams): Promise<string>;
  pollVideoTask(apiKey: string, baseUrl: string, taskId: string): Promise<VideoTaskStatus>;
}
```

## 🌐 Internationalization

The project includes a lightweight i18n system with zero dependencies:

- **Translation dictionaries**: `zh` / `en` objects in `src/i18n/index.ts`
- **In components**: `const t = useT();` then `t("key")` or `t("key", { name: "value" })`
- **Outside components**: `getTranslation("key")`
- **Adding a language**: Add a new language object to the `dictionaries` map

## 🛠️ Tech Stack

| Category | Technology |
|----------|------------|
| Framework | React 18 + TypeScript 6 |
| Build | Vite 8 |
| Canvas | React Flow v12 |
| State | Zustand v5 + localForage |
| Styles | TailwindCSS v4 + Framer Motion |
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
