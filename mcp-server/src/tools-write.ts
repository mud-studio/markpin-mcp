import { randomUUID } from 'node:crypto';
import { type Bookmark, type Clip, type ClipColor, type ClipKind, type ClipPen, DEFAULT_CLIP_COLOR, DEFAULT_CLIP_PEN, MAX_CLIP_TEXT_CHARS, type Page, type Selector, bookmarkQuote, extractDomain, normalizeNote, normalizeUrl } from '@markpin/shared';
import { safeNormalize, type Store } from './store';
import { MAX_TAG_CHARS, normalizeTag, normalizeTags } from './tags';
import { writePage } from './write';

export type PageRef = { id: string; title: string };
export type FetchPage = (url: string) => Promise<{ title: string; content: string }>;

export const SIDEPANEL_NOTE = 'The Markpin side panel picks this up on its next sync — within about 30 seconds while the panel is open, or when it is opened.';
export const INBOX_NOTE = 'Saved to the Markpin inbox; the extension turns it into a page file on its next sync — within about 30 seconds while the side panel is open, or when it is opened.';

/** §6 CONTEXT_CHARS — 확장의 셀렉터 앞뒤 문맥 길이와 같다. */
const CONTEXT_CHARS = 32;
/** §8.1 — 확장의 내장 AI 요약 상한과 같다. */
export const MAX_SUMMARY_CHARS = 300;

/** 공백을 다듬고 길이를 검사한다. 빈 문자열은 "요약 없음". */
function normalizeSummary(summary: string): string {
  const trimmed = summary.trim();
  if (trimmed.length > MAX_SUMMARY_CHARS) throw new Error(`Summary exceeds ${MAX_SUMMARY_CHARS} characters`);
  return trimmed;
}

const ref = (p: Page): PageRef => ({ id: p.id, title: p.title });

function requirePage(store: Store, id: string): Page {
  const page = store.pages.get(id);
  if (!page) throw new Error(`Page not found: ${id}`);
  return page;
}

export async function savePage(
  store: Store,
  input: { url: string; title?: string; content?: string; tags?: string[]; summary?: string },
  deps: { fetchPage: FetchPage },
  now: string = new Date().toISOString()
) {
  const url = normalizeUrl(input.url);
  const summary = input.summary === undefined ? undefined : normalizeSummary(input.summary); // fetch 전에 검사
  const liveId = store.byUrl.get(url);
  if (liveId) {
    const page = store.pages.get(liveId)!;
    return { created: false, revived: false, page: { ...ref(page), url: page.url, tags: page.tags }, note: ['Already saved; nothing was written.'] };
  }
  let title = input.title;
  let content = input.content;
  if (content === undefined) {
    const fetched = await deps.fetchPage(url);
    if (!title) title = fetched.title || undefined;
    content = fetched.content;
  }
  const tombstone = [...store.tombstones.values()].find((p) => safeNormalize(p.url) === url);
  const base: Page = tombstone
    ? { ...tombstone }
    : { id: randomUUID(), url, title: title ?? url, domain: extractDomain(url), savedAt: now, updatedAt: now, rev: 0, tags: [], clips: [] };
  delete base.deletedAt;
  const page: Page = {
    ...base,
    title: title ?? base.title,
    tags: [...base.tags, ...normalizeTags(input.tags ?? [], base.tags).filter((t) => !base.tags.includes(t))]
  };
  if (content) {
    page.contentText = content;
    delete page.bodyPending; // 본문을 넣었으니 확장이 다시 채울 필요가 없다
  }
  if (summary) page.summary = summary;
  const written = await writePage(store, page, now);
  const note = [store.inbox ? INBOX_NOTE : SIDEPANEL_NOTE];
  return { created: true, revived: tombstone !== undefined, page: { ...ref(written), url: written.url, tags: written.tags }, note };
}

/** remove → add 적용 후의 태그 배열. 아무것도 바뀌지 않으면 null(확인 대화상자도, 쓰기도 건너뛴다). */
export function planTags(tags: string[], add: string[], remove: string[]): string[] | null {
  const removeLower = new Set(remove.map((t) => normalizeTag(t).toLowerCase()));
  const kept = tags.filter((t) => !removeLower.has(t.toLowerCase()));
  const added = normalizeTags(add, kept).filter((t) => !kept.some((k) => k.toLowerCase() === t.toLowerCase()));
  const after = [...kept, ...added];
  if (after.length === tags.length && after.every((t, i) => t === tags[i])) return null;
  return after;
}

export async function updateTags(store: Store, input: { ids: string[]; add?: string[]; remove?: string[] }, now: string = new Date().toISOString()) {
  const pages: Array<PageRef & { before: string[]; after: string[] }> = [];
  const missing: string[] = [];
  for (const id of input.ids) {
    const page = store.pages.get(id);
    if (!page) {
      missing.push(id);
      continue;
    }
    const after = planTags(page.tags, input.add ?? [], input.remove ?? []);
    if (!after) continue;
    const written = await writePage(store, { ...page, tags: after }, now);
    pages.push({ ...ref(written), before: page.tags, after: written.tags });
  }
  return { pages, missing, note: pages.length > 0 ? [SIDEPANEL_NOTE] : ['No tags changed.'] };
}

export type RetagChange = { from: string; to?: string };
export type RetagPlan = { items: Array<{ from: string; to: string | null; pages: number }>; targets: Map<string, string[]> };

/**
 * 태그 병합·이름 변경·삭제 계획(0.10.0 §2.1). 살아 있는 페이지 전부에 항목을 순서대로 누적 적용한다.
 * 비교는 대소문자 무시, 쓰는 값은 normalizeTag(to). 대소문자만 다른 변경(React → react)도 적용한다(확장 planRename과 같다).
 * `from === to`(정확히 같음)는 no-op. `to`가 정규화 뒤 비거나 24자를 넘으면 전체를 거부한다(검증 실패와 같은 급, 아무것도 쓰지 않는다).
 */
export function planRetag(store: Store, changes: RetagChange[]): RetagPlan {
  const items = changes.map((c) => {
    const to = c.to === undefined ? null : normalizeTag(c.to);
    if (to !== null && (!to || to.length > MAX_TAG_CHARS)) throw new Error(`Invalid tag: ${JSON.stringify(c.to)}`);
    // `from`도 planTags처럼 정규화해 비교한다('#react'·'react js' → 'react'·'react-js'). 보여 주는 값은 입력 그대로.
    return { from: c.from, to, pages: 0, fromLower: normalizeTag(c.from).toLowerCase() };
  });
  const targets = new Map<string, string[]>();
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((t, i) => t === b[i]);
  for (const page of store.pages.values()) {
    let tags = page.tags;
    for (const item of items) {
      if (!item.fromLower || normalizeTag(item.from) === item.to) continue;
      const at = tags.findIndex((t) => t.toLowerCase() === item.fromLower);
      if (at < 0) continue;
      const kept = tags.filter((t) => t.toLowerCase() !== item.fromLower);
      // 이름 변경은 제자리(순서 유지), 병합(to가 이미 있음)·삭제는 빼기만
      const next = item.to !== null && !kept.some((t) => t.toLowerCase() === item.to!.toLowerCase()) ? [...kept.slice(0, at), item.to, ...kept.slice(at)] : kept;
      if (same(next, tags)) continue; // 이미 목표 표기(대소문자만 다른 변경에서 이미 바뀐 페이지)는 세지 않는다
      item.pages += 1;
      tags = next;
    }
    if (!same(tags, page.tags)) targets.set(page.id, tags);
  }
  return { items: items.map(({ from, to, pages }) => ({ from, to, pages })), targets };
}

export async function retag(store: Store, changes: RetagChange[], now: string = new Date().toISOString()) {
  const plan = planRetag(store, changes);
  const pages: Array<PageRef & { before: string[]; after: string[] }> = [];
  for (const [id, after] of plan.targets) {
    const page = store.pages.get(id);
    if (!page) continue;
    const written = await writePage(store, { ...page, tags: after }, now);
    pages.push({ ...ref(written), before: page.tags, after: written.tags });
  }
  return { changes: plan.items, pages, note: pages.length > 0 ? [SIDEPANEL_NOTE] : ['No tags changed.'] };
}

/** 본문에서 `text`를 찾아 앞뒤 문맥을 붙인 TextQuoteSelector. 못 찾으면 exact만(재방문 때 앵커링 실패 가능). */
function quoteSelector(page: Page, text: string): { selector: Extract<Selector, { type: 'TextQuoteSelector' }>; anchored: boolean } {
  const selector: Extract<Selector, { type: 'TextQuoteSelector' }> = { type: 'TextQuoteSelector', exact: text };
  const body = page.contentText ?? '';
  const at = body.indexOf(text);
  const anchored = at !== -1;
  if (anchored) {
    const prefix = body.slice(Math.max(0, at - CONTEXT_CHARS), at);
    const suffix = body.slice(at + text.length, at + text.length + CONTEXT_CHARS);
    if (prefix) selector.prefix = prefix;
    if (suffix) selector.suffix = suffix;
  }
  return { selector, anchored };
}

const NOT_ANCHORED_NOTE = 'The text was not found in the saved content, so it may not be highlighted when the page is revisited.';

export async function addClip(store: Store, input: { pageId: string; text: string; note?: string; color?: ClipColor; kind?: ClipKind; pen?: ClipPen }, now: string = new Date().toISOString()) {
  const page = requirePage(store, input.pageId);
  const text = input.text.trim();
  if (!text) throw new Error('Clip text is empty');
  if (text.length > MAX_CLIP_TEXT_CHARS) throw new Error(`Clip text exceeds ${MAX_CLIP_TEXT_CHARS} characters`);
  const { selector: quote, anchored } = quoteSelector(page, text);
  const clip: Clip = { id: randomUUID(), type: 'text', createdAt: now, updatedAt: now, text, note: input.note ?? '', selectors: [quote], color: input.color ?? DEFAULT_CLIP_COLOR, pen: input.pen ?? DEFAULT_CLIP_PEN, ...(input.kind ? { kind: input.kind } : {}) };
  const written = await writePage(store, { ...page, clips: [...page.clips, clip] }, now);
  const note = [SIDEPANEL_NOTE];
  if (!anchored) note.push(NOT_ANCHORED_NOTE);
  return { page: ref(written), clipId: clip.id, anchored, note };
}

/** 책갈피(§21.2). `quote`가 있으면 그 문장부터(읽는 중), 없으면 처음부터(나중에 읽기). 꽂으면 `readAt`은 지운다. */
export async function setBookmark(store: Store, input: { pageId: string; quote?: string }, now: string = new Date().toISOString()) {
  const page = requirePage(store, input.pageId);
  const bookmark: Bookmark = { createdAt: now };
  let anchored: boolean | undefined;
  if (input.quote !== undefined) {
    const text = input.quote.trim();
    if (!text) throw new Error('Bookmark quote is empty');
    if (text.length > MAX_CLIP_TEXT_CHARS) throw new Error(`Bookmark quote exceeds ${MAX_CLIP_TEXT_CHARS} characters`);
    const found = quoteSelector(page, text);
    anchored = found.anchored;
    bookmark.quote = bookmarkQuote(text);
    bookmark.selectors = [found.selector];
  }
  const next: Page = { ...page, bookmark };
  delete next.readAt;
  delete next.skimmedAt; // 세 상태 배타(§21.2 보강)
  const written = await writePage(store, next, now);
  const note = [SIDEPANEL_NOTE];
  if (anchored === false) note.push(NOT_ANCHORED_NOTE);
  return anchored === undefined ? { page: ref(written), bookmark, note } : { page: ref(written), bookmark, anchored, note };
}

export async function clearBookmark(store: Store, input: { pageId: string }, now: string = new Date().toISOString()) {
  const page = requirePage(store, input.pageId);
  if (!page.bookmark) return { page: ref(page), changed: false, note: ['No bookmark on this page; nothing was written.'] };
  const next: Page = { ...page };
  delete next.bookmark;
  const written = await writePage(store, next, now);
  return { page: ref(written), changed: true, note: [SIDEPANEL_NOTE] };
}

/** 읽음(§21.2): `readAt` 기록 + 책갈피 제거. 이미 읽음이고 책갈피도 없으면 그대로. */
export async function markRead(store: Store, input: { pageId: string }, now: string = new Date().toISOString()) {
  const page = requirePage(store, input.pageId);
  if (page.readAt !== undefined && !page.bookmark && page.skimmedAt === undefined) return { page: ref(page), readAt: page.readAt, changed: false, note: ['Already marked as read; nothing was written.'] };
  const next: Page = { ...page, readAt: now };
  delete next.bookmark;
  delete next.skimmedAt;
  const written = await writePage(store, next, now);
  return { page: ref(written), readAt: now, changed: true, note: [SIDEPANEL_NOTE] };
}

/** 훑어봄(§21.2 보강): 책갈피·읽음을 지우고 `skimmedAt`. 이미 훑음이고 지울 게 없으면 no-op. */
export async function markSkimmed(store: Store, input: { pageId: string }, now: string = new Date().toISOString()) {
  const page = requirePage(store, input.pageId);
  if (page.skimmedAt !== undefined && !page.bookmark && page.readAt === undefined) return { page: ref(page), skimmedAt: page.skimmedAt, changed: false, note: ['Already marked as skimmed; nothing was written.'] };
  const next: Page = { ...page, skimmedAt: now };
  delete next.bookmark;
  delete next.readAt;
  const written = await writePage(store, next, now);
  return { page: ref(written), skimmedAt: now, changed: true, note: [SIDEPANEL_NOTE] };
}

export async function setClipNote(store: Store, input: { pageId: string; clipId: string; note: string }, now: string = new Date().toISOString()) {
  const page = requirePage(store, input.pageId);
  const i = page.clips.findIndex((c) => c.id === input.clipId);
  if (i === -1) throw new Error(`Clip not found: ${input.clipId}`);
  const before = page.clips[i].note;
  const clips = page.clips.slice();
  clips[i] = { ...clips[i], note: input.note, updatedAt: now };
  const written = await writePage(store, { ...page, clips }, now);
  return { page: ref(written), clipId: input.clipId, before, after: input.note, note: [SIDEPANEL_NOTE] };
}

export async function setSummary(store: Store, input: { pageId: string; summary: string }, now: string = new Date().toISOString()) {
  const page = requirePage(store, input.pageId);
  const after = normalizeSummary(input.summary);
  const before = page.summary ?? '';
  const next: Page = { ...page };
  if (after) next.summary = after;
  else delete next.summary;
  const written = await writePage(store, next, now);
  return { page: ref(written), before, after, note: [SIDEPANEL_NOTE] };
}

/** 「이 글 한 줄」(§21.5): frontmatter `note`. 공백 정규화, 빈 값이면 지운다. */
export async function setNote(store: Store, input: { pageId: string; note: string }, now: string = new Date().toISOString()) {
  const page = requirePage(store, input.pageId);
  const after = normalizeNote(input.note);
  const before = page.note ?? '';
  const next: Page = { ...page };
  if (after) next.note = after;
  else delete next.note;
  const written = await writePage(store, next, now);
  return { page: ref(written), before, after, note: [SIDEPANEL_NOTE] };
}

export async function deletePages(store: Store, input: { ids: string[] }, now: string = new Date().toISOString()) {
  const pages: PageRef[] = [];
  const missing: string[] = [];
  for (const id of input.ids) {
    const page = store.pages.get(id);
    if (!page) {
      missing.push(id);
      continue;
    }
    pages.push(ref(await writePage(store, { ...page, deletedAt: now }, now)));
  }
  return {
    pages,
    missing,
    note: ['Deleted pages are kept as tombstones for 30 days by the Markpin extension (this server never purges files) and can be brought back with restore_pages.', SIDEPANEL_NOTE]
  };
}

export async function restorePages(store: Store, input: { ids: string[] }, now: string = new Date().toISOString()) {
  const pages: PageRef[] = [];
  const missing: string[] = [];
  const skipped: string[] = [];
  const note: string[] = [];
  for (const id of input.ids) {
    const dead = store.tombstones.get(id);
    if (!dead) {
      missing.push(id);
      continue;
    }
    const liveId = store.byUrl.get(safeNormalize(dead.url));
    if (liveId) {
      skipped.push(id);
      note.push(`Skipped ${id}: another live page already has its URL (${liveId})`);
      continue;
    }
    const live: Page = { ...dead };
    delete live.deletedAt;
    pages.push(ref(await writePage(store, live, now)));
  }
  note.push(SIDEPANEL_NOTE);
  return { pages, missing, skipped, note };
}
