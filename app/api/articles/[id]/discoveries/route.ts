import { requestOwner } from "@/lib/owner";
import { readLinkedDiscoveries } from "@/lib/processing";
export const runtime = "nodejs";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const owner = await requestOwner(req);
  if (!owner)
    return Response.json(
      { error: "Sign in to read linked-source discoveries." },
      { status: 401 },
    );
  return Response.json(
    await readLinkedDiscoveries(
      owner,
      (await params).id,
      new URL(req.url).searchParams.get("after") ?? "",
    ),
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
