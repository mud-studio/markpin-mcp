export const QUOTE_CHARS = 60;

/** 책갈피가 가리키는 문장 앞부분(§21.2). 목록·MCP 표시용이라 짧게 자른다. */
export function bookmarkQuote(exact: string): string {
  const text = exact.replace(/\s+/g, ' ').trim();
  return text.length > QUOTE_CHARS ? `${text.slice(0, QUOTE_CHARS)}…` : text;
}
