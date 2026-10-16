import { requestOwner } from "@/lib/owner";
import { answerOptions, askLibrary } from "@/lib/library-answer";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: Request) {
  let owner: string | null;
  try {
    owner = await requestOwner(req);
  } catch {
    owner = null;
  }
  if (!owner)
    return Response.json(
      { error: "Sign in to ask your library." },
      { status: 401 },
    );
  let options;
  try {
    const reader = req.body?.getReader();
    if (!reader) throw new Error("Send a JSON question.");
    let text = "",
      bytes = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 32768) {
          await reader.cancel();
          return Response.json(
            { error: "Library question request is too large." },
            { status: 413 },
          );
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    options = answerOptions(JSON.parse(text));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Invalid library question.",
      },
      { status: 400 },
    );
  }
  try {
    return Response.json(await askLibrary(owner, options, req.signal), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json(
      {
        error:
          "Library evidence is unavailable. Your saved reading remains intact.",
      },
      { status: 503 },
    );
  }
}
