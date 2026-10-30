import { describe, expect, it } from 'vitest';
import { BASIC_PEN_SET, CLIP_PENS, DEFAULT_CLIP_PEN, clipPenOf } from './types';

// 펜(2026-10-30 설계 §3): 없으면 형광, 모르는 값(미래 팩)은 보존하되 형광으로 그린다.
describe('clipPenOf', () => {
  it('defaults to highlight and keeps known pens', () => {
    expect(DEFAULT_CLIP_PEN).toBe('highlight');
    expect(clipPenOf({})).toBe('highlight');
    expect(clipPenOf({ pen: 'box' })).toBe('box');
    expect(clipPenOf({ pen: 'strike' })).toBe('strike');
  });
  it('renders an unknown pack pen as highlight', () => {
    expect(clipPenOf({ pen: 'pack:tape-dots' })).toBe('highlight');
  });
  it('the basic set holds the eight free pens in toolbar order (lasso added 2026-10-30)', () => {
    expect(CLIP_PENS).toEqual(['highlight', 'underline', 'wavy', 'double', 'strike', 'box', 'circle', 'lasso']);
    expect(clipPenOf({ pen: 'lasso' })).toBe('lasso');
    expect(BASIC_PEN_SET).toEqual({ id: 'basic', pens: CLIP_PENS });
  });
});
