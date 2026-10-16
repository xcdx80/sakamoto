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
  ].join("\n\n");
}
export function answerRetrievalNotice(answer: LibraryAnswer) {
  switch (answer.retrieval.semanticStatus) {
    case "available":
      return "Meaning and exact-word search of saved passages.";
    case "paused":
      return `${answer.retrieval.semanticError ?? "Meaning search is paused."} Available exact-word matches were used.`;
    case "disabled":
      return "Exact-word search; meaning search was disabled for this question.";
    case "pending":
      return "Semantic indexing is pending; available exact-word matches were used. Process received material and ask again for broader coverage.";
  }
}
