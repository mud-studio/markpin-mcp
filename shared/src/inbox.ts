import type { Page } from './types';

/** 확장이 만들고 MCP만 쓰는 인박스 파일(§9.4). Markpin 폴더 루트. */
export const INBOX_PATH = 'inbox.jsonl';

/** 한 줄에 페이지 하나(JSON). 비어 있으면 빈 문자열. */
export function serializeInbox(pages: Page[]): string {
  return pages.map((p) => `${JSON.stringify(p)}\n`).join('');
}

function isPage(v: unknown): v is Page {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === 'string' && typeof p.url === 'string' && typeof p.title === 'string' &&
    typeof p.updatedAt === 'string' && typeof p.rev === 'number' && Array.isArray(p.tags) && Array.isArray(p.clips) &&
    typeof p.savedAt === 'string' && typeof p.domain === 'string'
  );
}

/** 깨진 줄·필수 필드 누락은 건너뛴다. 같은 id가 여러 줄이면 마지막 줄이 이기고 자리는 처음 자리. */
export function parseInbox(text: string): Page[] {
  const byId = new Map<string, Page>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (isPage(value)) byId.set(value.id, value);
  }
  return [...byId.values()];
}
