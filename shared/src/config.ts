import { PRESETS, TEMPLATE_DEFAULT, type PresetName } from './presets';
import { validateTemplate } from './template';

/** 저장소 루트의 설정 파일(§21.4). 확장·MCP가 같은 템플릿으로 쓰도록 폴더 안에 둔다. */
export const CONFIG_PATH = 'markpin.json';

export type MarkpinConfig = {
  /** 프리셋 이름(`default`·`obsidian`) 또는 템플릿 문자열 */
  template: string;
  /** 폴더 어댑터: 삭제한 페이지 파일을 `.trash/`로 옮긴다 */
  trashOnDelete: boolean;
};

export const DEFAULT_CONFIG: MarkpinConfig = { template: 'default', trashOnDelete: false };

/** 깨진 JSON·잘못된 타입은 조용히 기본값. 모르는 키는 버린다. */
export function parseConfig(text: string): MarkpinConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_CONFIG };
  const o = raw as Record<string, unknown>;
  return {
    template: typeof o.template === 'string' && o.template.trim() ? o.template : DEFAULT_CONFIG.template,
    trashOnDelete: typeof o.trashOnDelete === 'boolean' ? o.trashOnDelete : DEFAULT_CONFIG.trashOnDelete
  };
}

export function serializeConfig(config: MarkpinConfig): string {
  return `${JSON.stringify({ template: config.template, trashOnDelete: config.trashOnDelete }, null, 2)}\n`;
}

export function isPreset(value: string): value is PresetName {
  return Object.prototype.hasOwnProperty.call(PRESETS, value);
}

/** 본문 블록은 템플릿 끝, 최상위에 이 모양 그대로여야 한다 — parsePage가 본문을 정확히 잘라 내고, 뒤에 붙는 꼬리가 본문에 섞이지 않게. */
const CONTENT_TAIL = /(^|\n|\}\})## Content\n\n\{\{content\}\}\n$/;

/** 사용자 템플릿 검증: 블록 짝이 맞고 `## Content\n\n{{content}}\n`으로 끝난다. */
export function isValidTemplate(value: string): boolean {
  return validateTemplate(value) === null && CONTENT_TAIL.test(value);
}

/** 프리셋 이름이면 그 템플릿, 아니면 검증을 통과한 사용자 템플릿. 실패하면 기본 프리셋(본문이 사라지지 않게). 호출자가 log한다. */
export function resolveTemplate(value: string): string {
  if (isPreset(value)) return PRESETS[value];
  return isValidTemplate(value) ? value : TEMPLATE_DEFAULT;
}
