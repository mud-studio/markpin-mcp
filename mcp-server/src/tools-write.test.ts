import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { INBOX_PATH, parsePage } from '@markpin/shared';
import { loadDir, type Store } from './store';
import { makeFixture, mk } from './test/fixture';
import { addClip, clearBookmark, deletePages, INBOX_NOTE, markRead, restorePages, savePage, setBookmark, SIDEPANEL_NOTE, setClipNote, setSummary, updateTags } from './tools-write';
import { writePage } from './write';

const NOW = '2026-02-01T00:00:00.000Z';
const fetchPage = async (url: string) => ({ title: `Fetched ${url}`, content: 'fetched body text' });
const onDisk = (store: Store, id: string) => readFile(store.paths.get(id)!, 'utf8').then(parsePage);

describe('savePage', () => {
  it('creates a page from given content, normalizing url and tags', async () => {
    const { dir } = await makeFixture();
    const store = await loadDir(dir);
    const r = await savePage(store, { url: 'https://E.com/new/?utm_source=x', title: 'New', content: 'body here', tags: ['#a b', 'A-B'] }, { fetchPage }, NOW);
    expect(r.created).toBe(true);
    expect(r.page.url).toBe('https://e.com/new');
    expect(r.page.tags).toEqual(['a-b']);
    const disk = await onDisk(store, r.page.id);
    expect(disk).toMatchObject({ title: 'New', domain: 'e.com', rev: 1, savedAt: NOW, updatedAt: NOW, contentText: 'body here', clips: [] });
    expect(store.byUrl.get('https://e.com/new')).toBe(r.page.id);
  });
  it('fetches title and content when content is not given', async () => {
    const { dir } = await makeFixture();
    const store = await loadDir(dir);
    const r = await savePage(store, { url: 'https://e.com/fetch' }, { fetchPage }, NOW);
    expect(r.page.title).toBe('Fetched https://e.com/fetch');
    expect((await onDisk(store, r.page.id)).contentText).toBe('fetched body text');
    const emptyTitleFetch = async () => ({ title: '', content: 'x' });
    const r2 = await savePage(store, { url: 'https://e.com/untitled' }, { fetchPage: emptyTitleFetch }, NOW);
    expect(r2.page.title).toBe('https://e.com/untitled');
  });
  it('keeps the existing body when reviving a tombstone with empty content', async () => {
    const { dir } = await makeFixture();
    const store = await loadDir(dir);
    const tomb = mk('f6f6f6f6-0000-4000-8000-000000000006', {
      url: 'https://e.com/tomb', title: 'Tomb', contentText: 'kept body', deletedAt: '2026-01-04T00:00:00.000Z'
    });
    await writePage(store, tomb, '2026-01-04T00:00:00.000Z');
    const r = await savePage(store, { url: tomb.url, content: '' }, { fetchPage }, NOW);
    expect(r.revived).toBe(true);
    const disk = await onDisk(store, r.page.id);
    expect(disk.contentText).toBe('kept body');
    expect(disk.deletedAt).toBeUndefined();
  });
  it('returns the existing page without writing when the url is already saved', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    const r = await savePage(store, { url: 'https://e.com/react?utm_source=x', content: 'ignored' }, { fetchPage }, NOW);
    expect(r).toMatchObject({ created: false, revived: false, page: { id: pages.a.id } });
    expect((await onDisk(store, pages.a.id)).rev).toBe(pages.a.rev);
  });
  it('revives a tombstone for the same url instead of creating a second page', async () => {
    const { dir } = await makeFixture();
    const store = await loadDir(dir);
    const dead = [...store.tombstones.values()][0];
    const r = await savePage(store, { url: dead.url, content: 'back' }, { fetchPage }, NOW);
    expect(r).toMatchObject({ created: true, revived: true, page: { id: dead.id } });
    expect(store.tombstones.has(dead.id)).toBe(false);
    expect((await onDisk(store, dead.id)).deletedAt).toBeUndefined();
  });
  it('rejects a non-http url', async () => {
    const { dir } = await makeFixture();
    const store = await loadDir(dir);
    await expect(savePage(store, { url: 'ftp://x', content: 'c' }, { fetchPage }, NOW)).rejects.toThrow();
  });
  it('notes the side panel delay for an ordinary folder', async () => {
    const { dir } = await makeFixture();
    const store = await loadDir(dir);
    const r = await savePage(store, { url: 'https://e.com/n2', content: 'c' }, { fetchPage }, NOW);
    expect(r.note).toEqual([SIDEPANEL_NOTE]);
    expect(SIDEPANEL_NOTE).toContain('30 seconds');
  });
  it('save_page notes the inbox route when an inbox exists', async () => {
    const { dir } = await makeFixture();
    await writeFile(join(dir, INBOX_PATH), '', 'utf8');
    const store = await loadDir(dir);
    const result = await savePage(store, { url: 'https://e.com/new', title: 'New', content: 'body' }, { fetchPage: async () => { throw new Error('no'); } });
    expect(result.created).toBe(true);
    expect(result.note).toEqual([INBOX_NOTE]);
    expect(store.pending.has(result.page.id)).toBe(true);
  });
});

describe('updateTags', () => {
  it('adds and removes tags across pages, reporting before/after and missing ids', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    const r = await updateTags(store, { ids: [pages.a.id, pages.c.id, 'nope'], add: ['REACT', 'new tag'], remove: ['life'] }, NOW);
    expect(r.missing).toEqual(['nope']);
    expect(r.pages).toEqual([
      { id: pages.a.id, title: pages.a.title, before: ['react', 'frontend'], after: ['react', 'frontend', 'new-tag'] },
      { id: pages.c.id, title: pages.c.title, before: ['life', 'react'], after: ['react', 'new-tag'] }
    ]);
    expect((await onDisk(store, pages.c.id)).tags).toEqual(['react', 'new-tag']);
  });
  it('does not write a page whose tags would not change', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    const r = await updateTags(store, { ids: [pages.b.id], add: ['db'] }, NOW);
    expect(r.pages).toEqual([]);
    expect((await onDisk(store, pages.b.id)).rev).toBe(pages.b.rev);
  });
});

describe('addClip', () => {
  it('adds a text clip anchored with prefix/suffix from the content', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    const r = await addClip(store, { pageId: pages.a.id, text: 'immer', note: 'memo' }, NOW);
    expect(r.anchored).toBe(true);
    const clip = (await onDisk(store, pages.a.id)).clips.find((c) => c.id === r.clipId)!;
    expect(clip).toMatchObject({ type: 'text', text: 'immer', note: 'memo', createdAt: NOW, updatedAt: NOW, color: 'amber' });
    expect(clip.selectors).toEqual([{ type: 'TextQuoteSelector', exact: 'immer', prefix: 'zustand 와 ', suffix: ' 비교' }]);
  });
  it('falls back to exact-only when the text is not in the content', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    const r = await addClip(store, { pageId: pages.a.id, text: 'not there' }, NOW);
    expect(r.anchored).toBe(false);
    const clip = (await onDisk(store, pages.a.id)).clips.find((c) => c.id === r.clipId)!;
    expect(clip.selectors).toEqual([{ type: 'TextQuoteSelector', exact: 'not there' }]);
    expect(clip.note).toBe('');
  });
  it('stores the requested color (§21.3)', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    const r = await addClip(store, { pageId: pages.a.id, text: 'immer', color: 'blue' }, NOW);
    const clip = (await onDisk(store, pages.a.id)).clips.find((c) => c.id === r.clipId)!;
    expect(clip.color).toBe('blue');
  });
  it('rejects empty, too long, or unknown page', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    await expect(addClip(store, { pageId: pages.a.id, text: '   ' }, NOW)).rejects.toThrow(/empty/);
    await expect(addClip(store, { pageId: pages.a.id, text: 'x'.repeat(10_001) }, NOW)).rejects.toThrow(/10000/);
    await expect(addClip(store, { pageId: 'nope', text: 'x' }, NOW)).rejects.toThrow(/not found/);
  });
});

describe('setClipNote', () => {
  it('replaces the note and bumps the clip updatedAt', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    const r = await setClipNote(store, { pageId: pages.b.id, clipId: 'c1', note: '다시' }, NOW);
    expect(r).toMatchObject({ before: '복습', after: '다시', clipId: 'c1' });
    const clip = (await onDisk(store, pages.b.id)).clips[0];
    expect(clip.note).toBe('다시');
    expect(clip.updatedAt).toBe(NOW);
    await expect(setClipNote(store, { pageId: pages.b.id, clipId: 'zz', note: '' }, NOW)).rejects.toThrow(/not found/);
  });
});

describe('savePage summary', () => {
  it('stores a trimmed summary and rejects one over 300 characters', async () => {
    const { dir } = await makeFixture();
    const store = await loadDir(dir);
    const r = await savePage(store, { url: 'https://e.com/sum', title: 'S', content: 'body', summary: '  두 문장 요약.  ' }, { fetchPage }, NOW);
    expect((await onDisk(store, r.page.id)).summary).toBe('두 문장 요약.');
    await expect(savePage(store, { url: 'https://e.com/long', content: 'body', summary: 'x'.repeat(301) }, { fetchPage }, NOW)).rejects.toThrow(/300/);
    expect(store.byUrl.has('https://e.com/long')).toBe(false);
  });
});

describe('setSummary', () => {
  it('replaces the summary, reports before/after, and clears it on empty', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    const r = await setSummary(store, { pageId: pages.a.id, summary: '새 요약' }, NOW);
    expect(r).toMatchObject({ before: '상태 라이브러리 비교', after: '새 요약' });
    expect((await onDisk(store, pages.a.id)).summary).toBe('새 요약');
    const r2 = await setSummary(store, { pageId: pages.a.id, summary: '' }, NOW);
    expect(r2).toMatchObject({ before: '새 요약', after: '' });
    expect((await onDisk(store, pages.a.id)).summary).toBeUndefined();
    await expect(setSummary(store, { pageId: 'nope', summary: 'x' }, NOW)).rejects.toThrow(/not found/);
  });
});

describe('deletePages / restorePages', () => {
  it('skips restoring a tombstone whose hand-edited url normalizes to a live page url', async () => {
    const { dir } = await makeFixture();
    const store = await loadDir(dir);
    const dead = mk('f9f9f9f9-0000-4000-8000-000000000009', { url: 'https://E.com/react/?utm_source=x', title: 'Old', deletedAt: NOW });
    await writePage(store, dead, NOW);
    const r = await restorePages(store, { ids: [dead.id] }, NOW);
    expect(r.skipped).toEqual([dead.id]);
    expect(store.tombstones.has(dead.id)).toBe(true);
  });
  it('savePage revives a tombstone whose hand-edited url normalizes to the saved url', async () => {
    const { dir } = await makeFixture();
    const store = await loadDir(dir);
    const dead = mk('fafafafa-0000-4000-8000-00000000000a', { url: 'https://E.com/revive/', title: 'Old', deletedAt: NOW });
    await writePage(store, dead, NOW);
    const r = await savePage(store, { url: 'https://e.com/revive', content: 'again' }, { fetchPage }, NOW);
    expect(r.revived).toBe(true);
    expect(r.page.id).toBe(dead.id);
  });
  it('tombstones live pages and restores them, skipping unknown ids', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    const d = await deletePages(store, { ids: [pages.a.id, 'nope'] }, NOW);
    expect(d.pages).toEqual([{ id: pages.a.id, title: pages.a.title }]);
    expect(d.missing).toEqual(['nope']);
    expect((await onDisk(store, pages.a.id)).deletedAt).toBe(NOW);
    expect(store.pages.has(pages.a.id)).toBe(false);
    const r = await restorePages(store, { ids: [pages.a.id, pages.b.id] }, NOW);
    expect(r.pages).toEqual([{ id: pages.a.id, title: pages.a.title }]);
    expect(r.missing).toEqual([pages.b.id]);
    expect((await onDisk(store, pages.a.id)).deletedAt).toBeUndefined();
    expect(store.pages.has(pages.a.id)).toBe(true);
  });
  it('skips restoring a tombstone whose url is already owned by a different live page', async () => {
    const { dir } = await makeFixture();
    const store = await loadDir(dir);
    const dead = [...store.tombstones.values()][0];
    const other = mk('f7f7f7f7-0000-4000-8000-000000000007', { url: dead.url, title: 'Other owner' });
    await writePage(store, other, NOW);
    const r = await restorePages(store, { ids: [dead.id] }, NOW);
    expect(r.skipped).toEqual([dead.id]);
    expect(r.pages).toEqual([]);
    expect(r.note.some((n) => n.includes(dead.id) && n.includes(other.id))).toBe(true);
    expect(store.tombstones.has(dead.id)).toBe(true);
  });
});

describe('bookmarks (§21.2)', () => {
  it('setBookmark with a quote anchors it in the content, shortens the quote and clears readAt', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    await writePage(store, { ...pages.a, readAt: '2026-01-05T00:00:00.000Z', contentText: 'zustand 와 ' + 'immer 비교 '.repeat(10).trim() }, '2026-01-05T00:00:00.000Z');
    const r = await setBookmark(store, { pageId: pages.a.id, quote: 'immer 비교 '.repeat(10) }, NOW);
    expect(r.anchored).toBe(true);
    const disk = await onDisk(store, pages.a.id);
    expect(disk.readAt).toBeUndefined();
    expect(disk.bookmark?.createdAt).toBe(NOW);
    expect(disk.bookmark?.quote).toBe('immer 비교 '.repeat(6) + 'immer …'); // 60자 + …
    expect(disk.bookmark?.selectors).toEqual([{ type: 'TextQuoteSelector', exact: 'immer 비교 '.repeat(10).trim(), prefix: 'zustand 와 ' }]);
    expect(r.note).toContain(SIDEPANEL_NOTE);
  });
  it('setBookmark without a quote is a bookmark from the start; an unfound quote is kept but flagged', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    const r = await setBookmark(store, { pageId: pages.b.id }, NOW);
    expect(r.anchored).toBeUndefined();
    const disk = await onDisk(store, pages.b.id);
    expect(disk.bookmark).toEqual({ createdAt: NOW });
    expect(disk.readAt).toBeUndefined();
    const r2 = await setBookmark(store, { pageId: pages.b.id, quote: 'not there' }, NOW);
    expect(r2.anchored).toBe(false);
    expect((await onDisk(store, pages.b.id)).bookmark).toEqual({ createdAt: NOW, quote: 'not there', selectors: [{ type: 'TextQuoteSelector', exact: 'not there' }] });
    await expect(setBookmark(store, { pageId: pages.b.id, quote: '   ' }, NOW)).rejects.toThrow(/empty/);
    await expect(setBookmark(store, { pageId: 'nope' }, NOW)).rejects.toThrow(/not found/);
  });
  it('clearBookmark removes it and is a no-op without one', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    const r = await clearBookmark(store, { pageId: pages.c.id }, NOW);
    expect(r.changed).toBe(true);
    expect((await onDisk(store, pages.c.id)).bookmark).toBeUndefined();
    const r2 = await clearBookmark(store, { pageId: pages.b.id }, NOW);
    expect(r2.changed).toBe(false);
    expect((await onDisk(store, pages.b.id)).rev).toBe(pages.b.rev);
  });
  it('markRead records readAt and drops the bookmark; already-read pages are untouched', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    const r = await markRead(store, { pageId: pages.c.id }, NOW);
    expect(r.changed).toBe(true);
    const disk = await onDisk(store, pages.c.id);
    expect(disk.readAt).toBe(NOW);
    expect(disk.bookmark).toBeUndefined();
    const r2 = await markRead(store, { pageId: pages.b.id }, NOW);
    expect(r2.changed).toBe(false);
    expect((await onDisk(store, pages.b.id)).readAt).toBe(pages.b.readAt);
  });
});

describe('template from markpin.json (§21.4)', () => {
  it('renders written files with the obsidian preset while keeping the frontmatter', async () => {
    const { dir, pages } = await makeFixture({ template: 'obsidian', trashOnDelete: false });
    const store = await loadDir(dir);
    const r = await addClip(store, { pageId: pages.a.id, text: 'immer', note: 'memo' }, NOW);
    const text = await readFile(store.paths.get(pages.a.id)!, 'utf8');
    expect(text).toContain('\n==immer==\n\nmemo\n');
    expect(parsePage(text).clips.find((c) => c.id === r.clipId)?.note).toBe('memo');
  });
});
