<div align="center">

# 🎬 AI Video Maker

**AI-Powered Short Video Production Tool**

English | [中文](./README.md)

A wizard-based short video production tool: enter a topic, and the AI automatically completes character extraction, storyboard scripting, reference images, video clip generation, and concatenation into a final video. Integrates Agnes AI's text, image, and video models.

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
| 🧭 **6-Step Wizard** | Idea → Assets (characters/scenes/products) → Storyboard → Images → Videos → Assembly, each step controllable and independently retryable |
| 🎬 **Auto Pipeline** | Auto mode: from topic to final video in one run (script → image → video → concat) |
| 🤖 **Smart Storyboard** | `agnes-2.5-flash` — generates 4-6 shots with dual prompts (text-to-image + image-to-video) |
| 🎨 **Image Generation** | `agnes-image-2.1-flash` — reference images from visual prompts (concurrency: 3) |
| 🎥 **Video Generation** | `agnes-video-v2.0` — async task + polling, rate-limited by plan, auto-retry & recovery |
| 🎞️ **Dual-Frame Control** | Optional first-frame + last-frame (image-to-video) for better motion consistency |
| ✂️ **Video Concatenation** | FFmpeg.wasm client-side concat demuxer for final MP4 output |
| ✨ **AI Prompt Assist** | Multi-turn AI chat to optimize any prompt field |
| 🚦 **Plan-Based Rate Limits** | 5 tiers (Free / Enterprise / Starter / Plus / Pro), RPM throttling + Token Plan quotas |
| 🔄 **Idempotent & Reliable** | Module-level idempotency guards: no duplicate server tasks, no killing in-flight tasks, auto-recovery on refresh/switch |
| 📋 **Multi-Project** | Create / switch / delete / duplicate projects, localStorage persistence |
| 📊 **History Log** | Last 200 operation records, grouped by date |
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
git clone https://github.com/ybd0612/ai-video-maker.git
cd ai-video-maker

# Install dependencies
npm install

# Start dev server (default: http://127.0.0.1:5173)
npm run dev

# Build for production (TypeScript check + Vite build)
npm run build

# Preview production build (port 5180)
npm run preview
```

### Configure API Key

1. Launch the app and click **Settings**
2. Enter your **API Key** (Agnes AI or any OpenAI-compatible key)
3. Verify the **API Base URL** (default China endpoint: `https://api.agnes-ai.cn/v1`)
4. Select your **Plan** (default: Free; upgrade to lift usage limits)
5. Save settings

> 💡 API keys are stored in browser localStorage and only sent to the configured endpoint when making API calls.

## 📖 Usage Guide

### 6-Step Wizard

| Step | Page | Description |
|------|------|-------------|
| 1️⃣ | **Idea** | Describe the topic, pick 16:9 / 9:16 / 1:1 ratio, refine via multi-turn AI chat |
| 2️⃣ | **Assets** | Auto-extracted characters/products, generate portraits, scene references, product references, style reference |
| 3️⃣ | **Storyboard** | 4-6 shots (copy / visual prompt / motion prompt / duration), edit & re-roll per shot |
| 4️⃣ | **Images** | Generate reference image per shot, re-roll individually |
| 5️⃣ | **Videos** | Generate video per shot (optional dual-frame), re-roll individually |
| 6️⃣ | **Assembly** | Validate all clips, concat with FFmpeg.wasm, download MP4 |

- **semi-auto (default)**: confirm images before video generation, go back and edit anytime
- **auto**: all steps advance automatically to the final video
- Free plan generates videos at about **1/min** (RPM=1); multiple shots queue with an estimated wait shown in the UI

### UI Layout

```
┌────────────┬────────────────────────┬──────────────────┐
│ Left Panel │      Wizard / Preview  │   Right Editor   │
│            │                        │                  │
│ · Projects │  · 6-step wizard       │  · Prompt fields │
│ · Shots    │  · Shot cards + badges │  · Duration      │
│ · Characters│ · Image/Video preview  │  · AI assist ✨   │
│ · History  │  · Final video + DL    │  · Retry button  │
└────────────┴────────────────────────┴──────────────────┘
```

## 💳 Plans & Rate Limits

The service targets free users; official access types have RPM and Token Plan subscription quotas. The app intercepts before real API calls to avoid 429 / quota overruns.

- **5 plan tiers**: `default` (Free), `enterprise`, `starter` / `plus` / `pro` (Token Plan)
- **Single source of truth**: `PLANS` constant in `src/lib/plans.ts` (adjust limits here only)
- **Central rate limiter**: singleton `rateLimiter` in `src/services/rateLimit.ts`; all three real entry points call `await rateLimiter.acquire(kind, opts)` before hitting the API
- **RPM throttling**: 60s sliding window per model kind (images further split by 1K/2K/3K/4K tier); waits automatically when the limit is reached
- **Subscription quotas** (Token Plan only): text (per 5h / per week), images (per day), video seconds (per day) — persisted to localStorage, survive refresh; exhausted quota raises a terminal error (not auto-retried)

| Model | default | enterprise | Token Plan |
|-------|---------|-----------|------------|
| Text | 20 RPM | 40 RPM | 1000 RPM |
| Image(1K) | 20 RPM | 40 RPM | 100 RPM |
| Video | 1 RPM | 2 RPM | 5 RPM |

## 🔒 Video Reliability Design

- **Async tasks**: `POST /videos` creates a task → `GET /agnesapi?video_id=` polls (5s interval, 30-min per-task timeout, 2-min task registration wait)
- **Idempotency guard**: batch generation tracked in a module-level registry — no duplicate starts per project, preventing duplicate server tasks (and double token spend)
- **Independent cancellation**: each batch uses its own AbortController; stuck "generating" states after refresh are reset and re-adopted
- **Per-project writes**: async results write back by the originating project ID — switching projects mid-generation never cross-writes
- **Failure grading**: only explicit failed/cancelled states turn red; tasks that may still be running keep waiting instead of false-failing

## 🏗️ Project Structure

```
src/
├── i18n/                          # Lightweight i18n (zero dependencies)
│   └── index.ts                   # zh/en translation dict + useT hook
├── pages/
│   └── ProjectWorkspace.tsx       # Main shell (3-column: sidebar | wizard | editor)
├── features/
│   ├── wizard/                    # 6-step wizard (main flow)
│   │   ├── CreationWizard.tsx     # Wizard container (step routing + state machine)
│   │   ├── StepIdea.tsx           # Step 1: idea + aspect ratio + AI chat
│   │   ├── StepAssets.tsx         # Step 2: character/scene/style assets
│   │   ├── StepStoryboard.tsx     # Step 3: storyboard scripts
│   │   ├── StepImages.tsx         # Step 4: shot images
│   │   ├── StepVideos.tsx         # Step 5: video generation
│   │   ├── StepAssembly.tsx       # Step 6: final assembly
│   │   ├── useWizardActions.ts    # Action orchestration (idempotency registries)
│   │   ├── ShotCard.tsx           # Shot card (status badge + expandable detail)
│   │   ├── PromptSubFields.tsx    # Prompt sub-field editor
│   │   ├── DualFrameToggle.tsx    # First/last frame toggle
│   │   └── ReviewCheckpoint.tsx   # Review checkpoint
│   ├── characters/                # Character editor / panel
│   ├── projects/                  # Project management panel
│   └── history/                   # Operation history panel
├── services/                      # Service layer
│   ├── rateLimit.ts               # Central rate limiter (RPM + quotas, singleton)
│   ├── scriptService.ts           # Text model call, structured storyboard (dual prompts)
│   ├── imageService.ts            # Image generation
│   ├── videoService.ts            # Video generation (async create + polling + result parsing)
│   ├── chatService.ts             # Multi-turn chat API (AI prompt optimization)
│   ├── renderService.ts           # FFmpeg.wasm video concatenation
│   ├── pipelineService.ts         # Legacy one-click pipeline (kept for compatibility)
│   └── ai/                        # Unified AI entry (OpenAI-compatible)
│       ├── factory.ts             # Service factory
│       ├── openai.ts              # chatCompletion / generateImage implementations
│       └── index.ts
├── stores/                        # Zustand stores
│   ├── projectStore.ts            # Multi-project management (localStorage, v1→v2 migration)
│   └── settingsStore.ts           # Global settings (apiKey/baseUrl/plan/language)
├── lib/
│   ├── models.ts                  # AI model identifier constants
│   ├── plans.ts                   # Plan & usage limits single source of truth
│   ├── fetchWithRetry.ts          # Unified fetch (timeout + exponential backoff retry)
│   ├── promptUtils.ts             # Visual/motion prompt composition
│   ├── characterUtils.ts          # Character description injection
│   ├── assetNamespace.ts          # Character namespace & full prompt
│   ├── resolveBaseUrl.ts          # API URL resolver
│   └── validation.ts              # Validation utilities (frame calc, prompt sanitize)
├── components/
│   ├── SettingsDialog.tsx         # Settings dialog (API Key / Base URL / Plan / Language)
│   ├── ApiKeyBanner.tsx           # API key missing banner
│   └── ui/                        # Shared UI components (ConfirmDialog / Lightbox / AiAssistDrawer, etc.)
├── styles/
│   └── globals.css                # Global styles
├── App.tsx                        # Root component
└── main.tsx                       # Entry point
```

## 🔧 Swapping Models

Model identifiers are centralized in `src/lib/models.ts`:

```typescript
export const MODELS = {
  text: "agnes-2.5-flash",
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
