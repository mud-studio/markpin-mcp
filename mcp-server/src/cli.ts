import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** 확인 다이얼로그 언어(§16.3). extension/src/mcp/commands.ts MCP_LANGS와 같은 목록. */
export const LANGS = ['ko', 'en', 'ja', 'es', 'pt-BR', 'de', 'fr'] as const;
export type Lang = (typeof LANGS)[number];

export const USAGE = `Usage: markpin-mcp --dir <path to your Markpin folder> [--allow-write] [--lang ${LANGS.join('|')}]`;

function valueAfter(argv: string[], flag: string): string | undefined {
  // `--flag=value`: MCP Registry 클라이언트가 named argument를 이 꼴로 넘길 수 있다.
  const joined = argv.find((a) => a.startsWith(`${flag}=`));
  if (joined !== undefined) {
    const raw = joined.slice(flag.length + 1);
    if (!raw) throw new Error(USAGE);
    return raw;
  }
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const raw = argv[i + 1];
  if (!raw || raw.startsWith('--')) throw new Error(USAGE);
  return raw;
}

/** 프로세스 로케일 → 기본 언어. 언어 부분만 보고, pt*는 pt-BR, 그 외는 en. */
export function langFromLocale(locale: string): Lang {
  const base = locale.toLowerCase().split(/[-_]/)[0];
  if (base === 'pt') return 'pt-BR';
  return LANGS.find((l) => l === base) ?? 'en';
}

export function parseArgs(argv: string[], env: { locale?: string } = {}): { dir: string; allowWrite: boolean; lang: Lang } {
  const raw = valueAfter(argv, '--dir');
  if (!raw) throw new Error(USAGE);
  const expanded = raw === '~' ? homedir() : raw.startsWith('~/') ? homedir() + raw.slice(1) : raw;
  const langArg = valueAfter(argv, '--lang');
  const locale = env.locale ?? Intl.DateTimeFormat().resolvedOptions().locale;
  const lang = langArg === undefined ? langFromLocale(locale) : LANGS.find((l) => l.toLowerCase() === langArg.toLowerCase());
  if (!lang) throw new Error(USAGE);
  return { dir: resolve(expanded), allowWrite: argv.includes('--allow-write'), lang };
}
