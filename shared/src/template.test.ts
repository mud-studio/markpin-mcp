import { describe, expect, it } from 'vitest';
import { render, validateTemplate } from './template';

describe('render (§21.4)', () => {
  it('substitutes variables and renders missing ones as empty', () => {
    expect(render('# {{title}} ({{url}}) [{{nope}}]', { title: 'T', url: 'u' })).toBe('# T (u) []');
  });
  it('iterates a string list with {{.}} and an object list with its fields', () => {
    expect(render('{{#tags}}#{{.}} {{/tags}}', { tags: ['a', 'b'] })).toBe('#a #b ');
    expect(render('{{#clips}}- {{text}} ({{title}})\n{{/clips}}', { title: 'T', clips: [{ text: 'x' }, { text: 'y' }] })).toBe('- x (T)\n- y (T)\n');
  });
  it('treats a boolean or string section as a condition', () => {
    expect(render('{{#hasNote}}note{{/hasNote}}|{{#note}}{{note}}{{/note}}', { hasNote: false, note: '' })).toBe('|');
    expect(render('{{#hasNote}}note{{/hasNote}}|{{#note}}{{note}}{{/note}}', { hasNote: true, note: 'm' })).toBe('note|m');
  });
  it('renders inverted sections for falsy values and empty lists', () => {
    expect(render('{{^tags}}none{{/tags}}{{^summary}}-{{/summary}}', { tags: [], summary: undefined })).toBe('none-');
    expect(render('{{^tags}}none{{/tags}}', { tags: ['a'] })).toBe('');
  });
  it('nests sections and resolves names from the innermost context outward', () => {
    const data = { title: 'T', clips: [{ text: 'x', paragraphs: ['p1', 'p2'] }] };
    expect(render('{{#clips}}{{#paragraphs}}=={{.}}== {{/paragraphs}}{{title}}{{/clips}}', data)).toBe('==p1== ==p2== T');
  });
  it('renders numbers and leaves non-tag braces alone', () => {
    expect(render('{{n}} {{{x}}} {not}', { n: 3 })).toBe('3 {} {not}');
  });
});

describe('validateTemplate', () => {
  it('reports unclosed and unopened blocks, null when balanced', () => {
    expect(validateTemplate('{{#a}}x')).toBe('unclosed');
    expect(validateTemplate('x{{/a}}')).toBe('unopened');
    expect(validateTemplate('{{#a}}{{/b}}')).toBe('unopened');
    expect(validateTemplate('{{#a}}{{^b}}{{/b}}{{/a}} {{c}}')).toBeNull();
  });
});
