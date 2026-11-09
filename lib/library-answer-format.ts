import type { LibraryAnswer } from "./library-answer";
/** Plain text for MCP clients; citations remain structured in the result as well. */
export function libraryAnswerText(answer: LibraryAnswer) {
  return [
    answer.status,
    ...answer.claims.map((c) => `${c.text} [${c.citationIds.join(", ")}]`),
    ...answer.gaps,
    answer.notice,
    answerRetrievalNotice(answer),
    ...answer.citations.map(
      (c) =>
        `[${c.id}] ${c.title}${c.author ? ` by ${c.author}` : ""} — ${c.readUrl}${c.originalUrl ? ` (original: ${c.originalUrl})` : ""}\n${c.excerpt}`,
    ),
    ...(answer.matches ?? []).filter(source => !answer.citations.some(citation => citation.id === source.id)).map(
      source => `Related saved reading (not cited as answer support): [${source.id}] ${source.title} — ${source.readUrl}\n${source.excerpt}`,
    ),
  ].join("\n\n");
}
export function answerRetrievalNotice(answer: LibraryAnswer) {
  const coverage = answer.retrieval.coverage;
  const incomplete = coverage && coverage.indexedSources < coverage.sources
    ? ` Meaning search covers ${coverage.indexedSources} of ${coverage.sources} eligible saved sources; other sources can still match by wording.`
    : "";
  switch (answer.retrieval.semanticStatus) {
    case "available":
      return "Meaning and wording search of saved passages." + incomplete;
    case "paused":
      return `${answer.retrieval.semanticError ?? "Meaning search is paused."} Available wording matches were used.` + incomplete;
    case "disabled":
      return "Wording search; meaning search was disabled for this question.";
    case "pending":
      return "Semantic indexing is pending; available wording matches were used." + incomplete;
  }
}
