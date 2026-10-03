import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertPublicHttpUrl, extractFromHtml, fetchPage, isPrivateAddress } from './extract';

const HTML = `<!doctype html><html><head><title>Sample Title</title></head><body>
<nav>Home About</nav>
<article><h1>Sample Title</h1>
<p>First paragraph of the article body, long enough for Readability to keep it around as content.</p>
<p>Second paragraph with more words so the scorer treats this as the main article text of the page.</p>
</article><footer>© nobody</footer></body></html>`;

describe('extractFromHtml', () => {
  it('returns the title and the article text without nav/footer', async () => {
    const r = await extractFromHtml(HTML, 'https://e.com/a');
    expect(r.title).toBe('Sample Title');
    expect(r.content).toContain('First paragraph');
    expect(r.content).toContain('Second paragraph');
    expect(r.content).not.toContain('Home About');
    expect(r.content).not.toMatch(/\n\s*\n/);
  });
  it('falls back to <title> and body text when there is no article', async () => {
    const r = await extractFromHtml('<html><head><title>T</title></head><body><p>hi</p></body></html>', 'https://e.com/b');
    expect(r.title).toBe('T');
    expect(r.content).toBe('hi');
  });
});

describe('isPrivateAddress', () => {
  it('flags loopback, link-local and private ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.31.0.1', '192.168.0.1', '169.254.1.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it('lets public addresses through', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111', '172.32.0.1', '11.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe('assertPublicHttpUrl', () => {
  // 호스트 이름만으로 판정되는 경우들 — DNS를 타지 않으므로 네트워크 없이 돈다.
  it('refuses localhost, private literals and non-http schemes', async () => {
    for (const url of ['http://localhost/a', 'http://app.localhost/a', 'http://127.0.0.1/a', 'http://0.0.0.0/a', 'http://[::1]/a', 'http://192.168.0.5/a', 'http://[fd00::1]/a']) {
      await expect(assertPublicHttpUrl(url), url).rejects.toThrow(/private or local address/);
    }
    await expect(assertPublicHttpUrl('file:///etc/passwd')).rejects.toThrow(/non-http/);
  });
  it('accepts a public ip literal without resolving a name', async () => {
    await expect(assertPublicHttpUrl('https://8.8.8.8/a')).resolves.toBeUndefined();
  });
});

describe('fetchPage content-type', () => {
  const respond = (type: string | null, body: string) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200, headers: type ? { 'content-type': type } : {} })));
  afterEach(() => vi.unstubAllGlobals());

  it('accepts a page whose body is HTML even when the content-type says otherwise', async () => {
    respond('text/plain', HTML);
    const page = await fetchPage('http://93.184.216.34/');
    expect(page.title).toBe('Sample Title');
  });
  it('still refuses a body that is not HTML', async () => {
    respond('application/json', '{"a":1}');
    await expect(fetchPage('http://93.184.216.34/')).rejects.toThrow('Not an HTML page');
  });
});
