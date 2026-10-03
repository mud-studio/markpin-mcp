import { describe, expect, it } from 'vitest';
import { CONFIG_PATH, DEFAULT_CONFIG, isPreset, isValidTemplate, parseConfig, resolveTemplate, serializeConfig } from './config';
import { TEMPLATE_DEFAULT, TEMPLATE_OBSIDIAN } from './presets';

describe('markpin.json (§21.4)', () => {
  it('lives at the storage root', () => {
    expect(CONFIG_PATH).toBe('markpin.json');
  });
  it('falls back to defaults for broken json, wrong types and unknown keys', () => {
    expect(parseConfig('not json')).toEqual(DEFAULT_CONFIG);
    expect(parseConfig('{ "template": 123, "trashOnDelete": "yes", "x": 1 }')).toEqual(DEFAULT_CONFIG);
    expect(parseConfig('[]')).toEqual(DEFAULT_CONFIG);
  });
  it('keeps valid fields and fills the rest', () => {
    expect(parseConfig('{ "template": "obsidian" }')).toEqual({ template: 'obsidian', trashOnDelete: false });
    expect(parseConfig('{ "trashOnDelete": true }')).toEqual({ template: 'default', trashOnDelete: true });
  });
  it('round-trips through serializeConfig with a trailing newline', () => {
    const c = { template: 'obsidian', trashOnDelete: true };
    const text = serializeConfig(c);
    expect(text.endsWith('\n')).toBe(true);
    expect(parseConfig(text)).toEqual(c);
  });
});

describe('resolveTemplate', () => {
  it('maps preset names to their template strings', () => {
    expect(resolveTemplate('default')).toBe(TEMPLATE_DEFAULT);
    expect(resolveTemplate('obsidian')).toBe(TEMPLATE_OBSIDIAN);
    expect(isPreset('obsidian')).toBe(true);
    expect(isPreset('{{title}}')).toBe(false);
  });
  it('keeps a custom template that has a ## Content line and balanced blocks', () => {
    const tpl = '{{title}}\n## Content\n\n{{content}}\n';
    expect(resolveTemplate(tpl)).toBe(tpl);
  });
  it('rejects templates that do not end with the content block at top level', () => {
    expect(resolveTemplate('## Content\n\n{{content}}\n---\nfrom {{url}}\n')).toBe(TEMPLATE_DEFAULT);
    expect(resolveTemplate('{{title}}\n## Content\n\n{{title}}\n')).toBe(TEMPLATE_DEFAULT);
    expect(resolveTemplate('{{#clips}}\n## Content\n\n{{content}}\n{{/clips}}')).toBe(TEMPLATE_DEFAULT);
    expect(isValidTemplate('{{title}}\n## Content\n\n{{content}}\n')).toBe(true);
    expect(isValidTemplate('nope')).toBe(false);
  });

  it('falls back to default when the ## Content line is missing or blocks are unbalanced', () => {
    expect(resolveTemplate('{{title}}\n{{content}}')).toBe(TEMPLATE_DEFAULT);
    expect(resolveTemplate('{{#clips}}\n## Content\n\n{{content}}\n')).toBe(TEMPLATE_DEFAULT);
    expect(resolveTemplate('## Contents\n{{content}}')).toBe(TEMPLATE_DEFAULT);
  });
});
