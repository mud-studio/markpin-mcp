/** 본문 템플릿 프리셋(§21.4). frontmatter는 템플릿 대상이 아니다. `## Content` 줄은 parsePage가 찾으므로 필수. */

/**
 * 지금까지의 모양. 렌더 결과는 과거 serializePage와 바이트 단위로 같다(markdown.test의 legacy 렌더러와 대조).
 * 과거 렌더는 클립마다 `parts.join('\\n\\n') + '\\n'`(없으면 '')을 '\\n'으로 이었으므로 `block`·`last`를 그대로 쓴다.
 */
export const TEMPLATE_DEFAULT = '## Clips\n\n{{#clips}}{{block}}{{^last}}\n{{/last}}{{/clips}}\n## Content\n\n{{content}}\n';

/** Obsidian: 텍스트 클립은 단락마다 `==…==`(하이라이트는 단락을 못 넘는다), 영역 클립은 `[!quote]` 콜아웃. 색은 표현하지 않는다. */
export const TEMPLATE_OBSIDIAN =
  '## Clips\n\n' +
  '{{#clips}}' +
  '{{#isText}}{{#paragraphs}}=={{.}}==\n\n{{/paragraphs}}{{/isText}}' +
  '{{#isRegion}}> [!quote]\n{{#image}}> ![](../../{{image}})\n>\n{{/image}}{{quoted}}\n\n{{/isRegion}}' +
  '{{#note}}{{note}}\n\n{{/note}}' +
  '{{/clips}}{{^clips}}\n{{/clips}}' +
  '## Content\n\n{{content}}\n';

export const PRESETS = { default: TEMPLATE_DEFAULT, obsidian: TEMPLATE_OBSIDIAN } as const;
export type PresetName = keyof typeof PRESETS;
