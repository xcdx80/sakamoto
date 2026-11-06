import type { ProductionEvidence } from "./types";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020";
import {
  PaidWorkError, assertPostOperationResolved, reservePaidWork, recordPaidResponse,
  settlePaidWork, releaseRejectedPaidWork, recordPaidFailure,
} from "../paid-work";

export type ProductionWebResearch = {
  evidence: ProductionEvidence[];
  web: "searched" | "unconfigured";
  notice: string | null;
};

/** Only the public topic belongs in query; never pass private author notes. */
export async function researchProductionWeb(
  owner: string, operationId: string, query: string, signal?: AbortSignal,
): Promise<ProductionWebResearch> {
  const provider = process.env.SAKAMOTO_POST_RESEARCH_PROVIDER?.trim() || "monid-octen";
  if (provider !== "monid-octen") throw new PaidWorkError("configuration", "Write web research needs a supported explicitly selected provider: monid-octen.");
  const key = process.env.MONID_API_KEY?.trim();
  if (!key) return { evidence: [], web: "unconfigured", notice: "Web research is not configured. Add the server's Monid key and a bounded search price to enable it." };
  const ceiling = process.env.SAKAMOTO_MONID_MAX_USD;
  if (!ceiling || !/^\d+(\.\d{1,6})?$/.test(ceiling) || Number(ceiling) <= 0 || !Number.isSafeInteger(Math.ceil(Number(ceiling) * 1e6))) {
    throw new PaidWorkError("configuration", "Monid research is paused: configure its maximum USD charge per search.");
  }
  const input = { query: query.trim().slice(0, 500), count: 5, full_content: { enable: false } };
  if (!input.query) throw new PaidWorkError("configuration", "A public topic is required for web research.");
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
  const options = {
    method: "POST", headers: { authorization: "Bearer " + key, "content-type": "application/json" },
    signal: requestSignal, redirect: "error" as const, cache: "no-store" as const,
  };
  await assertPostOperationResolved(owner, operationId);
  try {
    requestSignal.throwIfAborted();
    const response = await fetch("https://api.monid.ai/v1/inspect", { ...options, body: JSON.stringify({ provider: "octen", endpoint: "/search" }) });
    if (!response.ok) throw new Error("Inspection failed");
    const endpoint = await readJson(response);
    if (!record(endpoint) || endpoint.provider !== "octen" || endpoint.endpoint !== "/search" ||
      !baseSearchWithinCeiling(endpoint.price, Number(ceiling)) ||
      !acceptsSearch(record(endpoint.input) ? endpoint.input.body : endpoint.inputSchema, input)) throw new Error("Unqualified search contract");
  } catch {
    throw new PaidWorkError("configuration", "Monid research is paused: its inspected search schema or per-call USD price could not be verified within the configured ceiling.");
  }
  if (requestSignal.aborted) throw new PaidWorkError("provider_error", "Web research was cancelled before paid dispatch.");
  const serializedInput = JSON.stringify({ provider: "octen", endpoint: "/search", input });
  const reservation = await reservePaidWork({ owner, operationId, attemptId: crypto.randomUUID(), model: "monid-octen-search", serializedInput, maxOutputTokens: 0 });
  let sent = false, settled = false;
  try {
    requestSignal.throwIfAborted();
    sent = true;
    const response = await fetch("https://api.monid.ai/v1/run", { ...options, body: serializedInput });
    await recordPaidResponse(reservation, response.headers.get("x-request-id"));
    // These gateway errors reject a run before execution. Timeouts/5xx remain ambiguous.
    if ([400, 401, 402, 403, 404].includes(response.status)) {
      await releaseRejectedPaidWork(reservation); settled = true;
      throw new PaidWorkError("provider_rejected", "Monid rejected this search. Check the server configuration and wallet before retrying.");
    }
    if (!response.ok) throw new PaidWorkError("provider_error", "Monid interrupted the search; its paid attempt needs reconciliation.");
    const result = await readJson(response);
    if (!record(result)) throw new PaidWorkError("invalid_response", "Monid returned an invalid search envelope.");
    if (typeof result.runId === "string") await recordPaidResponse(reservation, result.runId);
    if (response.status === 202 || result.status === "RUNNING") throw new PaidWorkError("reconciliation_required", "Monid accepted an asynchronous search. Reconcile the recorded run before repeating this research.", 409, operationId);
    const cost = billingMicros(result.billing);
    await settlePaidWork(reservation, cost); settled = true;
    if (result.status !== "COMPLETED" || result.provider !== "octen" || result.endpoint !== "/search" || !record(result.providerResponse) ||
      typeof result.providerResponse.httpStatus !== "number" || result.providerResponse.httpStatus < 200 || result.providerResponse.httpStatus >= 300) {
      throw new PaidWorkError("provider_error", "Monid completed the run without a successful Octen search. Its reported charge was recorded.");
    }
    return { evidence: evidenceFrom(result.output), web: "searched", notice: null };
  } catch (error) {
    if (!sent && !settled) await releaseRejectedPaidWork(reservation);
    else if (!settled) await recordPaidFailure(reservation, error);
    if (error instanceof PaidWorkError) throw error;
    throw new PaidWorkError("provider_error", "Web research could not finish. Inspect the recorded Monid attempt before retrying; uncertain usage remains reserved.");
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function baseSearchWithinCeiling(price: unknown, ceiling: number): boolean {
  if (!record(price)) return false;
  let base = price;
  if (price.type === "TIERED") {
    // The live Octen contract charges tokens only when full_content.enable=true.
    // Our fixed request disables it. Unknown or potentially active surcharges pause dispatch.
    if (!record(price.default) || !Array.isArray(price.tiers) || price.tiers.length > 20 || price.tiers.some(tier =>
      !record(tier) || !record(tier.when) || Object.keys(tier.when).length !== 1 || tier.when["full_content.enable"] !== true)) return false;
    base = price.default;
  }
  const amount = record(base.amount) ? base.amount.value : base.amount;
  const currency = record(base.amount) ? base.amount.currency : base.currency;
  return base.type === "PER_CALL" && currency === "USD" && typeof amount === "number" && Number.isFinite(amount) && amount >= 0 && amount <= ceiling;
}
function acceptsSearch(schema: unknown, input: unknown): boolean {
  if (!record(schema) || schema.type !== "object" || !record(schema.properties)) return false;
  const { query, count, full_content: fullContent } = schema.properties;
  if (!record(query) || query.type !== "string" || !record(count) || !["integer", "number"].includes(String(count.type)) ||
    !record(fullContent) || fullContent.type !== "object" || !record(fullContent.properties) ||
    !record(fullContent.properties.enable) || fullContent.properties.enable.type !== "boolean") return false;
  const Validator = typeof schema.$schema === "string" && schema.$schema.includes("2020-12") ? Ajv2020 : Ajv;
  return new Validator({ strict: false, validateFormats: false }).compile(schema)(input) === true;
}
function billingMicros(billing: unknown): number {
  const cost = (value: unknown) => record(value) && value.unit === "MICRO_DOLLAR" && value.currency === "USD" &&
    typeof value.value === "number" && Number.isSafeInteger(value.value) && value.value >= 0 ? value.value : null;
  if (!record(billing)) throw new PaidWorkError("invalid_usage", "Monid omitted its billed search cost; the reservation is retained.");
  const reported = cost(billing.reportedCost), actual = billing.actualCost === undefined ? 0 : cost(billing.actualCost);
  if (reported === null || actual === null) throw new PaidWorkError("invalid_usage", "Monid returned an unsupported USD cost receipt; the reservation is retained.");
  // reportedCost is the caller-facing price in Monid's success example; actualCost may be zero.
  return Math.max(reported, actual);
}
function evidenceFrom(output: unknown): ProductionEvidence[] {
  if (!record(output) || output.code !== 0 || !record(output.data) || !Array.isArray(output.data.results) || output.data.results.length > 5) {
    throw new PaidWorkError("invalid_response", "Octen returned an unsupported search result envelope. Its reported charge was recorded.");
  }
  const evidence: ProductionEvidence[] = [], seen = new Set<string>(), retrievedAt = new Date().toISOString();
  for (const row of output.data.results) {
    if (!record(row) || typeof row.url !== "string" || typeof row.highlight !== "string" || !row.highlight.trim()) continue;
    let url: URL;
    try { url = new URL(row.url); } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password || seen.has(url.href)) continue;
    seen.add(url.href);
    evidence.push({
      id: `WEB${evidence.length + 1}`, itemId: "", sourceRevision: 0, kind: "web_source",
      title: (typeof row.title === "string" && row.title.trim() ? row.title.trim() : url.hostname).slice(0, 160),
      ...(typeof row.authors === "string" && row.authors.trim() ? { author: row.authors.trim().slice(0, 160) } : {}),
      excerpt: row.highlight.trim().slice(0, 1000), originalUrl: url.href, retrievedAt,
      ...(typeof row.time_published === "string" && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(row.time_published) && !Number.isNaN(Date.parse(row.time_published)) ? { publishedAt: row.time_published } : {}),
    });
  }
  return evidence;
}
async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing web response");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 256 * 1024) throw new Error("Web response exceeded limit");
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel(); reader.releaseLock(); }
}
