// ────────────────────────────────────────────────────────────────────────────
// tests/lib/plans.test.ts
// 套餐与用量限制配置（单一事实源）的单测。
// 这里刻意包含若干「不变量」断言：配置表被手改出错时能立刻暴露。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAN,
  PLANS,
  WINDOW,
  imageSizeToTier,
  resolvePlan,
  rpmFor,
  videoConcurrencyFor,
  videoInFlightCapFor,
  type PlanId,
} from "@/lib/plans";

describe("WINDOW 时间窗口", () => {
  it("各窗口毫秒数与文档口径一致", () => {
    expect(WINDOW.MINUTE).toBe(60_000);
    expect(WINDOW.FIVE_HOURS).toBe(5 * 60 * 60 * 1000);
    expect(WINDOW.DAY).toBe(24 * 60 * 60 * 1000);
    expect(WINDOW.WEEK).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("PLANS 配置表", () => {
  const ids = Object.keys(PLANS) as PlanId[];

  it("恰好包含 5 档套餐", () => {
    expect(ids).toHaveLength(5);
    expect(ids.sort()).toEqual(["default", "enterprise", "plus", "pro", "starter"]);
  });

  it("每档的 id 字段与键名一致，且中英文名非空", () => {
    for (const id of ids) {
      expect(PLANS[id].id).toBe(id);
      expect(PLANS[id].label.trim()).not.toBe("");
      expect(PLANS[id].labelEn.trim()).not.toBe("");
    }
  });

  it("访问类型：default/enterprise 非订阅，三档 Token Plan 为订阅", () => {
    expect(PLANS.default.accessType).toBe("default");
    expect(PLANS.enterprise.accessType).toBe("enterprise");
    for (const id of ["starter", "plus", "pro"] as const) {
      expect(PLANS[id].accessType).toBe("tokenplan");
    }
  });

  it("仅 Token Plan 三档带完整订阅配额，其余为空", () => {
    expect(PLANS.default.quota).toEqual({});
    expect(PLANS.enterprise.quota).toEqual({});
    for (const id of ["starter", "plus", "pro"] as const) {
      const q = PLANS[id].quota;
      expect(q.textPer5h).toBeGreaterThan(0);
      expect(q.textPerWeek).toBeGreaterThan(0);
      expect(q.imagePerDay).toBeGreaterThan(0);
      expect(q.videoSecondsPerDay).toBeGreaterThan(0);
    }
  });

  it("RPM 均为正整数，且 1K 档图片 RPM 不低于 2K 档", () => {
    for (const id of ids) {
      const rpm = PLANS[id].rpm;
      expect(rpm.text).toBeGreaterThan(0);
      expect(rpm.video).toBeGreaterThan(0);
      for (const tier of ["1K", "2K", "3K", "4K"] as const) {
        expect(rpm.image[tier]).toBeGreaterThan(0);
      }
      expect(rpm.image["1K"]).toBeGreaterThanOrEqual(rpm.image["2K"]);
    }
  });

  it("套餐越高文本 RPM 不降低（default ≤ enterprise ≤ tokenplan）", () => {
    expect(PLANS.enterprise.rpm.text).toBeGreaterThanOrEqual(PLANS.default.rpm.text);
    expect(PLANS.pro.rpm.text).toBeGreaterThanOrEqual(PLANS.enterprise.rpm.text);
  });
});

describe("resolvePlan", () => {
  it("合法 id 返回对应套餐", () => {
    expect(resolvePlan("pro").id).toBe("pro");
    expect(resolvePlan("default").id).toBe("default");
  });

  it("undefined / null 回退到默认套餐", () => {
    expect(resolvePlan(undefined).id).toBe(DEFAULT_PLAN);
    expect(resolvePlan(null).id).toBe(DEFAULT_PLAN);
  });

  it("非法 id 同样回退到默认套餐", () => {
    expect(resolvePlan("nonexistent" as PlanId).id).toBe(DEFAULT_PLAN);
  });
});

describe("rpmFor", () => {
  it("图片按尺寸档位取值", () => {
    expect(rpmFor(PLANS.default, "image", "1K")).toBe(20);
    expect(rpmFor(PLANS.default, "image", "3K")).toBe(1);
  });

  it("图片不传档位时按 1K 处理", () => {
    expect(rpmFor(PLANS.default, "image")).toBe(PLANS.default.rpm.image["1K"]);
  });

  it("文本与视频直接取对应字段", () => {
    expect(rpmFor(PLANS.enterprise, "text")).toBe(40);
    expect(rpmFor(PLANS.enterprise, "video")).toBe(2);
    expect(rpmFor(PLANS.pro, "text")).toBe(1000);
  });
});

describe("imageSizeToTier", () => {
  it("按长边映射到官方档位", () => {
    expect(imageSizeToTier("1024x1024")).toBe("1K");
    expect(imageSizeToTier("1344x768")).toBe("1K");
    expect(imageSizeToTier("2624x1472")).toBe("2K");
    expect(imageSizeToTier("3936x2214")).toBe("3K");
    expect(imageSizeToTier("5248x2952")).toBe("4K");
  });

  it("档位边界取「不小于」语义", () => {
    expect(imageSizeToTier("1499x1000")).toBe("1K");
    expect(imageSizeToTier("1500x1000")).toBe("2K");
    expect(imageSizeToTier("2699x1000")).toBe("2K");
    expect(imageSizeToTier("2700x1000")).toBe("3K");
    expect(imageSizeToTier("3999x1000")).toBe("3K");
    expect(imageSizeToTier("4000x1000")).toBe("4K");
  });

  it("大小写 x 与空格都可识别", () => {
    expect(imageSizeToTier("1024X1024")).toBe("1K");
    expect(imageSizeToTier(" 1024 x 1024 ")).toBe("1K");
  });

  it("无法解析时回退到 1K", () => {
    expect(imageSizeToTier(undefined)).toBe("1K");
    expect(imageSizeToTier("")).toBe("1K");
    expect(imageSizeToTier("auto")).toBe("1K");
    expect(imageSizeToTier("1024")).toBe("1K");
  });
});

/* ── 视频并发与在飞上限（单一事实源） ───────────────────────────────────────
   并发口径此前散落在 useVideoActions 的三元表达式里；在飞上限是 2026-09-28 新增：
   「一条已计费但服务端不给终态的任务」不应让整批镜头陪绑停摆，
   但也不允许无上限地把饱和队列越挤越死，故上限取「并发 + 1」。 */
describe("视频并发与在飞上限", () => {
  it("并发按访问类型：免费 1 / 企业 2 / Token Plan 3", () => {
    expect(videoConcurrencyFor(PLANS.default)).toBe(1);
    expect(videoConcurrencyFor(PLANS.enterprise)).toBe(2);
    expect(videoConcurrencyFor(PLANS.starter)).toBe(3);
    expect(videoConcurrencyFor(PLANS.plus)).toBe(3);
    expect(videoConcurrencyFor(PLANS.pro)).toBe(3);
  });

  it("在飞上限 = 并发 + 1（允许上一条未偿清的任务挂着，不再整批停摆）", () => {
    expect(videoInFlightCapFor(PLANS.default)).toBe(2);
    expect(videoInFlightCapFor(PLANS.enterprise)).toBe(3);
    expect(videoInFlightCapFor(PLANS.starter)).toBe(4);
    expect(videoInFlightCapFor(PLANS.pro)).toBe(4);
  });

  it("上限恒大于并发，保证并发为 1 的档位也能开工", () => {
    for (const plan of Object.values(PLANS)) {
      expect(videoInFlightCapFor(plan)).toBeGreaterThan(videoConcurrencyFor(plan));
    }
  });
});
