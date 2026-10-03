import { watch } from 'node:fs';
import { log } from './log';

/**
 * 폴더 전체를 재귀 감시하고 이벤트를 디바운스해 onChange를 한 번 부른다.
 * pages/ 대신 루트를 보는 이유: 아직 pages/가 없어도 이후 생성을 잡기 위해.
 */
export function watchDir(dir: string, onChange: () => void, debounceMs = 300): () => void {
  let timer: NodeJS.Timeout | undefined;
  try {
    const watcher = watch(dir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, debounceMs);
    });
    watcher.on('error', (err) => log('watch error:', err));
    return () => {
      clearTimeout(timer);
      watcher.close();
    };
  } catch (err) {
    log('watch unavailable, changes will not be picked up:', err);
    return () => {};
  }
}
