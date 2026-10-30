import { beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'node:fs/promises';
import { exceedsFileLimit, parsePage, type Clip } from '@markpin/shared';
import { createSerial } from './serial';
import { createServer } from './server';
import { loadDir, type Store } from './store';
import { makeFixture } from './test/fixture';

type Elicit = 'accept' | 'decline' | 'none' | 'url-only' | 'accept-trust' | 'decline-trust';

async function connect(store: Store, opts: { allowWrite: boolean; elicit: Elicit; lang?: 'ko' | 'en' }) {
  const seen: string[] = [];
  const schemas: Array<Record<string, unknown>> = [];
  const fetched: string[] = [];
  const server = createServer({
    store: () => store,
    allowWrite: opts.allowWrite,
    lang: opts.lang ?? 'en',
    fetchPage: async (url) => {
      fetched.push(url);
      return { title: `F ${url}`, content: 'fetched' };
    },
    serial: createSerial()
  });
  const capabilities =
    opts.elicit === 'none' ? {} : opts.elicit === 'url-only' ? { capabilities: { elicitation: { url: {} } } } : { capabilities: { elicitation: {} } };
  const client = new Client({ name: 't', version: '0' }, capabilities);
  if (opts.elicit !== 'none' && opts.elicit !== 'url-only') {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      seen.push(req.params.message);
      schemas.push((req.params as { requestedSchema?: Record<string, unknown> }).requestedSchema ?? {});
      if (opts.elicit === 'accept') return { action: 'accept', content: { confirm: true } };
      if (opts.elicit === 'accept-trust') return { action: 'accept', content: { confirm: true, trust: true } };
      if (opts.elicit === 'decline-trust') return { action: 'accept', content: { confirm: false, trust: true } };
      return { action: 'decline' };
    });
  }
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    return { isError: r.isError === true, text, json: r.isError ? null : JSON.parse(text) };
  };
  return { client, call, seen, schemas, fetched, close: () => Promise.all([client.close(), server.close()]) };
}

let store: Store;
let dir: string;
beforeEach(async () => {
  ({ dir } = await makeFixture());
  store = await loadDir(dir);
});

describe('server identity', () => {
  it('reports the package.json version', async () => {
    const c = await connect(store, { allowWrite: false, elicit: 'none' });
    const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(c.client.getServerVersion()?.version).toBe(version);
    await c.close();
  });
});

describe('tool registration', () => {
  it('exposes only read tools without --allow-write', async () => {
    const c = await connect(store, { allowWrite: false, elicit: 'none' });
    const names = (await c.client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['get_page', 'list_recent', 'list_tags', 'search']);
    await c.close();
  });
  it('exposes write tools with annotations when --allow-write', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'none' });
    const tools = (await c.client.listTools()).tools;
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual(['add_clip', 'batch', 'clear_bookmark', 'delete_pages', 'get_page', 'list_recent', 'list_tags', 'mark_read', 'mark_skimmed', 'restore_pages', 'retag', 'save_page', 'search', 'set_bookmark', 'set_clip_note', 'set_note', 'set_summary', 'update_tags']);
    expect(byName.search.annotations?.readOnlyHint).toBe(true);
    expect(byName.update_tags.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    expect(byName.delete_pages.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    for (const name of ['save_page', 'update_tags', 'add_clip', 'set_clip_note', 'set_summary', 'set_note', 'delete_pages', 'restore_pages', 'set_bookmark', 'clear_bookmark', 'mark_read', 'mark_skimmed']) {
      expect(byName[name].description).toContain('Call only for a change the user explicitly asked for in this conversation.');
    }
    expect(byName.set_summary.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    expect(byName.save_page.description).toContain('summary');
    expect(byName.save_page.description).toContain('list_tags');
    await c.close();
  });
});

describe('write gate', () => {
  it('asks via elicitation and writes on accept', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept', lang: 'ko' });
    const a = [...store.pages.values()].find((p) => p.title === 'React 상태 관리')!;
    const r = await c.call('update_tags', { ids: [a.id], add: ['new'] });
    expect(r.isError).toBe(false);
    expect(c.seen).toEqual(["'React 상태 관리'에 태그 new 추가할까요?"]);
    expect(r.json.gate).toBe('elicitation');
    expect(r.json.pages[0].after).toContain('new');
    expect(parsePage(await readFile(store.paths.get(a.id)!, 'utf8')).tags).toContain('new');
    await c.close();
  });
  it('shows the normalized one-line in the set_note confirmation, matching what is written (§21.5 review)', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept', lang: 'ko' });
    const a = [...store.pages.values()].find((p) => p.title === 'React 상태 관리')!;
    const r = await c.call('set_note', { pageId: a.id, note: '  한 줄\n둘째 ' });
    expect(r.isError).toBe(false);
    expect(c.seen).toEqual(["'React 상태 관리'의 한 줄을 \"한 줄 둘째\"으로 바꿀까요?"]);
    expect(parsePage(await readFile(store.paths.get(a.id)!, 'utf8')).note).toBe('한 줄 둘째');
    await c.close();
  });
  it('returns isError and writes nothing on decline', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'decline' });
    const a = [...store.pages.values()].find((p) => p.title === 'React 상태 관리')!;
    const r = await c.call('delete_pages', { ids: [a.id] });
    expect(r.isError).toBe(true);
    expect(r.text).toBe('User declined');
    expect(store.pages.has(a.id)).toBe(true);
    expect(parsePage(await readFile(store.paths.get(a.id)!, 'utf8')).deletedAt).toBeUndefined();
    await c.close();
  });
  it('falls back to the client prompt when the client only declares url-mode elicitation', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'url-only' });
    const a = [...store.pages.values()].find((p) => p.title === 'React 상태 관리')!;
    const r = await c.call('update_tags', { ids: [a.id], add: ['new'] });
    expect(r.isError).toBe(false);
    expect(r.json.gate).toBe('client');
    await c.close();
  });
  it('falls back to the client prompt when the client cannot elicit', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'none' });
    const a = [...store.pages.values()].find((p) => p.title === 'React 상태 관리')!;
    const r = await c.call('add_clip', { pageId: a.id, text: 'immer', note: 'n' });
    expect(r.isError).toBe(false);
    expect(r.json.gate).toBe('client');
    expect(r.json.anchored).toBe(true);
    await c.close();
  });
  it('does not ask when there is nothing to change and reports handler errors as isError', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept' });
    const r1 = await c.call('update_tags', { ids: ['nope'], add: ['x'] });
    expect(r1.isError).toBe(false);
    expect(r1.json.missing).toEqual(['nope']);
    expect(c.seen).toEqual([]);
    const r2 = await c.call('add_clip', { pageId: 'nope', text: 'x' });
    expect(r2.isError).toBe(true);
    expect(r2.text).toBe('Page not found: nope');
    const r3 = await c.call('save_page', { url: 'ftp://x' });
    expect(r3.isError).toBe(true);
    await c.close();
  });
  it('save_page asks with the url before fetching, then fetches once accepted', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept' });
    const r = await c.call('save_page', { url: 'https://e.com/brand-new' });
    expect(r.isError).toBe(false);
    expect(c.seen).toEqual(["Save 'https://e.com/brand-new' (https://e.com/brand-new) to Markpin?"]);
    expect(c.fetched).toEqual(['https://e.com/brand-new']);
    expect(r.json.created).toBe(true);
    await c.close();
  });
  it('does not fetch the url when the save is declined', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'decline' });
    const r = await c.call('save_page', { url: 'https://e.com/brand-new' });
    expect(r.isError).toBe(true);
    expect(r.text).toBe('User declined');
    expect(c.fetched).toEqual([]);
    expect(store.byUrl.has('https://e.com/brand-new')).toBe(false);
    await c.close();
  });
  it('set_summary asks with the page title and writes on accept', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept', lang: 'ko' });
    const a = [...store.pages.values()].find((p) => p.title === 'React 상태 관리')!;
    const r = await c.call('set_summary', { pageId: a.id, summary: '요약입니다' });
    expect(r.isError).toBe(false);
    expect(c.seen).toEqual(["'React 상태 관리'의 요약을 \"요약입니다\"으로 바꿀까요?"]);
    expect(r.json).toMatchObject({ before: '상태 라이브러리 비교', after: '요약입니다', gate: 'elicitation' });
    expect(parsePage(await readFile(store.paths.get(a.id)!, 'utf8')).summary).toBe('요약입니다');
    await c.close();
  });
  it('does not ask when update_tags would change nothing', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept' });
    const b = [...store.pages.values()].find((p) => p.title === 'Postgres 인덱스')!;
    const r = await c.call('update_tags', { ids: [b.id], add: ['db'] });
    expect(r.isError).toBe(false);
    expect(c.seen).toEqual([]);
    expect(r.json.pages).toEqual([]);
    expect(parsePage(await readFile(store.paths.get(b.id)!, 'utf8')).rev).toBe(b.rev);
    await c.close();
  });
});

describe('retag', () => {
  it('asks once, listing every item, then renames across pages', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept', lang: 'ko' });
    const a = [...store.pages.values()].find((p) => p.title === 'React 상태 관리')!;
    const r = await c.call('retag', { changes: [{ from: 'react', to: 'ui' }, { from: 'frontend' }] });
    expect(r.isError).toBe(false);
    expect(c.seen).toEqual(["태그 'react' → 'ui'(2개), 'frontend' 삭제(1개)로 바꿀까요?"]);
    expect(r.json.changes).toEqual([{ from: 'react', to: 'ui', pages: 2 }, { from: 'frontend', to: null, pages: 1 }]);
    expect(r.json.pages).toHaveLength(2);
    expect(r.json.gate).toBe('elicitation');
    expect(parsePage(await readFile(store.paths.get(a.id)!, 'utf8')).tags).toEqual(['ui']);
    await c.close();
  });
  it('does not ask when nothing would change', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept' });
    const r = await c.call('retag', { changes: [{ from: 'nobody', to: 'x' }] });
    expect(r.isError).toBe(false);
    expect(c.seen).toEqual([]);
    expect(r.json.pages).toEqual([]);
    await c.close();
  });
  it('rejects an invalid target tag without asking', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept' });
    const r = await c.call('retag', { changes: [{ from: 'react', to: '#' }] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Invalid tag/);
    expect(c.seen).toEqual([]);
    await c.close();
  });
});

describe('batch', () => {
  const byTitle = (title: string) => [...store.pages.values()].find((p) => p.title === title)!;
  it('rejects unknown tool, bad args and nested batch before asking', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept', lang: 'ko' });
    const a = byTitle('React 상태 관리');
    const r = await c.call('batch', { ops: [{ tool: 'mark_read', args: { pageId: a.id } }, { tool: 'nope', args: {} }, { tool: 'set_summary', args: { pageId: a.id } }, { tool: 'batch', args: { ops: [] } }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('ops[1]: unknown tool');
    expect(r.text).toContain('ops[2]:');
    expect(r.text).toContain('ops[3]: unknown tool');
    expect(c.seen).toEqual([]);
    expect(store.pages.get(a.id)!.readAt).toBeUndefined();
    await c.close();
  });
  it('rejects a plan-stage error (missing page) without asking or writing', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept', lang: 'ko' });
    const a = byTitle('React 상태 관리');
    const r = await c.call('batch', { ops: [{ tool: 'set_summary', args: { pageId: a.id, summary: 'S' } }, { tool: 'add_clip', args: { pageId: 'nope', text: 'x' } }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('ops[1]: Page not found: nope');
    expect(c.seen).toEqual([]);
    expect(store.pages.get(a.id)!.rev).toBe(a.rev);
    expect(store.pages.get(a.id)!.summary).toBe('상태 라이브러리 비교');
    await c.close();
  });
  it('asks once with a numbered list and runs in order', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept', lang: 'ko' });
    const a = byTitle('React 상태 관리');
    const r = await c.call('batch', { ops: [{ tool: 'set_summary', args: { pageId: a.id, summary: 'S' } }, { tool: 'add_clip', args: { pageId: a.id, text: 'immer' } }, { tool: 'mark_read', args: { pageId: a.id } }] });
    expect(r.isError).toBe(false);
    expect(c.seen).toHaveLength(1);
    const lines = c.seen[0].split('\n');
    expect(lines[0]).toBe('다음 3개를 적용할까요?');
    expect(lines[1]).toMatch(/^1\. .*요약/);
    expect(lines[2]).toMatch(/^2\. .*immer/);
    expect(lines[3]).toMatch(/^3\. /);
    expect(r.json.completed).toBe(3);
    expect(r.json.gate).toBe('elicitation');
    expect(r.json.results.map((x: { tool: string; ok: boolean }) => [x.tool, x.ok])).toEqual([['set_summary', true], ['add_clip', true], ['mark_read', true]]);
    expect(typeof r.json.results[1].result.clipId).toBe('string');
    expect(r.json.results[1].result.anchored).toBe(true);
    const disk = parsePage(await readFile(store.paths.get(a.id)!, 'utf8'));
    expect(disk.summary).toBe('S');
    expect(disk.clips).toHaveLength(1);
    expect(disk.readAt).toBeDefined();
    expect(disk.rev).toBe(a.rev + 3);
    await c.close();
  });
  it('a single change in a batch asks with the plain sentence', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept', lang: 'ko' });
    const a = byTitle('React 상태 관리');
    const b = byTitle('Postgres 인덱스'); // 이미 읽음·책갈피 없음 → no-op
    const r = await c.call('batch', { ops: [{ tool: 'mark_read', args: { pageId: b.id } }, { tool: 'mark_read', args: { pageId: a.id } }] });
    expect(r.isError).toBe(false);
    expect(c.seen).toEqual(["'React 상태 관리'을(를) 읽음으로 표시할까요?".replace('을(를)', '를')]);
    expect(r.json.completed).toBe(1);
    expect(r.json.results[0]).toEqual({ tool: 'mark_read', ok: true, skipped: true });
    await c.close();
  });
  it('runs with no confirmation when nothing changes', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept', lang: 'ko' });
    const b = byTitle('Postgres 인덱스');
    const r = await c.call('batch', { ops: [{ tool: 'mark_read', args: { pageId: b.id } }] });
    expect(r.isError).toBe(false);
    expect(c.seen).toEqual([]);
    expect(r.json.results).toEqual([{ tool: 'mark_read', ok: true, skipped: true }]);
    expect(r.json.completed).toBe(0);
    expect(r.json.gate).toBe('client');
    await c.close();
  });
  it('later ops see earlier writes', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept', lang: 'ko' });
    const a = byTitle('React 상태 관리');
    const r = await c.call('batch', { ops: [{ tool: 'add_clip', args: { pageId: a.id, text: 'zustand' } }, { tool: 'add_clip', args: { pageId: a.id, text: 'immer' } }, { tool: 'set_clip_note', args: { pageId: a.id, clipId: 'later', note: 'n' } }] });
    // set_clip_note는 계획 단계에서 clipId를 찾으므로 같은 묶음에서 만든 클립은 참조할 수 없다(설명에 명시).
    expect(r.isError).toBe(true);
    expect(r.text).toContain('ops[2]: Clip not found: later');
    const r2 = await c.call('batch', { ops: [{ tool: 'add_clip', args: { pageId: a.id, text: 'zustand' } }, { tool: 'add_clip', args: { pageId: a.id, text: 'immer' } }] });
    expect(r2.isError).toBe(false);
    const disk = parsePage(await readFile(store.paths.get(a.id)!, 'utf8'));
    expect(disk.clips.map((k) => k.text)).toEqual(['zustand', 'immer']);
    expect(disk.rev).toBe(a.rev + 2);
    await c.close();
  });
  it('stops at the first runtime failure and reports completed', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept', lang: 'ko' });
    const a = byTitle('React 상태 관리');
    // 파일 상한(512KB) 바로 아래까지 클립을 채운다: 작은 쓰기(mark_read)는 되고 큰 클립 추가는 run()에서 터진다.
    const big = (id: string, n: number): Clip => ({ id, type: 'text', createdAt: a.updatedAt, updatedAt: a.updatedAt, text: 'x'.repeat(n), note: '', selectors: [] });
    const probe = big('probe', 1000);
    let n = 0;
    while (!exceedsFileLimit({ ...a, clips: [...a.clips, probe] })) a.clips.push(big(`k${n++}`, 1000));
    a.clips.pop();
    const r = await c.call('batch', { ops: [{ tool: 'mark_read', args: { pageId: a.id } }, { tool: 'add_clip', args: { pageId: a.id, text: 'y'.repeat(3000) } }, { tool: 'set_note', args: { pageId: a.id, note: 'never' } }] });
    expect(r.isError).toBe(false);
    expect(c.seen).toHaveLength(1);
    expect(r.json.completed).toBe(1);
    expect(r.json.results).toHaveLength(2);
    expect(r.json.results[0]).toMatchObject({ tool: 'mark_read', ok: true });
    expect(r.json.results[1]).toMatchObject({ tool: 'add_clip', ok: false, error: 'Page exceeds the 512KB file limit' });
    const disk = parsePage(await readFile(store.paths.get(a.id)!, 'utf8'));
    expect(disk.readAt).toBeDefined();
    expect(disk.note).toBeUndefined();
    await c.close();
  });
  it('skips ops that planned as no-op instead of running them after earlier ops changed state', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept', lang: 'ko' });
    const x = [...store.tombstones.values()].find((p) => p.title === 'Deleted')!;
    // delete_pages는 계획 시점에 X가 tombstone이라 null(no-op) → 앞 op가 되살려도 실행하지 않는다(확인 없는 쓰기 방지).
    const r = await c.call('batch', { ops: [{ tool: 'restore_pages', args: { ids: [x.id] } }, { tool: 'delete_pages', args: { ids: [x.id] } }] });
    expect(r.isError).toBe(false);
    expect(c.seen).toEqual(["'Deleted'를 복구할까요?"]);
    expect(r.json.results).toEqual([expect.objectContaining({ tool: 'restore_pages', ok: true }), { tool: 'delete_pages', ok: true, skipped: true }]);
    expect(r.json.completed).toBe(1);
    expect(store.pages.has(x.id)).toBe(true);
    expect(parsePage(await readFile(store.paths.get(x.id)!, 'utf8')).deletedAt).toBeUndefined();
    await c.close();
  });
  it('does not fetch before the confirmation', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'decline', lang: 'en' });
    const a = byTitle('React 상태 관리');
    const r = await c.call('batch', { ops: [{ tool: 'save_page', args: { url: 'https://e.com/new' } }, { tool: 'mark_read', args: { pageId: a.id } }] });
    expect(r.isError).toBe(true);
    expect(r.text).toBe('User declined');
    expect(c.seen).toHaveLength(1);
    expect(c.seen[0].split('\n')[0]).toBe('Apply these 2 changes?');
    expect(c.fetched).toEqual([]);
    expect(store.pages.get(a.id)!.readAt).toBeUndefined();
    await c.close();
  });
  it('is listed with the write rule and tells models to prefer it over repeated single writes', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'none' });
    const tools = (await c.client.listTools()).tools;
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.batch.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
    expect(byName.batch.description).toContain('cannot be referenced by a later op');
    expect(byName.batch.description).toContain('skipped');
    expect(byName.update_tags.description).toContain('use batch (or retag for tag merges) so the user confirms once');
    await c.close();
  });
});

describe('trust ("don\'t ask again on this connection")', () => {
  const byTitle = (title: string) => [...store.pages.values()].find((p) => p.title === title)!;
  it('offers the trust checkbox as an optional boolean in the form', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept', lang: 'ko' });
    await c.call('mark_read', { pageId: byTitle('React 상태 관리').id });
    expect(c.schemas[0]).toMatchObject({
      type: 'object',
      properties: { confirm: { type: 'boolean', title: '진행' }, trust: { type: 'boolean', title: '이 연결 동안 묻지 않기', default: false } },
      required: ['confirm']
    });
    await c.close();
  });
  it('trust skips later confirmations on this connection, including delete_pages and batch', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept-trust', lang: 'ko' });
    const a = byTitle('React 상태 관리');
    const b = byTitle('Postgres 인덱스');
    const r1 = await c.call('set_summary', { pageId: a.id, summary: 'S' });
    expect(r1.json.gate).toBe('elicitation');
    expect(c.seen).toHaveLength(1);
    const r2 = await c.call('set_note', { pageId: a.id, note: 'n' });
    expect(r2.json.gate).toBe('trusted');
    const r3 = await c.call('delete_pages', { ids: [b.id] });
    expect(r3.json.gate).toBe('trusted');
    const r4 = await c.call('batch', { ops: [{ tool: 'mark_read', args: { pageId: a.id } }] });
    expect(r4.json.gate).toBe('trusted');
    expect(r4.json.completed).toBe(1);
    expect(c.seen).toHaveLength(1);
    expect(store.pages.has(b.id)).toBe(false);
    expect(store.pages.get(a.id)!.note).toBe('n');
    await c.close();
  });
  it('confirm:false with trust:true is a decline and does not trust', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'decline-trust', lang: 'ko' });
    const a = byTitle('React 상태 관리');
    const r1 = await c.call('set_summary', { pageId: a.id, summary: 'S' });
    expect(r1.isError).toBe(true);
    expect(r1.text).toBe('User declined');
    const r2 = await c.call('set_summary', { pageId: a.id, summary: 'S' });
    expect(r2.isError).toBe(true);
    expect(c.seen).toHaveLength(2);
    expect(store.pages.get(a.id)!.summary).toBe('상태 라이브러리 비교');
    await c.close();
  });
  it('trust is per connection', async () => {
    const c1 = await connect(store, { allowWrite: true, elicit: 'accept-trust', lang: 'ko' });
    const c2 = await connect(store, { allowWrite: true, elicit: 'accept', lang: 'ko' });
    const a = byTitle('React 상태 관리');
    await c1.call('set_summary', { pageId: a.id, summary: 'S1' });
    const r = await c2.call('set_summary', { pageId: a.id, summary: 'S2' });
    expect(r.json.gate).toBe('elicitation');
    expect(c2.seen).toHaveLength(1);
    const r2 = await c1.call('set_summary', { pageId: a.id, summary: 'S3' });
    expect(r2.json.gate).toBe('trusted');
    expect(c1.seen).toHaveLength(1);
    await Promise.all([c1.close(), c2.close()]);
  });
  it('a client without forms keeps gate client and is never trusted', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'none', lang: 'ko' });
    const a = byTitle('React 상태 관리');
    const r = await c.call('set_summary', { pageId: a.id, summary: 'S' });
    expect(r.json.gate).toBe('client');
    await c.close();
  });
});

describe('add_clip pen', () => {
  it('accepts a pen from CLIP_PENS, defaults to highlight and rejects unknown pens', async () => {
    const c = await connect(store, { allowWrite: true, elicit: 'accept', lang: 'ko' });
    const a = [...store.pages.values()].find((p) => p.title === 'React 상태 관리')!;
    const r = await c.call('add_clip', { pageId: a.id, text: 'immer', pen: 'lasso' });
    const r2 = await c.call('add_clip', { pageId: a.id, text: 'zustand' });
    const bad = await c.call('add_clip', { pageId: a.id, text: 'zustand', pen: 'crayon' });
    expect(bad.isError).toBe(true);
    const disk = parsePage(await readFile(store.paths.get(a.id)!, 'utf8'));
    expect(disk.clips.find((k) => k.id === r.json.clipId)!.pen).toBe('lasso');
    expect(disk.clips.find((k) => k.id === r2.json.clipId)!.pen).toBe('highlight');
    const tools = (await c.client.listTools()).tools;
    expect(tools.find((t) => t.name === 'add_clip')!.description).toContain('pen');
    await c.close();
  });
});
