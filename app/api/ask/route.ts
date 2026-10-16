import { ACTIONS } from "@/lib/actions";
import {
  buildMessages,
  isLengthKey,
  webBlock,
  type DocPayload,
  type ThreadPayload,
} from "@/lib/prompts";
import type { ChatMessage } from "@/lib/together";
import type { StreamEvent, Usage } from "@/lib/models";
import { requestOwner } from "@/lib/owner";
import {
  paidFailure,
  PaidWorkError,
  reservePaidWork,
  markPaidWorkUncertain,
  settlePaidWork,
  recordPaidResponse,
} from "@/lib/paid-work";
import { prepareReaderAttempt, runReaderAttempt } from "@/lib/reader-answers";
import { searchEnabled, searchQuery, WEB_TOOL, webSearch } from "@/lib/search";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(req: Request) {
  let owner: string | null;
  try {
    owner = await requestOwner(req);
  } catch {
    return Response.json(
      { error: "Sign in to ask about saved text." },
      { status: 401 },
    );
  }
  if (!owner)
    return Response.json(
      { error: "Sign in to ask about saved text." },
      { status: 401 },
    );
  try {
    const body = (await req.json()) as {
      doc?: DocPayload;
      thread?: ThreadPayload;
      history?: { role: "user" | "assistant"; content: string }[];
      length?: string;
      search?: boolean;
    };
    const { doc, thread } = body;
    if (
      !doc?.title ||
      typeof doc.title !== "string" ||
      !Array.isArray(doc.paras) ||
      !doc.paras.length ||
      !doc.paras.every(
        (p) =>
          p && Number.isInteger(p.n) && p.n > 0 && typeof p.text === "string",
      ) ||
      !thread ||
      !Object.hasOwn(ACTIONS, thread.action)
    )
      return Response.json(
        { error: "doc and thread are required." },
        { status: 400 },
      );
    if (
      (thread.quote?.length ?? 0) > 12000 ||
      (thread.question?.length ?? 0) > 4000
    )
      return Response.json(
        { error: "That selection or question is too long." },
        { status: 413 },
      );
    if (
      body.history &&
      (!Array.isArray(body.history) ||
        body.history.length > 12 ||
        !body.history.every(
          (m) =>
            m &&
            ["user", "assistant"].includes(m.role) &&
            typeof m.content === "string",
        ))
    )
      return Response.json(
        { error: "Conversation history is invalid or too long." },
        { status: 413 },
      );
    const history = body.history ?? [],
      operationId = req.headers.get("idempotency-key") || crypto.randomUUID();
    const useSearch = searchEnabled() && body.search !== false,
      forced = thread.action === "check" && useSearch,
      offerTool = useSearch && !forced;
    if (useSearch && !process.env.SAKAMOTO_EXA_MAX_USD)
      throw new PaidWorkError(
        "configuration",
        "Web search is paused until its maximum price is configured. Turn off web lookup to answer from saved text.",
      );
    const messages = buildMessages(
      doc,
      thread,
      history,
      isLengthKey(body.length) ? body.length : "normal",
      undefined,
      offerTool,
    );
    const maxTokens = body.length === "long" ? 1400 : 900;
    // Authorize before returning a streaming response; normal paused results use HTTP status codes.
    const initial = await prepareReaderAttempt(
      owner,
      operationId,
      "answer-1",
      messages,
      maxTokens,
      offerTool ? { tools: [WEB_TOOL], tool_choice: "auto" } : {},
    );
    const encoder = new TextEncoder(),
      encode = (e: StreamEvent) =>
        encoder.encode(`data: ${JSON.stringify(e)}\n\n`);
    const stream = new ReadableStream({
      async start(controller) {
        let usage: Usage | undefined;
        const send = (event: StreamEvent) => controller.enqueue(encode(event));
        const search = async (query: string) => {
          const reservation = await reservePaidWork({
            owner: owner!,
            operationId,
            attemptId: "web-search",
            model: "exa-instant",
            serializedInput: JSON.stringify({ query }),
            maxOutputTokens: 0,
          });
          try {
            send({ type: "searching" });
            const found = await webSearch(query, req.signal);
            if (!found) {
              await markPaidWorkUncertain(reservation);
              return null;
            }
            await recordPaidResponse(reservation, found.providerRequestId);
            if (found.billing.kind === "reported")
              await settlePaidWork(reservation, found.billing.costMicros);
            else await markPaidWorkUncertain(reservation);
            send({ type: "sources", sources: found.sources });
            return found;
          } catch (error) {
            await markPaidWorkUncertain(reservation);
            throw error;
          }
        };
        const relay = async (
          prepared: Awaited<ReturnType<typeof prepareReaderAttempt>>,
        ) => {
          let call: Extract<StreamEvent, { type: "tool" }> | undefined;
          for await (const event of runReaderAttempt(prepared, req.signal)) {
            if (event.type === "tool") call = event;
            else if (event.type === "usage")
              usage = usage
                ? {
                    promptTokens: usage.promptTokens + event.usage.promptTokens,
                    cachedTokens: usage.cachedTokens + event.usage.cachedTokens,
                    completionTokens:
                      usage.completionTokens + event.usage.completionTokens,
                    costUsd: usage.costUsd + event.usage.costUsd,
                  }
                : event.usage;
            else if (event.type !== "done") send(event);
          }
          return call;
        };
        try {
          let call;
          if (forced) {
            // Keep the first reservation conservative when a forced lookup changes the full prompt.
            const found = await search(
              searchQuery(thread, history.at(-1)?.content),
            );
            initial.body.messages = buildMessages(
              doc,
              thread,
              history,
              isLengthKey(body.length) ? body.length : "normal",
              found ? webBlock(found.sources, found.excerpts) : undefined,
            );
            // Validate the actual serialized body against the same envelope before dispatch.
            if (
              Buffer.byteLength(JSON.stringify(initial.body), "utf8") + 4096 >
              262144
            )
              throw new PaidWorkError(
                "input_too_large",
                "The complete prompt is too large.",
                413,
              );
          }
          call = await relay(initial);
          if (call) {
            send({ type: "reset" });
            const args = JSON.parse(call.args);
            if (typeof args.query !== "string" || args.query.length > 500)
              throw new PaidWorkError(
                "invalid_response",
                "The search query was invalid.",
                502,
              );
            const found = await search(args.query);
            const follow: ChatMessage[] = [
              ...messages,
              {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: call.id,
                    type: "function",
                    function: { name: call.name, arguments: call.args },
                  },
                ],
              },
              {
                role: "tool",
                tool_call_id: call.id,
                content: found
                  ? webBlock(found.sources, found.excerpts)
                  : "Web lookup unavailable. Answer from saved text and say what could not be checked.",
              },
            ];
            await relay(
              await prepareReaderAttempt(
                owner!,
                operationId,
                "answer-2",
                follow,
                maxTokens,
                { tools: [WEB_TOOL], tool_choice: "none" },
              ),
            );
          }
          if (usage) send({ type: "usage", usage });
          send({ type: "done" });
        } catch (error) {
          await markPaidWorkUncertain(initial.reservation).catch(() => {});
          send({
            type: "error",
            text:
              error instanceof PaidWorkError
                ? error.message
                : "Answer could not complete. Potentially billed usage remains reserved; check processing usage before intentionally retrying.",
          });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json({ error: "Body must be JSON." }, { status: 400 });
    return paidFailure(error);
  }
}
