import { describe, expect, it } from 'vitest';
import { assetPath, pagePath, slugify } from './slug';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Hello, World! 2026')).toBe('hello-world-2026');
  });
  it('keeps korean', () => {
    expect(slugify('리액트 상태 관리 (정리)')).toBe('리액트-상태-관리-정리');
  });
  it('caps at 60 chars without trailing hyphen', () => {
    const s = slugify('a'.repeat(59) + ' b');
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith('-')).toBe(false);
  });
  it('falls back to untitled', () => {
    expect(slugify('!!!')).toBe('untitled');
  });
});

describe('pagePath', () => {
  it('builds year/slug-id8 path', () => {
    expect(
      pagePath({ id: '5f1c2a3b-1111-2222-3333-444444444444', title: 'Hello World', savedAt: '2026-09-16T10:00:00.000Z' })
    ).toBe('pages/2026/hello-world-5f1c2a3b.md');
  });
});

describe('assetPath', () => {
  it('puts webp under assets/', () => {
    expect(assetPath('5f1c2a3b-1111-2222-3333-444444444444')).toBe('assets/5f1c2a3b-1111-2222-3333-444444444444.webp');
  });
});
