import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runPostCoherenceEvaluation } from "../scripts/eval-post-coherence";

test("default coherence evaluation validates public corpus without calling a provider", async () => {
  const out = join(await mkdtemp(join(tmpdir(), "coherence-eval-")), "report.json");
  const report = await runPostCoherenceEvaluation(["--out", out], async () => { throw new Error("unexpected provider call"); });
  assert.equal(report.mode, "validate");
  assert.ok(report.cases.length >= 12);
  assert.equal(JSON.parse(await readFile(out, "utf8")).mode, "validate");
});

test("live review gets no labels; criterion classification is distinct from unrelated review status", async () => {
  const out = join(await mkdtemp(join(tmpdir(), "coherence-eval-")), "report.json");
  const report = await runPostCoherenceEvaluation(["--live", "--owner", "isolated-fixture-owner", "--out", out, "--limit", "2"], async (context, content, writerModel) => {
    assert.equal("expected" in context, false);
    assert.equal("reason" in context, false);
    assert.equal("targetedDefect" in context, false);
    assert.deepEqual(context.evidence, []);
    assert.equal(writerModel, "gpt-6-luna");
    const original = content.variants[0].posts[0].startsWith("Underrated AI education advice:");
    return { status: "changes_requested", issues: [], criteria: [{ id: "narrative-coherence", score: original ? 2 : 4, reason: "Isolated plumbing fixture, not model quality evidence." }], writerModel, reviewerModel: "gpt-6-sol" };
  });
  assert.equal(report.mode, "fixture-plumbing");
  assert.deepEqual(report.rows.map(row => row.outcome), ["matched", "matched"]);
  assert.equal(report.rows[1].rawResult?.status, "changes_requested");
});

test("provider failures retain diagnostic result and stop instead of becoming misclassifications or retries", async () => {
  const out = join(await mkdtemp(join(tmpdir(), "coherence-eval-")), "report.json");
  let calls = 0;
  const report = await runPostCoherenceEvaluation(["--live", "--owner", "isolated-fixture-owner", "--out", out, "--limit", "3"], async () => {
    calls++;
    throw Object.assign(new Error("Fixture unsettled paid work"), { code: "paid_work_unresolved" });
  });
  assert.equal(calls, 1);
  assert.equal(report.rows[0].outcome, "error");
  assert.equal(report.rows[0].error?.code, "paid_work_unresolved");
  assert.equal(report.summaries?.[0].scored, 0);
  assert.equal(JSON.parse(await readFile(out, "utf8")).rows[0].error.code, "paid_work_unresolved");
});

test("unsafe live options and existing output files fail before any review call", async () => {
  const out = join(await mkdtemp(join(tmpdir(), "coherence-eval-")), "report.json");
  const adapter = async (): Promise<never> => { assert.fail("Must not dispatch"); };
  await assert.rejects(runPostCoherenceEvaluation(["--live", "--out", out], adapter), /owner/);
  await assert.rejects(runPostCoherenceEvaluation(["--live", "--owner", "fixture", "--out", out, "--limit", "21"], adapter), /Limit/);
  await assert.rejects(runPostCoherenceEvaluation([], adapter), /out/);
  await runPostCoherenceEvaluation(["--out", out], adapter);
  await assert.rejects(runPostCoherenceEvaluation(["--live", "--owner", "fixture", "--out", out], adapter), /EEXIST/);
});

test("missing coherence criteria preserve the result as an evaluation error", async () => {
  const out = join(await mkdtemp(join(tmpdir(), "coherence-eval-")), "report.json");
  const report = await runPostCoherenceEvaluation(["--live", "--owner", "fixture", "--out", out], async () => ({ status: "passed", issues: [], criteria: [], writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol" }));
  assert.equal(report.rows[0].outcome, "error");
  assert.equal(report.rows[0].rawResult?.status, "passed");
  assert.equal(report.rows[0].predicted, undefined);
});

test("corpus preserves the reported opening and reserves distinct validation counterexamples", async () => {
  const cases = JSON.parse(await readFile("evals/post-coherence/cases.json", "utf8"));
  const original = cases.find((c: { id: string }) => c.id === "original-personalization-jump");
  assert.ok(original.posts[0].startsWith("Underrated AI education advice: personalization must earn its place in learning. I’d evaluate an AI learning tool in three distinct layers: offline checks of agent behavior, simulated learners as limited proxies, and real, delayed tests of retention and transfer."));
  assert.equal(original.labelProvenance, "user-reported-original");
  assert.ok(original.posts[0].endsWith("The practical test is whether learners retain and apply concepts, not whether the agent sounds helpful."));
  assert.ok(cases.some((c: { split: string; expected: string }) => c.split === "validation" && c.expected === "pass"));
  assert.ok(cases.some((c: { split: string; expected: string }) => c.split === "validation" && c.expected === "revise"));
  assert.ok(cases.some((c: { expected: string; expectedOverall?: string }) => c.expected === "pass" && c.expectedOverall === "revise"));
});

test("binding Jev coherence failure overrides a high reviewer score", async () => {
  const out = join(await mkdtemp(join(tmpdir(), "coherence-eval-")), "report.json");
  const report = await runPostCoherenceEvaluation(["--live", "--owner", "fixture", "--out", out], async () => ({
    status: "changes_requested", issues: [{ code: "rubric_threshold", severity: "revise", message: "narrative-coherence failed" }],
    criteria: [{ id: "narrative-coherence", score: 5, reason: "Reviewer pass", decision: "jev_failure", assessment: { model: "jev-latest", outcome: "fail", score: 2, passProbability: 0.1 } }],
    writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol",
  }));
  assert.equal(report.rows[0].predicted, "revise");
  assert.equal(report.rows[0].outcome, "matched");
});

test("operation identity is checkpointed before dispatch for interrupted-run reconciliation", async () => {
  const out = join(await mkdtemp(join(tmpdir(), "coherence-eval-")), "report.json");
  await runPostCoherenceEvaluation(["--live", "--owner", "fixture", "--out", out], async context => {
    const checkpoint = JSON.parse(await readFile(out, "utf8"));
    assert.equal(checkpoint.rows[0]?.operationId, context.operationId);
    assert.equal(checkpoint.rows[0]?.outcome, "pending");
    return { status: "changes_requested", issues: [], criteria: [{ id: "narrative-coherence", score: 2, reason: "Fixture" }], writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol" };
  }).then(report => assert.equal(report.rows[0].outcome, "matched"));
});

test("invented-fact control fails when only an unrelated style gate fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coherence-eval-"));
  const { writeFile } = await import("node:fs/promises");
  const cases = JSON.parse(await readFile("evals/post-coherence/cases.json", "utf8"));
  const control = cases.find((c: { id: string }) => c.id === "invented-result-control");
  await writeFile(join(directory, "cases.json"), JSON.stringify([control]));
  const report = await runPostCoherenceEvaluation(["--live", "--owner", "fixture", "--cases", join(directory, "cases.json"), "--out", join(directory, "report.json")], async () => ({
    status: "changes_requested", issues: [{ code: "style", severity: "revise", message: "Style only" }],
    criteria: [{ id: "narrative-coherence", score: 5, reason: "Connected" }, { id: "grounded-in-sources", score: 5, reason: "Incorrectly accepts invented facts" }],
    writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol",
  }));
  assert.equal(report.rows[0].outcome, "matched");
  assert.equal(report.summaries?.[0].controlFailures, 1);
});

test("binding coherence issues override a high score but suggestions do not", async () => {
  for (const severity of ["block", "revise", "suggestion"] as const) {
    const out = join(await mkdtemp(join(tmpdir(), "coherence-eval-")), "report.json");
    const report = await runPostCoherenceEvaluation(["--live", "--owner", "fixture", "--out", out], async () => ({
      status: "changes_requested", issues: [{ code: "narrative_coherence", severity, message: "Fixture" }],
      criteria: [{ id: "narrative-coherence", score: 5, reason: "Fixture" }], writerModel: "gpt-6-luna", reviewerModel: "gpt-6-sol",
    }));
    assert.equal(report.rows[0].predicted, severity === "suggestion" ? "pass" : "revise");
  }
});
