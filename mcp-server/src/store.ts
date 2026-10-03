import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { buildIndex, CONFIG_PATH, DEFAULT_CONFIG, INBOX_PATH, isPreset, isValidTemplate, normalizeUrl, parseConfig, parsePage, resolveTemplate, type MarkpinConfig, type Page } from '@markpin/shared';
import { readInbox } from './inbox';
import { log } from './log';

export type Store = {
  dir: string;
  /** id → 살아 있는 페이지(tombstone 제외) */
  pages: Map<string, Page>;
  /** id → tombstone(deletedAt 있음). 읽기 tool에는 보이지 않고 restore에만 쓴다. */
  tombstones: Map<string, Page>;
  /** 정규화 URL → id */
  byUrl: Map<string, string>;
  /** id → 파일 절대경로 */
  paths: Map<string, string>;
  index: ReturnType<typeof buildIndex>;
  /** 인박스 파일 절대경로. 없으면 null(= 인박스 모드 아님). §9.4 */
  inbox: string | null;
  /** 인박스에만 있는 페이지 id(정식 파일이 아직 미러에 없음). */
  pending: Set<string>;
  /** 저장소 루트 `markpin.json`(§21.4). 없으면 기본. 쓰기 때 같은 템플릿을 쓴다. */
  config: MarkpinConfig;
};

async function exists(abs: string): Promise<boolean> {
  return stat(abs).then(() => true, () => false);
}

/** 동기화 엔진(§7.5)의 충돌 사본 규칙과 같다. */
const CONFLICT_RE = /\.conflict-[0-9a-f]{8}\.md$/;

async function listPageFiles(pagesDir: string): Promise<string[]> {
  try {
    const rels = await readdir(pagesDir, { recursive: true });
    return rels.filter((r) => r.endsWith('.md') && !CONFLICT_RE.test(r)).sort();
  } catch (err) {
    log('no pages/ directory yet:', err);
    return [];
  }
}

/** 정규화할 수 없는 URL(비 http 등)은 원문 그대로 — byUrl 키와 조회가 같은 규칙을 쓴다. */
export function safeNormalize(url: string): string {
  try {
    return normalizeUrl(url);
  } catch {
    return url;
  }
}

/** 페이지 하나를 스토어에 반영한다(산 것/tombstone 분류, URL 맵, 경로, 색인 재빌드). */
export function applyToStore(store: Store, page: Page, abs: string): void {
  const prev = store.pages.get(page.id) ?? store.tombstones.get(page.id);
  if (prev) store.byUrl.delete(safeNormalize(prev.url));
  store.pages.delete(page.id);
  store.tombstones.delete(page.id);
  if (page.deletedAt) store.tombstones.set(page.id, page);
  else {
    store.pages.set(page.id, page);
    store.byUrl.set(safeNormalize(page.url), page.id);
  }
  store.paths.set(page.id, abs);
  store.index = buildIndex([...store.pages.values()]);
}

export async function loadDir(dir: string): Promise<Store> {
  // 설정(§21.4)을 먼저 읽는다 — 파일을 파싱할 때 같은 템플릿으로 본문 위치를 찾는다
  const configAbs = join(dir, CONFIG_PATH);
  const config = (await exists(configAbs)) ? parseConfig(await readFile(configAbs, 'utf8')) : { ...DEFAULT_CONFIG };
  if (!isPreset(config.template) && !isValidTemplate(config.template)) log('invalid template in markpin.json, using default');
  const template = resolveTemplate(config.template);
  const pagesDir = join(dir, 'pages');
  const seen = new Map<string, { page: Page; abs: string }>();
  for (const rel of await listPageFiles(pagesDir)) {
    const abs = join(pagesDir, rel);
    let page: Page;
    try {
      page = parsePage(await readFile(abs, 'utf8'), template);
    } catch (err) {
      log(`skip ${abs}:`, err);
      continue;
    }
    const existing = seen.get(page.id);
    if (existing && existing.page.updatedAt >= page.updatedAt) continue;
    seen.set(page.id, { page, abs });
  }
  const store: Store = { dir, pages: new Map(), tombstones: new Map(), byUrl: new Map(), paths: new Map(), index: buildIndex([]), inbox: null, pending: new Set(), config };
  for (const { page, abs } of seen.values()) {
    if (page.deletedAt) store.tombstones.set(page.id, page);
    else {
      store.pages.set(page.id, page);
      store.byUrl.set(safeNormalize(page.url), page.id);
    }
    store.paths.set(page.id, abs);
  }
  const inboxAbs = join(dir, INBOX_PATH);
  const entries = await readInbox(inboxAbs); // 없으면 []
  if (await exists(inboxAbs)) {
    store.inbox = inboxAbs;
    for (const page of entries) {
      const real = seen.get(page.id);
      if (real && real.page.updatedAt >= page.updatedAt) continue; // 정식 파일이 같거나 더 새로움 → prune 대상
      store.pending.add(page.id);
      if (real) {
        // 정식 파일 버전이 이미 seen에서 반영됨 — 인박스가 더 새로우니 덮어쓴다
        store.pages.delete(page.id);
        store.tombstones.delete(page.id);
        store.byUrl.delete(safeNormalize(real.page.url));
      }
      if (page.deletedAt) store.tombstones.set(page.id, page);
      else {
        store.pages.set(page.id, page);
        store.byUrl.set(safeNormalize(page.url), page.id);
      }
      store.paths.set(page.id, inboxAbs);
    }
  }
  store.index = buildIndex([...store.pages.values()]);
  return store;
}
