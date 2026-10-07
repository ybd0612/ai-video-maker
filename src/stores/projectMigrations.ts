// ────────────────────────────────────────────────────────────────────────────
// 拆分自 projectStore.ts（2026-09-15 结构治理）：本文件只承载单一职责，
// 兼容入口保持在 projectStore.ts（re-export）。
// ────────────────────────────────────────────────────────────────────────────

// persist 存储迁移链（v1 → 当前版本）：纯函数、幂等、容错。

import { normalizeCharacterDescription } from "@/lib/promptComposer";
import { normalizeAssetDetails, repairAssetDetails } from "@/lib/assetDetails";
import type { Asset, AssetDetails, Project } from "./projectTypes";

/* ── Persisted-state migration（导出纯函数，便于单测） ───────────────────── */

/**
 * persist 存储迁移主体（纯函数）：v1→v11 全链路迁移。
 * 与 store 实例解耦，tests/stores/projectMigrate.test.ts 可直接调用；
 * 对缺字段/坏结构不抛错，重复执行幂等。
 */
export function migratePersistedState(
  persisted: unknown,
  version: number,
): Record<string, unknown> {
  if (!persisted || typeof persisted !== "object" || Array.isArray(persisted)) {
    return {};
  }
  const state = persisted as Record<string, unknown>;

  // Migrate from v1 (single project) to v2 (multi-project)
  if (version < 2) {
    const old = persisted as Record<string, unknown>;
    const project = old.project as Project | null;
    if (project) {
      state.projects = [project];
      state.activeProjectId = project.id;
    }
  }

  // Migrate from v2 to v3: add character system + dialogue system
  if (version < 3) {
    const projects = state.projects as Array<Record<string, unknown>> | undefined;
    if (projects) {
      state.projects = projects.map((p) => ({
        ...p,
        mode: "simple",
        characters: [],
        shots: ((p.shots as Array<Record<string, unknown>>) ?? []).map(
          (s) => ({
            ...s,
            dialogues: [],
            activeCharacterIds: [],
            activeProductIds: [],
            activePropIds: [],
          }),
        ),
      }));
    }
  }

  // Migrate from v3 to v4: add wizardStep + structured prompt sub-elements
  if (version < 4) {
    const projects = state.projects as Array<Record<string, unknown>> | undefined;
    if (projects) {
      state.projects = projects.map((p) => ({
        ...p,
        wizardStep: 1,
      }));
    }
  }

  // Migrate from v4 to v5: unified flow, remove mode, 6-step wizard
  if (version < 5) {
    const projects = state.projects as Array<Record<string, unknown>> | undefined;
    if (projects) {
      state.projects = projects.map((p) => {
        const { mode, ...rest } = p;
        // Map old wizard steps to new 4-step flow
        const oldStep = (p.wizardStep as number) ?? 1;
        let newStep: number;
        if (mode === "drama") {
          // drama: 1(chars)→skip, 2(idea)→1, 3(storyboard)→2, 4(images)→3, 5(videos)→3, 6(assembly)→4
          newStep = oldStep <= 1 ? 1 : oldStep === 2 ? 1 : oldStep === 3 ? 2 : 4;
        } else {
          // simple: 1(idea)→1, 2(storyboard)→2, 3(images)→3, 4(videos)→3, 5(assembly)→4
          newStep = oldStep <= 2 ? oldStep : oldStep <= 4 ? 3 : 4;
        }
        return { ...rest, wizardStep: newStep, automationMode: 'semi-auto' as const };
      });
    }
  }

  // Migrate from v5 to v6: add sceneReferences and styleReferenceUrl
  if (version < 6) {
    const projects = state.projects as Array<Record<string, unknown>> | undefined;
    if (projects) {
      state.projects = projects.map((p) => ({
        ...p,
        sceneReferences: (p.sceneReferences as unknown[]) ?? [],
        styleReferenceUrl: (p.styleReferenceUrl as string) ?? undefined,
      }));
    }
  }

  // Migrate from v6 to v7: add generation started flags
  if (version < 7) {
    const projects = state.projects as Array<Record<string, unknown>> | undefined;
    if (projects) {
      state.projects = projects.map((p) => ({
        ...p,
        assetGenerationStarted: false,
        imageGenerationStarted: false,
        videoGenerationStarted: false,
      }));
    }
  }

  // Migrate from v7 to v8: 角色/场景/产品统一为 assets 数组。
  // 旧 characters[] / sceneReferences[] 合并进 assets（保持原 ID，
  // 否则对白引用与 activeCharacterIds 会断裂）；风格参考图保留为项目字段。
  if (version < 8) {
    const projects = state.projects as Array<Record<string, unknown>> | undefined;
    if (projects) {
      state.projects = projects.map((p) => {
        const { characters, sceneReferences, ...rest } = p;
        const merged: Asset[] = [
          ...((characters as Array<Record<string, unknown>> | undefined) ?? []).map((c) => ({
            id: c.id as string,
            type: "character" as const,
            name: c.name as string,
            description: (c.description as string) ?? "",
            prompt: (c.appearancePrompt as string) ?? "",
            imageUrl: c.generatedPortraitUrl as string | undefined,
            error: c.error as string | undefined,
            appearancePrompt: c.appearancePrompt as string | undefined,
            assetNamespace: c.assetNamespace as string | undefined,
            fullPrompt: c.fullPrompt as string | undefined,
            avatarUrl: c.avatarUrl as string | undefined,
            multiViewUrl: c.multiViewUrl as string | undefined,
          })),
          ...((sceneReferences as Array<Record<string, unknown>> | undefined) ?? []).map((s) => ({
            id: s.id as string,
            type: "scene" as const,
            name: s.name as string,
            description: (s.description as string) ?? "",
            prompt: (s.prompt as string) ?? "",
            imageUrl: s.imageUrl as string | undefined,
            error: s.error as string | undefined,
          })),
        ];
        return { ...rest, assets: merged };
      });
    }
  }

  // Migrate from v8 to v9: 资产派生元数据（derivation）+ style 资产类型。
  // 不凭空创建 style 资产（无 style 资产的项目维持现状，运行期由
  // useAssetActions.generateStyleReference 懒建补齐）；仅做结构合法化：
  // 已有资产的非空英文派生物（prompt/appearancePrompt）补 derivation.locked=true，
  // 防止后续自动派生覆盖历史内容。重复执行幂等。
  if (version < 9) {
    const projects = state.projects;
    if (Array.isArray(projects)) {
      state.projects = (projects as unknown[]).map((p) => {
        if (!p || typeof p !== "object") return p;
        const proj = p as Record<string, unknown>;
        if (!Array.isArray(proj.assets)) return p;
        return {
          ...proj,
          assets: (proj.assets as unknown[]).map((a) => {
            if (!a || typeof a !== "object") return a;
            const asset = a as Record<string, unknown>;
            const prompt =
              typeof asset.prompt === "string" ? asset.prompt.trim() : "";
            const appearance =
              typeof asset.appearancePrompt === "string"
                ? asset.appearancePrompt.trim()
                : "";
            // 无任何非空派生物：不置锁（空派生不该被锁定）
            if (!prompt && !appearance) return a;
            const derivation =
              asset.derivation && typeof asset.derivation === "object"
                ? (asset.derivation as Record<string, unknown>)
                : {};
            // 幂等：已锁定则原样返回
            if (derivation.locked === true) return a;
            return { ...asset, derivation: { ...derivation, locked: true } };
          }),
        };
      });
    }
  }

  // Migrate from v9 to v10: restore the canonical character description layout.
  // Some model responses were persisted as one line with `。`/`;` separators;
  // normalize those descriptions so existing projects regain summary + 8 rows.
  if (version < 10) {
    const projects = state.projects;
    if (Array.isArray(projects)) {
      state.projects = (projects as unknown[]).map((p) => {
        if (!p || typeof p !== "object") return p;
        const project = p as Record<string, unknown>;
        if (!Array.isArray(project.assets)) return p;
        return {
          ...project,
          assets: (project.assets as unknown[]).map((a) => {
            if (!a || typeof a !== "object") return a;
            const asset = a as Record<string, unknown>;
            if (asset.type !== "character" || typeof asset.description !== "string") return a;
            const description = normalizeCharacterDescription(asset.description);
            return description === asset.description ? a : { ...asset, description };
          }),
        };
      });
    }
  }

  // Migrate from v11 to v12: preserve the new optional visualDirection field.
  // No value is synthesized here; legacy projects continue using style/style asset.
  if (version < 12) {
    const projects = state.projects;
    if (Array.isArray(projects)) {
      state.projects = (projects as unknown[]).map((p) => {
        if (!p || typeof p !== "object") return p;
        const project = p as Record<string, unknown>;
        const direction = project.visualDirection;
        if (!direction || typeof direction !== "object" || Array.isArray(direction)) {
          return { ...project, visualDirection: undefined };
        }
        return project;
      });
    }
  }

  // Migrate from v12 to v13: materialize structured details for all non-style assets.
  // Legacy descriptions remain intact as summaries; missing fields are backfilled
  // from the existing labeled description without overwriting user data.
  if (version < 13) {
    const projects = state.projects;
    if (Array.isArray(projects)) {
      state.projects = (projects as unknown[]).map((p) => {
        if (!p || typeof p !== "object") return p;
        const project = p as Record<string, unknown>;
        if (!Array.isArray(project.assets)) return p;
        return {
          ...project,
          assets: (project.assets as unknown[]).map((raw) => {
            if (!raw || typeof raw !== "object") return raw;
            const asset = raw as Record<string, unknown>;
            if (asset.type === "style" || typeof asset.type !== "string" || typeof asset.description !== "string") return raw;
            const details = normalizeAssetDetails(
              { type: asset.type as Asset["type"], description: asset.description },
              asset.details as AssetDetails | undefined,
            );
            return details ? { ...asset, details } : raw;
          }),
        };
      });
    }
  }

  // Migrate from v10 to v11: normalize shot reference arrays introduced by
  // the explicit scene/product/prop reference contract. Persisted v10 data
  // may have been written before those optional arrays existed.
  if (version < 11) {
    const projects = state.projects;
    if (Array.isArray(projects)) {
      state.projects = (projects as unknown[]).map((p) => {
        if (!p || typeof p !== "object") return p;
        const project = p as Record<string, unknown>;
        if (!Array.isArray(project.shots)) return p;
        return {
          ...project,
          shots: (project.shots as unknown[]).map((s) => {
            if (!s || typeof s !== "object") return s;
            const shot = s as Record<string, unknown>;
            return {
              ...shot,
              dialogues: Array.isArray(shot.dialogues) ? shot.dialogues : [],
              activeCharacterIds: Array.isArray(shot.activeCharacterIds)
                ? shot.activeCharacterIds
                : [],
              activeProductIds: Array.isArray(shot.activeProductIds)
                ? shot.activeProductIds
                : [],
              activePropIds: Array.isArray(shot.activePropIds)
                ? shot.activePropIds
                : [],
            };
          }),
        };
      });
    }
  }

  // Migrate from v13 to v14: consolidate visualDirection's six flat fields into
  // a structured `details` object, and materialize style-asset details (same as
  // v13 for non-style assets). Idempotent — projects already on the new shape
  // are returned unchanged.
  if (version < 14) {
    const projects = state.projects;
    if (Array.isArray(projects)) {
      state.projects = (projects as unknown[]).map((p) => {
        if (!p || typeof p !== "object") return p;
        const project = p as Record<string, unknown>;

        // 视觉方向：平铺 6 字段平移进 details（已有 details 则跳过）。
        const direction = project.visualDirection;
        let migratedDirection = direction;
        if (direction && typeof direction === "object" && !Array.isArray(direction)) {
          const dir = direction as Record<string, unknown>;
          const existingDetails = dir.details;
          if (!existingDetails || typeof existingDetails !== "object" || Array.isArray(existingDetails)) {
            const next = { ...dir };
            next.details = {
              kind: "style" as const,
              mediumMaterial: typeof dir.mediumMaterial === "string" ? dir.mediumMaterial : "",
              colorPalette: typeof dir.colorPalette === "string" ? dir.colorPalette : "",
              lightingMood: typeof dir.lightingMood === "string" ? dir.lightingMood : "",
              cameraTexture: typeof dir.cameraTexture === "string" ? dir.cameraTexture : "",
              composition: typeof dir.composition === "string" ? dir.composition : "",
              emotion: typeof dir.emotion === "string" ? dir.emotion : "",
            };
            delete next.mediumMaterial;
            delete next.colorPalette;
            delete next.lightingMood;
            delete next.cameraTexture;
            delete next.composition;
            delete next.emotion;
            migratedDirection = next;
          }
        }

        // 资产：为 style 资产物化 details（与 v13 非 style 逻辑一致，幂等）。
        let migratedAssets = project.assets;
        if (Array.isArray(project.assets)) {
          migratedAssets = (project.assets as unknown[]).map((raw) => {
            if (!raw || typeof raw !== "object") return raw;
            const asset = raw as Record<string, unknown>;
            if (asset.type !== "style") return raw;
            const existing = asset.details;
            if (existing && typeof existing === "object" && !Array.isArray(existing)) return raw;
            const details = normalizeAssetDetails(
              { type: "style", description: typeof asset.description === "string" ? asset.description : "" },
              undefined,
            );
            return details ? { ...asset, details } : raw;
          });
        }

        return { ...project, visualDirection: migratedDirection, assets: migratedAssets };
      });
    }
  }

  // Migrate from v14 to v15: 停用操作历史（左侧「历史」入口已移除）。
  // 删除持久化的 history 数组，避免脏数据长期驻留 localStorage。幂等。
  if (version < 15) {
    const withHistory = state as Record<string, unknown>;
    if ("history" in withHistory) delete withHistory.history;
  }

  // Migrate from v15 to v16: 用结构驱动的解析重算资产 details。
  // 旧实现按硬编码短标签正则取值，模型改用长标签后出现两类脏数据：
  //   ① 值被前缀污染（personality = "与行为倾向：贪玩…"）；
  //   ② 模型返回的 details 因缺 kind 被整份丢弃 → 视觉方向等设定全空。
  // 修复只补空与纠正污染值，不覆盖看起来正常的既有值。幂等。
  if (version < 16) {
    const projects = (state as { projects?: Array<{ assets?: Asset[] } | null> }).projects;
    if (Array.isArray(projects)) {
      for (const project of projects) {
        // 历史持久化数据可能是坏结构（null / 非对象），一律跳过而非抛错
        if (!project || typeof project !== "object") continue;
        if (Array.isArray(project.assets)) {
          project.assets = project.assets.map(repairAssetDetails);
        }
      }
    }
  }

  // Migrate from v16 to v17: 新增 Shot.shotSize（机读景别）。
  // 刻意不补默认值：景别只能由分镜模型产出，代码凭空补一档会让衔接闸门误放行。
  // 因此本块只做版本号占位与注释锚点，不改写数据；旧镜头保持 undefined（判为未知）。
  if (version < 17) {
    // no-op：见上方说明
  }

  // Migrate from v17 to v18: 新增 Shot.videoTaskId / videoTaskModel（任务恢复用）。
  // 旧数据没有这两个字段：刷新恢复逻辑遇到缺省即按现状走「无在飞任务」路径，
  // 不做任何猜测式补值（模型名与任务 ID 都无法从既有数据推出）。
  if (version < 18) {
    // no-op：见上方说明
  }

  // Migrate from v18 to v19: 新增 Shot.endStateDesc（止态，双帧方案 E）。
  // 与 shotSize 同理刻意不补默认值：止态只能由分镜模型产出，代码凭空补写等于把
  // 模型从未声明的结束状态塞进按秒计费的视频请求。旧镜头保持 undefined，
  // composeMotionPrompt 遇到缺省即不追加结尾句，行为与改造前一致。
  if (version < 19) {
    // no-op：见上方说明
  }

  // Migrate from v19 to v20: 新增 Project.storyBrief（故事骨架）。
  // 刻意不补默认值：故事骨架只能由第一步的 LLM 提取产出，代码凭空造一个
  // 「梗概/主题/节奏」等于把模型从未给出的创作决策塞进下游分镜上下文。
  // 旧项目保持 undefined —— 下游读取时按「未设定」降级为直接用 ideaPrompt 规划。
  if (version < 20) {
    // no-op：见上方说明
  }

  return state;
}
