/** Offline corpus validation by default; explicit live mode uses the production review boundary. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import type { PostProviderContext, PostProviders } from "../lib/post-production/providers";
import type { DraftContent, DraftReview, PostDelivery, PostPlatform } from "../lib/post-production/types";

type Case = {
  id: string; split: "development" | "validation"; platform: PostPlatform; delivery: PostDelivery;
  posts: string[]; frameworkId: string; expected: "pass" | "revise"; expectedOverall?: "pass" | "revise"; expectedGrounding?: "revise";
  reason: string; targetedDefect: string; labelProvenance: "user-reported-original" | "proposed-needs-human-calibration";
};
type Row = { id: string; split: Case["split"]; operationId: string; elapsedMs: number; expected: Case["expected"];
  outcome: "pending" | "matched" | "misclassified" | "error"; predicted?: Case["expected"]; overallMatched?: boolean; groundingMatched?: boolean;
  rawResult?: DraftReview; error?: Record<string, unknown> };
type Report = { mode: "validate" | "live" | "fixture-plumbing"; runId: string; recordedAt: string; cases: Case[]; rows: Row[];
  notice: string; summaries?: ReturnType<typeof summarize>; promptVersion?: string; catalogVersion?: string };
const HELP = "node --import tsx scripts/eval-post-coherence.ts --out /private/report.json [--cases path] [--split development|validation] [--limit 1..20] [--live --owner ID]";

function validateCases(value: unknown): Case[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error("Invalid corpus size.");
  const ids = new Set<string>();
  for (const c of value) {
    if (!c || typeof c !== "object" || !/^[a-z0-9-]+$/.test(c.id) || ids.has(c.id)
      || !["development", "validation"].includes(c.split) || !["x", "linkedin"].includes(c.platform)
      || !["single", "long", "thread"].includes(c.delivery) || !["pass", "revise"].includes(c.expected)
      || (c.expectedGrounding !== undefined && c.expectedGrounding !== "revise")
      || (c.expectedOverall !== undefined && !["pass", "revise"].includes(c.expectedOverall))
      || !["user-reported-original", "proposed-needs-human-calibration"].includes(c.labelProvenance)
      || [c.reason, c.targetedDefect, c.frameworkId].some(v => typeof v !== "string" || !v.trim())
      || !Array.isArray(c.posts) || !c.posts.length || c.posts.length > 30
      || c.posts.some((p: unknown) => typeof p !== "string" || !p.trim() || Buffer.byteLength(p) > 12000)
      || (c.delivery === "thread" ? c.platform !== "x" || c.posts.length < 2 : c.posts.length !== 1))
      throw new Error("Invalid coherence case or duplicate ID.");
    ids.add(c.id);
  }
  return value as Case[];
}
function summarize(rows: Row[]) {
  return ["development", "validation"].map(split => {
    const selected = rows.filter(r => r.split === split), scored = selected.filter(r => r.outcome === "matched" || r.outcome === "misclassified");
    return { split, attempted: selected.length, scored: scored.length, errors: selected.filter(r => r.outcome === "error").length, pending: selected.filter(r => r.outcome === "pending").length,
      matched: scored.filter(r => r.outcome === "matched").length,
      falsePasses: scored.filter(r => r.expected === "revise" && r.predicted === "pass").length,
      falseRevisions: scored.filter(r => r.expected === "pass" && r.predicted === "revise").length,
      controlFailures: scored.filter(r => (r.overallMatched === false || r.groundingMatched === false)).length };
  });
}
function context(c: Case, owner: string, operationId: string): PostProviderContext {
  return { owner, operationId, attemptId: randomUUID(),
    profile: { version: 1, positioning: "Learning product design", audience: "Learning product builders", pillars: ["education"], voice: "Plain, precise, concise", preferredMoves: [], bannedMoves: [], ending: "End with a concrete takeaway", language: "English", defaultGoal: "trust", weeklyIdeas: 1, examples: [] },
    brief: { idea: "Discuss how to decide whether personalization belongs in a learning tool.", notes: "", audience: "Learning product builders", goal: "trust", pillar: "education", platforms: [c.platform], delivery: c.delivery, sourceIds: [] },
    evidence: [], framework: { frameworkId: c.frameworkId, name: c.frameworkId, family: "", score: 1, reasons: [], outline: [], hookPatternIds: [], warnings: [] } };
}

export async function runPostCoherenceEvaluation(args: string[], adapter?: PostProviders["reviewPost"]): Promise<Report> {
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (options.has(key)) throw new Error("Duplicate option.");
    if (key === "--live") { options.set(key, "true"); continue; }
    if (!["--out", "--cases", "--split", "--limit", "--owner"].includes(key) || !args[i + 1]?.trim() || args[i + 1].startsWith("--")) throw new Error(HELP);
    options.set(key, args[++i]);
  }
  if (!options.has("--out")) throw new Error("An explicit --out path is required.");
  const live = options.has("--live"), owner = options.get("--owner");
  if (live && !owner) throw new Error("Live evaluation requires --owner; production budgets and credentials apply.");
  if (!live && owner) throw new Error("--owner requires --live.");
  const split = options.get("--split"), limit = Number(options.get("--limit") ?? (live ? 1 : 20));
  if (split && !["development", "validation"].includes(split)) throw new Error("Invalid split.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("Limit must be an integer from 1 to 20.");
  const cases = validateCases(JSON.parse(await readFile(resolve(options.get("--cases") ?? "evals/post-coherence/cases.json"), "utf8"))).filter(c => !split || c.split === split).slice(0, limit);
  if (!cases.length) throw new Error("No cases selected.");
  const report: Report = { mode: live ? adapter ? "fixture-plumbing" : "live" : "validate", runId: randomUUID(), recordedAt: new Date().toISOString(), cases, rows: [], notice: "Proposed labels need human calibration. Fixture results prove plumbing only. Errors are not classifications. Coherence is scored separately from factual grounding and other framework requirements. rawResult is the complete reviewPost result, not raw vendor traffic." };
  const out = resolve(options.get("--out")!);
  // Exclusive creation prevents accidental report/corpus overwrite and checks writability before paid dispatch.
  await writeFile(out, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  if (!live) return report;
  let review = adapter;
  if (!review) {
    const providers = await import("../lib/post-production/providers");
    const { loadCatalog } = await import("../lib/post-production/catalog");
    review = providers.reviewPost;
    report.promptVersion = providers.POST_PROMPT_VERSION;
    report.catalogVersion = loadCatalog().version;
  }
  for (const c of cases) {
    const operationId = `post:coherence-eval:${report.runId}:${c.id}`, started = Date.now();
    const row: Row = { id: c.id, split: c.split, expected: c.expected, operationId, elapsedMs: 0, outcome: "pending" };
    report.rows.push(row); report.summaries = summarize(report.rows);
    await writeFile(out, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    try {
      // Deliberately pass only draft content and neutral public context, never labels/reasons/defects.
      const content: DraftContent = { variants: [{ platform: c.platform, delivery: c.delivery, posts: c.posts }], hooks: [], claimSources: [] };
      row.rawResult = await review(context(c, owner!, operationId), content, "gpt-6-luna");
      const matching = row.rawResult.criteria.filter(s => s.id === "narrative-coherence");
      const criterion = matching[0], score = criterion?.score;
      if (matching.length !== 1 || score === undefined || !Number.isInteger(score) || score < 1 || score > 5) throw new Error("Review did not return a valid narrative-coherence score.");
      const bindingFailure = criterion.decision === "jev_failure" || criterion.assessment?.outcome === "fail"
        || row.rawResult.issues.some(issue => issue.code === "narrative_coherence" && issue.severity !== "suggestion");
      row.predicted = score >= 4 && !bindingFailure ? "pass" : "revise";
      row.outcome = row.predicted === c.expected ? "matched" : "misclassified";
      if (c.expectedGrounding) {
        const grounding = row.rawResult.criteria.filter(s => s.id === "grounded-in-sources");
        const gate = grounding[0];
        const unsupported = row.rawResult.issues.some(issue => issue.code === "unsupported_claim" && issue.severity !== "suggestion");
        if (!unsupported && (grounding.length !== 1 || !Number.isInteger(gate?.score) || gate.score < 1 || gate.score > 5))
          throw new Error("Review did not return a valid grounded-in-sources control score.");
        row.groundingMatched = unsupported || gate.score < 5 || gate.decision === "jev_failure" || gate.assessment?.outcome === "fail";
      }
      if (c.expectedOverall) row.overallMatched = (row.rawResult.status === "passed" ? "pass" : "revise") === c.expectedOverall;
    } catch (error) {
      row.outcome = "error";
      row.error = error instanceof Error ? { name: error.name, message: error.message, ...Object.fromEntries(Object.entries(error)) } : { message: String(error) };
    }
    row.elapsedMs = Date.now() - started; report.summaries = summarize(report.rows);
    await writeFile(out, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    // Never retry ambiguous paid work or continue spending after an infrastructure/provider failure.
    if (row.outcome === "error") break;
  }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes("--help")) console.log(HELP);
  else runPostCoherenceEvaluation(process.argv.slice(2)).then(report => {
    console.log(JSON.stringify({ mode: report.mode, cases: report.cases.map(c => c.id), summaries: report.summaries }));
    if (report.rows.some(r => r.outcome !== "matched" || r.overallMatched === false || r.groundingMatched === false)) process.exitCode = 1;
  }).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
