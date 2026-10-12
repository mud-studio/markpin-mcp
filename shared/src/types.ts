export type ClipType = 'text' | 'region';

export type Selector =
  | { type: 'TextQuoteSelector'; exact: string; prefix?: string; suffix?: string }
  | { type: 'TextPositionSelector'; start: number; end: number }
  | { type: 'CssSelector'; value: string }
  | { type: 'XPathSelector'; value: string };

export type ClipImage = { path: string; width: number; height: number };

/** 형광펜 색(§21.3). 순서 = 팔레트 순서. 없거나 모르는 값은 앰버로 그린다. */
export const CLIP_COLORS = ['amber', 'green', 'blue', 'pink'] as const;
export type ClipColor = (typeof CLIP_COLORS)[number];
export const DEFAULT_CLIP_COLOR: ClipColor = 'amber';
/** 배지·테두리·템플릿(`colorHex`)용 단색. 본문 하이라이트는 같은 색 알파 .25(확장 `clipColors.ts`). */
export const CLIP_COLOR_HEX: Record<ClipColor, string> = { amber: '#FF9C1A', green: '#34C759', blue: '#0A84FF', pink: '#FF375F' };

export function clipColorOf(clip: { color?: string }): ClipColor {
  return (CLIP_COLORS as readonly string[]).includes(clip.color ?? '') ? (clip.color as ClipColor) : DEFAULT_CLIP_COLOR;
}

/** 반응 기호(§21.5). 색과 독립. 없으면 기호 없음, 모르는 값은 보존하되 기호 없음으로 그린다. */
export const CLIP_KINDS = ['question', 'insight', 'disagree', 'star'] as const;
export type ClipKind = (typeof CLIP_KINDS)[number];
export const CLIP_KIND_GLYPH: Record<ClipKind, string> = { question: '?', insight: '!', disagree: '×', star: '★' };

export function clipKindOf(clip: { kind?: string }): ClipKind | undefined {
  return (CLIP_KINDS as readonly string[]).includes(clip.kind ?? '') ? (clip.kind as ClipKind) : undefined;
}

/** 「이 글 한 줄」·메모 정규화: 공백·줄바꿈은 공백 하나로, 양끝 trim. 빈 결과는 "없음". */
export function normalizeNote(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export type Clip = {
  id: string;
  type: ClipType;
  createdAt: string;
  updatedAt: string;
  text: string;
  html?: string;
  note: string;
  selectors: Selector[];
  image?: ClipImage;
  /** 없으면 앰버. 모르는 값은 보존하고 앰버로 그린다(§21.3). */
  color?: ClipColor;
  /** 반응 기호(§21.5). 없으면 기호 없음. 모르는 값은 보존한다. */
  kind?: ClipKind;
};

/** 읽기 책갈피(§21.2). `selectors`가 없으면 "처음부터"(나중에 읽기), 있으면 "여기부터"(읽는 중). 페이지당 1개. */
export type Bookmark = {
  createdAt: string;
  /** 꽂은 문장 앞부분. 목록·MCP 표시용 */
  quote?: string;
  selectors?: Selector[];
};

export type Page = {
  id: string;
  url: string;
  title: string;
  domain: string;
  savedAt: string;
  updatedAt: string;
  rev: number;
  tags: string[];
  summary?: string;
  /** 「이 글 한 줄」(§21.5) — 사용자가 쓴 한 줄. frontmatter `note`. 빈 문자열은 없는 것과 같다. */
  note?: string;
  readAt?: string;
  bookmark?: Bookmark;
  contentText?: string;
  contentTruncated?: boolean;
  clips: Clip[];
  deletedAt?: string;
  /** 이 버전이 모르는 frontmatter 키. 파일을 다시 쓸 때 그대로 보존한다(전방 호환, §21.2). */
  extra?: Record<string, unknown>;
  /** 이 버전이 모르는 markpin 블록 키(§22). 다시 쓸 때 보존한다. */
  extraData?: Record<string, unknown>;
};
