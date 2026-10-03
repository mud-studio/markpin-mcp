/** stdout은 MCP 프로토콜 전용이므로 로그는 stderr로만 쓴다. */
export function log(...args: unknown[]): void {
  const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
  process.stderr.write(`[markpin-mcp] ${text}\n`);
}
