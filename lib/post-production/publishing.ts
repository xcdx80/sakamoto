import { createHash } from "node:crypto";
import type { DraftContent, PostPlatform } from "./types";

export type PublishingCapability = {
  provider: "postiz";
  ready: boolean;
  platforms: PostPlatform[];
  notice: string | null;
};
export type PublishingSubmission = {
  provider: "postiz";
  status: "submitted";
  posts: { platform: PostPlatform; postId: string; integrationId: string }[];
};
export class PublishingError extends Error {
  constructor(public readonly code: "connection_required" | "invalid_request" | "submission_uncertain", message: string) {
    super(message);
    this.name = "PublishingError";
  }
}

const CONNECTION_NOTICE = "Connect publishing for this account: configure the server's Postiz key, account owner and platform channels.";
function configuration(owner: string) {
  const key = process.env.POSTIZ_API_KEY?.trim();
  const configuredOwner = process.env.POSTIZ_OWNER_ID?.trim();
  if (!key || !configuredOwner || owner !== configuredOwner) return null;
  let base: URL;
  try { base = new URL(process.env.POSTIZ_BASE_URL?.trim() || "https://api.postiz.com/public/v1"); }
  catch { return null; }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) return null;
  const integrations: Partial<Record<PostPlatform, string>> = {};
  if (process.env.POSTIZ_X_INTEGRATION_ID?.trim()) integrations.x = process.env.POSTIZ_X_INTEGRATION_ID.trim();
  if (process.env.POSTIZ_LINKEDIN_INTEGRATION_ID?.trim()) integrations.linkedin = process.env.POSTIZ_LINKEDIN_INTEGRATION_ID.trim();
  if (!Object.keys(integrations).length) return null;
  return { key, base: base.toString().replace(/\/$/, ""), integrations };
}

/** Configuration readiness only; each submission rechecks the selected Postiz channels. */
export function getPublishingCapability(owner: string): PublishingCapability {
  const configured = configuration(owner);
  return {
    provider: "postiz", ready: !!configured,
    platforms: configured ? Object.keys(configured.integrations) as PostPlatform[] : [],
    notice: configured ? null : CONNECTION_NOTICE,
  };
}

/** Non-secret destination summary for exact-target confirmation by external clients. */
export function getPublishingDestinations(owner: string, platforms: PostPlatform[]) {
  const configured = configuration(owner);
  if (!configured || platforms.some(platform => !configured.integrations[platform])) return null;
  const channels = [...platforms].sort().map(platform => ({ platform, integrationId: configured.integrations[platform]! }));
  // Bind confirmation to credentials as well as channel IDs, without exposing the key.
  const fingerprint = createHash("sha256").update(JSON.stringify({ owner, base: configured.base, channels, key: configured.key })).digest("hex");
  return { provider: "postiz" as const, apiBase: configured.base, channels, fingerprint };
}

/**
 * Caller must verify author approval/review freshness and persist dispatch intent first.
 * Postiz has no documented idempotency guarantee. Never automatically retry this call.
 */
export async function submitApprovedProduction(
  owner: string, approved: { revisionId: string; content: DraftContent },
): Promise<PublishingSubmission> {
  const configured = configuration(owner);
  if (!configured) throw new PublishingError("connection_required", CONNECTION_NOTICE);
  const { variants } = approved.content;
  if (!approved.revisionId || !variants.length || new Set(variants.map(variant => variant.platform)).size !== variants.length ||
    variants.some(variant => !["x", "linkedin"].includes(variant.platform) || !["single", "thread", "long"].includes(variant.delivery) ||
      !variant.posts.length || variant.posts.some(post => !post.trim()) ||
      (variant.delivery === "thread" ? variant.platform !== "x" || variant.posts.length < 2 || variant.posts.length > 30 : variant.posts.length !== 1))) {
    throw new PublishingError("invalid_request", "Publish an exact approved draft with one nonempty adaptation per platform.");
  }
  const targets = variants.map(variant => ({ variant, integrationId: configured.integrations[variant.platform] }));
  if (targets.some(target => !target.integrationId)) throw new PublishingError("connection_required", "Connect publishing for every platform in this draft before posting.");
  const options = {
    headers: { authorization: configured.key, "content-type": "application/json" },
    signal: AbortSignal.timeout(15_000), redirect: "error" as const, cache: "no-store" as const,
  };
  try {
    const response = await fetch(`${configured.base}/integrations`, { ...options, method: "GET" });
    if (!response.ok) throw new Error("Channel check failed");
    const integrations = await readJson(response);
    if (!Array.isArray(integrations) || targets.some(target => !integrations.some(channel =>
      record(channel) && channel.id === target.integrationId && channel.identifier === target.variant.platform && channel.disabled === false))) {
      throw new Error("Channel unavailable");
    }
  } catch {
    throw new PublishingError("connection_required", "Reconnect the configured publishing channels in Postiz before posting.");
  }
  const body = {
    type: "now", date: new Date().toISOString(), shortLink: false, tags: [],
    posts: targets.map(({ variant, integrationId }) => ({
      integration: { id: integrationId },
      value: variant.posts.map(content => ({ content, image: [] })),
      settings: variant.platform === "x" ? { __type: "x", who_can_reply_post: "everyone" } : { __type: "linkedin" },
    })),
  };
  try {
    const response = await fetch(`${configured.base}/posts`, { ...options, method: "POST", body: JSON.stringify(body) });
    if (!response.ok) throw new Error("Postiz did not acknowledge every post");
    const receipts = await readJson(response);
    if (!Array.isArray(receipts) || receipts.length !== targets.length) throw new Error("Incomplete publishing receipt");
    const posts = targets.map(({ variant, integrationId }) => {
      const matches = receipts.filter(receipt => record(receipt) && receipt.integration === integrationId);
      if (matches.length !== 1 || !record(matches[0]) || typeof matches[0].postId !== "string" || !matches[0].postId.trim()) throw new Error("Invalid publishing receipt");
      return { platform: variant.platform, postId: matches[0].postId, integrationId: integrationId! };
    });
    return { provider: "postiz", status: "submitted", posts };
  } catch {
    throw new PublishingError("submission_uncertain", "Postiz may have accepted this submission. Check Postiz before any further publishing attempt; automatic retry is disabled.");
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing publishing response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 64 * 1024) throw new Error("Publishing response exceeded limit");
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel(); reader.releaseLock(); }
}
