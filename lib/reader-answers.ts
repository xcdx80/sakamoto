/** Reader application module: authentication is handled by the caller; paid attempts are durable. */
import type { ChatMessage } from "./models";
import type { StreamEvent } from "./models";
import {
  lunaRequest,
  LUNA_MODEL,
  ProviderRejected,
  streamLuna,
  type LunaOptions,
} from "./openai";
import {
  reservePaidWork,
  settlePaidWork,
  releaseRejectedPaidWork,
  markPaidWorkUncertain,
  recordPaidResponse,
  recordPaidFailure,
} from "./paid-work";
export async function prepareReaderAttempt(
  owner: string,
  operationId: string,
  attemptId: string,
  messages: ChatMessage[],
  maxTokens: number,
  extra: LunaOptions = {},
) {
  const body = lunaRequest(messages, maxTokens, extra);
  const reservation = await reservePaidWork({
    owner,
    operationId,
    attemptId,
    model: LUNA_MODEL,
    serializedInput: JSON.stringify(body),
    maxOutputTokens: maxTokens,
  });
  return { body, reservation };
}
export async function* runReaderAttempt(
  prepared: Awaited<ReturnType<typeof prepareReaderAttempt>>,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  // Authorization may have waited on the budget row. No transport has started yet.
  if (signal.aborted) {
    await releaseRejectedPaidWork(prepared.reservation);
    signal.throwIfAborted();
  }
  let finalized = false;
  try {
    let receipt: Extract<StreamEvent, { type: "usage" }> | undefined;
    for await (const event of streamLuna(prepared.body, signal, (requestId) =>
      recordPaidResponse(prepared.reservation, requestId),
    )) {
      if (event.type === "usage") receipt = event;
      else if (event.type === "done") {
        if (!receipt) throw new Error("Usage receipt missing.");
        await settlePaidWork(
          prepared.reservation,
          Math.round(receipt.usage.costUsd * 1e6),
        );
        finalized = true;
        yield receipt;
        yield event;
      } else yield event;
    }
  } catch (error) {
    if (error instanceof ProviderRejected) {
      await releaseRejectedPaidWork(prepared.reservation);
      finalized = true;
    }
    if (!(error instanceof ProviderRejected))
      await recordPaidFailure(prepared.reservation, error);
    throw error;
  } finally {
    if (!finalized) await markPaidWorkUncertain(prepared.reservation);
  }
}
