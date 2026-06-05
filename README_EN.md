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
| 🎨 **Image Generation** | `agnes-image-2.1-flash` — text-to-image and image-to-image (base64 pipeline) |
| 🎬 **Video Generation** | `agnes-video-v2.0` — async task creation with progress polling |
| 📤 **Image Upload** | Drag-and-drop or click to upload local images as base64 |
| 🔗 **Smart Connections** | Rule-based handle validation prevents invalid data type connections |
| ⚡ **Workflow Execution** | Topological sort + cycle detection + cascading failure + partial execution |
| 💾 **Task Management** | Multi-canvas task switching, auto-save, version history (up to 20) |
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
| Delete connection | Click the edge to select, then press `Delete` / `Backspace` |
| Select node | Click a node — the right panel shows editable properties |
| Canvas controls | Bottom-left toolbar: zoom in, zoom out, fit view |

### Node Types

| Node | Function | Input | Output |
|------|----------|-------|--------|
| **Prompt** | Freeform text input | — | Text |
| **Text** | LLM text generation | Text | Text |
| **Image** | AI image generation | Text + Image (optional) | Image |
| **Video** | AI video generation | Image (optional) | Video |
| **Upload** | Local image upload | — | Image |

### Connection Rules

```
Prompt ──→ Text ──→ Image ──→ Video
                         ↑
Upload ──────────────────┘
```

- `text-out` → `text-in` / `prompt-out`
- `image-out` → `image-in` / `video-in`
- `video-out` → `video-in`

### Task Management

- **New task**: Enter a name and click New — current canvas is saved as a new task
- **Switch task**: Click a task tab (auto-saves current canvas before switching)
- **Save progress**: Click Save to "task name" to manually save
- **Version history**: Expand the history list and click any version to restore
- **Rename / Delete**: Hover over a task tab to reveal action buttons

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
│   ├── Sidebar.tsx            # Left drag palette
│   ├── TaskManager.tsx        # Task manager
│   ├── SettingsDialog.tsx     # Settings dialog
│   └── ApiKeyBanner.tsx       # API key prompt banner
├── stores/                    # State management (Zustand)
│   ├── canvasStore.ts         # Canvas state (IndexedDB persistence)
│   ├── settingsStore.ts       # Global settings (localStorage)
│   └── taskStore.ts           # Task management (localStorage)
├── providers/                 # AI model abstraction layer
│   ├── types.ts               # ModelProvider interface
│   └── agnes/
│       └── AgnesAdapter.ts    # Agnes AI adapter
├── lib/                       # Utilities
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
  readonly baseUrl: string;
  generateText(params: TextGenerationParams): Promise<TextResult>;
  generateImage(params: ImageGenerationParams): Promise<ImageResult>;
  generateVideo(params: VideoGenerationParams): Promise<VideoResult>;
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

[MIT License](./LICENSE)

## 🤝 Contributing

Issues and pull requests are welcome!

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'feat: add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request
