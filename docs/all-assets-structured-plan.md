# 全资产结构化方案：代码管结构流程，效果归大模型

> 状态：**已实施**（2026-09-15）
> 背景：资产生图多轮修补中积累的代码特化逻辑（动画专用风格板模板、全局关键词清洗）跨风格会误伤；且风格资产提取后 6 个结构化字段在部分链路被丢弃。

## 1. 用户确立的原则（不可违背）

1. **代码只做两件事：结构化数据模型 + 流程控制**（幂等、并发、版本、参考图策略、写回）。
2. **所有效果判断归大模型**：提示词怎么写、风格板写什么、类型边界怎么表达、"写提示词的任务规格"的内容，全部由大模型决定。
3. **代码不替模型做效果判断**：不做全局关键词清洗（如 fur/plush → 抽象材质），不写风格特化模板（如 abstract cartoon / rounded geometric forms）。
4. **校验也是 LLM 任务**：越界判断（风格图提示词是否混入角色/剧情）交给大模型，输入为项目自身数据（角色名、资产名），数据驱动。
5. **任务规格进版本库**：meta-prompt 是项目配置（`promptRules` 机制），可被用户维护，每次请求复用同一份，不由 LLM 现编。

## 2. 现状盘点

| 层 | 现状 | 缺口 |
|---|---|---|
| 角色/场景/产品/道具 | 已有结构化 `details`（CharacterDetails 等） | 无 |
| 风格（视觉方向） | `VisualDirection` 六个平铺自然语言字段；`AssetDetails` union 无 style 成员 | 风格资产提取后 6 字段被丢弃（`generateScript` 只保留 name+description）；编辑器与派生链直接读平铺字段 |
| 风格图提示词 | 代码拼接动画专用模板 + 全局关键词清洗（`sanitizeVisualDirectionField`） | 违反原则 3，跨风格误伤（写实 skin/hair、毛绒产品 plush 等会被错误改写） |
| 资产提取写回 | `useScriptActions` 对 6 字段做 sanitize 后写回 | 同上 |
| 持久化 | persist v13 只迁移非 style 资产 details | style 资产无 details；视觉方向 6 字段平铺在 `Project.visualDirection` |

## 3. 目标数据模型

```
VisualDirection（视觉方向，项目级）
  name: string                  // 方向名称（如"温暖治愈 3D 动画风"）
  description?: string          // 一句话简介（外层卡片展示用）
  details: StyleDetails         // 六个结构化维度（新增，替代平铺 6 字段）
  revision / status             // 既有

AssetDetails（全资产类型化）
  CharacterDetails（既有）
  SceneDetails（既有）
  ProductDetails（既有）
  PropDetails（既有）
  StyleDetails（新增，与视觉方向共用同一组六维字段）
    mediumMaterial  媒介与材质
    colorPalette    色彩
    lightingMood    光影
    cameraTexture   镜头质感
    composition     构图
    emotion         情绪氛围
```

原则：**视觉方向 = 风格资产的 L1 事实源**，两者共用 `StyleDetails`，字段只定义一次。

## 4. 提示词职责分层（实施后的最终形态）

```
用户想法
  → [LLM·任务A] 提取视觉方向（六维结构化 + 一句话简介）
  → [LLM·任务B] 提取资产（各类型 details + appearancePrompt）
  → [LLM·任务C] 派生英文 stylePrompt（输入：六维结构化字段 + 风格名，无故事上下文）
  → [LLM·任务D] 校验 stylePrompt（输入：提示词 + 项目角色名/资产名单，判断是否混入
     角色/剧情主体；越界 → LLM 重写一次）
  → [代码] 按资产类型编译生图请求（assetImageBoundary 一句话边界 + 参考图策略）
  → [图像模型] 出图
```

代码不新增任何语义判断；`assetImageBoundary` 这类**类型边界短句**属于"参考图策略"（只继承画风、不复制内容/主体），是通用机制而非效果判断，保留。

## 5. 改动清单

| 文件 | 改动 |
|---|---|
| `src/stores/projectStore.ts` | 新增 `StyleDetails`；`VisualDirection` 六字段收敛为 `details: StyleDetails`（+`description`）；persist v13→v14：旧 6 字段平移进 `details`，旧 style 资产物化 `details`（从 description 归一化，与 v13 一致幂等） |
| `src/lib/assetDetails.ts` | 支持 `type==="style"` 归一化（六维 label 解析） |
| `src/lib/promptComposer.ts` | 删除 `sanitizeVisualDirectionField` 全部语义替换逻辑；`getStylePrompt` 不再清洗；`composeStyleReferencePrompt` 去卡通特化，改为通用"风格研究参考图"框架（主体/剧情由 LLM 任务规格约束，不再写死 fur/hair 等禁止词）；新增 `collectSubjectVocabulary`（审计禁止清单，只取项目自身非风格资产名） |
| `src/lib/promptRules.ts` | `visualDirection` / `extractAssets` 骨架 schema 改为 `{ name, description, details }`；新增 `stylePromptAudit` 任务（LLM 校验/重写越界提示词，数据驱动：输入项目角色与资产名） |
| `src/services/scriptService.ts` | `RawStyle` 增加 `details`；`generateScript` 的 styles 提取保留 details（不再只留 name+description）；`extractVisualDirectionFromIdea` 返回含 details |
| `src/lib/extractAssets.ts` | style 分支写入 `details` |
| `src/features/wizard/useAssetActions.ts` | `deriveStylePrompt` 读 `styleAsset.details`（或 `project.visualDirection.details`）；派生后调用 `stylePromptAudit` LLM 校验，越界重写一次；移除全部 sanitize 调用 |
| `src/features/wizard/useScriptActions.ts` | 写回 `visualDirection` 改为 details 结构，移除 sanitize |
| `src/features/wizard/VisualDirectionEditor.tsx` | 解析/回填 details 结构；旧数据（平铺 6 字段）由 migrate 兜底，编辑器兼容读取 |

## 6. 兼容与迁移

- persist v14 迁移幂等；旧数据（平铺 6 字段 / 无 style details）自动平移，运行期双读兜底。
- 不动 `Asset.prompt`（英文 L2 派生物）、`appearancePrompt`、`fullPrompt` 现有语义。
- 移除 sanitize 后，**历史项目里已被写进 visualDirection 的污染字段不会自动变干净**——重新走"想法 → 提取"即可用新 LLM 任务覆盖；与既有"修改视觉方向 → 清空旧 style prompt/图"机制配合。

## 7. 验证

- 单测：新增 style 归一化 / `composeStyleReferencePrompt` 新契约 / `collectSubjectVocabulary` / v14 迁移（含幂等）用例；删除旧 sanitize 断言。
- 结果：`npm run test` 281 项通过（22 个文件）；`npx tsc --noEmit`、`git diff --check`、`npm run build` 全部通过。
- 项目铁律：不用浏览器/preview 验证界面，界面效果由用户在本地确认。

## 7.1 已知取舍（需实测确认）

- 移除关键词清洗与动画专用模板后，风格母版的质量完全取决于 `styleRef` 任务规格与模型输出；若仍出现主体化材质（如 `fuzzy plush` 被画成毛绒），**正确做法是调整任务规格或审计任务（meta-prompt 版本化配置），不是把正则加回来**。
- 审计任务仅在项目存在非风格资产名时触发（无清单则跳过，不额外消耗 token）。
- 历史项目里已被写入的污染视觉方向字段不会自动变干净：重走"想法 → 提取"或用编辑器修改视觉方向即可覆盖（后者会同时清空旧 style prompt/图并解锁）。

## 8. 明确不做（防跑偏）

- 不做"参考图影响强度"参数（当前 API 无此参数）。
- 不做图像生成后的视觉内容质检（下一期再评估，需图像理解模型）。
- 不改 `composePortraitPrompt` 的物种锁定（数据驱动关键词，属一致性保护，非效果判断）。
