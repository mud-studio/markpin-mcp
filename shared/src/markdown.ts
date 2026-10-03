import YAML from 'yaml';
import { TEMPLATE_DEFAULT, TEMPLATE_OBSIDIAN } from './presets';
import { render, type TemplateData } from './template';
import { CLIP_COLOR_HEX, clipColorOf, type Bookmark, type Clip, type Page } from './types';

export const MARKPIN_FORMAT_VERSION = 2;
export const MAX_FILE_BYTES = 512 * 1024;

/** v2 frontmatter(사람용). Obsidian Properties에 이 키만 보인다(§22). */
const FM_ORDER = ['title', 'url', 'savedAt', 'tags', 'summary', 'readAt', 'deletedAt'] as const;
const FM_KNOWN = new Set<string>(FM_ORDER);
/** v2 markpin 블록(기계용). */
const DATA_ORDER = ['id', 'rev', 'updatedAt', 'domain', 'clips', 'bookmark', 'contentTruncated'] as const;
const DATA_KNOWN = new Set<string>(['v', ...DATA_ORDER]);
/** v1 frontmatter(읽기 전용, 2026-10-01 이전). */
const V1_KNOWN = new Set<string>(['markpin', 'id', 'url', 'title', 'domain', 'savedAt', 'updatedAt', 'rev', 'tags', 'summary', 'readAt', 'bookmark', 'contentTruncated', 'deletedAt', 'clips']);

/** 기계 데이터 블록(§22). 파일 **끝**에 둔다 — Obsidian Live Preview가 HTML 주석을 숨기지 않아, 맨 위에 두면 회색 JSON이 본문보다 먼저 보인다. */
const BLOCK_OPEN = '<!-- markpin\n';
const BLOCK_CLOSE = '\n-->\n';
const REQUIRED_FM = ['title', 'url', 'savedAt'] as const;
const REQUIRED_DATA = ['id', 'rev', 'updatedAt', 'domain'] as const;
const REQUIRED_V1 = ['id', 'url', 'title', 'domain', 'savedAt', 'updatedAt', 'rev'] as const;

const CONTENT_HEADING = '\n## Content\n';
const CONTENT_MARK = '## Content\n';

const encoder = new TextEncoder();
const byteLength = (s: string) => encoder.encode(s).length;

/** 템플릿에 주는 데이터(§21.4). `block`은 기본 프리셋이 쓰는 과거 모양의 클립 한 덩어리, `last`는 마지막 클립 표시. */
export function templateData(page: Pick<Page, 'clips'> & Partial<Page>, content: string): TemplateData {
  const clips = page.clips
    .map((clip, i, all) => {
      const body = clip.type === 'region' && clip.html ? clip.html : clip.text;
      const quoted = body ? body.split('\n').map((line) => `> ${line}`).join('\n') : '';
      const color = clipColorOf(clip);
      const parts = [clip.image ? `![](../../${clip.image.path})` : '', quoted, clip.note].filter(Boolean);
      return {
        last: i === all.length - 1,
        block: parts.length > 0 ? `${parts.join('\n\n')}\n` : '',
        id: clip.id,
        text: clip.text,
        html: clip.html ?? '',
        note: clip.note,
        color,
        colorHex: CLIP_COLOR_HEX[color],
        // 페이지 파일은 pages/{YYYY}/ 아래에 있으므로 템플릿이 `../../`를 붙인다
        image: clip.image?.path,
        isText: clip.type === 'text',
        isRegion: clip.type === 'region',
        hasNote: clip.note.length > 0,
        quoted,
        paragraphs: clip.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
        createdAt: clip.createdAt
      };
    });
  return {
    title: page.title,
    url: page.url,
    domain: page.domain,
    savedAt: page.savedAt,
    updatedAt: page.updatedAt,
    summary: page.summary,
    readAt: page.readAt,
    tags: page.tags ?? [],
    bookmark: page.bookmark ? { quote: page.bookmark.quote, createdAt: page.bookmark.createdAt } : undefined,
    clips,
    content
  };
}

/** frontmatter 뒤 본문. 템플릿이 없으면 기본 프리셋. */
export function renderBody(page: Pick<Page, 'clips'> & Partial<Page>, content: string, template: string = TEMPLATE_DEFAULT): string {
  return render(template, templateData(page, content));
}

const SENTINEL = '\u0000';

/**
 * 본문 텍스트가 시작하는 위치. 알려진 템플릿(호출자가 준 것 → 프리셋 순)으로 본문 앞부분을 그려 보고 파일이 그대로 시작하면
 * 그 뒤가 본문이다 — 클립 메모·단락 속 `## Content`에 속지 않는다. 어느 템플릿과도 안 맞으면 첫 `## Content` 줄로 떨어진다.
 */
function findContentStart(body: string, page: Pick<Page, 'clips'> & Partial<Page>, template?: string): number {
  const candidates = [template, TEMPLATE_DEFAULT, TEMPLATE_OBSIDIAN].filter((t, i, all): t is string => t !== undefined && all.indexOf(t) === i);
  for (const tpl of candidates) {
    const rendered = renderBody(page, SENTINEL, tpl);
    const cut = rendered.lastIndexOf(CONTENT_MARK + '\n' + SENTINEL);
    if (cut === -1) continue;
    const prefix = '\n' + rendered.slice(0, cut) + CONTENT_MARK;
    if (body.startsWith(prefix)) return prefix.length;
  }
  const idx = body.indexOf(CONTENT_HEADING);
  return idx === -1 ? -1 : idx + CONTENT_HEADING.length;
}

function buildFrontmatter(page: Page): string {
  const fm: Record<string, unknown> = {};
  for (const key of FM_ORDER) {
    const value = page[key];
    if (value !== undefined) fm[key] = value;
  }
  for (const [k, v] of Object.entries(page.extra ?? {})) if (!FM_KNOWN.has(k)) fm[k] = v;
  return YAML.stringify(fm, { lineWidth: 0 });
}

/** JSON 한 줄. 문자열 안의 `-->`가 주석을 닫지 못하게 `--\u003e`로(JSON.parse가 복원). */
function buildData(page: Page, truncated: boolean): string {
  const data: Record<string, unknown> = { v: MARKPIN_FORMAT_VERSION };
  for (const key of DATA_ORDER) {
    if (key === 'contentTruncated') {
      if (truncated) data.contentTruncated = true;
      continue;
    }
    const value = page[key];
    if (value !== undefined) data[key] = value;
  }
  for (const [k, v] of Object.entries(page.extraData ?? {})) if (!DATA_KNOWN.has(k)) data[k] = v;
  return JSON.stringify(data).replace(/-->/g, '--\\u003e');
}

function build(page: Page, content: string, truncated: boolean, template?: string): string {
  return `---\n${buildFrontmatter(page)}---\n\n${renderBody(page, content, template)}${BLOCK_OPEN}${buildData(page, truncated)}${BLOCK_CLOSE}`;
}

function truncateToBytes(s: string, max: number): string {
  if (byteLength(s) <= max) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (byteLength(s.slice(0, mid)) <= max) lo = mid;
    else hi = mid - 1;
  }
  let out = s.slice(0, lo);
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  return out;
}

/** 본문(## Content)을 뺀 나머지 — frontmatter + 클립 렌더링 — 의 바이트 수. */
export function pageOverheadBytes(page: Page): number {
  return byteLength(build(page, '', true));
}

/** 본문이 없어도 파일 상한을 넘는가. 클립·메모가 쌓인 페이지에 대한 저장 거부 기준. */
export function exceedsFileLimit(page: Page): boolean {
  return pageOverheadBytes(page) > MAX_FILE_BYTES;
}

/** 파일 상한에 맞춘 본문. 파일에 쓰는 본문과 IndexedDB에 두는 본문을 같게 하려고 캡처도 이 결과를 저장한다. */
export function fitContentToFile(page: Page): { contentText: string; truncated: boolean } {
  const content = page.contentText ?? '';
  const truncated = page.contentTruncated === true;
  if (byteLength(build(page, content, truncated)) <= MAX_FILE_BYTES) return { contentText: content, truncated };
  const allowed = Math.max(0, MAX_FILE_BYTES - pageOverheadBytes(page));
  return { contentText: truncateToBytes(content, allowed), truncated: true };
}

/** `template`은 본문 모양만 바꾼다(§21.4). 512KB 맞춤은 기본 프리셋 기준(`fitContentToFile`). */
export function serializePage(page: Page, template?: string): string {
  const { contentText, truncated } = fitContentToFile(page);
  return build(page, contentText, truncated, template);
}

function pick<T>(src: Record<string, unknown>, key: string): T | undefined {
  return src[key] as T | undefined;
}

type OptionalKey = 'summary' | 'readAt' | 'bookmark' | 'deletedAt' | 'contentTruncated';

function assign(page: Page, src: Record<string, unknown>, keys: readonly OptionalKey[]): void {
  if (keys.includes('summary') && src.summary !== undefined) page.summary = src.summary as string;
  if (keys.includes('readAt') && src.readAt !== undefined) page.readAt = src.readAt as string;
  if (keys.includes('bookmark') && src.bookmark !== undefined) page.bookmark = src.bookmark as Bookmark;
  if (keys.includes('contentTruncated') && src.contentTruncated === true) page.contentTruncated = true;
  if (keys.includes('deletedAt') && src.deletedAt !== undefined) page.deletedAt = src.deletedAt as string;
}

function requireKeys(src: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) if (src[key] === undefined) throw new Error(`missing field: ${key}`);
}

function unknownKeys(src: Record<string, unknown>, known: Set<string>): Record<string, unknown> | undefined {
  const rest = Object.fromEntries(Object.entries(src).filter(([k]) => !known.has(k)));
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/** 본문(`## Content`)을 붙인다. `body`는 템플릿 본문 앞의 빈 줄을 포함한다. */
function withContent(page: Page, body: string, template?: string): Page {
  const start = findContentStart(body, page, template);
  const rawContent = start === -1 ? '' : body.slice(start);
  const contentText = rawContent.replace(/^\n/, '').replace(/\n$/, '');
  if (contentText !== '') page.contentText = contentText;
  return page;
}

/** v1(2026-10-01 이전): 모든 키가 frontmatter에 있다. 읽기만 하고 쓰기는 v2. */
function parseV1(fm: Record<string, unknown>, body: string, template?: string): Page {
  if (fm.markpin !== 1) throw new Error(`unsupported format version: ${String(fm.markpin)}`);
  requireKeys(fm, REQUIRED_V1);
  const page: Page = {
    id: fm.id as string,
    url: fm.url as string,
    title: fm.title as string,
    domain: fm.domain as string,
    savedAt: fm.savedAt as string,
    updatedAt: fm.updatedAt as string,
    rev: fm.rev as number,
    tags: pick<string[]>(fm, 'tags') ?? [],
    clips: pick<Clip[]>(fm, 'clips') ?? []
  };
  assign(page, fm, ['summary', 'readAt', 'bookmark', 'contentTruncated', 'deletedAt']);
  const extra = unknownKeys(fm, V1_KNOWN);
  if (extra) page.extra = extra;
  return withContent(page, body, template);
}

/** `template`: 이 파일을 쓴 템플릿을 알면 넘긴다(사용자 템플릿). 프리셋은 자동으로 시도한다. v1·v2 모두 읽는다(§22). */
export function parsePage(source: string, template?: string): Page {
  const markdown = source.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (!match) throw new Error('missing frontmatter');
  const fm = YAML.parse(match[1]) as Record<string, unknown>;
  const afterFm = markdown.slice(match[0].length);
  // 블록이 있으면 v2(사용자 속성 `markpin:`에 속지 않게 블록을 먼저 본다). 없고 `markpin:` 키가 있으면 v1.
  // 블록은 파일 끝에 쓰므로 **마지막** 블록을 잡는다(본문에 같은 글귀가 있어도 됨). 블록 뒤에 사용자가 적은 글은 무시한다(다음 쓰기에서 사라진다, §22 A).
  const open = afterFm.lastIndexOf('\n' + BLOCK_OPEN) + 1;
  if (open === 0) {
    if (fm.markpin !== undefined) return parseV1(fm, afterFm, template);
    throw new Error('missing markpin block');
  }
  const rest = afterFm.slice(open);
  const close = rest.indexOf(BLOCK_CLOSE, BLOCK_OPEN.length);
  if (close === -1) throw new Error('missing markpin block');
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rest.slice(BLOCK_OPEN.length, close)) as Record<string, unknown>;
  } catch {
    throw new Error('invalid markpin block');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('invalid markpin block');
  if (data.v !== MARKPIN_FORMAT_VERSION) throw new Error(`unsupported format version: ${String(data.v)}`);
  requireKeys(fm, REQUIRED_FM);
  requireKeys(data, REQUIRED_DATA);

  const page: Page = {
    id: data.id as string,
    url: fm.url as string,
    title: fm.title as string,
    domain: data.domain as string,
    savedAt: fm.savedAt as string,
    updatedAt: data.updatedAt as string,
    rev: data.rev as number,
    tags: pick<string[]>(fm, 'tags') ?? [],
    clips: pick<Clip[]>(data, 'clips') ?? []
  };
  assign(page, fm, ['summary', 'readAt', 'deletedAt']);
  assign(page, data, ['bookmark', 'contentTruncated']);
  const extra = unknownKeys(fm, FM_KNOWN);
  if (extra) page.extra = extra;
  const extraData = unknownKeys(data, DATA_KNOWN);
  if (extraData) page.extraData = extraData;
  return withContent(page, afterFm.slice(0, open), template);
}
