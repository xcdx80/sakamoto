import { manageAdminFailures, readAdminFailures, type FailureAction } from "./admin-failures";
import { boundedJson } from "./request-json";

const headers = { "Cache-Control": "private, no-store" };
export async function adminFailuresHttp(req: Request, owner: string | null) {
  if (!owner || req.headers.has("authorization") || (req.headers.has("x-sakamoto-owner") && req.headers.get("x-sakamoto-owner") !== owner))
    return Response.json({ error: "Sign in to manage your library failures." }, { status: 401, headers });
  if (req.method !== "GET" && req.method !== "POST") return new Response(null, { status: 405, headers });
  let command: FailureAction | undefined;
  if (req.method === "POST") {
    if ((req.headers.has("origin") && req.headers.get("origin") !== new URL(req.url).origin) || req.headers.get("sec-fetch-site") === "cross-site")
      return Response.json({ error: "Use the dashboard to manage failures." }, { status: 403, headers });
    try {
      if (!req.headers.get("content-type")?.startsWith("application/json")) throw new Error();
      const body = await boundedJson(req, 4096);
      const allowed = body.action === "lose-group" ? ["action", "key", "reason"] : ["action"];
      if (Object.keys(body).some(key => !allowed.includes(key)) || !["retry-all", "lose-unrecoverable", "lose-group"].includes(String(body.action))) throw new Error();
      if (body.action === "lose-group" && (typeof body.key !== "string" || !/^[a-f0-9]{32}$/.test(body.key) || typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 2000)) throw new Error();
      command = body as FailureAction;
    } catch {
      return Response.json({ error: "Choose a valid failure action and a reason of up to 2,000 characters." }, { status: 400, headers });
    }
  }
  try {
    const result = command ? await manageAdminFailures(owner, command) : {};
    return Response.json({ ...result, failures: await readAdminFailures(owner) }, { headers });
  } catch {
    return Response.json({ error: "Failure management is unavailable. Refresh the dashboard before trying again." }, { status: 503, headers });
  }
}
