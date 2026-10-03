import { describe, expect, it } from 'vitest';
import { bookmarkQuote, QUOTE_CHARS } from './bookmark';

describe('bookmarkQuote', () => {
  it('collapses whitespace and keeps short text as is', () => {
    expect(bookmarkQuote('  여기까지\n 읽음 ')).toBe('여기까지 읽음');
  });
  it('cuts long text at the limit with an ellipsis', () => {
    const long = 'a'.repeat(QUOTE_CHARS + 20);
    expect(bookmarkQuote(long)).toBe('a'.repeat(QUOTE_CHARS) + '…');
  });
  it('returns an empty string for blank input', () => {
    expect(bookmarkQuote('   ')).toBe('');
  });
});
