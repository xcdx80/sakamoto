import { requestOwner } from "@/lib/owner";
import { articleDoc } from "@/lib/db";

export const runtime = "nodejs";

/** One imported text from the reader's account, for a device that has the shelf entry but not the text. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requestOwner(req);
  if (!userId) return Response.json({ error: "Sign in to sync." }, { status: 401 });
  const revision = Number(new URL(req.url).searchParams.get("revision")) || undefined;
  const doc = await articleDoc(userId, (await params).id, revision);
  if (!doc) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ doc }, { headers: { "Cache-Control": "private, no-store" } });
}
