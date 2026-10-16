import { requestOwner } from "@/lib/owner";
import { searchEvidence, searchOptions } from "@/lib/retrieval";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const owner = await requestOwner(req);
  if (!owner)
    return Response.json(
      { error: "Sign in to search your library." },
      { status: 401 },
    );
  let options;
  try {
    options = searchOptions(await req.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid search." },
      { status: 400 },
    );
  }
  try {
    return Response.json(await searchEvidence(owner, options), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json(
      { error: "Library search is unavailable." },
      { status: 503 },
    );
  }
}
