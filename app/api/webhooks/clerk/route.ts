import { NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { deleteOwnerCredentials } from "@/lib/credential-lifecycle";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "cache-control": "no-store" };
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET) return new Response("Webhook unavailable", {status:503,headers});
  // Bound the signed raw body before verification. Never log payloads or signature errors.
  const reader = request.body?.getReader();
  if (!reader) return new Response("Invalid webhook", {status:400,headers});
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const {value,done} = await reader.read(); if (done) break; size += value.byteLength; if(size>65536) {await reader.cancel();return new Response("Webhook too large",{status:413,headers});} chunks.push(value); }
  } catch { return new Response("Invalid webhook",{status:400,headers}); }
  finally { reader.releaseLock(); }
  let event;
  try { event = await verifyWebhook(new NextRequest(request.url,{method:"POST",headers:request.headers,body:Buffer.concat(chunks)})); }
  catch { return new Response("Invalid signature",{status:400,headers}); }
  try {
    if(event.type === "user.deleted" && event.data.id) await deleteOwnerCredentials(event.data.id);
    return new Response(null,{status:204,headers});
  } catch { return new Response("Webhook processing unavailable",{status:503,headers}); }
}
