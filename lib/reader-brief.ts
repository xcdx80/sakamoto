import { PaidWorkError } from "./paid-work";
import { undash, type BriefData } from "./article";
import type { DocPayload } from "./prompts";
const cited = {
  type: "object",
  properties: { text: { type: "string" }, cite: { type: "integer" } },
  required: ["text", "cite"],
  additionalProperties: false,
};
export const BRIEF_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "reader_brief",
    strict: true,
    schema: {
      type: "object",
      properties: {
        gist: { type: "string" },
        claims: { type: "array", items: cited },
        caveats: { type: "array", items: cited },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              start: { type: "integer" },
            },
            required: ["title", "start"],
            additionalProperties: false,
          },
        },
      },
      required: ["gist", "claims", "caveats", "sections"],
      additionalProperties: false,
    },
  },
};
export function readBrief(raw: string, doc: DocPayload): BriefData {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new PaidWorkError(
      "invalid_response",
      "The summary was not valid JSON. Retry intentionally from the budget panel.",
    );
  }
  const valid = new Set(doc.paras.map((p) => p.n)),
    clean = (s: string) => undash(s).replace(/==/g, "");
  const fields = (x: unknown, keys: string[]) =>
    x !== null &&
    typeof x === "object" &&
    Object.keys(x).every((k) => keys.includes(k)) &&
    keys.every((k) => Object.hasOwn(x, k));
  if (
    !fields(value, ["gist", "claims", "caveats", "sections"]) ||
    typeof value.gist !== "string" ||
    !value.gist.trim()
  )
    throw new PaidWorkError(
      "invalid_response",
      "The summary response had an invalid shape.",
    );
  const list = (v: unknown, max: number, allowZero = false) => {
    if (
      !Array.isArray(v) ||
      v.length > max ||
      !v.every(
        (x) =>
          fields(x, ["text", "cite"]) &&
          typeof x.text === "string" &&
          x.text.trim() &&
          Number.isInteger(x.cite) &&
          ((allowZero && x.cite === 0) || valid.has(x.cite)),
      )
    )
      throw new PaidWorkError(
        "invalid_response",
        "The summary cited an unavailable saved paragraph.",
        502,
      );
    return v.map((x) => ({ text: clean(x.text), cite: x.cite }));
  };
  if (
    !Array.isArray(value.sections) ||
    value.sections.length > 10 ||
    !value.sections.every(
      (x: any) =>
        fields(x, ["title", "start"]) &&
        typeof x.title === "string" &&
        x.title.trim() &&
        valid.has(x.start),
    )
  )
    throw new PaidWorkError(
      "invalid_response",
      "The summary contains an unavailable section address.",
      502,
    );
  return {
    gist: clean(value.gist),
    claims: list(value.claims, 6),
    caveats: list(value.caveats, 4, true),
    sections: value.sections
      .map((x: any) => ({ title: clean(x.title), start: x.start }))
      .sort((a: any, b: any) => a.start - b.start),
  };
}
