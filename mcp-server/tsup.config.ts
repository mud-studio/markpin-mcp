import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  clean: true,
  // shared는 TS 소스로만 존재하므로 인라인. minisearch·yaml은 shared의 의존이라 함께 인라인.
  noExternal: ['@markpin/shared', 'minisearch', 'yaml'],
  // yaml의 인라인된 CJS 코드가 require('process')를 쓰므로, ESM 번들에서 require를 만들어준다.
  banner: { js: '#!/usr/bin/env node\nimport { createRequire } from "node:module"; const require = createRequire(import.meta.url);' }
});
