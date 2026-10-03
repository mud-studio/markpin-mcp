import type { Page } from './types';

export function slugify(title: string, max = 60): string {
  const slug = title
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'untitled';
}

export function pagePath(page: Pick<Page, 'id' | 'title' | 'savedAt'>): string {
  const year = page.savedAt.slice(0, 4);
  return `pages/${year}/${slugify(page.title)}-${page.id.slice(0, 8)}.md`;
}

/** 클립 이미지의 저장소 경로. 페이지 파일(`pages/{YYYY}/`)에서는 `../../` 를 붙여 참조한다. */
export function assetPath(clipId: string): string {
  return `assets/${clipId}.webp`;
}
