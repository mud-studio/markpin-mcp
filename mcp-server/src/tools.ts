import { resolve, sep } from 'node:path';
import { snippetFor, type Bookmark, type Hit, type Page } from '@markpin/shared';
import { safeNormalize, type Store } from './store';

export type PageSummary = Pick<Page, 'id' | 'url' | 'title' | 'domain' | 'savedAt' | 'updatedAt' | 'tags' | 'summary' | 'readAt'> & {
  /** 읽기 책갈피(§21.2). 셀렉터는 뺀다. */
  bookmark?: Pick<Bookmark, 'createdAt' | 'quote'>;
};
export type SearchItem = PageSummary & { score?: number; snippet?: Hit };

const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_RECENT = 20;

function toSummary(p: Page): PageSummary {
  const s: PageSummary = { id: p.id, url: p.url, title: p.title, domain: p.domain, savedAt: p.savedAt, updatedAt: p.updatedAt, tags: p.tags };
  if (p.summary !== undefined) s.summary = p.summary;
  if (p.readAt !== undefined) s.readAt = p.readAt;
  if (p.bookmark) {
    s.bookmark = { createdAt: p.bookmark.createdAt };
    if (p.bookmark.quote !== undefined) s.bookmark.quote = p.bookmark.quote;
  }
  return s;
}

const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

function recent(store: Store): Page[] {
  return [...store.pages.values()].sort((a, b) => desc(a.updatedAt, b.updatedAt));
}

/** 책갈피 있는 페이지, 최근에 꽂은 순. */
function bookmarked(store: Store): Page[] {
  return [...store.pages.values()].filter((p) => p.bookmark).sort((a, b) => desc(a.bookmark!.createdAt, b.bookmark!.createdAt));
}

export function search(store: Store, input: { query: string; tags?: string[]; bookmarked?: boolean; limit?: number }): { results: SearchItem[] } {
  const query = input.query.trim();
  const tags = input.tags ?? [];
  const limit = input.limit ?? DEFAULT_SEARCH_LIMIT;
  const keep = (p: Page) => tags.every((t) => p.tags.includes(t)) && (!input.bookmarked || p.bookmark !== undefined);
  if (!query) return { results: (input.bookmarked ? bookmarked(store) : recent(store)).filter(keep).slice(0, limit).map(toSummary) };
  const results: SearchItem[] = [];
  for (const hit of store.index.search(query)) {
    if (results.length >= limit) break;
    const page = store.pages.get(hit.id as string);
    if (!page || !keep(page)) continue;
    // 스니펫은 본문을 훑으므로 limit 안에 든 결과만 만든다
    const item: SearchItem = { ...toSummary(page), score: hit.score };
    const snippet = snippetFor(page, hit.terms);
    if (snippet) item.snippet = snippet;
    results.push(item);
  }
  return { results };
}

export function getPage(store: Store, idOrUrl: string): { page: Page & { path: string } } | null {
  let id: string | undefined = store.pages.has(idOrUrl) ? idOrUrl : undefined;
  if (!id) id = store.byUrl.get(safeNormalize(idOrUrl));
  const page = id ? store.pages.get(id) : undefined;
  if (!page || !id) return null;
  const clips = page.clips.map((c) => {
    if (!c.image) return c;
    const resolved = resolve(store.dir, c.image.path);
    const path = resolved.startsWith(store.dir + sep) ? resolved : c.image.path;
    return { ...c, image: { ...c.image, path } };
  });
  return { page: { ...page, clips, path: store.paths.get(id)! } };
}

export function listRecent(store: Store, n = DEFAULT_RECENT, onlyBookmarked = false): { pages: PageSummary[] } {
  return { pages: (onlyBookmarked ? bookmarked(store) : recent(store)).slice(0, n).map(toSummary) };
}

export function listTags(store: Store): { tags: Array<{ tag: string; count: number }> } {
  const counts = new Map<string, number>();
  for (const page of store.pages.values()) for (const tag of page.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const tags = [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'en'));
  return { tags };
}
