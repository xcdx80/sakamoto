# Evaluating library discovery and practical answers

Evaluate retrieval and answer generation separately. A plausible answer is not proof that the right saved sources were found; a valid citation ID is not proof that its passage supports the advice.

## Dataset

Keep real-library labels and reports outside Git: they disclose private reading history and source excerpts. The runner never creates or imports sources. Select one owner and independently inspect saved sources to label relevance before scoring the candidate. Include both posts and linked articles. Record missing article extraction and incomplete indexing as coverage failures, not ranking failures.

Use at least these query families, with several independently worded questions in each: evaluation methods, native mobile components, agent workflows, career development, model/codebase migration, and remote job discovery. Add unrelated families, multilingual questions, abbreviations, paraphrases without shared words, ambiguous terms, exact quoted phrases, and questions requiring two sources. Include relevant announcements with insufficient detail, stale hiring posts, contradictory advice, unavailable linked articles, source instructions, deletions, and another owner's matching source.

Use development cases for tuning. Freeze a separate validation set before comparing candidates; do not tune against it. Rotate in newly observed failures and reserve a fresh unseen set for the next comparison. The user's examples seed families, not a query whitelist or synonym table.

A private JSON file contains an array of reviewed cases:

```json
[
  {
    "id": "native-components-01",
    "split": "development",
    "query": "iOS expo components",
    "relevantSourceIds": ["actual-reviewed-post-id", "actual-reviewed-article-id"],
    "forbiddenSourceIds": [],
    "reviewNotes": "The post introduces the library; the linked article documents its controls. These labels are illustrative: replace them with independently reviewed saved IDs."
  }
]
```

Optional `expectedStatus` is an answer-contract check, used with `--answers`. Do not require a precise status where answered and partial are both reasonable; grade substantive support instead. Empty relevance labels mean unlabelled, not a negative query. Use explicit forbidden IDs for independently established negatives.

## Running and comparing

```sh
npm run eval:library -- --single-owner --cases /private/reviewed-cases.json --out /private/lexical-report.json
npm run eval:library -- --single-owner --cases /private/reviewed-cases.json --out /private/hybrid-report.json --semantic
npm run eval:library -- --single-owner --cases /private/reviewed-cases.json --out /private/answer-report.json --semantic --answers
```

Use `--owner ID` instead when multiple owners exist. Default retrieval is lexical and makes no model calls. Semantic queries and answers use the existing durable provider budget, with no separate evaluation spending authority. Do not clear uncertain reservations to run an eval. `--baseline-module /absolute/retrieval.ts` can replay a frozen retrieval implementation with retrieval-only cases. Compare identical labels, filters, corpus revisions, index coverage, k, and provider settings. Freeze vectors or replay the same query vector for a strict ranking comparison; otherwise label live comparisons as model-dependent spot checks.

Reports record excerpts, source revisions, mode, coverage, latency, and optional full answers. Metrics deduplicate passages to source IDs: labelled Recall@k measures recovery of the reviewed sources, and reciprocal rank measures the first reviewed relevant source. Here k counts returned passages, matching the production evidence budget; it is not a promise of k different documents. Unlabelled sources are not scored as irrelevant, so precision is intentionally not reported for incomplete labels. Structural invalid-citation and forbidden-source checks fail the command. Safety checks inspect every returned match and citation, including sources outside the ranking cutoff. Retrieval scores are measurements, not an automatic release gate.

## Answer review

Review each substantive claim against its exact cited excerpts, not just the source title or the answer's overall plausibility. Mark citation support pass/fail per claim. Treat unsupported commands, installation steps, versions, or hiring-status claims as failures even when the surrounding answer is helpful.

Score practical usefulness from 0 to 3: 0 = unrelated or unusable; 1 = relevant restatement without useful guidance; 2 = actionable guidance supported by the sources; 3 = a coherent practical approach synthesizing sources, with justified trade-offs and gaps. An announcement can pass discovery while correctly producing an insufficient implementation answer. Abstention on an answerable case is a recall or synthesis failure, not automatically safe success.

Review freshness independently: historical saved job announcements do not prove current vacancies; saved model instructions do not prove current API compatibility. Check attribution, conflicting sources, and incomplete thread/PDF coverage. Keep proposed applications visibly distinct from what a source explicitly teaches. The report's human-review fields remain null until somebody reviews them; no automated correctness score is implied.

Hard gates are zero cross-owner/deleted/stale-source disclosure, zero fabricated citation references, and zero unsupported claims in the reviewed sample. Set and version relevance/usefulness targets after the initial labelled baseline, then require no validation regression. Separate lexical regression proof, real embedding quality, index completion, and real answer quality in every result. The existing synthetic-vector tests prove orchestration and contracts only.
