import { requestOwner } from "@/lib/owner";
import { scheduleClassification } from "@/lib/classification";
export const runtime = "nodejs";
/** Only durable saved sources, never caller-supplied arbitrary paid text. */
export async function POST(req: Request) {
  const owner = await requestOwner(req);
  if (!owner)
    return Response.json(
      { error: "Sign in to categorize saved sources." },
      { status: 401 },
    );
  try {
    if (Number(req.headers.get("content-length")) > 4096)
      return Response.json({ error: "Request too large." }, { status: 413 });
    const text = await req.text();
    if (Buffer.byteLength(text) > 4096)
      return Response.json({ error: "Request too large." }, { status: 413 });
    const args = JSON.parse(text);
    if (
      !args ||
      Array.isArray(args) ||
      Object.keys(args).some((k) => !["itemId", "reclassify"].includes(k))
    )
      throw new Error("Invalid categorization request.");
    return Response.json(await scheduleClassification(owner, args));
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof Error ? e.message : "Could not schedule categorization.",
      },
      { status: 400 },
    );
  }
}
