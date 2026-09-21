# 文档索引与权威口径（总纲）

> 一句话用途：本仓库的文档地图 + 单一事实源（SSOT）表 + 同步铁律 + 冲突登记。
> **裁定原则：文档与代码冲突时，一律以代码为准**（`src/`、`package.json`、`vite.config.ts`、`tests/` 为唯一权威源）。
> 最近一次全量核对：2026-09-21，由代码逐条取证（`npx tsc --noEmit` 通过、`npm run test` 30 文件 / 393 用例通过）。

---

## 0. 为什么需要这份文档

同一事实在多份文档里各写一遍，必然漂。本轮核对抓到的真实案例（都已发生在仓库里，不是假想）：

1. **文档写了代码里没有的功能**：`README*` 与 `AGENTS.md` 都写步骤 1 可「AI 对话 / 多轮对话优化」，但 `StepIdea.tsx` 只有想法输入框 + 内嵌润色，聊天抽屉 `AiAssistDrawer` 早已删除（计划残留在被 gitignore 的 `.qoder/plan-ai-assist.md`）。
2. **文档自己过时无效**：`docs/b-plan-prompt-architecture.md:3` 自称「设计稿，未实施」，而它描述的规则注册表、`style` 资产、多参考图、档位 `size` 全部已落地。
3. **门禁状态是假的**：`AGENTS.md:207` 写「当前 `npm run test` 在收集阶段失败，不能将“测试已通过”写入报告」，实测 393 个用例全通过。
4. **声称的许可证不存在**：`README.md:177`（旧版）与 `README_EN.md:179`（旧版）都写「MIT License」，仓库里没有 `LICENSE` 文件，`package.json:3` 仍是 `"private": true`。
5. **函数已删但文档与注释还在引用**：`generateScript`、`extractAssetsFromIdea`、`ensureStyleAsset` 在 `src/` 中已无定义，仍出现在 `AGENTS.md` 与 `src/lib/promptRules.ts:199`、`src/lib/shotFields.ts:32` 的注释里。

根治办法：关键事实收敛到下面 §2 的 SSOT 表，其它文档**只引用、不复述数值**；同步动作写进 §3。

---

## 1. 文档地图

### 1.1 根目录（长期文档，只留门户与宿主入口）

| 文档 | 管什么 | 类型 | 与代码一致性 | 权威度 |
| --- | --- | --- | --- | --- |
| `README.md` | 门户：解决什么问题→看哪份、6 步流程、能力与**明确不支持**、命令、配置、部署 | 教程 + 解释 | 🟢 2026-09-21 重写并逐条取证 | 对读者最高 |
| `README_EN.md` | 同上英文版（中英口径强制一致） | 教程 + 解释 | 🟢 同上 | 同上 |
| `AGENTS.md` | AI 协作者的强制工程约定（分层、SSOT、异步写回、测试、提交） | 参考 + 约定 | 🟡 约定部分有效；**项目结构 / 数据模型 / 模型配置 / 铁律细节共约 20 处已漂**（见 §4） | 工程约定最高；事实性描述须以 §2 为准 |

### 1.2 `docs/`（现行参考，按作用分区）

| 文档 | 管什么 | 读者什么时候看 | 一致性 | 权威度 |
| --- | --- | --- | --- | --- |
| `docs/execution-flow.md` | 6 步链路「谁触发 → 发什么请求 → 写回什么 → 门禁如何放行」，含 §11 文档漂移清单与 §12 代码可疑点 | 改任何生成链路之前 | 🟢 2026-09-21 快照，逐条带 `文件:行` | **流程与门禁的权威**；§12 是待裁决代码问题清单，不是缺陷定论 |
| `docs/execution-flow-diagrams.md` | 全参数进出与请求体的 ASCII 图集 + 图 A 术语对照总表 | 想知道某个字段叫什么、喂给谁 | 🟢 2026-09-21 快照 | **数据模型字段命名与术语的权威** |
| `docs/idea-breakdown.md` | 一句想法被拆成哪些字段 + 现行提示词原文 + 引用去向表 | 调提示词 / 看拆解形态 | 🟢 2026-09-21（提示词原文按行号引用，改 `promptRules.ts` 后须复核） | 提示词原文的**快照**；生效版以 `src/lib/promptRules.ts` + 用户条目为准 |
| `docs/flow-map.html` | 交互式引用图（56 节点含 20 个动作节点），点方块按跳数高亮下游 | 追一个字段的全部消费者 | 🟢 2026-09-21 | 与 `execution-flow.md` 同源，**手工同步**，改链路须一并更新 |
| `docs/all-assets-structured-plan.md` | 「代码管结构与流程、效果判断归大模型」的落地方案与取舍（两阶段） | 想改提示词职责边界 / 加参数前 | 🟢 状态标「已实施 2026-09-15」，与代码一致 | 该原则的**决策依据**（建议提炼为 ADR，见 §1.4） |

### 1.3 `docs/`（历史快照，入库即冻结，只准加顶部修订）

| 文档 | 当时结论 | 现在还剩什么有用 | 一致性 |
| --- | --- | --- | --- |
| `docs/b-plan-prompt-architecture.md` | 中文主数据 + AI 派生英文提示词的架构设计稿 | 三层数据模型（L1/L2/L3）叙述仍成立 | 🔴 **状态行错误**（写「未实施」实为已实施）；§5.3 的多参考口径已被 2026-09-15 事故决策推翻（见 §4-C3） |
| `docs/product-optimization.md` | 2026-08-18 能力矩阵 + 走查修复记录 | 「已实现能力」清单可作演进对照 | 🔴 表格写「分镜管理 ✅ 编辑文案、画面提示词、动态提示词和时长」，现行是**分镜全只读**；已在 §4-C5 结案 |
| `docs/user-journey-review-2026-08-18.md` | 浏览器走查 + P0/P1 清单 | 问题清单本身是好的回归线索 | 🔴 走查类结论（异步 projectId、FinalPreview 死代码、删除语义）已修复；且其验证方式（真实浏览器）已被项目铁律禁止 |
| `docs/video-generation-investigation-2026-08-18.md` | 视频不出片的 4 个根因 + 实测证据 | **第七、八节仍有效**：成片 URL 在顶层 `url`、CDN 域名 `cos-platform-outputs.agnes-ai.cn`、提示词被兜底覆盖的根因 | 🔴 第二、三节基于 `agnes-video-v2.0` 的 `num_frames` / `frame_rate` 参数体系已整体废弃（现 2.5 Flash 用 `seconds` + `720P`） |
| `TEST_REPORT.md`（仍在根目录） | 2026-08-18 构建 + API 手工探测「15/15 通过」 | 无现行价值（模型名、图片模型、视频参数全是旧世代） | 🔴 已带历史警示头，但**文件名与位置会误导**：它不是 Vitest 报告，`AGENTS.md:207` 的假门禁结论正是被这类文件带偏 |

### 1.4 建议的目标结构（**本轮未执行**，等授权后按 §3 搬迁）

```text
README.md                  # 门户（中英）
README_EN.md
AGENTS.md                  # 只留长期工程约定，事实性表格改为引用 §2
LICENSE                    # ⬜ 待你决定（当前决定：暂不补，README 已写「保留所有权利」）
docs/
├── index.md               # 本文件：文档地图 + SSOT + 铁律 + 冲突登记  ← 现行入口
├── CHANGELOG.md           # ⬜ 待建：「更新了什么」唯一入口（按日期倒序，一次交付一行）
├── CONTRIBUTING.md        # ⬜ 待建：从 AGENTS.md 抽出贡献者视角（环境 / 命令 / 测试 / 提交 / 文档同步）
├── design/                # 设计与边界（现行）
│   ├── execution-flow.md
│   ├── execution-flow-diagrams.md
│   ├── idea-breakdown.md
│   ├── flow-map.html
│   └── asset-model.md     # ← all-assets-structured-plan.md 更名（已实施，不再是 plan）
├── adr/                   # ⬜ 待建：决策记录（背景 / 决策 / 后果 / 证据）
│   ├── 0001-code-structure-model-decides-effect-belongs-to-llm.md
│   ├── 0002-style-master-image-not-an-i2i-reference.md
│   ├── 0003-replace-style-asset-extraction-no-append.md
│   └── 0004-unit-tests-only-no-browser-e2e.md
├── guides/                # ⬜ 待建：操作指南（跑通第一个项目 / 换模型 / 调提示词规则 / 自部署）
├── roadmap/               # ⬜ 待建：演进规划（当前 `execution-flow.md` §12 的 18 条是天然输入）
└── history/               # 时点快照（git mv 进来，文件名带日期，入库即冻结）
    ├── 2026-08-18-user-journey-review.md
    ├── 2026-08-18-video-generation-investigation.md
    ├── 2026-08-18-test-report.md          # ← 现 TEST_REPORT.md
    ├── 2026-08-18-product-optimization.md
    ├── 2026-08-24-product-usage-review.md
    └── 2026-09-12-b-plan-prompt-architecture.md
```

分区理由：`design/` 回答「现在为什么长这样」，`adr/` 回答「为什么选它、放弃了什么」，`guides/` 回答「怎么做一件事」，`roadmap/` 回答「接下来做什么」，`history/` 只回答「某月某日看到了什么」。**「更新了什么」（CHANGELOG）与「为什么这样取舍」（ADR）必须是两个独立入口**，不得混在快照正文里。

---

## 2. SSOT 权威口径表

> **规则：本节只登记「事实住在哪个代码位置」，不复制数值。** 唯一的例外是那些没有单一代码载体、必须写定的口径（产品名、验证方式、许可证状态）。其它文档一律用「见 §2 / 见 `<文件:行>`」引用。

| 键 | 权威载体（唯一） | 定位 | 核实日期 |
| --- | --- | --- | --- |
| 模型标识符（文本 / 图像 / 视频） | `src/lib/models.ts` | `MODELS` `:6-10` | 2026-09-21 |
| 文本输出预算 | `src/lib/models.ts` | `MAX_OUTPUT_TOKENS` `:18` | 2026-09-21 |
| 套餐 RPM 与订阅配额 | `src/lib/plans.ts` | `PLANS` `:73-134` | 2026-09-21 |
| 图片尺寸档位识别 | `src/lib/plans.ts` | `imageSizeToTier` `:159-169` | 2026-09-21 |
| 出图实际用的 `size` | `src/services/imageService.ts` | `aspectRatioToImageParams` `:72-78`（恒 `1K`） | 2026-09-21 |
| 视频 `size` / `seconds` / `mode` | `src/services/videoService.ts` | `VIDEO_SIZE` `:71`、`seconds` 夹取 `:139-143`、`mode` `:149` | 2026-09-21 |
| 视频轮询端点与必带参数 | `src/services/videoService.ts` | `:227`（`{origin}/agnesapi?video_id=…&model_name=…`） | 2026-09-21 |
| 视频完成响应取址链 | `src/services/videoService.ts` | `:288-294`（顶层 `url` 优先） | 2026-09-21 |
| 镜头时长白名单 | `src/services/scriptService.ts` | `:369`（仅 `{4,5,8}`，否则回落 5） | 2026-09-21 |
| 限流与配额扣减时机 | `src/services/rateLimit.ts` | `guard` `:128-136`（请求前扣，失败不回滚） | 2026-09-21 |
| 批量并发度 | `useAssetActions.ts:489`、`useImageActions.ts:205`、`useScriptActions.ts:37`、`useVideoActions.ts:198-202` | 固定 3 / 3 / 3 / 按套餐 1·2·3 | 2026-09-21 |
| 幂等注册表与批次框架 | `src/lib/batchRunner.ts` + 四个 `use*Actions.ts` 顶部 | `active{Script,Asset,Image,Video}Tasks` | 2026-09-21 |
| 提示词骨架与内置条目 | `src/lib/promptRules.ts` | `SKELETONS` + `BUILTIN_RULES`，任务枚举 `PromptTask` `:21-33` | 2026-09-21 |
| 生效提示词 = 骨架 + 用户条目 | `settingsStore.promptRules`（persist v4）覆盖内置 | 界面导出为准 | 2026-09-21 |
| 采样参数决策与缓存 | `src/lib/generationParams.ts` | `resolveGenerationParams` / 缓存 key | 2026-09-21 |
| 数据模型（Project / Asset / Shot / VisualDirection） | `src/stores/projectTypes.ts` | `AssetType` `:59`、`AspectRatio` `:28`、`WizardStep` `:30` | 2026-09-21 |
| 持久化键与版本 | `projectStore.ts:647-650`（`wxhb-project`, v16）、`settingsStore.ts:142-143`（`wxhb-settings`, v4）、`rateLimit.ts:30`（`wxhb-usage`） | 迁移内容见 `execution-flow.md` §13 | 2026-09-21 |
| 级联失效规则 | `src/stores/projectOps.ts` | `applyShotUpdates` `:80-145`、`applyAssetUpdate` `:182-213` | 2026-09-21 |
| 向导步骤与门禁 | `src/features/wizard/CreationWizard.tsx` | `TOTAL_STEPS` `:19`、`canAdvance` `:29-43` | 2026-09-21 |
| 步骤显示名 | `src/i18n/index.ts` | `wizard.step1~6`（zh `:177-182`，en `:607-612`）——注意第 6 步 UI 作「后期 / Post-production」 | 2026-09-21 |
| 命令、端口、包版本、Node 要求 | `package.json`、`vite.config.ts`、`vitest.config.ts` | — | 2026-09-21 |
| CI 行为 | `.github/workflows/deploy.yml` | push `main` → 构建 + 部署 Pages，**不含 `npm run test`** | 2026-09-21 |
| **验证方式（口径）** | 本表：只做 Vitest 代码单元测试，**不用浏览器 / E2E / preview 验证界面**，界面由维护者本地确认 | 无工具载体，故在此写定 | 2026-09-21 |
| **项目名（口径）** | 仓库与文档统一 `AI Video Maker` / `ai-video-maker`；⚠️ 浏览器标题仍是 `AI Canvas Creator`（`index.html:24`），i18n 另有 `pipeline.title` = 「AI 一键成片」，三处待统一 | 无单一载体 | 2026-09-21 |
| **许可证（口径）** | **未定**：仓库无 `LICENSE`，`package.json:3` 为 `private: true` → 默认保留所有权利，任何文档不得声称 MIT | 决定于 2026-09-21 | 2026-09-21 |

---

## 3. 同步铁律

总原则：**代码 / 决策 / 事实变了 ⇒ 文档必须在同一次工作内同步，不许「以后再改」。**

| 你改了什么 | 必须同步 |
| --- | --- |
| 模型名、参数、限额 | 只改 `lib/models.ts` / `lib/plans.ts`（§2），然后 grep 旧值确认全仓零残留（含 README 中英、AGENTS.md、`docs/design/*`） |
| 6 步链路、门禁、写回规则 | `docs/design/execution-flow.md`（流程权威）+ `execution-flow-diagrams.md`（参数权威）+ `flow-map.html`（同源手工更新） |
| 提示词条目 / 任务枚举 | `docs/design/idea-breakdown.md` 里的原文引用与行号；新增任务同步 `PromptTask` |
| 数据结构 / 持久化字段 | `projectTypes.ts` + 新增 persist 版本与迁移 + `tests/stores/projectMigrate.test.ts` 回归；再同步 `execution-flow.md` §13 |
| 用户可见文案 | `src/i18n/index.ts` zh + en 同时改（禁止组件内硬编码，`execution-flow.md` §12-13 列了现存违例） |
| 新增/删除/移动文件、目录、命令 | `README.md` 与 `README_EN.md` 的目录结构 / 命令表 + `AGENTS.md` 项目结构 + 本文件 §1 |
| 一次交付 | `docs/CHANGELOG.md` 加一行结论（待建后生效） |
| 一个架构取舍 | 新增或更新 `docs/adr/NNNN-*.md`（待建后生效），本文件 §2 加键 |
| 本文件的任何一行 | §5 变更日志追加日期与责任人 |

必做 4 步：① 先改 §2 的权威载体 → ② grep 全仓扫旧值（连带 `../` 与本仓库文档）→ ③ 更新受影响文档的状态标记与本文件 §1 状态列 → ④ 追加 §5 日志，未解冲突登记进 §4。

禁止：在多份文档复述 §2 的数值；把时点快照当现行协议引用；未实测就写具体限额或响应字段；文档改了但 §4 里的旧冲突不结案也不更新。

---

## 4. 冲突与待确认登记

严重度：🔴 会误导读者/导致错误改动 · 🟠 描述失准 · ⚪ 卫生问题。状态：⬜ 未处理 · ✅ 本轮已处理。

| ID | 冲突 | 严重度 | 证据 | 处置 |
| --- | --- | --- | --- | --- |
| C1 | README 中英版都宣称步骤 1 可「AI 对话」，代码无该功能 | 🔴 | 旧 `README.md:31` / `README_EN.md:31`；`StepIdea.tsx` 全文无 chat，仅 `AiPolishField`（`:12,135`） | ✅ 两份 README 已改为「明确不支持」清单；`AGENTS.md:24` 同句（StepIdea 注释「步骤1：想法 + 画幅比例 + AI 对话」）待同批修 |
| C2 | README 声称 MIT，但无 `LICENSE` 文件且 `private: true` | 🔴 | `package.json:3`；根目录无 `LICENSE`（`ls` 实测） | ✅ README 已改为「许可证未定，保留所有权利」；⬜ 若日后要开源，需你确认许可证与版权人署名 |
| C3 | `docs/b-plan-prompt-architecture.md:3` 状态「设计稿，未实施」，实为已实施且部分被推翻 | 🔴 | `promptRules.ts` 注册表已在用；`AssetType` 含 `style`（`projectTypes.ts:59`）；但 §5.3 写「分镜图多参考含场景图与风格图」与现行相反（`execution-flow.md` §6.3：只取 角色→主体→道具） | ⬜ 建议：移入 `docs/history/` 并加顶部修订，现行事实由 `docs/design/execution-flow.md` 承载 |
| C4 | `AGENTS.md:207` 称单元测试在收集阶段失败、不能写入通过结论 | 🔴 | 实测 `npm run test` → `Test Files 30 passed (30)`、`Tests 393 passed (393)`，2026-09-21 | ⬜ 待授权改 `AGENTS.md`；顺带：CI 仍不跑测试，属真实缺口（`deploy.yml`） |
| C5 | `docs/product-optimization.md` 能力矩阵称分镜字段可编辑 | 🟠 | 现行为「分镜全只读」（`AGENTS.md:320`，`ShotDetail.tsx` 无输入框，改写走 `reviseShot`） | ⬜ 归档 `history/` + 顶部修订 |
| C6 | `AGENTS.md:311` 数据模型仍列 `HistoryEntry`；`:40` 仍列 `features/history/`（`HistoryPanel`）；`:38`、`:272` 仍列 `characters/CharacterPanel.tsx` | 🟠 | 全仓 `grep HistoryEntry` / `features/history` 在 `src/` 零命中；`persist` v15 已删 `history` 字段；`AGENTS.md:324` 写「v1 → v11 持续存储迁移」，实际为 v16（`projectStore.ts:648`） | ⬜ 待授权 |
| C7 | `AGENTS.md:213` 称「README/本文件与产品说明采用 4-6 个分镜」，`:221` 亦写 4-6 | 🟠 | 全仓 grep `4-6` 只命中 `AGENTS.md` 自身两行，两份 README 从未写过数字；代码为 4-8（`promptRules.ts:280,307,855`） | ⬜ 数字口径**仍是产品决策**，不擅自统一；README 已改为不写死数字、指向 `storyboard.shot-count` 条目。请裁决：统一到 4-8 / 改回 4-6 / 保持可配置 |
| C8 | `AGENTS.md` 多处引用不存在的函数：`:244` `generateScript`、`:247` `extractAssetsFromIdea`、`:242` `ensureStyleAsset` | 🟠 | `src/` 内无定义（仅 `promptRules.ts:199`、`shotFields.ts:32` 的**注释**残留旧名，`ScriptPanel.tsx:83` 命中的是 i18n key） | ⬜ 改 `AGENTS.md`；两条陈旧注释一并改名（现行：`generateStoryboardOutline` + `generateStoryboardShot`、`extractAssetsByType`、`generateStyleReference` 内懒建） |
| C9 | `AGENTS.md:183` 铁律「取消、项目切换、组件卸载时不能遗留任务」与实际不符 | 🔴 | 全仓 `controller.abort()` 仅 5 处：`StepAssembly.tsx:114`、`fetchWithRetry.ts:106,115`、`renderService.ts:109,112` → 批量生成无取消入口 | ⬜ 铁律应改写为「目标态」并配一条 roadmap；现状已在 README「明确不支持」如实写出 |
| C10 | `AGENTS.md:241` 称出图 `size` 用档位 `"1K"/"2K"` 且「风格图恒占末位，总数 ≤3」；`imageService.ts:9` 的 `ImageSizeTier` 含 `2K` | 🟠 | `imageService.ts:72-78` 恒返回 `1K`；全仓无调用点产生 2K | ⬜ 文档应标为「预留未启用」；`execution-flow.md` §11-15 已记同一条 |
| C11 | `AGENTS.md:20` 称主页面为「三栏：侧边栏 \| 向导 \| 编辑器」 | 🟠 | `ProjectWorkspace.tsx:110-123` 实为左栏 + 向导主区两栏，另有可折叠底部日志坞（`:123`） | ⬜ 待授权 |
| C12 | `AGENTS.md:265` 称 `chatService.ts` 的 8 个 `SYSTEM_PROMPT_*` 已整体搬迁为注册表条目 | ⚪ | `chatService.ts:41-49` 实际 re-export 7 个 `SYSTEM_PROMPT_*`；角色/资产/视觉方向的编辑提示词住在 `promptRules.ts` | ⬜ 数字与清单待订正 |
| C13 | `pickShotReferences` 注释写「总上限 3 张」，代码上限 4 | ⚪ | `promptComposer.ts:289`（`out.length < 4`） | ⬜ 属代码问题，交你在 `execution-flow.md` §12-12 一并裁决（改注释或改代码） |
| C14 | `randomSeed()` 的实际适用范围比文档描述窄 | ⚪ | 定义与唯一调用点都在 `useCharacterEditorActions.ts:38,157`；资产图与镜头图/视频请求不传 `seed` | ⬜ 文档措辞应收敛为「定妆照重生成」 |
| C15 | 项目名三处不一致：`AI Video Maker` / 浏览器标题 `AI Canvas Creator` / i18n `pipeline.title`「AI 一键成片」 | 🟠 | `index.html:24`、`i18n/index.ts:76`、README 标题 | ⬜ 需你定一个对外名；本轮 README 暂用仓库名 |
| C16 | `TEST_REPORT.md` 留在根目录，名字像现行测试报告 | 🟠 | 内容是 2026-08-18 的手工 API 探测（旧模型 `agnes-2.5-flash` / `agnes-video-v2.0`），与 Vitest 无关 | ⬜ 建议 `git mv` → `docs/history/2026-08-18-test-report.md` |
| C17 | 缺少 OSS 基本件：`LICENSE`（你已决定暂不补）、`CONTRIBUTING`、`CHANGELOG`、`SECURITY`；且规范只写在文档里、无 lint 工具（`package.json` 无 eslint / prettier，根目录无 `.editorconfig`） | 🟠 | `ls` 实测 + `package.json:12-25` | ⬜ 待你点头再建；`SECURITY` 判定为**可暂缓**：纯前端、无服务端攻击面、Key 只存在本地并直连你配置的端点，README 已含密钥卫生要求 |

---

## 5. 变更日志

| 日期 | 变更 | 责任人 |
| --- | --- | --- |
| 2026-09-21 | 新建本索引；按代码逐条取证重写 `README.md` / `README_EN.md`（删除「AI 对话」幽灵功能、撤回 MIT 声明、新增「明确不支持」清单、目录结构与命令表按实际文件对齐、限额表改为引用 `plans.ts` 不复述）；登记 C1–C17，其中 C1 / C2 已处理 | Qoder（文档审计） |
