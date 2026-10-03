import { describe, expect, it } from 'vitest';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { INBOX_PATH, pagePath, parsePage, serializeInbox, serializePage, type Page } from '@markpin/shared';
import { readInbox, writeInbox } from './inbox';
import { loadDir } from './store';
import { V1_PAGE_FILE, makeFixture, mk } from './test/fixture';
import { writePage } from './write';

const NOW = '2026-02-01T00:00:00.000Z';

describe('writePage', () => {
  it('rewrites a v1 file as v2 on the first write (§22)', async () => {
    const { dir } = await makeFixture();
    const abs = join(dir, 'pages/2026/v1-page-5f1c2a3b.md');
    await writeFile(abs, V1_PAGE_FILE);
    const store = await loadDir(dir);
    const page = store.pages.get('5f1c2a3b-1111-2222-3333-444444444444')!;
    await writePage(store, { ...page, tags: [...page.tags, 'v2'] });
    const out = await readFile(abs, 'utf8');
    expect(out.startsWith('---\ntitle: 예시 글 제목\n')).toBe(true);
    expect(out).toContain('\n<!-- markpin\n{"v":2,');
    expect(out.endsWith('\n-->\n')).toBe(true);
    expect(out).not.toContain('markpin: 1');
  });

  it('bumps rev and updatedAt, overwrites the existing file in place and updates the store', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    const before = store.pages.get(pages.a.id)!;
    const abs = store.paths.get(pages.a.id)!;
    const written = await writePage(store, { ...before, tags: [...before.tags, 'new'] }, NOW);
    expect(written.rev).toBe(before.rev + 1);
    expect(written.updatedAt).toBe(NOW);
    // 제자리 쓰기 — 경로가 그대로여야 Drive for Desktop의 fileId가 유지된다.
    expect(store.paths.get(pages.a.id)).toBe(abs);
    const onDisk = parsePage(await readFile(abs, 'utf8'));
    expect(onDisk.tags).toContain('new');
    expect(onDisk.rev).toBe(before.rev + 1);
    expect(store.pages.get(pages.a.id)?.tags).toContain('new');
    expect(store.index.search('new').map((r) => r.id)).toEqual([pages.a.id]);
    const leftovers = (await readdir(join(dir, 'pages/2026'))).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });
  it('refuses to write when the file changed on disk since it was read, and resyncs the store', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    const stale = store.pages.get(pages.a.id)!;
    const abs = store.paths.get(pages.a.id)!;
    const external = { ...stale, tags: ['external'], rev: stale.rev + 1, updatedAt: '2026-03-01T00:00:00.000Z' };
    await writeFile(abs, serializePage(external), 'utf8');
    await expect(writePage(store, { ...stale, tags: ['mine'] }, NOW)).rejects.toThrow(/changed on disk/);
    expect(store.pages.get(pages.a.id)?.tags).toEqual(['external']);
    expect(parsePage(await readFile(abs, 'utf8')).tags).toEqual(['external']);
    expect(parsePage(await readFile(abs, 'utf8')).rev).toBe(external.rev);
  });
  it('creates the file for a new page under pages/{year}/ via tmp+rename and indexes it', async () => {
    const { dir } = await makeFixture();
    const store = await loadDir(dir);
    const fresh: Page = mk('99999999-0000-4000-8000-000000000009', { url: 'https://e.com/new', title: 'Brand new', contentText: 'hello world', rev: 0, savedAt: '2027-03-01T00:00:00.000Z' });
    const written = await writePage(store, fresh, NOW);
    expect(written.rev).toBe(1);
    expect(store.paths.get(fresh.id)).toBe(join(dir, pagePath(fresh)));
    expect(parsePage(await readFile(store.paths.get(fresh.id)!, 'utf8')).title).toBe('Brand new');
    expect(store.byUrl.get('https://e.com/new')).toBe(fresh.id);
    expect(store.index.search('hello').map((r) => r.id)).toEqual([fresh.id]);
    const leftovers = (await readdir(dirname(store.paths.get(fresh.id)!))).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });
  it('moves a page between pages and tombstones', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    const live = store.pages.get(pages.c.id)!;
    await writePage(store, { ...live, deletedAt: NOW }, NOW);
    expect(store.pages.has(pages.c.id)).toBe(false);
    expect(store.tombstones.get(pages.c.id)?.deletedAt).toBe(NOW);
    expect(store.byUrl.has(pages.c.url)).toBe(false);
    expect(store.index.search('요리법')).toEqual([]);
    const restored = { ...store.tombstones.get(pages.c.id)! };
    delete restored.deletedAt;
    await writePage(store, restored, NOW);
    expect(store.tombstones.has(pages.c.id)).toBe(false);
    expect(store.pages.get(pages.c.id)?.deletedAt).toBeUndefined();
    expect(parsePage(await readFile(store.paths.get(pages.c.id)!, 'utf8')).deletedAt).toBeUndefined();
  });
  it('refuses a page whose overhead exceeds the file limit and leaves the file untouched', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    const live = store.pages.get(pages.a.id)!;
    const huge = { ...live, clips: [{ id: 'x', type: 'text' as const, createdAt: NOW, updatedAt: NOW, text: 'y'.repeat(600 * 1024), note: '', selectors: [] }] };
    await expect(writePage(store, huge, NOW)).rejects.toThrow(/file limit/);
    expect(parsePage(await readFile(store.paths.get(pages.a.id)!, 'utf8')).rev).toBe(live.rev);
    expect(store.pages.get(pages.a.id)?.rev).toBe(live.rev);
  });
});

describe('writePage with an inbox', () => {
  it('routes a new page into the inbox instead of pages/ and marks it pending', async () => {
    const { dir } = await makeFixture();
    await writeFile(join(dir, INBOX_PATH), '', 'utf8');
    const store = await loadDir(dir);
    const page = mk('f1f1f1f1-0000-4000-8000-000000000009', { url: 'https://e.com/fresh', title: 'Fresh', rev: 0 });
    const written = await writePage(store, page, '2026-09-24T00:00:00.000Z');
    expect(written.rev).toBe(1);
    expect(store.pending.has(page.id)).toBe(true);
    expect(store.paths.get(page.id)).toBe(join(dir, INBOX_PATH));
    expect((await readInbox(store.inbox!)).map((p) => [p.id, p.rev])).toEqual([[page.id, 1]]);
    const files = await readdir(join(dir, 'pages', '2026'));
    expect(files.some((f) => f.includes('fresh'))).toBe(false);
  });

  it('updates a pending page inside the inbox and rejects a stale write', async () => {
    const { dir } = await makeFixture();
    const page = mk('f1f1f1f1-0000-4000-8000-000000000009', { url: 'https://e.com/fresh', title: 'Fresh' });
    await writeFile(join(dir, INBOX_PATH), serializeInbox([page]), 'utf8');
    const store = await loadDir(dir);
    const updated = await writePage(store, { ...page, tags: ['t'] }, '2026-09-24T00:00:00.000Z');
    expect(updated.rev).toBe(2);
    expect((await readInbox(store.inbox!))[0].tags).toEqual(['t']);
    // 디스크(인박스)가 더 새로워진 뒤의 쓰기는 거부
    await writeInbox(store.inbox!, [{ ...updated, rev: 5, updatedAt: '2026-09-25T00:00:00.000Z' }]);
    await expect(writePage(store, { ...updated, tags: ['u'] })).rejects.toThrow('Page changed on disk since it was read');
    expect(store.pages.get(page.id)?.rev).toBe(5);
  });

  it('still writes existing page files in place when an inbox exists', async () => {
    const { dir, pages } = await makeFixture();
    await writeFile(join(dir, INBOX_PATH), '', 'utf8');
    const store = await loadDir(dir);
    await writePage(store, { ...pages.a, tags: ['x'] });
    expect(parsePage(await readFile(join(dir, pagePath(pages.a)), 'utf8')).tags).toEqual(['x']);
    expect(await readInbox(store.inbox!)).toEqual([]);
  });
});
