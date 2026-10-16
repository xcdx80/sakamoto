/** Validated OpenAI transport. Billing orchestration stays above this adapter. */
import type { ChatMessage } from "./models";
import type { StreamEvent, Usage } from "./models";
import { PaidWorkError, PaidBoundExceeded, usageMicros } from "./paid-work";
export const LUNA_MODEL = "gpt-6-luna";
export class ProviderRejected extends PaidWorkError {
  constructor(message: string) {
    super("provider_rejected", message, 502);
  }
}
export function openAIConfiguration() {
  if (!process.env.OPENAI_API_KEY?.trim())
    throw new PaidWorkError(
      "configuration",
      "Answers are paused: the server OpenAI key is missing. Saved reading remains available.",
    );
  if (
    process.env.OPENAI_ANSWER_MODEL &&
    process.env.OPENAI_ANSWER_MODEL !== LUNA_MODEL
  )
    throw new PaidWorkError(
      "configuration",
      "Answers are paused: the configured model has no verified Luna contract.",
    );
}
export type LunaOptions = {
  tools?: readonly unknown[];
  tool_choice?: "auto" | "none";
  response_format?: unknown;
};
export function lunaRequest(
  messages: ChatMessage[],
  maxOutputTokens: number,
  extra: LunaOptions = {},
) {
  openAIConfiguration();
  return {
    ...extra,
    model: LUNA_MODEL,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_completion_tokens: maxOutputTokens,
    reasoning_effort: "none",
    service_tier: "default",
    store: false,
    prompt_cache_options: { mode: "explicit" },
  };
}
function usageFrom(raw: any, maxOutput: number): Usage {
  if (
    !raw ||
    !Number.isSafeInteger(raw.prompt_tokens) ||
    !Number.isSafeInteger(raw.completion_tokens)
  )
    throw new PaidWorkError(
      "provider_error",
      "OpenAI did not report complete usage. Its reservation is retained.",
    );
  const input = raw.prompt_tokens,
    output = raw.completion_tokens,
    cached = raw.prompt_tokens_details?.cached_tokens ?? 0,
    writes = raw.prompt_tokens_details?.cache_write_tokens ?? 0;
  const paidUsage = {
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: cached,
    cacheWriteTokens: writes,
  };
  const micros = usageMicros(LUNA_MODEL, paidUsage);
  if (output > maxOutput) throw new PaidBoundExceeded(paidUsage);
  return {
    promptTokens: input,
    completionTokens: output,
    cachedTokens: cached,
    costUsd: micros / 1e6,
  };
}
export async function* streamLuna(
  body: ReturnType<typeof lunaRequest>,
  signal: AbortSignal,
  received?: (requestId: string | null) => Promise<void>,
): AsyncGenerator<StreamEvent> {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + process.env.OPENAI_API_KEY!.trim(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(110000)]),
    });
  } catch {
    throw new PaidWorkError(
      "provider_error",
      "OpenAI connection interrupted. Potentially billed usage remains reserved; check processing budget before retrying.",
    );
  }
  await received?.(response.headers.get("x-request-id"));
  if (!response.ok) {
    // Do not echo upstream messages: they can contain submitted text or credentials.
    const msg =
      response.status === 401 || response.status === 403
        ? "OpenAI rejected the server credentials or model access."
        : response.status === 429
          ? "OpenAI is rate limited or has no available credit. Check account limits before retrying."
          : "OpenAI could not complete this request.";
    if ([400, 401, 403, 404, 413, 422, 429].includes(response.status))
      throw new ProviderRejected(msg);
    throw new PaidWorkError(
      "provider_error",
      msg + " Potentially billed usage remains reserved.",
    );
  }
  if (!response.body)
    throw new PaidWorkError(
      "provider_error",
      "OpenAI returned an empty stream; usage remains reserved.",
    );
  yield { type: "meta", model: "OpenAI Luna" };
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    receipt: Usage | undefined,
    finish: string | undefined,
    sawContent = false,
    done = false;
  const calls = new Map<number, { id: string; name: string; args: string }>();
  try {
    while (true) {
      const read = await reader.read();
      if (read.done) break;
      buffer = (buffer + decoder.decode(read.value, { stream: true })).replace(
        /\r\n/g,
        "\n",
      );
      if (buffer.length > 1_000_000)
        throw new PaidWorkError(
          "provider_error",
          "OpenAI stream frame was too large.",
        );
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            done = true;
            break;
          }
          let chunk;
          try {
            chunk = JSON.parse(payload);
          } catch {
            throw new PaidWorkError(
              "provider_error",
              "OpenAI returned malformed streaming data. Usage remains reserved.",
            );
          }
          if (chunk.error)
            throw new PaidWorkError(
              "provider_error",
              "OpenAI interrupted the answer. Usage remains reserved.",
            );
          if (chunk.usage) {
            if (receipt)
              throw new PaidWorkError(
                "provider_error",
                "OpenAI returned duplicate usage. Usage remains reserved.",
              );
            receipt = usageFrom(chunk.usage, body.max_completion_tokens);
          }
          const choice = chunk.choices?.[0];
          if (choice?.finish_reason) finish = choice.finish_reason;
          const delta = choice?.delta;
          if (delta?.refusal)
            throw new PaidWorkError(
              "provider_error",
              "OpenAI declined this request.",
            );
          if (delta?.content !== undefined && delta.content !== null) {
            if (typeof delta.content !== "string")
              throw new PaidWorkError(
                "provider_error",
                "OpenAI returned invalid content.",
              );
            sawContent ||= Boolean(delta.content);
            yield { type: "content", text: delta.content };
          }
          for (const fragment of delta?.tool_calls ?? []) {
            if (
              !Number.isInteger(fragment.index) ||
              fragment.index < 0 ||
              fragment.index > 3
            )
              throw new PaidWorkError(
                "provider_error",
                "Invalid OpenAI tool call.",
              );
            const call = calls.get(fragment.index) ?? {
              id: "",
              name: "",
              args: "",
            };
            if (fragment.id) call.id += fragment.id;
            if (fragment.function?.name) call.name += fragment.function.name;
            if (fragment.function?.arguments)
              call.args += fragment.function.arguments;
            if (call.args.length > 12000)
              throw new PaidWorkError(
                "provider_error",
                "OpenAI tool arguments were too large.",
              );
            calls.set(fragment.index, call);
          }
        }
        if (done) break;
      }
      if (done) break;
    }
    if (!done || !receipt || !["stop", "tool_calls"].includes(finish ?? ""))
      throw new PaidWorkError(
        "provider_error",
        "OpenAI did not finish with validated usage. Potentially billed usage remains reserved.",
      );
    yield { type: "usage", usage: receipt };
    if (finish === "tool_calls") {
      const call = calls.get(0);
      if (calls.size !== 1 || !call?.id || call.name !== "web_search")
        throw new PaidWorkError(
          "provider_error",
          "OpenAI requested an unsupported tool.",
        );
      yield { type: "tool", ...call };
    } else if (!sawContent || calls.size)
      throw new PaidWorkError(
        "provider_error",
        "OpenAI returned no complete answer.",
      );
    yield { type: "done" };
  } finally {
    await reader.cancel().catch(() => {});
  }
}
