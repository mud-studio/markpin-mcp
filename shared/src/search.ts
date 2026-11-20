import MiniSearch from 'minisearch';
import type { Page } from './types';

export type PageDoc = { id: string; title: string; contentText: string; clipsText: string; tagsText: string; noteText: string };

const FIELDS: (keyof PageDoc)[] = ['title', 'contentText', 'clipsText', 'tagsText', 'noteText'];

export function toDoc(page: Page): PageDoc {
  return {
    id: page.id,
    title: page.title,
    contentText: page.contentText ?? '',
    clipsText: page.clips.map((c) => `${c.text}\n${c.note}`).join('\n'),
    tagsText: page.tags.join(' '),
    noteText: page.note ?? ''
  };
}

export function createIndex(): MiniSearch<PageDoc> {
  return new MiniSearch<PageDoc>({
    fields: FIELDS,
    storeFields: [],
    tokenize: (text) => text.split(/[\s\p{P}]+/u).filter(Boolean),
    searchOptions: { prefix: true, boost: { title: 3, tagsText: 2 } }
  });
}

export function buildIndex(pages: Page[]): MiniSearch<PageDoc> {
  const index = createIndex();
  index.addAll(pages.map(toDoc));
  return index;
}

/** 색인 문서가 마지막으로 반영한 페이지 판. 병합·되살림은 rev만으론 못 가를 수 있어 updatedAt을 같이 본다. */
const signature = (page: Page) => `${page.rev}:${page.updatedAt}`;

/**
 * 색인을 `pages`에 맞춘다(사이드패널 규모 3): 없어진 id는 discard, 판이 바뀐 id는 replace, 새 id는 add.
 * `sigs`는 색인에 든 id → 판(호출자가 들고 넘기고, 함수가 갱신). 바뀐 페이지만 다시 토큰화한다.
 */
export function syncIndex(index: MiniSearch<PageDoc>, sigs: Map<string, string>, pages: Page[]): void {
  const seen = new Set<string>();
  for (const page of pages) {
    seen.add(page.id);
    const sig = signature(page);
    const prev = sigs.get(page.id);
    if (prev === sig) continue;
    if (prev === undefined) index.add(toDoc(page));
    else index.replace(toDoc(page));
    sigs.set(page.id, sig);
  }
  for (const id of [...sigs.keys()]) {
    if (seen.has(id)) continue;
    index.discard(id);
    sigs.delete(id);
  }
}

export type Hit = { source: 'clip' | 'content'; before: string; hit: string; after: string };

/** 스니펫 앞뒤 문맥 글자 수. 사이드패널 폭에서 2줄 안에 들어오는 크기. */
const SNIPPET_CONTEXT = 60;

const collapse = (s: string) => s.replace(/\s+/g, ' ');

/** 인덱스 토크나이저(공백·문장부호 분리)와 같은 경계. `B-tree`는 `b`·`tree`로 색인되므로 단어 시작에서만 맞춘다 — 아니면 `abstract`의 `b`를 잡는다. */
const BOUNDARY = /[\s\p{P}]/u;

function indexOfAnchored(lower: string, term: string): number {
  let i = lower.indexOf(term);
  while (i > 0 && !BOUNDARY.test(lower[i - 1])) i = lower.indexOf(term, i + 1);
  return i;
}

/**
 * 검색 일치 스니펫. 화면에 이미 보이는 제목·태그는 건너뛰고 클립(텍스트+메모) → 본문 순으로
 * 가장 먼저 나오는 용어 1개를 찾는다. 없으면 null.
 */
export function snippetFor(page: Page, terms: string[]): Hit | null {
  if (terms.length === 0) return null;
  const needles = terms.map((t) => t.toLowerCase());
  const sources: Array<{ source: Hit['source']; text: string }> = [
    ...page.clips.map((c) => ({ source: 'clip' as const, text: c.note ? `${c.text}\n${c.note}` : c.text })),
    ...(page.contentText ? [{ source: 'content' as const, text: page.contentText }] : [])
  ];
  for (const { source, text } of sources) {
    const lower = text.toLowerCase();
    let at = -1;
    let len = 0;
    for (const term of needles) {
      const i = indexOfAnchored(lower, term);
      if (i !== -1 && (at === -1 || i < at)) {
        at = i;
        len = term.length;
      }
    }
    if (at === -1) continue;
    const start = Math.max(0, at - SNIPPET_CONTEXT);
    const end = Math.min(text.length, at + len + SNIPPET_CONTEXT);
    return {
      source,
      before: (start > 0 ? '…' : '') + collapse(text.slice(start, at)),
      hit: text.slice(at, at + len),
      after: collapse(text.slice(at + len, end)) + (end < text.length ? '…' : '')
    };
  }
  return null;
}
