# 文档索引与权威口径（总纲）

> 一句话用途：本仓库的文档地图 + 单一事实源（SSOT）表 + 同步铁律 + 冲突登记。
> **裁定原则：文档与代码冲突时，一律以代码为准**（`src/`、`package.json`、`vite.config.ts`、`tests/` 为唯一权威源）。
> 最近一次全量核对：2026-09-21，逐条带 `文件:行` 取证（`npx tsc --noEmit` 通过、`npm run test` 30 文件 / 393 用例通过）。

---

## 0. 为什么需要这份文档

同一事实在多份文档里各写一遍，必然漂。下面五条都真实发生在本仓库（不是假想）：

1. **文档写了代码里没有的功能**：`README` 与 `AGENTS.md` 都写步骤 1 可「AI 对话 / 多轮对话优化」，但 `StepIdea.tsx` 只有想法输入框 + 内嵌润色，聊天抽屉 `AiAssistDrawer` 早已删除（计划残留在被 gitignore 的 `.qoder/plan-ai-assist.md`）。
2. **文档自己过时无效**：`docs/history/2026-09-12-b-plan-prompt-architecture.md` 原文自称「设计稿，未实施」，而它描述的规则注册表、`style` 资产、多参考图、档位 `size` 全部已落地。
3. **门禁状态是假的**：`AGENTS.md` 曾写「当前 `npm run test` 在收集阶段失败，不能将“测试已通过”写入报告」，实测 393 个用例全通过。
4. **声称的许可证不存在**：两份 README 都写「MIT License」，仓库里没有 `LICENSE`，`package.json:3` 仍是 `"private": true`。
5. **函数已删但文档与注释还在引用**：`generateScript`、`extractAssetsFromIdea`、`ensureStyleAsset` 在 `src/` 中已无定义，此前仍出现在 `AGENTS.md` 与 `src/lib/promptRules.ts`、`src/lib/shotFields.ts` 的注释里（本轮已一并改名）。

根治办法：关键事实收敛到 §2 的 SSOT 表，其它文档**只引用、不复述数值**；同步动作写进 §3；冲突留在 §4 直到结案。

---

## 1. 文档地图

### 1.1 根目录（长期文档，只留门户与宿主入口）

| 文档 | 管什么 | 类型 | 与代码一致性 | 权威度 |
| --- | --- | --- | --- | --- |
| `README.md` | 门户：解决什么问题→看哪份、6 步流程、能力与**明确不支持**、命令、配置、部署 | 教程 + 解释 | 🟢 2026-09-21 重写并逐条取证 | 对读者最高 |
| `README_EN.md` | 同上英文版（中英口径强制一致） | 教程 + 解释 | 🟢 同上 | 同上 |
| `AGENTS.md` | AI 协作者的强制工程约定（分层、SSOT、异步写回、测试、提交） | 参考 + 约定 | 🟢 2026-09-21 已按代码订正 18 处；时点审计已迁出本文件 | 工程约定最高；事实性数值仍以 §2 的代码载体为准 |

### 1.2 `docs/` 顶层（现行参考）

| 文档 | 管什么 | 读者什么时候看 | 一致性 | 权威度 |
| --- | --- | --- | --- | --- |
| `docs/execution-flow.md` | 6 步链路「谁触发 → 发什么请求 → 写回什么 → 门禁如何放行」，§11 文档漂移清单、§12 代码可疑点、§13 持久化迁移 | 改任何生成链路之前 | 🟢 2026-09-21 快照 | **流程、门禁与代码级待办的权威**；§12 是待裁决清单，不是缺陷定论 |
| `docs/execution-flow-diagrams.md` | 全参数进出与请求体的 ASCII 图集 + 图 A 术语对照总表 | 想知道某个字段叫什么、喂给谁 | 🟢 2026-09-21 快照 | **字段命名与术语的权威**（与上者分工：那边管流程，这边管参数） |
| `docs/idea-breakdown.md` | 一句想法被拆成哪些字段 + 提示词原文 + 引用去向表 | 调提示词 / 看拆解形态 | 🟢 2026-09-21 已同步「镜头数由模型判断」的新提示词原文 | 提示词原文的**快照**；生效版 = 骨架 + 用户条目，以设置里「导出」为准 |
| `docs/flow-map.html` | 交互式引用图（56 节点含 20 个动作节点），点方块按跳数高亮下游 | 追一个字段的全部消费者 | 🟢 2026-09-21 同步镜头数口径 | 与 `execution-flow.md` 同源、**手工同步**，改链路须一并更新 |
| `docs/all-assets-structured-plan.md` | 「代码管结构与流程、效果判断归大模型」的落地方案与两阶段取舍 | 想改提示词职责边界 / 加参数前 | 🟢 状态「已实施 2026-09-15」与代码一致 | 该原则的决策依据（下一步建议提炼为 ADR） |

### 1.3 `docs/roadmap/`（演进规划）

| 文档 | 管什么 | 状态 |
| --- | --- | --- |
| `docs/roadmap/competitive-gap-2026-09-21.md` | 对标 Runway / LTX / Flow+Veo / 可灵等，列提示词与流程结构层缺口 | 🟢 评审待决；其「现状」引用四份流程快照，代码变动后需复核 |

### 1.4 `docs/history/`（时点快照，入库即冻结，只准加顶部修订）

| 文档 | 当时结论 | 现在还剩什么有用 | 一致性 |
| --- | --- | --- | --- |
| `2026-08-18-test-report.md`（原根目录 `TEST_REPORT.md`） | 构建 + 手工 API 探测「15/15 通过」 | 无现行价值 | 🔴 已加顶部修订：模型名与旧视频参数体系全废弃；它不是 Vitest 报告 |
| `2026-08-18-product-optimization.md` | 能力矩阵 + 走查修复记录 | 演进对照 | 🔴 已加修订：「分镜字段可编辑」失效，`FinalPreview` 现为孤儿组件 |
| `2026-08-18-user-journey-review.md` | 浏览器走查 P0/P1 清单 | 回归线索 | 🔴 已加修订：P0 已修复；浏览器走查方式已被铁律禁止；页面标题已改 |
| `2026-08-18-video-generation-investigation.md` | 视频不出片的 4 个根因 + 实测 | **第七、八节仍有效**（成片地址在顶层 `url`、CDN 域名、提示词被兜底覆盖） | 🔴 已加修订：第二、三节旧视频参数体系废弃 |
| `2026-08-24-product-usage-review.md` | 功能使用层调研 | 历史基线 | 🔴 已加修订：走查方式失效，步骤 2 与自动化结论被 2026-09 重构覆盖 |
| `2026-09-12-b-plan-prompt-architecture.md` | 中文主数据 + AI 派生提示词设计稿 | L1/L2/L3 三层叙述 | 🔴 已加修订：状态由「未实施」更正为**已实施**；§5.3 多参考口径被 2026-09-15 推翻 |
| `2026-09-13-agents-audit.md` | 从 `AGENTS.md` 抽出的时点审计结论 | 三条红线仍有效（已保留在 `AGENTS.md`） | 🔴 已加修订：测试门禁、负向提示词、分镜数量三条已结案 |

历史快照**不得作为现行协议引用**；需要现行事实时回 §2 的代码载体。

### 1.5 目标结构的剩余待办（本轮未做）

```text
docs/design/          ⬜ 四份流程参考与资产模型文档待并入（见 §4-C18）
docs/adr/             ⬜ 决策记录待建：0001 代码管结构·效果归模型 / 0002 风格母版不作 i2i 参考
                        / 0003 替换式资产提取 / 0004 只做单元测试
docs/guides/          ⬜ 操作指南待建：跑通第一个项目 / 换模型 / 调提示词规则 / 自部署
docs/CHANGELOG.md     ⬜ 待建：「更新了什么」的唯一入口（按日期倒序，一次交付一行）；建好前记在本文件 §5
docs/CONTRIBUTING.md  ⬜ 待建：从 AGENTS.md 抽出贡献者视角（环境 / 命令 / 测试 / 提交 / 文档同步）
LICENSE               ⬜ 2026-09-21 决定暂不补；README 已按「保留所有权利」表述，勿再出现 MIT
CI 测试门禁           ⬜ .github/workflows/deploy.yml 仍只构建不跑测试
```

分区原则：`design/` 回答「现在为什么长这样」，`adr/` 回答「为什么选它、放弃了什么」，`guides/` 回答「怎么做一件事」，`roadmap/` 回答「接下来做什么」，`history/` 只回答「某月某日看到了什么」。**「更新了什么」与「为什么这样取舍」必须是两个独立入口**，不得混在快照正文里。

---

## 2. SSOT 权威口径表

> **规则：本节只登记「事实住在哪个代码位置」，不复制数值。** 例外是那些没有单一代码载体、必须写定的口径（产品名、验证方式、许可证状态、镜头数量策略）。其它文档一律写「见 §2 / 见 `文件:行`」。

| 键 | 权威载体（唯一） | 定位 | 核实日期 |
| --- | --- | --- | --- |
| 模型标识符（文本 / 图像 / 视频） | `src/lib/models.ts` | `MODELS` `:6-10` | 2026-09-21 |
| 文本输出预算 | `src/lib/models.ts` | `MAX_OUTPUT_TOKENS` `:18` | 2026-09-21 |
| 套餐 RPM 与订阅配额 | `src/lib/plans.ts` | `PLANS` `:73-134` | 2026-09-21 |
| 图片尺寸档位识别 | `src/lib/plans.ts` | `imageSizeToTier` `:159-169` | 2026-09-21 |
| 出图实际用的 `size` | `src/services/imageService.ts` | `aspectRatioToImageParams` `:72-78`（恒 `1K`，2K/3K/4K 仅预留） | 2026-09-21 |
| 视频 `size` / `seconds` / `mode` | `src/services/videoService.ts` | `VIDEO_SIZE` `:71`、`seconds` 夹取 `:139-143`、`mode` `:149` | 2026-09-21 |
| 视频轮询端点与必带参数 | `src/services/videoService.ts` | `:227`（`{origin}/agnesapi?video_id=…&model_name=…`） | 2026-09-21 |
| 视频完成响应取址链 | `src/services/videoService.ts` | `:288-294`（顶层 `url` 优先，实测推翻文档示例） | 2026-09-21 |
| **镜头数量** | `src/lib/promptRules.ts`：`storyboardOutline` 骨架第 1 条 + 内置条目 `storyboard.shot-count` | **不写固定区间，由模型按想法的叙事复杂度与节奏判断**（2026-09-21 产品决定；用户可在设置「提示词规则」覆盖） | 2026-09-21 |
| 镜头时长白名单 | `src/services/scriptService.ts` | `:369`（仅 `{4,5,8}`，否则回落 5；属结构约束，**不交给模型**） | 2026-09-21 |
| 限流与配额扣减时机 | `src/services/rateLimit.ts` | `guard` `:128-136`（请求前扣，失败不回滚） | 2026-09-21 |
| 批量并发度 | `useAssetActions.ts:489`、`useImageActions.ts:205`、`useScriptActions.ts:37`、`useVideoActions.ts:198-202` | 固定 3 / 3 / 3 / 按套餐 1·2·3 | 2026-09-21 |
| 幂等注册表与批次框架 | `src/lib/batchRunner.ts` + 四个 `use*Actions.ts` 顶部 | `active{Script,Asset,Image,Video}Tasks` | 2026-09-21 |
| 取消能力现状 | 全仓 `controller.abort()` 共 5 处（`StepAssembly.tsx:114`、`fetchWithRetry.ts:106,115`、`renderService.ts:109,112`） | **只有第 6 步拼接可取消**；批量生成无取消入口 | 2026-09-21 |
| 提示词任务与骨架 | `src/lib/promptRules.ts` | `PromptTask` `:21-33`（12 个任务）、`SKELETONS`、`BUILTIN_RULES` | 2026-09-21 |
| 生效提示词 = 骨架 + 用户条目 | `settingsStore.promptRules`（persist v4）覆盖内置 | 界面「导出」为准 | 2026-09-21 |
| 采样参数决策与缓存 | `src/lib/generationParams.ts` | `resolveGenerationParams`、缓存 key `${purpose}:${cacheKey}` | 2026-09-21 |
| `seed` 合法域与使用范围 | 实测 `-1..999`；`randomSeed()` 在 `useCharacterEditorActions.ts:38` | **仅角色定妆照重生成传 `seed`** | 2026-09-21 |
| 分镜图参考图选取 | `src/lib/promptComposer.ts` `pickShotReferences` | 只取 角色定妆照 → 主体 → 道具；场景图与风格母版不进参考；代码上限 4（注释写 3，见 §4-C13） | 2026-09-21 |
| 数据模型 | `src/stores/projectTypes.ts` | `AssetType` `:59`（五类）、`AspectRatio` `:28`、`WizardStep` `:30` | 2026-09-21 |
| 级联失效规则 | `src/stores/projectOps.ts` | `applyShotUpdates` `:80-145`、`applyAssetUpdate` `:182-213` | 2026-09-21 |
| 持久化键与版本 | `projectStore.ts:647-650`（`wxhb-project`, v16）、`settingsStore.ts:142-143`（`wxhb-settings`, v4）、`rateLimit.ts:30`（`wxhb-usage`） | 迁移逐版内容见 `execution-flow.md` §13 | 2026-09-21 |
| 向导步骤与门禁 | `src/features/wizard/CreationWizard.tsx` | `TOTAL_STEPS` `:19`、`canAdvance` `:29-43` | 2026-09-21 |
| 步骤显示名 | `src/i18n/index.ts` | `wizard.step1~6`（zh `:177-182`、en `:607-612`）——第 6 步 UI 作「后期 / Post-production」 | 2026-09-21 |
| **对外名称（口径）** | 中文「AI 一键成片」/ 英文与仓库名 `AI Video Maker`；载体：`index.html` 标题、`i18n` 的 `pipeline.title`（zh `:76` / en `:506`） | 2026-09-21 已统一，旧变体全仓零残留 | 2026-09-21 |
| 命令、端口、包版本、Node 要求 | `package.json`、`vite.config.ts`、`vitest.config.ts` | dev 5173 / preview 5180 | 2026-09-21 |
| CI 行为 | `.github/workflows/deploy.yml` | push `main` → 构建 + 部署 Pages，**不含 `npm run test`** | 2026-09-21 |
| **验证方式（口径）** | 只做 Vitest 代码单元测试，**不用浏览器 / E2E / preview 验证界面**，界面由维护者本地确认 | 无工具载体，故在此写定 | 2026-09-21 |
| **许可证（口径）** | **未定**：无 `LICENSE`，`package.json:3` 为 `private: true` → 默认保留所有权利，任何文档不得声称 MIT | 2026-09-21 决定暂不补 | 2026-09-21 |
| 测试规模基线 | `npm run test` | 30 文件 / 393 用例通过（**仅当日快照**，不承诺恒定，现行以运行结果为准） | 2026-09-21 |

---

## 3. 同步铁律

总原则：**代码 / 决策 / 事实变了 ⇒ 文档必须在同一次工作内同步，不许「以后再改」。**

| 你改了什么 | 必须同步 |
| --- | --- |
| 模型名、参数、限额 | 只改 `lib/models.ts` / `lib/plans.ts`，然后 grep 旧值确认全仓零残留（两份 README、`AGENTS.md`、`docs/*.md`、`docs/flow-map.html`） |
| 提示词条目或任务枚举 | `docs/idea-breakdown.md` 的原文引用与行号、`docs/flow-map.html` 的节点说明；新增任务同步 `PromptTask` |
| 6 步链路、门禁、写回规则 | `docs/execution-flow.md`（流程权威）+ `docs/execution-flow-diagrams.md`（参数权威）+ `docs/flow-map.html`（同源手工更新） |
| 数据结构 / 持久化字段 | `projectTypes.ts` + 新增 persist 版本与迁移 + `tests/stores/projectMigrate.test.ts` 回归；再同步 `execution-flow.md` §13 与本文件 §2 |
| 用户可见文案 | `src/i18n/index.ts` zh + en 同时改（禁止组件内硬编码；现存违例见 `execution-flow.md` §12-13） |
| 新增/删除/移动文件、目录、命令 | 两份 README 的目录结构与命令表 + `AGENTS.md` 项目结构 + 本文件 §1 |
| 一次交付 | `docs/CHANGELOG.md` 加一行结论（待建后生效）；建好前记在本文件 §5 |
| 一个架构取舍 | 新增或更新 `docs/adr/NNNN-*.md`（待建后生效），并在 §2 加键 |
| 本文件任何一行 | §5 追加日志；被解决的旧冲突在 §4 结案，不许只改新条目 |

必做 4 步：① 先改 §2 的权威载体 → ② grep 全仓扫旧值（含 `docs/`、`README*`、`AGENTS.md`）→ ③ 更新受影响文档的状态标记与本文件 §1 一致性列 → ④ 追加 §5 日志，未解冲突登记 §4。

禁止：在多份文档复述 §2 的数值；把 `docs/history/` 的快照当现行协议引用；未实测就写具体限额或响应字段；搬迁文件后不重写入站链接；改了代码不改文档。

---

## 4. 冲突与待确认登记

严重度：🔴 会误导读者/导致错误改动 · 🟠 描述失准 · ⚪ 卫生问题。状态：⬜ 未处理 · ✅ 已处理（2026-09-21）。

| ID | 冲突 | 严重度 | 证据 | 处置 |
| --- | --- | --- | --- | --- |
| C1 | README 中英版宣称步骤 1 可「AI 对话」，代码无该功能 | 🔴 | 旧 `README.md:31` / `README_EN.md:31`；`StepIdea.tsx` 无 chat，仅 `AiPolishField`（`:12,135`） | ✅ 两份 README 改为「明确不支持」清单；`AGENTS.md` 结构注释同句已订正 |
| C2 | README 声称 MIT，但无 `LICENSE` 且 `private: true` | 🔴 | `package.json:3`；根目录无 `LICENSE` | ✅ README 改为「许可证未定，保留所有权利」；⬜ 若日后开源需确认许可证与版权人 |
| C3 | B 方案文档状态「设计稿，未实施」，实为已实施且部分被推翻 | 🔴 | 注册表与 `style` 资产已在用（`projectTypes.ts:59`）；§5.3 多参考口径与 `promptComposer.pickShotReferences` 相反 | ✅ 迁入 `docs/history/` + 顶部修订（状态更正、参考图口径作废、`size` 恒 1K） |
| C4 | `AGENTS.md` 称单元测试在收集阶段失败、不能写入通过结论 | 🔴 | 实测 `Test Files 30 passed`、`Tests 393 passed` | ✅ 已改为实测结论 + 保留真实缺口「CI 不跑测试」（转 §1.5 待办） |
| C5 | 产品优化报告称分镜字段可编辑 | 🟠 | 现行分镜全只读（改写走 `reviseShot`） | ✅ 迁入 `history/` + 修订 |
| C6 | `AGENTS.md` 仍列 `features/history/`、`CharacterPanel.tsx`、`HistoryEntry`，persist 版本写 v11 | 🟠 | 原 `:40`、`:38`、`:272`、`:311`、`:324`；`src/` 内零命中 | ✅ 项目结构整块重写、数据模型整节重写、迁移版本改 v16 |
| C7 | 镜头数 4-6（文档）vs 4-8（提示词） | 🔴 | 原 `AGENTS.md` 两处与 `promptRules.ts` 骨架、`storyboard.shot-count` 条目 | ✅ **已裁定：数量由模型判断**。代码骨架与内置条目已改（zh/en 同步），失效断言已更新；`AGENTS.md` 立「不得再写固定区间」约束；`idea-breakdown.md` 与 `flow-map.html` 的原文引用已同步 |
| C8 | `AGENTS.md` 与两处代码注释引用已不存在的 `generateScript` / `extractAssetsFromIdea` / `ensureStyleAsset` | 🟠 | 原 `AGENTS.md` 三条铁律；`promptRules.ts`、`shotFields.ts` 注释 | ✅ 全部改为现行名（`generateStoryboardOutline` / `generateStoryboardShot` / `extractAssetsByType` / `generateStyleReference` 懒建） |
| C9 | 铁律「取消、项目切换、组件卸载不能遗留任务」与实际相反 | 🔴 | `controller.abort()` 仅 5 处（见 §2） | ✅ 铁律标注为「目标态」并列实测证据；README 同步写明不可取消 |
| C10 | 文档称出图 `size` 用 `1K`/`2K` 档位、风格图占参考末位 | 🟠 | `imageService.ts:72-78` 恒 `1K`；`ImageSizeTier` 的 `2K` 无调用点 | ✅ 铁律改写为「恒 1K，高档位仅预留」+ 风格母版不作参考图 |
| C11 | `AGENTS.md` 称主页面「三栏：侧边栏 \| 向导 \| 编辑器」 | 🟠 | `ProjectWorkspace.tsx:110-123` 实为左栏 + 向导两栏 + 底部日志坞 | ✅ 已按实际布局改写 |
| C12 | `AGENTS.md` 称 `chatService` 的 8 个提示词常量已整体搬迁 | ⚪ | `chatService.ts:41-49` 实为 re-export 7 个，三个编辑提示词在 `promptRules.ts` | ✅ 数量与归属已订正 |
| C13 | `pickShotReferences` 注释写「总上限 3 张」，代码为 `out.length < 4` | ⚪ | `promptComposer.ts:289` | ⬜ 属代码问题，与 `execution-flow.md` §12-12 一并裁决（改注释或改上限） |
| C14 | 文档暗示所有重生成都传 `seed` | ⚪ | 定义与唯一调用点在 `useCharacterEditorActions.ts:38,157` | ✅ 已限定为「仅定妆照重生成传 `seed`」 |
| C15 | 对外名三处不一致（`AI Canvas Creator` / `AI Video Creator` / `AI Video Maker`） | 🟠 | 原 `index.html:24`、`i18n:506` | ✅ 已统一为 中文「AI 一键成片」/ 英文 `AI Video Maker`；业务文件内旧变体零残留（`test-results/` 的 Playwright 历史产物除外，属 gitignore） |
| C16 | `TEST_REPORT.md` 留在根目录，名字像现行测试报告 | 🟠 | 内容是 2026-08-18 手工 API 探测（旧模型世代） | ✅ `git mv` → `docs/history/2026-08-18-test-report.md` + 修订 |
| C17 | 缺 OSS 基本件：`CONTRIBUTING`、`CHANGELOG`、`adr/`；规范无工具执行（无 eslint / prettier / `.editorconfig`） | 🟠 | `package.json:12-25`、根目录 `ls` | ⬜ 待点头新建（§1.5）；`SECURITY.md` 判定可暂缓（纯前端、无服务端攻击面，README 已含密钥卫生要求） |
| C18 | 四份流程参考仍在 `docs/` 顶层，与 `history/`、`roadmap/` 分区不对称 | ⚪ | `ls docs` | ⬜ 并入 `docs/design/`（§1.5），搬迁需同步改两份 README 与 `AGENTS.md` 链接 |

---

## 5. 变更日志

| 日期 | 变更 | 责任人 |
| --- | --- | --- |
| 2026-09-21 | 新建本索引；按源码取证重写 `README.md` / `README_EN.md`（删幽灵功能「AI 对话」、撤回 MIT 声明、新增「明确不支持」清单、目录与命令按实际文件对齐、限额表改为引用 `plans.ts`）；登记 C1–C17 | Qoder（文档审计） |
| 2026-09-21 | **口径落地 + 第 1、2 批搬迁**：镜头数量改由模型判断（`promptRules.ts` 骨架 zh/en + `storyboard.shot-count` 条目，失效断言同步更新，`idea-breakdown.md` / `flow-map.html` 原文引用同步）；对外名统一（`index.html` 标题、`i18n.pipeline.title` en）；`AGENTS.md` 18 处事实订正 + 时点审计整节迁出为 `docs/history/2026-09-13-agents-audit.md`；6 份快照 `git mv` 进 `docs/history/` 并逐份加顶部修订；全仓入站链接重写（含 `vite.config.ts`、`settingsStore.ts` 注释、`docs/roadmap` 引用）；C1–C12、C14–C16 结案，新增 C18 | Qoder（文档治理） |
