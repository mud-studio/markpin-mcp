import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watchDir } from './watch';

const waitFor = (pred: () => boolean, ms = 3000) =>
  new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const tick = () => (pred() ? resolve() : Date.now() - started > ms ? reject(new Error('timeout')) : setTimeout(tick, 50));
    tick();
  });

describe('watchDir', () => {
  it('calls onChange once (debounced) after files change', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'markpin-mcp-watch-'));
    let calls = 0;
    const close = watchDir(dir, () => calls++, 100);
    try {
      await new Promise((r) => setTimeout(r, 200)); // FSEvents 준비 대기
      calls = 0; // 워밍업 중 들어온 이벤트는 계산에서 제외
      await writeFile(join(dir, 'one.md'), 'a');
      await writeFile(join(dir, 'two.md'), 'b');
      await waitFor(() => calls >= 1);
      await new Promise((r) => setTimeout(r, 300));
      expect(calls).toBe(1);
    } finally {
      close();
    }
  });
  it('returns a no-op closer when the directory cannot be watched', () => {
    const close = watchDir(join(tmpdir(), 'markpin-mcp-does-not-exist'), () => {});
    expect(() => close()).not.toThrow();
  });
});
