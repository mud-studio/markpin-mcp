import { describe, expect, it } from 'vitest';
import { extractDomain, normalizeUrl } from './url';

describe('normalizeUrl', () => {
  it('removes tracking params and keeps others', () => {
    expect(normalizeUrl('https://Example.com/a?utm_source=x&id=3&fbclid=y')).toBe('https://example.com/a?id=3');
  });
  it('drops hash and trailing slash', () => {
    expect(normalizeUrl('https://example.com/docs/#intro')).toBe('https://example.com/docs');
  });
  it('keeps root slash', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
  });
  it('removes empty query', () => {
    expect(normalizeUrl('https://example.com/a?utm_source=x')).toBe('https://example.com/a');
  });
  it('rejects non-http', () => {
    expect(() => normalizeUrl('chrome://extensions')).toThrow('unsupported protocol');
  });
});

describe('extractDomain', () => {
  it('strips www', () => {
    expect(extractDomain('https://www.example.co.kr/x')).toBe('example.co.kr');
  });
});
