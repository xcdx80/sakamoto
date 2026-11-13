import { handle, notAllowed, options } from "@/lib/mcp";

export const runtime = "nodejs";
// Match the writing desk: a bounded foreground stage plus time to persist its result.
export const maxDuration = 300;

/** The InView MCP server. The token comes in the Authorization header. */
export const POST = (req: Request) => handle(req);
export const GET = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = options;
