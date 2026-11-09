/** Evaluate the real search/answer operations against separately reviewed relevance labels. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "../lib/db";
import { searchEvidence, type Evidence, type EvidenceSearch } from "../lib/retrieval";
import { askLibrary, type LibraryAnswer } from "../lib/library-answer";

type Case = {
  id: string;
  split: "development" | "validation";
  query: string;
  relevantSourceIds: string[];
  forbiddenSourceIds?: string[];
  expectedStatus?: string;
  reviewNotes: string;
};
type EvaluationResult = Case & {
  elapsedMs: number;
  labelledRecallAtK: number | null;
  reciprocalRank: number | null;
  forbiddenHits: string[];
  invalidCitations: number;
  expectedStatusMatched: boolean | null;
  uniqueSources: number;
  passages: number;
  retrieval: Omit<EvidenceSearch, "results">;
  results: Evidence[];
  answer?: LibraryAnswer;
  humanReview: { citationSupport: null; practicalUsefulness: null; freshnessHandling: null; notes: string };
};

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("npm run eval:library -- --cases /private/cases.json --out /private/report.json (--single-owner | --owner ID) [--k 10] [--semantic] [--answers] [--baseline-module /absolute/retrieval.ts]");
    return;
  }
  const flags = new Set(["--single-owner", "--semantic", "--answers"]);
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (flags.has(args[i])) { options.set(args[i], "true"); continue; }
    if (!["--cases", "--out", "--owner", "--k", "--baseline-module"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--"))
      throw new Error("Unknown or incomplete evaluation option; use --help.");
    options.set(args[i], args[++i]);
  }
  if (!options.has("--cases") || !options.has("--out")) throw new Error("Specify private cases and report paths.");
  const cases: Case[] = JSON.parse(await readFile(options.get("--cases")!, "utf8"));
  if (!Array.isArray(cases) || !cases.length || cases.length > 100 || cases.some(c =>
    !c || typeof c.id !== "string" || !["development", "validation"].includes(c.split) ||
    typeof c.query !== "string" || !c.query.trim() || Buffer.byteLength(c.query) > 1000 ||
    !Array.isArray(c.relevantSourceIds) || c.relevantSourceIds.some(id => typeof id !== "string") ||
    (c.forbiddenSourceIds !== undefined && (!Array.isArray(c.forbiddenSourceIds) || c.forbiddenSourceIds.some(id => typeof id !== "string"))) ||
    typeof c.reviewNotes !== "string" || !c.reviewNotes.trim())) throw new Error("Invalid reviewed evaluation cases.");
  if (new Set(cases.map(c => c.id)).size !== cases.length) throw new Error("Evaluation case IDs must be unique.");
  const limit = Number(options.get("--k") ?? 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Choose k between 1 and 50.");
  let owner = options.get("--owner");
  if (options.has("--single-owner")) {
    if (owner) throw new Error("Choose one owner selection method.");
    const owners = await db().query("select distinct user_id from articles where not deleted limit 2");
    if (owners.length !== 1) throw new Error("Select an explicit owner when the library is empty or has multiple owners.");
    owner = owners[0].user_id;
  }
  if (!owner) throw new Error("Select a library owner explicitly.");
  if (options.has("--baseline-module") && options.has("--answers")) throw new Error("Baseline modules evaluate retrieval only.");
  const search: typeof searchEvidence = options.has("--baseline-module")
    ? (await import(pathToFileURL(resolve(options.get("--baseline-module")!)).href)).searchEvidence
    : searchEvidence;
  const semantic = options.has("--semantic");
  const rows: EvaluationResult[] = [];
  for (const c of cases) {
    const started = Date.now();
    const answer = options.has("--answers") ? await askLibrary(owner, { query: c.query, semantic }) : undefined;
    const found = answer ? { results: answer.matches ?? answer.citations, ...answer.retrieval }
      : await search(owner, { query: c.query, limit, semantic });
    const passages: Evidence[] = found.results.slice(0, limit);
    const sources = [...new Set(passages.map(p => p.itemId))];
    const disclosedSources = new Set([
      ...found.results, ...(answer?.citations ?? []),
    ].map(source => source.itemId));
    const labelled = [...new Set(c.relevantSourceIds)];
    const hits = sources.filter(id => labelled.includes(id));
    const first = sources.findIndex(id => labelled.includes(id));
    const citationIds = new Set(answer?.citations.map(citation => citation.id));
    const invalidCitations = answer?.claims.flatMap(claim => claim.citationIds).filter(id => !citationIds.has(id)).length ?? 0;
    rows.push({
      ...c, elapsedMs: Date.now() - started,
      labelledRecallAtK: labelled.length ? hits.length / labelled.length : null,
      reciprocalRank: labelled.length ? (first < 0 ? 0 : 1 / (first + 1)) : null,
      forbiddenHits: [...disclosedSources].filter(id => c.forbiddenSourceIds?.includes(id)),
      invalidCitations, expectedStatusMatched: c.expectedStatus && answer ? answer.status === c.expectedStatus : null,
      uniqueSources: sources.length, passages: passages.length,
      retrieval: { mode: found.mode, semanticStatus: found.semanticStatus, coverage: found.coverage, contract: found.contract },
      results: passages, answer,
      humanReview: { citationSupport: null, practicalUsefulness: null, freshnessHandling: null, notes: "" },
    });
    console.log(JSON.stringify({ id: c.id, labelledRecallAtK: rows.at(-1)!.labelledRecallAtK, elapsedMs: rows.at(-1)!.elapsedMs }));
  }
  const summaries = ["development", "validation"].map(split => {
    const selected = rows.filter(row => row.split === split);
    const labelled = selected.filter(row => row.labelledRecallAtK !== null);
    return {
      split, cases: selected.length, labelledCases: labelled.length,
      meanLabelledRecallAtK: labelled.length ? labelled.reduce((n, row) => n + row.labelledRecallAtK!, 0) / labelled.length : null,
      meanReciprocalRank: labelled.length ? labelled.reduce((n, row) => n + row.reciprocalRank!, 0) / labelled.length : null,
      forbiddenHits: selected.reduce((n, row) => n + row.forbiddenHits.length, 0),
      invalidCitations: selected.reduce((n, row) => n + row.invalidCitations, 0),
    };
  });
  await writeFile(options.get("--out")!, JSON.stringify({
    recordedAt: new Date().toISOString(), k: limit, semantic, answers: options.has("--answers"), summaries, rows,
    notice: "Recall covers reviewed labels only. Unlabelled sources are not automatically irrelevant. Human support/usefulness/freshness fields are ungraded until reviewed. Fixture vectors do not establish live semantic quality.",
  }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ summaries }));
  if (rows.some(row => row.forbiddenHits.length || row.invalidCitations || row.expectedStatusMatched === false)) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Evaluation failed."); process.exitCode = 1; });
