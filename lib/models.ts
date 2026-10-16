/**
 * The model allow-list and wire types. Safe to import on the client: no keys,
 * no fetches. Provider adapters own external I/O.
 */

export type ModelEntry = {
  id: string;
  label: string;
  short: string;
  blurb: string;
  inPerM: number;
  cachedPerM: number;
  outPerM: number;
};

/** Luna is the active reader model. Flash remains addressable only for saved historical receipts. */
export const MODELS = {
  luna: {
    id: "gpt-6-luna", label: "OpenAI Luna", short: "Luna",
    blurb: "Answers with citations to the saved text.",
    inPerM: 0.10, cachedPerM: 0.01, outPerM: 0.50,
  },
  flash: {
    id: "deepseek-ai/DeepSeek-V4.1-Flash",
    label: "DeepSeek V4.1 Flash",
    short: "Quick",
    blurb: "Historical saved answer model.",
    inPerM: 0.3,
    cachedPerM: 0.006,
    outPerM: 1.2,
  },
} as const satisfies Record<string, ModelEntry>;

export type ModelKey = keyof typeof MODELS;
export const DEFAULT_MODEL: ModelKey = "luna";

export function isModelKey(v: unknown): v is ModelKey {
  return typeof v === "string" && Object.hasOwn(MODELS, v);
}

/** Historical supported keys retain attribution; unavailable choices use the active reader model. */
export const modelOf = (v: unknown): ModelKey => (isModelKey(v) ? v : DEFAULT_MODEL);

export type Usage = {
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  costUsd: number;
};

/** Dollars for a run. Cached prompt tokens bill at the cached rate. */
export function costFor(key: ModelKey, prompt: number, cached: number, completion: number): number {
  const m: ModelEntry = MODELS[key];
  const fresh = Math.max(0, prompt - cached);
  return (fresh * m.inPerM + cached * m.cachedPerM + completion * m.outPerM) / 1_000_000;
}

/** A web result an answer can cite as [n]. */
export type Source = { n: number; title: string; url: string; site: string; date?: string };

export type StreamEvent =
  | { type: "meta"; model: string }
  | { type: "searching" }
  /** The model asked for a tool (web search); the route runs it and asks again. Never sent to the browser. */
  | { type: "tool"; id: string; name: string; args: string }
  /** Drop what was written so far: a line before a tool call ("I'll look that up") that the real answer replaces. */
  | { type: "reset" }
  | { type: "sources"; sources: Source[] }
  | { type: "content"; text: string }
  | { type: "usage"; usage: Usage }
  | { type: "done" }
  | { type: "error"; text: string };

/** Neutral chat wire types shared by prompts and the selected answer adapter. */
export type ToolCall = {id:string;type:"function";function:{name:string;arguments:string}};
export type ChatMessage =
  | {role:"system"|"user";content:string}
  | {role:"assistant";content:string|null;tool_calls?:ToolCall[]}
  | {role:"tool";content:string;tool_call_id:string};
