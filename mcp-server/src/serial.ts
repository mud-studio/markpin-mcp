/** 호출 순서대로 하나씩 실행하는 큐. 쓰기와 재스캔이 같은 큐를 지나 같은 파일을 동시에 만지지 않게 한다. */
export function createSerial(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}
