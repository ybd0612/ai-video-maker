// ────────────────────────────────────────────────────────────────────────────
// tests/lib/shotFields.test.ts
// pickShotFields：内容字段逐一拷贝、排除字段不拷贝。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { pickShotFields } from "@/lib/shotFields";
import type { Shot } from "@/stores/projectStore";

/** 构造一个全字段填充的完整 Shot */
function makeShot(): Shot {
  return {
    id: "shot_1",
    index: 3,
    scriptText: "台词",
    visualPrompt: "a girl in a cafe",
    motionPrompt: "camera slowly dollies in",
    dialogues: [{ id: "dlg_1", characterId: "c1", text: "你好" }],
    activeCharacterIds: ["c1", "c2"],
    duration: 6,
    status: "imaged",
    imageUrl: "https://img.example/1.png",
    videoUrl: "https://vid.example/1.mp4",
    videoProgress: 42,
    videoRetryCount: 1,
    error: "some error",
    sceneDesc: "in a sunlit cafe",
    detailDesc: "white blouse",
    lightingDesc: "warm golden hour",
    styleDesc: "photorealistic, 8k",
    actionDesc: "slowly turns her head",
    cameraDesc: "dolly in",
    envChangeDesc: "steam rising",
    motionSpeedDesc: "slow-motion",
    firstFrameUrl: "https://img.example/first.png",
    lastFrameUrl: "https://img.example/last.png",
    useDualFrame: true,
  };
}

describe("pickShotFields", () => {
  it("内容字段逐一拷贝（值与源一致）", () => {
    const shot = makeShot();
    const picked = pickShotFields(shot);

    expect(picked.scriptText).toBe("台词");
    expect(picked.visualPrompt).toBe("a girl in a cafe");
    expect(picked.motionPrompt).toBe("camera slowly dollies in");
    expect(picked.duration).toBe(6);
    expect(picked.sceneDesc).toBe("in a sunlit cafe");
    expect(picked.detailDesc).toBe("white blouse");
    expect(picked.lightingDesc).toBe("warm golden hour");
    expect(picked.styleDesc).toBe("photorealistic, 8k");
    expect(picked.actionDesc).toBe("slowly turns her head");
    expect(picked.cameraDesc).toBe("dolly in");
    expect(picked.envChangeDesc).toBe("steam rising");
    expect(picked.motionSpeedDesc).toBe("slow-motion");
    expect(picked.firstFrameUrl).toBe("https://img.example/first.png");
  });

  it("身份/状态/生成产物/运行时字段不拷贝", () => {
    const picked = pickShotFields(makeShot()) as unknown as Record<string, unknown>;

    expect("id" in picked).toBe(false);
    expect("index" in picked).toBe(false);
    expect("status" in picked).toBe(false);
    expect("error" in picked).toBe(false);
    expect("imageUrl" in picked).toBe(false);
    expect("videoUrl" in picked).toBe(false);
    expect("videoProgress" in picked).toBe(false);
    expect("videoRetryCount" in picked).toBe(false);
    expect("useDualFrame" in picked).toBe(false);
    expect("lastFrameUrl" in picked).toBe(false);
    expect("activeCharacterIds" in picked).toBe(false);
    expect("dialogues" in picked).toBe(false);
  });

  it("可选内容字段缺省时拷贝为 undefined（键存在）", () => {
    const shot: Shot = {
      id: "shot_2",
      index: 0,
      scriptText: "",
      visualPrompt: "v",
      motionPrompt: "m",
      dialogues: [],
      activeCharacterIds: [],
      duration: 5,
      status: "idle",
      useDualFrame: false,
    };
    const picked = pickShotFields(shot);

    expect(picked.firstFrameUrl).toBeUndefined();
  });

  it("拷贝为浅拷贝：修改结果不回写源对象", () => {
    const shot = makeShot();
    const picked = pickShotFields(shot);
    picked.scriptText = "changed";
    expect(shot.scriptText).toBe("台词");
  });
});
