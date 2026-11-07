/** Persist classifications, never arbitrary exception messages, URLs, headers or payloads. */
export type PaidFailureContext = {
  phase: "awaiting_response" | "reading_response" | "settling";
  elapsedMs: number;
  aborted: boolean;
};
const ERROR_NAMES = new Set(["Error", "TypeError", "SyntaxError", "AbortError", "TimeoutError"]);
const TRANSPORT_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EPIPE", "EPERM", "EACCES",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_ABORTED",
]);
export function paidFailureDetails(error: unknown, context?: PaidFailureContext) {
  const details: { errorName: string; transportCode?: string; phase?: PaidFailureContext["phase"]; elapsedMs?: number; aborted?: boolean } = {
    errorName: error instanceof Error && ERROR_NAMES.has(error.name) ? error.name : "Error",
  };
  let cause = error;
  for (let depth = 0; depth < 4 && cause && typeof cause === "object"; depth++) {
    const item = cause as { code?: unknown; cause?: unknown };
    if (typeof item.code === "string" && TRANSPORT_CODES.has(item.code)) { details.transportCode = item.code; break; }
    cause = item.cause;
  }
  if (context) {
    details.phase = context.phase;
    if (Number.isFinite(context.elapsedMs)) details.elapsedMs = Math.max(0, Math.round(context.elapsedMs));
    details.aborted = context.aborted;
  }
  return details;
}
