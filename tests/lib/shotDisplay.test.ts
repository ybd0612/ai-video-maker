// ────────────────────────────────────────────────────────────────────────────
// tests/lib/shotDisplay.test.ts
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
