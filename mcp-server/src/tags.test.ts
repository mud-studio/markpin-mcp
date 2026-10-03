import { describe, expect, it } from 'vitest';
import { normalizeTag, normalizeTags } from './tags';

describe('normalizeTag', () => {
  it('trims, strips a leading # and joins spaces with -', () => {
    expect(normalizeTag('  #web dev ')).toBe('web-dev');
    expect(normalizeTag('REACT')).toBe('REACT');
  });
});

describe('normalizeTags', () => {
  it('trims, strips a leading #, joins spaces with -, drops empties and >24 chars', () => {
    expect(normalizeTags(['  #web dev ', '', 'x'.repeat(25), 'ok'], [])).toEqual(['web-dev', 'ok']);
  });
  it('dedupes case-insensitively and prefers the existing spelling', () => {
    expect(normalizeTags(['REACT', 'react', 'Vue'], ['React'])).toEqual(['React', 'Vue']);
  });
});
