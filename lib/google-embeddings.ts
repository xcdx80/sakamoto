import {
  PaidWorkError,
  reservePaidWork,
  recordPaidResponse,
  settlePaidWork,
  releaseRejectedPaidWork,
  recordPaidFailure,
  markPaidWorkUncertain,
  usageMicros,
} from "./paid-work";
import { EMBEDDING_CONTRACT } from "./retrieval-contract";
/** One independently billed text per call. Multiple parts would aggregate into a single vector. */
export async function embedText(
  owner: string,
  text: string,
  operationId: string,
  signal?: AbortSignal,
): Promise<number[]> {
  signal?.throwIfAborted();
  if (
    (process.env.GOOGLE_EMBEDDING_MODEL &&
      process.env.GOOGLE_EMBEDDING_MODEL !== EMBEDDING_CONTRACT.model) ||
    (process.env.GOOGLE_EMBEDDING_DIMENSIONS &&
      process.env.GOOGLE_EMBEDDING_DIMENSIONS !==
        String(EMBEDDING_CONTRACT.dimensions))
  )
    throw new PaidWorkError(
      "configuration",
      "Semantic search is paused: the configured model or dimensions require a compatible index migration.",
    );
  const key = process.env.GOOGLE_API_KEY;
  if (!key)
    throw new PaidWorkError(
      "configuration",
      "Semantic search is paused: Google credentials are unavailable.",
    );
  const body = JSON.stringify({
    content: { parts: [{ text }] },
    outputDimensionality: EMBEDDING_CONTRACT.dimensions,
  });
  const reservation = await reservePaidWork({
    owner,
    operationId,
    attemptId: crypto.randomUUID(),
    model: EMBEDDING_CONTRACT.model,
    serializedInput: body,
    maxOutputTokens: 0,
  });
  // Cancellation while durable authorization waited is known to precede dispatch.
  if (signal?.aborted) {
    await releaseRejectedPaidWork(reservation);
    signal.throwIfAborted();
  }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_CONTRACT.model}:embedContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
          : AbortSignal.timeout(10000),
      },
    );
    await recordPaidResponse(reservation, res.headers.get("x-request-id"));
    if (!res.ok) {
      await res.body?.cancel();
      if ([400, 401, 403, 404, 413, 415, 422].includes(res.status)) {
        await releaseRejectedPaidWork(reservation);
        throw new RejectedEmbedding();
      }
      throw new PaidWorkError(
        "provider_error",
        "Google embedding work is temporarily unavailable. Retry processing later.",
      );
    }
    // A bounded body prevents a malformed provider from retaining unbounded source/job memory.
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Empty embedding response");
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 100000) {
          await reader.cancel();
          throw new Error("Oversized embedding response");
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const tokens = data.usageMetadata?.promptTokenCount;
    if (tokens === undefined) await markPaidWorkUncertain(reservation);
    else
      await settlePaidWork(
        reservation,
        usageMicros(EMBEDDING_CONTRACT.model, {
          inputTokens: tokens,
          outputTokens: 0,
        }),
      );
    const vector = data.embedding?.values;
    if (
      !Array.isArray(vector) ||
      vector.length !== EMBEDDING_CONTRACT.dimensions ||
      vector.some((x) => typeof x !== "number" || !Number.isFinite(x)) ||
      !vector.some((x) => x !== 0)
    )
      throw new PaidWorkError(
        "invalid_response",
        "Google returned an invalid embedding.",
      );
    return vector;
  } catch (error) {
    if (error instanceof RejectedEmbedding)
      throw new PaidWorkError(
        "provider_rejected",
        "Google rejected this embedding request. Check credentials/model access before retrying.",
      );
    await recordPaidFailure(reservation, error);
    throw error;
  }
}
class RejectedEmbedding extends Error {}
