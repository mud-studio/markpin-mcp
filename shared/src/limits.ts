/** 클립 text 최대 글자 수. frontmatter(clips)가 512KB 파일 상한을 밀어내지 않게 한다. */
export const MAX_CLIP_TEXT_CHARS = 10_000;

/** region 클립 html(Markdown 변환본) 최대 글자 수. frontmatter와 ## Clips에 두 번 실리므로 text보다 넉넉하되 상한을 둔다. */
export const MAX_CLIP_HTML_CHARS = 20_000;

/** mutatePage/addClip이 파일 상한 초과로 거부할 때의 에러 메시지. content·사이드패널이 그대로 보여준다. */
export const FILE_LIMIT_MESSAGE = '페이지 용량 한도를 초과했습니다';
