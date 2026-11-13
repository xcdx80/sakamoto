/** MCP is an owner-bound adapter over the same writing workflow as the browser. */
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { revisionResult } from "./result-presentation";
import { SITE_URL } from "../brand";
import { PaidWorkError } from "../paid-work";
import { loadCatalog, summarizeCatalog } from "./catalog";
import { providerStatus } from "./providers";
import { getPublishingCapability, getPublishingDestinations, PublishingError } from "./publishing";
import { POST_PINNED_SOURCE_LIMIT } from "./limits";
import * as repository from "./repository";
import * as workflow from "./production";
import type { Production, ProductionBrief, ProductionDetail } from "./types";

export const POST_WORKFLOW_INSTRUCTIONS = `Discuss the idea with the author and frame a writing brief. Keep their actual experience in notes; never invent facts or treat suggested framing as experience. Choose explicit platforms (x or linkedin), audience, goal and delivery. post_workflow reads the current voice, supported structures and provider readiness. create_post saves a brief only. Repeatedly call advance_post with the latest returned version, one durable stage per request, to run InView's existing source research, structure selection, writing and independent review. Stop at ready, needs_input or paused; do not automatically retry failed or uncertain paid work. Return result.posts verbatim by platform and delivery, result.alternateHooks as alternatives, recorded result.decisions, result.sources and the InView link to the author. Catalog hook patterns are not generated hook wording. Never invent missing reasons or claim every candidate source was used. The result is pinned to the returned revision; context/currentContext and review/currentReview describe current workflow state. Optional brief.sourcePolicy has library and web booleans, both true by default; set both false for supplied-context-only research. Optional brief.agentContext carries up to 8 attributed author_statement, reference or analysis items (24,000 total UTF-8 text bytes). Only actual author statements may support personal experience; agent analysis is not author testimony. Use revise_post for their requested changes, then advance_post again. save_post_draft saves exact edits; regenerate_post changes generation settings while preserving prior wording. Use get_post after an interrupted response; never blindly repeat create or publish. Revisions invalidate earlier approval. A passed review is not user approval. Only call approve_post after explicit user approval of the exact current wording and platforms. Approval does not publish. Only call publish_post after explicit permission to publish that exact revision to the returned configured destinations now. Never infer permission from a request to draft, revise, or review. Postiz acceptance is submission, not proof a post is live; uncertain submissions must never be retried automatically. The author can also continue at the returned InView link.`;

class PostToolError extends Error {
  constructor(readonly code: string, message: string, readonly recovery: string) { super(message); }
}
export function postToolFailure(error: unknown) {
  const code = error instanceof PostToolError ? error.code : error instanceof PublishingError ? error.code : error instanceof PaidWorkError ? error.code : "action_unavailable";
  const message = error instanceof Error ? error.message : "The writing action could not finish. Saved work is retained.";
  const recovery = error instanceof PostToolError ? error.recovery : "Read get_post before another action. Resolve the notice; do not automatically repeat paid or publishing work.";
  return { isError: true, content: [{ type: "text", text: `${message}\n\nNext: ${recovery}` }], structuredContent: { status: "error", code, message, recovery } };
}

type Schema = Record<string, unknown>;
const string = (maxLength = 200, minLength = 1): Schema => ({ type: "string", minLength, maxLength });
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: "object", properties, required, additionalProperties: false });
const array = (items: Schema, maxItems: number, minItems = 0): Schema => ({ type: "array", items, minItems, maxItems, uniqueItems: true });
const platforms = array({ type: "string", enum: ["x", "linkedin"] }, 2, 1);
const briefSchema = object({
  idea: string(3000), notes: string(12000, 0), audience: string(2000, 0),
  goal: { type: "string", enum: ["trust", "reach", "convert"] },
  pillar: { type: "string", enum: ["engineering", "transformation", "education", "other"] },
  platforms, delivery: { type: "string", enum: ["single", "thread", "long"] },
  sourceIds: array(string(), POST_PINNED_SOURCE_LIMIT),
  sourcePolicy: object({ library: { type: "boolean", default: true }, web: { type: "boolean", default: true } }),
  agentContext: array(object({
    id: { ...string(80), pattern: "^[A-Za-z0-9_-]{1,80}$" }, title: string(200), text: string(12000),
    kind: { type: "string", enum: ["author_statement", "reference", "analysis"] },
    provenance: object({ label: string(500), url: { ...string(2000), format: "uri", pattern: "^https?://" }, author: string(200), capturedAt: { ...string(100), format: "date-time" } }, ["label"]),
  }), 8),
}, ["idea", "notes", "audience", "goal", "pillar", "platforms", "delivery", "sourceIds"]);
const version = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const current = { id: string(), expectedVersion: version };
const contentSchema = object({
  variants: array(object({ platform: { type: "string", enum: ["x", "linkedin"] }, delivery: { type: "string", enum: ["single", "thread", "long"] }, posts: array(string(30000), 30, 1) }), 2, 1),
  hooks: array(string(1000), 12), claimSources: array(object({ claim: string(3000), evidenceIds: array(string(), 20) }), 100),
});
const parametersSchema = object({ brief: briefSchema, frameworkId: { anyOf: [string(), { type: "null" }] },
  hookPatternId: { anyOf: [string(), { type: "null" }] }, sourceMode: { type: "string", enum: ["automatic", "selected"] }, evidenceIds: array(string(), 20) });
const confirmation = { ...current, revisionId: string(), platforms, userConfirmed: { type: "boolean", const: true } };
const readonly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const mutation = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
export const POST_TOOLS = [
  { name: "post_workflow", title: "Prepare the post creation journey", description: "Read writing voice, framework catalog, provider configuration and exact draft-to-publication instructions. No generation or account connection is performed.", inputSchema: object({}), annotations: readonly },
  { name: "list_posts", title: "Find saved posts", description: "List up to the 200 most recent owned productions, newest first. Resume an existing post instead of creating a duplicate after an interrupted create call.", inputSchema: object({}), annotations: readonly },
  { name: "get_post", title: "Read a post and its draft", description: "Return the latest exact draft, evidence, independent review, revision history and next action. Optional revisionId reads an immutable historical revision without restoring it or approving it.", inputSchema: object({ id: string(), revisionId: string() }, ["id"]), annotations: readonly },
  { name: "create_post", title: "Save a new post brief", description: "Create a draft production from the author's framed idea. Does not generate, approve or publish. Save the returned id; do not retry blindly after a lost response.", inputSchema: object({ brief: briefSchema }), annotations: mutation },
  { name: "advance_post", title: "Run the next post generation stage", description: "Run exactly one durable InView research, selection, writing or independent review stage. May use paid providers under existing budget controls. Use the returned version to continue; stop on paused/needs_input/ready. Never approves or publishes.", inputSchema: object(current), annotations: { ...mutation, openWorldHint: true } },
  { name: "revise_post", title: "Request a draft revision", description: "Save the author's bounded revision instruction on this post. Keeps old revisions, invalidates approval, and prepares writing; call advance_post to generate and review the new wording.", inputSchema: object({ ...current, instruction: string(3000) }), annotations: mutation },
  { name: "save_post_draft", title: "Save exact draft edits", description: "Save a complete exact draft as a new immutable author revision. All selected platform variants, hooks and claim sources are required. Earlier approval is removed; advance_post runs independent review.", inputSchema: object({ ...current, content: contentSchema }), annotations: mutation },
  { name: "regenerate_post", title: "Change post generation settings", description: "Prepare fresh generation on the same post with an edited brief, source selection, framework or hook. Retains the previous draft until replacement. Use null structure choices for automatic selection, automatic sourceMode with empty evidenceIds for fresh research, or selected with current evidence IDs. Call advance_post next.", inputSchema: object({ ...current, parameters: parametersSchema }), annotations: mutation },
  { name: "choose_post_structure", title: "Choose an eligible writing structure", description: "Choose a framework and optional hook from this post's current recommendations, preserving InView evidence eligibility. May call the structure provider if hookPatternId is omitted.", inputSchema: object({ ...current, frameworkId: string(), hookPatternId: string() }, ["id", "expectedVersion", "frameworkId"]), annotations: { ...mutation, openWorldHint: true } },
  { name: "assess_post_signals", title: "Record author evidence assessments", description: "Only record explicit author assessments of supported evidence signals, never invent them to bypass provider decisions. Requires prepared context; unknown, stale or unsupported evidence is rejected by the normal workflow.", inputSchema: object({ ...current, signals: array(object({ signal: string(), strength: { type: "integer", enum: [0, 1, 2] }, evidenceIds: array(string(), 20), rationale: string(2000, 0) }), 100, 1) }), annotations: mutation },
  { name: "approve_post", title: "Approve an exact reviewed draft", description: "Only after explicit author approval of the displayed exact revision and every platform. userConfirmed is the caller's attestation, never proof obtained from the author by this server. Current passing independent review is required. Does not publish.", inputSchema: object(confirmation), annotations: mutation },
  { name: "publish_post", title: "Publish an explicitly approved post now", description: "External side effect. Only after the author explicitly asks to publish this exact approved revision, wording and platforms to the configured Postiz destinations NOW. Pass their confirmation and the destination fingerprint from get_post. Never call for draft/review requests. Never retry an uncertain or submitted attempt; Postiz acceptance does not prove the post is live.", inputSchema: object({ ...confirmation, destinationFingerprint: string(64) }), annotations: { ...mutation, destructiveHint: true, openWorldHint: true } },
];
const ajv = new Ajv({ strict: false, allErrors: false });
addFormats(ajv);
const validators = new Map(POST_TOOLS.map(tool => [tool.name, ajv.compile(tool.inputSchema)]));
export const isPostTool = (name: string) => validators.has(name);
const link = (id: string) => `${SITE_URL.replace(/\/$/, "")}/write?post=${encodeURIComponent(id)}`;
function summary(p: Production) {
  return { id: p.id, brief: p.brief, status: p.status, stage: p.stage, version: p.version,
    latestRevisionId: p.latestRevisionId, approvedRevisionId: p.approvedRevisionId,
    plannedAt: p.plannedAt, notice: p.notice, createdAt: p.createdAt, updatedAt: p.updatedAt };
}
function nextAction(p: Production) {
  if (p.checkpoint.publication) return { action: "check_postiz", reason: "Submission may have occurred. Do not retry publishing.", publication: p.checkpoint.publication };
  if (["published", "cancelled"].includes(p.status)) return { action: "done", reason: p.status };
  if (["approved", "planned"].includes(p.status)) return { action: "await_publish_permission", reason: "Ask before publishing this approved revision to the configured destinations." };
  if (p.status === "ready") return { action: "await_author_review", reason: "Show the exact draft. Independent review is not user approval." };
  if (["needs_input", "paused", "working"].includes(p.status)) return { action: "wait_for_input", reason: p.notice || "Work is in progress. Read the current post before resuming." };
  return { action: "advance_post", arguments: { id: p.id, expectedVersion: p.version }, reason: `Continue ${p.stage}; this does not approve or publish.` };
}
function present(owner: string, detail: ProductionDetail, revisionId?: string) {
  const p = detail.production;
  const revision = detail.revisions.find(r => r.id === (revisionId ?? p.latestRevisionId)) ?? null;
  if (revisionId && !revision) throw new Error("Revision is unavailable in this post.");
  return {
    production: summary(p), url: link(p.id), draft: revision,
    result: revisionResult(revision, summarizeCatalog(loadCatalog())),
    progress: { status: p.status, stage: p.stage, hasDraft: !!p.latestRevisionId, revisionCount: detail.revisions.length,
      latestRevisionId: p.latestRevisionId, reviewStatus: detail.review?.status ?? null, notice: p.notice },
    history: detail.revisions.map(r => ({ id: r.id, number: r.number, origin: r.origin, createdAt: r.createdAt })),
    context: p.checkpoint, review: detail.review,
    currentContext: p.checkpoint, currentReview: detail.review, next: nextAction(p),
    publishing: { ...getPublishingCapability(owner), destinations: getPublishingDestinations(owner, p.brief.platforms) },
  };
}
export async function callPostTool(owner: string, name: string, raw: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  try { return await executePostTool(owner, name, raw, signal); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      throw new PostToolError("configuration_required", "The writing framework catalog is unavailable on this server.", "Deploy the framework catalog assets with both MCP routes.");
    if (error && typeof error === "object" && "code" in error && !(error instanceof PostToolError) && !(error instanceof PaidWorkError) && !(error instanceof PublishingError))
      throw new PostToolError("database_unavailable", "The writing database is unavailable. Saved work is retained.", "Check the server database configuration and apply pending migrations before retrying.");
    throw error;
  }
}
async function executePostTool(owner: string, name: string, raw: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const validate = validators.get(name);
  if ((name === "approve_post" || name === "publish_post") && (!raw || typeof raw !== "object" || !("userConfirmed" in raw) || raw.userConfirmed !== true))
    throw new PostToolError("confirmation_required", "Explicit user confirmation of this exact revision and destination is required.", "Show the exact wording and platforms to the author and ask. Approval and publishing are separate actions.");
  if (!validate || !validate(raw)) throw new PostToolError("invalid_arguments", `Invalid ${name} options. ${validate?.errors?.[0]?.message ?? "Unknown writing tool."}`, "Read tools/list and send only the advertised fields.");
  if (Buffer.byteLength(JSON.stringify(raw), "utf8") > 250000) throw new PostToolError("too_large", "Writing options exceed 250 KB.", "Reduce the input size. No writing action was performed.");
  const args = raw as Record<string, any>;
  if (name === "post_workflow") {
    const profile = await repository.getProfile(owner), providers = await providerStatus(owner), publishing = getPublishingCapability(owner);
    return { instructions: POST_WORKFLOW_INSTRUCTIONS, defaults: { sourcePolicy: { library: true, web: true } }, profile, catalog: summarizeCatalog(loadCatalog()), providers, publishing,
      health: { authentication: "authenticated", database: "reachable",
        generation: providers.ready ? "configured" : "configuration_required",
        publishing: publishing.ready ? "configured" : "configuration_required",
        externalProvidersVerified: false,
        notice: "Authentication and database access succeeded. Provider readiness is configuration only; no external connection, generation or publishing was attempted." } };
  }
  if (name === "list_posts") return { posts: (await repository.listProductions(owner)).map(p => ({
    id: p.id, idea: p.brief.idea.slice(0, 300), ideaTruncated: p.brief.idea.length > 300,
    platforms: p.brief.platforms, status: p.status, stage: p.stage, version: p.version,
    latestRevisionId: p.latestRevisionId, updatedAt: p.updatedAt, createdAt: p.createdAt, url: link(p.id),
  })), limit: 200 };
  if (name === "create_post") {
    const created = await repository.createProduction(owner, args.brief as ProductionBrief);
    return present(owner, (await repository.getProduction(owner, created.id))!);
  }
  const detail = await repository.getProduction(owner, args.id);
  if (!detail) throw new PostToolError("not_found", "Post is unavailable in this account.", "Use list_posts to select an owned post.");
  if (name === "get_post") return present(owner, detail, args.revisionId);
  if (detail.production.version !== args.expectedVersion) throw new PostToolError("conflict", "This post changed.", "Call get_post and use its current version before continuing.");
  if (name === "approve_post" || name === "publish_post") {
    const revision = detail.revisions.find(r => r.id === detail.production.latestRevisionId);
    const samePlatforms = (actual: string[]) => actual.length === args.platforms.length && actual.every(platform => args.platforms.includes(platform));
    if (!revision || revision.id !== args.revisionId || !samePlatforms(detail.production.brief.platforms)
      || !samePlatforms(revision.content.variants.map(variant => variant.platform)))
      throw new PostToolError("confirmation_mismatch", "Confirm the exact current revision and all of its platforms before approval or publishing.", "Read get_post and present the current draft for explicit author confirmation.");
    if (name === "publish_post" && getPublishingDestinations(owner, args.platforms)?.fingerprint !== args.destinationFingerprint)
      throw new PostToolError("destination_changed", "Publishing destinations are unavailable or changed.", "Read get_post and confirm its configured destinations before publishing.");
  }
  let result: ProductionDetail | null = null;
  if (name === "advance_post") result = await workflow.advanceProduction(owner, args.id, args.expectedVersion, signal);
  if (name === "revise_post") result = await workflow.requestProductionRevision(owner, args.id, args.expectedVersion, args.instruction);
  if (name === "save_post_draft") result = await repository.saveRevision(owner, args.id, args.content, "author", args.expectedVersion);
  if (name === "regenerate_post") result = await workflow.regenerateProduction(owner, args.id, args.expectedVersion, args.parameters);
  if (name === "choose_post_structure") result = await workflow.chooseProductionFramework(owner, args.id, args.expectedVersion, args.frameworkId, args.hookPatternId, signal);
  if (name === "assess_post_signals") result = await workflow.assessProductionSignals(owner, args.id, args.expectedVersion, args.signals);
  if (name === "approve_post") result = await workflow.approveProduction(owner, args.id, args.revisionId, args.expectedVersion);
  if (name === "publish_post") result = await workflow.publishProduction(owner, args.id, args.expectedVersion);
  if (!result) throw new PostToolError("action_unavailable", "This post changed or the requested action is not available.", "Call get_post and inspect its status, review, notice and next action before continuing.");
  return present(owner, result);
}
