# 三页双栏骨架布局重排 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐，逐任务派新代理）或 superpowers:executing-plans 逐任务实现本计划。步骤用 checkbox（`- [ ]`）跟踪。
>
> **执行环境提示**：本计划设计为由**新会话的长任务**连续执行。每个任务都以「红 → 绿 → 提交」闭环结束；不要并行乱序，任务间有依赖（见每个任务的 Consumes）。

**Goal:** 把 分镜 / 图片 / 视频 三个向导页从"单列长滚 + 就地展开/整页替换"改造为「左镜头轨 + 右常驻详情」双栏骨架，并同时修掉视觉层级 token 塌缩与画幅无表达两个"廉价感"根因。

**Architecture:** 先修设计 token 与按画幅派生的媒体版式（P0，纯样式，零结构风险）→ 抽出四个共享件把三页重复 markup 收敛为一处（P1）→ 用 `WizardShell` + `WizardRail` 落地双栏并把滚动切成两个有界区（P2）→ 折叠三档与死代码清理（P3）。**所有可判定的布局逻辑一律下沉到 `src/lib/*.ts` 纯函数并写单测**，JSX 只做搬运 —— 因为本仓库不可测 React 渲染。

**Tech Stack:** React 19 + TypeScript 6 strict + Vite 8 + TailwindCSS v4（`@theme inline` 语义 token、`@container` 容器查询）+ Zustand v5 + Vitest 4.1.11（`environment: "node"`）+ lucide-react。

**Spec:** `docs/roadmap/2026-09-23-wizard-layout-redesign-design.md`（已定稿；§17 是实施硬约束，执行前必读）。

## Global Constraints

每个任务的要求都隐含包含本节，取值逐字来自 `AGENTS.md` 与设计稿 §17：

- TypeScript `strict` + `noUnusedLocals` + `noUnusedParameters`；类型导入必须 `import type`（`verbatimModuleSyntax`）；禁止 `enum`（`erasableSyntaxOnly`）；禁止 `as any` / `as never` / `@ts-ignore` / `@ts-expect-error`。
- **不新增任何依赖**。仓库无虚拟列表库，本计划不引入（是否虚拟化由 Task 14 的实测决定，默认不做）。
- **禁止浏览器 / E2E 测试**；不引入 jsdom / happy-dom / @testing-library。`vitest.config.ts` 的 `include` 只收 `tests/**/*.test.ts`，**`.tsx` 不参与测试** → 组件渲染不可测，凡可判定逻辑必须先在 `src/lib/` 落成纯函数并测纯函数。不得在交付说明里声称做过组件测试。
- **界面验证方式**：`npx tsc --noEmit` + `git diff --check` + `npm run test` + `npm run build`；**AI 不启动 dev/preview 服务核对界面**，观感由用户本地确认（每期末尾的「用户目测项」就是交付说明里必须列出的待验收清单）。
- **样式铁律**：禁止写死 `text-[Npx]`；尺寸一律 rem（`text-[0.6875rem]` 这类 rem 写法或 Tailwind 预设）；颜色一律用语义 token 工具类（`bg-app/surface/raised/hover`、`border-line/-soft/-strong`、`text-ink~-5`、`accent/accent-solid/accent-deep`、`info/info-solid`、`success/success-solid/success-deep`、`warn/warn-solid/warn-deep`、`danger/danger-solid/danger-deep`）。**注意浅底 tint 叫 `*-deep` 且深色主题下它是暗色**，现有写法是 `bg-danger-deep/30` 这种带透明度形式，照此办。`--c-shadow` 与 `--c-edge-selected` **未映射进 `@theme inline`**，只能 `var(--c-shadow)` 直用。
- **文案铁律**：所有用户可见文本进 `src/i18n/index.ts`，`zh` 与 `en` **同时**添加（`en` 缺键会直接编译不过，因为 `TranslationKey = keyof typeof zh`）。插值 `getTranslation(key, vars)` 用 `{name}` 占位且是**单次替换** —— 一条文案里同一占位符不得出现两次。禁止在 JSX 里硬编码中文。
- **行为零改动**：不改任何生成链路、请求体、写回逻辑、`canAdvance` 门禁、审核位写入点。P1 的每个 commit 的 diff 里**不允许出现**回调体、store action 调用或请求构造的改动（只有 markup/props 搬运）；review 时按 diff 逐条核对。
- **不得让步骤组件重新挂载**：三页各有依赖 `[shots.length]` 的自动生成 effect 与"从缺到齐"边沿检测的 `prev` ref。双栏壳必须在**步骤组件内部**渲染，页面自己持有选中态；不得改成路由级子组件、不得给步骤页加 `key`（会造成批量生成重触发、烧配额）。
- **待办计数唯一口径**：`pendingImageShots` / `pendingVideoShots`（`src/lib/shotQueue.ts`）。任何新徽标必须复用，禁止自己 filter。
- **审核位**：`imagesReviewed` / `storyboardReviewed` / `assetsReviewed` 只在原 confirm 回调里写，重构不得绕过（否则 `canAdvance` 永久 false）。
- **Lightbox 兼容**：轨与其祖先不得加 `transform` / `filter`（Lightbox 是 body 级 `fixed` 副作用）。
- **跨 `await` 一律按 `targetProjectId` 写回**（本计划理论上不新增异步，若发现需要则照此）。
- 提交：约定式中文 message，**精确 `git add` 本次文件，禁止 `git add -A`**，**默认不 push**。`docs/roadmap/` 与 `docs/index.md` 的口径同步集中在 **Task 15**，前面任务不要改文档（`AGENTS.md` 的 token 说明例外，见 Task 1 Step 6）。
- 测试基线：**44 文件 / 530 用例**（2026-09-23 实测）。用例数应随新增测试增长，每次交付报出实际数字。

---

## 文件结构

新增：

| 文件 | 职责 |
|---|---|
| `tests/lib/themeTokens.test.ts` | 解析 `globals.css`，断言浅色主题层级 token 不再同值 + 对比度下限 |
| `src/lib/mediaLayout.ts` | 画幅 → 版式的唯一口径：`resolveAspect` / `ASPECT_CONTAINER_CLASS` / `MEDIA_FRAME`（纯数据 + 纯函数） |
| `tests/lib/mediaLayout.test.ts` | 上述 |
| `src/lib/railSelection.ts` | 镜头轨的选中态与键盘导航纯逻辑 |
| `tests/lib/railSelection.test.ts` | 上述 |
| `src/lib/shotDisplay.ts` | 景别中文标签键、轨上徽标语义的纯映射（含"未知"降级） |
| `tests/lib/shotDisplay.test.ts` | 上述 |
| `src/lib/firstFrameSource.ts` | 解释「本镜首帧从哪来、为什么没衔接」的唯一纯函数（供详情区展示） |
| `tests/lib/firstFrameSource.test.ts` | 上述 |
| `src/features/wizard/WizardMessages.tsx` | 统一提示/错误框（消灭 4 处近似重复） |
| `src/features/wizard/StepProgressBar.tsx` | 统一步级完成度条（固定 accent 语义） |
| `src/features/wizard/StepHeader.tsx` | 统一页头：标题 + 计数 + 右侧动作槽 |
| `src/features/wizard/WizardRail.tsx` | 左镜头轨：两列竖略图 + 景别/状态徽标 + 键盘可达 |
| `src/features/wizard/WizardShell.tsx` | 双栏骨架：页头槽 / 轨槽 / 详情槽 / 详情动作槽，两个有界滚动区 |

修改（按任务）：

| 文件 | 任务 |
|---|---|
| `src/styles/globals.css` | 1（token 层级值） |
| `AGENTS.md` | 1（token 用途边界） |
| `src/features/wizard/StepImages.tsx` | 3（版式）→ 5、6（共享件）→ 9（双栏）→ 13（折叠） |
| `src/features/wizard/StepVideos.tsx` | 3 → 5、6 → 10 → 13 |
| `src/features/wizard/StepStoryboard.tsx` | 3（容器）→ 4、6 → 11 → 13 |
| `src/features/wizard/ShotCard.tsx` | 3（缩略图版式）→ 11（轨接管后删除其折叠头职责）→ 13（删除组件） |
| `src/features/wizard/DualFrameToggle.tsx` | 3（尾帧预览版式） |
| `src/features/wizard/ShotListSection.tsx` | 4（页头/进度）→ 11（轨复用其条目渲染） |
| `src/features/wizard/ReviewCheckpoint.tsx` | 6（加 `confirmDisabled`） |
| `src/features/wizard/StepAssets.tsx` | 4、6（复用共享件，不改结构） |
| `src/features/wizard/ExpandableSection.tsx` | 13（从死代码改为折叠三档唯一实现） |
| `src/i18n/index.ts` | 6、7、8、10、11、13（新增键，zh/en 同步） |
| `src/lib/promptComposer.ts` | 10（导出 `MAX_TOTAL_REFERENCES`，供"参考位被景别拒收"解释） |

测试镜像：`tests/lib/` 五个新文件；`tests/features/wizard/wizardActionUtils.test.ts` 不动（行为锁）。

---

## Phase P0 —— 层级与版式（不动结构，先见效）

### Task 1: 修掉浅色主题的层级 token 塌缩

**背景（必读）**：`src/styles/globals.css` 的 `:root`（约 :20-33）里 `--c-ink-3` 与 `--c-ink-4` 都是 `#64748b`，`--c-line` 与 `--c-line-soft` 都是 `#e2e8f0`。注释表明这是**刻意**的（保分割线可见 / 双主题同值），但后果是全项目靠这两档做的视觉层级实际不存在 —— 这是"看着糊"的第一根因。本任务只改值，并留下一条能失败的测试防止被"顺手改回去"。

**Files:**
- Modify: `src/styles/globals.css`（`:root` 内 `--c-ink-4`、`--c-line-soft` 两行；dark 段 `html[data-theme="dark"]` **不动**）
- Modify: `AGENTS.md`（黑白主题一节的 token 说明）
- Test: `tests/lib/themeTokens.test.ts`（新建）

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: 浅色主题下 `ink` / `ink-2` / `ink-3` / `ink-4` / `ink-5` 五档互不相同、`line` ≠ `line-soft`；`tests/lib/themeTokens.test.ts` 作为回归绊线

- [x] **Step 1: 写失败测试**

```ts
// tests/lib/themeTokens.test.ts
// ────────────────────────────────────────────────────────────────────────────
// tests/lib/themeTokens.test.ts
// 浅色主题层级 token 的绊线：断言"辅助文字 / 弱化文字"与"常规边框 / 弱边框"
// 不再是同一个值。改回同值会让全站的视觉层级失效（2026-09-23 实测根因），
// 因此这条测试是防回归，不是描述偏好。
// 直接读源码文本解析：本仓库不渲染 CSS，也不引入 postcss。
// ────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  fileURLToPath(new URL("../../src/styles/globals.css", import.meta.url)),
  "utf8",
);

/** 取 :root { ... } 段（第一个块）内的变量表 */
function rootVars(): Record<string, string> {
  const body = CSS.slice(CSS.indexOf(":root"), CSS.indexOf("html[data-theme"));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--c-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)) {
    out[m[1]] = m[2].toLowerCase();
  }
  return out;
}

/** WCAG 相对亮度 */
function relLum(hex: string): number {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw.slice(0, 6);
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("浅色主题层级 token", () => {
  const v = rootVars();

  it("解析到 :root 的全部层级变量（解析器若失效必须红，不允许静默通过）", () => {
    for (const key of ["--c-app", "--c-raised", "--c-line", "--c-line-soft",
      "--c-ink", "--c-ink-2", "--c-ink-3", "--c-ink-4", "--c-ink-5"]) {
      expect(v[key], `${key} 未解析到`).toMatch(/^#/);
    }
  });

  it("文字四档两档不同值：弱化文字不再等于辅助文字", () => {
    expect(v["--c-ink-4"]).not.toBe(v["--c-ink-3"]);
  });

  it("五档文字严格递减（ink 最深 → ink-5 最弱）", () => {
    const ramp = ["--c-ink", "--c-ink-2", "--c-ink-3", "--c-ink-4", "--c-ink-5"].map((k) => relLum(v[k]));
    for (let i = 1; i < ramp.length; i++) {
      expect(ramp[i], `第 ${i} 档未比前一档更浅`).toBeGreaterThan(ramp[i - 1]);
    }
  });

  it("边框两档不再同值：弱边框专管内部分隔", () => {
    expect(v["--c-line-soft"]).not.toBe(v["--c-line"]);
    // 且必须仍然可见（比页面底更深一点才算"分割线"）
    expect(relLum(v["--c-line"])).toBeLessThan(relLum(v["--c-app"]));
  });

  it("弱化文字仍要读得清：ink-4 在三种底色上均不低于 3:1", () => {
    for (const bg of ["--c-app", "--c-surface", "--c-raised"]) {
      expect(contrast(v["--c-ink-4"], v[bg]), `${bg} 上对比度不足`).toBeGreaterThanOrEqual(3);
    }
  });

  it("深色主题不被误改（已分得开，本任务不动它）", () => {
    const dark = CSS.slice(CSS.indexOf("html[data-theme=\"dark\"]"));
    expect(dark).toContain("--c-ink-3: #94a3b8");
    expect(dark).toContain("--c-ink-4: #64748b");
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `npm run test -- tests/lib/themeTokens.test.ts`
Expected: FAIL —— 「文字四档两档不同值」与「边框两档不再同值」两条红（当前同为 `#64748b` / `#e2e8f0`）。若第一条"解析到全部变量"就红，说明解析器没对上文件结构，先修解析器再继续（不得靠放宽断言蒙过去）。

- [x] **Step 3: 改 token 值**

`src/styles/globals.css` 的 `:root` 段内，两行改为：

```css
  --c-line-soft: #eef2f6;    /* 弱边框（仅用于内部分隔：子字段之间、卡片内小节之间） */
```

```css
  --c-ink-4: #7b8a9d;        /* 弱化文字：只用于计数 / 进度百分比 / 图标按钮标题等非关键信息 */
```

其余行**一律不动**（尤其 `--c-line: #e2e8f0` 与 `--c-ink-5: #94a3b8`；`html[data-theme="dark"]` 整段不碰）。

- [x] **Step 4: 跑测试确认通过**

Run: `npm run test -- tests/lib/themeTokens.test.ts`
Expected: PASS（6 个用例）

- [x] **Step 5: 核对既有 ink-4 用法有没有被误当正文用**

Run: `grep -rn "text-ink-4" src/ | wc -l` 与逐条浏览 `grep -rn "text-ink-4" src/`
Expected: 用法数不变（本任务不改调用点）。若发现某处 ink-4 承载的是**必须读的正文**（不是计数/标签），记下 `文件:行` 写进交付说明，**不当场改**（留给 Task 15 统一判定）。

- [x] **Step 6: 同步 AGENTS.md 的 token 说明**

在 `AGENTS.md`「黑白主题（2026-09-12 方案 A 落地）」那条里，语义色 token 清单之后追加一句（**这是文档同步的唯一例外，因为它是本次改动的直接口径**）：

```markdown
- **层级 token 用途边界（2026-09-23）**：浅色主题五档文字 `ink` > `ink-2` > `ink-3` > `ink-4` > `ink-5` 严格递浅，**`ink-4` 起只用于非关键信息**（计数、进度百分比、图标按钮标题、占位提示），正文与可读文本一律 `ink` / `ink-2` / `ink-3`。边框两档各司其职：`border-line` 外框与模块分割线，`border-line-soft` 内部分隔。回归绊线在 `tests/lib/themeTokens.test.ts`（改回同值会红）。
```

- [x] **Step 7: 全量验证**

Run: `npx tsc --noEmit && git diff --check && npm run test && npm run build`
Expected: tsc 无输出；test 全绿（44 文件 → 45 文件，用例数比基线 530 多 6）；build 成功

- [x] **Step 8: 用户目测项（记入交付说明，AI 不做界面核对）**

请在本地看浅色主题：① 卡片外框与内部细分隔线现在能分辨；② `wizard.queueCount`、进度百分比这类小字是否仍清晰；③ 步骤状态徽标（`shotStatus` 用了 `text-ink-4` 表示 idle）观感。

- [x] **Step 9: 提交**

```bash
git add src/styles/globals.css tests/lib/themeTokens.test.ts AGENTS.md
git commit -m "fix(theme): 拆开浅色主题塌缩的层级 token，并加绊线防回归"
```

---

### Task 2: 画幅 → 版式的唯一口径 `src/lib/mediaLayout.ts`

**背景**：图片主图写死 `w-full object-contain max-h-48`（`StepImages.tsx:157`），视频素材写死 `h-24`（`StepVideos.tsx:184,195,199,218`），两页都不读 `project.aspectRatio` → 9:16 竖屏素材被压成扁条、两侧大片空白。本任务把"按画幅怎么排"定成一处纯数据，Task 3 只做搬运。

**Files:**
- Create: `src/lib/mediaLayout.ts`
- Test: `tests/lib/mediaLayout.test.ts`

**Interfaces:**
- Consumes: `type AspectRatio`（`src/stores/projectTypes.ts:30`，值为 `"9:16" | "16:9" | "1:1"`）
- Produces:
  - `const DEFAULT_ASPECT: AspectRatio`
  - `function resolveAspect(value: unknown): AspectRatio`
  - `type MediaSlot = "railThumb" | "detailPrimary" | "detailSecondary"`
  - `interface MediaFrame { containerClass: string; mediaClass: string; }`
  - `const MEDIA_FRAME: Record<MediaSlot, Record<AspectRatio, MediaFrame>>`
  - `const ASPECT_RATIO_CSS: Record<AspectRatio, string>`

- [x] **Step 1: 写失败测试**

```ts
// tests/lib/mediaLayout.test.ts
// ────────────────────────────────────────────────────────────────────────────
// tests/lib/mediaLayout.test.ts
// 画幅版式唯一口径。断言来自 src/lib/mediaLayout.ts 真实实现。
// 关注三件事：① 三种画幅的版式类串必须互不相同（今天完全相同是根因）；
// ② 竖幅详情预览必须"高度优先"（不按宽度撑满后被 max-h 截，那正是留白来源）；
// ③ 非法/缺失画幅回落 16:9（与 projectStore 的新建默认一致），不抛错。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  ASPECT_RATIO_CSS,
  DEFAULT_ASPECT,
  MEDIA_FRAME,
  resolveAspect,
  type MediaSlot,
} from "@/lib/mediaLayout";

const SLOTS: MediaSlot[] = ["railThumb", "detailPrimary", "detailSecondary"];

describe("resolveAspect", () => {
  it("合法值原样返回", () => {
    expect(resolveAspect("9:16")).toBe("9:16");
    expect(resolveAspect("16:9")).toBe("16:9");
    expect(resolveAspect("1:1")).toBe("1:1");
  });

  it("非法 / 缺失 / 非字符串一律回落 DEFAULT_ASPECT（=16:9，与新建项目默认同值）", () => {
    expect(DEFAULT_ASPECT).toBe("16:9");
    for (const bad of [undefined, null, "4:5", "", "9×16", 42, {}]) {
      expect(resolveAspect(bad)).toBe("16:9");
    }
  });
});

describe("ASPECT_RATIO_CSS", () => {
  it("三种画幅的宽高比类串互不相同", () => {
    const values = Object.values(ASPECT_RATIO_CSS);
    expect(new Set(values).size).toBe(3);
    expect(ASPECT_RATIO_CSS["9:16"]).toBe("aspect-[9/16]");
  });
});

describe("MEDIA_FRAME", () => {
  it("每个槽位都覆盖三种画幅，且类串非空", () => {
    for (const slot of SLOTS) {
      for (const aspect of ["9:16", "16:9", "1:1"] as const) {
        const frame = MEDIA_FRAME[slot][aspect];
        expect(frame.containerClass, `${slot}/${aspect}`).toBeTruthy();
        expect(frame.mediaClass, `${slot}/${aspect}`).toBeTruthy();
      }
    }
  });

  it("三画幅的容器类串互不相同（否则等于没做画幅适配）", () => {
    for (const slot of SLOTS) {
      const set = new Set([
        MEDIA_FRAME[slot]["9:16"].containerClass,
        MEDIA_FRAME[slot]["16:9"].containerClass,
        MEDIA_FRAME[slot]["1:1"].containerClass,
      ]);
      expect(set.size, slot).toBe(3);
    }
  });

  it("竖幅详情预览按高度优先：容器带 h-* 与 aspect，且不含 w-full 撑宽", () => {
    const portrait = MEDIA_FRAME.detailPrimary["9:16"].containerClass;
    expect(portrait).toContain("aspect-[9/16]");
    expect(portrait).toMatch(/(^| )h-\[/);
    expect(portrait).not.toContain("w-full");
  });

  it("横幅详情预览按宽度优先（w-full + aspect-[16/9]）", () => {
    const landscape = MEDIA_FRAME.detailPrimary["16:9"].containerClass;
    expect(landscape).toContain("w-full");
    expect(landscape).toContain("aspect-[16/9]");
  });

  it("轨上缩略图一律裁剪填满（object-cover），详情主图一律完整可见（object-contain）", () => {
    expect(MEDIA_FRAME.railThumb["9:16"].mediaClass).toContain("object-cover");
    expect(MEDIA_FRAME.detailPrimary["9:16"].mediaClass).toContain("object-contain");
  });

  it("轨上缩略图竖幅用竖比例、横幅用横比例（两列轨的观感差别全在这里）", () => {
    expect(MEDIA_FRAME.railThumb["9:16"].containerClass).toContain("aspect-[9/16]");
    expect(MEDIA_FRAME.railThumb["16:9"].containerClass).toContain("aspect-[16/9]");
    expect(MEDIA_FRAME.railThumb["1:1"].containerClass).toContain("aspect-square");
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `npm run test -- tests/lib/mediaLayout.test.ts`
Expected: FAIL —— 模块不存在

- [x] **Step 3: 实现 `src/lib/mediaLayout.ts`**

```ts
// ────────────────────────────────────────────────────────────────────────────
// src/lib/mediaLayout.ts
// 画幅 → 版式的唯一口径。今天三页各自写死 max-h-48 / h-24，导致 9:16 竖屏素材
// 被 letterbox 成扁条、两侧大片空白（2026-09-23 取证）。所有出图/出片的容器类串
// 一律从这里取，页面不得再自带尺寸判断 —— Tailwind 需要静态类串，因此用
// 「完整字面量映射表」而不是运行时拼类（拼类不会被 JIT 收集）。
// ────────────────────────────────────────────────────────────────────────────

import type { AspectRatio } from "@/stores/projectTypes";

/** 与 projectStore 新建项目的默认画幅保持一致 */
export const DEFAULT_ASPECT: AspectRatio = "16:9";

const ASPECTS: readonly AspectRatio[] = ["9:16", "16:9", "1:1"];

/** 持久化数据 / 旧项目可能缺字段或非字符串，统一回落默认画幅，不抛错也不猜。 */
export function resolveAspect(value: unknown): AspectRatio {
  return ASPECTS.includes(value as AspectRatio) ? (value as AspectRatio) : DEFAULT_ASPECT;
}

/** 宽高比本身（容器查询与占位块共用） */
export const ASPECT_RATIO_CSS: Record<AspectRatio, string> = {
  "9:16": "aspect-[9/16]",
  "16:9": "aspect-[16/9]",
  "1:1": "aspect-square",
};

export type MediaSlot = "railThumb" | "detailPrimary" | "detailSecondary";

export interface MediaFrame {
  /** 容器类串：决定占位形状与是否撑满 */
  containerClass: string;
  /** img / video 类串：决定填充方式 */
  mediaClass: string;
}

export const MEDIA_FRAME: Record<MediaSlot, Record<AspectRatio, MediaFrame>> = {
  // 轨上缩略图：铺满格位、裁剪填满，竖横幅各自比例正确即可，不追求看清细节
  railThumb: {
    "9:16": { containerClass: "aspect-[9/16] w-full", mediaClass: "h-full w-full object-cover" },
    "16:9": { containerClass: "aspect-[16/9] w-full", mediaClass: "h-full w-full object-cover" },
    "1:1": { containerClass: "aspect-square w-full", mediaClass: "h-full w-full object-cover" },
  },
  // 详情主媒体：必须完整看得见（用户就是来验收这一帧的），因此竖幅按高度优先，
  // 绝不再用「w-full + max-h」—— 那正是今天竖屏两侧留白的直接原因。
  detailPrimary: {
    "9:16": { containerClass: "h-[58vh] max-h-[620px] aspect-[9/16]", mediaClass: "h-full w-full object-contain" },
    "16:9": { containerClass: "w-full max-h-[62vh] aspect-[16/9]", mediaClass: "h-full w-full object-contain" },
    "1:1": { containerClass: "h-[52vh] max-h-[560px] aspect-square", mediaClass: "h-full w-full object-contain" },
  },
  // 详情次级位（参考图条、尾帧预览等）：小图裁剪填满
  detailSecondary: {
    "9:16": { containerClass: "h-20 aspect-[9/16]", mediaClass: "h-full w-full object-cover" },
    "16:9": { containerClass: "h-20 w-36", mediaClass: "h-full w-full object-cover" },
    "1:1": { containerClass: "h-20 w-20", mediaClass: "h-full w-full object-cover" },
  },
};
```

- [x] **Step 4: 跑测试确认通过**

Run: `npm run test -- tests/lib/mediaLayout.test.ts`
Expected: PASS（12 个用例）

- [x] **Step 5: 全量验证**

Run: `npx tsc --noEmit && git diff --check && npm run test && npm run build`
Expected: 全绿（46 文件 / 542 用例）

- [x] **Step 6: 提交**

```bash
git add src/lib/mediaLayout.ts tests/lib/mediaLayout.test.ts
git commit -m "feat(layout): 新增 mediaLayout 纯口径，把画幅与版式尺寸收成一处"
```

---

### Task 3: 三页与卡片接入真实画幅版式，并放开页面容器

**Files:**
- Modify: `src/features/wizard/StepImages.tsx:62`（容器）、`:157`（主图）
- Modify: `src/features/wizard/StepVideos.tsx:78`（容器）、`:184`、`:195`、`:199`、`:218`（媒体行）
- Modify: `src/features/wizard/StepStoryboard.tsx:199`（容器）
- Modify: `src/features/wizard/ShotCard.tsx:72`（头行缩略图）
- Modify: `src/features/wizard/DualFrameToggle.tsx`（尾帧预览与候选帧条）

**Interfaces:**
- Consumes: Task 2 的 `resolveAspect` / `MEDIA_FRAME` / `ASPECT_RATIO_CSS`
- Produces: 三页的根容器类串统一为 `SHELL_CONTAINER_CLASS`（Task 4 之后由 `StepHeader`/`WizardShell` 复用）；页面开始读 `project.aspectRatio`

- [x] **Step 1: 在 `src/lib/mediaLayout.ts` 追加容器与占位常量（本任务唯一新增实现）**

```ts
/** 步骤页根容器：统一水平内边距与最大宽（1920 基准，随根字号缩放） */
export const SHELL_CONTAINER_CLASS = "mx-auto flex w-full max-w-[90rem] flex-col gap-4 px-4 py-4";

/** 缺图 / 等待中的占位框：与真实媒体同比例，不再用固定 6rem 横条；底色走语义 token */
export function placeholderClass(aspect: AspectRatio): string {
  const ratio = ASPECT_RATIO_CSS[aspect];
  return `flex items-center justify-center rounded-md border border-dashed ${ratio} bg-raised/40 text-ink-4`;
}
```

- [x] **Step 2: 图片页接入**

`StepImages.tsx` 顶部加导入：

```ts
import { MEDIA_FRAME, SHELL_CONTAINER_CLASS, resolveAspect } from "@/lib/mediaLayout";
```

在组件内、已经能拿到 `project` 的位置（`StepImages.tsx:20-28` 附近读 store 处）加一行：

```ts
  const aspect = resolveAspect(project?.aspectRatio);
```

根容器（:62）：`<div className="mx-auto flex max-w-4xl flex-col gap-4 py-4">` → `<div className={SHELL_CONTAINER_CLASS}>`

主图（:157 附近，`Lightbox` 包裹的 `img`）：把 `img` 与其外层包裹 div 的类串换成取自映射 —— 原 `className="w-full object-contain max-h-48"` 改为：

```tsx
  <div className={`${MEDIA_FRAME.detailPrimary[aspect].containerClass} overflow-hidden rounded-md border border-line`}>
    <img
      src={shot.imageUrl}
      alt={t("wizard.step4")}
      loading="lazy"
      className={MEDIA_FRAME.detailPrimary[aspect].mediaClass}
    />
  </div>
```

- [x] **Step 3: 视频页接入**

`StepVideos.tsx` 同样加 `import { MEDIA_FRAME, SHELL_CONTAINER_CLASS, placeholderClass, resolveAspect } from "@/lib/mediaLayout";`、`const aspect = resolveAspect(project?.aspectRatio);`、根容器改 `SHELL_CONTAINER_CLASS`。

四处媒体类串（`w-1/3 … h-24 object-cover` 参考图、`w-full h-24 object-contain bg-black` 播放器、两个 `h-24` 占位框）改为：

- 参考图块 → `${MEDIA_FRAME.detailSecondary[aspect].containerClass} shrink-0 overflow-hidden rounded-md border border-line`，其 `img` → `MEDIA_FRAME.detailSecondary[aspect].mediaClass`
- `<video>` 外层 → `${MEDIA_FRAME.detailPrimary[aspect].containerClass} overflow-hidden rounded-md bg-surface`，`video` 自身 → `${MEDIA_FRAME.detailPrimary[aspect].mediaClass} bg-app`
  （**`bg-black` 是原始色字面量，必须去掉**：深色靠 `bg-app` / `bg-surface` 表达，浅色主题下不再一片死黑）
- 两个占位框 → `${placeholderClass(aspect)} flex-1`，保留各自原有的 `border-warn` / `border-line` 与 tint 类，只替换 `h-24` 与形状

- [x] **Step 4: 分镜页容器 + 卡片缩略图 + 尾帧预览**

`StepStoryboard.tsx:199` 根容器 → `SHELL_CONTAINER_CLASS`（其空态 `max-w-2xl` 分支保持不动）。

`ShotCard.tsx:72` 的 `h-8 w-8 object-cover` → 传入画幅：给 `ShotCardProps` 加一个可选 `aspect?: AspectRatio`（默认 `"16:9"`，**不破坏现有调用点**），头行缩略图改：

```ts
  <div className={`${MEDIA_FRAME.railThumb[resolveAspect(aspect)].containerClass} h-8 overflow-hidden rounded-sm border border-line-soft`}>
    <img src={shot.imageUrl} alt="" className={MEDIA_FRAME.railThumb[resolveAspect(aspect)].mediaClass} />
  </div>
```

`DualFrameToggle.tsx` 的候选帧条（`h-12 w-20`）与尾帧预览（`w-20 h-14`）→ 用 `MEDIA_FRAME.detailSecondary[resolveAspect(project?.aspectRatio)]`（该组件已接收 `shot`，画幅从 `useProjectStore` 里取当前活动项目；只读不改写）。

- [x] **Step 5: 确认同类入口无遗漏（本仓库铁律：修一个入口必须搜同类）**

Run: `grep -rn "max-h-48\|h-24\|w-8 h-8\|bg-black" src/features src/components | grep -v "Lightbox.tsx"`
Expected: 只剩确实与画幅无关的命中（如 Lightbox 内部的缩放按钮）；把残留逐条判断并在交付说明里写明"为什么不改"

- [x] **Step 6: 全量验证**

Run: `npx tsc --noEmit && git diff --check && npm run test && npm run build`
Expected: 全绿（46 文件 / 542 用例；本任务不加测试 —— 纯 JSX 搬运，见 Global Constraints「组件渲染不可测」）

- [x] **Step 7: 用户目测项**

用同一个 9:16 项目对比改造前后：① 图片页主图不再两侧留白、按竖屏比例显示；② 视频页播放器不再是 6rem 扁条；③ 切到 16:9 项目时同一处版式真的变了。

- [x] **Step 8: 提交**

```bash
git add src/lib/mediaLayout.ts src/features/wizard/StepImages.tsx src/features/wizard/StepVideos.tsx \
  src/features/wizard/StepStoryboard.tsx src/features/wizard/ShotCard.tsx src/features/wizard/DualFrameToggle.tsx
git commit -m "feat(layout): 三页与卡片按真实画幅排版媒体，页面容器不再锁 max-w-4xl"
```

---

## Phase P1 —— 共享件抽取（外观基本不变，先把重复收敛成一处）

> **本期每个 commit 的硬检查**：`git diff` 里**不得出现**新增或修改的回调体、store action 调用、请求构造。只允许搬 markup / props / 类串。发现必须改行为才能收敛时，**停下来报告**，不要顺手改。

### Task 4: 统一提示/错误框与步骤完成度条

**背景**：同一视觉的提示/错误块在四处各写一遍（`StepStoryboard.tsx:182-186`、`:229-233`、`ShotCard.tsx:113-117`、`AssetEditorTemplate.tsx:378-398`）；步骤级完成度条两处同结构却一个 `bg-accent-solid` 一个 `bg-warn-solid`，**分镜页根本没有进度条**。同一语义两种颜色 = 用户读成两件不同的事。

**Files:**
- Create: `src/features/wizard/WizardMessages.tsx`
- Create: `src/features/wizard/StepProgressBar.tsx`
- Modify: `src/features/wizard/StepImages.tsx:132-140`
- Modify: `src/features/wizard/StepVideos.tsx:151-159`
- Modify: `src/features/wizard/StepStoryboard.tsx:182-186,229-233` + 列表态新增进度条
- Modify: `src/features/wizard/ShotCard.tsx:113-117`

**Interfaces:**
- Consumes: 无新依赖
- Produces:
  - `WizardMessages(props: { notice?: string | null; error?: string | null })`
  - `StepProgressBar(props: { done: number; total: number })`

- [x] **Step 1: 写两个共享件**

```tsx
// src/features/wizard/WizardMessages.tsx
// 向导页统一的提示 / 错误块：四个页面此前各写一遍近似 markup，
// 导致同一语义在不同步骤下颜色与内距不一致。纯展示，无副作用。
import { AlertCircle, Info } from "lucide-react";

interface WizardMessagesProps {
  notice?: string | null;
  error?: string | null;
}

export function WizardMessages({ notice, error }: WizardMessagesProps) {
  if (!notice && !error) return null;
  return (
    <div className="flex flex-col gap-2">
      {notice ? (
        <p className="flex items-start gap-2 rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-xs text-ink-2">
          <Info size={14} className="mt-0.5 shrink-0 text-info" />
          <span>{notice}</span>
        </p>
      ) : null}
      {error ? (
        <p className="flex items-start gap-2 rounded-lg border border-danger/50 bg-danger-deep/30 px-3 py-2 text-xs text-danger">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span className="break-words">{error}</span>
        </p>
      ) : null}
    </div>
  );
}
```

```tsx
// src/features/wizard/StepProgressBar.tsx
// 步骤级完成度条。颜色语义固定为 accent：这里表达「本步完成度」，
// 不是「正在跑」—— 镜头级"生成中"的警示色留给卡内的 videoProgress。
// 历史上图片步用 accent、视频步用 warn 表示同一件事，用户读成两件事。
interface StepProgressBarProps {
  done: number;
  total: number;
}

export function StepProgressBar({ done, total }: StepProgressBarProps) {
  if (total <= 0) return null;
  const pct = Math.min(100, Math.round((done / total) * 100));
  return (
    <div
      className="h-1 w-full overflow-hidden rounded-full bg-raised"
      role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
    >
      <div
        className="h-full rounded-full bg-accent-solid transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
```

- [x] **Step 2: 替换两处进度条与四处错误框**

- `StepImages.tsx:132-140` 整段 → `<StepProgressBar done={imagedCount} total={shots.length} />`
- `StepVideos.tsx:151-159` 整段 → `<StepProgressBar done={videoedCount} total={shots.length} />`
- `StepStoryboard.tsx` 两处错误框 → `<WizardMessages error={project?.error} />`（**传值表达式与原条件保持等价**，只换 markup）
- `ShotCard.tsx:113-117` → `<WizardMessages error={shot.error} />`
- `AssetEditorMessages`（`AssetEditorTemplate.tsx:378-398`）**本任务不动**：资产编辑有 notice 语义，等 Task 15 统一评估后再合

- [x] **Step 3: 分镜页补上进度条**

`StepStoryboard.tsx` 列表态页头之后插入：

```tsx
  <StepProgressBar done={shots.filter((s) => s.scriptText.trim()).length} total={shots.length} />
```

该谓词与 `CreationWizard.tsx:53` 的 `canAdvance` 步骤 3 判定同源 —— **不得另发明一套"完成"定义**。

- [x] **Step 4: 全量验证 + 行为不变自查**

Run:
```bash
npx tsc --noEmit && git diff --check && npm run test && npm run build
git diff -- src/features/wizard | grep -E "^[+-].*(updateShot|setProjectStatus|generateImages|generateVideos|await |onClick=)" || echo "OK：无行为改动"
```
Expected: 四项全绿；第二条输出 `OK：无行为改动` 或仅出现成对的 markup 搬运（逐条核对后在交付说明里写明）

- [x] **Step 5: 提交**

```bash
git add src/features/wizard/WizardMessages.tsx src/features/wizard/StepProgressBar.tsx \
  src/features/wizard/StepImages.tsx src/features/wizard/StepVideos.tsx \
  src/features/wizard/StepStoryboard.tsx src/features/wizard/ShotCard.tsx
git commit -m "refactor(wizard): 统一提示错误框与步骤完成度条，分镜页补上缺失的进度"
```

---

### Task 5: 统一页头（标题 + 计数 + 动作槽），顺带修一个文案错位

**背景**：图片页与视频页各写了一份约 50 行的"标题 + 生成中计数 + 重试失败/待补做 + 全部重摇"（`StepImages.tsx:63-116`、`StepVideos.tsx:79-139`），分镜页是第三种形态（`:201-213` 只有一个按钮）。另外分镜页标题用的是 **`wizard.step2`（"资产"）** 这个键 —— 页面显示"资产"，语义直接错位。

**Files:**
- Create: `src/features/wizard/StepHeader.tsx`
- Modify: `src/features/wizard/StepImages.tsx:63-116`、`StepVideos.tsx:79-139`、`StepStoryboard.tsx:201-213`

**Interfaces Produces:** `StepHeader(props: { titleKey: TranslationKey; done?: number; total?: number; actions?: ReactNode })`

- [x] **Step 1: 写组件**

```tsx
// src/features/wizard/StepHeader.tsx
// 向导步骤页页头：标题 + 完成计数 + 右侧动作槽。三页此前各写一遍，
// 字号 / 间距 / 按钮排布都不一致，分镜页还误用了「资产」的标题键。
import type { ReactNode } from "react";
import { useT, type TranslationKey } from "@/i18n";

interface StepHeaderProps {
  titleKey: TranslationKey;
  done?: number;
  total?: number;
  actions?: ReactNode;
}

export function StepHeader({ titleKey, done, total, actions }: StepHeaderProps) {
  const t = useT();
  const showCounter = typeof done === "number" && typeof total === "number" && total > 0;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <h2 className="text-sm font-bold text-ink">
        {t(titleKey)}
        {showCounter ? <span className="ml-1 font-normal text-ink-4">({done}/{total})</span> : null}
      </h2>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
```

- [x] **Step 2: 三页接入**

`StepImages.tsx`：删掉 `:64-66` 的 `<h2>`，改为

```tsx
  <StepHeader
    titleKey="wizard.step4"
    done={imagedCount}
    total={shots.length}
    actions={<>
      {/* 原 :68-115 的三个条件元素逐字搬入：不改 onClick、禁用条件、i18n 键与颜色类 */}
    </>}
  />
```

`StepVideos.tsx`：同法，`titleKey="wizard.step5"`、`done={videoedCount}`；`:84-95` 两个计数 span 与 `:96-137` 两个按钮搬进 `actions`；`:141-149` 的成本估算行**留在页头之外**（它是信息块不是动作）。

`StepStoryboard.tsx`：`:202-204` 的 `t("wizard.step2")` → `titleKey="wizard.step3"`（**这就是文案错位的修复**，键已存在于 `i18n` 的 `wizard.step3`）；重摇按钮搬进 `actions`。

- [x] **Step 3: 验证**

```bash
npx tsc --noEmit && git diff --check && npm run test && npm run build
git diff -- src/features/wizard | grep -E "^[+-].*(onClick|confirmDialog|updateShot|generate)" || echo "OK：仅搬运"
```
Expected: 全绿；第二条只有成对的移动

- [x] **Step 4: 用户目测项**：三页页头字号与按钮排布是否一致；分镜页标题是否已从"资产"变成"分镜"。

- [x] **Step 5: 提交**

```bash
git add src/features/wizard/StepHeader.tsx src/features/wizard/StepImages.tsx \
  src/features/wizard/StepVideos.tsx src/features/wizard/StepStoryboard.tsx
git commit -m "refactor(wizard): 统一三页页头并修正分镜页误用的资产标题键"
```

---

### Task 6: 审核卡点收敛为唯一实现（**不改门禁语义**）

**背景**：`ReviewCheckpoint` 只有图片页在用（`StepImages.tsx:167-179`）；分镜页与资产页各内联手写一块同视觉卡点（`StepStoryboard.tsx:236-255`、`StepAssets.tsx:462-478`）；**视频页既无卡点也无完成 CTA**，只有 `:232-236` 一行"✓ 全部就绪" + 4 秒 toast。分镜内联块的禁用条件（脚本与 visualPrompt 齐备）在现有组件里没有对应入参，所以必须加一个可选 prop 才能收敛。

**Files:**
- Modify: `src/features/wizard/ReviewCheckpoint.tsx:11-25`（加入参）
- Modify: `src/features/wizard/StepStoryboard.tsx:236-255`、`src/features/wizard/StepAssets.tsx:462-478`
- Modify: `src/features/wizard/StepVideos.tsx:232-236`（只加完成 CTA）
- Modify: `src/i18n/index.ts`

**Interfaces:**
- Consumes: 现有 `ReviewCheckpointProps { mode: AutomationMode; onConfirm: () => void; failedShots?: FailedShotInfo[]; onRetryFailed?: () => void }`；`mode === "auto"` 返回 `null` 的行为**保持不变**
- Produces: 上述 props 追加 `hintKey: TranslationKey; confirmLabelKey: TranslationKey; titleKey?: TranslationKey; confirmDisabled?: boolean`

- [x] **Step 1: 给组件加可选入参（图片页现有调用点不改也能编译）**

`ReviewCheckpointProps` 追加：

```ts
  /** 三页原本各写一份中文：标题 / 提示 / 确认按钮的文案键 */
  titleKey?: TranslationKey;
  hintKey: TranslationKey;
  confirmLabelKey: TranslationKey;
  /** 自定义禁用条件：分镜要的是"脚本与画面提示词齐备"，与图片步的 allSettled 不同 */
  confirmDisabled?: boolean;
```

组件内：写死的 `review.qualityCheck` → `t(titleKey ?? "review.qualityCheck")`；`review.hint` → `t(hintKey)`；`review.confirmImages` → `t(confirmLabelKey)`；确认按钮 `disabled` → `disabled={confirmDisabled ?? false}`（图片页未传 → 行为与今天完全一致）。

- [x] **Step 2: 分镜页与资产页换组件**

`StepStoryboard.tsx:236-255` 整块 →

```tsx
  <ReviewCheckpoint
    mode={project?.automationMode ?? "semi-auto"}
    hintKey="wizard.storyboardConfirmHint"
    confirmLabelKey="wizard.confirmStoryboard"
    confirmDisabled={!allShotsHaveScript || !allShotsHaveVisualPrompt}
    onConfirm={() => {
      /* 原 onConfirm 体逐字搬来：只写 storyboardReviewed，不加任何新副作用 */
    }}
  />
```

`StepAssets.tsx:462-478` 同法（`hintKey="review.assetsHint"`、`confirmLabelKey="review.confirmAssets"`）。

- [x] **Step 3: 视频页只加完成 CTA，不引入新审核位**

> **按钮类串不要新造**：直接复用 `CreationWizard.tsx:113-122`「下一步」按钮已有的那组类（`bg-success-solid` + 其前景色与 hover 类逐字照抄），以保证同一语义的颜色全站一致，并避免引入 `text-white` 这类原始色类。

`StepVideos.tsx:232-236` 的纯文本块 →

```tsx
  {allVideoed && (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-success/40 bg-success-deep/30 px-4 py-3">
      <span className="text-xs text-ink-2">✓ {t("wizard.allReady")}</span>
      <button
        type="button"
        onClick={() => setWizardStep(6)}
        className="rounded-md bg-success-solid px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
      >
        {t("wizard.goAssembly")}
      </button>
    </div>
  )}
```

需要从 store 取现成的 `setWizardStep`（`useProjectStore((s) => s.setWizardStep)`）。**禁止**新增 `videosReviewed` 位或改 `canAdvance` 步骤 5 的判定 —— 那是产品可见的门禁收紧，本计划不做。

- [x] **Step 4: i18n 双写**

zh 段加 `"wizard.goAssembly": "去后期合成",`，en 段同位置加 `"wizard.goAssembly": "Go to assembly",`。同时确认 `wizard.storyboardConfirmHint` 已存在（`StepStoryboard.tsx` 内联块在用）；若不存在则按同样方式补齐 —— **不得在 JSX 里留硬编码中文**。

- [x] **Step 5: 验证（重点：门禁一个字符都没动）**

```bash
npx tsc --noEmit && git diff --check && npm run test && npm run build
git diff -- src/features/wizard/CreationWizard.tsx
```
Expected: 全绿；第二条**必须为空**（`canAdvance` 未被触碰）
用户目测项：半自动下分镜/资产的卡点文案与禁用条件与改造前一致；视频页出现"去后期合成"且步骤 5 的推进条件没变严。

- [x] **Step 6: 提交**

```bash
git add src/features/wizard/ReviewCheckpoint.tsx src/features/wizard/StepStoryboard.tsx \
  src/features/wizard/StepAssets.tsx src/features/wizard/StepVideos.tsx src/i18n/index.ts
git commit -m "refactor(wizard): 审核卡点收敛为唯一实现，视频页补完成 CTA（不改门禁判定）"
```

---

## Phase P2 —— 双栏骨架（结构变化最大的一期）

### Task 7: 轨选中与键盘导航纯逻辑 `railSelection.ts`

**Files:** Create `src/lib/railSelection.ts`；Test `tests/lib/railSelection.test.ts`

**Interfaces Produces:**
- `function moveSelection(ids: readonly string[], currentId: string | undefined, delta: 1 | -1): string | undefined`
- `function syncSelectionWithShots(ids: readonly string[], currentId: string | undefined): string | undefined`

- [x] **Step 1: 写失败测试**

```ts
// tests/lib/railSelection.test.ts
// ────────────────────────────────────────────────────────────────────────────
// 镜头轨选中态的唯一纯逻辑（本仓库不渲染组件，故把可判定部分全放这里）。
// 断言来自 src/lib/railSelection.ts 真实实现。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { moveSelection, syncSelectionWithShots } from "@/lib/railSelection";

describe("moveSelection", () => {
  it("两端夹住不环绕（环绕会让用户失去方位感）", () => {
    const ids = ["a", "b", "c"];
    expect(moveSelection(ids, "a", 1)).toBe("b");
    expect(moveSelection(ids, "c", 1)).toBe("c");
    expect(moveSelection(ids, "c", -1)).toBe("b");
    expect(moveSelection(ids, "a", -1)).toBe("a");
  });

  it("未选中 / 选中项已消失时落到首镜", () => {
    expect(moveSelection(["a", "b"], undefined, 1)).toBe("a");
    expect(moveSelection(["a", "b"], "gone", -1)).toBe("a");
  });

  it("空集合返回 undefined，不抛错", () => {
    expect(moveSelection([], undefined, 1)).toBeUndefined();
    expect(moveSelection([], "a", 1)).toBeUndefined();
  });
});

describe("syncSelectionWithShots", () => {
  it("选中项仍在集合内则保持；已消失则回到首镜，不留悬空选中", () => {
    expect(syncSelectionWithShots(["a", "b"], "b")).toBe("b");
    expect(syncSelectionWithShots(["a", "b"], "gone")).toBe("a");
    expect(syncSelectionWithShots([], "a")).toBeUndefined();
  });
});
```

- [x] **Step 2: 跑测试确认失败** Run: `npm run test -- tests/lib/railSelection.test.ts` Expected: FAIL（模块不存在）

- [x] **Step 3: 实现**

```ts
// ────────────────────────────────────────────────────────────────────────────
// src/lib/railSelection.ts
// 镜头轨选中态纯逻辑：页面只持有 currentId，移动规则集中在此以便单测。
// ────────────────────────────────────────────────────────────────────────────

export function moveSelection(
  ids: readonly string[],
  currentId: string | undefined,
  delta: 1 | -1,
): string | undefined {
  const first = ids[0];
  if (first === undefined) return undefined;
  const at = currentId === undefined ? -1 : ids.indexOf(currentId);
  if (at < 0) return first;
  const next = Math.min(ids.length - 1, Math.max(0, at + delta));
  return ids[next];
}

/** 镜头增删后校正选中项，避免详情区指向已不存在的镜头 */
export function syncSelectionWithShots(
  ids: readonly string[],
  currentId: string | undefined,
): string | undefined {
  if (currentId && ids.includes(currentId)) return currentId;
  return ids[0];
}
```

- [x] **Step 4: 跑测试确认通过** Expected: PASS（4 个用例）
- [x] **Step 5: 全量验证 + 提交**

```bash
npx tsc --noEmit && git diff --check && npm run test && npm run build
git add src/lib/railSelection.ts tests/lib/railSelection.test.ts
git commit -m "feat(layout): 新增镜头轨选中与键盘导航纯逻辑"
```

---

### Task 8: 景别展示映射 `shotDisplay.ts`（含 i18n 双字典）

**背景**：本轮刚加的机读景别 `Shot.shotSize` 在界面上**完全隐形**（无任何 `.tsx` 读它）。看不见景别，用户就无法理解"为什么这两镜没衔接上"。

**Files:** Create `src/lib/shotDisplay.ts`；Test `tests/lib/shotDisplay.test.ts`；Modify `src/i18n/index.ts`

**Interfaces Produces:**
- `const SHOT_SIZE_LABEL_KEYS: Record<ShotSize, TranslationKey>`
- `function shotSizeLabelKey(size: ShotSize | undefined): TranslationKey`

- [x] **Step 1: 写失败测试**

```ts
// tests/lib/shotDisplay.test.ts
// ────────────────────────────────────────────────────────────────────────────
// 景别标签的唯一映射：五档必须与 lib/shotSize 枚举一一对应，
// 缺值给独立的"未知"键 —— 否则"模型没给景别"会被显示成某一真实档位。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { SHOT_SIZES } from "@/lib/shotSize";
import { SHOT_SIZE_LABEL_KEYS, shotSizeLabelKey } from "@/lib/shotDisplay";
import { zh, en } from "@/i18n";

const DICTS = { zh, en } as const;

describe("shotSizeLabelKey", () => {
  it("五档枚举全部有键，且与 SHOT_SIZES 一一对应（不得自造档位）", () => {
    expect(Object.keys(SHOT_SIZE_LABEL_KEYS).sort()).toEqual([...SHOT_SIZES].sort());
    for (const size of SHOT_SIZES) {
      expect(shotSizeLabelKey(size)).toBe(SHOT_SIZE_LABEL_KEYS[size]);
    }
  });

  it("未知景别落到独立键，不借用任何一档", () => {
    const known = new Set<string>(Object.values(SHOT_SIZE_LABEL_KEYS));
    const unknownKey = shotSizeLabelKey(undefined);
    expect(known.has(unknownKey)).toBe(false);
    expect(unknownKey).toBe("shotSize.unknown");
  });

  it("六个键在 zh / en 两个字典里都存在且非空（en 缺键会编译不过，这里锁住语义）", () => {
    for (const key of [...Object.values(SHOT_SIZE_LABEL_KEYS), "shotSize.unknown"] as string[]) {
      for (const lang of ["zh", "en"] as const) {
        expect((DICTS[lang] as Record<string, string>)[key], `${lang} 缺键 ${key}`).toBeTruthy();
      }
    }
  });
});
```

- [x] **Step 2: 跑测试确认失败** Expected: FAIL（`shotDisplay` 不存在；且 `zh` / `en` 当前**未被导出**，会先报 import 错 —— 属预期红）

- [x] **Step 3: 导出字典 + 实现 + 补键**

`src/i18n/index.ts`：给 `const zh = { ... } as const;` 与 `const en: Record<TranslationKey, string> = { ... };`（以实际写法为准）**加 `export` 修饰**，不改内容。

zh 段追加、en 段同位置追加：

```ts
// zh
"shotSize.extremeWide": "极远",
"shotSize.wide": "远",
"shotSize.medium": "中",
"shotSize.close": "近",
"shotSize.closeUp": "特",
"shotSize.unknown": "景别未知",
// en
"shotSize.extremeWide": "Extreme wide",
"shotSize.wide": "Wide",
"shotSize.medium": "Medium",
"shotSize.close": "Close",
"shotSize.closeUp": "Close-up",
"shotSize.unknown": "Shot size unknown",
```

```ts
// src/lib/shotDisplay.ts
// 镜头轨与详情区的展示映射：景别 → 文案键。
// 未知一律给独立键，不借用真实档位。

import type { ShotSize } from "@/lib/shotSize";
import type { TranslationKey } from "@/i18n";

export const SHOT_SIZE_LABEL_KEYS: Record<ShotSize, TranslationKey> = {
  "extreme-wide": "shotSize.extremeWide",
  wide: "shotSize.wide",
  medium: "shotSize.medium",
  close: "shotSize.close",
  "close-up": "shotSize.closeUp",
};

export function shotSizeLabelKey(size: ShotSize | undefined): TranslationKey {
  return size ? SHOT_SIZE_LABEL_KEYS[size] : "shotSize.unknown";
}
```

- [x] **Step 4: 跑测试确认通过** Expected: PASS（3 个用例）
- [x] **Step 5: 全量验证 + 提交**

```bash
npx tsc --noEmit && git diff --check && npm run test && npm run build
git add src/lib/shotDisplay.ts tests/lib/shotDisplay.test.ts src/i18n/index.ts
git commit -m "feat(layout): 景别五档与未知态的展示映射，导出字典以供回归断言"
```

---

### Task 9: 首帧来源解释器 `firstFrameSource.ts`

**背景**：衔接判定、末帧缺失、景别跨档降级全都在 `useVideoActions` 发请求那一刻算一次，**界面零可见**。用户看到接缝不好，却没有任何线索知道"这镜根本没接、因为景别跨了两档"。

**Files:** Create `src/lib/firstFrameSource.ts`；Test `tests/lib/firstFrameSource.test.ts`；Modify `src/i18n/index.ts`

**Interfaces:**
- Consumes: `planShotContinuity` / `buildHandoffMap` / `type ShotForContinuity` / `type ContinuitySkipReason`（`@/lib/shotContinuity`）、`type VideoConsistency`（`@/lib/videoPlan`）
- Produces:
  - `type FirstFrameSource = { kind: "manual-tail" } | { kind: "handoff"; fromShotId: string } | { kind: "self"; because: "consistency-off" | "tail-missing" | ContinuitySkipReason }`
  - `function describeFirstFrameSource(input: { shotId: string; shots: readonly ShotForContinuity[]; useDualFrame: boolean; lastFrameUrl?: string; consistency: VideoConsistency; tailFrames: Record<string, string> }): FirstFrameSource`
  - `function firstFrameSourceKey(src: FirstFrameSource): TranslationKey`

- [x] **Step 1: 写失败测试**

```ts
// tests/lib/firstFrameSource.test.ts
// ────────────────────────────────────────────────────────────────────────────
// 「本镜首帧从哪来、为什么没衔接」的唯一解释器。
// 断言来自 src/lib/firstFrameSource.ts 与 shotContinuity 的真实判定顺序 ——
// 界面解释与请求素材必须同源，否则会各说各话。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import type { ShotForContinuity } from "@/lib/shotContinuity";
import { describeFirstFrameSource, firstFrameSourceKey } from "@/lib/firstFrameSource";

const shotOf = (over: Partial<ShotForContinuity> & { id: string; index: number }): ShotForContinuity => ({
  imageUrl: `https://cdn.test/${over.id}.png`,
  activeSceneId: "scene_1",
  activeCharacterIds: ["c1"],
  shotSize: "medium",
  ...over,
});

const INPUT = (over: Partial<Parameters<typeof describeFirstFrameSource>[0]> = {}) => ({
  shotId: "s1",
  shots: [shotOf({ id: "s0", index: 0 }), shotOf({ id: "s1", index: 1 })],
  useDualFrame: false,
  lastFrameUrl: undefined,
  consistency: "chain" as const,
  tailFrames: { s0: "blob:tail-s0" },
  ...over,
});

describe("describeFirstFrameSource", () => {
  it("手动双帧优先（用户指定了尾帧，自动衔接让位）", () => {
    expect(describeFirstFrameSource(INPUT({ useDualFrame: true, lastFrameUrl: "https://cdn.test/t.png" })))
      .toEqual({ kind: "manual-tail" });
  });

  it("衔接成立且末帧就绪 → 取前镜末帧，并指出来自哪一镜", () => {
    expect(describeFirstFrameSource(INPUT())).toEqual({ kind: "handoff", fromShotId: "s0" });
  });

  it("consistency=off 时明确降级原因，不静默", () => {
    expect(describeFirstFrameSource(INPUT({ consistency: "off" })))
      .toEqual({ kind: "self", because: "consistency-off" });
  });

  it("判定可衔接但末帧没抽到（刷新后内存丢失）→ tail-missing", () => {
    expect(describeFirstFrameSource(INPUT({ tailFrames: {} })))
      .toEqual({ kind: "self", because: "tail-missing" });
  });

  it("景别跨两档 → 透出 shotContinuity 的真实原因 size-gap", () => {
    expect(describeFirstFrameSource(INPUT({
      shots: [shotOf({ id: "s0", index: 0, shotSize: "wide" }), shotOf({ id: "s1", index: 1, shotSize: "close-up" })],
    }))).toEqual({ kind: "self", because: "size-gap" });
  });

  it("换场景 / 演员不相交 / 前镜无图 / 首镜 四种原因互不被抹平", () => {
    const scene = describeFirstFrameSource(INPUT({
      shots: [shotOf({ id: "s0", index: 0, activeSceneId: "scene_9" }), shotOf({ id: "s1", index: 1 })],
    }));
    const cast = describeFirstFrameSource(INPUT({
      shots: [shotOf({ id: "s0", index: 0, activeCharacterIds: ["x"] }), shotOf({ id: "s1", index: 1, activeCharacterIds: ["y"] })],
    }));
    const noImg = describeFirstFrameSource(INPUT({
      shots: [shotOf({ id: "s0", index: 0, imageUrl: undefined }), shotOf({ id: "s1", index: 1 })],
    }));
    const first = describeFirstFrameSource(INPUT({ shotId: "s0" }));
    expect([scene, cast, noImg, first]).toEqual([
      { kind: "self", because: "scene-changed" },
      { kind: "self", because: "cast-disjoint" },
      { kind: "self", because: "no-first-frame" },
      { kind: "self", because: "last-shot" },
    ]);
  });

  it("每个 kind / because 都有独立文案键（不允许出现未翻译的内部枚举）", () => {
    const cases: Array<ReturnType<typeof describeFirstFrameSource>> = [
      { kind: "manual-tail" },
      { kind: "handoff", fromShotId: "s0" },
      { kind: "self", because: "consistency-off" },
      { kind: "self", because: "tail-missing" },
      { kind: "self", because: "size-gap" },
      { kind: "self", because: "scene-changed" },
      { kind: "self", because: "cast-disjoint" },
      { kind: "self", because: "no-first-frame" },
      { kind: "self", because: "scene-unknown" },
      { kind: "self", because: "size-unknown" },
      { kind: "self", because: "last-shot" },
    ];
    const keys = cases.map(firstFrameSourceKey);
    for (const key of keys) expect(key).toMatch(/^videoPlan\.firstFrame\./);
    // 十一种情形必须落到不同文案，否则"没衔接"会被统一说成一句话
    expect(new Set(keys).size).toBe(cases.length);
  });
});
```

- [x] **Step 2: 跑测试确认失败** Expected: FAIL（模块不存在）

- [x] **Step 3: 实现 + 补 11 个文案键**

```ts
// ────────────────────────────────────────────────────────────────────────────
// src/lib/firstFrameSource.ts
// 「本镜首帧从哪来、为什么没衔接」的唯一解释器（纯函数，不写 store）。
// 与 videoPlan 的素材决策同源：都走 shotContinuity 的同一套闸门，
// 因此界面解释与实际请求素材不会各说各话。
// ────────────────────────────────────────────────────────────────────────────

import {
  buildHandoffMap,
  planShotContinuity,
  type ContinuitySkipReason,
  type ShotForContinuity,
} from "@/lib/shotContinuity";
import type { VideoConsistency } from "@/lib/videoPlan";
import type { TranslationKey } from "@/i18n";

export type FirstFrameSource =
  | { kind: "manual-tail" }
  | { kind: "handoff"; fromShotId: string }
  | { kind: "self"; because: "consistency-off" | "tail-missing" | ContinuitySkipReason };

export function describeFirstFrameSource(input: {
  shotId: string;
  shots: readonly ShotForContinuity[];
  useDualFrame: boolean;
  lastFrameUrl?: string;
  consistency: VideoConsistency;
  tailFrames: Record<string, string>;
}): FirstFrameSource {
  const { shotId, shots, useDualFrame, lastFrameUrl, consistency, tailFrames } = input;
  if (useDualFrame && lastFrameUrl) return { kind: "manual-tail" };
  if (consistency === "off") return { kind: "self", because: "consistency-off" };

  const decisions = planShotContinuity(shots);
  const handoff = buildHandoffMap(decisions).get(shotId);
  if (handoff) {
    return tailFrames[handoff]
      ? { kind: "handoff", fromShotId: handoff }
      : { kind: "self", because: "tail-missing" };
  }
  const own = decisions.find((d) => d.shotId === shotId);
  if (!own || own.linked) return { kind: "self", because: "last-shot" };
  return { kind: "self", because: own.reason };
}

const FALLBACK: TranslationKey = "videoPlan.firstFrame.self";

const BECAUSE_KEYS: Record<string, TranslationKey> = {
  "consistency-off": "videoPlan.firstFrame.off",
  "tail-missing": "videoPlan.firstFrame.tailMissing",
  "last-shot": "videoPlan.firstFrame.firstShot",
  "no-first-frame": "videoPlan.firstFrame.prevNoImage",
  "scene-unknown": "videoPlan.firstFrame.sceneUnknown",
  "scene-changed": "videoPlan.firstFrame.sceneChanged",
  "cast-disjoint": "videoPlan.firstFrame.castDisjoint",
  "size-unknown": "videoPlan.firstFrame.sizeUnknown",
  "size-gap": "videoPlan.firstFrame.sizeGap",
};

export function firstFrameSourceKey(src: FirstFrameSource): TranslationKey {
  if (src.kind === "handoff") return "videoPlan.firstFrame.handoff";
  if (src.kind === "manual-tail") return "videoPlan.firstFrame.manualTail";
  return BECAUSE_KEYS[src.because] ?? FALLBACK;
}
```

`src/i18n/index.ts` 新增（zh 与 en 同步，**每条 `{index}` 只出现一次**，因为 `getTranslation` 是单次替换）：

```ts
// zh
"videoPlan.firstFrame.manualTail": "首尾帧由你手动指定",
"videoPlan.firstFrame.handoff": "首帧取第 {index} 镜的末帧",
"videoPlan.firstFrame.self": "首帧用本镜画面图",
"videoPlan.firstFrame.off": "首帧用本镜画面图（视频一致性已关闭）",
"videoPlan.firstFrame.tailMissing": "首帧用本镜画面图（前镜末帧尚未抽到，刷新后会丢失）",
"videoPlan.firstFrame.firstShot": "首帧用本镜画面图（这是第一镜）",
"videoPlan.firstFrame.prevNoImage": "首帧用本镜画面图（前镜没有画面图）",
"videoPlan.firstFrame.sceneUnknown": "首帧用本镜画面图（未标主场景，无法判断是否同场景）",
"videoPlan.firstFrame.sceneChanged": "首帧用本镜画面图（与前一镜不同场景）",
"videoPlan.firstFrame.castDisjoint": "首帧用本镜画面图（与前一镜无共同角色）",
"videoPlan.firstFrame.sizeUnknown": "首帧用本镜画面图（景别未知，不敢硬接）",
"videoPlan.firstFrame.sizeGap": "首帧用本镜画面图（与前镜景别跨两档以上）",
// en（逐条对应）
"videoPlan.firstFrame.manualTail": "First & last frame set manually",
"videoPlan.firstFrame.handoff": "First frame comes from shot {index}'s tail frame",
"videoPlan.firstFrame.self": "First frame is this shot's still",
"videoPlan.firstFrame.off": "First frame is this shot's still (video consistency off)",
"videoPlan.firstFrame.tailMissing": "First frame is this shot's still (previous tail frame not extracted; lost on refresh)",
"videoPlan.firstFrame.firstShot": "First frame is this shot's still (this is the first shot)",
"videoPlan.firstFrame.prevNoImage": "First frame is this shot's still (previous shot has no image)",
"videoPlan.firstFrame.sceneUnknown": "First frame is this shot's still (no main scene tagged)",
"videoPlan.firstFrame.sceneChanged": "First frame is this shot's still (different scene from previous)",
"videoPlan.firstFrame.castDisjoint": "First frame is this shot's still (no shared character)",
"videoPlan.firstFrame.sizeUnknown": "First frame is this shot's still (shot size unknown)",
"videoPlan.firstFrame.sizeGap": "First frame is this shot's still (shot size jumps two or more steps)",
```

- [x] **Step 4: 跑测试确认通过** Expected: PASS（7 个用例）
- [x] **Step 5: 全量验证 + 提交**

```bash
npx tsc --noEmit && git diff --check && npm run test && npm run build
git add src/lib/firstFrameSource.ts tests/lib/firstFrameSource.test.ts src/i18n/index.ts
git commit -m "feat(video): 首帧来源纯解释器，把衔接降级原因变成界面可读信息"
```

---

### Task 10: 参考位分配的可解释性

**背景**：远景不接收道具图已经生效，但**拒收是静默的** —— 用户只会觉得"我明明引用了道具，怎么没照它画"。

**Files:** Modify `src/lib/promptComposer.ts`（导出 `MAX_TOTAL_REFERENCES`）；Create `src/lib/referencePlan.ts`；Test `tests/lib/referencePlan.test.ts`

**Interfaces:**
- Consumes: `MAX_REFERENCES_BY_SIZE`（`promptComposer.ts:304`）、`pickShotReferences`（`:316`）
- Produces:
  - `export const MAX_TOTAL_REFERENCES = 4;`（原为模块私有）
  - `interface RejectedReference { assetId: string; name: string; because: "size-budget" | "total-budget"; }`
  - `interface ReferenceAssignment { accepted: string[]; rejected: RejectedReference[]; }`
  - `function explainShotReferences(shot: Shot, project: { assets: Asset[]; styleReferenceUrl?: string }): ReferenceAssignment`

- [x] **Step 1: 写失败测试**

```ts
// tests/lib/referencePlan.test.ts
// ────────────────────────────────────────────────────────────────────────────
// 参考位分配的可解释性：被拒收必须说得出原因，不能静默。
// accepted 必须与 pickShotReferences 完全一致 —— 解释器不得另立一套判定，
// 否则界面解释与实际请求会随时间分叉（本项目明令禁止同一语义两套实现）。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { explainShotReferences } from "@/lib/referencePlan";
import { MAX_REFERENCES_BY_SIZE, pickShotReferences } from "@/lib/promptComposer";
import type { Asset, Shot } from "@/stores/projectTypes";

const ASSETS = [
  { id: "c1", type: "character", name: "橘猫", imageUrl: "https://cdn.test/c1.png" },
  { id: "c2", type: "character", name: "幼犬", imageUrl: "https://cdn.test/c2.png" },
  { id: "p1", type: "prop", name: "晾衣绳", imageUrl: "https://cdn.test/p1.png" },
  { id: "p2", type: "prop", name: "水桶", imageUrl: "https://cdn.test/p2.png" },
] as Asset[];

const shotFor = (over: Partial<Shot> = {}): Shot => ({
  id: "s", index: 0, scriptText: "", visualPrompt: "", motionPrompt: "", dialogues: [],
  activeCharacterIds: ["c1", "c2"], activeProductIds: [], activePropIds: ["p1", "p2"],
  duration: 5, status: "scripted", useDualFrame: false,
  ...over,
} as Shot);

describe("explainShotReferences", () => {
  it("accepted 与 pickShotReferences 完全一致（含景别未知）", () => {
    for (const size of ["extreme-wide", "wide", "medium", "close", "close-up", undefined] as const) {
      const shot = shotFor({ shotSize: size });
      expect(explainShotReferences(shot, { assets: ASSETS }).accepted)
        .toEqual(pickShotReferences(shot, { assets: ASSETS }));
    }
  });

  it("远景拒收两张道具图，原因是 size-budget 而不是 total-budget", () => {
    const r = explainShotReferences(shotFor({ shotSize: "wide" }), { assets: ASSETS });
    expect(r.accepted).toHaveLength(2);
    expect(r.rejected.map((x) => x.assetId)).toEqual(["p1", "p2"]);
    expect(r.rejected.every((x) => x.because === "size-budget")).toBe(true);
  });

  it("特写额度 1 角色 + 3 道具：第二个角色被拒，道具全收", () => {
    expect(MAX_REFERENCES_BY_SIZE["close-up"]).toEqual({ characters: 1, props: 3 });
    const r = explainShotReferences(shotFor({ shotSize: "close-up" }), { assets: ASSETS });
    expect(r.accepted).toEqual([
      "https://cdn.test/c1.png", "https://cdn.test/p1.png", "https://cdn.test/p2.png",
    ]);
    expect(r.rejected.map((x) => x.assetId)).toEqual(["c2"]);
  });

  it("景别未知时不拒收任何一张（额度 2+2，总数正好 4）", () => {
    const r = explainShotReferences(shotFor({ shotSize: undefined }), { assets: ASSETS });
    expect(r.rejected).toEqual([]);
    expect(r.accepted).toHaveLength(4);
  });

  it("没有 imageUrl 的资产既不占位也不算被拒（它本来没资格）", () => {
    const noImg = [{ id: "c9", type: "character", name: "无图" } as Asset];
    const r = explainShotReferences(
      shotFor({ activeCharacterIds: ["c9"], activePropIds: [] }),
      { assets: noImg },
    );
    expect(r).toEqual({ accepted: [], rejected: [] });
  });
});
```

- [x] **Step 2: 跑测试确认失败** Expected: FAIL（`referencePlan` 不存在 / `MAX_REFERENCES_BY_SIZE` 已导出但 `MAX_TOTAL_REFERENCES` 私有不影响）

- [x] **Step 3: 实现（并把总数上限导出供 UI 用）**

`src/lib/promptComposer.ts`：`const MAX_TOTAL_REFERENCES = 4;` → `export const MAX_TOTAL_REFERENCES = 4;`

```ts
// ────────────────────────────────────────────────────────────────────────────
// src/lib/referencePlan.ts
// 把「哪几张参考图进了请求、哪几张被为什么拒了」讲清楚。
// accepted 直接复用 pickShotReferences —— 绝不重算一遍额度，
// 否则解释与实际请求会随时间分叉。
// ────────────────────────────────────────────────────────────────────────────

import { MAX_REFERENCES_BY_SIZE, pickShotReferences } from "@/lib/promptComposer";
import type { Asset, Shot } from "@/stores/projectTypes";

export interface RejectedReference { assetId: string; name: string; because: "size-budget" | "total-budget"; }
export interface ReferenceAssignment { accepted: string[]; rejected: RejectedReference[]; }

export function explainShotReferences(
  shot: Shot,
  project: { assets: Asset[]; styleReferenceUrl?: string },
): ReferenceAssignment {
  const accepted = pickShotReferences(shot, project);
  const budget = MAX_REFERENCES_BY_SIZE[shot.shotSize ?? "unknown"];
  const rejected: RejectedReference[] = [];

  const collect = (ids: readonly string[] | undefined, kind: "character" | "prop") => {
    const cap = kind === "character" ? budget.characters : budget.props;
    let used = 0;
    for (const id of ids ?? []) {
      const asset = project.assets.find((a) => a.id === id);
      if (!asset?.imageUrl) continue;
      if (!accepted.includes(asset.imageUrl)) {
        rejected.push({ assetId: id, name: asset.name, because: used >= cap ? "size-budget" : "total-budget" });
        continue;
      }
      if (used < cap) used += 1;
    }
  };

  collect(shot.activeCharacterIds, "character");
  collect(shot.activeProductIds, "character");
  collect(shot.activePropIds, "prop");
  return { accepted, rejected };
}
```

> 若某条用例因 `used` 计数口径红，**以测试为准改本函数**（不得反向放宽测试去迁就实现），并在交付说明写清改了什么。

- [x] **Step 4: 跑测试确认通过** Expected: PASS（5 个用例）
- [x] **Step 5: 全量验证 + 提交**

```bash
npx tsc --noEmit && git diff --check && npm run test && npm run build
git add src/lib/promptComposer.ts src/lib/referencePlan.ts tests/lib/referencePlan.test.ts
git commit -m "feat(prompt): 参考位分配可解释（被景别拒收的图说得出原因）"
```

---

### Task 11: `WizardRail` + `WizardShell` 并接入三页（P2 收口）

**Files:** Create `src/features/wizard/WizardRail.tsx`、`src/features/wizard/WizardShell.tsx`；Modify `StepImages.tsx`、`StepVideos.tsx`、`StepStoryboard.tsx`、`src/i18n/index.ts`

**Interfaces:**
- Consumes: Task 3 的 `MEDIA_FRAME` / `SHELL_CONTAINER_CLASS` / `resolveAspect`；Task 5 `StepHeader`；Task 7 `moveSelection` / `syncSelectionWithShots`；Task 8 `shotSizeLabelKey`；Task 9 `describeFirstFrameSource` / `firstFrameSourceKey`；现有 `shotStatusInfo`、`pendingImageShots` / `pendingVideoShots`、`snapshotTailFrames`
- Produces:
  - `WizardShell(props: { header: ReactNode; rail: ReactNode; detail: ReactNode; detailActions?: ReactNode })`
  - `WizardRail(props: { shots: Shot[]; currentId?: string; onSelect(id: string): void; aspect?: AspectRatio; mode: "storyboard" | "image" | "video"; pendingIds?: readonly string[]; compact: boolean; onToggleCompact(): void })`

- [ ] **Step 1: `WizardShell`**

```tsx
// src/features/wizard/WizardShell.tsx
// 向导双栏骨架：页头 + 左轨 + 详情（详情底部可挂动作区）。
// 滚动权仍只在 CreationWizard 那一层 overflow-y-auto 之下发生：这里把轨与详情
// 各自切成有界滚动区，页面整体不再产生超长滚动。
// ⚠ 各步骤页必须继续在**步骤组件内部**渲染本组件，不得改成路由级子组件：
// 重挂载会让依赖 [shots.length] 的自动生成 effect 再跑一次（会烧配额）。

import type { ReactNode } from "react";
import { SHELL_CONTAINER_CLASS } from "@/lib/mediaLayout";

interface WizardShellProps {
  header: ReactNode;
  rail: ReactNode;
  detail: ReactNode;
  detailActions?: ReactNode;
}

export function WizardShell({ header, rail, detail, detailActions }: WizardShellProps) {
  return (
    <div className={`${SHELL_CONTAINER_CLASS} h-full`}>
      {header}
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="w-[15.5rem] shrink-0 overflow-y-auto pr-1">{rail}</div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
          {detail}
          {detailActions ? <div className="mt-auto pt-1">{detailActions}</div> : null}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `WizardRail`**

```tsx
// src/features/wizard/WizardRail.tsx
// 镜头轨：唯一职责是"在镜头之间选一个来看"。
// 不渲染详情内容；不自己算待办（pendingIds 由页面用 lib/shotQueue 传入，
// 保证轨上徽标与批量按钮是同一口径）。
// ⚠ 本组件及其祖先不得加 transform / filter —— Lightbox 依赖 body 级 fixed 基准。

import { useT } from "@/i18n";
import { MEDIA_FRAME, resolveAspect } from "@/lib/mediaLayout";
import { moveSelection } from "@/lib/railSelection";
import { shotSizeLabelKey } from "@/lib/shotDisplay";
import { shotStatusInfo } from "./shotStatus";
import type { AspectRatio } from "@/stores/projectTypes";
import type { Shot } from "@/stores/projectStore";

interface WizardRailProps {
  shots: Shot[];
  currentId?: string;
  onSelect(id: string): void;
  aspect?: AspectRatio;
  /** storyboard 模式常无出图：用序号占位，不留空白格 */
  mode: "storyboard" | "image" | "video";
  pendingIds?: readonly string[];
  compact: boolean;
  onToggleCompact(): void;
}

export function WizardRail({
  shots, currentId, onSelect, aspect = "16:9", mode, pendingIds = [], compact, onToggleCompact,
}: WizardRailProps) {
  const t = useT();
  const frame = MEDIA_FRAME.railThumb[resolveAspect(aspect)];
  const ids = shots.map((s) => s.id);

  return (
    <div
      className="flex flex-col gap-2"
      role="listbox"
      aria-label={t("rail.ariaLabel")}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const next = moveSelection(ids, currentId, e.key === "ArrowDown" ? 1 : -1);
        if (next) onSelect(next);
      }}
    >
      <button
        type="button"
        onClick={onToggleCompact}
        className="self-start rounded-md border border-line-soft px-2 py-1 text-[0.625rem] text-ink-4 hover:bg-hover"
      >
        {compact ? t("rail.expand") : t("rail.compact")}
      </button>

      <div className={compact ? "flex flex-col gap-1" : "grid grid-cols-2 gap-2"}>
        {shots.map((shot) => {
          const selected = shot.id === currentId;
          const status = shotStatusInfo(shot.status);
          const spinning = shot.status === "videoing" || shot.status === "imaging";
          const pending = pendingIds.includes(shot.id);
          const StatusIcon = status.icon;
          return (
            <button
              key={shot.id}
              type="button"
              role="option"
              aria-selected={selected}
              title={shot.scriptText || t("pipeline.shot")}
              onClick={() => onSelect(shot.id)}
              className={[
                "flex flex-col gap-1 rounded-lg border p-1 text-left transition",
                selected
                  ? "border-accent bg-accent-deep/30 ring-1 ring-accent"
                  : "border-line-soft bg-surface hover:border-line-strong",
              ].join(" ")}
            >
              <span className="flex items-center justify-between px-0.5 text-[0.625rem] text-ink-4">
                <span>{String(shot.index + 1).padStart(2, "0")}</span>
                <span className={status.color}>
                  <StatusIcon size={11} className={spinning ? "animate-spin" : undefined} />
                </span>
              </span>

              {compact ? null : (
                <span className={`block overflow-hidden rounded-md border border-line-soft ${frame.containerClass}`}>
                  {shot.imageUrl ? (
                    <img src={shot.imageUrl} alt="" loading="lazy" className={frame.mediaClass} />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-raised/40 px-1 text-center text-[0.625rem] text-ink-4">
                      {mode === "storyboard" ? t("rail.noImageYet") : t("rail.noImage")}
                    </span>
                  )}
                </span>
              )}

              <span className="flex items-center justify-between gap-1 px-0.5 text-[0.625rem] text-ink-3">
                <span>{t(shotSizeLabelKey(shot.shotSize))}</span>
                {pending ? <span className="h-1.5 w-1.5 rounded-full bg-warn" title={t("rail.pending")} /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

`src/i18n/index.ts` 新增（zh / en 同步）：`rail.ariaLabel`「镜头列表」/ `rail.compact`「紧凑」/ `rail.expand`「显示缩略图」/ `rail.noImage`「无画面图」/ `rail.noImageYet`「未出图」/ `rail.pending`「待补做」。

- [ ] **Step 3: 图片页接入**

页面内新增（**局部 state，不进 store** —— 设计稿 §16 决策 2）：

```ts
  const [currentShotId, setCurrentShotId] = useState<string | undefined>(undefined);
  const [railCompact, setRailCompact] = useState(false);
  const currentId = syncSelectionWithShots(shots.map((s) => s.id), currentShotId);
  const current = shots.find((s) => s.id === currentId);
```

根 return 改为：

```tsx
  <WizardShell
    header={<>
      <StepHeader
        titleKey="wizard.step4" done={imagedCount} total={shots.length}
        actions={<> {/* Task 5 已搬好的按钮，原样保留 */} </>}
      />
      <StepProgressBar done={imagedCount} total={shots.length} />
      {/* 两张告警卡原样保留 */}
    </>}
    rail={
      <WizardRail
        shots={shots} currentId={currentId} onSelect={setCurrentShotId}
        aspect={project?.aspectRatio} mode="image"
        pendingIds={pendingImageShots(shots).map((s) => s.id)}
        compact={railCompact} onToggleCompact={() => setRailCompact((v) => !v)}
      />
    }
    detail={current ? (
      <div className="flex flex-col gap-3">
        {/* 原卡内 children：Lightbox + 主图（Task 3 已改为 detailPrimary 版式） */}
        {/* 下方追加：参考位解释（accepted / rejected，Task 10 的 explainShotReferences） */}
        <PromptSubFields shotId={current.id} sections={["image"]} />
      </div>
    ) : <p className="text-xs text-ink-4">{t("rail.empty")}</p>}
    detailActions={current ? (
      <button type="button" onClick={() => rerollImage(current.id)} disabled={!hasApiKey}
        className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-2 hover:bg-hover">
        {t("wizard.reroll")}
      </button>
    ) : null}
  />
```

新增 i18n 键 `rail.empty`（zh「从左侧选择一个镜头」/ en "Pick a shot on the left"）。

**不得改动**：`:40-45` 的自动生成 effect、`:50-59` 的边沿检测、任何 `generateImagesForStep` / `rerollImage` 调用签名。

- [ ] **Step 4: 视频页接入**

同法接入 `WizardShell`，`mode="video"`、`pendingIds={pendingVideoShots(shots).map(s => s.id)}`、`done={videoedCount}`；详情块 = Task 9 的衔接解释行 + 播放器（`detailPrimary` 版式）+ 镜级进度三态 + `PromptSubFields sections={["motion"]}` + `DualFrameToggle shot={current}`。衔接解释行：

```tsx
  {(() => {
    const src = describeFirstFrameSource({
      shotId: current.id,
      shots: project.shots.map((s) => ({
        id: s.id, index: s.index, imageUrl: s.imageUrl,
        activeSceneId: s.activeSceneId, activeCharacterIds: s.activeCharacterIds, shotSize: s.shotSize,
      })),
      useDualFrame: current.useDualFrame,
      lastFrameUrl: current.lastFrameUrl,
      consistency: videoConsistency,
      tailFrames: snapshotTailFrames(),
    });
    const fromIndex = src.kind === "handoff"
      ? project.shots.find((s) => s.id === src.fromShotId)?.index
      : undefined;
    return (
      <p className="text-[0.6875rem] text-ink-3">
        {t(firstFrameSourceKey(src), fromIndex === undefined ? {} : { index: fromIndex + 1 })}
      </p>
    );
  })()}
```

**这段只读不写**：衔接结果绝不写回 `useDualFrame` / `lastFrameUrl`（写回会清空已生成视频 —— 既有铁律）。同时把 `Retry {n}/3` 里写死的 `/3` 去掉（改为只显示次数），因为编排层已不再有固定 3 次重试语义。

- [ ] **Step 5: 分镜页接入（去掉整页替换）**

删除 `StepStoryboard.tsx:132-143` 的 `if (editingShot) return <ShotDetail … />` 早返回；改为 `rail={<WizardRail mode="storyboard" … />}`、`detail={<ShotDetail … />}`。`ShotDetail` 的 `onClose` 传一个"取消选中 → 选回首镜"的实现（双栏下没有"退出详情"语义）；其编辑 / 重摇 / 对白入口**全部保持原样**。

- [ ] **Step 6: 死引用清理（必须 grep，不许凭印象删）**

Run: `grep -rn "ShotCard\|ShotListSection" src/`
Expected: `ShotListSection` 若已零引用 → 删文件并把其独占 i18n 键一并清（`shotList.*` 若别处还在用则保留）；仍有引用则本轮不删。**`ShotCard` 本任务不删**（Task 12 折叠三档还要以它为迁移参照）。

- [ ] **Step 7: 全量验证 + 行为自查**

```bash
npx tsc --noEmit && git diff --check && npm run test && npm run build
git diff -- src/features/wizard | grep -E "^[+-].*(await generate|updateShotByProjectId|setProjectStatusById|canAdvance)" || echo "OK：未触碰生成与门禁"
```
Expected: 全绿（用例数按实际报，P2 相对 P1 净增 ≥21）；第二条输出 `OK：未触碰生成与门禁`

- [ ] **Step 8: 用户目测项（本期变化最大，必须逐条看）**

① 三页都是"左轨 + 右详情"，选镜不再整页跳；② 轨与详情各自滚动、页面整体不再超长；③ `↑↓` 能否换镜；④ 9:16 两列轨是否认得出画面；⑤ 视频页衔接解释行是否说清了"为什么没接"；⑥ 点击图片是否仍走 Lightbox 且遮罩位置正常（验 transform 约束没被破坏）。

- [ ] **Step 9: 提交**

```bash
git add src/features/wizard/WizardRail.tsx src/features/wizard/WizardShell.tsx \
  src/features/wizard/StepImages.tsx src/features/wizard/StepVideos.tsx \
  src/features/wizard/StepStoryboard.tsx src/i18n/index.ts
git commit -m "feat(layout): 分镜/图片/视频三页改为左镜头轨 + 右常驻详情双栏"
```

---

## Phase P3 —— 密度档位、缩放一致性与收口

### Task 12: 折叠三档 + 窄视口退化，并删除被取代的旧卡片

**背景**：长中文提示词今天只有两个极端 —— 详情里全量铺开不折叠（`AssetEditorTemplate.tsx:150,157,181`），列表里一律 truncate（`ShotCard.tsx:66`）。仓库里现成的 `ExpandableSection` 零引用（死代码）。本任务把它改成折叠三档的唯一实现，并让图片/视频页详情去掉"就地展开"这条旧路径。

**Files:**
- Modify: `src/features/wizard/ExpandableSection.tsx`（加 clamp 档与"整块可点"）
- Modify: `src/features/wizard/StepImages.tsx`、`StepVideos.tsx`（详情区的提示词块改用折叠件；不再渲染展开态卡片体）
- Modify: `src/features/wizard/WizardShell.tsx`、`WizardRail.tsx`（窄视口退化）
- Delete: `src/features/wizard/ShotCard.tsx`（Step 5 的 grep 前置条件满足才删）
- Test: `tests/lib/collapse.test.ts`（折叠态纯逻辑）

**Interfaces Produces:**
- `const COLLAPSED_LINES = 3;`
- `function shouldOfferExpand(text: string): boolean`（纯逻辑：按换行与字符宽度估算是否需要"展开"入口）
- `ExpandableSection(props: { title: string; text: string; expanded?: boolean; onToggle?(next: boolean): void; children?: ReactNode })`（改造后的新形状，`summary` / `defaultExpanded` 被移除）

- [ ] **Step 1: 写失败测试**

```ts
// tests/lib/collapse.test.ts
// 折叠三档的唯一纯逻辑：什么时候值得给"展开"入口。
// 目的不是精确排版（那由 CSS line-clamp 做），而是避免给一行短文本也挂个展开钮。
import { describe, expect, it } from "vitest";
import { COLLAPSED_LINES, shouldOfferExpand } from "@/lib/collapse";

describe("shouldOfferExpand", () => {
  it("常量与档 2 定义一致", () => { expect(COLLAPSED_LINES).toBe(3); });
  it("空串 / 短文本不给展开入口", () => {
    expect(shouldOfferExpand("")).toBe(false);
    expect(shouldOfferExpand("一只橘猫蹲在水塔阴影中")).toBe(false);
  });
  it("超过一行分句数或总长超阈值时给入口", () => {
    expect(shouldOfferExpand("暴雨前的旧楼天台，地面干燥发白。" + "橘猫弓背压低，右眼紧盯红色水桶，尾巴绷直。")).toBe(true);
    expect(shouldOfferExpand("a\nb\nc\nd")).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** Expected: FAIL（`@/lib/collapse` 不存在）

- [ ] **Step 3: 实现纯逻辑 + 改造 `ExpandableSection`**

```ts
// src/lib/collapse.ts
// 折叠三档的判定：档 1 轨上（无正文）/ 档 2 详情默认（clamp 到 COLLAPSED_LINES）
// / 档 3 展开全文。这里只回答"值不值得给展开入口"，实际裁剪由 CSS line-clamp 完成。

export const COLLAPSED_LINES = 3;

/** 按分句数与总长度估算是否会超出 clamp —— 不做像素测量（无 DOM 可测）。 */
export function shouldOfferExpand(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.split(/\r?\n/).length > COLLAPSED_LINES) return true;
  return trimmed.length > 60 * COLLAPSED_LINES;
}
```

`ExpandableSection.tsx` 的 props 定为 `{ title: string; text: string; expanded?: boolean; onToggle?(next: boolean): void; children?: ReactNode }` —— **用 `text` 取代原 `summary`**（原字段是"折叠时显示的摘要"，新实现交给 CSS `line-clamp` 裁原文，不再需要单独摘要），删去 `defaultExpanded`（默认一律折叠，行为可预测）。组件内部：`shouldOfferExpand(text)` 为 false 时**不渲染展开钮**、直接整段显示；折叠态容器类串 `line-clamp-3 whitespace-pre-wrap`，展开态 `whitespace-pre-wrap`；标题行整行可点（`role="button"` + `tabIndex={0}` + Enter/Space，与本项目"进入编辑=点整张卡"的既有约定同形）。因该组件当前零引用，改 props 不影响任何调用点。

- [ ] **Step 4: 详情区接入 + 窄视口退化**

图片/视频页详情里的提示词块改走 `ExpandableSection`：

```tsx
  <ExpandableSection title={t("pipeline.visualPrompt")} text={current.visualPrompt} />
  <ExpandableSection title={t("pipeline.motionPrompt")} text={current.motionPrompt} />
```

`WizardShell.tsx` 的列容器：`w-[15.5rem] shrink-0` → `w-full shrink-0 lg:w-[15.5rem]`；外层 `flex min-h-0 flex-1 gap-4` → `flex min-h-0 flex-1 flex-col gap-4 lg:flex-row`；轨自身容器在 `WizardRail.tsx` 由 `grid grid-cols-2` 改为 `grid grid-cols-4 lg:grid-cols-2`（窄屏横向条、宽屏两列竖轨）。

- [ ] **Step 5: 删除被取代的旧卡片（先验证再删）**

Run: `grep -rn "ShotCard" src/`
Expected: 只剩 `ShotCard.tsx` 自身 → `git rm src/features/wizard/ShotCard.tsx`；若仍有引用则**不删**，在交付说明里写"因 X 处仍在用而保留"。

- [ ] **Step 6: 全量验证 + 用户目测项**

```bash
npx tsc --noEmit && git diff --check && npm run test && npm run build
```
目测：① 默认只见 3 行提示词 + 展开钮；② 切换镜头时展开态复位（`key={current.id}` 造成重挂载即复位，无需额外 state）；③ 把窗口拖窄后轨变成顶部横向条且详情仍在下方。

- [ ] **Step 7: 提交**

```bash
git add src/lib/collapse.ts tests/lib/collapse.test.ts src/features/wizard/ExpandableSection.tsx \
  src/features/wizard/WizardShell.tsx src/features/wizard/WizardRail.tsx \
  src/features/wizard/StepImages.tsx src/features/wizard/StepVideos.tsx src/i18n/index.ts
git commit -m "feat(layout): 详情提示词改折叠三档并在窄视口退化为顶部镜头带"
```

（若 Step 5 执行了 `git rm`，把它并入同一个 commit 并在 message 末尾追加「，删除被取代的 ShotCard」。）

---

### Task 13: 图标尺寸跟随根字号缩放

**背景**：界面整体缩放由 `globals.css:17` 的 `:root { font-size: 112.5% }` 统一控制，但图标是以 px 传给 lucide 的（`size={11}` / `size={12}` / `size={14}`），不参与缩放 → 调大界面时文字变大、图标不变。

**Files:** Modify（仅本次已触碰的文件，**不做全站扫**）：`StepImages.tsx`、`StepVideos.tsx`、`StepStoryboard.tsx`、`WizardRail.tsx`、`StepHeader.tsx`、`WizardMessages.tsx`、`ShotDetail.tsx`、`ShotListSection.tsx`、`DualFrameToggle.tsx`、`ReviewCheckpoint.tsx`

**Interfaces Produces:** 约定 —— 上述文件内所有 lucide 图标改为 `<Icon className="h-3.5 w-3.5" />` 形式，不再传 `size`。**不新增运行时 helper**（无逻辑可测，纯机械替换）。

- [ ] **Step 1: 取清单**

Run: `grep -rn "size={[0-9]" src/features/wizard src/components | cat`
把命中项按文件分组抄进交付说明（预期约 30 处，本任务只改上表列出的文件）

- [ ] **Step 2: 映射表（唯一口径，逐处照此替换）**

| 原 | 改为 |
|---|---|
| `size={11}` | `className="h-3 w-3"` |
| `size={12}` | `className="h-3.5 w-3.5"` |
| `size={14}` | `className="h-3.5 w-3.5"` |
| `size={16}` | `className="h-4 w-4"` |

原已有 `className` 的（如 `className="animate-spin"`）合并成 `className="h-3.5 w-3.5 animate-spin"`，**不得丢原类**。

- [ ] **Step 3: 验证**

```bash
grep -rn "size={[0-9]" src/features/wizard | cat        # 预期：本次范围内清零
npx tsc --noEmit && git diff --check && npm run test && npm run build
```
目测：把 `:root` 字号临时调到 100% 与 125%，图标应与文字同步变小/变大（**看完记得改回 112.5%**，该值不得进 commit）。

- [ ] **Step 4: 提交**

```bash
git add src/features/wizard
git commit -m "fix(ui): 向导图标改为 rem 尺寸，跟随整体缩放"
```

---

### Task 14: 布局代价实测（决定是否引入虚拟滚动）

**背景**：本仓库不以浏览器做界面核对，但双栏 + 常驻详情的代价必须可量化，不能靠"感觉还行"。判据只用**相对值**，不设"必须 <N ms"这类凭经验的阈值。

**Files:** 无代码改动（结论写回本计划末尾「实测结果」表）

- [ ] **Step 1: 造三档样本（不烧生成配额）**

用**已有项目**或只跑到步骤 3（分镜完成即停，不生成图片/视频），分别得到 12 / 20 / 40 镜三档。若无现成项目，用「手动添加镜头」按钮补足数量（`ShotListSection` 的 `onAdd`；分镜页已有 `wizard.addShotManual`）。

- [ ] **Step 2: 用户本地采集（把验证自己做掉，不交回给用户跑脚本）**

请用户记录三档各自的：切到图片页 / 视频页的首屏可交互感受，以及"连续滚动轨 + 滚动详情"是否卡顿。AI 侧同时给出不依赖浏览器的客观量：
```bash
git diff --stat HEAD~14            # 改动规模
node -e "const fs=require('fs');for(const f of ['StepImages','StepVideos','StepStoryboard','WizardRail','WizardShell']){const p='src/features/wizard/'+f+'.tsx';if(fs.existsSync(p))console.log(f,fs.readFileSync(p,'utf8').split('\n').length)}"
```
并记录 `npm run build` 产物的 JS/CSS 体积（与改造前 gzip 数字对比，只报相对增减）。

- [ ] **Step 3: 判定规则（预先写死，避免事后找理由）**

- 若 40 镜档出现可感知卡顿或首次渲染明显劣化 → 才引入虚拟滚动，并**另立一个任务**（本计划不含）。
- 若只有 12 / 20 两档可接受、40 档仅滚动变长 → 保持现状，把结论写进「实测结果」。
- 若产物 gzip 增长 > 5% → 检查是否误引入依赖，回退。

- [ ] **Step 4: 把结论写回本文件末尾「实测结果」表并提交**

```bash
git add docs/roadmap/2026-09-23-wizard-layout-redesign-plan.md
git commit -m "docs(plan): 记录双栏骨架在 12/20/40 镜三档的布局实测结论"
```

---

### Task 15: 文档同步收口（本计划唯一动文档的任务，Task 1 的 token 说明除外）

**Files:** Modify `AGENTS.md`、`docs/index.md`、`README.md`、`README_EN.md`、`docs/execution-flow.md`（仅当页面结构描述受影响）

- [ ] **Step 1: 逐处更新（按设计稿 §1 的 11 条根因，说明现在的正确形态）**

| 文档 | 要改的口径 |
|---|---|
| `AGENTS.md` | ① 项目结构表登记 `WizardShell` / `WizardRail` / `StepHeader` / `StepProgressBar` / `WizardMessages` 与 `lib/mediaLayout.ts` / `railSelection.ts` / `shotDisplay.ts` / `firstFrameSource.ts` / `referencePlan.ts` / `collapse.ts`；② 「UI 交互约定」新增双栏骨架一节（轨两列 + 详情常驻 + 两个有界滚动区 + 折叠三档 + 窄视口退化）；③ 「测试约定」补一句**组件渲染不可测，故布局逻辑一律下沉 `src/lib`**；④ 「层级 token 用途边界」已在 Task 1 写入，本处只核对未漂移；⑤ 若 `ShotCard.tsx` 已删除，从结构表移除并同步「分镜内容全只读」一节里对旧卡片的任何引用 |
| `docs/index.md` | §1.3 本计划行状态改为「✅ 已落地」；§2 SSOT 表登记 `mediaLayout.ts`（画幅→版式唯一口径）与 `firstFrameSource.ts`（首帧来源唯一解释器）；§4 冲突登记：把「设计稿列出的 11 条根因」中被修掉的条目移入已结案 |
| `README.md` / `README_EN.md` | 页面结构 / 交互描述若提到"点击卡片展开"「列表 ↔ 详情整页切换」，改为双栏口径；中英一致 |
| `docs/execution-flow.md` | §9.3 取消链路与 §12 待办清单不涉及本次改动，**不动**；只有当文中描述了步骤页 UI 结构时才同步 |

- [ ] **Step 2: grep 核对旧口径零残留**

```bash
grep -rn "就地展开\|整页切换\|max-w-4xl\|点击卡片展开" AGENTS.md README.md README_EN.md docs/*.md \
  | grep -v "docs/history/" | grep -v "docs/roadmap/"
```
Expected: 无输出（历史快照与本批设计/计划文档内的历史叙述除外）

- [ ] **Step 3: 全量验证 + 提交**

```bash
npx tsc --noEmit && git diff --check && npm run test && npm run build
git add AGENTS.md README.md README_EN.md docs/index.md docs/execution-flow.md
git commit -m "docs(agents): 同步双栏骨架与布局口径，登记新增 lib 与共享件"
```

---

## 收尾验收（全部任务完成后逐条核对）

1. `npx tsc --noEmit` 无输出；`git diff --check` 无输出；`npm run test` 全绿；`npm run build` 成功。**用例数必须相对基线 44 文件 / 530 只增不减**（P0-P3 新增：theme 6 + mediaLayout 12 + railSelection 4 + shotDisplay 3 + firstFrameSource 7 + referencePlan 5 + collapse 3 = 40；预期约 **51 文件 / 570 用例**，按实际报）。
2. `grep -rn "size={[0-9]" src/features/wizard` → 本次范围内为 0。
3. `grep -rn "max-h-48\|h-24\|bg-black" src/features/wizard/StepImages.tsx src/features/wizard/StepVideos.tsx` → 无媒体尺寸类硬编码残留。
4. 行为未被改动的证据：`git log -p --follow -- src/features/wizard/CreationWizard.tsx | grep canAdvance` 在本批区间内无命中（Task 6 之后该文件不应再被碰）。
5. 用户本地目测（AI 不做）：9:16 项目下 ① 三页双栏；② 主图不留大片空白；③ 轨与详情各自滚动；④ `↑↓` 换镜；⑤ 视频页衔接解释与景别徽标可读；⑥ Lightbox 遮罩正常；⑦ 窄窗口退化为顶部横向带。
6. 「实测结果」表已填（Task 14）。

## 实测结果（Task 14 填写）

| 镜数档 | 图片页首屏 | 视频页首屏 | 滚动手感 | 结论 |
|---|---|---|---|---|
| 12 | | | | |
| 20 | | | | |
| 40 | | | | |

构建产物（gzip，与改造前对比）：JS `206.50 kB → ___`；CSS `7.67 kB → ___`

---

## 交接须知（给执行这个计划的新会话）

1. **先读两份文件再动手**：本计划 + 设计稿 `2026-09-23-wizard-layout-redesign-design.md`（§17 是硬约束，尤其「不得让步骤组件重新挂载」「组件渲染不可测」两条）。
2. **顺序不可打乱**：Task 1→15。Task 4-6 依赖 Task 3 的 `SHELL_CONTAINER_CLASS`；Task 11 依赖 7/8/9；Task 12 依赖 11。
3. **每任务必走的门禁**：`npx tsc --noEmit && git diff --check && npm run test && npm run build`，然后**精确 `git add` 本任务文件**（禁止 `git add -A`）、约定式中文 commit、**不 push**。
4. **行号会漂**：本计划引用的 `文件:行` 都基于 2026-09-23 的工作树（HEAD 在 `8dec784`）。前面的任务会改动同一批文件 —— **改任何文件前先读它**，按符号/文本定位而不是按行号。
5. **计划里的代码是设计意图，不是逐字真理**：与真实类型或既有约定冲突时以真实代码为准，并在交付说明里写清改了什么、为什么。（本计划的签名、类串、i18n 键已按预检结果核对过，但 `zh` / `en` 字典是否可导出、`shotStatusInfo` 返回结构、`AssetDetailShell` 入参等仍以现场为准。）
6. **遇到下列情况停下来问用户，不要自行改设计**：① 需要改 `canAdvance` 或审核位才能收敛；② 需要改请求体或写回逻辑才能完成；③ 想引入虚拟滚动或任何新依赖；④ 想给双帧/尾帧链路加自动行为（那是另一份方案的事）。
7. **不在范围内**：跨镜头空间几何一致、眼罩属性绑定的模型能力边界、批量取消链路、CI 跑测试、双帧自动化（见 `2026-09-23-auto-dual-frame-design.md`）。
8. **上一份计划的遗留**（不在本计划内，别顺手做）：服务层诊断文案结构化改造（`videoService` 5 处 + `renderService` 2 处，详见双帧方案 §10 同源登记）；`AssetEditorMessages` 与 `WizardMessages` 的合并只在 Task 15 评估。


---

## 附录 C：各棒开工提示词（目标模式，逐棒执行）

> 本计划 15 个任务**不要整份交给一场会话**（单会话上下文越大，每次模型往返越慢）。
> 按四棒推进：P0 → P1 → P2 → P3。每棒开始前把下面对应代码块整段粘贴给新会话。
> 每棒收尾必须做三件事：① 把本棒完成的 Step checkbox 改成 `- [x]`；② 在文件末尾「执行日志」追加一行结论（已验证 / 未验证 / 待用户目测）；③ 逐任务提交，不 push。

### 棒 1（P0：Task 1-3）

```text
执行 docs/roadmap/2026-09-23-wizard-layout-redesign-plan.md 的 Task 1、2、3（只这三条，做完就收口）。

【先读，按顺序】
1. 计划文件本身（Global Constraints + 文件结构 + Task 1-3 全部步骤与代码）
2. 设计稿 docs/roadmap/2026-09-23-wizard-layout-redesign-design.md 的 §17（实施硬约束）
3. 仓库约定 AGENTS.md（测试约定、编码规范、UI 约定全部适用）

【本棒范围与停止点】
- Task 1 浅色主题层级 token + 绊线测试；Task 2 src/lib/mediaLayout.ts 纯口径；Task 3 三页与卡片接入画幅版式。
- 不做 Task 4 及以后；不改任何生成链路、请求体、store 写回、canAdvance 门禁。
- 文档只允许动 AGENTS.md 的「层级 token 用途边界」那一条（Task 1 Step 6），其余文档留给 Task 15。

【执行纪律】
- 逐任务走完红→绿→提交；commit message 用计划里给好的原文；精确 git add，禁止 git add -A；不 push。
- 计划里的 文件:行 基于旧工作树，会漂。改任何文件前先读它，按符号/文本定位，不按行号。
- 计划代码是设计意图：与真实类型或既有约定冲突时以真实代码为准，并在交付说明里写清改了什么、为什么。
- 单 turn 接近 80 次工具调用或 250 条消息就收口汇报，不要硬撑。

【基线与验收】
- 测试基线 44 文件 / 530 用例（2026-09-24 实测）；本棒应净增 themeTokens 6 + mediaLayout 12 个用例，报出实际数字。
- 每次提交前：npx tsc --noEmit && git diff --check && npm run test && npm run build，结果如实记录。
- 禁止浏览器 / E2E 测试；不启动 dev/preview 核对界面 —— 界面观感由用户本地确认，本棒结束时列出「待你目测项」。

【停下来问用户，不要自行改设计】
① 需要改 canAdvance / 审核位才能收敛；② 需要改请求体或写回逻辑；③ 想引入任何新依赖；
④ token 改动导致某处文字对比度肉眼不可读（列出 文件:行 与现象，等裁定）。

【收尾】
把三条 commit 号、测试结果、Task 1 Step 5 的 ink-4 用法清单、以及计划末尾「执行日志」新增一行，一并汇报。
```

### 棒 2（P1：Task 4-6）—— 只把上面第一段的范围行替换为：
```text
执行 docs/roadmap/2026-09-23-wizard-layout-redesign-plan.md 的 Task 4、5、6（共享件抽取，只做这三条）。
额外硬约束：本棒三个 commit 的 diff 里不得出现回调体、store action 调用或请求构造改动；
每个任务结束都跑计划里给的「行为不变自查」grep 并把输出原文记进交付说明。
前置：棒 1 已完成（依赖 mediaLayout 的 SHELL_CONTAINER_CLASS）。基线用例数以棒 1 结束时的实际值为准。
```

### 棒 3（P2：Task 7-11）—— 范围行替换为：
```text
执行 docs/roadmap/2026-09-23-wizard-layout-redesign-plan.md 的 Task 7、8、9、10、11（双栏骨架，只做这五条）。
额外硬约束：WizardShell 必须在步骤组件内部渲染，不得改成路由级子组件、不得给步骤页加 key；
各步骤页依赖 [shots.length] 的自动生成 effect 与边沿检测 ref 一律保持原位原样；
衔接与末帧信息只读不写回 store。Task 11 完成前不得删除 ShotCard。
前置：棒 2 已完成（依赖 StepHeader / StepProgressBar / 统一卡点）。
```

### 棒 4（P3：Task 12-15）—— 范围行替换为：
```text
执行 docs/roadmap/2026-09-23-wizard-layout-redesign-plan.md 的 Task 12、13、14、15（折叠三档、图标缩放、实测、文档同步）。
额外硬约束：Task 14 的判据只用相对值，不得新增绝对阈值；是否引入虚拟滚动按预先写死的规则判；
Task 15 是本计划唯一允许改 AGENTS.md / README / docs 口径的任务，改完必须跑它给的 grep 核对旧口径零残留。
前置：棒 3 已完成。收尾按「收尾验收」六条逐条核对并如实标注未验证项。
```

## 执行日志（每棒追加一行）

| 棒 | 任务 | commit | 测试（文件/用例） | 未验证 / 待目测 |
|---|---|---|---|---|
| 1（P0） | Task 1-3 | `164172b` / `1e01543` / `f136c45` | 46 文件 / 550 用例（基线 44 / 530；净增 themeTokens 6 + mediaLayout 14） | 全部为界面观感项，待用户本地目测：浅色层级分档、三页画幅版式（9:16 卡头缩略图为窄条、图片页展开后主图 58vh 变高）；未做浏览器验证（本仓库禁用） |
| 2（P1） | Task 4-6 | `df8f5f8` / `533b3a4` / `1497cf5` | 46 文件 / 550 用例（本期纯 markup 收敛，零新增用例，基线不减） | 行为不变自查三条已跑：Task 4 → `OK：无行为改动`；Task 5 → 仅 `onClick={handleGenerateStoryboard}` 成对搬运（缩进变化）；Task 6 → `git diff -- CreationWizard.tsx` 为空。现场偏差 4 处：① 分镜页错误框吃局部 `error` state（计划写的 `project?.error` 与现场不符）；② ReviewCheckpoint 的 disabled 定为 `failedShots.length > 0 \|\| confirmDisabled`（计划原式 `confirmDisabled ?? false` 会让图片页在有失败镜头时解禁确认键 = 门禁回归）；③ 资产页卡点另加 `confirmPending` / `confirmPendingLabelKey` / `footer` 三个纯展示入参，否则「正在生成分镜」转圈、按钮换文案与两条尾注会在收敛中丢失；④ 分镜页 wizard.step2→step3 连空态分支一并修（同类缺陷） |
| 3 前半（P2） | Task 7-10 | `9749af2` / `8bf4bbe` / `d32b21e` / `8d4cdb5` | 50 文件 / 569 用例（净增 railSelection 4 + shotDisplay 3 + firstFrameSource 7 + referencePlan 5，均实测值） | i18n 另导出 `zh` / `en` 供回归断言，新增 shotSize 6 键 + videoPlan.firstFrame 12 键（zh/en 同步）。现场偏差：`explainShotReferences` 的候选资格改为与 `pickShotReferences` 完全同口径（角色 `type==="character"` 且 `imageUrl ?? avatarUrl` 兜底、产品与角色共用 characters 额度）——计划原式的 `find(a => a.id === id)` 会让解释器与真实请求分叉。构建产物 gzip：JS 207.11→207.99 kB、CSS 7.98→7.98 kB（棒 1 结束 → 本期结束） |
