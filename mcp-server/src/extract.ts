import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { Readability } from '@mozilla/readability';
import type { FetchPage } from './tools-write';

const collapse = (s: string) => s.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

/**
 * Readability로 본문·제목을 뽑는다(확장의 캡처와 같은 추출기). 실패하면 <title>·body 텍스트.
 * jsdom은 여기서만 불러온다 — 의존성이 현재 Node에서 로드되지 않아도 서버 시작과 읽기 tool은 살아 있다.
 */
export async function extractFromHtml(html: string, url: string): Promise<{ title: string; content: string }> {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;
  const article = new Readability(doc).parse();
  if (article?.textContent?.trim()) {
    return { title: article.title?.trim() || doc.title.trim() || url, content: collapse(article.textContent) };
  }
  // new Readability(doc).parse() mutates doc, so re-parse html into a fresh JSDOM before reading <title>/body.
  const fallback = new JSDOM(html, { url }).window.document;
  return { title: fallback.title.trim() || url, content: collapse(fallback.body?.textContent ?? '') };
}

const PRIVATE = 'Refusing to fetch a private or local address';
const MAX_BYTES = 5_000_000;
const MAX_REDIRECTS = 5;

/** `::ffff:127.0.0.1`·`::ffff:7f00:1` 같은 IPv4-mapped IPv6를 점 표기 IPv4로. 아니면 null. */
function mappedIpv4(addr: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(addr);
  if (!hex) return null;
  const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** 루프백·링크로컬·사설 대역이면 true(0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, ::1, fc00::/7, fe80::/10). */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.trim().toLowerCase().split('%')[0];
  const v4 = isIP(addr) === 4 ? addr : mappedIpv4(addr);
  if (v4) {
    const [a, b] = v4.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (isIP(addr) !== 6) return false;
  return addr === '::' || addr === '::1' || /^f[cd]/.test(addr) || /^fe[89ab]/.test(addr);
}

/**
 * SSRF 차단(§9.2): 에이전트가 준 URL을 사용자 컴퓨터에서 받아오므로 사설·루프백은 거부한다.
 * 호스트 이름 자체와 DNS가 돌려준 주소 전부를 검사한다(DNS rebinding 완화).
 */
export async function assertPublicHttpUrl(url: string): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Refusing to fetch a non-http URL');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || isPrivateAddress(host)) throw new Error(PRIVATE);
  let addrs: Array<{ address: string }>;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new Error('Cannot resolve host');
  }
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error(PRIVATE);
}

export const fetchPage: FetchPage = async (url) => {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHttpUrl(current);
    const res = await fetch(current, { headers: { accept: 'text/html' }, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      // 다음 홉으로 가기 전에 소켓을 돌려준다. 이미 닫힌 본문이면 무시.
      try {
        await res.body?.cancel();
      } catch {
        // ignore
      }
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('Page too large');
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_BYTES) throw new Error('Page too large');
    const html = new TextDecoder().decode(body);
    // content-type이 틀린 서버가 있다(간헐적으로 text/plain 등). 본문 첫머리로 한 번 더 판정한다.
    const typed = (res.headers.get('content-type') ?? '').includes('html');
    if (!typed && !/^\s*(?:<!doctype\s+html|<html)/i.test(html.slice(0, 1024))) throw new Error('Not an HTML page');
    return extractFromHtml(html, current);
  }
  throw new Error('Too many redirects');
};
