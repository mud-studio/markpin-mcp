import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, pagePath, serializeInbox, serializePage } from '@markpin/shared';
import { loadDir } from './store';
import { V1_PAGE_FILE, makeFixture, mk } from './test/fixture';

describe('loadDir', () => {
  it('loads live pages only — skips tombstones, conflict copies and unparsable files', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    expect([...store.pages.keys()].sort()).toEqual([pages.a.id, pages.b.id, pages.c.id].sort());
    expect(store.pages.get(pages.b.id)?.clips[0].note).toBe('복습');
  });
  it('maps normalized url and absolute file path per page', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    expect(store.byUrl.get('https://e.com/react')).toBe(pages.a.id);
    expect(store.paths.get(pages.a.id)).toBe(join(dir, pagePath(pages.a)));
  });
  it('builds a search index over the loaded pages', async () => {
    const { dir, pages } = await makeFixture();
    const store = await loadDir(dir);
    expect(store.index.search('zustand').map((r) => r.id)).toEqual([pages.a.id]);
  });
  it('keeps the newer file when two files share an id', async () => {
    const { dir } = await makeFixture();
    const old = mk('f6f6f6f6-0000-4000-8000-000000000006', { title: 'old', updatedAt: '2026-01-01T00:00:00.000Z' });
    const neu = { ...old, title: 'new', updatedAt: '2026-01-05T00:00:00.000Z', savedAt: '2027-01-01T00:00:00.000Z' };
    await mkdir(join(dir, 'pages/2027'), { recursive: true });
    await writeFile(join(dir, pagePath(old)), serializePage(old));
    await writeFile(join(dir, pagePath(neu)), serializePage(neu));
    const store = await loadDir(dir);
    expect(store.pages.get(old.id)?.title).toBe('new');
  });
  it('loads v1 files alongside v2 files (§22)', async () => {
    const { dir } = await makeFixture();
    await writeFile(join(dir, 'pages/2026/v1-page-5f1c2a3b.md'), V1_PAGE_FILE);
    const store = await loadDir(dir);
    const v1 = store.pages.get('5f1c2a3b-1111-2222-3333-444444444444');
    expect(v1?.title).toBe('예시 글 제목');
    expect(v1?.clips[0].note).toBe('내 메모');
  });
  it('skips a file whose markpin block is broken and keeps serving the rest', async () => {
    const { dir, pages } = await makeFixture();
    const abs = join(dir, pagePath(pages.a));
    await writeFile(abs, (await readFile(abs, 'utf8')).replace('"rev":', '"rev":,'));
    const store = await loadDir(dir);
    expect(store.pages.has(pages.a.id)).toBe(false);
    expect(store.pages.has(pages.b.id)).toBe(true);
  });
  it('returns an empty store when pages/ does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'markpin-mcp-empty-'));
    const store = await loadDir(dir);
    expect(store.pages.size).toBe(0);
    expect(store.index.search('anything')).toEqual([]);
  });
  it('keeps tombstones in a separate map with their paths', async () => {
    const { dir } = await makeFixture();
    const store = await loadDir(dir);
    const dead = [...store.tombstones.values()];
    expect(dead.map((p) => p.title)).toEqual(['Deleted']);
    expect(store.paths.get(dead[0].id)).toBe(join(dir, pagePath(dead[0])));
    expect(store.pages.has(dead[0].id)).toBe(false);
  });
  it('has no inbox and no pending pages when inbox.jsonl is absent', async () => {
    const { dir } = await makeFixture();
    const store = await loadDir(dir);
    expect(store.inbox).toBeNull();
    expect(store.pending.size).toBe(0);
  });

  it('loads inbox entries as pending pages, preferring a real page file for the same id', async () => {
    const { dir, pages } = await makeFixture();
    const stale = { ...pages.a, tags: ['stale'] };
    const fresh = mk('f1f1f1f1-0000-4000-8000-000000000009', { url: 'https://e.com/fresh', title: 'Fresh', tags: ['inbox'] });
    await writeFile(join(dir, 'inbox.jsonl'), serializeInbox([stale, fresh]), 'utf8');
    const store = await loadDir(dir);
    expect(store.inbox).toBe(join(dir, 'inbox.jsonl'));
    expect(store.pages.get(pages.a.id)?.tags).toEqual(['react', 'frontend']); // 정식 파일 승
    expect(store.pages.get(fresh.id)?.tags).toEqual(['inbox']);
    expect([...store.pending]).toEqual([fresh.id]);
    expect(store.paths.get(fresh.id)).toBe(store.inbox);
    expect(store.byUrl.get('https://e.com/fresh')).toBe(fresh.id);
    expect(store.index.search('Fresh').map((r) => r.id)).toEqual([fresh.id]);
  });

  it('loads a newer deletedAt inbox entry as a pending tombstone over the real page', async () => {
    const { dir, pages } = await makeFixture();
    const dead = { ...pages.a, deletedAt: '2026-01-09T00:00:00.000Z', updatedAt: '2026-01-09T00:00:00.000Z', rev: 2 };
    await writeFile(join(dir, 'inbox.jsonl'), serializeInbox([dead]), 'utf8');
    const store = await loadDir(dir);
    expect(store.pages.has(pages.a.id)).toBe(false);
    expect(store.tombstones.get(pages.a.id)?.deletedAt).toBe(dead.deletedAt);
    expect(store.byUrl.has('https://e.com/react')).toBe(false);
    expect([...store.pending]).toEqual([pages.a.id]);
    expect(store.paths.get(pages.a.id)).toBe(store.inbox);
    expect(store.index.search('zustand')).toEqual([]);
  });
});

describe('markpin.json (§21.4)', () => {
  it('defaults when the file is missing and reads it when present', async () => {
    const plain = await loadDir((await makeFixture()).dir);
    expect(plain.config).toEqual(DEFAULT_CONFIG);
    const obsidian = await loadDir((await makeFixture({ template: 'obsidian', trashOnDelete: true })).dir);
    expect(obsidian.config).toEqual({ template: 'obsidian', trashOnDelete: true });
  });
});
