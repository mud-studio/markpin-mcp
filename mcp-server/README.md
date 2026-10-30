# @markpin/mcp

MCP server for a [Markpin](https://markpin.dev) folder. Markpin is a Chrome extension that saves web pages and clips as Markdown files in a folder you own — this server lets an AI client (Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI, VS Code, Windsurf, Zed, or any other MCP client) search and read those files, and optionally edit them with your confirmation.

- Read-only by default. Writes need `--allow-write` and a confirmation dialog for every change.
- Runs locally over stdio. Nothing leaves your computer.
- Watches the folder, so pages you save in the browser show up in the next query without a restart.

## Requirements

- Node.js 20.1 or newer (`node -v`).
- The Markpin Chrome extension with storage set to **Local folder** or **Google Drive**. With Google Drive you also need [Google Drive for Desktop](https://www.google.com/drive/download/) so the folder exists on disk.

## Run

```bash
npx -y @markpin/mcp --dir "<your Markpin folder>"
```

Options:

| Flag | Meaning |
|---|---|
| `--dir <path>` | Required. The Markpin folder (the one that contains `pages/`). `~` is expanded. |
| `--allow-write` | Registers the fourteen write tools. Without it the server is read-only. |
| `--lang ko\|en\|ja\|es\|pt-BR\|de\|fr` | Language of the confirmation dialog. Default: taken from your system locale (`pt*` → `pt-BR`), otherwise `en`. The Markpin extension's setup guide fills this in from your Chrome language. |

On success the server logs `serving N pages from <dir>` to stderr. stdout carries the MCP protocol, so all logs go to stderr — that line is the quickest way to check the path.

## Find your Markpin folder

The folder must contain a `pages/` directory. If it doesn't, the extension hasn't uploaded anything there yet — save a page in Chrome first.

**Local folder** — the folder you picked in Markpin settings.

- macOS: in Finder, right-click the folder, hold ⌥ Option, choose **Copy "…" as Pathname**.
- Windows: Shift + right-click the folder, choose **Copy as path** (remove the surrounding quotes).

**Google Drive** — Drive for Desktop mirrors your Drive to disk. The Markpin folder sits at the top of *My Drive*, whose name follows your Google account language — `My Drive` (en), `내 드라이브` (ko), `マイドライブ` (ja), `Mi unidad` (es), `Meu Drive` (pt-BR), `Meine Ablage` (de), `Mon Drive` (fr):

- macOS: `~/Library/CloudStorage/GoogleDrive-<your email>/My Drive/Markpin`
- Windows: `G:\My Drive\Markpin` (the drive letter can differ — check File Explorer)

The Markpin settings page in Chrome has an **MCP setup guide** button that fills these paths (and `--lang`) in for you.

## Register the server

Replace `<dir>` with your folder path. Add `--allow-write` at the end of the arguments if you want the write tools.

### Claude Code

```bash
claude mcp add -s user markpin -- npx -y @markpin/mcp --dir "<dir>"
```

`-s user` registers it for every project; drop the flag to keep it to the current directory only.

Then `claude mcp list` should show `markpin: … - ✓ Connected`.

### Claude Desktop

Edit the config file (Claude → Settings → Developer → Edit Config):

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

macOS:

```json
{
  "mcpServers": {
    "markpin": {
      "command": "npx",
      "args": ["-y", "@markpin/mcp", "--dir", "<dir>"]
    }
  }
}
```

Windows (Claude Desktop spawns without a shell, so `npx` needs `cmd /c`; escape backslashes in the path):

```json
{
  "mcpServers": {
    "markpin": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@markpin/mcp", "--dir", "G:\\My Drive\\Markpin"]
    }
  }
}
```

Restart Claude Desktop. The hammer/plug icon in the chat box lists the Markpin tools.

### Cursor

Add the same JSON to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project), then enable the server in Cursor Settings → MCP.

### Codex (CLI, IDE extension, ChatGPT desktop)

```bash
codex mcp add markpin -- npx -y @markpin/mcp --dir "/path/to/Markpin"
```

All three share `~/.codex/config.toml`. Check with `codex mcp list`.

### Gemini CLI

```bash
gemini mcp add markpin npx -- -y @markpin/mcp --dir "/path/to/Markpin"
```

Server flags go after `--` so Gemini doesn't read them as its own options. Saved to `~/.gemini/settings.json`; check with `gemini mcp list`.

### VS Code (Copilot agent mode)

`.vscode/mcp.json` in the project, or the user `mcp.json` opened by **MCP: Open User Configuration**. Note the key is `servers` and stdio needs `type`:

```json
{
  "servers": {
    "markpin": { "type": "stdio", "command": "npx", "args": ["-y", "@markpin/mcp", "--dir", "/path/to/Markpin"] }
  }
}
```

### Windsurf

Same JSON as Claude Desktop (`mcpServers`) in `~/.codeium/windsurf/mcp_config.json` (Windows: `%USERPROFILE%\.codeium\windsurf\mcp_config.json`), then refresh under Settings → MCP.

### Zed

`~/.config/zed/settings.json` (Windows: `%APPDATA%\Zed\settings.json`). The key is `context_servers`, hand-added servers need `source: "custom"`, and the command is nested:

```json
{
  "context_servers": {
    "markpin": { "source": "custom", "command": { "path": "npx", "args": ["-y", "@markpin/mcp", "--dir", "/path/to/Markpin"] } }
  }
}
```

### Any other MCP client

Anything that speaks MCP over stdio works. Paste the same command (`npx`) and args (`-y @markpin/mcp --dir …`) into that client's MCP settings. On Windows, clients that spawn without a shell need `cmd /c npx …` (see the Claude Desktop note above).

## File format

Each page is one Markdown file. The frontmatter holds only the human-facing keys (`title`, `url`, `savedAt`, `tags`, `summary`, `readAt`, `deletedAt`) so note apps such as Obsidian show a clean Properties panel. Everything Markpin needs internally (`id`, `rev`, `updatedAt`, clips with their anchors, bookmark) lives in a one-line JSON block at the very end of the file:

    <!-- markpin
    {"v":2,"id":"…","rev":3,"updatedAt":"…","domain":"…","clips":[…]}
    -->

Do not edit that block by hand. Files written before 0.7.0 (`markpin: 1` in the frontmatter) are still read; they are rewritten in the new shape the next time anything changes them.

## `markpin.json` (Markdown template)

The extension writes `markpin.json` at the folder root when you pick a Markdown template or turn on `.trash/` in its options. This server reads it on start and on every rescan, and renders the files it writes with the same template (`default` or `obsidian`, or a custom template string), so pages saved through MCP look like the ones saved from the browser. Only the body below the frontmatter changes; the frontmatter is always Markpin's own. Moving deleted files to `.trash/` is done by the extension, not by this server.

## Read-only vs. `--allow-write`

Without `--allow-write` the server exposes four read tools and cannot change any file. With it, fourteen write tools are added. Every write passes three gates:

1. **The flag.** You decided at registration time that writes are allowed at all.
2. **Client permission.** The tools are marked non-read-only (`delete_pages` as destructive), so clients such as Claude Code ask before each call.
3. **Your confirmation.** If the client supports MCP elicitation (Claude Code does), the server shows a dialog describing the exact change — for example *"Add tag frontend to 'React Docs'?"* — and writes only when you accept. The dialog also has a checkbox, *Don't ask again on this connection*: tick it with your confirmation and later writes on that connection (including `delete_pages`) are applied without the dialog and carry `"gate": "trusted"`; it resets when the client restarts, and the client's own permission prompts are unaffected. If the client cannot show that dialog, the result carries `"gate": "client"` so the assistant can tell you that the client's own prompt was the only confirmation.

When one request needs several writes — merging tags, clipping three passages — the assistant is told to use `retag` or `batch` so you confirm once with a numbered list instead of once per write.

The confirmation waits up to 10 minutes. A `save_page` fetch happens only after you accept, so a declined URL is never requested.

## Tools

Read (always):

| Tool | What it does |
|---|---|
| `search` | Full-text search over titles, content, clipped text, notes and tags. Empty query = most recent, optionally filtered by tags. `bookmarked: true` = only pages with a reading bookmark. |
| `get_page` | One page in full by id or URL: metadata, tags, summary, content, clips with notes and colors, bookmark, file path, image paths. |
| `list_recent` | Most recently updated pages. `bookmarked: true` = pages with a reading bookmark, newest bookmark first. |
| `list_tags` | Every tag with its page count. |

Write (`--allow-write`):

| Tool | What it does |
|---|---|
| `save_page` | Saves a URL as a new page (fetches and extracts the article unless you pass `content`). Takes an optional `summary` (one or two sentences) and `tags` — the assistant is asked to supply both whenever it has read the page, since Markpin's built-in AI only runs for pages saved from the browser. One page per URL — an existing page is returned unchanged. |
| `update_tags` | Adds and/or removes tags on one or more pages. |
| `retag` | Renames, merges or removes tags across every page in one confirmation: `changes: [{ from, to? }]`, applied in order; omit `to` to remove the tag. Matching ignores case. |
| `batch` | Runs up to 50 write tools (any except `batch`) in order after one confirmation that lists every change. Every op is validated and planned first; one bad op rejects the whole batch. Stops at the first failure and returns each op's result plus `completed`; an op that would change nothing is not run and comes back as `skipped: true`. Ops must reference pages that already exist. |
| `add_clip` | Adds a quoted text clip, with an optional note, highlight `color` (amber, green, blue, pink), reaction mark `kind` (question, insight, disagree, star) and `pen` shape (highlight, underline, wavy, double, strike, box, circle, lasso), to a page. |
| `set_clip_note` | Replaces the note on a clip (empty clears it). |
| `set_summary` | Replaces a page's summary (empty clears it). Handy for pages saved without one. |
| `set_note` | Sets the reader's own one-line note on a page (frontmatter `note`; empty clears it). |
| `mark_skimmed` | Marks a page as skimmed (`skimmedAt`); removes its bookmark and read mark. |
| `delete_pages` | Marks pages deleted. The Markpin extension keeps them for 30 days and can restore them; this server never deletes files. |
| `restore_pages` | Brings back pages deleted within the last 30 days. |
| `set_bookmark` | Puts the reading bookmark on a page — from the start, or at a `quote` from the content to resume there. Replaces any existing bookmark and clears the read mark. |
| `clear_bookmark` | Removes the bookmark without marking the page read. |
| `mark_read` | Marks a page as read and removes its bookmark. |

Every write returns a `note` and a `gate` field (`"elicitation"` when you confirmed in the dialog, `"trusted"` when you had ticked *Don't ask again on this connection*, `"client"` when only the client's prompt stood between the assistant and the write). `update_tags`, `retag`, `set_clip_note`, `set_summary` and `set_note` also return `before`/`after`; the others return the affected page(s). `batch` returns `{ results, completed, gate }`, where `results` lists each op in order as `{ tool, ok: true, result }`, `{ tool, ok: true, skipped: true }` or `{ tool, ok: false, error }` (nothing after a failed op), and `completed` counts the ops that ran and succeeded.

## Limits

- **Google Drive + new pages.** With Google Drive storage the extension can only read files it created itself (`drive.file` scope), so `save_page` writes new pages to `inbox.jsonl` in your Markpin folder and the extension turns them into page files on its next sync. The extension creates and manages that file — do not delete it. Edits to existing pages are written in place. With a local folder there is normally no inbox and everything is written directly; if an `inbox.jsonl` exists in the folder (for example a former Drive mirror), the server uses it the same way.
- **No region clips.** Image/area clips need the page DOM; the server adds text clips only.
- **Side panel delay.** While the side panel is open it polls every 15 seconds, so changes show up within about 30 seconds; when it is closed they show up the moment you open it. A full sync also runs every 5 minutes. With Google Drive, add the time Drive for Desktop needs to upload.
- **Concurrent edits.** If the extension wrote the same page after the server read it, the write is refused with *Page changed on disk since it was read; re-read it and try again*. Ask again.
- **Tombstones.** Deleted pages are only purged by the extension. A folder used by this server alone keeps them.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Not a directory: …` | Typo in `--dir`, or Drive for Desktop is not running / the folder is not mirrored. Open the path in Finder or Explorer first. |
| `serving 0 pages` | The folder has no `pages/` yet or it is empty. Save a page in Chrome; with Drive wait for the upload. |
| Client says the server failed to start | Run `node -v` (needs 20.1+). On Windows use the `cmd /c npx` form. Run the `npx` line in a terminal to see the error. |
| Pages saved just now don't appear | The server rescans about 300 ms after a file change. With Drive, the file appears when Drive for Desktop finishes syncing. |
| A page saved by the assistant is missing in the side panel | Keep the side panel open for about 30 seconds. With Google Drive, Drive for Desktop must be running so `inbox.jsonl` reaches Drive. |
| Pages are missing after updating the Chrome extension | Files are now written in format v2 (see *File format*). Servers before 0.7.0 skip them — run `npx -y @markpin/mcp@latest` or re-register with the current version. |
| Write tools missing | You registered without `--allow-write`. Re-register, then restart the client so it spawns the server again. |
| A page saved by the assistant has no summary or tags | The assistant saved it without reading the page. Ask it to write the summary and tags (`set_summary`, `update_tags`). |
| `Not an HTML page` / the server cannot fetch a URL | The site blocks bots or needs a login. Ask the assistant to read the page itself and pass `content` to `save_page`. |
| `User declined` / `No response to the confirmation` | You declined the dialog, or it timed out after 10 minutes. Nothing was written. |
| `ops[n]: …` from `batch` | Op number `n` (from 0) named an unknown tool, had bad arguments, or referred to a missing page or clip. The whole batch was rejected before asking you; nothing was written. |

## Development

```bash
yarn build:mcp                 # bundles to mcp-server/dist/index.js
node mcp-server/dist/index.js --dir "<dir>"
```

License MIT.
