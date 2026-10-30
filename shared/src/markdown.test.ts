import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, clipsMarkdown, exceedsFileLimit, fitContentToFile, parsePage, serializePage, templateData } from './markdown';
import { TEMPLATE_DEFAULT, TEMPLATE_OBSIDIAN } from './presets';
import { clipColorOf, clipKindOf, normalizeNote, type Clip, type Page } from './types';

const base: Page = {
  id: '5f1c2a3b-1111-2222-3333-444444444444',
  url: 'https://example.com/article',
  title: '예시 글 제목',
  domain: 'example.com',
  savedAt: '2026-09-16T10:00:00.000Z',
  updatedAt: '2026-09-16T10:05:00.000Z',
  rev: 3,
  tags: ['react', 'state'],
  contentText: '본문 첫 문단.\n\n본문 둘째 문단.',
  clips: [
    {
      id: 'c1',
      type: 'text',
      createdAt: '2026-09-16T10:01:00.000Z',
      updatedAt: '2026-09-16T10:01:00.000Z',
      text: '인용된 문장',
      note: '내 메모',
      selectors: [
        { type: 'TextQuoteSelector', exact: '인용된 문장', prefix: '앞', suffix: '뒤' },
        { type: 'CssSelector', value: 'article > p:nth-of-type(3)' }
      ]
    }
  ]
};

const region: Clip = {
  id: 'r1',
  type: 'region',
  createdAt: '2026-09-20T10:01:00.000Z',
  updatedAt: '2026-09-20T10:01:00.000Z',
  text: '차트 제목\n범례',
  html: '## 차트 제목\n\n- 범례',
  note: '',
  selectors: [
    { type: 'CssSelector', value: 'html > body > figure' },
    { type: 'XPathSelector', value: '/html/body/figure' }
  ],
  image: { path: 'assets/r1.webp', width: 800, height: 600 }
};


/** frontmatter 뒤, 파일 끝 블록 앞의 템플릿 본문 */
const bodyOf = (md: string) => md.slice(md.indexOf('---\n\n') + '---\n\n'.length, md.lastIndexOf('\n<!-- markpin\n') + 1);
const fmKeys = (md: string) => md.split('---')[1].split('\n').filter((l) => /^[a-zA-Z]+:/.test(l)).map((l) => l.split(':')[0]);
const blockOf = (md: string) => JSON.parse(md.slice(md.indexOf('<!-- markpin\n') + '<!-- markpin\n'.length, md.indexOf('\n-->\n'))) as Record<string, unknown>;

// 2026-10-01 이전(v1) serializePage(base) 출력 그대로. v1 읽기 회귀 방지용 — 절대 재생성하지 않는다.
const V1_FIXTURE = `---
markpin: 1
id: 5f1c2a3b-1111-2222-3333-444444444444
url: https://example.com/article
title: 예시 글 제목
domain: example.com
savedAt: 2026-09-16T10:00:00.000Z
updatedAt: 2026-09-16T10:05:00.000Z
rev: 3
tags:
  - react
  - state
clips:
  - id: c1
    type: text
    createdAt: 2026-09-16T10:01:00.000Z
    updatedAt: 2026-09-16T10:01:00.000Z
    text: 인용된 문장
    note: 내 메모
    selectors:
      - type: TextQuoteSelector
        exact: 인용된 문장
        prefix: 앞
        suffix: 뒤
      - type: CssSelector
        value: article > p:nth-of-type(3)
---

## Clips

> 인용된 문장

내 메모

## Content

본문 첫 문단.

본문 둘째 문단.
`;

describe('serializePage', () => {
  it('writes human keys in the frontmatter and machine data in a markpin block at the end of the file (§22)', () => {
    const md = serializePage({ ...base, summary: '요약' });
    expect(md.startsWith('---\ntitle: 예시 글 제목\nurl: https://example.com/article\nsavedAt: 2026-09-16T10:00:00.000Z\ntags:\n  - react\n  - state\nsummary: 요약\n---\n\n## Clips\n\n> 인용된 문장\n\n내 메모\n\n## Content\n\n본문 첫 문단.\n\n본문 둘째 문단.\n<!-- markpin\n{"v":2,"id":"5f1c2a3b-1111-2222-3333-444444444444","rev":3,"updatedAt":"2026-09-16T10:05:00.000Z","domain":"example.com","clips":[')).toBe(true);
    expect(md.endsWith('}]}\n-->\n')).toBe(true);
    expect(fmKeys(md)).toEqual(['title', 'url', 'savedAt', 'tags', 'summary']);
    expect(Object.keys(blockOf(md))).toEqual(['v', 'id', 'rev', 'updatedAt', 'domain', 'clips']);
  });

  it('keeps frontmatter key order with readAt and deletedAt, and puts bookmark/contentTruncated in the block', () => {
    const md = serializePage({ ...base, summary: '요약', readAt: '2026-09-30T02:00:00.000Z', deletedAt: '2026-10-01T00:00:00.000Z', bookmark: { createdAt: '2026-09-30T01:00:00.000Z' }, contentTruncated: true });
    expect(fmKeys(md)).toEqual(['title', 'url', 'savedAt', 'tags', 'summary', 'readAt', 'deletedAt']);
    expect(Object.keys(blockOf(md))).toEqual(['v', 'id', 'rev', 'updatedAt', 'domain', 'clips', 'bookmark', 'contentTruncated']);
  });

  it('writes the reader note after summary and omits an empty one (§21.5)', () => {
    const md = serializePage({ ...base, summary: '요약', note: '내 한 줄', readAt: '2026-09-30T02:00:00.000Z' });
    expect(fmKeys(md)).toEqual(['title', 'url', 'savedAt', 'tags', 'summary', 'note', 'readAt']);
    expect(md).toContain('\nsummary: 요약\nnote: 내 한 줄\nreadAt: ');
    expect(fmKeys(serializePage({ ...base, note: '' }))).toEqual(['title', 'url', 'savedAt', 'tags']);
  });

  it('truncates content over MAX_FILE_BYTES and flags it', () => {
    const big = { ...base, contentText: '가'.repeat(300_000) };
    const md = serializePage(big);
    expect(new TextEncoder().encode(md).length).toBeLessThanOrEqual(MAX_FILE_BYTES);
    expect(parsePage(md).contentTruncated).toBe(true);
  });

  it('exceedsFileLimit is true when clips alone pass the cap', () => {
    const clip = { ...base.clips[0], text: '가'.repeat(10_000) }; // 30KB, 파일에는 frontmatter+Clips로 2번 실림
    const clips = Array.from({ length: 9 }, (_, i) => ({ ...clip, id: `c${i}` }));
    expect(exceedsFileLimit({ ...base, clips })).toBe(true);
    expect(exceedsFileLimit({ ...base, clips: clips.slice(0, 8) })).toBe(false);
    expect(exceedsFileLimit(base)).toBe(false);
  });

  it('renders region clips as an image link plus the markdown quoted', () => {
    const md = serializePage({ ...base, clips: [region] });
    expect(md).toContain('\n## Clips\n\n![](../../assets/r1.webp)\n\n> ## 차트 제목\n> \n> - 범례\n\n## Content\n');
  });

  it('renders a region clip without image or html from its text', () => {
    const md = serializePage({ ...base, clips: [{ ...region, html: undefined, image: undefined, note: '메모' }] });
    expect(md).toContain('\n## Clips\n\n> 차트 제목\n> 범례\n\n메모\n\n## Content\n');
  });
});

describe('parsePage', () => {
  it('round-trips', () => {
    expect(parsePage(serializePage(base))).toEqual(base);
  });

  it('round-trips optional fields', () => {
    const p: Page = { ...base, summary: '요약', deletedAt: '2026-09-17T00:00:00.000Z', clips: [] };
    delete p.contentText;
    expect(parsePage(serializePage(p))).toEqual(p);
  });

  it('is stable on re-serialize', () => {
    const md = serializePage(base);
    expect(serializePage(parsePage(md))).toBe(md);
  });

  it('rejects missing frontmatter', () => {
    expect(() => parsePage('# nope')).toThrow('missing frontmatter');
  });

  it('reads a v1 file (frontmatter machine keys) into the same Page', () => {
    expect(parsePage(V1_FIXTURE)).toEqual(base);
    expect(serializePage(parsePage(V1_FIXTURE))).toBe(serializePage(base)); // 다시 쓰면 v2
  });

  it('rejects a v1 frontmatter with another version and a block with another version', () => {
    expect(() => parsePage('---\nmarkpin: 3\nid: x\n---\n')).toThrow('unsupported format version');
    expect(() => parsePage(serializePage(base).replace('{"v":2,', '{"v":3,'))).toThrow('unsupported format version');
  });

  it('rejects a file without the markpin block or with a broken one', () => {
    expect(() => parsePage('---\ntitle: 노트\n---\n\n본문\n')).toThrow('missing markpin block');
    expect(() => parsePage(serializePage(base).replace('"rev":3,', '"rev":3,,'))).toThrow('invalid markpin block');
    expect(() => parsePage(serializePage(base).replace('"domain":"example.com",', ''))).toThrow('missing field: domain');
  });

  it('tolerates text typed above the body or after the block (Obsidian Live Preview)', () => {
    const md = serializePage(base);
    expect(parsePage(md.replace('---\n\n## Clips', '---\n메모 한 줄\n\n## Clips'))).toEqual(base);
    expect(parsePage(md + '\n끝에 적은 글\n')).toEqual(base);
  });

  it('takes the last markpin block so content mentioning the marker is not mistaken for it', () => {
    const p: Page = { ...base, contentText: '본문\n<!-- markpin\n{"v":2}\n-->\n끝' };
    expect(parsePage(serializePage(p))).toEqual(p);
  });

  it('does not send a v2 file down the v1 path because of a user property named markpin', () => {
    const md = serializePage(base).replace('\n---\n\n## Clips', '\nmarkpin: note\n---\n\n## Clips');
    expect(parsePage(md).extra).toEqual({ markpin: 'note' });
  });

  it('round-trips clip text and notes containing the comment terminator', () => {
    const p: Page = { ...base, clips: [{ ...base.clips[0], text: 'a --> b', note: '--> 끝' }] };
    const md = serializePage(p);
    expect(md.slice(md.lastIndexOf('<!-- markpin'), md.lastIndexOf('\n-->\n'))).not.toContain('-->'); // 블록 안엔 없음
    expect(parsePage(md)).toEqual(p);
  });

  it('is not confused by a clip note containing the content heading', () => {
    const p: Page = {
      ...base,
      clips: [{ ...base.clips[0], note: '메모\n## Content\n가짜' }]
    };
    expect(parsePage(serializePage(p))).toEqual(p);
  });

  it('accepts CRLF line endings', () => {
    const md = serializePage(base).replace(/\n/g, '\r\n');
    expect(parsePage(md)).toEqual(base);
  });

  it('round-trips region clips (multi-line html, image)', () => {
    const p: Page = { ...base, clips: [base.clips[0], region] };
    expect(parsePage(serializePage(p))).toEqual(p);
    expect(serializePage(parsePage(serializePage(p)))).toBe(serializePage(p));
  });

  it('round-trips a clip color and preserves an unknown one (§21.3)', () => {
    const p: Page = { ...base, clips: [{ ...base.clips[0], color: 'green' }, { ...region, color: 'violet' as never }] };
    expect(parsePage(serializePage(p))).toEqual(p);
    expect(serializePage(parsePage(serializePage(p)))).toBe(serializePage(p));
  });

  it('writes skimmedAt after readAt and before deletedAt, and reads it from v1 and v2 (§21.2 보강)', () => {
    const md = serializePage({ ...base, note: '한 줄', readAt: '2026-09-30T02:00:00.000Z', skimmedAt: '2026-10-01T00:00:00.000Z', deletedAt: '2026-10-02T00:00:00.000Z' });
    expect(fmKeys(md)).toEqual(['title', 'url', 'savedAt', 'tags', 'note', 'readAt', 'skimmedAt', 'deletedAt']);
    const p: Page = { ...base, skimmedAt: '2026-10-01T00:00:00.000Z' };
    expect(parsePage(serializePage(p))).toEqual(p);
    const v1 = parsePage(V1_FIXTURE.replace('\nclips:', '\nskimmedAt: 2026-10-01T00:00:00.000Z\nclips:'));
    expect(v1.skimmedAt).toBe('2026-10-01T00:00:00.000Z');
    expect(v1.extra).toBeUndefined();
  });

  it('round-trips a clip kind and preserves an unknown one (§21.5)', () => {
    const p: Page = { ...base, clips: [{ ...base.clips[0], kind: 'disagree' }, { ...region, kind: 'wave' as never }] };
    expect(parsePage(serializePage(p))).toEqual(p);
    expect(serializePage(parsePage(serializePage(p)))).toBe(serializePage(p));
    expect(clipKindOf(parsePage(serializePage(p)).clips[1])).toBeUndefined();
  });

  it('round-trips a frame clip (1.2.2 B9)', () => {
    const p: Page = { ...base, clips: [{ ...base.clips[0], frame: true }, region] };
    expect(parsePage(serializePage(p))).toEqual(p);
    expect(parsePage(serializePage(p)).clips[0].frame).toBe(true);
    expect(parsePage(serializePage(p)).clips[1].frame).toBeUndefined();
  });

  it('reads the reader note from v2 and v1 files, with yaml-special characters (§21.5)', () => {
    const p: Page = { ...base, note: 'a: b "c" #d\n둘째 줄' };
    expect(parsePage(serializePage(p))).toEqual(p);
    const v1 = parsePage(V1_FIXTURE.replace('\nclips:', '\nnote: 한 줄\nclips:'));
    expect(v1.note).toBe('한 줄');
    expect(v1.extra).toBeUndefined();
  });

  it('round-trips readAt and a bookmark with or without a position (§21.2)', () => {
    const later: Page = { ...base, bookmark: { createdAt: '2026-09-30T01:00:00.000Z' } };
    expect(parsePage(serializePage(later))).toEqual(later);
    const reading: Page = {
      ...base,
      bookmark: {
        createdAt: '2026-09-30T01:00:00.000Z',
        quote: '여기까지 읽음',
        selectors: [{ type: 'TextQuoteSelector', exact: '여기까지 읽음', prefix: '앞', suffix: '뒤' }]
      }
    };
    expect(parsePage(serializePage(reading))).toEqual(reading);
    const done: Page = { ...base, readAt: '2026-09-30T02:00:00.000Z' };
    expect(parsePage(serializePage(done))).toEqual(done);
  });
});

describe('forward compatibility', () => {
  it('keeps unknown frontmatter keys in extra and writes them back after the known keys', () => {
    const md = serializePage(base).replace('\n---\n\n## Clips', '\nrating: 5\nnested:\n  a: 1\n  b: [x, y]\n---\n\n## Clips');
    const p = parsePage(md);
    expect(p.extra).toEqual({ rating: 5, nested: { a: 1, b: ['x', 'y'] } });
    const out = serializePage(p);
    expect(fmKeys(out)).toEqual(['title', 'url', 'savedAt', 'tags', 'rating', 'nested']);
    expect(parsePage(out)).toEqual(p);
  });

  it('writes a note that an older version kept in extra, so the upgrade window loses nothing (§21.5 review)', () => {
    // 1.1.x가 note를 모르는 키로 extra에 보존 → 업그레이드 뒤 page.note 없이 다시 쓰는 경우
    const md = serializePage({ ...base, extra: { note: '옛 한 줄', other: 1 } });
    expect(md).toContain('\nnote: 옛 한 줄\n');
    expect(parsePage(md)).toMatchObject({ note: '옛 한 줄', extra: { other: 1 } });
    // page.note가 있으면 그것이 이긴다
    expect(serializePage({ ...base, note: '새 한 줄', extra: { note: '옛 한 줄' } })).toContain('\nnote: 새 한 줄\n');
  });

  it('keeps unknown block keys in extraData and writes them back', () => {
    const md = serializePage(base).replace('"domain":"example.com",', '"domain":"example.com","future":{"x":1},');
    const p = parsePage(md);
    expect(p.extraData).toEqual({ future: { x: 1 } });
    expect(blockOf(serializePage(p)).future).toEqual({ x: 1 });
    expect(parsePage(serializePage(p))).toEqual(p);
  });

  it('keeps v1 unknown frontmatter keys as extra when rewriting to v2', () => {
    const p = parsePage(V1_FIXTURE.replace('\nclips:', '\nfoo: bar\nclips:'));
    expect(p.extra).toEqual({ foo: 'bar' });
    expect(fmKeys(serializePage(p))).toContain('foo');
  });

  it('does not put known keys or the version into extra/extraData', () => {
    const p = parsePage(serializePage({ ...base, summary: '요약', readAt: '2026-09-30T02:00:00.000Z', bookmark: { createdAt: 'x' } }));
    expect(p.extra).toBeUndefined();
    expect(p.extraData).toBeUndefined();
  });

  it('serializes without extra/extraData when they are empty', () => {
    expect(serializePage({ ...base, extra: {}, extraData: {} })).toBe(serializePage(base));
  });
});

describe('fitContentToFile', () => {
  const bytes = (s: string) => new TextEncoder().encode(s).length;

  it('keeps content under the cap as is', () => {
    expect(fitContentToFile(base)).toEqual({ contentText: base.contentText, truncated: false });
  });

  it('cuts content over the cap so the file fits, and flags it', () => {
    const big = { ...base, contentText: '가'.repeat(300_000) };
    const fit = fitContentToFile(big);
    expect(fit.truncated).toBe(true);
    expect(big.contentText.startsWith(fit.contentText)).toBe(true);
    expect(bytes(serializePage({ ...big, contentText: fit.contentText, contentTruncated: true }))).toBeLessThanOrEqual(MAX_FILE_BYTES);
  });

  it('does not split a surrogate pair at the cut', () => {
    const fit = fitContentToFile({ ...base, contentText: '😀'.repeat(200_000) });
    expect(fit.truncated).toBe(true);
    expect(fit.contentText.length % 2).toBe(0);
    expect(fit.contentText).toBe('😀'.repeat(fit.contentText.length / 2));
  });

  it('matches what serializePage writes', () => {
    const big = { ...base, contentText: 'a'.repeat(600_000) };
    expect(parsePage(serializePage(big)).contentText).toBe(fitContentToFile(big).contentText);
  });
});

describe('clipColorOf (§21.3)', () => {
  it('is amber when missing or unknown, else the stored color', () => {
    expect(clipColorOf(base.clips[0])).toBe('amber');
    expect(clipColorOf({ ...base.clips[0], color: 'violet' as never })).toBe('amber');
    expect(clipColorOf({ ...base.clips[0], color: 'pink' })).toBe('pink');
  });
});

describe('clipKindOf / normalizeNote (§21.5)', () => {
  it('is undefined when missing or unknown, else the stored kind', () => {
    expect(clipKindOf({})).toBeUndefined();
    expect(clipKindOf({ kind: 'wave' })).toBeUndefined();
    expect(clipKindOf({ kind: 'star' })).toBe('star');
  });
  it('collapses whitespace and newlines into one space and trims', () => {
    expect(normalizeNote('  a\n b\t\tc ')).toBe('a b c');
    expect(normalizeNote(' \n ')).toBe('');
  });
});

describe('templates (§21.4)', () => {
  const twoParas: Clip = { ...base.clips[0], id: 'c2', text: '단락1\n\n\n단락2', note: '메모', color: 'green' };
  const empty: Clip = { ...region, id: 'e1', text: '', html: undefined, image: undefined, note: '' };

  // §21.4 이전 serializePage의 본문 렌더(그대로 옮김). 기본 프리셋은 이것과 바이트 단위로 같아야 한다.
  const legacyBody = (clips: Clip[], content: string) => {
    const rendered = clips
      .map((clip) => {
        const parts: string[] = [];
        if (clip.image) parts.push(`![](../../${clip.image.path})`);
        const body = clip.type === 'region' && clip.html ? clip.html : clip.text;
        if (body) parts.push(body.split('\n').map((line) => `> ${line}`).join('\n'));
        if (clip.note) parts.push(clip.note);
        return parts.length > 0 ? `${parts.join('\n\n')}\n` : '';
      })
      .join('\n');
    return `## Clips\n\n${rendered}\n## Content\n\n${content}\n`;
  };
  it('default preset is byte-identical to the legacy renderer', () => {
    for (const p of [base, { ...base, clips: [] }, { ...base, clips: [base.clips[0], region] }, { ...base, clips: [empty] }, { ...base, clips: [twoParas, empty] }]) {
      const md = serializePage(p);
      expect(md).toBe(serializePage(p, TEMPLATE_DEFAULT));
      expect(bodyOf(md)).toBe(legacyBody(p.clips, p.contentText ?? ''));
    }
  });

  it('obsidian preset highlights each text paragraph and wraps region clips in a quote callout', () => {
    const md = serializePage({ ...base, clips: [twoParas, region] }, TEMPLATE_OBSIDIAN);
    expect(md).toContain('\n## Clips\n\n==단락1==\n\n==단락2==\n\n메모\n\n> [!quote]\n> ![](../../assets/r1.webp)\n>\n> ## 차트 제목\n> \n> - 범례\n\n## Content\n\n본문 첫 문단.');
  });

  it('obsidian preset skips clips that render nothing and keeps the frontmatter and content intact', () => {
    const p: Page = { ...base, clips: [twoParas, empty] };
    const md = serializePage(p, TEMPLATE_OBSIDIAN);
    expect(md).not.toContain('====');
    expect(parsePage(md)).toEqual(p);
    expect(parsePage(serializePage({ ...base, clips: [] }, TEMPLATE_OBSIDIAN))).toEqual({ ...base, clips: [] });
  });

  it('puts the kind glyph before the note line in both presets, and alone when there is no note (§21.5)', () => {
    const marked: Clip = { ...base.clips[0], kind: 'disagree' };
    const noNote: Clip = { ...base.clips[0], id: 'c3', kind: 'star', note: '' };
    expect(bodyOf(serializePage({ ...base, clips: [marked, noNote] }))).toBe('## Clips\n\n> 인용된 문장\n\n× 내 메모\n\n> 인용된 문장\n\n★\n\n## Content\n\n본문 첫 문단.\n\n본문 둘째 문단.\n');
    expect(bodyOf(serializePage({ ...base, clips: [marked, noNote] }, TEMPLATE_OBSIDIAN))).toBe('## Clips\n\n==인용된 문장==\n\n× 내 메모\n\n==인용된 문장==\n\n★\n\n## Content\n\n본문 첫 문단.\n\n본문 둘째 문단.\n');
    expect(parsePage(serializePage({ ...base, clips: [marked, noNote] }))).toEqual({ ...base, clips: [marked, noNote] });
  });

  // 펜(2026-10-30 §5): Obsidian 프리셋만 밑줄·취소선을 구분, 나머지 펜은 ==. 펜 없는 클립은 위 테스트들이 그대로 통과하는 것으로 바이트 불변을 보인다.
  it('obsidian preset renders underline as <u>, strike as ~~ and the other pens as ==', () => {
    const u: Clip = { ...base.clips[0], id: 'u1', pen: 'underline', note: '' };
    const s: Clip = { ...base.clips[0], id: 's1', pen: 'strike', note: '' };
    const b: Clip = { ...base.clips[0], id: 'b1', pen: 'box', note: '' };
    const md = serializePage({ ...base, clips: [u, s, b] }, TEMPLATE_OBSIDIAN);
    expect(bodyOf(md)).toBe('## Clips\n\n<u>인용된 문장</u>\n\n~~인용된 문장~~\n\n==인용된 문장==\n\n## Content\n\n본문 첫 문단.\n\n본문 둘째 문단.\n');
    expect(parsePage(md, TEMPLATE_OBSIDIAN)).toEqual({ ...base, clips: [u, s, b] });
    // 기본 프리셋은 펜을 표현하지 않는다
    expect(bodyOf(serializePage({ ...base, clips: [u] }))).toBe('## Clips\n\n> 인용된 문장\n\n## Content\n\n본문 첫 문단.\n\n본문 둘째 문단.\n');
  });

  it('templateData exposes pen flags per clip', () => {
    const d = templateData({ ...base, clips: [{ ...base.clips[0], pen: 'underline' }, base.clips[0]] }, '') as { clips: Array<Record<string, unknown>> };
    expect(d.clips[0]).toMatchObject({ pen: 'underline', penIsUnderline: true, penIsStrike: false });
    expect(d.clips[1]).toMatchObject({ pen: 'highlight', penIsUnderline: false, penIsStrike: false });
  });

  it('a custom template sees page, clip and color data', () => {
    const tpl = '{{title}}|{{#tags}}{{.}},{{/tags}}|{{#clips}}{{color}}:{{colorHex}}:{{isText}}:{{hasNote}}:{{kind}}:{{glyph}}:{{noteLine}};{{/clips}}|{{#bookmark}}{{quote}}{{/bookmark}}|{{note}}\n## Content\n\n{{content}}\n';
    const p: Page = { ...base, note: '한 줄', clips: [{ ...twoParas, kind: 'question' }], bookmark: { createdAt: '2026-09-30T01:00:00.000Z', quote: '여기' } };
    const md = serializePage(p, tpl);
    expect(bodyOf(md)).toBe('예시 글 제목|react,state,|green:#34C759:true:true:question:?:? 메모;|여기|한 줄\n## Content\n\n본문 첫 문단.\n\n본문 둘째 문단.\n');
    expect(parsePage(md)).toEqual(p);
  });
});

describe('parsePage with non-default templates (§21.4 review)', () => {
  const tricky: Page = {
    ...base,
    contentText: 'REAL',
    clips: [{ ...base.clips[0], text: '단락\n\n## Content', note: 'x\n## Content\nmore' }]
  };
  it('is not confused by a note or paragraph that contains the content heading under the obsidian preset', () => {
    const md = serializePage(tricky, TEMPLATE_OBSIDIAN);
    expect(parsePage(md)).toEqual(tricky);
    expect(serializePage(parsePage(md), TEMPLATE_OBSIDIAN)).toBe(md);
  });
  it('uses the given custom template to locate the content exactly', () => {
    const tpl = '{{#clips}}{{note}}\n{{/clips}}\n## Content\n\n{{content}}\n';
    const md = serializePage(tricky, tpl);
    expect(parsePage(md, tpl)).toEqual(tricky);
  });
});

describe('bodyPending (plan 2)', () => {
  const T0 = '2026-09-16T10:00:00.000Z';
  it('round-trips bodyPending=true through the data block and omits it otherwise', () => {
    const p: Page = { id: 'aaaaaaaa-0000-4000-8000-000000000001', url: 'https://e.com/a', title: 'A', domain: 'e.com', savedAt: T0, updatedAt: T0, rev: 1, tags: [], clips: [], bodyPending: true };
    const text = serializePage(p);
    expect(text).toContain('"bodyPending":true');
    expect(parsePage(text).bodyPending).toBe(true);
    const { bodyPending: _b, ...without } = p;
    const text2 = serializePage(without);
    expect(text2).not.toContain('bodyPending');
    expect(parsePage(text2).bodyPending).toBeUndefined();
  });
  it('ignores non-true bodyPending values when parsing', () => {
    const p: Page = { id: 'aaaaaaaa-0000-4000-8000-000000000001', url: 'https://e.com/a', title: 'A', domain: 'e.com', savedAt: T0, updatedAt: T0, rev: 1, tags: [], clips: [] };
    const text = serializePage(p).replace('"domain":"e.com"', '"domain":"e.com","bodyPending":"yes"');
    expect(parsePage(text).bodyPending).toBeUndefined();
  });
});

describe('clipsMarkdown (1.2.2 B6)', () => {
  it('puts a title link first and the default template clips, without the page content', () => {
    expect(clipsMarkdown(base)).toBe('[예시 글 제목](https://example.com/article)\n\n## Clips\n\n> 인용된 문장\n\n내 메모\n');
  });
  it('follows the Obsidian preset', () => {
    const out = clipsMarkdown(base, TEMPLATE_OBSIDIAN);
    expect(out).toBe('[예시 글 제목](https://example.com/article)\n\n## Clips\n\n==인용된 문장==\n\n내 메모\n');
  });
  it('never includes the content section, even with a custom template', () => {
    const custom = '# {{title}}\n\n{{#clips}}- {{text}}\n{{/clips}}\n## Content\n\n{{content}}\n';
    const out = clipsMarkdown(base, custom);
    expect(out).toContain('- 인용된 문장');
    expect(out).not.toContain('본문 첫 문단');
    expect(out).not.toContain('## Content');
  });
});
