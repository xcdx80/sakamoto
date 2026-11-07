import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { parseDocument } from "yaml";
import type { PostGoal, PostPlatform, WriteCatalogSummary } from "./types";

export const FRAMEWORK_IDS = [
  "case-study-long", "curation-thread", "deep-dive-article", "framework-thread", "how-to-step-by-step",
  "if-i-had-to-do-it-again", "lessons-learned-thread", "linkedin-long-post", "real-reason-thread",
  "success-story-thread", "case-study-short", "contrarian-take", "format-transfer", "listicle", "old-vs-new",
  "outcome-first", "question-engagement", "single-paragraph-insight", "source-takeaways", "story-lesson",
  "this-just-happened", "what-how-why",
] as const;
export type FrameworkId = typeof FRAMEWORK_IDS[number];
export const HOOK_IDS = [
  "outcome-number", "before-after-gap", "credibility-stack", "contrarian-callout", "not-what-you-think",
  "blunt-truth", "curiosity-gap-real-reason", "old-new-label", "numbered-list-promise", "label-opener",
  "promise-plus-objection", "parallel-best", "story-cold-open", "question-opener", "news-peg",
  "starting-over", "relatable-enemy", "reaction-to-source",
] as const;
export type HookId = typeof HOOK_IDS[number];
export const SIGNAL_IDS = [
  "outcome_with_numbers", "before_after", "personal_story", "third_party_success", "common_belief_to_contradict",
  "old_vs_new_contrast", "discrete_items", "process_steps", "named_framework", "mistakes_or_regrets", "breaking_news",
  "proven_format_elsewhere", "multiple_sources_same_topic", "deep_material", "data_or_stats", "single_sharp_idea",
  "open_question", "quotable_source_post", "case_with_timeline", "author_has_credibility",
] as const;
export type SignalId = typeof SIGNAL_IDS[number];
export type FrameworkFamily = "proof" | "teach" | "opinion" | "story" | "news" | "curation" | "conversation" | "remix";
export type CatalogCriterion = {
  id: string; description: string; weight: number; anchors: Record<string, string>;
  pass_threshold: number; gate?: boolean; checks?: string[];
};
export type CatalogExample = {
  author: string; url: string; date: string; platform: string; kind: string; fit: string;
  excerpt: boolean; text: string; annotation: string; source_ref: string; caveat?: string;
  metrics_at_fetch?: Record<string, unknown>;
};
export type CatalogFramework = {
  id: FrameworkId; name: string; form: "short" | "long"; family: FrameworkFamily; summary: string;
  when_to_use: { source_signals: { signal: SignalId; weight: number; note?: string }[]; goals: Record<PostGoal, number>; notes?: string };
  avoid_when: { condition: string; signal?: SignalId; missing_signal?: SignalId }[];
  better_than: { framework: FrameworkId; when: string }[];
  structure: { section: string; purpose: string; length: string; optional?: boolean }[];
  length: { unit: "characters" | "words" | "posts"; min: number; max: number; note?: string };
  hook_patterns: { pattern: HookId; template: string }[];
  rubric: { inherits: string; criteria: CatalogCriterion[] };
  examples: CatalogExample[]; needs_examples: boolean; needs_examples_note?: string;
  platform_notes: Record<PostPlatform, string[]>; source_refs: string[];
};
export type CatalogHook = {
  id: HookId; name: string; template: string; description: string; why_it_works: string;
  pitfalls: string[]; examples: CatalogExample[]; used_by: FrameworkId[]; source_refs: string[];
};
export type CatalogSignal = { id: SignalId; description: string; detect: string };
export type LintRule = { id: string; pattern: string; note: string; severity: "warn" | "fail" };
export type SharedRubric = {
  id: string; description: string; scoring: { framework_weight: number; [key: string]: unknown };
  criteria: CatalogCriterion[];
  lint: { ai_tells: LintRule[]; other: LintRule[]; em_dash: { max_per_100_words: number; note: string } };
  source_refs: string[];
};
export type SelectionRow = {
  form: "short" | "long"; family: FrameworkFamily; signals: Partial<Record<SignalId, number>>;
  goals: Record<PostGoal, number>; penalize_if?: SignalId[]; penalize_if_missing?: SignalId[];
};
export type SelectionRules = {
  description: string;
  scoring: { formula: string; steps: string[]; defaults: { goal_weight: number; penalty: number; max_candidates: number; min_candidates: number; max_per_family: number } };
  signals: CatalogSignal[];
  comparisons: { prefer: FrameworkId; over: FrameworkId; when: string; origin: string }[];
  matrix: Record<FrameworkId, SelectionRow>; source_refs: string[];
};
export type PlatformClaim = { claim: string; confidence: "high" | "medium" | "low"; source_refs: string[]; note?: string };
export type PlatformPolicy = {
  platform: PostPlatform; as_of: string; summary: string; length: PlatformClaim[]; formatting: PlatformClaim[];
  links: PlatformClaim[]; media: PlatformClaim[]; timing: PlatformClaim[]; cadence: PlatformClaim[];
  algorithm_signals: unknown; engine_rules: string[]; [key: string]: unknown;
};
export type CatalogSource = { id: string; [key: string]: unknown };
export type PostCatalog = {
  version: string; frameworks: CatalogFramework[]; hooks: CatalogHook[]; signals: CatalogSignal[];
  shared: SharedRubric; selection: SelectionRules; platforms: Record<PostPlatform, PlatformPolicy>; sources: CatalogSource[];
};

/** Filesystem parsing stays on the server; selection and validation use type-only catalog imports. */
export function loadCatalog(rootDirectory = path.join(process.cwd(), "frameworks")): PostCatalog {
  const schemaText = readFileSync(path.join(rootDirectory, "schema.json"), "utf8");
  const schema = JSON.parse(schemaText);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.validateSchema(schema);
  const hash = createHash("sha256").update("schema.json\0").update(schemaText);
  const documents = new Map<string, unknown>();
  const files = (directory: string): string[] => readdirSync(path.join(rootDirectory, directory), { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : entry.name.endsWith(".yaml") ? [path.join(directory, entry.name)] : []);
  for (const file of files("").sort()) {
    const source = readFileSync(path.join(rootDirectory, file), "utf8");
    const document = parseDocument(source, { uniqueKeys: true });
    if (document.errors.length) throw new Error(`Invalid catalog ${file}: ${document.errors.map(error => error.message).join("; ")}`);
    documents.set(file, document.toJS());
    hash.update(file).update("\0").update(source).update("\0");
  }
  const definitions: Record<string, string> = {
    "hooks/hook-patterns.yaml": "hooks_file", "rubrics/shared.yaml": "shared_rubric_file",
    "rubrics/selection.yaml": "selection_file", "platforms/x.yaml": "platform_file",
    "platforms/linkedin.yaml": "platform_file", "sources.yaml": "sources_file",
  };
  function validated<T>(file: string, definition?: string): T {
    const data = documents.get(file);
    const validator = ajv.compile<T>(definition ? { $schema: schema.$schema, $defs: schema.$defs, ...schema.$defs[definition] } : schema);
    if (!validator(data)) throw new Error(`Invalid catalog ${file}: ${ajv.errorsText(validator.errors)}`);
    return data;
  }
  const frameworks: CatalogFramework[] = [];
  for (const file of documents.keys()) {
    if (!file.startsWith("short-form/") && !file.startsWith("long-form/")) {
      if (!definitions[file]) throw new Error(`Unexpected catalog file ${file}`);
      continue;
    }
    const framework = validated<CatalogFramework>(file);
    if (path.basename(file, ".yaml") !== framework.id || framework.form !== (file.startsWith("short-form/") ? "short" : "long")) {
      throw new Error(`Catalog framework filename/form mismatch: ${file}`);
    }
    frameworks.push(framework);
  }
  const hooks = validated<{ patterns: CatalogHook[] }>("hooks/hook-patterns.yaml", "hooks_file").patterns;
  const selection = validated<SelectionRules>("rubrics/selection.yaml", "selection_file");
  const validDefaults = ajv.compile({
    type: "object", required: ["goal_weight", "penalty", "max_candidates", "min_candidates", "max_per_family"], additionalProperties: false,
    properties: {
      goal_weight: { type: "number", minimum: 0 }, penalty: { type: "number", minimum: 0 },
      max_candidates: { type: "integer", minimum: 1 }, min_candidates: { type: "integer", minimum: 0 },
      max_per_family: { type: "integer", minimum: 1 },
    },
  });
  if (!validDefaults(selection.scoring.defaults)) throw new Error(`Invalid catalog selection defaults: ${ajv.errorsText(validDefaults.errors)}`);
  const shared = validated<SharedRubric>("rubrics/shared.yaml", "shared_rubric_file");
  if (!Number.isFinite(shared.scoring.framework_weight) || shared.scoring.framework_weight < 0 || shared.scoring.framework_weight > 1) throw new Error("Invalid catalog framework scoring weight");
  const sources = validated<{ sources: CatalogSource[] }>("sources.yaml", "sources_file").sources;
  const platforms = {
    x: validated<PlatformPolicy>("platforms/x.yaml", "platform_file"),
    linkedin: validated<PlatformPolicy>("platforms/linkedin.yaml", "platform_file"),
  };
  assertRegistered(frameworks.map(item => item.id), FRAMEWORK_IDS, "framework");
  assertRegistered(hooks.map(item => item.id), HOOK_IDS, "hook");
  assertRegistered(selection.signals.map(item => item.id), SIGNAL_IDS, "signal");
  assertRegistered(Object.keys(selection.matrix), FRAMEWORK_IDS, "matrix");
  const sourceIds = new Set(sources.map(source => source.id));
  if (sourceIds.size !== sources.length) throw new Error("Duplicate catalog source id");
  function checkReferences(value: unknown): void {
    if (Array.isArray(value)) value.forEach(checkReferences);
    else if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) {
      if (key === "source_ref" && !sourceIds.has(String(entry))) throw new Error(`Unknown catalog source ${entry}`);
      if (key === "source_refs" && Array.isArray(entry)) for (const id of entry) {
        if (!sourceIds.has(id)) throw new Error(`Unknown catalog source ${id}`);
      }
      checkReferences(entry);
    }
  }
  for (const [file, data] of documents) if (file !== "sources.yaml") checkReferences(data);
  for (const framework of frameworks) {
    for (const hook of framework.hook_patterns) if (!HOOK_IDS.includes(hook.pattern)) throw new Error(`Unknown hook ${hook.pattern}`);
    for (const other of framework.better_than) if (!FRAMEWORK_IDS.includes(other.framework) || other.framework === framework.id) throw new Error(`Invalid comparison for ${framework.id}`);
    if (framework.length.min > framework.length.max) throw new Error(`Invalid length range for ${framework.id}`);
    if (framework.examples.filter(example => example.fit === "exact" || example.fit === "partial").length < 2 && !framework.needs_examples) throw new Error(`Missing examples disclosure for ${framework.id}`);
    const criteria = framework.rubric.criteria.map(criterion => criterion.id);
    if (new Set(criteria).size !== criteria.length) throw new Error(`Duplicate criterion for ${framework.id}`);
    const row = selection.matrix[framework.id];
    const signals = Object.fromEntries(framework.when_to_use.source_signals.map(signal => [signal.signal, signal.weight]));
    const penaltyIf = framework.avoid_when.flatMap(avoid => avoid.signal ? [avoid.signal] : []);
    const penaltyMissing = framework.avoid_when.flatMap(avoid => avoid.missing_signal ? [avoid.missing_signal] : []);
    if (row.form !== framework.form || row.family !== framework.family || !equalRecords(row.signals, signals) || !equalRecords(row.goals, framework.when_to_use.goals)
      || !equalLists(row.penalize_if ?? [], penaltyIf) || !equalLists(row.penalize_if_missing ?? [], penaltyMissing)) {
      throw new Error(`Catalog selection matrix out of date for ${framework.id}`);
    }
  }
  for (const hook of hooks) {
    const expected = frameworks.filter(framework => framework.hook_patterns.some(pattern => pattern.pattern === hook.id)).map(framework => framework.id);
    if (!equalLists(hook.used_by, expected)) throw new Error(`Catalog hook used_by out of date for ${hook.id}`);
  }
  for (const comparison of selection.comparisons) if (!FRAMEWORK_IDS.includes(comparison.prefer) || !FRAMEWORK_IDS.includes(comparison.over)) throw new Error("Unknown framework comparison");
  for (const rule of [...shared.lint.ai_tells, ...shared.lint.other]) new RegExp(rule.pattern, "im");
  for (const platform of ["x", "linkedin"] as const) if (platforms[platform].platform !== platform) throw new Error(`Catalog platform mismatch: ${platform}`);
  return { version: hash.digest("hex"), frameworks, hooks, signals: selection.signals, shared, selection, platforms, sources };
}

function assertRegistered(actual: readonly string[], expected: readonly string[], kind: string): void {
  if (actual.length !== new Set(actual).size || !equalLists(actual, expected)) throw new Error(`Catalog ${kind} IDs do not match registered IDs`);
}
function equalLists(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}
function equalRecords(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());
}
export function summarizeCatalog(catalog: PostCatalog): WriteCatalogSummary {
  return {
    version: catalog.version,
    frameworks: catalog.frameworks.map(framework => ({
      id: framework.id, name: framework.name, form: framework.form, family: framework.family, summary: framework.summary,
      outline: framework.structure.map(section => `${section.section}: ${section.purpose}`),
      hookPatternIds: framework.hook_patterns.map(hook => hook.pattern),
    })),
    hooks: catalog.hooks.map(({ id, name, template, description, pitfalls }) => ({ id, name, template, description, pitfalls })),
    signals: catalog.signals.map(({ id, description }) => ({ id, description })),
  };
}

/** An editorial instruction packet; examples are excluded so they cannot become the author's facts. */
export function frameworkInstructions(catalog: PostCatalog, id: string, hookId?: string) {
  const framework = catalog.frameworks.find(item => item.id === id);
  if (!framework) throw new Error(`Unknown framework ${id}`);
  const hook = hookId ? catalog.hooks.find(item => item.id === hookId) : undefined;
  if (hookId && (!hook || !framework.hook_patterns.some(item => item.pattern === hookId))) throw new Error(`Hook ${hookId} does not belong to framework ${id}`);
  return {
    catalogVersion: catalog.version,
    framework: {
      id: framework.id, name: framework.name, summary: framework.summary, structure: framework.structure,
      length: framework.length, rubric: framework.rubric, avoid_when: framework.avoid_when, platform_notes: framework.platform_notes,
    },
    shared: { criteria: catalog.shared.criteria, lint: catalog.shared.lint },
    hook: hook ? { id: hook.id, template: framework.hook_patterns.find(item => item.pattern === hook.id)!.template, pitfalls: hook.pitfalls } : undefined,
    referencePolicy: "Framework and hook templates describe structure only. Fill them solely with cited evidence and author notes; never adopt reference authors' experiences, achievements or wording. Platform ranking claims are uncertain guidance, not guaranteed algorithm rules. The author profile overrides framework CTA suggestions. Single-paragraph insight intentionally overrides the shared whitespace/sentence-count guidance.",
  };
}
