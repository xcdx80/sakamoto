# Post coherence regression evaluation

This is a small, inspectable regression corpus, not a benchmark that proves model quality. It tests whether the production reviewer can distinguish connected arguments from plausible-sounding jumps without imposing a hook → problem paragraph → solution template.

## Production behavior

Prompt version `post-production-v25` adds platform-aware connection guidance to both first writing and targeted revision. The writer should establish the reader-facing reason a proposed method answers the hook when that connection is missing, not insert a stock problem paragraph.

The existing Jev rubric pass and independent `gpt-6-sol` review now assess shared criterion `narrative-coherence` (gate, threshold 4/5). They inspect hook payoff, necessary context, transitions and references, judging the weakest platform adaptation. A confident Jev failure, the independent review's low score, or a binding coherence issue still requires revision. Passing uncertain coherence judgments require actual draft quotes for every platform, not unrelated source citations.

The reviewer is asked to quote the adjacent wording, identify the missing connection and give a targeted edit with its platform/post index. Its diagnosis and feedback pass through the existing bounded two-round revision loop. A global threshold issue does not invent a failing platform when the model did not locate one. Saved wording and earlier revisions remain intact; no passing review grants author approval or publication permission.

Catalog hashing and the prompt version invalidate stale review eligibility. The new rubric is for subsequent generation/review under current rules; it does not silently rewrite existing posts. If an existing production has an older catalog snapshot, the normal explicit fresh-generation path is needed. Existing historical decisions remain attached to their original wording.

## Labels and scope

`evals/post-coherence/cases.json` contains development and validation splits. Each case includes the complete published text, delivery, framework, expected **narrative-coherence** decision, targeted defect and reason. An integer score of 4 or 5 predicts `pass` only when that criterion has no binding Jev failure or block/revise `narrative_coherence` issue; a score of 1–3, a binding Jev failure or a binding coherence issue predicts `revise`. Duplicate, missing or invalid coherence scores are evaluation errors.

The original X case preserves the exact full draft paragraph intended for publication that prompted the user's complaint on 2026-11-09. Its label provenance is `user-reported-original`: the user identified the jump from personalization needing to earn its place to the evaluation layers without first explaining the problem. It is not a general human-panel rating. No private brief, notes, account profile or job context is included. The LinkedIn variant and all authored counterexamples have **proposed labels needing human calibration**, not claimed human judgments.

Cases cover a compact one-paragraph X bridge, question-first and direct-thesis openings, a longer LinkedIn proposal, thread progression and detours, a false “therefore,” a bridge without payoff, padding and a coherent invented-results control. The last case intentionally expects coherence to pass but grounding specifically to fail (a `grounded-in-sources` score below its threshold of 5, binding Jev failure, or block/revise `unsupported_claim` issue), as well as the overall review to request changes or block: a smoother argument must not excuse unsupported factual claims. An unrelated style or length failure cannot satisfy this grounding control.

Coherence is graded separately from overall review status because framework length, grounding and other gates may correctly request revision even when an argument connects. In particular, the original draft pins `single-paragraph-insight` as in its actual review; its length may fail that framework independently. Neither extra paragraphs nor a transition word count as evidence of repaired reasoning. All cases use a neutral public-only profile, no source evidence and no alternate hooks. These are controlled coherence fixtures, not a recreation of the author's private production context. Other gates may fail as a consequence; inspect the full result.

## Offline validation (no database or model calls)

From the repository root:

```sh
node --import tsx scripts/eval-post-coherence.ts --out /tmp/coherence-validate-unique.json
node --import tsx --test tests/post-coherence-eval.test.ts
```

Default mode validates and lists up to 20 corpus cases, writes a report, and never loads the provider/database modules. Output must be a new path; existing reports are never overwritten on startup. `--cases`, `--split development|validation`, and `--limit 1..20` are available. Fixture-adapter tests prove parsing, dispatch boundaries, classification and failure recording only. They do not establish that a real reviewer detects coherence defects.

## Explicit paid live run

Only after intentionally configuring an authorized owner's normal database, production credentials and budgets:

```sh
node --import tsx scripts/eval-post-coherence.ts \
  --live --owner AUTHORIZED_OWNER --split development --limit 1 \
  --out /private/new-coherence-live-report.json
```

The runner does not load `.env.local`, create credentials, bypass qualification, change budgets or mutate posts/publication state. Choose the process environment deliberately. The real `reviewPost` path retains qualified independent models, TypeSafe decisions, grounding checks, bounded paid reservations and durable usage accounting. Live evaluation therefore incurs normal review charges and writes normal paid-work accounting. `--live` and `--owner` are both mandatory; default live limit is one case and maximum is twenty. No live run is part of the default test suite.

Each run has a unique ID, and each case has a stable operation ID inside that run. The report records selected cases, prompt/catalog versions, returned reviewer metadata, the complete `reviewPost` result or diagnostic error and elapsed time. “Raw result” means the full result returned at that public boundary, not vendor HTTP payloads. Labels, reasons, split names and targeted defects are never passed to the model. The runner checkpoints a pending row with the operation ID before dispatch and the result after each case, makes no retries and stops after the first provider/configuration/budget error. An interrupted or uncertain paid operation must be investigated using its recorded operation ID and existing paid-work reconciliation before explicitly starting another run. A new invocation is a new paid run, not a resume.

Reports distinguish misclassification, missing/invalid criterion and provider failures. Failed cases are excluded from scored counts, never silently converted into correct `revise` labels. Exit status is nonzero on any misclassification, control failure or runtime error. Preserve reports privately, including failed attempts. Output is created mode 0600; do not publish provider diagnostics blindly.

## Calibration and change comparison

1. Have a human review the proposed labels and ambiguous cases before interpreting aggregate accuracy. Record any changed labels and the reason in the corpus/review record.
2. Tune on development only. Keep validation cases unchanged during the experiment; this initial small set was authored alongside the change and is not a statistically independent benchmark.
3. Run the same selected cases, public context, qualified models and budgets against a pinned baseline and candidate. Preserve both reports and their code revisions. Compare per-case reasons, false passes, false revisions, provider errors and the factual-grounding control, not just pass count.
4. Inspect whether a failing coherence judgment identifies the actual location and missing connection, rather than asking for generic padding or a mandatory paragraph. Verify suggested fixes do not invent findings or change the author's stance.
5. Do not claim improvement from offline tests or a single model response. Repeat deliberately only when authorized, considering cost and stochastic variation. Add newly observed failures with independent validation labels over time.

This harness evaluates review judgments only. End-to-end generation and revision quality, including whether the writer repairs a detected gap without adding padding or unsupported claims, still needs separately reviewed real-provider evidence. No such evidence is implied by the corpus or plumbing tests.
