import { describe, expect, it } from 'vitest';
import type { Page } from './types';
import { vi } from 'vitest';
import { buildIndex, createIndex, snippetFor, syncIndex, toDoc } from './search';

const mk = (id: string, over: Partial<Page>): Page => ({
  id, url: `https://e.com/${id}`, title: id, domain: 'e.com',
  savedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  rev: 1, tags: [], clips: [], ...over
});

describe('toDoc / buildIndex', () => {
  const pages = [
    mk('a', { title: 'React 상태 관리', tags: ['react'], contentText: 'zustand 와 immer' }),
    mk('bb', { title: 'Postgres 인덱스', tags: ['db'], clips: [{ id: 'c', type: 'text', createdAt: '', updatedAt: '', text: 'B-tree 설명', note: '복습', selectors: [] }] }),
    mk('ccc', { title: '요리법', tags: ['life', 'react'], note: '주말 되새김' })
  ];
  const index = buildIndex(pages);
  const ids = (q: string) => index.search(q).map((r) => r.id as string);

  it('flattens clips and tags into searchable fields', () => {
    expect(toDoc(pages[1])).toEqual({ id: 'bb', title: 'Postgres 인덱스', contentText: '', clipsText: 'B-tree 설명\n복습', tagsText: 'db', noteText: '' });
  });
  it('matches title, content, clip text and note', () => {
    expect(ids('zustand')).toEqual(['a']);
    expect(ids('B-tree')).toEqual(['bb']);
    expect(ids('복습')).toEqual(['bb']);
  });
  it('matches the reader note (§21.5)', () => {
    expect(ids('되새김')).toEqual(['ccc']);
  });
  it('matches korean prefix', () => {
    expect(ids('상태')).toEqual(['a']);
  });
  it('ranks a title hit above a tag hit', () => {
    expect(ids('react')).toEqual(['a', 'ccc']);
  });
  it('returns the full index term for a prefix query', () => {
    expect(index.search('zust')[0].terms).toEqual(['zustand']);
  });
});

describe('snippetFor', () => {
  const long = mk('d', {
    title: '긴 글',
    contentText: `${'가'.repeat(100)} TypeScript 지원 강화 ${'나'.repeat(100)}`,
    clips: [{ id: 'c', type: 'text', createdAt: '', updatedAt: '', text: '클립 문장', note: '메모', selectors: [] }]
  });

  it('returns null without terms', () => {
    expect(snippetFor(long, [])).toBeNull();
  });
  it('cuts 60 chars of context around the first hit in the content, with ellipses', () => {
    expect(snippetFor(long, ['typescript'])).toEqual({
      source: 'content',
      before: `…${'가'.repeat(59)} `,
      hit: 'TypeScript',
      after: ` 지원 강화 ${'나'.repeat(53)}…`
    });
  });
  it('prefers clip text and note over content', () => {
    const hit = snippetFor(long, ['메모']);
    expect(hit?.source).toBe('clip');
    expect(hit?.hit).toBe('메모');
    expect(hit?.before).toBe('클립 문장 ');
  });
  it('prefers the clip even when the content also matches', () => {
    const p = mk('g', { contentText: '본문에도 공통 단어', clips: [{ id: 'c', type: 'text', createdAt: '', updatedAt: '', text: '클립에 공통 단어', note: '', selectors: [] }] });
    expect(snippetFor(p, ['공통'])?.source).toBe('clip');
  });
  it('anchors punctuation-split terms at a token boundary (B-tree → b + tree)', () => {
    const p = mk('h', { contentText: 'abstract 개념 정리부터 시작한다. 이후 인덱스 구조로 B-tree 를 설명한다.' });
    const hit = snippetFor(p, ['b', 'tree']);
    expect(hit?.hit).toBe('B');
    expect(hit?.before.endsWith('구조로 ')).toBe(true);
    expect(hit?.after.startsWith('-tree 를')).toBe(true);
  });
  it('returns null when the term only matches the title', () => {
    expect(snippetFor(long, ['긴'])).toBeNull();
  });
  it('picks the earliest of several terms and collapses whitespace', () => {
    const p = mk('e', { contentText: 'alpha\n\n  beta   gamma delta' });
    expect(snippetFor(p, ['gamma', 'beta'])).toEqual({ source: 'content', before: 'alpha ', hit: 'beta', after: ' gamma delta' });
  });
  it('has no ellipsis when the text is short', () => {
    const p = mk('f', { contentText: 'short text here' });
    expect(snippetFor(p, ['text'])).toEqual({ source: 'content', before: 'short ', hit: 'text', after: ' here' });
  });
});

describe('syncIndex (사이드패널 규모 3)', () => {
  const base = [
    mk('p1', { title: '사과 이야기', contentText: '빨간 사과' }),
    mk('p2', { title: '바나나', contentText: '노란 바나나 사과' }),
    mk('p3', { title: '체리', tags: ['과일'] }),
    mk('p4', { title: '포도', contentText: '사과 아님' }),
    mk('p5', { title: '수박', note: '여름 과일' })
  ];
  const ids = (index: ReturnType<typeof buildIndex>, q: string) => index.search(q).map((r) => r.id as string);

  it('matches a full rebuild after edits, deletes, adds and tombstones', () => {
    const index = createIndex();
    const sigs = new Map<string, string>();
    syncIndex(index, sigs, base);
    const next = [
      { ...base[0], title: '배 이야기', rev: 2, updatedAt: '2026-01-02T00:00:00.000Z' }, // 제목 수정
      base[1],
      // p3 삭제(목록에서 빠짐 — tombstone도 listPages에 안 나온다)
      { ...base[3], contentText: '과일 사과', rev: 2, updatedAt: '2026-01-02T00:00:00.000Z' },
      base[4],
      mk('p6', { title: '사과 파이', tags: ['과일'] }) // 새 페이지
    ];
    syncIndex(index, sigs, next);
    const full = buildIndex(next);
    for (const q of ['사과', '배', '과일', '체리']) expect(ids(index, q)).toEqual(ids(full, q));
    expect([...sigs.keys()].sort()).toEqual(['p1', 'p2', 'p4', 'p5', 'p6']);
  });

  it('does not re-add unchanged pages', () => {
    const index = createIndex();
    const sigs = new Map<string, string>();
    syncIndex(index, sigs, base);
    const add = vi.spyOn(index, 'add');
    const replace = vi.spyOn(index, 'replace');
    syncIndex(index, sigs, [...base]);
    expect(add).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
