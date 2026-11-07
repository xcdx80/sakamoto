import { sessionOwner } from "@/lib/owner";
import { writeHttp } from "@/lib/post-production/http";

export const runtime = "nodejs";
// The bounded foreground stage gets four minutes; leave time to persist its result.
export const maxDuration = 300;
async function handle(req: Request) {
  let owner: string | null = null;
  try { owner = await sessionOwner(req); } catch { /* Authentication unavailable remains signed out. */ }
  return writeHttp(req, owner);
}
export const GET = handle;
export const POST = handle;
