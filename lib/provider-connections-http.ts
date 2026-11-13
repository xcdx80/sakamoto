import "server-only";
import { db } from "./db";
import { boundedJson } from "./request-json";
import { connectionSettings, disconnectProvider, saveProviderConnection } from "./provider-connections";
import { isCredentialProvider } from "./provider-connection-types";

const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
export async function providerConnectionsHttp(request: Request, owner: string | null): Promise<Response> {
  const error = (message: string, status: number) => Response.json({ error: message }, { status, headers });
  if (!owner || request.headers.has("authorization")) return error("Sign in to manage API keys.", 401);
  if (!["GET", "POST"].includes(request.method)) return error("Method not allowed.", 405);
  try {
    if (request.method === "POST") {
      if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return error("Use API key settings on this site.", 403);
      if (!request.headers.get("content-type")?.startsWith("application/json")) return error("Expected JSON.", 415);
      const [limit] = await db().query(`insert into credential_management_limits(owner_id) values($1) on conflict(owner_id) do update set
        requests=case when credential_management_limits.window_start < now()-interval '1 minute' then 1 else credential_management_limits.requests+1 end,
        window_start=case when credential_management_limits.window_start < now()-interval '1 minute' then now() else credential_management_limits.window_start end returning requests`, [owner]);
      if (Number(limit.requests) > 20) return error("Too many changes. Wait a minute and try again.", 429);
      let body;
      try { body = await boundedJson(request, 8192); } catch { return error("Invalid API key request.", 400); }
      if (body.action === "budget" && Object.keys(body).every(k => ["action", "capUsd"].includes(k)) && typeof body.capUsd === "number" && Number.isFinite(body.capUsd) && body.capUsd >= 0 && body.capUsd <= 1000) {
        await db().query("insert into provider_budgets(owner_id,cap_micros) values($1,$2) on conflict(owner_id) do update set cap_micros=excluded.cap_micros", [owner, Math.floor(body.capUsd * 1e6)]);
      } else if (isCredentialProvider(body.provider)) {
        if (body.action === "disconnect" && Object.keys(body).every(k => ["action", "provider"].includes(k))) await disconnectProvider(owner, body.provider);
        else if (body.action === "save" && Object.keys(body).every(k => ["action", "provider", "apiKey", "expiresAt"].includes(k))) {
          if (typeof body.apiKey !== "string" || !/^[\x21-\x7e]{8,4096}$/.test(body.apiKey)) return error("Enter an API key without spaces or line breaks.", 400);
          const expiry = body.expiresAt == null ? null : body.expiresAt;
          if (expiry !== null && (typeof expiry !== "string" || !Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= Date.now())) return error("Choose a future expiration date.", 400);
          await saveProviderConnection(owner, body.provider, body.apiKey, expiry === null ? null : new Date(expiry).toISOString());
        } else return error("Invalid API key request.", 400);
      } else return error("Choose a supported provider.", 400);
    }
    return Response.json(await connectionSettings(owner), { headers });
  } catch { return error("API key settings are temporarily unavailable. No key details can be displayed.", 503); }
}
