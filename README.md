# Markpin MCP server

Source of [`@markpin/mcp`](https://www.npmjs.com/package/@markpin/mcp) 0.9.0: an MCP server that lets Claude, Cursor and other AI clients search and read the web pages and highlights you saved with [Markpin](https://markpin.dev), a Chrome extension that keeps them as Markdown files in a folder you own.

Usage and setup: [mcp-server/README.md](mcp-server/README.md).

- `mcp-server/` — the server (stdio, read-only unless `--allow-write`).
- `shared/` — the Markpin file format (parse/serialize), also used by the extension. Bundled into the npm package.
- `glama.json`, `glama/Dockerfile` — for the [Glama](https://glama.ai/mcp/servers) directory only.

This repository is published from Markpin's main repository on every release, so pull requests are applied there by hand. Issues are welcome here.

```bash
yarn install && yarn build && yarn test
```

MIT License.
