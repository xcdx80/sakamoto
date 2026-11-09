/** Session identity enters here; browser payloads cannot claim a different owner or approve themselves. */
import { boundedJson } from "../request-json";
import { PaidWorkError } from "../paid-work";
import { loadCatalog, summarizeCatalog } from "./catalog";
import { listProductionSources } from "./context";
import { proposeWeeklyIdeas } from "./planning";
import { providerStatus } from "./providers";
import { getPublishingCapability, PublishingError } from "./publishing";
import * as repository from "./repository";
import type { AuthorSignalAssessment, BrandProfile, DraftContent, GenerationParameters, ProductionBrief, ProductionDetail, WriteWorkspace } from "./types";

const headers = { "Cache-Control": "private, no-store" };
class InputError extends Error {}
function fields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some(key => !["action", ...allowed].includes(key))) throw new InputError("Unsupported writing options.");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("Expected writing options.");
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new InputError("A valid writing identifier or text is required.");
  return value.trim();
}
function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new InputError("A current version is required.");
  return Number(value);
}
const response = (value: unknown, status = 200) => Response.json(value, { status, headers });
const conflict = () => response({ error: "This draft or profile changed. Reload the latest version before continuing." }, 409);
async function detail(owner: string, id: string): Promise<ProductionDetail> {
  const value = await repository.getProduction(owner, id);
  if (!value) throw new InputError("Production is unavailable in this account.");
  return value;
}

export async function writeHttp(req: Request, owner: string | null): Promise<Response> {
  if (!owner) return response({ error: "Sign in to use your writing desk." }, 401);
  if (req.method !== "GET" && req.method !== "POST") return response({ error: "Unsupported writing method." }, 405);
  const origin = req.headers.get("origin");
  if (req.method === "POST" && origin && origin !== new URL(req.url).origin) return response({ error: "Use the writing desk from this site." }, 403);
  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      if (url.searchParams.has("productionId")) {
        const value = await repository.getProduction(owner, text(url.searchParams.get("productionId")));
        return value ? response(value) : response({ error: "Production is unavailable in this account." }, 404);
      }
      if (url.searchParams.get("weekly") === "true") return response({ ideas: await proposeWeeklyIdeas(owner) });
      const [profile, productions, history, sources] = await Promise.all([
        repository.getProfile(owner), repository.listProductions(owner), repository.listHistory(owner), listProductionSources(owner, url.searchParams.get("source")),
      ]);
      const workspace: WriteWorkspace = { profile,
        productions: productions.map(production => ({ ...production, checkpoint: { frameworkId: production.checkpoint.frameworkId, hookPatternId: production.checkpoint.hookPatternId } })),
        history, sources, catalog: summarizeCatalog(loadCatalog()), providers: providerStatus(), publishing: getPublishingCapability(owner) };
      return response(workspace);
    }
    const body = await boundedJson(req, 250000);
    const action = text(body.action, 30);
    if (action === "profile") {
      fields(body, ["profile", "expectedVersion"]);
      const saved = await repository.saveProfile(owner, object(body.profile) as BrandProfile, version(body.expectedVersion));
      return saved ? response(saved) : conflict();
    }
    if (action === "create") {
      fields(body, ["brief"]);
      const brief = object(body.brief);
      if (!Array.isArray(brief.platforms) || !Array.isArray(brief.sourceIds)) throw new InputError("Choose platforms and saved sources.");
      const production = await repository.createProduction(owner, brief as ProductionBrief);
      return response(await detail(owner, production.id));
    }
    const id = text(body.id);
    if (!(await repository.getProduction(owner, id))) return response({ error: "Production is unavailable in this account." }, 404);
    if (action === "feedback") {
      fields(body, ["id", "text"]);
      await repository.recordFeedback(owner, id, text(body.text, 10000));
      return response(await detail(owner, id));
    }
    if (action === "suggest_voice") {
      fields(body, ["id", "feedbackId", "update"]);
      const update = object(body.update);
      if (Object.keys(update).some(key => !["voice", "preferredMoves", "bannedMoves", "ending", "examples"].includes(key))) throw new InputError("A voice suggestion can change writing preferences only.");
      const saved = await repository.proposeVoiceUpdate(owner, id, text(body.feedbackId), update);
      return saved ? response(await detail(owner, id)) : conflict();
    }
    if (action === "accept_voice") {
      fields(body, ["id", "feedbackId", "expectedVersion"]);
      const profile = await repository.acceptVoiceUpdate(owner, id, text(body.feedbackId), version(body.expectedVersion));
      return profile ? response({ profile, detail: await detail(owner, id) }) : conflict();
    }
    const expectedVersion = version(body.expectedVersion);
    let value: ProductionDetail | null = null;
    if (action === "update_brief") {
      fields(body, ["id", "expectedVersion", "brief"]);
      const brief = object(body.brief);
      if (!Array.isArray(brief.platforms) || !Array.isArray(brief.sourceIds)) throw new InputError("Choose platforms and saved sources.");
      value = await repository.updateProductionBrief(owner, id, brief as ProductionBrief, expectedVersion);
    } else if (action === "save") {
      fields(body, ["id", "expectedVersion", "content"]);
      const content = object(body.content);
      if (!Array.isArray(content.variants) || !Array.isArray(content.hooks) || !Array.isArray(content.claimSources)) throw new InputError("A complete draft is required.");
      value = await repository.saveRevision(owner, id, content as DraftContent, "author", expectedVersion);
    } else if (["advance", "choose", "approve", "assess_signals", "revise", "regenerate", "publish"].includes(action)) {
      const workflow = await import("./production");
      if (action === "regenerate") {
        fields(body, ["id", "expectedVersion", "parameters"]);
        value = await workflow.regenerateProduction(owner,id,expectedVersion,object(body.parameters) as GenerationParameters);
      } else if (action === "revise") {
        fields(body, ["id", "expectedVersion", "instruction"]);
        value = await workflow.requestProductionRevision(owner,id,expectedVersion,text(body.instruction,3000));
      } else if (action === "publish") {
        fields(body, ["id", "expectedVersion"]);
        value = await workflow.publishProduction(owner,id,expectedVersion);
      } else if (action === "assess_signals") {
        fields(body, ["id", "expectedVersion", "signals"]);
        if (!Array.isArray(body.signals)) throw new InputError("Choose supported evidence signals.");
        value = await workflow.assessProductionSignals(owner, id, expectedVersion, body.signals as AuthorSignalAssessment[]);
      } else if (action === "advance") {
        fields(body, ["id", "expectedVersion"]);
        value = await workflow.advanceProduction(owner, id, expectedVersion, req.signal);
      } else if (action === "choose") {
        fields(body, ["id", "expectedVersion", "frameworkId", "hookPatternId"]);
        value = await workflow.chooseProductionFramework(owner, id, expectedVersion, text(body.frameworkId), body.hookPatternId ? text(body.hookPatternId) : undefined);
      } else {
        fields(body, ["id", "expectedVersion", "revisionId"]);
        value = await workflow.approveProduction(owner, id, text(body.revisionId), expectedVersion);
      }
    } else if (["plan", "published", "cancel"].includes(action)) {
      fields(body, ["id", "expectedVersion", ...(action === "plan" ? ["plannedAt"] : [])]);
      const saved = action === "plan" ? await repository.planProduction(owner, id, text(body.plannedAt, 100), expectedVersion)
        : action === "published" ? await repository.markPublished(owner, id, expectedVersion) : await repository.cancelProduction(owner, id, expectedVersion);
      value = saved ? await repository.getProduction(owner, id) : null;
    } else throw new InputError("Choose a supported writing action.");
    return value ? response(value) : conflict();
  } catch (error) {
    if (error instanceof PublishingError) return response({error:error.message},error.code === "connection_required" ? 503 : 400);
    if (error instanceof InputError) return response({ error: error.message }, 400);
    if (error instanceof PaidWorkError) return response({ error: error.message }, error.status);
    if (error && typeof error === "object" && "code" in error) return response({ error: "The writing database is unavailable. Check the configured database and apply its pending migrations." }, 503);
    return response({ error: error instanceof Error && /required|invalid|choose|must|size|large|unavailable/i.test(error.message) ? error.message : "The writing action could not complete. Your saved drafts are retained." }, 400);
  }
}
