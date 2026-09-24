// ────────────────────────────────────────────────────────────────────────────
// tests/lib/wizardGating.test.ts
// 向导「下一步」门禁判定的纯函数单测（问题 3）。
// 覆盖四类阻塞原因：无镜头 / 缺分镜文案 / 缺审核标记 / 正在提取中；
// 以及各步放行、半自动 vs 全自动、缺图/缺视频计数等边界。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import type { Project, Shot } from "@/stores/projectStore";
import { evaluateWizardAdvance } from "@/lib/wizardGating";

function makeShot(overrides: Partial<Shot> = {}): Shot {
  return {
    id: `shot_${Math.random().toString(36).slice(2)}`,
    index: 0,
    scriptText: "一段分镜文案",
    visualPrompt: "v",
    motionPrompt: "m",
    dialogues: [],
    activeCharacterIds: [],
    activeProductIds: [],
    activePropIds: [],
    duration: 5,
    status: "videoed",
    imageUrl: "https://img.test/a.png",
    videoUrl: "https://video.test/a.mp4",
    useDualFrame: false,
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project_1",
    title: "T",
    wizardStep: 1,
    automationMode: "semi-auto",
    ideaPrompt: "一个想法",
    assets: [],
    aspectRatio: "16:9",
    style: "cinematic",
    language: "zh",
    shots: [],
    status: "idle",
    assetsReviewed: true,
    storyboardReviewed: true,
    imagesReviewed: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Project;
}

describe("evaluateWizardAdvance · 四类阻塞原因", () => {
  it("① 无镜头 → noShots（步骤 3/4/5 均如此）", () => {
    for (const step of [3, 4, 5]) {
      const r = evaluateWizardAdvance(makeProject({ shots: [] }), step);
      expect(r.canAdvance).toBe(false);
      expect(r.reasonKey).toBe("wizard.block.noShots");
    }
  });

  it("② 缺 scriptText → missingScript 并给出镜头数", () => {
    const shots = [
      makeShot({ id: "a", scriptText: "有文案" }),
      makeShot({ id: "b", scriptText: "   " }),
      makeShot({ id: "c", scriptText: "" }),
    ];
    const r = evaluateWizardAdvance(makeProject({ shots }), 3);
    expect(r.canAdvance).toBe(false);
    expect(r.reasonKey).toBe("wizard.block.missingScript");
    expect(r.vars).toEqual({ count: 2 });
  });

  it("③ 缺审核标记 → storyboardNotReviewed（半自动，分镜齐全时）", () => {
    const shots = [makeShot()];
    const r = evaluateWizardAdvance(
      makeProject({ automationMode: "semi-auto", storyboardReviewed: false, shots }),
      3,
    );
    expect(r.canAdvance).toBe(false);
    expect(r.reasonKey).toBe("wizard.block.storyboardNotReviewed");
  });

  it("④ 正在提取中（status=scripting）→ extracting（步骤 1）", () => {
    const r = evaluateWizardAdvance(makeProject({ status: "scripting" }), 1);
    expect(r.canAdvance).toBe(false);
    expect(r.reasonKey).toBe("wizard.block.extracting");
  });
});

describe("evaluateWizardAdvance · 放行与其它门禁", () => {
  it("步骤 1：想法为空 → noIdea", () => {
    const r = evaluateWizardAdvance(makeProject({ ideaPrompt: "  " }), 1);
    expect(r.canAdvance).toBe(false);
    expect(r.reasonKey).toBe("wizard.block.noIdea");
  });

  it("步骤 2：半自动未确认资产 → assetsNotReviewed", () => {
    const r = evaluateWizardAdvance(
      makeProject({ automationMode: "semi-auto", assetsReviewed: false }),
      2,
    );
    expect(r.canAdvance).toBe(false);
    expect(r.reasonKey).toBe("wizard.block.assetsNotReviewed");
  });

  it("步骤 4：半自动图片齐全但未确认 → imagesNotReviewed", () => {
    const shots = [makeShot({ videoUrl: undefined })];
    const r = evaluateWizardAdvance(
      makeProject({ automationMode: "semi-auto", imagesReviewed: false, shots }),
      4,
    );
    expect(r.canAdvance).toBe(false);
    expect(r.reasonKey).toBe("wizard.block.imagesNotReviewed");
  });

  it("步骤 4：缺图片 → missingImage 计数", () => {
    const shots = [makeShot({ imageUrl: undefined }), makeShot()];
    const r = evaluateWizardAdvance(makeProject({ shots }), 4);
    expect(r.canAdvance).toBe(false);
    expect(r.reasonKey).toBe("wizard.block.missingImage");
    expect(r.vars).toEqual({ count: 1 });
  });

  it("步骤 5：缺视频 → missingVideo 计数", () => {
    const shots = [makeShot({ videoUrl: undefined }), makeShot({ videoUrl: undefined }), makeShot()];
    const r = evaluateWizardAdvance(makeProject({ shots }), 5);
    expect(r.canAdvance).toBe(false);
    expect(r.reasonKey).toBe("wizard.block.missingVideo");
    expect(r.vars).toEqual({ count: 2 });
  });

  it("全自动：有镜头即放行，不要求审核标记", () => {
    const shots = [makeShot()];
    const p = makeProject({
      automationMode: "auto",
      storyboardReviewed: false,
      imagesReviewed: false,
      shots,
    });
    expect(evaluateWizardAdvance(p, 3).canAdvance).toBe(true);
    expect(evaluateWizardAdvance(p, 4).canAdvance).toBe(true);
    expect(evaluateWizardAdvance(p, 5).canAdvance).toBe(true);
  });

  it("半自动全条件满足 → 放行且无原因", () => {
    const shots = [makeShot()];
    const r = evaluateWizardAdvance(makeProject({ shots }), 3);
    expect(r.canAdvance).toBe(true);
    expect(r.reasonKey).toBeNull();
  });

  it("project 缺失 → 不放行且无原因（底部按钮此时不渲染）", () => {
    const r = evaluateWizardAdvance(undefined, 3);
    expect(r.canAdvance).toBe(false);
    expect(r.reasonKey).toBeNull();
  });
});
