<div align="center">

# 🎬 AI Video Maker

**AI short-video production tool** — one idea → visual direction → assets → storyboard → shot images → clips → final cut, entirely in the browser, no backend.

English | [中文](./README.md) · [All docs](./docs/index.md)

</div>

> ⚠️ **Project status: Development**
>
> Still iterating fast. Async task recovery, auto mode and final assembly have known defects (see "Known limitations"). **Do not use it for production work or important content.** Generation really consumes your Agnes account quota and money — start with a short idea. No license file ships with this repository yet (see "License").

## What problem this solves

Most AI video tools turn "one sentence" into a black-box video, and every intermediate artifact is lost. This project splits the pipeline into six reviewable, editable, re-runnable stages, so **every intermediate artifact (visual direction, asset settings, dual prompts, duration) is explicit data** — you can re-roll a single shot instead of redoing the whole project.

| What you want to do | Read this |
| --- | --- |
| Run it, configure API key and plan | This page: [Quick start](#quick-start) and [Configuration](#configure-api-key-and-plan) |
| Understand how the program actually runs (trigger → request → write-back) | [docs/execution-flow.md](./docs/execution-flow.md) |
| See every parameter in/out and the real request bodies | [docs/execution-flow-diagrams.md](./docs/execution-flow-diagrams.md) |
| See how an idea is decomposed into fields, with the live prompt texts | [docs/idea-breakdown.md](./docs/idea-breakdown.md) |
| Click through downstream consumers of a field | [docs/flow-map.html](./docs/flow-map.html) (open locally, no server needed) |
| Mandatory rules before changing code | [AGENTS.md](./AGENTS.md) |
| Which document wins when facts disagree | [docs/index.md](./docs/index.md) |

## Main flow: six-step wizard

Step labels match the UI (`wizard.step1~6` in `src/i18n/index.ts`):

```text
1 Idea → 2 Assets → 3 Storyboard → 4 Images → 5 Videos → 6 Post-production
```

1. **Idea** — enter the creative idea plus aspect ratio (`9:16` / `16:9` / `1:1`). Enter triggers extraction, producing the visual direction and four asset categories, then jumps to step 2.
2. **Assets** — a project-level **visual direction** (six dimensions: medium/material, palette, lighting mood, camera texture, composition, emotion) plus four structured asset types: **character / scene / product / prop** (and a derived `style` asset with its style master image). Each reference image can be regenerated individually.
3. **Storyboard** — an outline first, then one request per shot, producing Chinese script text plus English **visualPrompt** / **motionPrompt** plus duration (normalized to 4 / 5 / 8 seconds only) plus dialogue and asset references. **The shot count is not fixed — the model decides it from the idea's narrative complexity** (override the `storyboard.shot-count` rule in Settings). **Everything is read-only**; the single edit entry is "hand it to AI with one instruction" in the shot detail page. Storyboard / images / videos share one two-column shell (`WizardShell`): a left shot rail with two columns of aspect-aware thumbnails plus shot-size and status badges, a right detail pane that stays put, and independent scrolling for each side — arrow keys move between shots, and the rail collapses into a top strip on narrow viewports.
4. **Images** — one image per shot (`visualPrompt` plus character/product/prop references as multi-reference input), concurrency 3, single-shot re-roll supported.
5. **Videos** — `motionPrompt` plus the shot image as first frame; for adjacent same-scene shots the **previous clip's last frame becomes this clip's first frame** (extracted locally, never persisted) so the seam stays continuous. Async creation with 5s polling, `size` fixed to `720P`, 4–12 second durations, optional manual first/last-frame mode; concurrency drops to 1 / 2 / 3 per plan. A failed creation no longer re-creates a task automatically (video is billed per second) — the shot stays failed until you retry it.
6. **Post-production** — FFmpeg.wasm concatenates clips into a downloadable MP4; a single clip is downloaded directly without FFmpeg.

### Two progression modes

- **Semi-auto (default)**: review checkpoints at steps 2 / 3 / 4 gate the next step.
- **Auto**: conditional effects chain all six steps; any failed item **halts** auto progression (100% success is required by design).

### Asset and consistency model

- **Chinese is the master data**; English prompts are AI-derived compiled artifacts — locked by default, unlockable for manual refinement; editing Chinese marks the asset `dirty` and re-derivation happens before generation.
- **The style master image only participates downstream as text (`stylePrompt`), never as an i2i reference image**; shot references are limited to character portrait → product → prop (a 2026-09-15 incident decision, to stop reference content being copied wholesale).
- Character portraits use species-locked composition (no hard-coded portrait phrasing) — this is the fix for "animal character drawn as a human".
- Assets carry a `source` marker: `extracted` (AI, replaced on re-extract) vs `manual` (kept on re-extract).
- All async write-back is keyed by `projectId` + `renderRevision`, so cross-project writes and stale results are dropped; editing a sub-field invalidates generated images/video per explicit rules — that is the real mechanism behind "edit means regenerate".

## Capabilities

- Six-step wizard + multi-project management (create / switch / duplicate / delete / search / sort), persisted in `localStorage`
- **Centralized rate limiting** for text / image / video: RPM sliding window plus Token Plan quota accounting; the single source of truth is `src/lib/plans.ts`. On a server-side 429 the matching model kind enters a cooldown and the request resumes automatically once the window clears — no manual re-roll needed
- **Prompt rule registry** (`src/lib/promptRules.ts`): skeletons in code, rule entries editable in Settings → "Prompt rules" (view / edit / toggle / add / import / export), **effective immediately, zero rebuild**
- **Sampling parameters decided by the model** (`src/lib/generationParams.ts`): a meta request decides `temperature` / `top_p` / Thinking per purpose; code only range-validates and caches
- Inline AI polish: every AI-assisted input embeds "polish / stepwise undo" (`components/ui/AiPolishField.tsx`)
- Bilingual UI (in-house lightweight i18n, no third-party dependency) + light/dark themes via semantic color tokens
- Docked runtime log panel (`components/LogConsoleDock.tsx`, trace/span + localStorage persistence)
- Dev-only debug outlet: `vite-plugins/debugDumpPlugin.ts` writes a sanitized store snapshot to `debug-dump/state.json` (gitignored)

## Explicitly not supported today

These are commonly assumed to exist but are not implemented in the code:

- **Multi-turn AI chat panel**: step 1 only has the idea field plus inline polish — no chat drawer (the old `AiAssistDrawer` was removed, and the project forbids re-introducing bolt-on AI entries).
- **Voice-over / TTS / subtitles**: the dialogue `delivery` field is a placeholder; dialogue never enters a generation request.
- **Project import/export, cloud sync, collaboration**: state lives in the current browser only.
- **Cancelling batch generation**: the only user-level cancel is "cancel assembly" in step 6. Switching projects, leaving a step or unmounting **does not** abort in-flight requests or video polling — quota is still spent and results are still written back by project id.
- **Image tiers 2K / 3K / 4K**: `aspectRatioToImageParams` always returns `1K` (`src/services/imageService.ts:72-78`); higher tiers exist only in the rate-limit table.
- **`shot.firstFrameUrl`**: a dead field with no consumer; the video first frame actually reads `shot.imageUrl`.
- The operation history tab is retired and removed from persistence (since persist v15).

## Quick start

### Prerequisites

- Node.js `^20.19.0` or `>=22.12.0` (`engines` in `package.json`)
- npm (lockfile v3, npm ≥ 9)
- An Agnes AI API key (or any OpenAI-compatible base URL)

### Install and run

```bash
npm install
npm run dev      # http://127.0.0.1:5188
```

### Configure API key and plan

1. Open **Settings** in the top bar → **General** tab.
2. Enter the API key; Base URL defaults to `https://api.agnes-ai.cn/v1`.
3. Pick the access plan (`default` / `enterprise` / Token Plan `starter` `plus` `pro`); the UI shows that plan's RPM and quota summary.
4. Save before generating.

Keys, settings and project data live in the current browser's `localStorage` and are only sent to the endpoint you configure. **Never commit a key or include one in a public screenshot.**

### Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server (port 5188, bound to `127.0.0.1`, opens the browser) |
| `npm run build` | `tsc` type check + Vite production build (outputs `dist/`) |
| `npm run preview` | Preview the production build (port 5180, `strictPort`) |
| `npm run test` | Vitest unit tests, single run |
| `npm run test:watch` | Vitest watch mode |
| `npx tsc --noEmit` | Type check only (fastest feedback) |

The full RPM and quota table is maintained **only** in `src/lib/plans.ts`; this page and `docs/` deliberately do not restate it, so the numbers cannot drift out of sync.

## Tech stack

React 19 + TypeScript (`strict`) · Vite 8 · Zustand 5 (persist) · Tailwind CSS 4 + Framer Motion 12 · FFmpeg.wasm (`@ffmpeg/ffmpeg` 0.12) · Lucide React · Vitest 4 · in-house i18n (zero dependency)

Model identifiers live in `src/lib/models.ts`; swapping a model means changing that one place.

## Project layout

```text
src/
├── pages/ProjectWorkspace.tsx   # Shell: top bar + left project rail + wizard main area (+ bottom log dock)
├── features/
│   ├── wizard/                  # Six steps: Step*.tsx + use{Script,Asset,Image,Video}Actions.ts
│   ├── characters/              # Character editor and panel
│   └── projects/                # Project rail (create/switch/duplicate/delete/search/sort)
├── services/                    # script / image / video / chat / render / rateLimit + ai/ (OpenAI-compatible)
├── stores/                      # projectStore(v16) / settingsStore(v4) / projectMigrations / projectOps / projectTypes
├── lib/                         # Side-effect-free domain tools: models plans promptRules promptComposer
│                                #   assetDetails shotReferences generationParams refineContent
│                                #   batchRunner jsonResponse fetchWithRetry validation resolveBaseUrl ...
├── components/                  # Settings dialog, banners, log dock + ui/ (polish field, confirm, lightbox, ...)
├── i18n/                        # zh / en dictionaries + useT
└── styles/globals.css           # Root font scaling and light/dark semantic color tokens

tests/                           # Vitest suites, mirrored by module
docs/                            # Design / flow / dated snapshots — index in docs/index.md
vite-plugins/                    # debugDumpPlugin (dev server only)
scripts/run-vitest.mjs           # Normalizes the Windows drive letter, then starts Vitest
```

## Testing and verification

- **Code unit tests only** (Vitest 4, `environment: "node"`, no jsdom, **no browser/E2E**). Current scale: 30 files / 393 tests passing (measured 2026-09-21).
- Network and time must be faked (`vi.stubGlobal("fetch")` + `vi.useFakeTimers()`); module-level singletons are isolated with `vi.resetModules()`.
- `tsconfig.json` includes only `src`, so `tests/` is not type-checked by `npm run build` — `npm run test` must hold on its own.
- UI appearance is confirmed manually by the maintainer. The minimum check after a change is `npx tsc --noEmit` + `git diff --check` + `npm run test` + `npm run build`.
- CI (`.github/workflows/deploy.yml`) builds and deploys to GitHub Pages on push to `main`; **it does not run unit tests**, so tests are not yet a deploy gate.

## Deployment

The build uses a relative `base` of `./`, so it works both on a custom domain and under a GitHub Pages subpath (`https://<user>.github.io/<repo>/`). Set Pages Source to "GitHub Actions"; pushing `main` then deploys automatically.

> Production builds exclude `debugDumpPlugin` (`apply: "serve"`), but the `/cdn-proxy` and `/ffmpeg-core` dev proxies only exist in the Vite dev server. When self-hosting, video download CORS or FFmpeg core fetch failures are a known gap.

## Known limitations

- Output depends on external models: structured JSON, prompt quality and image/video consistency remain unstable.
- Quota is consumed before the HTTP call and **is not rolled back** on failure; image 403 / content filtering and post-creation video failures still burn quota.
- Both the image and video creation POSTs **no longer retry automatically** (2026-09-23) — a failed shot stays failed until you reroll it, so quota is never silently burned more than once. That orchestration-level loop is gone (2026-09-23): the created task id is persisted on the shot, so a page refresh resumes polling the same task via GET instead of creating a billed duplicate.
- After a shot image is invalidated by the cascade, step 4 has no "fill only the missing items" entry, which pushes users into "regenerate everything".
- Auto mode stops permanently when any stage has a failed item; it never continues with failures.
- FFmpeg.wasm is bounded by browser memory and cross-origin resources; long or remote videos may fail to assemble.
- The shot count is delegated to the model with **no hard ceiling**: the more complex the idea, the more shots, and image/video quota scales linearly (tighten the `storyboard.shot-count` rule in Settings when cost matters).

When reporting a generation bug, include: wizard step, project status, failing shot numbers, browser console errors, and whether you refreshed or switched projects — that is the minimum triage set.

## Contributing

There is no `CONTRIBUTING.md` yet. Before changing code, read [AGENTS.md](./AGENTS.md) (layering and single-source-of-truth rules, wizard reliability rules, test conventions). The three most commonly broken:

- Batch generation must use the module-level registry as an idempotency guard, with one `AbortController` per task. Idea extraction in step 1 is a single-flight task too (`activeIdeaTasks`): while `project.status === "scripting"`, both the extract button and the bottom “Next” are disabled.
- Async results are written back by `projectId`; never use active-project actions across an `await`.
- User-facing text goes into `src/i18n/index.ts` (zh and en together), long prompts into `src/lib/promptRules.ts` entries, and mutable parameters into `lib/models.ts` / `lib/plans.ts`.

Commits follow Conventional Commits (`feat:` / `fix:` / `refactor:` / `docs:`) and stage business files precisely.

## License

This repository **ships no license file**, and `package.json` is still `"private": true`. Until the author picks and adds one, all rights are reserved by their owner. Do not treat this project as MIT-licensed.
