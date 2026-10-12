import { describe, expect, it } from 'vitest';
import { confirmLabel, confirmMessage, type Change } from './messages';
import { LANGS } from './cli';

describe('confirmMessage', () => {
  it('describes each change in Korean', () => {
    expect(confirmMessage('ko', { kind: 'save_page', title: 'A', url: 'https://e.com/a' })).toBe("'A'(https://e.com/a)를 Markpin에 저장할까요?");
    expect(confirmMessage('ko', { kind: 'update_tags', titles: ['A', 'B'], add: ['x'], remove: ['y'] })).toBe("'A', 'B'에 태그 x 추가, y 제거할까요?");
    expect(confirmMessage('ko', { kind: 'update_tags', titles: ['A'], add: ['x'], remove: [] })).toBe("'A'에 태그 x 추가할까요?");
    expect(confirmMessage('ko', { kind: 'add_clip', title: 'A', text: 'x'.repeat(50) })).toBe(`'A'에 클립 "${'x'.repeat(40)}…"을 추가할까요?`);
    expect(confirmMessage('ko', { kind: 'set_clip_note', title: 'A', note: '' })).toBe("'A'의 클립 메모를 지울까요?");
    expect(confirmMessage('ko', { kind: 'set_clip_note', title: 'A', note: 'm' })).toBe("'A'의 클립 메모를 \"m\"으로 바꿀까요?");
    expect(confirmMessage('ko', { kind: 'set_note', title: 'A', note: '' })).toBe("'A'의 한 줄을 지울까요?");
    expect(confirmMessage('ko', { kind: 'set_note', title: 'A', note: 'n' })).toBe("'A'의 한 줄을 \"n\"으로 바꿀까요?");
    expect(confirmMessage('ko', { kind: 'set_summary', title: 'A', summary: '' })).toBe("'A'의 요약을 지울까요?");
    expect(confirmMessage('ko', { kind: 'set_summary', title: 'A', summary: 's' })).toBe("'A'의 요약을 \"s\"으로 바꿀까요?");
    expect(confirmMessage('ko', { kind: 'delete_pages', titles: ['A', 'B', 'C', 'D', 'E'] })).toBe("'A', 'B', 'C' 외 2개를 삭제할까요? (30일 안에 복구 가능)");
    expect(confirmMessage('ko', { kind: 'restore_pages', titles: ['A'] })).toBe("'A'를 복구할까요?");
  });
  it('picks the Korean object particle from the last character of the last title', () => {
    expect(confirmMessage('ko', { kind: 'delete_pages', titles: ['책'] })).toBe("'책'을 삭제할까요? (30일 안에 복구 가능)");
    expect(confirmMessage('ko', { kind: 'delete_pages', titles: ['책', '노트'] })).toBe("'책', '노트'를 삭제할까요? (30일 안에 복구 가능)");
    expect(confirmMessage('ko', { kind: 'restore_pages', titles: ['노트'] })).toBe("'노트'를 복구할까요?");
    expect(confirmMessage('ko', { kind: 'restore_pages', titles: ['책'] })).toBe("'책'을 복구할까요?");
    // 목록이 `외 N개`로 줄면 조사는 숨은 제목이 아니라 `개`에 맞춘다.
    expect(confirmMessage('ko', { kind: 'delete_pages', titles: ['A', 'B', 'C', 'D', '책'] })).toBe("'A', 'B', 'C' 외 2개를 삭제할까요? (30일 안에 복구 가능)");
    expect(confirmMessage('ko', { kind: 'restore_pages', titles: ['A', 'B', 'C', '책'] })).toBe("'A', 'B', 'C' 외 1개를 복구할까요?");
    expect(confirmMessage('ko', { kind: 'save_page', title: '책', url: 'https://e.com/a' })).toBe("'책'(https://e.com/a)을 Markpin에 저장할까요?");
  });
  it('describes each change in English', () => {
    expect(confirmMessage('en', { kind: 'save_page', title: 'A', url: 'https://e.com/a' })).toBe("Save 'A' (https://e.com/a) to Markpin?");
    expect(confirmMessage('en', { kind: 'update_tags', titles: ['A'], add: ['x', 'z'], remove: [] })).toBe("Add tags x, z to 'A'?");
    expect(confirmMessage('en', { kind: 'update_tags', titles: ['A'], add: [], remove: ['y'] })).toBe("Remove tag y from 'A'?");
    expect(confirmMessage('en', { kind: 'delete_pages', titles: ['A', 'B', 'C', 'D'] })).toBe("Delete 'A', 'B', 'C' and 1 more? (restorable for 30 days)");
    expect(confirmMessage('en', { kind: 'add_clip', title: 'A', text: 'short' })).toBe(`Add the clip "short" to 'A'?`);
    expect(confirmMessage('en', { kind: 'set_clip_note', title: 'A', note: 'm' })).toBe(`Change the clip note on 'A' to "m"?`);
    expect(confirmMessage('en', { kind: 'restore_pages', titles: ['A', 'B'] })).toBe("Restore 'A', 'B'?");
    expect(confirmMessage('en', { kind: 'set_summary', title: 'A', summary: 's' })).toBe(`Change the summary of 'A' to "s"?`);
    expect(confirmMessage('en', { kind: 'set_summary', title: 'A', summary: '' })).toBe("Clear the summary of 'A'?");
  });
  it('has labels in both languages', () => {
    expect(confirmLabel('ko').title).toBe('진행');
    expect(confirmLabel('en').title).toBe('Proceed');
  });
  it('describes each change in the five added languages', () => {
    const tags = { kind: 'update_tags' as const, titles: ['React Docs'], add: ['frontend'], remove: [] };
    expect(confirmMessage('ja', tags)).toBe("'React Docs'のタグを変更しますか？ 追加: frontend");
    expect(confirmMessage('es', tags)).toBe("¿Cambiar las etiquetas de 'React Docs'? Añadir: frontend.");
    expect(confirmMessage('pt-BR', tags)).toBe("Alterar as tags de 'React Docs'? Adicionar: frontend.");
    expect(confirmMessage('de', tags)).toBe("Tags von 'React Docs' ändern? Hinzufügen: frontend.");
    expect(confirmMessage('fr', tags)).toBe("Modifier les tags de 'React Docs' ? Ajouter : frontend.");
    expect(confirmMessage('de', { kind: 'update_tags', titles: ['A'], add: ['x'], remove: ['y'] })).toBe("Tags von 'A' ändern? Hinzufügen: x. Entfernen: y.");
    expect(confirmMessage('ja', { kind: 'update_tags', titles: ['A'], add: [], remove: ['y'] })).toBe("'A'のタグを変更しますか？ 削除: y");

    expect(confirmMessage('ja', { kind: 'save_page', title: 'A', url: 'https://e.com/a' })).toBe("'A'（https://e.com/a）をMarkpinに保存しますか？");
    expect(confirmMessage('ja', { kind: 'delete_pages', titles: ['A', 'B', 'C', 'D'] })).toBe("'A', 'B', 'C' 他1件を削除しますか？（30日以内なら復元できます）");
    expect(confirmMessage('es', { kind: 'add_clip', title: 'A', text: 'x' })).toBe("¿Añadir el clip \"x\" a 'A'?");
    expect(confirmMessage('pt-BR', { kind: 'add_clip', title: 'A', text: 'x' })).toBe("Adicionar o clipe \"x\" em 'A'?");
    expect(confirmMessage('pt-BR', { kind: 'set_clip_note', title: 'A', note: '' })).toBe("Apagar a nota do clipe em 'A'?");
    expect(confirmMessage('pt-BR', { kind: 'delete_pages', titles: ['A'] })).toBe("Excluir 'A'? (é possível restaurar por 30 dias)");
    expect(confirmMessage('es', { kind: 'set_clip_note', title: 'A', note: 'm' })).toBe("¿Cambiar la nota del clip en 'A' a \"m\"?");
    expect(confirmMessage('fr', { kind: 'set_clip_note', title: 'A', note: 'm' })).toBe("Remplacer la note du clip dans 'A' par « m » ?");
    expect(confirmMessage('de', { kind: 'set_summary', title: 'A', summary: 's' })).toBe("Zusammenfassung von 'A' in \"s\" ändern?");
    expect(confirmMessage('fr', { kind: 'delete_pages', titles: ['A', 'B', 'C', 'D', 'E'] })).toBe("Supprimer 'A', 'B', 'C' et 2 autres ? (restaurable pendant 30 jours)");
    expect(confirmMessage('es', { kind: 'restore_pages', titles: ['A'] })).toBe("¿Restaurar 'A'?");
    expect(confirmMessage('ko', { kind: 'set_bookmark', title: 'A' })).toBe("'A'에 책갈피를 꽂을까요?");
    expect(confirmMessage('ko', { kind: 'set_bookmark', title: 'A', quote: '여기부터' })).toBe("'A'의 \"여기부터\"에 책갈피를 꽂을까요?");
    expect(confirmMessage('ko', { kind: 'clear_bookmark', title: 'A' })).toBe("'A'의 책갈피를 뺄까요?");
    expect(confirmMessage('ko', { kind: 'mark_read', title: '요리법' })).toBe("'요리법'을 읽음으로 표시할까요?");
    expect(confirmMessage('en', { kind: 'set_bookmark', title: 'A', quote: 'from here' })).toBe(`Bookmark 'A' at "from here"?`);
    expect(confirmMessage('en', { kind: 'mark_read', title: 'A' })).toBe("Mark 'A' as read?");
  });
  it('every language renders every kind non-empty and names the title', () => {
    const kinds: Change[] = [
      { kind: 'save_page', title: 'T', url: 'https://e.com' },
      { kind: 'update_tags', titles: ['T'], add: ['x'], remove: ['y'] },
      { kind: 'add_clip', title: 'T', text: 'c' },
      { kind: 'set_clip_note', title: 'T', note: 'n' },
      { kind: 'set_clip_note', title: 'T', note: '' },
      { kind: 'set_summary', title: 'T', summary: 's' },
      { kind: 'set_summary', title: 'T', summary: '' },
      { kind: 'set_note', title: 'T', note: 'n' },
      { kind: 'set_note', title: 'T', note: '' },
      { kind: 'delete_pages', titles: ['T'] },
      { kind: 'restore_pages', titles: ['T'] },
      { kind: 'set_bookmark', title: 'T' },
      { kind: 'set_bookmark', title: 'T', quote: 'q' },
      { kind: 'clear_bookmark', title: 'T' },
      { kind: 'mark_read', title: 'T' }
    ];
    for (const lang of LANGS) {
      for (const c of kinds) expect(confirmMessage(lang, c), `${lang} ${c.kind}`).toContain("'T'");
      expect(confirmLabel(lang).title).not.toBe('');
      expect(confirmLabel(lang).description).not.toBe('');
    }
  });
});
