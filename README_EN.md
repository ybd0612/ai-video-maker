<div align="center">

# 🎬 AI Video Maker

**AI-powered short video production tool**

English | [中文](./README.md)

</div>

> ⚠️ **Project status: Development**
>
> This project is still under active development and currently has known bugs, unfinished interactions, and unstable edge cases. **Do not use it in production or for important content yet.** AI generation results, asynchronous task recovery, automation, and final video assembly may fail. Keep important prompts and assets backed up, and verify behavior in the local environment.

## Overview

AI Video Maker is a React-based AI short video production tool. Starting from one creative idea, users can progressively define a visual direction, build characters and other assets, generate storyboards, create shot images and video clips, and assemble the final video.

The project primarily uses Agnes AI text, image, and video models, while keeping an OpenAI-compatible service structure. It is a frontend application: project data and settings are mainly stored in browser `localStorage`, while generated images and videos are stored as URLs returned by the service.

## Current Product Flow

The current pipeline is:

```text
Idea → Visual Direction → Character/Scene/Product/Prop Assets → Storyboard → Shot Images → Videos → Assembly
```

The UI presents this as a six-step wizard. Visual direction and asset preparation are handled inside Step 2:

1. **Idea**: Enter the topic, story idea, and aspect ratio; optionally refine it through AI chat.
2. **Assets**: Define the project visual direction, extract characters/scenes/products/props, and generate asset reference images immediately.
3. **Storyboard**: Generate and edit storyboard scripts, visual prompts, motion prompts, and durations.
4. **Images**: Generate a reference image for each shot and retry individual shots.
5. **Videos**: Generate video clips from storyboard and shot images, including optional first/last-frame mode.
6. **Assembly**: Concatenate clips in the browser with FFmpeg.wasm and download the final video.

### Asset model

- **Visual Direction** is a project-level visual master containing medium/material, color palette, lighting mood, camera texture, composition, and overall emotion.
- **Characters, scenes, products, and props** are structured assets with dedicated detail fields, not just plain descriptions.
- Each asset has a one-line summary and a complete type-specific setting.
- Asset cards open a shared detail editor with a consistent split layout, fixed-ratio preview, and AI-instruction editing.
- Asset reference images are generated during the asset step; shot images and videos are generated later in their respective steps.
- Deleting assets, characters, projects, and other sensitive data requires confirmation.

## Features

- **Six-step wizard**: Idea → Assets → Storyboard → Images → Videos → Assembly.
- **Visual direction**: A reusable project visual master for assets and shots.
- **Structured assets**: Dedicated full settings for characters, scenes, products, and props.
- **AI editing**: Modify asset and storyboard content through AI instructions, with undo support.
- **Reference images**: Generate style, character, scene, product, and prop references during asset preparation.
- **Storyboard generation**: Generate structured shots with separate visual and motion prompts.
- **Video generation**: Async creation and polling; 720P, 4–12 seconds, and first/last-frame mode.
- **Final assembly**: Concatenate shot videos in the browser with FFmpeg.wasm.
- **Multi-project management**: Create, switch, duplicate, and delete projects with local persistence.
- **Plan-based limits**: RPM throttling and Token Plan quota tracking.
- **Bilingual UI**: Built-in Chinese/English translations.
- **Light/dark themes**: Semantic token-based light and dark themes.

## Known Limitations

These are real development-stage boundaries and are not presented as fully solved:

- AI output depends on external models; structured JSON, prompt quality, and image/video consistency can still be unstable.
- Image and video generation are asynchronous network tasks and may fail, time out, queue, or require recovery after a refresh.
- Video generation on the free plan has a low RPM limit, so multi-shot jobs usually wait in a queue.
- Auto mode advances through several steps without manual checkpoints and may still encounter state synchronization, recovery, or gate issues.
- Model response fields can differ between implementations. The service layer includes compatibility parsing, but cannot guarantee every response shape.
- FFmpeg.wasm depends on browser memory, cross-origin resources, and the local runtime environment; some videos may fail to assemble.
- Project state is currently stored mainly in `localStorage`, so the app is not designed for collaboration, cloud synchronization, or large media libraries.
- UI details, edge states, and error messages are still being refined.

When reporting an issue, include the project status, current wizard step, model response, browser console error, and whether the project was refreshed or switched during generation.

## Quick Start

### Prerequisites

- Node.js `^20.19.0` or `>=22.12.0`
- npm `>=9`

### Install and run

```bash
npm install
npm run dev
```

Default development URL: `http://127.0.0.1:5173`

### Common commands

```bash
# TypeScript check and production build
npm run build

# Run Vitest unit tests
npm run test

# Watch unit tests
npm run test:watch

# Preview the production build
npm run preview
```

The project currently maintains code-level unit tests with Vitest. Browser/E2E tests are not part of the development verification workflow. UI behavior and real AI generation flows should be checked manually in a local environment.

## API Configuration

1. Start the application and open **Settings**.
2. Enter an Agnes AI or OpenAI-compatible API key.
3. Check the API Base URL. The default China endpoint is `https://api.agnes-ai.cn/v1`.
4. Select the current access plan.
5. Save the settings before generating content.

API keys and project settings are stored in the current browser's `localStorage` and are sent only to the configured endpoint when requests are made. Never commit keys or include them in public screenshots.

## Plans and Rate Limits

The single source of truth for plans and quotas is `src/lib/plans.ts`. Requests are controlled by the rate limiter in `src/services/rateLimit.ts`.

Supported plan identifiers currently include:

- `default`: Free
- `enterprise`: Enterprise
- `starter` / `plus` / `pro`: Token Plan tiers

| Model type | default | enterprise | Token Plan |
| --- | ---: | ---: | ---: |
| Text | 20 RPM | 40 RPM | 1000 RPM |
| Image (1K) | 20 RPM | 40 RPM | 100 RPM |
| Video | 1 RPM | 2 RPM | 5 RPM |

Image-size limits, subscription windows, and daily quotas should be read from the current implementation in `src/lib/plans.ts`.

## Technology Stack

- React 19 + TypeScript
- Vite 8
- Zustand 5 for state and persistence
- Tailwind CSS 4 + Framer Motion
- FFmpeg.wasm 0.12
- Vitest 4
- Lucide React

## Project Structure

```text
src/
├── components/       # Settings, dialogs, lightbox, and shared UI
├── features/
│   ├── wizard/       # Six-step wizard, assets, storyboard, images, videos, assembly
│   ├── characters/   # Character panel and editor
│   ├── projects/     # Project management
│   └── history/      # Operation history
├── services/         # Text, image, video, chat, and rendering services
├── stores/           # projectStore and settingsStore
├── lib/              # Models, plans, prompts, asset details, and validation
├── i18n/             # Chinese/English translations
└── styles/           # Global theme and semantic colors

tests/                # Vitest unit tests
```

## Development Conventions

- This is an experimental development project. Check the existing data model, async task guards, and write-back paths before changing behavior.
- Keep models, plans, prompt rules, and protocol parameters in their single sources of truth rather than hard-coding them in page components.
- Async generation must avoid duplicate submissions, accidental cancellation, and cross-project writes.
- Sensitive operations such as deletion must require confirmation.
- Add user-facing text to both Chinese and English translation dictionaries.
- Before committing, run `npm run test`, `npm run build`, and `git diff --check`.

## License

MIT License
