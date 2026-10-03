import { readFile, writeFile } from 'node:fs/promises';
import { parseInbox, serializeInbox, type Page } from '@markpin/shared';
import type { Store } from './store';

/** 인박스 파일을 읽는다. 없으면 빈 배열. 깨진 줄은 parseInbox가 건너뛴다. */
export async function readInbox(abs: string): Promise<Page[]> {
  try {
    return parseInbox(await readFile(abs, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** 제자리 덮어쓰기 — Drive for Desktop의 fileId를 보존한다(§9.2·§9.4). 임시파일+rename 금지. */
export function writeInbox(abs: string, pages: Page[]): Promise<void> {
  return writeFile(abs, serializeInbox(pages), 'utf8');
}

/**
 * 정식 페이지 파일이 도착한 항목을 인박스에서 지운다(확장이 만든 파일이 미러로 내려온 뒤).
 * 남길 항목 = 아직 pending인 id. 지울 것이 없으면 쓰지 않는다. 지운 수를 돌려준다.
 */
export async function pruneInbox(store: Store): Promise<number> {
  if (!store.inbox) return 0;
  const entries = await readInbox(store.inbox);
  const kept = entries.filter((p) => store.pending.has(p.id));
  if (kept.length === entries.length) return 0;
  await writeInbox(store.inbox, kept);
  return entries.length - kept.length;
}
