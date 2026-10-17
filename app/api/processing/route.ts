import { requestOwner } from "@/lib/owner";
import { processingStatus, processLibrary } from "@/lib/processing";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(req: Request) {
  const owner = await requestOwner(req);
  if (!owner)
    return Response.json(
      { error: "Sign in to view processing." },
      { status: 401 },
    );
  const url = new URL(req.url);
  return Response.json(
    await processingStatus(owner, {
      after: url.searchParams.get("after") ?? undefined,
      sourceId: url.searchParams.get("sourceId") ?? undefined,
    }),
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(req: Request) {
  const owner = await requestOwner(req);
  if (!owner)
    return Response.json(
      { error: "Sign in to process received material." },
      { status: 401 },
    );
  try {
    const reader = req.body?.getReader();
    let text = "";
    if (reader)
      try {
        let bytes = 0;
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 4096) {
            await reader.cancel();
            return Response.json(
              { error: "Processing request too large." },
              { status: 413 },
            );
          }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        reader.releaseLock();
      }
    const args = JSON.parse(text || "{}");
    if (
      !args ||
      typeof args !== "object" ||
      Array.isArray(args) ||
      Object.keys(args).some((k) => !["limit", "retryJobId"].includes(k)) ||
      (args.limit !== undefined &&
        (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 48)) ||
      (args.retryJobId !== undefined &&
        (typeof args.retryJobId !== "string" || !/^\d+$/.test(args.retryJobId)))
    )
      return Response.json(
        { error: "Invalid processing request." },
        { status: 400 },
      );
    return Response.json(await processLibrary(owner, args));
  } catch {
    return Response.json(
      {
        error: "Processing could not complete; accepted work remains durable.",
      },
      { status: 400 },
    );
  }
}
