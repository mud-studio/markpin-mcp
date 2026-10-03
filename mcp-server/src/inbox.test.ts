import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { INBOX_PATH, parseInbox, serializeInbox } from '@markpin/shared';
import { pruneInbox, readInbox, writeInbox } from './inbox';
import { loadDir } from './store';
import { makeFixture, mk } from './test/fixture';

describe('inbox (mcp)', () => {
  it('readInbox returns [] when the file is missing', async () => {
    const { dir } = await makeFixture();
    expect(await readInbox(join(dir, INBOX_PATH))).toEqual([]);
  });

  it('writeInbox rewrites the file in place', async () => {
    const { dir } = await makeFixture();
    const abs = join(dir, INBOX_PATH);
    await writeInbox(abs, [mk('p1', {})]);
    expect(parseInbox(await readFile(abs, 'utf8')).map((p) => p.id)).toEqual(['p1']);
  });

  it('pruneInbox drops entries whose page file has arrived and keeps the rest', async () => {
    const { dir, pages } = await makeFixture();
    const stale = { ...pages.a, tags: ['stale'] };
    const fresh = mk('f1f1f1f1-0000-4000-8000-000000000009', { url: 'https://e.com/fresh', title: 'Fresh' });
    await writeFile(join(dir, INBOX_PATH), serializeInbox([stale, fresh]), 'utf8');
    const store = await loadDir(dir);
    expect(await pruneInbox(store)).toBe(1);
    expect((await readInbox(store.inbox!)).map((p) => p.id)).toEqual([fresh.id]);
    expect(await pruneInbox(store)).toBe(0); // 두 번째는 쓰지 않는다
  });

  it('keeps an inbox entry that is newer than the page file (pending edit not yet pushed)', async () => {
    const { dir, pages } = await makeFixture();
    const newer = { ...pages.a, tags: ['edited-in-inbox'], rev: pages.a.rev + 1, updatedAt: '2026-09-24T12:00:00.000Z' };
    await writeFile(join(dir, INBOX_PATH), serializeInbox([newer]), 'utf8');
    const store = await loadDir(dir);
    expect(store.pending.has(pages.a.id)).toBe(true);
    expect(store.pages.get(pages.a.id)?.tags).toEqual(['edited-in-inbox']);
    expect(store.paths.get(pages.a.id)).toBe(store.inbox);
    expect(await pruneInbox(store)).toBe(0);
    expect((await readInbox(store.inbox!)).map((p) => p.id)).toEqual([pages.a.id]);
  });
});
