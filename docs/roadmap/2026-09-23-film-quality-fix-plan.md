# 成片质量根因修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除成片「视频跳」「三幕糊成一幕」「角色识别特征跨镜漂移」三类缺陷的机制级根因，并收口视频任务重复创建的计费泄漏。

**Architecture:** 按「镜头元数据 → 衔接素材决策 → 提示词内容 → 请求幂等」四层依次收敛。新增一个机读景别字段（`Shot.shotSize`）作为衔接与参考图分配的共同依据；把自动衔接的方向从「本镜尾帧＝下一镜画面」反转为「后镜首帧＝前镜末帧」；把只服务于提示词作者的规则文本与真正发给模型的渲染文本分离。

**Tech Stack:** React 19 + TypeScript strict + Zustand v5（persist）+ Vitest 4 + FFmpeg.wasm（`@ffmpeg/ffmpeg` 0.12.6）；生成侧为 Agnes AI 文本/图片/视频三模型。

**Spec:** 根因取证见 `C:\Users\ybd06\.qoder-cn\projects\c--Users-ybd06-Documents-project-wxhb\memory\shot-continuity-chain-and-weather-ladder-2026-09-23.md`（含 `debug-dump/state.json` 与 `debug-dump/runtime.log` 的实测数据、v9.mp4 首末帧对比结论）。本计划从该取证出发。

## Global Constraints

每个任务的实现要求都隐含包含本节，取值逐字来自 `AGENTS.md`：

- TypeScript `strict: true` + `noUnusedLocals` + `noUnusedParameters`；类型导入必须 `import type`（`verbatimModuleSyntax`）；禁止 `enum`（`erasableSyntaxOnly`）。
- 禁止用 `as any` / `as never` / `@ts-ignore` / `@ts-expect-error` 绕过业务类型。
- 测试只做代码单测（Vitest，`environment: "node"`），**禁止浏览器 / E2E**；不引入 jsdom；`localStorage` 用 `tests/helpers/localStorage.ts` 桩；网络与时间必须 `vi.stubGlobal("fetch", ...)` + `vi.useFakeTimers()` 伪造；模块级单例用 `vi.resetModules()` + 动态 `import()` 隔离。
- 断言必须来自真实实现：写用例前先读源码，禁止按注释/文档猜期望值。characterization test 必须标注「锁定现状而非期望行为」。
- 模型标识符在 `src/lib/models.ts`，套餐与限额在 `src/lib/plans.ts`，超时/重试/并发度等业务参数不得写成裸字面量。
- 用户可见文本必须进 `src/i18n/index.ts` 且 `zh` / `en` 同步；长提示词必须进 `src/lib/promptRules.ts` 注册表，**优先改条目不改代码**。
- 跨 `await` 必须捕获 `targetProjectId` 并按 ID 写回（`updateXxxByProjectId`），禁止 active-project action 参与异步链路。
- **P1 红线**：非幂等的图片/视频生成 POST，在没有幂等键或任务恢复协议前不得自动重试创建请求。429 属安全重发（未建任务未计费），走 `fetchWithRetry` 独立通道 + `rateLimiter.notifyRateLimited`，不占 `maxRetries`。
- 新增持久化字段必须同时加 `projectMigrations.ts` 迁移块与 `tests/stores/projectMigrate.test.ts` 回归，并递增 `projectStore.ts` 的 persist `version`（当前 16）。
- 提示词禁止为兜底而引入品种词表 / 状态词黑名单 / 枚举白名单 / 正则识别——判断权归模型。
- 验证口径（每次提交前至少完成并如实记录结果）：`npx tsc --noEmit`、`git diff --check`、`npm run test`、`npm run build`。**不使用浏览器/预览服务验证界面**，界面效果由用户本地确认。
- 提交：约定式中文 commit message，精确 `git add` 本次文件，**禁止 `git add -A`**，默认不 push。
- 文档同步：改完按 `docs/index.md` §2 SSOT 表与 §3 同步铁律更新受影响文档（`AGENTS.md`、`README.md`、`README_EN.md`、`docs/execution-flow.md`、`docs/index.md` 冲突登记），关键事实先改权威载体再扫旧值残留。

---

## 需你先裁定的两处（产品可见，不擅自定）

这两处会改变用户可感知的行为，计划按**推荐值**写任务；若选另一支，对应任务的期望值需同步改。

**裁定 1 — 分镜逐镜头生成的并发度（Task 5）**
「承接上一镜」这条规则目前无法执行，因为 11 镜以 3 并发各写各的、且只喂一句话大纲（`useScriptActions.ts:38` `SHOT_CONCURRENCY = 3`，`:412` 只传 `outline: outlineJson`）。
- **推荐 A：改为严格串行**，每镜携带上一镜的实际产出。正确性最好，代价是 11 镜分镜阶段从约 40s 拉长到约 90–120s（文本请求，成本可忽略）。
- B：两遍法（并发出草稿 → 串行做承接校正）。延迟约 60s，但多一套请求与状态机，实现量约为 A 的 2.5 倍。
- C：不动并发，只把大纲换成「相邻两镜计划」。改动最小，但相邻镜头的实际内容仍然互不可见，治不到根。

**裁定 2 — `videoConsistency` 的 `chain` 语义（Task 2 + Task 4）**
现状 `chain` ＝「本镜尾帧取下一镜画面图」，方向与业界做法相反（首尾帧必须属于同一镜头）。
- **推荐 A：`chain` 重定义为「后镜首帧取前镜末帧」**，Task 2 先拆掉错误路径（期间 `chain` 退化为仅锁首帧），Task 4 补上正确路径。
- B：只拆不建（`chain` 永久退化为仅首帧）。改动最小、立刻消除跳帧，但放弃跨镜衔接增益。

---

## 文件结构

新增：

| 文件 | 职责 |
|---|---|
| `src/lib/tailFrameStore.ts` | 前镜末帧的**内存**缓存（blob URL，不持久化）：`set` / `get` / `release`，刷新即失，缺失时下游自动降级 |
| `src/lib/shotSize.ts` | `ShotSize` 联合类型、允许值常量、`normalizeShotSize`、景别兼容判定（纯函数） |
| `tests/lib/shotSize.test.ts` | 上述纯函数用例 |
| `tests/lib/tailFrameStore.test.ts` | 缓存生命周期与释放 |

修改（按任务）：

| 文件 | 涉及任务 |
|---|---|
| `src/stores/projectTypes.ts` | 1（`ShotSize` 字段）、10（`videoTaskId`） |
| `src/stores/projectMigrations.ts` / `projectStore.ts` | 1（v17）、10（v18） |
| `src/services/scriptService.ts` | 1（`RawShot.shotSize` + 规范化）、5（相邻上下文入参） |
| `src/lib/promptRules.ts` | 1（骨架字段）、3（两条新条目）、6（环境状态条目）、8（`renderContent` 字段与内容）、9（锚点禁令） |
| `src/lib/shotContinuity.ts` | 2（反转衔接方向、删错误尾帧路径） |
| `src/lib/videoPlan.ts` | 2（`autoLastFrameUrl` → `autoFirstFrameUrl`） |
| `src/services/renderService.ts` | 4（导出末帧抽取） |
| `src/features/wizard/useVideoActions.ts` | 4（完成即抽帧）、10（videoId 落盘与恢复）、11（重试环收口） |
| `src/lib/assetDetails.ts` | 6（场景锚点字段）、9（括注格式） |
| `src/lib/promptComposer.ts` | 7（按景别分配参考位）、8（`appendRegistryRules` 改吃 `renderContent`） |
| `src/features/wizard/useScriptActions.ts` | 5（生成编排） |
| `src/stores/projectOps.ts` | 1（新内容字段不触发级联失效的白名单核对） |

测试镜像：`tests/lib/shotContinuity.test.ts`、`tests/lib/videoPlan.test.ts`、`tests/lib/shotReferences.test.ts`、`tests/lib/briefAppearance.test.ts`、`tests/lib/promptComposer.test.ts`、`tests/lib/promptRules.test.ts`、`tests/services/scriptService.test.ts`、`tests/services/videoService.test.ts`、`tests/stores/projectMigrate.test.ts`。

---

## Slice A — 结构性根因（先做，直接治「跳」）

### Task 1: 机读景别字段 `Shot.shotSize`

景别是衔接闸门（Task 2）与参考图分配（Task 7）的共同依据，现在只以自然语言埋在 `visualPrompt` 里，代码无法判定。本任务把它提为机读字段。

**Files:**
- Modify: `src/stores/projectTypes.ts:172-205`
- Modify: `src/lib/shotSize.ts`（新建）
- Modify: `src/services/scriptService.ts:32-51`（`RawShot`）、`normalizeRawShot`
- Modify: `src/lib/promptRules.ts:385-425`（`storyboardShot` 骨架 zh/en）
- Modify: `src/stores/projectStore.ts`（persist version 16 → 17）、`src/stores/projectMigrations.ts`（尾部加 v17 块）
- Test: `tests/lib/shotSize.test.ts`（新建）、`tests/stores/projectMigrate.test.ts`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces:
  - `type ShotSize = "extreme-wide" | "wide" | "medium" | "close" | "close-up"`（`@/lib/shotSize`）
  - `const SHOT_SIZES: readonly ShotSize[]`
  - `function normalizeShotSize(raw: unknown): ShotSize | undefined`
  - `function isAdjacentSizeCompatible(a: ShotSize | undefined, b: ShotSize | undefined): boolean`
  - `Shot.shotSize?: ShotSize`；`RawShot.shotSize?: string`

- [ ] **Step 1: 写失败测试——规范化只认白名单，其余降级为 undefined**

```ts
// tests/lib/shotSize.test.ts
import { describe, expect, it } from "vitest";
import {
  SHOT_SIZES,
  isAdjacentSizeCompatible,
  normalizeShotSize,
} from "@/lib/shotSize";

describe("normalizeShotSize", () => {
  it("白名单内的值原样返回（含大小写与首尾空白）", () => {
    for (const v of SHOT_SIZES) {
      expect(normalizeShotSize(`  ${v.toUpperCase()} `)).toBe(v);
    }
  });

  it("白名单外、空串、非字符串一律 undefined（模型不遵守时降级，不猜）", () => {
    expect(normalizeShotSize("medium-long shot")).toBeUndefined();
    expect(normalizeShotSize("")).toBeUndefined();
    expect(normalizeShotSize(undefined)).toBeUndefined();
    expect(normalizeShotSize(3)).toBeUndefined();
    expect(normalizeShotSize(null)).toBeUndefined();
  });
});

describe("isAdjacentSizeCompatible", () => {
  it("任一侧未知 → 判为不兼容（未知不得当作兼容放行衔接）", () => {
    expect(isAdjacentSizeCompatible(undefined, "wide")).toBe(false);
    expect(isAdjacentSizeCompatible("wide", undefined)).toBe(false);
    expect(isAdjacentSizeCompatible(undefined, undefined)).toBe(false);
  });

  it("相邻档位与同档兼容；跨两档以上不兼容", () => {
    expect(isAdjacentSizeCompatible("wide", "medium")).toBe(true);
    expect(isAdjacentSizeCompatible("medium", "wide")).toBe(true);
    expect(isAdjacentSizeCompatible("close-up", "close")).toBe(true);
    expect(isAdjacentSizeCompatible("close-up", "medium")).toBe(false);
    expect(isAdjacentSizeCompatible("extreme-wide", "close")).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test -- tests/lib/shotSize.test.ts`
Expected: FAIL — `Failed to load @/lib/shotSize`（文件不存在）

- [ ] **Step 3: 实现 `src/lib/shotSize.ts`**

```ts
// ────────────────────────────────────────────────────────────────────────────
// src/lib/shotSize.ts
// 景别的唯一机读口径：衔接闸门（shotContinuity）与参考图分配（pickShotReferences）
// 共用。由分镜模型产出，代码不猜——取值不在白名单内即降级为 undefined。
// ────────────────────────────────────────────────────────────────────────────

export type ShotSize = "extreme-wide" | "wide" | "medium" | "close" | "close-up";

/** 由远到近的档位顺序；索引差即「跨了几档」 */
export const SHOT_SIZES: readonly ShotSize[] = [
  "extreme-wide",
  "wide",
  "medium",
  "close",
  "close-up",
] as const;

/** 允许衔接/共享参考位的最大档位跨度：1 ＝ 只允许同档或相邻档 */
export const MAX_SHOT_SIZE_STEP_GAP = 1;

export function normalizeShotSize(raw: unknown): ShotSize | undefined {
  if (typeof raw !== "string") return undefined;
  const key = raw.trim().toLowerCase() as ShotSize;
  return SHOT_SIZES.includes(key) ? key : undefined;
}

/**
 * 相邻两镜的景别是否足够接近，可以让模型在两者之间补一段运动。
 * 任一侧未知时判为不兼容：未知不等于"随便接"。
 */
export function isAdjacentSizeCompatible(
  a: ShotSize | undefined,
  b: ShotSize | undefined,
): boolean {
  if (!a || !b) return false;
  const gap = Math.abs(SHOT_SIZES.indexOf(a) - SHOT_SIZES.indexOf(b));
  return gap <= MAX_SHOT_SIZE_STEP_GAP;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test -- tests/lib/shotSize.test.ts`
Expected: PASS（2 个 describe / 4 个用例）

- [ ] **Step 5: 加 `Shot.shotSize` 与 `RawShot.shotSize` 类型**

`src/stores/projectTypes.ts` 在 `duration: number;` 之后插入（`import type { ShotSize } from "@/lib/shotSize";` 置于文件顶部类型导入区）：

```ts
  /** 机读景别，由分镜模型产出；衔接与参考图分配的依据。旧数据与模型未给时为 undefined */
  shotSize?: ShotSize;
```

`src/services/scriptService.ts` 的 `RawShot` 在 `duration: number;` 之后插入：

```ts
  /** 模型给的景别原文，未归一化；取值域见 @/lib/shotSize */
  shotSize?: string;
```

- [ ] **Step 6: 在 `normalizeRawShot` 里归一化**

`src/services/scriptService.ts` 的 `normalizeRawShot` 返回对象内补一行（与既有 `duration` 规范化同处）：

```ts
    shotSize: normalizeShotSize(raw.shotSize),
```

顶部加 `import { normalizeShotSize } from "@/lib/shotSize";`。

- [ ] **Step 7: 写失败测试——骨架要求模型输出 shotSize**

```ts
// 追加到 tests/lib/promptRules.test.ts 末尾
describe("storyboardShot 骨架：机读景别字段", () => {
  it("zh / en 骨架都把 shotSize 列入必填输出字段与 JSON 模板", () => {
    for (const lang of ["zh", "en"] as const) {
      const prompt = buildTaskSystemPrompt("storyboardShot", lang, BUILTIN_RULES);
      expect(prompt).toContain("shotSize");
      // 取值域必须写死在骨架里，否则模型会给任意字符串
      expect(prompt).toContain("extreme-wide");
      expect(prompt).toContain("close-up");
    }
  });
});
```

Run: `npm run test -- tests/lib/promptRules.test.ts`
Expected: FAIL — 断言 `shotSize` 不通过

- [ ] **Step 8: 改 `storyboardShot` 骨架（zh/en 同步）**

`src/lib/promptRules.ts` zh 骨架第 5 条（`:391`）末尾追加一句，并把返回说明补上字段：

```
5. dialogues 按需给对白（characterId 用角色名），activeCharacterIds/activeSceneId/activeProductIds/activePropIds 用已有资产的 ID；visualPrompt 或 scriptText 中出现的可识别道具/产品必须同步写入对应 active ID，duration 从 4/5/8 中选
6. shotSize：本镜的机读景别，只能取 extreme-wide / wide / medium / close / close-up 五个值之一，必须与 visualPrompt 里写的景别一致
```

en 骨架第 5 条（`:411`）之后追加对应英文：

```
6. shotSize: this shot's machine-readable shot size, one of extreme-wide / wide / medium / close / close-up, and it must match the shot size stated in visualPrompt
```

- [ ] **Step 9: 跑测试确认通过**

Run: `npm run test -- tests/lib/promptRules.test.ts tests/lib/promptRules.edge.test.ts`
Expected: PASS

- [ ] **Step 10: 写失败测试——v17 迁移**

```ts
// 追加到 tests/stores/projectMigrate.test.ts
import { migratePersistedState } from "@/stores/projectMigrations";

describe("v16 → v17：shotSize 字段引入", () => {
  it("旧镜头缺 shotSize 时保持缺省（不凭空补默认景别）", () => {
    const state = {
      projects: [
        { id: "p1", shots: [{ id: "s1", index: 0, scriptText: "x" }] },
      ],
    };
    const out = migratePersistedState(structuredClone(state), 16) as {
      projects: Array<{ shots: Array<Record<string, unknown>> }>;
    };
    expect("shotSize" in out.projects[0].shots[0]).toBe(false);
  });

  it("重复执行幂等，且不改动既有 shotSize", () => {
    const state = {
      projects: [
        { id: "p1", shots: [{ id: "s1", index: 0, shotSize: "wide" }] },
      ],
    };
    const once = JSON.stringify(migratePersistedState(structuredClone(state), 15));
    const twice = JSON.stringify(
      migratePersistedState(structuredClone(JSON.parse(once)), 16),
    );
    expect(JSON.parse(twice).projects[0].shots[0].shotSize).toBe("wide");
    expect(twice).toBe(JSON.stringify(JSON.parse(once)));
  });
});
```

Run: `npm run test -- tests/stores/projectMigrate.test.ts`
Expected: PASS（本任务不写迁移逻辑也能过——**这是有意的**：v17 只做版本号占位与不补默认值的约定。见 Step 11 说明）

- [ ] **Step 11: 递增 persist 版本并留迁移块**

`src/stores/projectStore.ts` 的 persist 配置 `version: 16` → `version: 17`。
`src/stores/projectMigrations.ts` 在 `return state;` 之前追加：

```ts
  // Migrate from v16 to v17: 新增 Shot.shotSize（机读景别）。
  // 刻意不补默认值：景别只能由分镜模型产出，代码凭空补一档会让衔接闸门误放行。
  // 因此本块只做版本号占位与注释锚点，不改写数据；旧镜头保持 undefined（判为未知）。
  if (version < 17) {
    // no-op：见上方说明
  }
```

- [ ] **Step 12: 全量验证**

Run: `npx tsc --noEmit && git diff --check && npm run test && npm run build`
Expected: tsc 无输出；diff --check 无输出；test 全绿（用例数应比基线 487 多约 6）；build 成功

- [ ] **Step 13: 提交**

```bash
git add src/lib/shotSize.ts tests/lib/shotSize.test.ts src/stores/projectTypes.ts \
  src/stores/projectMigrations.ts src/stores/projectStore.ts src/services/scriptService.ts \
  src/lib/promptRules.ts tests/lib/promptRules.test.ts tests/stores/projectMigrate.test.ts
git commit -m "feat(shot): 新增机读景别字段 shotSize，作为衔接与参考图分配的依据"
```

---

### Task 2: 拆掉方向错误的自动尾帧链

**背景（必读）**：`src/lib/shotContinuity.ts:95` 目前 `return { ...base, linked: true, lastFrameUrl: next.imageUrl! }`——把**下一镜的画面图**当本镜尾帧。2026-09-23 实测（11 镜 / 7 处链接）：shot 9 首帧无水桶无水塔、猫额头一条黑发带，末帧（＝shot 10 画面）凭空长出红色水桶与水塔、眼罩变正规、机位横移；而该镜 motionPrompt 明写「全程无推拉摇移…绝对静止」。**首尾帧必须属于同一镜头**，跨镜衔接的正确方向是「后镜首帧＝前镜末帧」。本任务先拆错误路径（裁定 2 推荐 A 的第一半），Task 4 补正确路径。

**Files:**
- Modify: `src/lib/shotContinuity.ts`（全量重写决策语义）
- Modify: `src/lib/videoPlan.ts:34-78`、`:130-146`
- Test: `tests/lib/shotContinuity.test.ts`、`tests/lib/videoPlan.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `isAdjacentSizeCompatible`、`ShotSize`
- Produces:
  - `type ContinuitySkipReason = "last-shot" | "no-first-frame" | "scene-unknown" | "scene-changed" | "cast-disjoint" | "size-unknown" | "size-gap"`
  - `type ContinuityDecision = { shotId; nextShotId?; linked: false; reason } | { shotId; nextShotId; linked: true; handoff: "first-frame-from-previous" }`
  - `function buildHandoffMap(decisions): Map<string /* nextShotId */, string /* fromShotId */>`
  - `VideoPlan.reason` 增加 `"auto-handoff"`；`VideoPlanInput.autoFirstFrameUrl?: string` 取代 `autoLastFrameUrl`

- [ ] **Step 1: 重写测试期望（先红）**

把 `tests/lib/shotContinuity.test.ts` 整体替换为下述断言集。核心是**锁定「不再有任何镜头的尾帧来自别的镜头的画面图」**——这条断言就是本次修复的绊线。

```ts
// tests/lib/shotContinuity.test.ts
import { describe, expect, it } from "vitest";
import {
  buildHandoffMap,
  planShotContinuity,
  type ShotForContinuity,
} from "@/lib/shotContinuity";

const IMG = (n: number) => `https://cdn.test/shot${n}.png`;

function shot(
  overrides: Partial<ShotForContinuity> & { id: string; index: number },
): ShotForContinuity {
  return {
    imageUrl: IMG(overrides.index),
    activeSceneId: "scene_1",
    activeCharacterIds: ["char_pig"],
    shotSize: "medium",
    ...overrides,
  };
}

const SAMPLE: ShotForContinuity[] = [
  shot({ id: "s0", index: 0 }),
  shot({ id: "s1", index: 1, shotSize: "wide" }),                 // 同场景，跨一档 → 可衔接
  shot({ id: "s2", index: 2, shotSize: "close-up" }),             // 与 s1 跨两档 → 不衔接
  shot({ id: "s3", index: 3, activeSceneId: "scene_2" }),         // 换场景 → 不衔接
  shot({ id: "s4", index: 4, activeSceneId: "scene_2", activeCharacterIds: [] }),
  shot({ id: "s5", index: 5, activeSceneId: undefined, imageUrl: undefined }),
  shot({ id: "s6", index: 6, imageUrl: undefined }),
];

function reasons(list: ReturnType<typeof planShotContinuity>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of list) out[d.shotId] = d.linked ? "linked" : d.reason;
  return out;
}

describe("planShotContinuity：衔接方向", () => {
  it("绝不把任何镜头的画面图当作别的镜头的尾帧（回归绊线）", () => {
    const decisions = planShotContinuity(SAMPLE);
    expect(decisions.some((d) => "lastFrameUrl" in d)).toBe(false);
  });

  it("linked 表示「本镜应从上一镜取首帧」，方向指向后镜", () => {
    const map = buildHandoffMap(planShotContinuity(SAMPLE));
    // s1 从 s0 取首帧；s2 因景别跨两档不接；s3 换场景不接；s4 从 s3 取
    expect([...map.entries()]).toEqual([["s1", "s0"], ["s4", "s3"]]);
  });

  it("景别未知的一侧不衔接（未知不放行）", () => {
    const list = planShotContinuity([
      shot({ id: "a", index: 0 }),
      shot({ id: "b", index: 1, shotSize: undefined }),
    ]);
    expect(reasons(list)).toEqual({ a: "last-shot", b: "size-unknown" });
  });

  it("同场景但出场人物完全不相交时断开（换人特写不强行接在同一路径上）", () => {
    const list = planShotContinuity([
      shot({ id: "a", index: 0, activeCharacterIds: ["c1"] }),
      shot({ id: "b", index: 1, activeCharacterIds: ["c2"] }),
    ]);
    expect(reasons(list)).toEqual({ a: "last-shot", b: "cast-disjoint" });
  });

  it("上一镜没有画面图时无处可取", () => {
    const list = planShotContinuity([
      shot({ id: "a", index: 0, imageUrl: undefined }),
      shot({ id: "b", index: 1 }),
    ]);
    expect(reasons(list)).toEqual({ a: "last-shot", b: "no-first-frame" });
  });

  it("纯函数：不修改入参", () => {
    const input = [shot({ id: "a", index: 0 }), shot({ id: "b", index: 1 })];
    const before = JSON.stringify(input);
    planShotContinuity(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("空数组与单镜数组都不抛错", () => {
    expect(planShotContinuity([])).toEqual([]);
    expect(reasons(planShotContinuity([shot({ id: "only", index: 0 })]))).toEqual({
      only: "last-shot",
    });
  });
});
```

Run: `npm run test -- tests/lib/shotContinuity.test.ts`
Expected: FAIL — `buildHandoffMap` 未导出 / `planShotContinuity` 无该入参形状

- [ ] **Step 2: 重写 `src/lib/shotContinuity.ts`**

保留文件头注释块并把「设计约束」补上方向说明，然后整体替换实现：

```ts
// ────────────────────────────────────────────────────────────────────────────
// src/lib/shotContinuity.ts
// 相邻镜头的首帧衔接规划：把「上一镜的末帧」作为「本镜的首帧」，让拼接处连续。
//
// ⚠️ 方向（2026-09-23 实测纠正）：首尾帧必须属于**同一镜头**——尾帧描述本镜动作的
// 终点状态。旧实现把「下一镜的画面图」当本镜尾帧，等于强制模型在一段视频里凭空
// 造出机位位移与物体增减（实测 v9：末帧凭空长出水桶与水塔、眼罩形态改变），
// 且与该镜 motionPrompt 的「全程无推拉摇移」直接对打。现已反转为业界做法。
//
// 设计约束（必读）：
// - 纯函数，只读镜头数据、**不写 store**，也不触发级联失效。
// - 末帧图本身是本地抽取产物，存在 lib/tailFrameStore（内存，不持久化）；
//   本模块只负责判定"该不该接、从哪一镜取"，不碰素材地址。
// ────────────────────────────────────────────────────────────────────────────

import { isAdjacentSizeCompatible } from "@/lib/shotSize";
import type { Shot } from "@/stores/projectStore";

/** 衔接所需的最小镜头字段 */
export type ShotForContinuity = Pick<
  Shot,
  "id" | "index" | "imageUrl" | "activeSceneId" | "activeCharacterIds" | "shotSize"
>;

/** 未衔接的原因，供 UI 与日志解释「为什么这两镜没接上」 */
export type ContinuitySkipReason =
  | "last-shot"       // 已经是第一镜，前面没有画面可接
  | "no-first-frame"  // 上一镜没有画面图，抽不出末帧
  | "scene-unknown"   // 任一侧没标主场景，无法判断是否同场景
  | "scene-changed"   // 相邻两镜主场景不同，硬接会让模型乱补运动
  | "cast-disjoint"   // 同场景但出场人物完全不相交（换人特写），接上会扭曲
  | "size-unknown"    // 任一侧景别未知，未知不放行
  | "size-gap";       // 景别跨两档以上，模型补不出这段位移

export type ContinuityDecision =
  | { shotId: string; previousShotId: string; linked: true }
  | { shotId: string; previousShotId?: string; linked: false; reason: ContinuitySkipReason };

export interface ContinuityOptions {
  /**
   * 同场景但两镜出场人物完全不相交时是否断开衔接。默认 true：
   * 换人特写被强行接在同一运动路径上，最容易出畸形。
   */
  requireSharedCast?: boolean;
}

const DEFAULTS: Required<ContinuityOptions> = { requireSharedCast: true };

function sharesCast(a: ShotForContinuity, b: ShotForContinuity): boolean {
  const castA = a.activeCharacterIds ?? [];
  const castB = b.activeCharacterIds ?? [];
  // 任一侧没标角色时按「未知」处理：不因此断开，避免旧数据大面积失去衔接
  if (castA.length === 0 || castB.length === 0) return true;
  return castA.some((id) => castB.includes(id));
}

/**
 * 按 index 顺序规划相邻镜头的衔接。返回数组与排序后的镜头一一对应。
 * 决策挂在「后一镜」上：本镜是否从上一镜取首帧。
 */
export function planShotContinuity(
  shots: readonly ShotForContinuity[],
  options: ContinuityOptions = {},
): ContinuityDecision[] {
  const opts = { ...DEFAULTS, ...options };
  const ordered = [...shots].sort((a, b) => a.index - b.index);

  return ordered.map((shot, i): ContinuityDecision => {
    const prev = ordered[i - 1];
    if (!prev) return { shotId: shot.id, linked: false, reason: "last-shot" };

    const base = { shotId: shot.id, previousShotId: prev.id } as const;

    if (!prev.imageUrl) return { ...base, linked: false, reason: "no-first-frame" };
    if (!shot.activeSceneId || !prev.activeSceneId) {
      return { ...base, linked: false, reason: "scene-unknown" };
    }
    if (shot.activeSceneId !== prev.activeSceneId) {
      return { ...base, linked: false, reason: "scene-changed" };
    }
    if (opts.requireSharedCast && !sharesCast(prev, shot)) {
      return { ...base, linked: false, reason: "cast-disjoint" };
    }
    if (!isAdjacentSizeCompatible(prev.shotSize, shot.shotSize)) {
      const unknown = !prev.shotSize || !shot.shotSize;
      return { ...base, linked: false, reason: unknown ? "size-unknown" : "size-gap" };
    }

    return { ...base, linked: true };
  });
}

/** 衔接映射：本镜 ID → 应从中取首帧的上一镜 ID */
export function buildHandoffMap(
  decisions: readonly ContinuityDecision[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of decisions) {
    if (d.linked) map.set(d.shotId, d.previousShotId);
  }
  return map;
}
```

- [ ] **Step 3: 跑测试确认通过**

Run: `npm run test -- tests/lib/shotContinuity.test.ts`
Expected: PASS（7 个用例）

- [ ] **Step 4: 改 `videoPlan.ts` 吃「首帧来自前镜」**

`src/lib/videoPlan.ts` 改动四处：

```ts
// ① VideoPlan.reason 联合类型（:31）
  reason: "manual-tail" | "auto-handoff" | "identity-reference" | "first-frame-only" | "text-only";

// ② VideoPlanInput（:34-41）：autoLastFrameUrl 换成前镜末帧
  /** 由 tailFrameStore 提供的前镜末帧；仅当 planShotContinuity 判定衔接时非空 */
  autoFirstFrameUrl?: string;

// ③ planShotVideo 分支顺序（:48-78）：手动尾帧 > 前镜末帧衔接 > 身份参考 > 仅本镜首帧 > 纯文本
  if (shot.imageUrl && manualTail) {
    return {
      mode: "keyframe", firstFrameUrl: shot.imageUrl, lastFrameUrl: manualTail,
      referenceImageUrls: [], reason: "manual-tail",
    };
  }
  if (shot.imageUrl && consistency !== "off" && autoFirstFrameUrl) {
    // 前镜末帧与本镜画面图同时存在时，用前镜末帧作首帧：拼接处连续优先于本镜静帧还原。
    return {
      mode: "keyframe", firstFrameUrl: autoFirstFrameUrl,
      referenceImageUrls: [], reason: "auto-handoff",
    };
  }

// ④ planShotVideoMedia（:130-146）
  const handoff = buildHandoffMap(planShotContinuity(input.shots)).get(input.shot.id);
  const autoFirstFrameUrl = handoff ? input.tailFrames?.[handoff] : undefined;
```

`ShotVideoMediaInput`（`:117-124`）加一行入参，让编排层把末帧表传进来（纯函数不读全局）：

```ts
  /** 前镜末帧地址表（shotId → URL），由调用方从 lib/tailFrameStore 取；缺失即不衔接 */
  tailFrames?: Record<string, string>;
```

并把 `autoFirstFrameUrl` 传给 `planShotVideo`。顶部 `import { buildHandoffMap, planShotContinuity } from "@/lib/shotContinuity";`。

- [ ] **Step 5: 更新 `tests/lib/videoPlan.test.ts`**

在既有 describe 内追加，并**删除**所有断言 `autoLastFrameUrl` / `"auto-chain"` 的旧用例（那是被本次拆掉的路径）：

```ts
describe("planShotVideo：前镜末帧衔接", () => {
  it("有前镜末帧且 consistency 非 off → keyframe 首帧用前镜末帧，不带尾帧", () => {
    const plan = planShotVideo({
      shot: { imageUrl: "https://cdn.test/self.png", useDualFrame: false, lastFrameUrl: undefined },
      autoFirstFrameUrl: "https://cdn.test/prev_tail.png",
      consistency: "chain",
    });
    expect(plan).toEqual({
      mode: "keyframe",
      firstFrameUrl: "https://cdn.test/prev_tail.png",
      referenceImageUrls: [],
      reason: "auto-handoff",
    });
  });

  it("consistency=off 时忽略前镜末帧，退回仅锁本镜首帧", () => {
    const plan = planShotVideo({
      shot: { imageUrl: "https://cdn.test/self.png", useDualFrame: false, lastFrameUrl: undefined },
      autoFirstFrameUrl: "https://cdn.test/prev_tail.png",
      consistency: "off",
    });
    expect(plan.reason).toBe("first-frame-only");
    expect(plan.firstFrameUrl).toBe("https://cdn.test/self.png");
  });

  it("用户手动尾帧永远优先于自动衔接", () => {
    const plan = planShotVideo({
      shot: {
        imageUrl: "https://cdn.test/self.png",
        useDualFrame: true,
        lastFrameUrl: "https://cdn.test/manual.png",
      },
      autoFirstFrameUrl: "https://cdn.test/prev_tail.png",
      consistency: "chain",
    });
    expect(plan.reason).toBe("manual-tail");
    expect(plan.lastFrameUrl).toBe("https://cdn.test/manual.png");
  });

  it("衔接与身份参考互斥：有末帧时不走 reference", () => {
    const plan = planShotVideo({
      shot: { imageUrl: "https://cdn.test/self.png", useDualFrame: false, lastFrameUrl: undefined },
      autoFirstFrameUrl: "https://cdn.test/prev_tail.png",
      consistency: "identity",
      identityReferences: ["https://cdn.test/portrait.png"],
    });
    expect(plan.mode).toBe("keyframe");
    expect(plan.referenceImageUrls).toEqual([]);
  });
});
```

Run: `npm run test -- tests/lib/videoPlan.test.ts`
Expected: 先 FAIL（`autoFirstFrameUrl` 未被识别）→ 完成 Step 4 后 PASS

- [ ] **Step 6: 修编排层调用点**

`src/features/wizard/useVideoActions.ts:70-76` 的 `planShotVideoMedia({...})` 调用补 `tailFrames` 入参。本任务先传空对象占位（Task 4 接入真实末帧）：

```ts
          const { media } = planShotVideoMedia({
            shot,
            shots: latestProject.shots,
            assets: latestProject.assets,
            styleReferenceUrl: latestProject.styleReferenceUrl,
            consistency: videoConsistency,
            // Task 4 接入 tailFrameStore 前恒空：衔接判定通过但取不到末帧时自动降级为仅锁首帧
            tailFrames: {},
          });
```

同文件内搜索 `rerollShot` / 单项重摇路径，若另有一处 `planShotVideoMedia` 调用则同样补该入参——**两处必须同口径**（AGENTS.md §5：修复一个入口后必须搜索同类入口）。

- [ ] **Step 7: 全量验证**

Run: `npx tsc --noEmit && git diff --check && npm run test && npm run build`
Expected: 全绿。若 `tests/lib/shotContinuity.test.ts` 之外的文件引用了 `buildContinuityMap`（已知只有 `videoPlan.ts:134` 一处），tsc 会指出，按 Step 4 改法收敛。

- [ ] **Step 8: 提交**

```bash
git add src/lib/shotContinuity.ts src/lib/videoPlan.ts tests/lib/shotContinuity.test.ts \
  tests/lib/videoPlan.test.ts src/features/wizard/useVideoActions.ts
git commit -m "fix(continuity): 衔接方向反转为「后镜首帧取前镜末帧」，拆掉把下一镜画面当本镜尾帧的错误路径"
```

---

### Task 3: 分镜加「一镜一机位一时刻」与静帧相容原则

**背景**：实测 shot 3 的 `visualPrompt` 原文为「画面为快速交替的特写镜头。**左侧画面**：…猫侧脸…**右侧画面**：…幼犬正面…**下方画面**：…爪子踩桶沿」——一张静帧要求三个画面；其 `motionPrompt` 又要求 4 秒视频做三次硬切。shot 6 静帧是猫**已站塔顶**、motionPrompt 却要它「从塔侧起跳跃向塔顶」。现有 `storyboard.shot-craft` 只写了「聚焦一个核心动作」，没禁剪辑语汇、没要求动态与静帧相容。业界口径：one camera setup / one main action / one visual mood / one continuity note，多了就拆成 2–3 个 shot card。

**Files:**
- Modify: `src/lib/promptRules.ts`（新增两条 `storyboardShot` 条目 + 骨架第 2/3 条措辞）
- Test: `tests/lib/promptRules.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: 条目 id `storyboard.single-setup`、`storyboard.motion-matches-frame`（Task 5 的相邻上下文条目要排在它们之后）

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 tests/lib/promptRules.test.ts
describe("storyboardShot：一镜一机位与静帧相容", () => {
  const built = buildTaskSystemPrompt("storyboardShot", "zh", BUILTIN_RULES);

  it("禁止把剪辑语汇写进单镜提示词", () => {
    expect(built).toContain("一镜一机位");
    expect(built).toContain("反打");
    expect(built).toContain("拆成两个镜头");
  });

  it("要求 motionPrompt 的起幅等于本镜静帧", () => {
    expect(built).toContain("起幅");
    expect(built).toContain("静帧中已经发生的事不得重复");
  });

  it("两条新条目排在 shot-craft 之后（先讲单一性，再讲时长与连续性）", () => {
    const iSingle = built.indexOf("一镜一机位");
    const iCraft = built.indexOf("每个镜头聚焦一个核心动作");
    expect(iSingle).toBeGreaterThan(-1);
    expect(iCraft).toBeGreaterThan(-1);
    expect(iSingle).toBeLessThan(iCraft);
  });
});
```

Run: `npm run test -- tests/lib/promptRules.test.ts`
Expected: FAIL — `toContain("一镜一机位")`

- [ ] **Step 2: 新增两条条目**

`src/lib/promptRules.ts` 的 `storyboard.shot-craft` 条目（`:910`）**之前**插入：

```ts
  {
    id: "storyboard.single-setup",
    task: "storyboardShot",
    section: "rules",
    content: {
      zh: "- 一镜一机位：visualPrompt 只描述**这一个机位下的这一个瞬间**。禁止写剪辑语汇——切换、反打、快速交替、先切…再切…、左侧画面/右侧画面/下方画面、分屏、叠化、蒙太奇、多画面并列。一张静帧装不下三个画面，模型只会把它们糊成一团\n- 一个镜头只承载一个核心动作与一种景别；若想法确实需要多个机位或多个动作节拍，**拆成两个镜头**分别输出，不要塞进本镜",
      en: "- ONE camera setup per shot: visualPrompt describes ONLY this single framing at a single instant. Never write editing language — cuts, shot-reverse-shot, rapid intercutting, 'first ... then ...', left panel / right panel / bottom panel, split screen, dissolve, montage, side-by-side frames. A still cannot hold three frames; the model just smears them together\n- One core action and one shot size per shot; if the idea genuinely needs another setup or beat, SPLIT IT INTO TWO SHOTS instead of cramming it into this one",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "storyboard.motion-matches-frame",
    task: "storyboardShot",
    section: "rules",
    content: {
      zh: "- motionPrompt 的**起幅必须正好是本镜 visualPrompt 画出的那一帧**：静帧中已经完成的事，动态里不得再从头做一遍（静帧是猫站在塔顶，动态就不能再写「跃向塔顶」）；静帧中没有的物体，动态里不得凭空出现\n- 一段视频不会剪辑：motionPrompt 只允许一种连续的镜头运动（或明确写「固定机位」），禁止中途换机位、换景别、跳切",
      en: "- motionPrompt MUST start exactly on the frame visualPrompt draws: whatever is already finished in the still must not be replayed (if the still shows the cat on top of the tank, the motion must not say 'leaps onto the top'); objects absent from the still must not appear out of nowhere\n- A clip cannot cut: motionPrompt allows ONE continuous camera move (or an explicit 'locked-off camera') — never a mid-clip change of setup or shot size, never a jump cut",
    },
    enabled: true,
    source: "builtin",
  },
```

- [ ] **Step 3: 骨架第 2/3 条同步措辞**

`src/lib/promptRules.ts` zh 骨架（`:388-389`）两条改为：

```
2. visualPrompt：完整中文画面提示词——主体外观（**只用所给的一句短外观锚点**，不要把物种/外貌/服饰/识别特征逐条展开）、动作、环境、构图与镜头；**只写这一个机位、这一个瞬间、这一个景别**
3. motionPrompt：完整中文运动提示词——起幅＝visualPrompt 的那一帧，随后主体动作、一种镜头运动、环境变化
```

en 骨架（`:408-409`）对应改为：

```
2. visualPrompt: a complete Chinese image prompt — subject appearance (**use only the one-line brief appearance anchor provided**; do NOT expand species / appearance / outfit / signature into it), action, environment, composition and camera; **write only this one camera setup, this one instant, this one shot size**
3. motionPrompt: a complete Chinese motion prompt — it must open on the exact frame visualPrompt draws, then subject motion, ONE camera movement, environmental changes
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test -- tests/lib/promptRules.test.ts tests/lib/promptRules.edge.test.ts tests/services/scriptService.test.ts`
Expected: PASS。若 `promptRules.edge.test.ts` 断言条目总数或顺序，按其既有口径同步更新计数并在 commit message 里说明。

- [ ] **Step 5: 全量验证 + 提交**

```bash
npx tsc --noEmit && git diff --check && npm run test && npm run build
git add src/lib/promptRules.ts tests/lib/promptRules.test.ts
git commit -m "feat(prompt): 分镜加「一镜一机位」与「动态起幅须等于静帧」两条原则"
```

---

### Task 4: 正确方向的衔接——抽前镜末帧作后镜首帧

**背景**：Task 2 拆掉了错误路径，`chain` 目前退化为仅锁首帧。本任务补上业界做法：前镜视频生成完成后，用已有的 FFmpeg.wasm 抽它的末帧，作为同场景下一镜的首帧。末帧是本地产物、**不持久化**（遵守「blob URL 不持久化到 store，避免刷新后失效」的既有约定），缺失时自动降级。

**Files:**
- Create: `src/lib/tailFrameStore.ts`
- Modify: `src/services/renderService.ts`（导出末帧抽取）
- Modify: `src/features/wizard/useVideoActions.ts`（完成即抽帧 + 传给 `planShotVideoMedia`）
- Test: `tests/lib/tailFrameStore.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `planShotVideoMedia({ tailFrames })`、`buildHandoffMap`
- Produces:
  - `setTailFrame(shotId: string, url: string): void` / `getTailFrame(shotId: string): string | undefined` / `snapshotTailFrames(): Record<string, string>` / `releaseTailFrames(ids?: string[]): void`
  - `extractTailFrameUrl(videoUrl: string, signal?: AbortSignal): Promise<string>`（renderService 导出，返回 blob URL）

- [ ] **Step 1: 写失败测试**

```ts
// tests/lib/tailFrameStore.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const revoked: string[] = [];
beforeEach(() => {
  vi.resetModules();
  revoked.length = 0;
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:fake"),
    revokeObjectURL: vi.fn((u: string) => revoked.push(u)),
  });
});

async function store() {
  return await import("@/lib/tailFrameStore");
}

describe("tailFrameStore", () => {
  it("写入后可读回，snapshot 返回普通对象供纯函数消费", async () => {
    const m = await store();
    m.setTailFrame("s0", "blob:a");
    expect(m.getTailFrame("s0")).toBe("blob:a");
    expect(m.snapshotTailFrames()).toEqual({ s0: "blob:a" });
  });

  it("同一镜头重复写入时释放旧的 blob URL（不泄漏）", async () => {
    const m = await store();
    m.setTailFrame("s0", "blob:old");
    m.setTailFrame("s0", "blob:new");
    expect(revoked).toEqual(["blob:old"]);
    expect(m.getTailFrame("s0")).toBe("blob:new");
  });

  it("release 指定镜头；不传参释放全部并清空", async () => {
    const m = await store();
    m.setTailFrame("a", "blob:a");
    m.setTailFrame("b", "blob:b");
    m.releaseTailFrames(["a"]);
    expect(revoked).toEqual(["blob:a"]);
    expect(m.snapshotTailFrames()).toEqual({ b: "blob:b" });
    m.releaseTailFrames();
    expect(m.snapshotTailFrames()).toEqual({});
  });

  it("未知 ID 读取返回 undefined，释放不抛错", async () => {
    const m = await store();
    expect(m.getTailFrame("nope")).toBeUndefined();
    expect(() => m.releaseTailFrames(["nope"])).not.toThrow();
  });
});
```

Run: `npm run test -- tests/lib/tailFrameStore.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 2: 实现 `src/lib/tailFrameStore.ts`**

```ts
// ────────────────────────────────────────────────────────────────────────────
// src/lib/tailFrameStore.ts
// 前镜末帧的模块级内存缓存。末帧是从已生成视频里本地抽的帧，没有远端地址，
// 因此刻意不持久化（遵守「blob URL 不写进 store，避免刷新后失效」的既有约定）：
// 刷新后取不到末帧 → planShotVideo 自动降级为仅锁本镜首帧，不报错、不重建任务。
// ────────────────────────────────────────────────────────────────────────────

const tailFrames = new Map<string, string>();

export function setTailFrame(shotId: string, url: string): void {
  const previous = tailFrames.get(shotId);
  if (previous && previous !== url) URL.revokeObjectURL(previous);
  tailFrames.set(shotId, url);
}

export function getTailFrame(shotId: string): string | undefined {
  return tailFrames.get(shotId);
}

/** 供纯函数消费的普通快照（衔接规划不接受 Map） */
export function snapshotTailFrames(): Record<string, string> {
  return Object.fromEntries(tailFrames);
}

/** 释放指定镜头（不传＝全部）；重摇、删除镜头、切项目时调用 */
export function releaseTailFrames(shotIds?: string[]): void {
  const ids = shotIds ?? [...tailFrames.keys()];
  for (const id of ids) {
    const url = tailFrames.get(id);
    if (url) URL.revokeObjectURL(url);
    tailFrames.delete(id);
  }
}
```

- [ ] **Step 3: 跑测试确认通过**

Run: `npm run test -- tests/lib/tailFrameStore.test.ts`
Expected: PASS（4 个用例）

- [ ] **Step 4: renderService 导出末帧抽取**

`src/services/renderService.ts` 复用既有 `getFFmpeg()`（`:33`）、`fetchVideoBytes()`（`:133`）、`toProxyUrl()`（`:94`）、`lastFfmpegLog()`（`:146`），在 `concatenateVideos` 之前新增：

```ts
/** 抽末帧用的临时文件名；与拼接用的名字互不冲突 */
const TAIL_INPUT_NAME = "tail_src.mp4";
const TAIL_OUTPUT_NAME = "tail_frame.png";

/**
 * 从已生成视频抽取最后一帧，返回 blob URL。
 * 供跨镜首帧衔接使用（见 lib/tailFrameStore）。调用方负责在不使用时 revoke。
 */
export async function extractTailFrameUrl(
  videoUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const ffmpeg = await getFFmpeg();
  const bytes = await fetchVideoBytes(toProxyUrl(videoUrl), videoUrl, signal);
  try {
    await ffmpeg.writeFile(TAIL_INPUT_NAME, bytes);
    // -sseof -0.1 取最后 0.1 秒内的首帧：直接 -vf "select=eq(n\,N-1)" 需要先知道总帧数
    await ffmpeg.exec([
      "-sseof", "-0.1", "-i", TAIL_INPUT_NAME,
      "-frames:v", "1", "-update", "1", "-y", TAIL_OUTPUT_NAME,
    ]);
    const data = (await ffmpeg.readFile(TAIL_OUTPUT_NAME)) as Uint8Array;
    const blob = new Blob([data], { type: "image/png" });
    return URL.createObjectURL(blob);
  } catch (err) {
    throw new Error(
      `${getTranslation("error.tailFrameExtractFailed")}: ${err instanceof Error ? err.message : String(err)} | ${lastFfmpegLog()}`,
    );
  } finally {
    // 清理工作区临时文件，避免下一次拼接读到残留
    for (const name of [TAIL_INPUT_NAME, TAIL_OUTPUT_NAME]) {
      try {
        await ffmpeg.deleteFile(name);
      } catch {
        // 文件本就不存在（exec 未产出）：清理失败不影响主流程
      }
    }
  }
}
```

- [ ] **Step 5: 加 i18n 键（zh / en 同步）**

`src/i18n/index.ts` 的 `error.*` 区各加一条：

```ts
// zh
tailFrameExtractFailed: "末帧抽取失败",
// en
tailFrameExtractFailed: "Tail frame extraction failed",
```

- [ ] **Step 6: 视频完成后抽末帧并接入规划**

`src/features/wizard/useVideoActions.ts`：

① 顶部加导入：

```ts
import { extractTailFrameUrl } from "@/services/renderService";
import { releaseTailFrames, setTailFrame, snapshotTailFrames } from "@/lib/tailFrameStore";
```

② 在 `generateVideo` 成功、写回 `videoUrl` 之后（`:92-99` 的 `applied` 分支内）追加抽帧，**失败绝不污染镜头状态**：

```ts
          if (!applied) return;
          // 末帧只服务后续镜头的首帧衔接：抽取失败静默降级，绝不影响本镜结果
          try {
            const tailUrl = await extractTailFrameUrl(result.videoUrl, signal);
            setTailFrame(shot.id, tailUrl);
          } catch {
            /* 无末帧可用，下一镜自动退回仅锁首帧 */
          }
          return;
```

③ 把 Step 6 of Task 2 里的占位 `tailFrames: {}` 换成真值：

```ts
            tailFrames: snapshotTailFrames(),
```

④ 单项重摇路径开头释放该镜旧末帧（旧视频作废）：在 reroll/重新生成的入口调用 `releaseTailFrames([shot.id])`。同样搜索同类入口（批量与单项），**两处同口径**。

- [ ] **Step 7: 全量验证**

Run: `npx tsc --noEmit && git diff --check && npm run test && npm run build`
Expected: 全绿。注意 `tests/` 不随 build 做类型检查（`tsconfig.json` 的 `include` 仅 `src`），`tailFrameStore` 用例需靠 `npm run test` 自证。

- [ ] **Step 8: 人工验收（唯一能证明「不跳」的一步）**

在浏览器里跑一个 ≥4 镜、含同场景相邻镜头的项目，看拼接处：
- 期望：相邻同场景镜头拼接处画面连续，不再出现「凭空长出水桶/水塔、机位横移」。
- 若景别跨两档（如中景→极远），期望日志里该镜走 `first-frame-only` 降级而非强行衔接。

界面/成片由用户本地确认（本项目不以浏览器为验证手段，此步为交付说明中的待验收项）。

- [ ] **Step 9: 提交**

```bash
git add src/lib/tailFrameStore.ts tests/lib/tailFrameStore.test.ts \
  src/services/renderService.ts src/i18n/index.ts src/features/wizard/useVideoActions.ts
git commit -m "feat(continuity): 前镜末帧抽帧作为后镜首帧，落地正确方向的跨镜衔接"
```

---

## Slice B — 叙事与环境事实

### Task 5: 相邻镜头交换实际内容

**背景**：`storyboard.shot-craft` 写了「跨镜头连续性：本镜的动作/姿态/位置须合理承接上一镜」，但实现上无法执行——`useScriptActions.ts:38` 以 3 并发各写各的，`:412` 只传 `outline: outlineJson`（一句话大纲），模型拿不到上一镜的实际产出。**这是一条空规则。** 按裁定 1 推荐 A：改为串行并携带上一镜实际内容。

**Files:**
- Modify: `src/features/wizard/useScriptActions.ts:38`、`:400-439`
- Modify: `src/services/scriptService.ts:380-425`（`GenerateScriptOptions & {...}` 加 `previousShot`，user content 加相邻段）
- Modify: `src/lib/promptRules.ts`（新增相邻上下文条目）
- Test: `tests/services/scriptService.test.ts`

**Interfaces:**
- Consumes: Task 1 `shotSize`、Task 3 的两条条目
- Produces: `generateStoryboardShot` 新入参 `previousShot?: { scriptText: string; visualPrompt: string; shotSize?: ShotSize }`

- [ ] **Step 1: 写失败测试——请求必须携带上一镜实际内容**

```ts
// 追加到 tests/services/scriptService.test.ts（沿用该文件既有的 fetch stub 与 fake timers 模式）
it("generateStoryboardShot 把上一镜的实际内容拼进 user 消息", async () => {
  const fetchMock = vi.fn(async () => jsonResponse({ content: MINIMAL_SHOT_JSON }));
  vi.stubGlobal("fetch", fetchMock);

  await generateStoryboardShot({
    apiKey: "sk-test", baseUrl: "https://api.test", prompt: "x", language: "zh",
    aspectRatio: "1:1", assets: [], outline: "[]", item: ITEM, index: 3, total: 11,
    previousShot: {
      scriptText: "上一镜：橘猫弓背压低，右眼紧盯水桶",
      visualPrompt: "暴雨将至的旧楼天台，全景，橘猫蹲伏在水塔阴影中",
      shotSize: "wide",
    },
  });

  const [, init] = fetchMock.mock.calls[0];
  const body = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> };
  const user = body.messages.find((m) => m.role === "user")?.content ?? "";
  expect(user).toContain("上一镜：橘猫弓背压低");
  expect(user).toContain("景别: wide");
  expect(user).toContain("已生成的内容，不要重复其画面");
});

it("首镜（index 0）不带上一镜段", async () => {
  const fetchMock = vi.fn(async () => jsonResponse({ content: MINIMAL_SHOT_JSON }));
  vi.stubGlobal("fetch", fetchMock);
  await generateStoryboardShot({
    apiKey: "sk-test", baseUrl: "https://api.test", prompt: "x", language: "zh",
    aspectRatio: "1:1", assets: [], outline: "[]", item: ITEM, index: 0, total: 11,
  });
  const user = JSON.parse(String(fetchMock.mock.calls[0][1].body)).messages[1].content as string;
  expect(user).not.toContain("Previous shot");
  expect(user).not.toContain("上一镜");
});
```

Run: `npm run test -- tests/services/scriptService.test.ts`
Expected: FAIL — `previousShot` 不在入参类型 / user 消息无该段

- [ ] **Step 2: `generateStoryboardShot` 加相邻段**

`src/services/scriptService.ts`：入参类型（`:381-389`）加：

```ts
    /** 紧邻的上一镜实际产出；首镜不传。用于让本镜真正承接上一镜 */
    previousShot?: {
      scriptText: string;
      visualPrompt: string;
      shotSize?: ShotSize;
    };
```

`userContent` 数组（`:412-425`）在 `Plan:` 行之后插入一项：

```ts
    opts.previousShot
      ? [
          "Previous shot (already generated — do NOT repeat its frame; this shot must hand off from it):",
          `  script: ${opts.previousShot.scriptText}`,
          `  visual: ${opts.previousShot.visualPrompt}`,
          `  景别: ${opts.previousShot.shotSize ?? "unknown"}`,
        ].join("\n")
      : "",
```

顶部加 `import type { ShotSize } from "@/lib/shotSize";`。

- [ ] **Step 3: 跑测试确认通过**

Run: `npm run test -- tests/services/scriptService.test.ts`
Expected: PASS

- [ ] **Step 4: 编排层改串行并回读上一镜**

`src/features/wizard/useScriptActions.ts`：删除 `const SHOT_CONCURRENCY = 3;`（`:38`），把 `:400-439` 的并发块替换为按序生成。跨 `await` 一律按 `targetProjectId` 写回（既有约定，不得回退）：

```ts
      // 阶段 2：按序逐镜头生成。相邻镜头必须看到上一镜的实际产出，
      // 因此这里刻意不并发（storyboard.shot-craft 的「承接上一镜」在并发下无法执行）。
      // 单个镜头失败只标记该镜头并继续，不中断整批。
      let completed = 0;
      for (let i = 0; i < outline.shots.length; i++) {
        const item = outline.shots[i];
        const shot = placeholderShots[i];
        const latest = useProjectStore.getState().projects.find((p) => p.id === targetProjectId);
        const prev = i > 0 ? latest?.shots[i - 1] : undefined;
        try {
          const raw = await generateStoryboardShot({
            apiKey: providerConfig.apiKey,
            baseUrl: providerConfig.baseUrl,
            prompt,
            language: project.language,
            aspectRatio: project.aspectRatio,
            assets: assetsForShots,
            outline: outlineJson,
            item,
            index: i,
            total: placeholderShots.length,
            previousShot: prev
              ? {
                  scriptText: prev.scriptText,
                  visualPrompt: prev.visualPrompt,
                  shotSize: prev.shotSize,
                }
              : undefined,
          });
          const latestAssets =
            useProjectStore.getState().projects.find((p) => p.id === targetProjectId)?.assets ?? [];
          useProjectStore.getState().updateShotByProjectId(targetProjectId, shot.id, {
            ...buildShotUpdate(raw, latestAssets),
            status: "scripted" as const,
          });
        } catch (err) {
          useProjectStore.getState().updateShotByProjectId(targetProjectId, shot.id, {
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          completed += 1;
          try {
            options?.onProgress?.(completed, placeholderShots.length);
          } catch {
            // 进度回调仅用于界面提示，忽略其异常
          }
        }
      }
```

`runWithConcurrency` 若在本文件再无其它调用点，从 `:29` 的导入里移除（`noUnusedLocals` 会抓到）。

- [ ] **Step 5: 新增相邻上下文条目**

`src/lib/promptRules.ts` 的 `storyboard.single-setup` 条目**之前**插入：

```ts
  {
    id: "storyboard.handoff-previous",
    task: "storyboardShot",
    section: "rules",
    content: {
      zh: "- 上下文给出「上一镜已生成的内容」时，本镜必须在主体姿态、位置、景别、光线与色温上承接它：景别只允许同档或相邻档（中景↔全景），要跳档就用本镜的开头自然过渡，不要硬切；上一镜已经画过的画面不得再画一遍\n- 承接前先比对上一镜的实际内容：若本镜与上一镜是同一主体、同一姿态、同一景别（只是换个说法），**必须换节拍**——改景别、改动作或把两镜合并为一镜。两镜内容重复会让收尾拖沓且剪出来必然跳",
      en: "- When the context provides 'the previous shot as generated', this shot must hand off from it in pose, position, shot size, lighting and colour temperature: stay in the same or an adjacent shot size (medium ↔ wide); to jump two sizes, transition within this shot rather than hard-cutting, and never redraw what the previous shot already showed\n- Before handing off, compare against the previous shot's actual content: if this shot has the same subject, same pose and same shot size and only rephrases it, CHANGE THE BEAT — alter the shot size, alter the action, or merge the two shots. Two shots with duplicated content drag the ending and always cut as a jump",
    },
    enabled: true,
    source: "builtin",
  },
```

- [ ] **Step 6: 全量验证 + 提交**

```bash
npx tsc --noEmit && git diff --check && npm run test && npm run build
git add src/services/scriptService.ts src/features/wizard/useScriptActions.ts \
  src/lib/promptRules.ts tests/services/scriptService.test.ts tests/lib/promptRules.test.ts
git commit -m "feat(storyboard): 逐镜头改串行生成并携带上一镜实际产出，让承接规则可执行"
```

> **交付说明必须写明**：分镜阶段延迟从约 40s 升到约 90–120s（裁定 1 选 A 的既定代价）。`AGENTS.md` 的「并发：… 分镜逐镜头各 3」需同步为「分镜逐镜头串行（相邻镜头有内容依赖）」，见 Task 11 的文档同步清单。

---

### Task 6: 场景的天气/时间事实必须进镜头

**背景（这是「三幕糊成一幕」的直接成因）**：场景资产进分镜的短锚点字段是 `BRIEF_APPEARANCE_FIELDS.scene = ["settingType"]`（`src/lib/assetDetails.ts:397-403`）——只给「室外城市楼顶平台」一句，**`weather` / `time` 完全没进镜头**。于是镜头 0/2/3 的 visualPrompt 里既没有「大雨未落」也没有「地面无积水」，模型按「暴雨 + 闪电」的语料先验直接画成正在下大雨，三幕的「暴雨前 → 雨中 → 雨后入夜」视觉阶梯被抹平。唯一画对的「暴雨前」底图（地面干燥、无雨丝）又因场景图不进参考（`promptComposer.ts:303` 的 2026-09-23 裁决）而被丢弃。

**Files:**
- Modify: `src/lib/assetDetails.ts:397-403`
- Modify: `src/lib/promptRules.ts`（新增 `storyboard.paintable-environment-state` 条目）
- Test: `tests/lib/briefAppearance.test.ts`、`tests/lib/promptRules.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `BRIEF_APPEARANCE_FIELDS.scene === ["settingType", "weather", "time"]`

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 tests/lib/briefAppearance.test.ts
describe("场景短锚点必须携带天气与时间", () => {
  it("scene 锚点含 settingType / weather / time 三项", () => {
    expect(BRIEF_APPEARANCE_FIELDS.scene).toEqual(["settingType", "weather", "time"]);
  });

  it("「暴雨前」场景的锚点带上「大雨未落」——镜头提示词才有干湿依据", () => {
    const anchor = composeAssetBriefAppearance({
      type: "scene",
      description: "暴雨将至的旧楼天台，生锈水塔与铁门在远处闪电下呈现冷硬轮廓。",
      details: {
        kind: "scene",
        settingType: "室外城市楼顶平台",
        weather: "乌云密布，狂风卷起尘土，大雨未落，远处天空伴有强烈闪电",
        time: "黄昏至暴雨来临前的临界时刻",
      },
    } as Parameters<typeof composeAssetBriefAppearance>[0]);
    expect(anchor).toContain("室外城市楼顶平台");
    expect(anchor).toContain("大雨未落");
    expect(anchor).toContain("黄昏");
  });

  it("锚点里相邻片段互为子串时去重（既有去重口径扩展到新增字段）", () => {
    const anchor = composeAssetBriefAppearance({
      type: "scene",
      description: "雨夜天台",
      details: {
        kind: "scene",
        settingType: "天台",
        weather: "深夜暴雨",
        time: "深夜",
      },
    } as Parameters<typeof composeAssetBriefAppearance>[0]);
    // "深夜" 已被 "深夜暴雨" 包含，不应重复出现两次
    expect(anchor.match(/深夜/g)?.length).toBe(1);
  });
});
```

Run: `npm run test -- tests/lib/briefAppearance.test.ts`
Expected: FAIL — 第一与第二个用例（锚点里没有 weather/time）

- [ ] **Step 2: 扩锚点字段表**

`src/lib/assetDetails.ts:397-403` 改为：

```ts
export const BRIEF_APPEARANCE_FIELDS: Record<AssetDetails["kind"], string[]> = {
  character: ["species"],
  // 天气与时间必须进镜头：它们是"这一幕和下一幕看起来不一样"的唯一依据。
  // 只给 settingType 会让"暴雨前"和"暴雨中"画出同一个正在下雨的天台（2026-09-23 实测）。
  scene: ["settingType", "weather", "time"],
  product: ["category"],
  prop: ["objectType"],
  style: [],
};
```

- [ ] **Step 3: 跑测试确认通过**

Run: `npm run test -- tests/lib/briefAppearance.test.ts tests/lib/assetDetails.test.ts tests/lib/assetDetailsRegression.test.ts`
Expected: PASS。第三个用例靠既有 `parts.some((x) => x.includes(value) || value.includes(x))` 去重分支通过（`assetDetails.ts:417`）；若失败说明去重方向不够，改为双向包含判断后再继续。

- [ ] **Step 4: 加「环境状态写成可画事实」条目**

`src/lib/promptRules.ts` 的 `storyboard.handoff-previous` 条目**之前**插入：

```ts
  {
    id: "storyboard.paintable-environment-state",
    task: "storyboardShot",
    section: "rules",
    content: {
      zh: "- 环境状态必须写成**看得见的事实**，不要写时间态或否定词。生图模型不执行「暴雨将至」「大雨未落」「还没有下雨」「不再」这类表述，它会按语料先验直接画出正在下雨\n  - 「暴雨前」→ 空中无雨丝，水泥地面干燥发白，无积水反光，仅远处天空有闪电\n  - 「暴雨中」→ 密集雨丝划过画面，地面汇水成浅流，水面布满雨滴砸出的涟漪\n  - 「雨停后」→ 空中无雨丝，地面残留水洼与反光，衣物边缘悬挂将落未落的水珠\n- 同一场景的不同幕，必须靠这些可见事实区分开；只换情绪词与形容词等于没有换幕",
      en: "- Write environment state as **visible facts**, never tense words or negations. The image model does not execute 'storm approaching', 'rain has not started', 'no longer' — it follows its prior and draws rain already falling\n  - 'before the storm' → no rain streaks in the air, dry pale concrete, no standing-water reflections, lightning only in the distant sky\n  - 'during the storm' → dense rain streaks across frame, water gathering into shallow runs, the surface covered in raindrop ripples\n  - 'after the rain' → no rain streaks, leftover puddles with reflections, water hanging at the edge of dripping clothes\n- Different acts of the same scene must be told apart by these visible facts; swapping only mood words and adjectives is the same as never changing acts",
    },
    enabled: true,
    source: "builtin",
  },
```

> 注意：条目里的三组「→」是**判据示例**，不是清单也不是枚举白名单——判断与转写仍归模型（AGENTS.md 铁律：禁止为兜底引入状态词黑名单/正则）。

- [ ] **Step 5: 跑测试 + 全量验证 + 提交**

```bash
npm run test -- tests/lib/promptRules.test.ts
npx tsc --noEmit && git diff --check && npm run test && npm run build
git add src/lib/assetDetails.ts src/lib/promptRules.ts tests/lib/briefAppearance.test.ts tests/lib/promptRules.test.ts
git commit -m "fix(prompt): 场景锚点带上天气与时间，环境状态改写成可画事实"
```

---

### Task 7: 景别不再被参考图压平

**背景**：实测 shot 9 要求「极远景别…主体缩至画面一角」，实出中近景。它带满 4 张参考图（角色设定图×2 + 道具图×2），全是近景/微距样张（晾衣绳那张是绳子的特写）。2026-09-15 已确认「i2i 复制参考图构图的能力远高于文本否定」，但只对风格母版与场景图执行了收敛；角色/道具设定图同样携带强构图却仍挤满参考位。副作用直接可见：晾衣绳道具图（绳+木夹）在镜头里变成一串灯泡，「挂满滴水的深色衣物」整条丢失。

**Files:**
- Modify: `src/lib/promptComposer.ts:280-325`（`pickShotReferences`）
- Modify: 其全部调用点（`src/features/wizard/useImageActions.ts:68` 附近、资产/镜头图服务）
- Test: `tests/lib/shotReferences.test.ts`

**Interfaces:**
- Consumes: Task 1 `Shot.shotSize`、`SHOT_SIZES`
- Produces: `pickShotReferences(shot, project)` 签名不变（内部读 `shot.shotSize`），新增导出 `MAX_REFERENCES_BY_SIZE: Record<ShotSize | "unknown", { characters: number; props: number }>`

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 tests/lib/shotReferences.test.ts
describe("按景别分配参考位", () => {
  it("远景/极远景：只留角色身份锚点，道具特写图不占位", () => {
    for (const size of ["extreme-wide", "wide"] as const) {
      const refs = pickShotReferences(
        {
          id: "s", index: 0, scriptText: "", visualPrompt: "", motionPrompt: "",
          dialogues: [], activeCharacterIds: ["c1", "c2"], activeSceneId: "sc",
          activeProductIds: [], activePropIds: ["p1", "p2"], duration: 8,
          status: "scripted", imageUrl: "https://cdn.test/self.png", shotSize: size,
        } as Parameters<typeof pickShotReferences>[0],
        { assets: ASSETS },
      );
      expect(refs).toHaveLength(2);
      expect(refs).toEqual(["https://cdn.test/c1.png", "https://cdn.test/c2.png"]);
    }
  });

  it("特写：道具图优先占位（细节需要它），角色仍先收", () => {
    const refs = pickShotReferences(
      {
        id: "s", index: 0, scriptText: "", visualPrompt: "", motionPrompt: "",
        dialogues: [], activeCharacterIds: ["c1"], activeSceneId: "sc",
        activeProductIds: [], activePropIds: ["p1", "p2"], duration: 4,
        status: "scripted", imageUrl: "https://cdn.test/self.png", shotSize: "close-up",
      } as Parameters<typeof pickShotReferences>[0],
      { assets: ASSETS },
    );
    expect(refs[0]).toBe("https://cdn.test/c1.png");
    expect(refs).toContain("https://cdn.test/p1.png");
  });

  it("景别未知：维持现状口径（角色→产品→道具，上限 4）", () => {
    const refs = pickShotReferences(
      {
        id: "s", index: 0, scriptText: "", visualPrompt: "", motionPrompt: "",
        dialogues: [], activeCharacterIds: ["c1"], activeSceneId: "sc",
        activeProductIds: [], activePropIds: ["p1", "p2"], duration: 5,
        status: "scripted", imageUrl: "https://cdn.test/self.png",
      } as Parameters<typeof pickShotReferences>[0],
      { assets: ASSETS },
    );
    expect(refs).toEqual([
      "https://cdn.test/c1.png",
      "https://cdn.test/p1.png",
      "https://cdn.test/p2.png",
    ]);
  });
});
```

`ASSETS` fixture 沿用该测试文件既有的构造风格补齐 `c1/c2` 两角色与 `p1/p2` 两道具，各自带 `imageUrl`。

Run: `npm run test -- tests/lib/shotReferences.test.ts`
Expected: FAIL — 远景用例拿到 4 张

- [ ] **Step 2: 实现按景别分配**

`src/lib/promptComposer.ts` 在 `pickShotReferences` 之前新增：

```ts
/**
 * 参考位分配：远景/极远景不接收道具图。
 * 成因（2026-09-23 实测）：i2i 复制参考图构图的能力远高于文本否定，
 * 而道具图是单个物体的近景/微距样张 —— 四张近景参考塞满一个要求"极远"的镜头，
 * 景别必然被压成中近景，且道具细节会顶替画面主体（晾衣绳画成一串灯泡）。
 */
export const MAX_REFERENCES_BY_SIZE: Record<
  ShotSize | "unknown",
  { characters: number; props: number }
> = {
  "extreme-wide": { characters: 2, props: 0 },
  wide: { characters: 2, props: 0 },
  medium: { characters: 2, props: 2 },
  close: { characters: 2, props: 2 },
  "close-up": { characters: 1, props: 3 },
  unknown: { characters: 2, props: 2 },
};
```

函数体改为按额度收图（保持既有顺序：角色 → 产品 → 道具；总上限仍为 4）：

```ts
export function pickShotReferences(
  shot: Shot,
  project: { assets: Asset[]; styleReferenceUrl?: string },
): string[] {
  const out: string[] = [];
  const budget = MAX_REFERENCES_BY_SIZE[shot.shotSize ?? "unknown"];
  let charUsed = 0;
  let propUsed = 0;

  const push = (url: string | undefined | null, kind: "character" | "prop"): void => {
    if (!url || out.length >= MAX_TOTAL_REFERENCES) return;
    if (kind === "character") {
      if (charUsed >= budget.characters) return;
      charUsed += 1;
    } else {
      if (propUsed >= budget.props) return;
      propUsed += 1;
    }
    if (!out.includes(url)) out.push(url);
  };

  // 场景图与风格母版都不进入分镜图 i2i（见文件头 2026-09-15 / 2026-09-23 裁决）

  for (const id of shot.activeCharacterIds ?? []) {
    const c = project.assets.find((a) => a.id === id && a.type === "character");
    push(c?.imageUrl ?? c?.avatarUrl, "character");
  }
  for (const id of shot.activeProductIds ?? []) {
    const p = project.assets.find((a) => a.id === id && a.type === "product");
    push(p?.imageUrl, "character"); // 产品是主体，与角色同额度
  }
  for (const id of shot.activePropIds ?? []) {
    const p = project.assets.find((a) => a.id === id && a.type === "prop");
    push(p?.imageUrl, "prop");
  }

  return out;
}
```

顶部加 `const MAX_TOTAL_REFERENCES = 4;`（替换原先散在 `push` 里的裸数字 `4`）与 `import type { ShotSize } from "@/lib/shotSize";`。

- [ ] **Step 3: 跑测试确认通过**

Run: `npm run test -- tests/lib/shotReferences.test.ts tests/lib/promptComposer.test.ts tests/lib/promptComposer.edge.test.ts`
Expected: PASS。若 `promptComposer.edge.test.ts` 里有断言「道具图必进参考」的旧用例，按新口径更新并在 commit message 说明——**不要**为了让旧用例通过而放宽额度。

- [ ] **Step 4: 修 `useImageActions.ts:68` 的陈旧注释**

该函数头注释写「参考图：pickShotReferences（**场景** → 角色 → 产品/道具）」，与实现和 AGENTS.md 铁律相反（`promptComposer.ts:300-301` 明确排除场景图），是误导下一个改这段代码的人的最直接来源。改为：

```ts
 * 参考图：pickShotReferences（角色定妆照 → 产品 → 道具；场景图与风格母版不进参考，
 * 远景/极远景镜头不接收道具图 —— 见 MAX_REFERENCES_BY_SIZE）
```

- [ ] **Step 5: 全量验证 + 提交**

```bash
npx tsc --noEmit && git diff --check && npm run test && npm run build
git add src/lib/promptComposer.ts src/features/wizard/useImageActions.ts tests/lib/shotReferences.test.ts
git commit -m "fix(prompt): 按景别分配参考位，远景不再被道具特写压平构图"
```

---

## Slice C — 提示词卫生与计费收口

### Task 8: 元指令不再泄漏进 API 提示词

**背景**：实测每条视频请求尾部拼了「质量要求：Keep negative prompts to generic quality defects …（styleRef、visualDirection 骨架）」——那是**写给提示词作者看的规则**，被 `promptComposer.ts:48` 原样发给视频模型。`composeShot` 的「复用注册表中该资产的 appearancePrompt」同理，模型既没有注册表也做不到。

**Files:**
- Modify: `src/lib/promptRules.ts`（`PromptRule` 加 `renderContent?`；两条任务补渲染文本）
- Modify: `src/lib/promptComposer.ts:34-52`
- Modify: 提取生效规则的调用点（`extractVideoRules` 等）
- Test: `tests/lib/promptComposer.test.ts`、`tests/lib/promptRules.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `PromptRule.renderContent?: { zh: string; en: string }`；`getActiveRenderRules(task, language)` 返回**只含 renderContent** 的文本

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 tests/lib/promptComposer.test.ts
describe("appendRegistryRules 追加行为（只负责追加，不负责过滤）", () => {
  it("给什么渲染文本就追加什么，带「质量要求：」前缀", () => {
    const out = appendRegistryRules("一只橘猫", {
      negativeStrategy: "画面细节清晰，解剖结构正常，无伪影",
    });
    expect(out).toContain("质量要求：画面细节清晰，解剖结构正常，无伪影");
  });

  it("空规则不追加，原样返回", () => {
    expect(appendRegistryRules("一只橘猫", { negativeStrategy: "   " })).toBe("一只橘猫");
  });
});
```

**过滤发生在数据来源，不在 `appendRegistryRules`**——所以「作者向元指令不得进请求体」这条断言必须打在 `getActiveRenderRules` 上：

```ts
// 追加到 tests/lib/promptRules.test.ts
describe("渲染文本与作者规则分离", () => {
  it("negativeStrategy 的渲染文本只含画质事实，不含元指令与骨架名", () => {
    const rendered = getActiveRenderRules("negativeStrategy", "zh");
    expect(rendered).toContain("解剖结构");
    // 这三处都是写给提示词作者看的话，绝不能出现在发给模型的文本里
    expect(rendered).not.toContain("拼装");
    expect(rendered).not.toContain("骨架");
    expect(rendered).not.toContain("styleRef");
    expect(rendered).not.toContain("visualDirection");
  });

  it("纯作者向条目（compose.registry-reuse）不产出渲染文本", () => {
    const rendered = getActiveRenderRules("composeShot", "zh");
    expect(rendered).not.toContain("appearancePrompt");
    expect(rendered).not.toContain("注册表");
  });

  it("zh 与 en 的渲染文本各自非空且不互相串台", () => {
    expect(getActiveRenderRules("negativeStrategy", "en")).toContain("anatomy");
    expect(getActiveRenderRules("negativeStrategy", "zh")).not.toContain("anatomy");
  });
});
```

Run: `npm run test -- tests/lib/promptComposer.test.ts tests/lib/promptRules.test.ts`
Expected: FAIL — `getActiveRenderRules` 未导出（`promptComposer` 的两个用例应直接 PASS，用于确认改动没有意外破坏既有追加行为）

- [ ] **Step 2: `PromptRule` 加字段并补渲染内容**

`src/lib/promptRules.ts` 的 `PromptRule` 接口（`content` 字段附近）加：

```ts
  /**
   * 真正发给模型的渲染文本。缺省表示该条目只服务提示词作者（AI 或人），
   * 不参与拼装 —— 避免把「怎么写提示词」的元指令发给生图/生视频模型。
   * 用户覆盖条目时同 id 一并覆盖此字段。
   */
  renderContent?: { zh: string; en: string };
```

给两条已有条目补 `renderContent`：

```ts
  {
    id: "negative.strategy",
    // ...既有 content 不动
    renderContent: {
      zh: "画面细节清晰，解剖结构正常，无多余肢体与融合部位，无伪影与畸变",
      en: "clean detail, correct anatomy, no extra limbs, no fused parts, no artifacts or warping",
    },
  },
  {
    id: "compose.multi-reference",
    // ...既有 content 不动
    renderContent: {
      zh: "参考图只作为画风、色调与角色形象锚点，不要复制参考图的内容与构图",
      en: "references anchor art style, palette and character identity only; do not copy their content or composition",
    },
  },
```

`compose.registry-reuse` **不加** `renderContent`（纯作者向）。

- [ ] **Step 3: 新增 `getActiveRenderRules`**

`src/lib/promptRules.ts` 在 `buildSystemPrompt` 附近导出：

```ts
/**
 * 取某任务用于**渲染进最终提示词**的文本：只收带 renderContent 的生效条目。
 * 与 buildSystemPrompt 分工 —— 那个给提示词作者看，这个发给生成模型。
 */
export function getActiveRenderRules(task: PromptTask, language: "zh" | "en"): string {
  return getActiveRules()
    .filter((r) => r.task === task && r.section === "rules")
    .flatMap((r) => (r.renderContent ? [r.renderContent[language].trim()] : []))
    .filter((text) => text !== "")
    .join("；");
}
```

（`zh` 用全角分号连接；若该文件既有拼装约定用的是 `"; "` 或换行，**沿用既有连接符**，不要为这一处引入新分隔口径。）

- [ ] **Step 4: 改调用点**

`extractVideoRules()` / 图片侧同类 helper 内部把 `getActiveRules()` 提取改为 `getActiveRenderRules("negativeStrategy", language)` 与 `getActiveRenderRules("composeShot", language)`。`appendRegistryRules` 本体**不改**（它收到的应当已经是渲染文本）——只改喂给它的数据来源，这样 `tests/lib/promptComposer.test.ts` 里既有的「追加」行为断言仍然成立。

搜索全部 `appendRegistryRules(` 调用点（已知 `useVideoActions.ts:66`、镜头图片路径、资产图路径），**逐个确认都换成渲染文本**，不能只改一处。

- [ ] **Step 5: 跑测试 + 全量验证 + 提交**

```bash
npm run test -- tests/lib/promptComposer.test.ts tests/lib/promptRules.test.ts tests/services/videoService.test.ts
npx tsc --noEmit && git diff --check && npm run test && npm run build
git add src/lib/promptRules.ts src/lib/promptComposer.ts src/features/wizard/useVideoActions.ts \
  src/features/wizard/useImageActions.ts tests/lib/promptComposer.test.ts tests/lib/promptRules.test.ts
git commit -m "fix(prompt): 作者向规则与发给模型的渲染文本分离，元指令不再进请求体"
```

---

### Task 9: 短外观锚点不再把分类标签搬进正文

**背景**：实测 6 个镜头的 visualPrompt 出现「一只黑白色边境牧羊犬幼犬，**狗（边境牧羊犬）**四蹄带起尘土」「旧麻质晾衣绳，**生活线绳**」「水泥凸台，**建筑结构**」「红色塑料水桶，**日常容器**」。成因：`composeAssetBriefAppearance` 用 `parts.join("，")` 把 `species`/`objectType` 平铺成同结构的逗号短语（`assetDetails.ts:419`），模型逐字照抄后读起来像正文，而「建筑结构」「日常容器」对生图是纯噪声、甚至会把道具往错方向带。

**Files:**
- Modify: `src/lib/assetDetails.ts:405-420`
- Modify: `src/lib/promptRules.ts`（`storyboard.character-appearance` 补禁令；骨架第 2 条同步）
- Test: `tests/lib/briefAppearance.test.ts`、`tests/lib/promptRules.test.ts`

**Interfaces:**
- Consumes: Task 6 已扩展的 `BRIEF_APPEARANCE_FIELDS`
- Produces: 锚点格式 `<摘要>（<标签>：<值>[；…]）`

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 tests/lib/briefAppearance.test.ts
describe("锚点标签以括注形式给出，不被当正文照抄", () => {
  it("单字段：摘要后接括注标签", () => {
    const anchor = composeAssetBriefAppearance({
      type: "character",
      description: "一只左眼戴黑色布质眼罩的年长橘色家猫。",
      details: { kind: "character", species: "猫（橘色家猫）" },
    } as Parameters<typeof composeAssetBriefAppearance>[0]);
    expect(anchor).toBe("一只左眼戴黑色布质眼罩的年长橘色家猫（物种：猫（橘色家猫））");
  });

  it("多字段用分号并列，整体仍是一个括注", () => {
    const anchor = composeAssetBriefAppearance({
      type: "scene",
      description: "暴雨将至的旧楼天台。",
      details: {
        kind: "scene", settingType: "室外城市楼顶平台",
        weather: "大雨未落", time: "黄昏",
      },
    } as Parameters<typeof composeAssetBriefAppearance>[0]);
    expect(anchor).toBe(
      "暴雨将至的旧楼天台（空间类型：室外城市楼顶平台；天气：大雨未落；时间：黄昏）",
    );
  });

  it("没有标签字段时退化为纯摘要，不带空括号", () => {
    const anchor = composeAssetBriefAppearance({
      type: "character", description: "一只灰猫。", details: undefined,
    } as Parameters<typeof composeAssetBriefAppearance>[0]);
    expect(anchor).toBe("一只灰猫");
  });
});
```

Run: `npm run test -- tests/lib/briefAppearance.test.ts`
Expected: FAIL — 当前返回逗号平铺

- [ ] **Step 2: 实现括注格式**

`src/lib/assetDetails.ts` 加字段中文名映射（放在 `BRIEF_APPEARANCE_FIELDS` 之后）：

```ts
/** 锚点里各字段的中文标签：让模型知道这是元信息注记，不是要照抄的正文 */
const BRIEF_FIELD_LABELS: Record<string, string> = {
  species: "物种",
  settingType: "空间类型",
  weather: "天气",
  time: "时间",
  category: "品类",
  objectType: "物件类型",
};
```

`composeAssetBriefAppearance` 尾部（`:413-419`）改为：

```ts
  const details = asset.details as Record<string, string> | undefined;
  const tagged: string[] = [];
  for (const key of BRIEF_APPEARANCE_FIELDS[asset.type] ?? []) {
    const value = details?.[key]?.trim().replace(/[。.]+$/, "");
    if (!value) continue;
    if (tagged.some((x) => x.includes(value) || value.includes(x))) continue;
    const label = BRIEF_FIELD_LABELS[key] ?? key;
    tagged.push(`${label}：${value}`);
  }
  // 无摘要行时（旧数据或模型没写）退化为纯标签并列，绝不能把唯一标签吞掉
  if (!summary) return tagged.join("，");
  return tagged.length > 0 ? `${summary}（${tagged.join("；")}）` : summary;
```

> 保留既有「摘要只取第一个分句」与「相邻片段互为子串则去重」两条口径（`:408-417`），只改输出装配形式。

- [ ] **Step 3: 跑测试确认通过**

Run: `npm run test -- tests/lib/briefAppearance.test.ts tests/lib/assetDetails.test.ts tests/lib/assetDetailsRegression.test.ts tests/lib/prompt.test.ts`
Expected: PASS。`prompt.test.ts` 若有断言锚点为逗号平铺的用例，按新格式更新期望值（这是**期望行为已变更**，不是锁定现状）。

- [ ] **Step 4: 条目补禁令**

`src/lib/promptRules.ts` 的 `storyboard.character-appearance` 条目（`:856-865`）zh/en 各追加一句：

```
\n- 锚点括号内的「物种：/空间类型：/天气：」是给你确认身份用的元信息，**不要把标签连同冒号一起复制进 visualPrompt**；正文用自然中文写主体，例如写「一只黑白边境牧羊犬幼犬」，不要写「一只黑白边境牧羊犬幼犬，狗（边境牧羊犬）」
```

```
\n- The bracketed "物种：/空间类型：/天气：" in the anchor is metadata for you to confirm identity — **never copy the label and colon into visualPrompt**; write natural Chinese prose, e.g. "一只黑白边境牧羊犬幼犬", never "一只黑白边境牧羊犬幼犬，狗（边境牧羊犬）"
```

- [ ] **Step 5: 全量验证 + 提交**

```bash
npx tsc --noEmit && git diff --check && npm run test && npm run build
git add src/lib/assetDetails.ts src/lib/promptRules.ts tests/lib/briefAppearance.test.ts \
  tests/lib/promptRules.test.ts tests/lib/prompt.test.ts
git commit -m "fix(prompt): 外观锚点改为括注元信息，禁止分类标签被当正文照抄"
```

---

### Task 10: 视频任务 ID 持久化与刷新恢复（消除重复创建）

**背景**：实测 11 镜创建了 **20 个视频任务**（shot 2 同一提示词 5 次、shot 4 四次、shot 5 三次），仅 11 个完成；视频按秒计费。日志 0 条 error/warn、19 次「页面会话开始」→ 刷新后 `videoId` 无处可查，只能重建任务。AGENTS.md 的 P1 红线写明「只有服务端提供幂等键、请求 ID 或任务恢复机制时才允许创建请求重试」——本任务补上任务恢复机制。

**Files:**
- Modify: `src/stores/projectTypes.ts`（`Shot.videoTaskId?`、`videoTaskModel?`）
- Modify: `src/stores/projectStore.ts`（v17 → 18）、`projectMigrations.ts`
- Modify: `src/services/videoService.ts`（创建成功即回调落盘；导出按 ID 恢复轮询）
- Modify: `src/features/wizard/useVideoActions.ts`、`CreationWizard.tsx` 刷新恢复分支
- Test: `tests/services/videoService.test.ts`、`tests/stores/projectMigrate.test.ts`

**Interfaces:**
- Consumes: persist 版本 17（Task 1）
- Produces:
  - `Shot.videoTaskId?: string`、`Shot.videoTaskModel?: string`
  - `pollVideoTaskById(opts, videoId, modelName, onProgress?, signal?): Promise<VideoResult>`
  - `generateVideo` 新增入参 `onTaskCreated?: (videoId: string, modelName: string) => void`

- [ ] **Step 1: 写失败测试——创建成功必须立刻上报任务 ID**

```ts
// 追加到 tests/services/videoService.test.ts（沿用该文件既有 fetch stub / fake timers）
it("创建成功后、开始轮询前就回调 onTaskCreated", async () => {
  const seen: string[] = [];
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ id: "task_A", status: "queued" }))
    .mockResolvedValueOnce(jsonResponse({ id: "task_A", status: "completed", url: "https://cdn/a.mp4" }));
  vi.stubGlobal("fetch", fetchMock);

  const result = await generateVideo(
    { apiKey: "sk-test", baseUrl: "https://api.test", prompt: "p", duration: 5,
      onTaskCreated: (id, model) => seen.push(`${id}:${model}`) },
    undefined,
    new AbortController().signal,
  );

  expect(seen).toEqual([`task_A:${MODELS.video}`]);
  expect(seen.length).toBe(1);
  expect(result.videoUrl).toBe("https://cdn/a.mp4");
});

it("轮询失败时错误里带 videoId，供恢复而不重建", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ id: "task_A", status: "queued" }))
    .mockRejectedValueOnce(new Error("network down"));
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    generateVideo({ apiKey: "sk-test", baseUrl: "https://api.test", prompt: "p", duration: 5 }),
  ).rejects.toMatchObject({ videoId: "task_A" });
});

it("pollVideoTaskById 只发轮询请求，绝不 POST /videos", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    jsonResponse({ id: "task_A", status: "completed", url: "https://cdn/a.mp4" }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const result = await pollVideoTaskById(
    { apiKey: "sk-test", baseUrl: "https://api.test" },
    "task_A", MODELS.video,
  );
  expect(result.videoUrl).toBe("https://cdn/a.mp4");
  expect(fetchMock.mock.calls.every(([u]) => !String(u).endsWith("/videos"))).toBe(true);
});
```

Run: `npm run test -- tests/services/videoService.test.ts`
Expected: FAIL — `onTaskCreated` / `pollVideoTaskById` 不存在

- [ ] **Step 2: `videoService.ts` 落盘钩子与恢复入口**

① 创建入参加回调（与既有 `VideoTaskCreatedError` 同处）：

```ts
  /** 任务创建成功后、开始轮询前立刻回调。用于把 videoId 落盘，刷新后可恢复而不重建 */
  onTaskCreated?: (videoId: string, modelName: string) => void;
```

② 在 `POST /videos` 拿到 `id` 之后、进入轮询循环之前插入：

```ts
    // 必须先落盘再轮询：轮询期间的任何失败都不能让任务 ID 一起丢掉（按秒计费）
    onTaskCreated?.(videoId, modelName);
```

③ 把既有轮询循环体抽成 `pollVideoTaskById(opts, videoId, modelName, onProgress?, signal?)`，`generateVideo` 内部改为调用它；轮询/请求级失败仍统一包成带 `videoId` 的 `VideoTaskCreatedError`（**这条已有行为不能退化**，AGENTS.md 铁律）。

- [ ] **Step 3: 跑测试确认通过**

Run: `npm run test -- tests/services/videoService.test.ts`
Expected: PASS

- [ ] **Step 4: 类型 + 迁移 v18**

`projectTypes.ts` 的 `Shot` 在 `videoRetryCount?: number;` 之后：

```ts
  /** 服务端任务 ID；创建成功即落盘，刷新后据此继续轮询同一任务而不重建 */
  videoTaskId?: string;
  /** 轮询必须带 model_name，与创建时的模型一起存 */
  videoTaskModel?: string;
```

`projectMigrations.ts` 在 v17 块之后：

```ts
  // Migrate from v17 to v18: 新增 Shot.videoTaskId / videoTaskModel（任务恢复用）。
  // 旧数据没有这两个字段：刷新恢复逻辑遇到缺省即按现状走「无在飞任务」路径，
  // 不做任何猜测式补值（模型名与任务 ID 都无法从既有数据推出）。
  if (version < 18) {
    // no-op：见上方说明
  }
```

`projectStore.ts` persist `version: 17` → `18`。

```ts
// 追加到 tests/stores/projectMigrate.test.ts
it("v17 → v18 不为旧镜头凭空补 videoTaskId", () => {
  const state = { projects: [{ id: "p1", shots: [{ id: "s1", index: 0, status: "videoing" }] }] };
  const out = migratePersistedState(structuredClone(state), 17) as {
    projects: Array<{ shots: Array<Record<string, unknown>> }>;
  };
  expect("videoTaskId" in out.projects[0].shots[0]).toBe(false);
  expect("videoTaskModel" in out.projects[0].shots[0]).toBe(false);
});
```

- [ ] **Step 5: 编排层落盘 + 刷新恢复**

`useVideoActions.ts`：

① `generateVideo` 调用里加回调，按 `targetProjectId` 写回（禁止 active-project action）：

```ts
              onTaskCreated: (videoId, modelName) => {
                useProjectStore.getState().updateShotByProjectId(pid, shot.id, {
                  videoTaskId: videoId,
                  videoTaskModel: modelName,
                });
              },
```

② 成功写回 `videoUrl` 时清除任务字段（避免残留被误恢复）：

```ts
            { videoUrl: result.videoUrl, status: "videoed", videoTaskId: undefined, videoTaskModel: undefined },
```

③ 失败终态同样清除 `videoTaskId`（`setShotStatusByProjectIdIfRevision(..., "failed", ...)` 之后补一次 `updateShotByProjectId`）。

`CreationWizard.tsx` 的刷新恢复分支（现有 `videoing → imaged`、`imaging → scripted` 复位处）改为**优先恢复**：

```ts
    // 有 videoTaskId 说明服务端任务确实存在：继续轮询同一个任务，绝不重建（按秒计费）。
    // 没有 ID 才按旧口径复位为 imaged，交用户手动重做。
```

实现为：遍历各项目镜头，`status === "videoing" && videoTaskId` → 调 `pollVideoTaskById` 续轮询并写回；否则维持既有复位。**注意**：这段必须在 `hasActiveVideoTask` 守卫之后，避免与正在跑的批量任务重复轮询。

- [ ] **Step 6: 全量验证 + 提交**

```bash
npx tsc --noEmit && git diff --check && npm run test && npm run build
git add src/services/videoService.ts src/stores/projectTypes.ts src/stores/projectMigrations.ts \
  src/stores/projectStore.ts src/features/wizard/useVideoActions.ts src/features/wizard/CreationWizard.tsx \
  tests/services/videoService.test.ts tests/stores/projectMigrate.test.ts
git commit -m "feat(video): 任务 ID 创建即落盘并支持刷新恢复，消除重复创建的视频任务"
```

---

### Task 11: 创建重试环收口 + 文档同步

**背景**：`useVideoActions.ts:59-126` 的重试环在**创建**抛错时最多再发 3 次；超时/5xx 与 429 通道预算用尽后的 `HttpError` 都会落到这里，而 `POST /videos` 按秒计费。Task 10 补上任务恢复后，本任务把「已建任务」与「未建任务」彻底分开。AGENTS.md 把这条列为 P1 且标注「要收它必须先决定批量跑中一次网络抖动是否还自动救回——那是产品可见行为」：**裁定 3，见下方。**

**Files:**
- Modify: `src/features/wizard/useVideoActions.ts:58-140`
- Test: `tests/services/videoService.test.ts` 或新增 `tests/features/useVideoActions.retry.test.ts`

**Interfaces:**
- Consumes: Task 10 的 `onTaskCreated` / `pollVideoTaskById` / `VideoTaskCreatedError`
- Produces: 编排层不再有创建重试；`MAX_TASK_RETRIES` 语义改为「同一任务的续轮询次数」

- [ ] **Step 1: 明确裁定 3（实现前必须确认）**

- **推荐 A：批量中创建失败不再自动重建任务**，就地标记该镜 `failed` 并在错误文案里给出「可手动重试」。理由：`POST /videos` 非幂等，超时/5xx 时服务端可能**已经建了任务**（实测 3 次创建越过 60s 超时线），自动重发就是重复扣秒数；而 Task 10 之后手动重试也能复用已落盘的 `videoTaskId`。代价：网络抖动时批量跑要人工点一下救回。
- B：仅对**确定未建任务**的错误（连接被拒、DNS、4xx 参数错）保留 1 次自动重发；任何超时/5xx 一律不重发。折中，但需要 `fetchWithRetry` 能区分「请求是否已发出」，实现量更大。

以下按 A 写。

- [ ] **Step 2: 写失败测试**

```ts
// tests/features/useVideoActions.retry.test.ts（新建）
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/videoService", () => ({
  generateVideo: vi.fn(),
  pollVideoTaskById: vi.fn(),
  VideoTaskCreatedError: class VideoTaskCreatedError extends Error {
    videoId?: string;
    stillRunning = false;
  },
}));

import { generateVideo } from "@/services/videoService";

describe("创建失败不自动重建任务", () => {
  beforeEach(() => vi.mocked(generateVideo).mockReset());

  it("创建阶段抛普通 Error 时，generateVideo 只被调用一次", async () => {
    vi.mocked(generateVideo).mockRejectedValueOnce(new Error("timeout of 180000ms exceeded"));
    // 通过批量入口触发（沿用该文件既有的 store 预置 helper）
    await runBatchWithOnePendingShot();
    expect(generateVideo).toHaveBeenCalledTimes(1);
  });
});
```

> 执行时按 `useVideoActions` 的真实导出形态补 `runBatchWithOnePendingShot`（预置一个 `imaged` 镜头 + 有效 apiKey，调用批量入口并 `await`）。断言的核心只有一条：**普通创建错误下调用次数 == 1**。

Run: `npm run test -- tests/features/useVideoActions.retry.test.ts`
Expected: FAIL — 当前实现会调 3 次

- [ ] **Step 3: 收口重试环**

`useVideoActions.ts`：把 `for (let attempt = 0; attempt <= MAX_TASK_RETRIES; attempt++)` 的**创建重试**语义去掉——一次 `generateVideo` 调用；`VideoTaskCreatedError`（任务已建）走既有「保留服务端任务」分支不动；其余错误直接终态 `failed`。

```ts
      // 创建请求非幂等：POST /videos 按秒计费，超时/5xx 时服务端可能已经建了任务，
      // 自动重发就是重复扣秒数。因此这里不重试创建；任务已建的场景由
      // VideoTaskCreatedError + shot.videoTaskId 承接（见 Task 10），
      // 其余失败一律交用户手动重试。
      try {
        const motionPrompt = appendRegistryRules(composeMotionPrompt(shot), rules);
        const { media } = planShotVideoMedia({ /* …见 Task 2/4… */ });
        const result = await generateVideo({ /* … */ }, onProgress, signal);
        /* 写回 */
      } catch (err) {
        if (err instanceof VideoTaskCreatedError) { /* 既有：保留任务不重建 */ }
        else { /* 终态 failed，错误文案用 i18n 键 + 可手动重试提示 */ }
      } finally {
        /* 既有清理 */
      }
```

`MAX_TASK_RETRIES` / `RETRY_DELAY_MS` 若不再被引用则删除（`noUnusedLocals` 会抓）；若续轮询仍需要次数语义，重命名为 `MAX_POLL_RESUME_ROUNDS` 并写明「只续轮询已存在的任务，绝不创建」。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test -- tests/features/useVideoActions.retry.test.ts tests/services/videoService.test.ts`
Expected: PASS

- [ ] **Step 5: 文档同步（逐处更新，改完 grep 旧值确认零残留）**

| 文档 | 要改的口径 |
|---|---|
| `AGENTS.md` | ① 「并发：资产 / 镜头图片 / 分镜逐镜头各 3」→ 分镜逐镜头改串行（相邻镜头有内容依赖），资产/图片仍 3；② 视频一致性策略段：`chain` 语义改为「后镜首帧取前镜末帧」，删「同场景尾帧」旧表述；③ P1 红线「最后一处非幂等重发点仍是编排层的创建重试环」→ 标注已收口并写明裁定 3 的选择与理由；④ 数据模型 `Shot` 字段清单补 `shotSize` / `videoTaskId` / `videoTaskModel`；⑤ persist 版本 16 → 18；⑥ 「P1 质量门禁」的用例计数更新为本次实测值 |
| `docs/execution-flow.md` | §9.3 取消链路现状、§12 待办清单（把本次已修的条目移入「已修」并保留 `文件:行` 证据）、§13 迁移链补 v17/v18 |
| `docs/execution-flow-diagrams.md` | 视频阶段素材进出的参数流（`autoLastFrameUrl` → `tailFrames` / `autoFirstFrameUrl`） |
| `docs/index.md` | §2 SSOT 表登记 `src/lib/shotSize.ts` 与 `src/lib/tailFrameStore.ts`；§4 冲突登记：本次消解的条目移入已结案，并新增一条「场景图不进参考」的**裁决范围限定**（只覆盖空间几何一致，不覆盖天气/时间事实传递，见 Task 6） |
| `README.md` / `README_EN.md` | 特性表里视频一致性描述，中英口径一致 |

grep 核对（应零残留，`docs/history/` 快照除外）：

```bash
grep -rn "autoLastFrameUrl\|auto-chain\|同场景尾帧\|分镜逐镜头各 3\|version 16" src docs README.md README_EN.md AGENTS.md \
  | grep -v "docs/history/"
```

- [ ] **Step 6: 全量验证 + 提交**

```bash
npx tsc --noEmit && git diff --check && npm run test && npm run build
git add src/features/wizard/useVideoActions.ts tests/features/useVideoActions.retry.test.ts \
  AGENTS.md README.md README_EN.md docs/execution-flow.md docs/execution-flow-diagrams.md docs/index.md
git commit -m "fix(video): 创建重试环收口为非幂等安全，并同步全部受影响文档"
```

---

## 收尾验收（全部任务完成后）

1. `npm run test` 全绿，用例数相对基线（37 文件 / 487 用例，2026-09-23 实测）的增长与新增测试数一致，并在交付说明里给出实际数字。
2. 用同一个 90 秒三幕想法重跑一遍，逐项核对：
   - 第一幕的镜头**地面干燥、空中无雨丝**（Task 6 生效判据）；
   - 没有任何镜头的 `visualPrompt` 含「左侧画面 / 右侧画面 / 快速交替 / 反打」（Task 3 生效判据）；
   - `visualPrompt` 里不出现「，狗（边境牧羊犬）」「，建筑结构」「，日常容器」这类标签残留（Task 9 生效判据）；
   - 发给模型的 prompt 尾部不含「when composing」「Keep negative prompts」「骨架」「注册表」（Task 8 生效判据）；
   - `debug-dump/runtime.log` 里 `hasLastFrame:true` 的请求数 == 用户手动设了双帧的镜头数（Task 2 生效判据：自动路径不再产生尾帧）；
   - 视频任务创建次数 == 镜头数（Task 10/11 生效判据，无重复创建）。
3. 抽帧复核衔接：对相邻同场景镜头，抽前镜末帧与后镜首帧比对，应基本一致（Task 4 生效判据）。
4. 界面与成片由用户本地确认；AI 不启动 dev/preview 服务做界面核对。

## 已知不在本计划范围

- 跨镜头**空间几何**一致（同一间天台的窗/书架/护栏布局）：2026-09-23 四臂 A/B 已实测否决「加场景参考图」这条路，剩余候选（文本层空间锚点、提高参考位上限、换一致性机制）未定，需另立方案。
- 角色识别特征（眼罩）的属性绑定失败：属模型能力边界（BizGenEval 难属性绑定最强模型 65.6），本计划只做 Task 6/9 的提示词层缓解，**不引入状态词黑名单 / 品种词表 / 正则**。
- 全仓 `controller.abort()` 只有 5 处、批量生成无用户级取消入口（AGENTS.md 铁律注）：独立的取消链路工程。
- CI 不跑测试：待办，与本计划无关。
