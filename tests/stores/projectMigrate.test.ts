// ────────────────────────────────────────────────────────────────────────────
// tests/stores/projectMigrate.test.ts
// migratePersistedState 纯函数的单测：
// - v8 → v9：非空 prompt/appearancePrompt 资产获得 derivation.locked=true
// - v9 → v10：单行角色描述恢复为总述 + 8 要素换行格式
// - v7 及更早链式迁移不回归（v1/v7 真实历史结构 → 全链路跑到 v10）
// - 幂等：缺字段/坏结构不抛错，重复执行结果稳定
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { migratePersistedState } from "@/stores/projectStore";

/** 构造带单项目的持久化状态（字段可覆盖） */
function makeState(version: number, project: Record<string, unknown>) {
  return { version, projects: [project] };
}

describe("migratePersistedState：v8 → v9（derivation 补锁）", () => {
  it("非空 prompt 的资产补 derivation.locked=true", () => {
    const state = makeState(8, {
      id: "p1",
      assets: [
        { id: "a1", type: "scene", name: "森林", description: "d", prompt: "a forest, morning light" },
        { id: "a2", type: "product", name: "杯子", description: "d", prompt: "a ceramic cup" },
      ],
    });

    const migrated = migratePersistedState(state, 8);
    const assets = (migrated.projects as Array<{ assets: Array<Record<string, unknown>> }>)[0].assets;

    expect(assets[0].derivation).toEqual({ locked: true });
    expect(assets[1].derivation).toEqual({ locked: true });
  });

  it("非空 appearancePrompt 的角色资产同样补锁", () => {
    const state = makeState(8, {
      id: "p1",
      assets: [
        { id: "a1", type: "character", name: "小白兔", description: "d", prompt: "", appearancePrompt: "a small white rabbit" },
      ],
    });

    const migrated = migratePersistedState(state, 8);
    const assets = (migrated.projects as Array<{ assets: Array<Record<string, unknown>> }>)[0].assets;

    expect(assets[0].derivation).toEqual({ locked: true });
  });

  it("prompt 与 appearancePrompt 均为空的资产不置锁（空派生不锁定）", () => {
    const state = makeState(8, {
      id: "p1",
      assets: [{ id: "a1", type: "scene", name: "s", description: "d", prompt: "  " }],
    });

    const migrated = migratePersistedState(state, 8);
    const assets = (migrated.projects as Array<{ assets: Array<Record<string, unknown>> }>)[0].assets;

    expect(assets[0].derivation).toBeUndefined();
  });

  it("已有 locked=true 的派生元数据不被覆盖（幂等）", () => {
    const state = makeState(8, {
      id: "p1",
      assets: [
        {
          id: "a1",
          type: "character",
          name: "c",
          description: "d",
          prompt: "p",
          derivation: { locked: true, dirty: true },
        },
      ],
    });

    const migrated = migratePersistedState(state, 8);
    const assets = (migrated.projects as Array<{ assets: Array<Record<string, unknown>> }>)[0].assets;

    expect(assets[0].derivation).toEqual({ locked: true, dirty: true });
  });

  it("迁移后的 v10 输入不再改动（幂等：二次执行结果一致）", () => {
    const state = makeState(8, {
      id: "p1",
      assets: [{ id: "a1", type: "scene", name: "s", description: "d", prompt: "p" }],
    });

    const once = migratePersistedState(state, 8);
    const twice = migratePersistedState(
      JSON.parse(JSON.stringify(once)),
      10, // 已到 v10，直接跳过所有分支
    );
    expect(twice).toEqual(once);
  });

  it("version >= 10 时整个迁移为 no-op", () => {
    const state = makeState(10, {
      id: "p1",
      assets: [{ id: "a1", type: "scene", name: "s", description: "d", prompt: "p" }],
    });

    const migrated = migratePersistedState(state, 9);
    const project = (migrated.projects as Array<Record<string, unknown>>)[0];
    expect((project.assets as Array<Record<string, unknown>>)[0].derivation).toBeUndefined();
  });
});

describe("migratePersistedState：v9 → v10（角色描述格式恢复）", () => {
  it.each([null, undefined, [], "bad", 42])("坏根结构 %j 不抛错", (persisted) => {
    expect(() => migratePersistedState(persisted, 9)).not.toThrow();
    expect(migratePersistedState(persisted, 9)).toEqual({});
  });
  it("将单行分号/句号分隔的角色描述迁移为 9 行", () => {
    const state = makeState(9, {
      id: "p1",
      assets: [
        {
          id: "c1",
          type: "character",
          name: "小猪",
          description: "一只可爱的小猪。物种：猪。身份：主角。年龄：幼年。性格：活泼。外貌：粉色圆滚。服饰：无。记忆点：卷尾巴。背景：乡村居民。",
          prompt: "pig",
        },
      ],
    });

    const migrated = migratePersistedState(state, 9);
    const project = (migrated.projects as Array<Record<string, unknown>>)[0];
    const character = (project.assets as Array<Record<string, unknown>>)[0];

    expect(character.description).toBe(
      "一只可爱的小猪\n物种：猪\n身份：主角\n年龄：幼年\n性格：活泼\n外貌：粉色圆滚\n服饰：无\n记忆点：卷尾巴\n背景：乡村居民",
    );
  });

  it("坏的角色 description 类型不抛错且保持原对象", () => {
    const state = makeState(9, {
      id: "p1",
      assets: [{ id: "c1", type: "character", name: "角色", description: 123, prompt: "character" }],
    });
    expect(() => migratePersistedState(state, 9)).not.toThrow();
    const migrated = migratePersistedState(state, 9);
    const asset = (migrated.projects as Array<Record<string, unknown>>)[0].assets as Array<Record<string, unknown>>;
    expect(asset[0].description).toBe(123);
  });

  it("非角色资产与无法识别的自由文本保持原样", () => {
    const state = makeState(9, {
      id: "p1",
      assets: [
        { id: "s1", type: "scene", name: "森林", description: "场景。物种：不应改", prompt: "forest" },
        { id: "c1", type: "character", name: "角色", description: "普通自由文本", prompt: "character" },
      ],
    });

    const migrated = migratePersistedState(state, 9);
    const assets = (migrated.projects as Array<Record<string, unknown>>)[0].assets as Array<Record<string, unknown>>;
    expect(assets[0].description).toBe("场景。物种：不应改");
    expect(assets[1].description).toBe("普通自由文本");
  });
});

describe("migratePersistedState：v1 全链路迁移不回归", () => {
  it("v1 单项目 → v9 多项目结构，链路完整跑通", () => {
    const state = {
      project: {
        id: "old_proj",
        title: "旧项目",
        shots: [{ id: "s1", scriptText: "x", visualPrompt: "v", motionPrompt: "m" }],
      },
    };

    const migrated = migratePersistedState(state, 1);
    const projects = migrated.projects as Array<Record<string, unknown>>;

    expect(projects).toHaveLength(1);
    const p = projects[0];
    expect(migrated.activeProjectId).toBe("old_proj");
    // v5：旧向导步骤映射 + automationMode
    expect(p.automationMode).toBe("semi-auto");
    // v3：分镜补 dialogues / activeCharacterIds
    const shots = p.shots as Array<Record<string, unknown>>;
    expect(shots[0].dialogues).toEqual([]);
    expect(shots[0].activeCharacterIds).toEqual([]);
    // v8：v1 无 characters/sceneReferences，assets 为空数组；v10 无角色描述可规范化
    expect(p.assets).toEqual([]);
  });

  it("v7 项目（characters/sceneReferences 并存）→ v9 合并进 assets 且保留原 ID", () => {
    const state = makeState(7, {
      id: "p1",
      wizardStep: 3,
      characters: [
        {
          id: "char_keep",
          name: "小狐狸",
          description: "机灵",
          appearancePrompt: "a small orange fox",
          assetNamespace: "[Fox]",
        },
      ],
      sceneReferences: [
        { id: "scene_keep", name: "森林", description: "d", prompt: "forest", imageUrl: "http://x/1.png" },
      ],
    });

    const migrated = migratePersistedState(state, 7);
    const project = (migrated.projects as Array<Record<string, unknown>>)[0];
    const assets = project.assets as Array<Record<string, unknown>>;

    expect(assets).toHaveLength(2);
    expect(assets[0].id).toBe("char_keep");
    expect(assets[0].type).toBe("character");
    expect(assets[0].prompt).toBe("a small orange fox");
    expect(assets[1].id).toBe("scene_keep");
    expect(assets[1].type).toBe("scene");
    // v7 数据的资产在 v8 合并后于 v9 补锁（appearancePrompt/prompt 非空），再经过 v10 描述迁移
    expect(assets[0].derivation).toEqual({ locked: true });
    expect(assets[1].derivation).toEqual({ locked: true });
  });
});

describe("migratePersistedState：坏结构幂等不抛错", () => {
  it("projects 缺失 / 非数组 / 元素非对象均不抛错", () => {
    expect(() => migratePersistedState({}, 1)).not.toThrow();
    expect(() => migratePersistedState({ projects: "bad" }, 8)).not.toThrow();
    expect(() => migratePersistedState({ projects: [null, 42, "x"] }, 8)).not.toThrow();
  });

  it("assets 缺失 / 非数组 / 元素非对象均不抛错，其余字段原样保留", () => {
    const state = makeState(8, { id: "p1", title: "t" });
    const migrated = migratePersistedState(state, 8);
    expect((migrated.projects as Array<Record<string, unknown>>)[0].title).toBe("t");

    const badAssets = makeState(8, { id: "p1", assets: [null, "x", 7] });
    expect(() => migratePersistedState(badAssets, 8)).not.toThrow();
  });

  it("资产字段类型错误（prompt 为数字）按空处理，不抛错", () => {
    const state = makeState(8, {
      id: "p1",
      assets: [{ id: "a1", type: "scene", name: "s", prompt: 123 }],
    });
    const migrated = migratePersistedState(state, 8);
    const assets = (migrated.projects as Array<{ assets: Array<Record<string, unknown>> }>)[0].assets;
    // prompt 非字符串视为无派生物 → 不置锁
    expect(assets[0].derivation).toBeUndefined();
  });

  it("重复执行（对 v8 输入跑两遍 v9 分支）结果幂等", () => {
    const state = makeState(8, {
      id: "p1",
      assets: [{ id: "a1", type: "scene", name: "s", description: "d", prompt: "p" }],
    });

    const first = migratePersistedState(JSON.parse(JSON.stringify(state)), 8);
    const second = migratePersistedState(JSON.parse(JSON.stringify(state)), 8);
    expect(second).toEqual(first);
  });

  it("assets 为非数组（坏结构）时项目原样保留，不抛错", () => {
    const state = makeState(8, { id: "p1", title: "t", assets: "bad" as unknown });
    const migrated = migratePersistedState(state, 8);
    const project = (migrated.projects as Array<Record<string, unknown>>)[0];
    expect(project.assets).toBe("bad");
    expect(project.title).toBe("t");
  });

  it("资产完全缺 prompt / appearancePrompt 字段：不置锁，其余字段原样保留", () => {
    const state = makeState(8, {
      id: "p1",
      assets: [
        { id: "a1", type: "scene", name: "森林", description: "d", imageUrl: "http://x/1.png" },
      ],
    });

    const migrated = migratePersistedState(state, 8);
    const assets = (migrated.projects as Array<{ assets: Array<Record<string, unknown>> }>)[0].assets;

    expect(assets[0].derivation).toBeUndefined();
    expect(assets[0].imageUrl).toBe("http://x/1.png");
    expect(assets[0].name).toBe("森林");
  });

  it("assets 元素为 null：跳过不置锁，不抛错（元素原样保留）", () => {
    const state = makeState(8, { id: "p1", assets: [null] });
    const migrated = migratePersistedState(state, 8);
    const assets = (migrated.projects as Array<{ assets: Array<Record<string, unknown>> }>)[0].assets;
    expect(assets[0]).toBeNull();
  });
});
