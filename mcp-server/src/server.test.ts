import { beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'node:fs/promises';
import { parsePage } from '@markpin/shared';
import { createSerial } from './serial';
import { createServer } from './server';
import { loadDir, type Store } from './store';
import { makeFixture } from './test/fixture';

type Elicit = 'accept' | 'decline' | 'none' | 'url-only';

async function connect(store: Store, opts: { allowWrite: boolean; elicit: Elicit; lang?: 'ko' | 'en' }) {
  const seen: string[] = [];
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
  if (opts.elicit === 'accept' || opts.elicit === 'decline') {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      seen.push(req.params.message);
      return opts.elicit === 'accept' ? { action: 'accept', content: { confirm: true } } : { action: 'decline' };
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
  return { client, call, seen, fetched, close: () => Promise.all([client.close(), server.close()]) };
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
    expect(Object.keys(byName).sort()).toEqual(['add_clip', 'clear_bookmark', 'delete_pages', 'get_page', 'list_recent', 'list_tags', 'mark_read', 'restore_pages', 'save_page', 'search', 'set_bookmark', 'set_clip_note', 'set_summary', 'update_tags']);
    expect(byName.search.annotations?.readOnlyHint).toBe(true);
    expect(byName.update_tags.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    expect(byName.delete_pages.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    for (const name of ['save_page', 'update_tags', 'add_clip', 'set_clip_note', 'set_summary', 'delete_pages', 'restore_pages', 'set_bookmark', 'clear_bookmark', 'mark_read']) {
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
