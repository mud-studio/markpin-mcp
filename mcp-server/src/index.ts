import { stat } from 'node:fs/promises';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseArgs, USAGE } from './cli';
import { fetchPage } from './extract';
import { pruneInbox } from './inbox';
import { log } from './log';
import { createSerial } from './serial';
import { createServer } from './server';
import { loadDir, type Store } from './store';
import { watchDir } from './watch';

/** 인자가 틀리면 사용법을 쓰고 null. exit 대신 exitCode — stderr가 파이프여도 끝까지 나간다. */
async function resolveArgs() {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 1;
    return null;
  }
  const isDir = await stat(parsed.dir).then((s) => s.isDirectory()).catch(() => false);
  if (!isDir) {
    process.stderr.write(`Not a directory: ${parsed.dir}\n${USAGE}\n`);
    process.exitCode = 1;
    return null;
  }
  return parsed;
}

async function main(): Promise<void> {
  const args = await resolveArgs();
  if (!args) return;
  const { dir, allowWrite, lang } = args;
  let store: Store = await loadDir(dir);
  // 인박스 정리도 쓰기다 — 읽기 전용 서버는 파일을 건드리지 않는다(정리는 항목을 넣는 쓰기 서버 몫).
  if (allowWrite) await pruneInbox(store);
  const serial = createSerial();

  // 재스캔과 쓰기가 같은 큐를 지난다 — 쓰기 도중 스토어가 교체되지 않는다.
  const closeWatch = watchDir(dir, () => {
    void serial(async () => {
      store = await loadDir(dir);
      if (allowWrite) await pruneInbox(store);
      log(`reloaded ${store.pages.size} pages`);
    }).catch((err) => log('reload failed:', err));
  });

  const server = createServer({ store: () => store, allowWrite, lang, fetchPage, serial });
  server.server.onclose = () => closeWatch();

  await server.connect(new StdioServerTransport());
  process.stdin.on('end', () => {
    void server.close();
  });
  log(`serving ${store.pages.size} pages from ${dir}${allowWrite ? ' (write enabled)' : ''}`);
}

// 시작 실패는 스택 대신 한 줄(log는 Error의 message만 쓴다).
main().catch((err) => {
  log('startup failed:', err);
  process.exitCode = 1;
});
