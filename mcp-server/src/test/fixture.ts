import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CONFIG_PATH, pagePath, serializeConfig, serializePage, type MarkpinConfig, type Page } from '@markpin/shared';

const T = (day: number) => `2026-01-0${day}T00:00:00.000Z`;

export function mk(id: string, over: Partial<Page>): Page {
  return {
    id, url: `https://e.com/${id}`, title: id, domain: 'e.com',
    savedAt: T(1), updatedAt: T(1), rev: 1, tags: [], clips: [], ...over
  };
}

async function write(dir: string, rel: string, body: string): Promise<void> {
  const abs = join(dir, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, body, 'utf8');
}

/**
 * 살아 있는 페이지 a·b·c, tombstone d, conflict 사본, 깨진 파일을 담은 임시 Markpin 폴더.
 * updatedAt: a(3일) > b(2일) > c(1일). 책갈피: c(2일, 위치 있음) > a(1일). b는 읽음.
 */
export async function makeFixture(config?: MarkpinConfig): Promise<{ dir: string; pages: { a: Page; b: Page; c: Page } }> {
  const dir = await mkdtemp(join(tmpdir(), 'markpin-mcp-'));
  const a = mk('a1a1a1a1-0000-4000-8000-000000000001', {
    url: 'https://e.com/react', title: 'React 상태 관리', tags: ['react', 'frontend'],
    contentText: 'zustand 와 immer 비교', summary: '상태 라이브러리 비교', updatedAt: T(3),
    bookmark: { createdAt: T(1) }
  });
  const b = mk('b2b2b2b2-0000-4000-8000-000000000002', {
    url: 'https://e.com/postgres', title: 'Postgres 인덱스', tags: ['db'], updatedAt: T(2), readAt: T(2),
    clips: [{
      id: 'c1', type: 'region', createdAt: T(1), updatedAt: T(1), text: 'B-tree 설명', note: '복습', selectors: [],
      image: { path: 'assets/c1.webp', width: 10, height: 10 }
    }]
  });
  const c = mk('c3c3c3c3-0000-4000-8000-000000000003', {
    url: 'https://e.com/cook', title: '요리법', tags: ['life', 'react'],
    bookmark: { createdAt: T(2), quote: '재료 준비', selectors: [{ type: 'TextQuoteSelector', exact: '재료 준비' }] }
  });
  const d = mk('d4d4d4d4-0000-4000-8000-000000000004', { url: 'https://e.com/gone', title: 'Deleted', deletedAt: T(4), updatedAt: T(4) });
  const e = mk('e5e5e5e5-0000-4000-8000-000000000005', { url: 'https://e.com/conflict', title: 'Conflict copy' });

  for (const p of [a, b, c, d]) await write(dir, pagePath(p), serializePage(p));
  await write(dir, 'pages/2026/conflict-copy.conflict-abcdef12.md', serializePage(e));
  await write(dir, 'pages/2026/broken.md', 'not a markpin file');
  await write(dir, 'assets/c1.webp', '');
  if (config) await write(dir, CONFIG_PATH, serializeConfig(config));
  return { dir, pages: { a, b, c } };
}

/** 2026-10-01 이전(v1) 파일 그대로 — shared `markdown.test.ts`의 `V1_FIXTURE`와 동일한 리터럴. v1 읽기 회귀 방지용, 재생성하지 않는다. */
export const V1_PAGE_FILE = `---
markpin: 1
id: 5f1c2a3b-1111-2222-3333-444444444444
url: https://example.com/article
title: 예시 글 제목
domain: example.com
savedAt: 2026-09-16T10:00:00.000Z
updatedAt: 2026-09-16T10:05:00.000Z
rev: 3
tags:
  - react
  - state
clips:
  - id: c1
    type: text
    createdAt: 2026-09-16T10:01:00.000Z
    updatedAt: 2026-09-16T10:01:00.000Z
    text: 인용된 문장
    note: 내 메모
    selectors:
      - type: TextQuoteSelector
        exact: 인용된 문장
        prefix: 앞
        suffix: 뒤
      - type: CssSelector
        value: article > p:nth-of-type(3)
---

## Clips

> 인용된 문장

내 메모

## Content

본문 첫 문단.

본문 둘째 문단.
`;
