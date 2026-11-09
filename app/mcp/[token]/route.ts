import { handle, notAllowed, options } from "@/lib/mcp";

export const runtime = "nodejs";
// Match the writing desk: a bounded foreground stage plus time to persist its result.
export const maxDuration = 300;

/** The Sakamoto MCP server, with the token in the URL, for clients that only take a URL (claude.ai). Remove once OAuth lands (#4): URLs end up in logs. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return handle(req, (await params).token);
}
export const GET = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = options;
