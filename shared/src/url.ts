const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', 'ref_src'
];

export function normalizeUrl(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('unsupported protocol');
  }
  url.hostname = url.hostname.toLowerCase();
  for (const param of TRACKING_PARAMS) url.searchParams.delete(param);
  if ([...url.searchParams.keys()].length === 0) url.search = '';
  url.hash = '';
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

export function extractDomain(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}
