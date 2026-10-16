import { BRIEF_TASK, systemFor, type DocPayload } from "@/lib/prompts";
import { requestOwner } from "@/lib/owner";
import { paidFailure } from "@/lib/paid-work";
import { prepareReaderAttempt, runReaderAttempt } from "@/lib/reader-answers";
import { BRIEF_SCHEMA, readBrief } from "@/lib/reader-brief";
import type { Usage } from "@/lib/models";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(req: Request) {
  let owner: string | null;
  try {
    owner = await requestOwner(req);
  } catch {
    return Response.json(
      { error: "Sign in to summarize saved text." },
      { status: 401 },
    );
  }
  if (!owner)
    return Response.json(
      { error: "Sign in to summarize saved text." },
      { status: 401 },
    );
  try {
    const { doc } = (await req.json()) as { doc?: DocPayload };
    if (
      !doc?.title ||
      typeof doc.title !== "string" ||
      !Array.isArray(doc.paras) ||
      !doc.paras.length ||
      !doc.paras.every(
        (p) =>
          p && Number.isInteger(p.n) && p.n > 0 && typeof p.text === "string",
      )
    )
      return Response.json({ error: "doc is required." }, { status: 400 });
    const operationId =
      req.headers.get("idempotency-key") || crypto.randomUUID();
    const prepared = await prepareReaderAttempt(
      owner,
      operationId,
      "summary-1",
      [
        { role: "system", content: systemFor(doc) },
        { role: "user", content: BRIEF_TASK },
      ],
      16000,
      { response_format: BRIEF_SCHEMA },
    );
    let raw = "",
      usage: Usage | undefined;
    for await (const event of runReaderAttempt(prepared, req.signal)) {
      if (event.type === "content") raw += event.text;
      else if (event.type === "usage") usage = event.usage;
      else if (event.type === "tool")
        throw new Error("The summary requested an unsupported tool.");
    }
    return Response.json({ brief: readBrief(raw, doc), usage, model: "luna" });
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json({ error: "Body must be JSON." }, { status: 400 });
    return paidFailure(error);
  }
}
