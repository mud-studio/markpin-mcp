import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CLIP_COLORS, CLIP_KINDS, MAX_CLIP_TEXT_CHARS, normalizeNote, normalizeUrl } from '@markpin/shared';
import pkg from '../package.json';
import type { Lang } from './cli';
import { confirmLabel, confirmMessage, type Change } from './messages';
import type { Store } from './store';
import { getPage, listRecent, listTags, search } from './tools';
import { addClip, clearBookmark, deletePages, markRead, markSkimmed, MAX_SUMMARY_CHARS, planTags, restorePages, savePage, setBookmark, setClipNote, setNote, setSummary, updateTags, type FetchPage } from './tools-write';

export type ServerOptions = {
  store: () => Store;
  allowWrite: boolean;
  lang: Lang;
  fetchPage: FetchPage;
  serial: <T>(fn: () => Promise<T>) => Promise<T>;
};

const WRITE_RULE =
  'Call only for a change the user explicitly asked for in this conversation. Before calling, tell the user in one line what will change; after, report the returned before/after.';

type Gate = 'elicitation' | 'client';

function json<T extends Record<string, unknown>>(data: T) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

export function createServer(opts: ServerOptions): McpServer {
  const server = new McpServer({ name: 'markpin', version: pkg.version }); // package.json과 항상 같게(발행 버전)
  const store = opts.store;

  server.registerTool(
    'search',
    {
      title: 'Search saved pages',
      description:
        'Full-text search over pages saved with Markpin (title, extracted content, clipped text, notes, tags). ' +
        'Returns page summaries ranked by relevance with a short snippet around the first match. ' +
        'With an empty query, lists the most recently updated pages (optionally filtered by tags). ' +
        'Summaries include readAt (when the user marked the page read) and bookmark (a reading bookmark: when it was set and, if placed inside the page, the sentence it points at).',
      inputSchema: {
        query: z.string().default('').describe('Search terms. Prefix matching is on, so "type" also matches "typescript".'),
        tags: z.array(z.string()).optional().describe('Only return pages that carry every one of these tags.'),
        bookmarked: z.boolean().optional().describe('Only pages with a reading bookmark (saved to read later or being read). With an empty query they come newest bookmark first.'),
        limit: z.number().int().min(1).max(100).optional().describe('Maximum number of results. Default 10.')
      },
      annotations: { readOnlyHint: true }
    },
    async (input) => json(search(store(), input))
  );

  server.registerTool(
    'get_page',
    {
      title: 'Get a saved page',
      description:
        "Returns one page in full: metadata, tags, summary, the reader's one-line note (`note`), reading state (`bookmark`, `readAt` or `skimmedAt` — at most one), extracted content, every clip with its note, highlight color and reaction mark (`kind`), " +
        'the absolute path of the Markdown file, and absolute paths of clip images. Accepts a page id or its URL.',
      inputSchema: { idOrUrl: z.string().describe('Page id (UUID) or the page URL.') },
      annotations: { readOnlyHint: true }
    },
    async ({ idOrUrl }) => {
      const result = getPage(store(), idOrUrl);
      return result ? json(result) : fail(`Page not found: ${idOrUrl}`);
    }
  );

  server.registerTool(
    'list_recent',
    {
      title: 'List recent pages',
      description: 'Lists the most recently updated pages, newest first. With bookmarked=true, lists pages with a reading bookmark, newest bookmark first.',
      inputSchema: {
        n: z.number().int().min(1).max(200).optional().describe('How many pages to return. Default 20.'),
        bookmarked: z.boolean().optional().describe('Only pages with a reading bookmark.')
      },
      annotations: { readOnlyHint: true }
    },
    async ({ n, bookmarked }) => json(listRecent(store(), n, bookmarked))
  );

  server.registerTool(
    'list_tags',
    {
      title: 'List tags',
      description: 'Lists every tag in use with the number of pages carrying it, most used first.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => json(listTags(store()))
  );

  if (!opts.allowWrite) return server;

  // 확인 대화상자는 사람이 응답할 때까지 기다린다 — SDK 기본 60초 요청 타임아웃보다 넉넉하게 잡는다.
  const CONFIRM_TIMEOUT_MS = 10 * 60_000;

  /** 게이트 3겹 중 셋째(§9.2). 클라이언트가 form elicitation을 못 하면 둘째(클라이언트 권한 프롬프트)에 맡긴다. */
  async function confirm(change: Change): Promise<Gate | 'declined'> {
    if (!server.server.getClientCapabilities()?.elicitation?.form) return 'client';
    const label = confirmLabel(opts.lang);
    const res = await server.server.elicitInput(
      {
        message: confirmMessage(opts.lang, change),
        requestedSchema: {
          type: 'object',
          properties: { confirm: { type: 'boolean', title: label.title, description: label.description } },
          required: ['confirm']
        }
      },
      { timeout: CONFIRM_TIMEOUT_MS }
    );
    return res.action === 'accept' && res.content?.confirm === true ? 'elicitation' : 'declined';
  }

  /** 쓰기 tool 공통 흐름: 인자 검증·요약 → 게이트 → 직렬 큐 안에서 실행 → JSON. 핸들러 예외는 isError. */
  function write<T extends Record<string, unknown>>(
    plan: () => Promise<{ change: Change | null; run: () => Promise<T> }>
  ) {
    return async () => {
      try {
        const { change, run } = await plan();
        let gate: Gate = 'client';
        if (change) {
          const g = await confirm(change);
          if (g === 'declined') return fail('User declined');
          gate = g;
        }
        const result = await opts.serial(run);
        return json({ ...result, gate });
      } catch (err) {
        if (err instanceof McpError && err.code === ErrorCode.RequestTimeout) return fail('No response to the confirmation; nothing was written.');
        return fail(err instanceof Error ? err.message : String(err));
      }
    };
  }

  const titlesOf = (ids: string[], from: Map<string, { title: string }>) =>
    ids.map((id) => from.get(id)?.title).filter((t): t is string => t !== undefined);

  server.registerTool(
    'save_page',
    {
      title: 'Save a web page',
      description:
        'Saves a URL as a new Markpin page. If the URL is already saved, returns that page without changes. ' +
        'Pass content when you already have the page text; otherwise the server fetches the URL and extracts the article. ' +
        'Whenever you have read the page (you pass content, or you fetched it yourself), also pass summary (one or two sentences in the user\'s language) ' +
        'and 2-5 short tags; reuse existing tags from list_tags when they fit. Markpin does not generate these for pages saved through MCP. ' +
        WRITE_RULE,
      inputSchema: {
        url: z.string().describe('The page URL (http or https).'),
        title: z.string().optional().describe('Page title. Taken from the page when omitted.'),
        content: z.string().optional().describe('Plain-text body to store. When omitted the server fetches and extracts it.'),
        summary: z.string().max(MAX_SUMMARY_CHARS).optional().describe(`One or two sentences in the user's language, at most ${MAX_SUMMARY_CHARS} characters.`),
        tags: z.array(z.string()).optional().describe('Tags to attach (2-5 short tags; prefer ones already in list_tags).')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    (input) =>
      write(async () => {
        // fetch는 게이트 승인 뒤 run()에서만 — 거절된 URL을 사용자 컴퓨터가 요청하지 않게 한다(§9.2 보안).
        const url = normalizeUrl(input.url);
        const change: Change | null = store().byUrl.has(url) ? null : { kind: 'save_page', title: input.title ?? url, url };
        return { change, run: () => savePage(store(), input, { fetchPage: opts.fetchPage }) };
      })()
  );

  server.registerTool(
    'update_tags',
    {
      title: 'Add or remove tags',
      description: 'Adds and/or removes tags on one or more pages in a single confirmation. ' + WRITE_RULE,
      inputSchema: {
        ids: z.array(z.string()).min(1).describe('Page ids.'),
        add: z.array(z.string()).optional().describe('Tags to add.'),
        remove: z.array(z.string()).optional().describe('Tags to remove.')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    (input) =>
      write(async () => {
        const s = store();
        // 실제로 태그가 바뀌는 페이지만 묻는다 — 이미 있는 태그를 더하는 호출은 확인 없이 no-op.
        const titles = input.ids.flatMap((id) => {
          const p = s.pages.get(id);
          return p && planTags(p.tags, input.add ?? [], input.remove ?? []) ? [p.title] : [];
        });
        const change: Change | null = titles.length ? { kind: 'update_tags', titles, add: input.add ?? [], remove: input.remove ?? [] } : null;
        return { change, run: () => updateTags(store(), input) };
      })()
  );

  server.registerTool(
    'add_clip',
    {
      title: 'Add a text clip',
      description: 'Adds a quoted text clip (with an optional note) to a saved page. The text should appear in the page content so it can be highlighted on revisit. ' + WRITE_RULE,
      inputSchema: {
        pageId: z.string().describe('Page id.'),
        text: z.string().trim().min(1).max(MAX_CLIP_TEXT_CHARS).describe('The exact text to clip.'),
        note: z.string().optional().describe('Your note on the clip.'),
        color: z.enum(CLIP_COLORS).optional().describe('Highlight color (amber, green, blue, pink). Default amber.'),
        kind: z.enum(CLIP_KINDS).optional().describe('Reaction mark: question (?), insight (!), disagree (×), star (★). Default none.')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    (input) =>
      write(async () => {
        const page = store().pages.get(input.pageId);
        if (!page) throw new Error(`Page not found: ${input.pageId}`);
        return { change: { kind: 'add_clip', title: page.title, text: input.text.trim() }, run: () => addClip(store(), input) };
      })()
  );

  server.registerTool(
    'set_clip_note',
    {
      title: 'Edit a clip note',
      description: 'Replaces the note on one clip. An empty note clears it. ' + WRITE_RULE,
      inputSchema: {
        pageId: z.string().describe('Page id.'),
        clipId: z.string().describe('Clip id (from get_page).'),
        note: z.string().describe('The new note text; empty to clear.')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    (input) =>
      write(async () => {
        const page = store().pages.get(input.pageId);
        if (!page) throw new Error(`Page not found: ${input.pageId}`);
        if (!page.clips.some((c) => c.id === input.clipId)) throw new Error(`Clip not found: ${input.clipId}`);
        return { change: { kind: 'set_clip_note', title: page.title, note: input.note }, run: () => setClipNote(store(), input) };
      })()
  );

  server.registerTool(
    'set_summary',
    {
      title: 'Write a page summary',
      description:
        'Replaces the summary of a saved page (one or two sentences in the user\'s language). An empty summary clears it. ' +
        'Use it for pages that have no summary yet, e.g. ones saved through MCP. ' + WRITE_RULE,
      inputSchema: {
        pageId: z.string().describe('Page id.'),
        summary: z.string().max(MAX_SUMMARY_CHARS).describe(`The new summary; empty to clear. At most ${MAX_SUMMARY_CHARS} characters.`)
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    (input) =>
      write(async () => {
        const page = store().pages.get(input.pageId);
        if (!page) throw new Error(`Page not found: ${input.pageId}`);
        return { change: { kind: 'set_summary', title: page.title, summary: input.summary.trim() }, run: () => setSummary(store(), input) };
      })()
  );

  server.registerTool(
    'set_note',
    {
      title: "Write the reader's one-line note",
      description: "Sets the reader's own one-line note on a page (what they took from it — frontmatter `note`). An empty note clears it. " + WRITE_RULE,
      inputSchema: {
        pageId: z.string().describe('Page id.'),
        note: z.string().max(500).describe('The one line; empty to clear. At most 500 characters.')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    (input) =>
      write(async () => {
        const page = store().pages.get(input.pageId);
        if (!page) throw new Error(`Page not found: ${input.pageId}`);
        return { change: { kind: 'set_note', title: page.title, note: normalizeNote(input.note) }, run: () => setNote(store(), input) };
      })()
  );

  server.registerTool(
    'delete_pages',
    {
      title: 'Delete pages',
      description:
        'Marks pages as deleted. They are kept as tombstones for 30 days by the Markpin extension (this server never purges files) ' +
        'and can be brought back with restore_pages. ' + WRITE_RULE,
      inputSchema: { ids: z.array(z.string()).min(1).describe('Page ids to delete.') },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
    },
    (input) =>
      write(async () => {
        const titles = titlesOf(input.ids, store().pages);
        return { change: titles.length ? { kind: 'delete_pages', titles } : null, run: () => deletePages(store(), input) };
      })()
  );

  server.registerTool(
    'restore_pages',
    {
      title: 'Restore deleted pages',
      description: 'Brings back pages deleted within the last 30 days. ' + WRITE_RULE,
      inputSchema: { ids: z.array(z.string()).min(1).describe('Page ids to restore.') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    (input) =>
      write(async () => {
        const titles = titlesOf(input.ids, store().tombstones);
        return { change: titles.length ? { kind: 'restore_pages', titles } : null, run: () => restorePages(store(), input) };
      })()
  );

  server.registerTool(
    'set_bookmark',
    {
      title: 'Bookmark a page',
      description:
        'Puts the reading bookmark on a page (one per page; replaces any existing one and clears its read mark). ' +
        'Without quote the page goes to the read-later list from the start; with quote (a sentence from the page content) the user resumes from there. ' + WRITE_RULE,
      inputSchema: {
        pageId: z.string().describe('Page id.'),
        quote: z.string().trim().min(1).max(MAX_CLIP_TEXT_CHARS).optional().describe('Exact sentence from the page content to resume from. Omit for a bookmark from the start.')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    (input) =>
      write(async () => {
        const page = store().pages.get(input.pageId);
        if (!page) throw new Error(`Page not found: ${input.pageId}`);
        const change: Change = input.quote === undefined ? { kind: 'set_bookmark', title: page.title } : { kind: 'set_bookmark', title: page.title, quote: input.quote.trim() };
        return { change, run: () => setBookmark(store(), input) };
      })()
  );

  server.registerTool(
    'clear_bookmark',
    {
      title: 'Remove a bookmark',
      description: 'Removes the reading bookmark from a page without marking it read. ' + WRITE_RULE,
      inputSchema: { pageId: z.string().describe('Page id.') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    (input) =>
      write(async () => {
        const page = store().pages.get(input.pageId);
        if (!page) throw new Error(`Page not found: ${input.pageId}`);
        return { change: page.bookmark ? { kind: 'clear_bookmark', title: page.title } : null, run: () => clearBookmark(store(), input) };
      })()
  );

  server.registerTool(
    'mark_read',
    {
      title: 'Mark a page as read',
      description: 'Marks a page as read (records readAt) and removes its bookmark, if any. ' + WRITE_RULE,
      inputSchema: { pageId: z.string().describe('Page id.') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    (input) =>
      write(async () => {
        const page = store().pages.get(input.pageId);
        if (!page) throw new Error(`Page not found: ${input.pageId}`);
        const noop = page.readAt !== undefined && !page.bookmark;
        return { change: noop ? null : { kind: 'mark_read', title: page.title }, run: () => markRead(store(), input) };
      })()
  );

  server.registerTool(
    'mark_skimmed',
    {
      title: 'Mark a page as skimmed',
      description: 'Marks a page as skimmed (records skimmedAt — the reader looked but did not read it through) and removes its bookmark and read mark, if any. ' + WRITE_RULE,
      inputSchema: { pageId: z.string().describe('Page id.') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    (input) =>
      write(async () => {
        const page = store().pages.get(input.pageId);
        if (!page) throw new Error(`Page not found: ${input.pageId}`);
        const noop = page.skimmedAt !== undefined && !page.bookmark && page.readAt === undefined;
        return { change: noop ? null : { kind: 'mark_skimmed', title: page.title }, run: () => markSkimmed(store(), input) };
      })()
  );

  return server;
}
