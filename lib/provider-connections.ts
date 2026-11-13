import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { encryptCredential, decryptCredential, type CredentialRecord } from "./credential-crypto";
import { paidFailureDetails } from "./paid-diagnostics";
import { PaidWorkError } from "./paid-work";
import { providerCatalog, type CredentialProvider, type ConnectionSettings } from "./provider-connection-types";

/** A provider request was definitely not sent; its caller may safely release its reservation. */
export class ProviderRequestNotSent extends PaidWorkError {}
export class CredentialUnavailable extends ProviderRequestNotSent {
  constructor(provider: CredentialProvider) { super("configuration", `Connect your ${providerCatalog[provider].label} API key in API key settings before using this feature.`, 409); }
}
export type ProviderConnection = Readonly<{ owner: string; provider: CredentialProvider; id: string }>;
const operations = {
  "openai-chat": ["openai", "https://api.openai.com/v1/chat/completions", "authorization"],
  "google-embedding": ["google", "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent", "x-goog-api-key"],
  "typesafe-systemone": ["typesafe", "https://api.typesafe.ai/v1/systemone", "authorization"],
  "exa-search": ["exa", "https://api.exa.ai/search", "x-api-key"],
  "monid-inspect": ["monid", "https://api.monid.ai/v1/inspect", "authorization"],
  "monid-run": ["monid", "https://api.monid.ai/v1/run", "authorization"],
} as const;
export type ProviderOperation = keyof typeof operations;

export async function connectionSettings(owner: string): Promise<ConnectionSettings> {
  const rows = await db().query("select provider,updated_at,expires_at from provider_connections where owner_id=$1", [owner]);
  const [budget] = await db().query(`select coalesce((select cap_micros from provider_budgets where owner_id=$1),10000000) as cap,
    coalesce(sum(actual_micros) filter(where status='settled'),0) as used,
    coalesce(sum(reserved_micros) filter(where status in ('reserved','uncertain')),0) as reserved from paid_attempts where owner_id=$1 and budget_scope='byok'`, [owner]);
  return { connections: (Object.keys(providerCatalog) as CredentialProvider[]).map(provider => {
    const row = rows.find(r => r.provider === provider);
    return { provider, stored: !!row, connected: !!row && (!row.expires_at || Date.parse(row.expires_at) > Date.now()), updatedAt: row ? new Date(row.updated_at).toISOString() : null, expiresAt: row?.expires_at ?? null };
  }), budget: { capUsd: Number(budget.cap) / 1e6, usedUsd: Number(budget.used) / 1e6, reservedUsd: Number(budget.reserved) / 1e6 } };
}
export async function hasProviderConnection(owner: string, provider: CredentialProvider): Promise<boolean> {
  return (await db().query("select 1 from provider_connections where owner_id=$1 and provider=$2 and (expires_at is null or expires_at::timestamptz>now())", [owner, provider])).length > 0;
}
export async function saveProviderConnection(owner: string, provider: CredentialProvider, key: string, expiresAt: string | null) {
  const row = encryptCredential({ owner_id: owner, provider, id: randomUUID(), expires_at: expiresAt }, key);
  await db().query("select save_provider_connection($1,$2,$3::uuid,$4,$5,$6)", [owner, provider, row.id, row.key_id, row.ciphertext, expiresAt]);
}
export async function disconnectProvider(owner: string, provider: CredentialProvider) {
  await db().query("select disconnect_provider($1,$2)", [owner, provider]);
}

export async function prepareProviderConnection(owner: string, provider: CredentialProvider): Promise<ProviderConnection> {
  const [row] = await db().query("select id from provider_connections where owner_id=$1 and provider=$2 and (expires_at is null or expires_at::timestamptz>now())", [owner, provider]);
  if (!row) throw new CredentialUnavailable(provider);
  return Object.freeze({ owner, provider, id: String(row.id) });
}
/** Only this adapter decrypts at execution time. No plaintext cache, caller-supplied URL or redirect. */
export async function executeProviderRequest(connection: ProviderConnection, operation: ProviderOperation, options: { body: string; signal?: AbortSignal }): Promise<Response> {
  const target = operations[operation];
  if (!target || target[0] !== connection.provider) throw new CredentialUnavailable(connection.provider);
  let key: string;
  try {
    const [row] = await db().query("select * from authorize_provider_request($1,$2,$3::uuid)", [connection.owner, connection.provider, connection.id]);
    if (!row || row.expires_at && Date.parse(row.expires_at) <= Date.now()) throw 0;
    key = decryptCredential(row as CredentialRecord);
  } catch { throw new CredentialUnavailable(connection.provider); }
  if (options.signal?.aborted) throw new ProviderRequestNotSent("dispatch_deferred", "The request window ended before provider dispatch. No request was sent.");
  let response: Response;
  try {
    response = await fetch(target[1], { method: "POST", body: options.body, signal: options.signal,
      headers: { "content-type": "application/json", [target[2]]: target[2] === "authorization" ? `Bearer ${key}` : key }, redirect: "error", cache: "no-store" });
  } catch (cause) {
    const diagnostic = paidFailureDetails(cause);
    const error = new Error("The provider request did not complete.");
    error.name = diagnostic.errorName;
    if (diagnostic.transportCode) Object.assign(error, {code:diagnostic.transportCode});
    throw error;
  }
  // Do not expose upstream headers/errors. Stream filtering also covers providers reflecting credentials.
  const headers = new Headers({ "content-type": response.headers.get("content-type")?.startsWith("text/event-stream") ? "text/event-stream" : "application/json" });
  const requestId = response.headers.get("x-request-id");
  if (requestId && /^[\w.-]{1,200}$/.test(requestId) && !requestId.includes(key)) headers.set("x-request-id", requestId);
  if (!response.ok) { await response.body?.cancel(); return new Response(null, { status: response.status, headers }); }
  let pending = "";
  const redactor = new TransformStream<string, string>({
    transform(chunk, controller) {
      pending += chunk;
      let index;
      while ((index = pending.indexOf(key)) >= 0) { controller.enqueue(pending.slice(0, index) + "[redacted]"); pending = pending.slice(index + key.length); }
      let held = Math.min(pending.length, key.length - 1);
      while (held > 0 && !key.startsWith(pending.slice(-held))) held--;
      const safe = pending.length - held;
      if (safe) { controller.enqueue(pending.slice(0, safe)); pending = pending.slice(safe); }
    },
    flush(controller) { controller.enqueue(pending); },
  });
  return new Response(response.body?.pipeThrough(new TextDecoderStream()).pipeThrough(redactor).pipeThrough(new TextEncoderStream()), { status: response.status, headers });
}
