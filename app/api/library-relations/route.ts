import { requestOwner } from "@/lib/owner";
import { readLibraryRelations } from "@/lib/library-relations";

export const runtime = "nodejs";
export async function GET(req: Request) {
  const owner = await requestOwner(req);
  if (!owner) return Response.json({ error: "Sign in to read saved connections." }, { status: 401 });
  const query = new URL(req.url).searchParams;
  try {
    return Response.json(await readLibraryRelations(owner, query.get("itemId") ?? undefined, query.get("after") ?? undefined), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Could not load saved connections. Refresh to retry." }, { status: 400 });
  }
}
