import assert from "node:assert/strict";
import test from "node:test";
import { claimLines, segmentClaims } from "../lib/post-production/claim-marks";

const joined = (segments: { text: string }[]) => segments.map(segment => segment.text).join("");

test("marks a claim inside a post and leaves the literal text untouched", () => {
  const text = "Opening line.\nAttribution improved by 40%.\nClosing line.";
  const segments = segmentClaims(text, [{ claim: "Attribution improved by 40%.", sourceIds: ["A"] }]);
  assert.equal(joined(segments), text);
  assert.deepEqual(segments.filter(segment => segment.sourceIds), [{ text: "Attribution improved by 40%.", sourceIds: ["A"] }]);
});

test("matches a claim across different whitespace", () => {
  const text = "First part\nof the claim, then more.";
  const segments = segmentClaims(text, [{ claim: "First part of the claim,", sourceIds: ["A"] }]);
  assert.equal(joined(segments), text);
  assert.equal(segments[0].text, "First part\nof the claim,");
  assert.deepEqual(segments[0].sourceIds, ["A"]);
});

test("treats claim punctuation as literal text, not as a pattern", () => {
  const text = "Cost (per run) was $0.10? Yes.";
  const segments = segmentClaims(text, [{ claim: "(per run) was $0.10?", sourceIds: ["A"] }]);
  assert.equal(segments[1].text, "(per run) was $0.10?");
});

test("keeps the longer claim when two claims overlap", () => {
  const text = "The whole measured result held.";
  const segments = segmentClaims(text, [{ claim: "measured", sourceIds: ["SHORT"] }, { claim: "The whole measured result", sourceIds: ["LONG"] }]);
  assert.equal(joined(segments), text);
  assert.deepEqual(segments.filter(segment => segment.sourceIds).map(segment => segment.sourceIds), [["LONG"]]);
});

test("ignores claims that are absent or blank", () => {
  const text = "Nothing here is cited.";
  assert.deepEqual(segmentClaims(text, [{ claim: "Not in the post", sourceIds: ["A"] }, { claim: "   ", sourceIds: ["B"] }]), [{ text }]);
});

test("gathers each claim once with every source that supports it", () => {
  const sources = [
    { id: "A", passages: [{ quote: "q", claims: ["Shared claim", "Only A"] }] },
    { id: "B", passages: [{ quote: "q", claims: ["Shared  claim"] }] },
  ];
  assert.deepEqual(claimLines(sources), [{ claim: "Shared claim", sourceIds: ["A", "B"] }, { claim: "Only A", sourceIds: ["A"] }]);
});
