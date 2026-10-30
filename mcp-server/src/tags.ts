export const MAX_TAG_CHARS = 24;

/** 태그 하나의 표기 정규화(§8.1): trim, 앞 `#` 제거, 공백→`-`. 대소문자는 그대로 둔다. */
export function normalizeTag(s: string): string {
  return s.trim().replace(/^#/, '').replace(/\s+/g, '-');
}

/** §8.1 태그 정규화. 확장의 AI 태그 규칙과 같되 개수 제한은 없다. */
export function normalizeTags(raw: string[], existing: string[]): string[] {
  const byLower = new Map(existing.map((t) => [t.toLowerCase(), t]));
  const out: string[] = [];
  for (const item of raw) {
    const t = normalizeTag(item);
    if (!t || t.length > MAX_TAG_CHARS) continue;
    const tag = byLower.get(t.toLowerCase()) ?? t;
    if (out.some((x) => x.toLowerCase() === tag.toLowerCase())) continue;
    out.push(tag);
  }
  return out;
}
