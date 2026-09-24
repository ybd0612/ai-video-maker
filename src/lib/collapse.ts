// ────────────────────────────────────────────────────────────────────────────
// src/lib/collapse.ts
// 折叠三档的判定：档 1 轨上（无正文）/ 档 2 详情默认（clamp 到 COLLAPSED_LINES）
// / 档 3 展开全文。这里只回答"值不值得给展开入口"，实际裁剪由 CSS line-clamp 完成。
// ────────────────────────────────────────────────────────────────────────────

export const COLLAPSED_LINES = 3;

/** 单个 CJK 句末标点即算一个分句；换行也算分句边界 */
const CLAUSE_SPLIT = /[。！？；;\r?\n]/;

/** 按分句数与总长度估算是否会超出 clamp —— 不做像素测量（无 DOM 可测）。 */
export function shouldOfferExpand(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.split(/\r?\n/).length > COLLAPSED_LINES) return true;
  const clauses = trimmed.split(CLAUSE_SPLIT).filter((part) => part.trim()).length;
  if (clauses > 1) return true;
  return trimmed.length > 60 * COLLAPSED_LINES;
}
