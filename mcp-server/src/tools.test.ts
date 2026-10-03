import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pagePath, serializePage, type Page } from '@markpin/shared';
import { loadDir, type Store } from './store';
import { getPage, listRecent, listTags, search } from './tools';
import { makeFixture, mk } from './test/fixture';

let store: Store;
let dir: string;
let P: { a: Page; b: Page; c: Page };

beforeAll(async () => {
  ({ dir, pages: P } = await makeFixture());
  store = await loadDir(dir);
});

const ids = (r: { results: { id: string }[] } | { pages: { id: string }[] }) =>
  ('results' in r ? r.results : r.pages).map((x) => x.id);

describe('search', () => {
  it('ranks by relevance and attaches score and snippet', () => {
    const r = search(store, { query: 'zustand' });
    expect(ids(r)).toEqual([P.a.id]);
    expect(r.results[0].score).toBeGreaterThan(0);
    expect(r.results[0].snippet).toEqual({ source: 'content', before: '', hit: 'zustand', after: ' 와 immer 비교' });
    expect(r.results[0]).not.toHaveProperty('contentText');
  });
  it('omits snippet when only title or tags match', () => {
    const r = search(store, { query: '요리법' });
    expect(ids(r)).toEqual([P.c.id]);
    expect(r.results[0]).not.toHaveProperty('snippet');
  });
  it('filters by all given tags (AND)', () => {
    expect(ids(search(store, { query: 'react', tags: ['react', 'life'] }))).toEqual([P.c.id]);
    expect(ids(search(store, { query: 'react', tags: ['nope'] }))).toEqual([]);
  });
  it('lists recent pages filtered by tags when the query is empty', () => {
    const r = search(store, { query: '  ', tags: ['react'] });
    expect(ids(r)).toEqual([P.a.id, P.c.id]);
    expect(r.results[0]).not.toHaveProperty('score');
  });
  it('applies limit (default 10)', () => {
    expect(ids(search(store, { query: '', limit: 1 }))).toEqual([P.a.id]);
    expect(search(store, { query: '' }).results).toHaveLength(3);
  });
});

describe('bookmarks (§21.2)', () => {
  it('summaries carry readAt and the bookmark without selectors', () => {
    const r = search(store, { query: '' });
    const byId = new Map(r.results.map((x) => [x.id, x]));
    expect(byId.get(P.c.id)?.bookmark).toEqual({ createdAt: P.c.bookmark!.createdAt, quote: '재료 준비' });
    expect(byId.get(P.a.id)?.bookmark).toEqual({ createdAt: P.a.bookmark!.createdAt });
    expect(byId.get(P.b.id)?.readAt).toBe(P.b.readAt);
    expect(byId.get(P.b.id)).not.toHaveProperty('bookmark');
  });
  it('search with bookmarked=true keeps bookmarked pages, newest bookmark first when the query is empty', () => {
    expect(ids(search(store, { query: '', bookmarked: true }))).toEqual([P.c.id, P.a.id]);
    expect(ids(search(store, { query: 'react', bookmarked: true }))).toEqual([P.a.id, P.c.id]);
    expect(ids(search(store, { query: '', tags: ['life'], bookmarked: true }))).toEqual([P.c.id]);
  });
  it('listRecent with bookmarked=true does the same', () => {
    expect(ids(listRecent(store, 20, true))).toEqual([P.c.id, P.a.id]);
    expect(ids(listRecent(store, 1, true))).toEqual([P.c.id]);
  });
});

describe('getPage', () => {
  it('finds by id and returns the full page with absolute file and image paths', () => {
    const r = getPage(store, P.b.id);
    expect(r?.page.path).toBe(join(dir, pagePath(P.b)));
    expect(r?.page.clips[0].image?.path).toBe(join(dir, 'assets/c1.webp'));
    expect(r?.page.clips[0].note).toBe('복습');
  });
  it('finds by url after normalization', () => {
    expect(getPage(store, 'https://e.com/react/?utm_source=x')?.page.id).toBe(P.a.id);
    expect(getPage(store, 'https://e.com/react')?.page.contentText).toBe('zustand 와 immer 비교');
  });
  it('returns null for unknown id, unknown url and garbage', () => {
    expect(getPage(store, 'nope')).toBeNull();
    expect(getPage(store, 'https://e.com/missing')).toBeNull();
    expect(getPage(store, 'not a url')).toBeNull();
  });
});

describe('getPage non-http url', () => {
  it('finds a page whose url cannot be normalized by that raw url', async () => {
    const odd = await mkdtemp(join(tmpdir(), 'markpin-mcp-odd-'));
    const page = mk('f8f8f8f8-0000-4000-8000-000000000008', { url: 'file:///notes/a.html', domain: '', title: 'Local' });
    const abs = join(odd, pagePath(page));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, serializePage(page), 'utf8');
    const oddStore = await loadDir(odd);
    expect(getPage(oddStore, 'file:///notes/a.html')?.page.id).toBe(page.id);
  });
});

describe('listRecent', () => {
  it('orders by updatedAt desc and defaults to 20', () => {
    expect(ids(listRecent(store))).toEqual([P.a.id, P.b.id, P.c.id]);
    expect(ids(listRecent(store, 2))).toEqual([P.a.id, P.b.id]);
  });
});

describe('listTags', () => {
  it('counts tags, most used first then alphabetical', () => {
    expect(listTags(store)).toEqual({
      tags: [{ tag: 'react', count: 2 }, { tag: 'db', count: 1 }, { tag: 'frontend', count: 1 }, { tag: 'life', count: 1 }]
    });
  });
});

describe('getPage image path escape', () => {
  it('does not let a traversal-crafted image.path escape --dir', async () => {
    const escapeDir = await mkdtemp(join(tmpdir(), 'markpin-mcp-escape-'));
    const page = mk('f6f6f6f6-0000-4000-8000-000000000006', {
      url: 'https://e.com/escape', title: 'Escape',
      clips: [{
        id: 'c1', type: 'region', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        text: '', note: '', selectors: [],
        image: { path: '../../../../etc/passwd', width: 1, height: 1 }
      }]
    });
    const abs = join(escapeDir, pagePath(page));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, serializePage(page), 'utf8');
    const escapeStore = await loadDir(escapeDir);

    const r = getPage(escapeStore, page.id);
    expect(r?.page.clips[0].image?.path).toBe('../../../../etc/passwd');
    expect(r?.page.clips[0].image?.path.startsWith('/')).toBe(false);
  });
});
