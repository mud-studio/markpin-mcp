import { describe, expect, it } from 'vitest';
import { createSerial } from './serial';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('createSerial', () => {
  it('runs tasks one at a time in call order', async () => {
    const serial = createSerial();
    const order: string[] = [];
    const a = serial(async () => { await sleep(30); order.push('a'); return 'A'; });
    const b = serial(async () => { order.push('b'); return 'B'; });
    expect(await Promise.all([a, b])).toEqual(['A', 'B']);
    expect(order).toEqual(['a', 'b']);
  });
  it('keeps going after a failed task', async () => {
    const serial = createSerial();
    await expect(serial(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await serial(async () => 'ok')).toBe('ok');
  });
});
