/**
 * 최소 템플릿 엔진(§21.4). 문법은 셋뿐: `{{var}}`, `{{#key}}…{{/key}}`(리스트면 반복, 그 외는 truthy 조건),
 * `{{^key}}…{{/key}}`(falsy·빈 리스트). 이스케이프·필터·식 없음 — 출력이 Markdown이라 그대로 쓴다.
 */
export type TemplateValue = string | number | boolean | undefined | TemplateValue[] | { [k: string]: TemplateValue };
export type TemplateData = Record<string, TemplateValue>;

type Node = { kind: 'text'; text: string } | { kind: 'var'; name: string } | { kind: 'section'; name: string; inverted: boolean; children: Node[] };

const TAG = /\{\{(#|\^|\/)?\s*([\w.]+)\s*\}\}/g;

function parse(template: string): { root: Node[]; error: 'unclosed' | 'unopened' | null } {
  const root: Node[] = [];
  const stack: Array<{ name: string; children: Node[] }> = [{ name: '', children: root }];
  let last = 0;
  for (const m of template.matchAll(TAG)) {
    const [raw, mark, name] = m;
    const at = m.index!;
    if (at > last) stack[stack.length - 1].children.push({ kind: 'text', text: template.slice(last, at) });
    last = at + raw.length;
    if (mark === '/') {
      if (stack.length === 1 || stack[stack.length - 1].name !== name) return { root, error: 'unopened' };
      stack.pop();
    } else if (mark === '#' || mark === '^') {
      const node: Node = { kind: 'section', name, inverted: mark === '^', children: [] };
      stack[stack.length - 1].children.push(node);
      stack.push({ name, children: node.children });
    } else {
      stack[stack.length - 1].children.push({ kind: 'var', name });
    }
  }
  if (last < template.length) stack[stack.length - 1].children.push({ kind: 'text', text: template.slice(last) });
  return { root, error: stack.length > 1 ? 'unclosed' : null };
}

/** 블록 짝만 검사한다. `## Content` 줄 검사는 config의 몫. */
export function validateTemplate(template: string): 'unclosed' | 'unopened' | null {
  return parse(template).error;
}

function lookup(stack: TemplateValue[], name: string): TemplateValue {
  for (let i = stack.length - 1; i >= 0; i--) {
    const ctx = stack[i];
    if (name === '.') return ctx;
    if (ctx !== null && typeof ctx === 'object' && !Array.isArray(ctx) && name in ctx) return ctx[name];
  }
  return undefined;
}

const truthy = (v: TemplateValue): boolean => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== false && v !== '' && v !== 0);

function renderNodes(nodes: Node[], stack: TemplateValue[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'text') {
      out += node.text;
    } else if (node.kind === 'var') {
      const v = lookup(stack, node.name);
      out += v === undefined || typeof v === 'object' ? '' : String(v);
    } else {
      const v = lookup(stack, node.name);
      if (node.inverted) {
        if (!truthy(v)) out += renderNodes(node.children, stack);
      } else if (Array.isArray(v)) {
        for (const item of v) out += renderNodes(node.children, [...stack, item]);
      } else if (truthy(v)) {
        out += renderNodes(node.children, typeof v === 'object' ? [...stack, v] : stack);
      }
    }
  }
  return out;
}

export function render(template: string, data: TemplateData): string {
  return renderNodes(parse(template).root, [data]);
}
