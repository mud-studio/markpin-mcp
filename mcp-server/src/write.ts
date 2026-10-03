import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { exceedsFileLimit, pagePath, parsePage, resolveTemplate, serializePage, type Page } from '@markpin/shared';
import { readInbox, writeInbox } from './inbox';
import { applyToStore, type Store } from './store';

/** 디스크의 현재 내용. 파일이 없거나 깨졌으면 null(= 비교할 판본 없음). */
async function readOnDisk(abs: string, template?: string): Promise<Page | null> {
  try {
    return parsePage(await readFile(abs, 'utf8'), template);
  } catch {
    return null;
  }
}

/**
 * 페이지 하나를 폴더에 쓴다(§9.2). rev+1·updatedAt=now.
 * 읽은 뒤 디스크가 더 새로워졌으면(확장·다른 기기의 편집) 거부하고 스토어를 디스크 판본으로 되돌린다.
 * 이미 있는 파일은 제자리에 덮어쓴다 — 두 소비자 모두 깨진 부분 읽기를 건너뛰고,
 * rename 교체와 달리 Drive for Desktop의 fileId가 확실히 보존된다.
 * 새 파일만 `<abs>.tmp-<pid>`에 쓰고 `rename`한다(부분 파일이 `.md`로 보이지 않게).
 * 성공하면 메모리 스토어를 즉시 갱신한다. 호출자는 직렬 큐 안에서 부른다.
 */
export async function writePage(store: Store, page: Page, now: string = new Date().toISOString()): Promise<Page> {
  const next: Page = { ...page, rev: page.rev + 1, updatedAt: now };
  if (exceedsFileLimit(next)) throw new Error('Page exceeds the 512KB file limit');

  // §9.4 인박스에만 있는 페이지: 인박스 항목을 갱신한다. 디스크 판본 비교도 인박스 기준.
  if (store.inbox && store.pending.has(next.id)) {
    const entries = await readInbox(store.inbox);
    const onDisk = entries.find((p) => p.id === next.id);
    if (onDisk && (onDisk.updatedAt > page.updatedAt || onDisk.rev > page.rev)) {
      applyToStore(store, onDisk, store.inbox);
      throw new Error('Page changed on disk since it was read; re-read it and try again');
    }
    await writeInbox(store.inbox, [...entries.filter((p) => p.id !== next.id), next]);
    applyToStore(store, next, store.inbox);
    return next;
  }

  const known = store.paths.get(next.id);
  if (known) {
    const onDisk = await readOnDisk(known, resolveTemplate(store.config.template));
    if (onDisk && (onDisk.updatedAt > page.updatedAt || onDisk.rev > page.rev)) {
      applyToStore(store, onDisk, known);
      throw new Error('Page changed on disk since it was read; re-read it and try again');
    }
    await writeFile(known, serializePage(next, resolveTemplate(store.config.template)), 'utf8');
    applyToStore(store, next, known);
    return next;
  }

  // §9.4 새 페이지 + 인박스 모드: pages/에 파일을 만들지 않는다 — Drive 사용자는 확장이 만들어야 보인다.
  if (store.inbox) {
    const entries = await readInbox(store.inbox);
    await writeInbox(store.inbox, [...entries.filter((p) => p.id !== next.id), next]);
    store.pending.add(next.id);
    applyToStore(store, next, store.inbox);
    return next;
  }

  const abs = join(store.dir, pagePath(next));
  await mkdir(dirname(abs), { recursive: true });
  // `.md`로 끝나지 않으므로 확장·MCP 스캔 모두 임시파일을 무시한다.
  const tmp = `${abs}.tmp-${process.pid}`;
  await writeFile(tmp, serializePage(next, resolveTemplate(store.config.template)), 'utf8');
  await rename(tmp, abs);
  applyToStore(store, next, abs);
  return next;
}
