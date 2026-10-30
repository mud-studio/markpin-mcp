import type { Lang } from './cli';

export type Change =
  | { kind: 'save_page'; title: string; url: string }
  | { kind: 'update_tags'; titles: string[]; add: string[]; remove: string[] }
  | { kind: 'add_clip'; title: string; text: string }
  | { kind: 'set_clip_note'; title: string; note: string }
  | { kind: 'set_summary'; title: string; summary: string }
  // 「이 글 한 줄」(§21.5)
  | { kind: 'set_note'; title: string; note: string }
  | { kind: 'delete_pages'; titles: string[] }
  | { kind: 'restore_pages'; titles: string[] }
  // 책갈피(§21.2)
  | { kind: 'set_bookmark'; title: string; quote?: string }
  | { kind: 'clear_bookmark'; title: string }
  | { kind: 'mark_read'; title: string }
  | { kind: 'mark_skimmed'; title: string }
  // 태그 병합·이름 변경·삭제(0.10.0 §2.1) — 항목을 전부 나열한다(제목처럼 3개에서 자르지 않는다)
  | { kind: 'retag'; items: Array<{ from: string; to: string | null; pages: number }> };

const MAX_TITLES = 3;
const MAX_TEXT = 40;

const MORE: Record<Lang, (rest: number) => string> = {
  ko: (n) => `외 ${n}개`,
  en: (n) => `and ${n} more`,
  ja: (n) => `他${n}件`,
  es: (n) => `y ${n} más`,
  'pt-BR': (n) => `e mais ${n}`,
  de: (n) => `und ${n} weitere`,
  fr: (n) => `et ${n} autres`
};

const quoteTitles = (titles: string[], lang: Lang): string => {
  const shown = titles.slice(0, MAX_TITLES).map((t) => `'${t}'`).join(', ');
  const rest = titles.length - MAX_TITLES;
  if (rest <= 0) return shown;
  return `${shown} ${MORE[lang](rest)}`;
};
const clip = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s);

type RetagItem = Extract<Change, { kind: 'retag' }>['items'][number];
/** retag 항목 나열: `'a' → 'b'(12개)`처럼 `rename(from,to,n)`, 삭제는 `remove(from,n)`. */
const retagList = (items: RetagItem[], rename: (from: string, to: string, n: number) => string, remove: (from: string, n: number) => string, sep = ', '): string =>
  items.map((i) => (i.to === null ? remove(i.from, i.pages) : rename(i.from, i.to, i.pages))).join(sep);

/**
 * 마지막 글자에 맞는 조사를 고른다. 한글 음절(U+AC00–U+D7A3)이면 종성 유무로,
 * 그 밖(영문·숫자·따옴표 등)이면 받침 없는 쪽으로 — 제목이 영어일 때가 잦다.
 */
export function josa(word: string, withBatchim: string, withoutBatchim: string): string {
  const code = word.charCodeAt(word.length - 1);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 0 ? withoutBatchim : withBatchim;
  return withoutBatchim;
}

/**
 * 조사가 실제로 붙는 낱말. 목록이 `외 N개`로 줄어들면 마지막 글자는 숨은 제목이 아니라 `개`다.
 * `quoteTitles`의 생략 규칙과 짝을 이룬다.
 */
const particleWord = (titles: string[]) => (titles.length > MAX_TITLES ? '개' : titles[titles.length - 1] ?? '');

function ko(c: Change): string {
  switch (c.kind) {
    case 'save_page': return `'${c.title}'(${c.url})${josa(c.title, '을', '를')} Markpin에 저장할까요?`;
    case 'update_tags': {
      const parts = [c.add.length ? `${c.add.join(', ')} 추가` : '', c.remove.length ? `${c.remove.join(', ')} 제거` : ''].filter(Boolean);
      return `${quoteTitles(c.titles, 'ko')}에 태그 ${parts.join(', ')}할까요?`;
    }
    case 'add_clip': return `'${c.title}'에 클립 "${clip(c.text)}"을 추가할까요?`;
    case 'set_clip_note': return c.note ? `'${c.title}'의 클립 메모를 "${clip(c.note)}"으로 바꿀까요?` : `'${c.title}'의 클립 메모를 지울까요?`;
    case 'set_summary': return c.summary ? `'${c.title}'의 요약을 "${clip(c.summary)}"으로 바꿀까요?` : `'${c.title}'의 요약을 지울까요?`;
    case 'set_note': return c.note ? `'${c.title}'의 한 줄을 "${clip(c.note)}"으로 바꿀까요?` : `'${c.title}'의 한 줄을 지울까요?`;
    case 'delete_pages': return `${quoteTitles(c.titles, 'ko')}${josa(particleWord(c.titles), '을', '를')} 삭제할까요? (30일 안에 복구 가능)`;
    case 'restore_pages': return `${quoteTitles(c.titles, 'ko')}${josa(particleWord(c.titles), '을', '를')} 복구할까요?`;
    case 'set_bookmark': return c.quote ? `'${c.title}'의 "${clip(c.quote)}"에 책갈피를 꽂을까요?` : `'${c.title}'에 책갈피를 꽂을까요?`;
    case 'clear_bookmark': return `'${c.title}'의 책갈피를 뺄까요?`;
    case 'mark_read': return `'${c.title}'${josa(c.title, '을', '를')} 읽음으로 표시할까요?`;
    case 'mark_skimmed': return `'${c.title}'${josa(c.title, '을', '를')} 훑어봄으로 표시할까요?`;
    case 'retag': return `태그 ${retagList(c.items, (f, t, n) => `'${f}' → '${t}'(${n}개)`, (f, n) => `'${f}' 삭제(${n}개)`)}로 바꿀까요?`;
  }
  const exhaustive: never = c;
  return exhaustive;
}

function en(c: Change): string {
  switch (c.kind) {
    case 'save_page': return `Save '${c.title}' (${c.url}) to Markpin?`;
    case 'update_tags': {
      const add = c.add.length ? `Add tag${c.add.length > 1 ? 's' : ''} ${c.add.join(', ')} to` : '';
      const remove = c.remove.length ? `Remove tag${c.remove.length > 1 ? 's' : ''} ${c.remove.join(', ')} from` : '';
      const verb = add && remove ? `${add} and ${remove.charAt(0).toLowerCase()}${remove.slice(1)}` : add || remove;
      return `${verb} ${quoteTitles(c.titles, 'en')}?`;
    }
    case 'add_clip': return `Add the clip "${clip(c.text)}" to '${c.title}'?`;
    case 'set_clip_note': return c.note ? `Change the clip note on '${c.title}' to "${clip(c.note)}"?` : `Clear the clip note on '${c.title}'?`;
    case 'set_summary': return c.summary ? `Change the summary of '${c.title}' to "${clip(c.summary)}"?` : `Clear the summary of '${c.title}'?`;
    case 'set_note': return c.note ? `Change the one-liner for '${c.title}' to "${clip(c.note)}"?` : `Clear the one-liner for '${c.title}'?`;
    case 'delete_pages': return `Delete ${quoteTitles(c.titles, 'en')}? (restorable for 30 days)`;
    case 'restore_pages': return `Restore ${quoteTitles(c.titles, 'en')}?`;
    case 'set_bookmark': return c.quote ? `Bookmark '${c.title}' at "${clip(c.quote)}"?` : `Bookmark '${c.title}'?`;
    case 'clear_bookmark': return `Remove the bookmark from '${c.title}'?`;
    case 'mark_read': return `Mark '${c.title}' as read?`;
    case 'mark_skimmed': return `Mark '${c.title}' as skimmed?`;
    case 'retag': return `Change tags: ${retagList(c.items, (f, t, n) => `'${f}' → '${t}' (${n} page${n === 1 ? '' : 's'})`, (f, n) => `remove '${f}' (${n} page${n === 1 ? '' : 's'})`)}?`;
  }
  const exhaustive: never = c;
  return exhaustive;
}

/** 추가/제거 목록을 "추가: x. 제거: y." 꼴로 — 성·수 일치를 피한다(§16.3). `add`·`remove`는 각 목록 앞에 붙는 라벨, `end`는 각 절 끝에 붙는 문장부호. */
const tagParts = (c: Extract<Change, { kind: 'update_tags' }>, add: string, remove: string, end: string): string =>
  [c.add.length ? `${add} ${c.add.join(', ')}${end}` : '', c.remove.length ? `${remove} ${c.remove.join(', ')}${end}` : ''].filter(Boolean).join(' ');

function ja(c: Change): string {
  switch (c.kind) {
    case 'save_page': return `'${c.title}'（${c.url}）をMarkpinに保存しますか？`;
    case 'update_tags': return `${quoteTitles(c.titles, 'ja')}のタグを変更しますか？ ${tagParts(c, '追加:', '削除:', '')}`;
    case 'add_clip': return `'${c.title}'にクリップ「${clip(c.text)}」を追加しますか？`;
    case 'set_clip_note': return c.note ? `'${c.title}'のクリップメモを「${clip(c.note)}」に変更しますか？` : `'${c.title}'のクリップメモを削除しますか？`;
    case 'set_summary': return c.summary ? `'${c.title}'の要約を「${clip(c.summary)}」に変更しますか？` : `'${c.title}'の要約を削除しますか？`;
    case 'set_note': return c.note ? `'${c.title}'の一行を「${clip(c.note)}」に変更しますか？` : `'${c.title}'の一行を削除しますか？`;
    case 'delete_pages': return `${quoteTitles(c.titles, 'ja')}を削除しますか？（30日以内なら復元できます）`;
    case 'restore_pages': return `${quoteTitles(c.titles, 'ja')}を復元しますか？`;
    case 'set_bookmark': return c.quote ? `'${c.title}'の「${clip(c.quote)}」にしおりを挟みますか？` : `'${c.title}'にしおりを挟みますか？`;
    case 'clear_bookmark': return `'${c.title}'のしおりを外しますか？`;
    case 'mark_read': return `'${c.title}'を読了にしますか？`;
    case 'mark_skimmed': return `'${c.title}'を流し読みにしますか？`;
    case 'retag': return `タグを変更しますか？ ${retagList(c.items, (f, t, n) => `'${f}' → '${t}'（${n}件）`, (f, n) => `'${f}' を削除（${n}件）`, '、')}`;
  }
  const exhaustive: never = c;
  return exhaustive;
}

function es(c: Change): string {
  switch (c.kind) {
    case 'save_page': return `¿Guardar '${c.title}' (${c.url}) en Markpin?`;
    case 'update_tags': return `¿Cambiar las etiquetas de ${quoteTitles(c.titles, 'es')}? ${tagParts(c, 'Añadir:', 'Quitar:', '.')}`;
    case 'add_clip': return `¿Añadir el clip "${clip(c.text)}" a '${c.title}'?`;
    case 'set_clip_note': return c.note ? `¿Cambiar la nota del clip en '${c.title}' a "${clip(c.note)}"?` : `¿Borrar la nota del clip en '${c.title}'?`;
    case 'set_summary': return c.summary ? `¿Cambiar el resumen de '${c.title}' a "${clip(c.summary)}"?` : `¿Borrar el resumen de '${c.title}'?`;
    case 'set_note': return c.note ? `¿Cambiar tu línea sobre '${c.title}' a "${clip(c.note)}"?` : `¿Borrar tu línea sobre '${c.title}'?`;
    case 'delete_pages': return `¿Eliminar ${quoteTitles(c.titles, 'es')}? (se puede restaurar durante 30 días)`;
    case 'restore_pages': return `¿Restaurar ${quoteTitles(c.titles, 'es')}?`;
    case 'set_bookmark': return c.quote ? `¿Poner un marcapáginas en '${c.title}', en "${clip(c.quote)}"?` : `¿Poner un marcapáginas en '${c.title}'?`;
    case 'clear_bookmark': return `¿Quitar el marcapáginas de '${c.title}'?`;
    case 'mark_read': return `¿Marcar '${c.title}' como leído?`;
    case 'mark_skimmed': return `¿Marcar '${c.title}' como ojeado?`;
    case 'retag': return `¿Cambiar las etiquetas? ${retagList(c.items, (f, t, n) => `'${f}' → '${t}' (${n} página${n === 1 ? '' : 's'})`, (f, n) => `quitar '${f}' (${n} página${n === 1 ? '' : 's'})`)}.`;
  }
  const exhaustive: never = c;
  return exhaustive;
}

function ptBR(c: Change): string {
  switch (c.kind) {
    case 'save_page': return `Salvar '${c.title}' (${c.url}) no Markpin?`;
    case 'update_tags': return `Alterar as tags de ${quoteTitles(c.titles, 'pt-BR')}? ${tagParts(c, 'Adicionar:', 'Remover:', '.')}`;
    case 'add_clip': return `Adicionar o clipe "${clip(c.text)}" em '${c.title}'?`;
    case 'set_clip_note': return c.note ? `Alterar a nota do clipe em '${c.title}' para "${clip(c.note)}"?` : `Apagar a nota do clipe em '${c.title}'?`;
    case 'set_summary': return c.summary ? `Alterar o resumo de '${c.title}' para "${clip(c.summary)}"?` : `Apagar o resumo de '${c.title}'?`;
    case 'set_note': return c.note ? `Alterar a sua linha de '${c.title}' para "${clip(c.note)}"?` : `Apagar a sua linha de '${c.title}'?`;
    case 'delete_pages': return `Excluir ${quoteTitles(c.titles, 'pt-BR')}? (é possível restaurar por 30 dias)`;
    case 'restore_pages': return `Restaurar ${quoteTitles(c.titles, 'pt-BR')}?`;
    case 'set_bookmark': return c.quote ? `Marcar '${c.title}' a partir de "${clip(c.quote)}"?` : `Marcar '${c.title}' para ler depois?`;
    case 'clear_bookmark': return `Remover o marcador de '${c.title}'?`;
    case 'mark_read': return `Marcar '${c.title}' como lido?`;
    case 'mark_skimmed': return `Marcar '${c.title}' como folheado?`;
    case 'retag': return `Alterar as tags? ${retagList(c.items, (f, t, n) => `'${f}' → '${t}' (${n} página${n === 1 ? '' : 's'})`, (f, n) => `remover '${f}' (${n} página${n === 1 ? '' : 's'})`)}.`;
  }
  const exhaustive: never = c;
  return exhaustive;
}

function de(c: Change): string {
  switch (c.kind) {
    case 'save_page': return `'${c.title}' (${c.url}) in Markpin speichern?`;
    case 'update_tags': return `Tags von ${quoteTitles(c.titles, 'de')} ändern? ${tagParts(c, 'Hinzufügen:', 'Entfernen:', '.')}`;
    case 'add_clip': return `Clip "${clip(c.text)}" zu '${c.title}' hinzufügen?`;
    case 'set_clip_note': return c.note ? `Clip-Notiz von '${c.title}' in "${clip(c.note)}" ändern?` : `Clip-Notiz von '${c.title}' löschen?`;
    case 'set_summary': return c.summary ? `Zusammenfassung von '${c.title}' in "${clip(c.summary)}" ändern?` : `Zusammenfassung von '${c.title}' löschen?`;
    case 'set_note': return c.note ? `Den Satz zu '${c.title}' in "${clip(c.note)}" ändern?` : `Den Satz zu '${c.title}' löschen?`;
    case 'delete_pages': return `${quoteTitles(c.titles, 'de')} löschen? (30 Tage lang wiederherstellbar)`;
    case 'restore_pages': return `${quoteTitles(c.titles, 'de')} wiederherstellen?`;
    case 'set_bookmark': return c.quote ? `Lesezeichen in '${c.title}' bei "${clip(c.quote)}" setzen?` : `Lesezeichen in '${c.title}' setzen?`;
    case 'clear_bookmark': return `Lesezeichen aus '${c.title}' entfernen?`;
    case 'mark_read': return `'${c.title}' als gelesen markieren?`;
    case 'mark_skimmed': return `'${c.title}' als überflogen markieren?`;
    case 'retag': return `Tags ändern? ${retagList(c.items, (f, t, n) => `'${f}' → '${t}' (${n} Seite${n === 1 ? '' : 'n'})`, (f, n) => `'${f}' entfernen (${n} Seite${n === 1 ? '' : 'n'})`)}.`;
  }
  const exhaustive: never = c;
  return exhaustive;
}

function fr(c: Change): string {
  switch (c.kind) {
    case 'save_page': return `Enregistrer '${c.title}' (${c.url}) dans Markpin ?`;
    case 'update_tags': return `Modifier les tags de ${quoteTitles(c.titles, 'fr')} ? ${tagParts(c, 'Ajouter :', 'Retirer :', '.')}`;
    case 'add_clip': return `Ajouter le clip « ${clip(c.text)} » à '${c.title}' ?`;
    case 'set_clip_note': return c.note ? `Remplacer la note du clip dans '${c.title}' par « ${clip(c.note)} » ?` : `Effacer la note du clip dans '${c.title}' ?`;
    case 'set_summary': return c.summary ? `Remplacer le résumé de '${c.title}' par « ${clip(c.summary)} » ?` : `Effacer le résumé de '${c.title}' ?`;
    case 'set_note': return c.note ? `Remplacer votre ligne pour '${c.title}' par « ${clip(c.note)} » ?` : `Effacer votre ligne pour '${c.title}' ?`;
    case 'delete_pages': return `Supprimer ${quoteTitles(c.titles, 'fr')} ? (restaurable pendant 30 jours)`;
    case 'restore_pages': return `Restaurer ${quoteTitles(c.titles, 'fr')} ?`;
    case 'set_bookmark': return c.quote ? `Placer un marque-page dans '${c.title}' : « ${clip(c.quote)} » ?` : `Placer un marque-page dans '${c.title}' ?`;
    case 'clear_bookmark': return `Retirer le marque-page de '${c.title}' ?`;
    case 'mark_read': return `Marquer '${c.title}' comme lu ?`;
    case 'mark_skimmed': return `Marquer '${c.title}' comme parcouru ?`;
    case 'retag': return `Modifier les tags ? ${retagList(c.items, (f, t, n) => `'${f}' → '${t}' (${n} page${n === 1 ? '' : 's'})`, (f, n) => `retirer '${f}' (${n} page${n === 1 ? '' : 's'})`)}.`;
  }
  const exhaustive: never = c;
  return exhaustive;
}

const RENDER: Record<Lang, (c: Change) => string> = { ko, en, ja, es, 'pt-BR': ptBR, de, fr };

export function confirmMessage(lang: Lang, c: Change): string {
  return RENDER[lang](c);
}

export type ConfirmLabel = { title: string; description: string; trust: { title: string; description: string } };

/** 확인 폼 라벨. `trust`는 「이 연결 동안 묻지 않기」 체크박스(0.10.0 §2.3) — 클라이언트 연결이 끝날 때까지만, 서버 재시작이면 다시 묻는다. */
const LABEL: Record<Lang, ConfirmLabel> = {
  ko: {
    title: '진행', description: '이 변경을 Markpin 폴더에 기록합니다.',
    trust: { title: '이 연결 동안 묻지 않기', description: '이 클라이언트 연결이 끝날 때까지 쓰기를 확인 없이 적용합니다. 클라이언트 자체의 권한 창은 그대로입니다.' }
  },
  en: {
    title: 'Proceed', description: 'Write this change to your Markpin folder.',
    trust: { title: "Don't ask again on this connection", description: "Apply writes without this confirmation until the client disconnects. The client's own permission prompts are unaffected." }
  },
  ja: {
    title: '実行', description: 'この変更をMarkpinフォルダに書き込みます。',
    trust: { title: 'この接続中は確認しない', description: 'クライアントの接続が終わるまで、書き込みをこの確認なしで適用します。クライアント自体の権限ダイアログはそのままです。' }
  },
  es: {
    title: 'Continuar', description: 'Este cambio se escribirá en tu carpeta de Markpin.',
    trust: { title: 'No volver a preguntar en esta conexión', description: 'Aplica las escrituras sin esta confirmación hasta que el cliente se desconecte. Los permisos propios del cliente no cambian.' }
  },
  'pt-BR': {
    title: 'Continuar', description: 'Esta alteração será gravada na sua pasta do Markpin.',
    trust: { title: 'Não perguntar de novo nesta conexão', description: 'Aplica as gravações sem esta confirmação até o cliente desconectar. As permissões do próprio cliente continuam iguais.' }
  },
  de: {
    title: 'Fortfahren', description: 'Diese Änderung wird in deinen Markpin-Ordner geschrieben.',
    trust: { title: 'Für diese Verbindung nicht mehr fragen', description: 'Schreibvorgänge werden ohne diese Bestätigung übernommen, bis der Client die Verbindung trennt. Die Berechtigungsabfragen des Clients selbst bleiben bestehen.' }
  },
  fr: {
    title: 'Continuer', description: 'Cette modification sera écrite dans votre dossier Markpin.',
    trust: { title: 'Ne plus demander pour cette connexion', description: "Les écritures sont appliquées sans cette confirmation jusqu'à la déconnexion du client. Les demandes d'autorisation du client lui-même restent inchangées." }
  }
};

/** batch 확인 문장 머리말(0.10.0 §2.2). 아래에 `1. …` 번호 목록이 붙는다. */
const BATCH_HEADER: Record<Lang, (n: number) => string> = {
  ko: (n) => `다음 ${n}개를 적용할까요?`,
  en: (n) => `Apply these ${n} changes?`,
  ja: (n) => `次の${n}件を適用しますか？`,
  es: (n) => `¿Aplicar estos ${n} cambios?`,
  'pt-BR': (n) => `Aplicar estas ${n} alterações?`,
  de: (n) => `Diese ${n} Änderungen anwenden?`,
  fr: (n) => `Appliquer ces ${n} modifications ?`
};

export function batchHeader(lang: Lang, n: number): string {
  return BATCH_HEADER[lang](n);
}

export function confirmLabel(lang: Lang): ConfirmLabel {
  return LABEL[lang];
}
