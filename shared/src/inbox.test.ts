import { describe, expect, it } from 'vitest';
import { INBOX_PATH, parseInbox, serializeInbox } from './inbox';
import type { Page } from './types';

const page = (id: string, over: Partial<Page> = {}): Page => ({
  id, url: `https://e.com/${id}`, title: id, domain: 'e.com',
  savedAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z', rev: 1, tags: [], clips: [], ...over
});

describe('inbox', () => {
  it('INBOX_PATH is the root-level jsonl file', () => {
    expect(INBOX_PATH).toBe('inbox.jsonl');
  });

  it('round-trips pages one per line with a trailing newline', () => {
    const pages = [page('a', { tags: ['x'] }), page('b', { contentText: '본문\n둘째 줄' })];
    const text = serializeInbox(pages);
    expect(text.split('\n')).toHaveLength(3);
    expect(text.endsWith('\n')).toBe(true);
    expect(parseInbox(text)).toEqual(pages);
    expect(serializeInbox([])).toBe('');
  });

  it('skips blank, unparsable and incomplete lines', () => {
    const good = JSON.stringify(page('a'));
    const { savedAt: _savedAt, ...missingSavedAt } = page('d');
    const text = `\n${good}\nnot json\n${JSON.stringify({ id: 'b', url: 'https://e.com/b' })}\n${JSON.stringify({ ...page('c'), rev: '1' })}\n${JSON.stringify(missingSavedAt)}\n`;
    expect(parseInbox(text).map((p) => p.id)).toEqual(['a']);
  });

  it('keeps the last line for a duplicated id, in first-seen order', () => {
    const text = serializeInbox([page('a', { rev: 1 }), page('b'), page('a', { rev: 2 })]);
    const out = parseInbox(text);
    expect(out.map((p) => [p.id, p.rev])).toEqual([['a', 2], ['b', 1]]);
  });
});
