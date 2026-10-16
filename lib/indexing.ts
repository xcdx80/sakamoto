import { db } from "./db";
import { embedText } from "./google-embeddings";
import { EMBEDDING_CONTRACT, INDEX_CONTRACT } from "./retrieval-contract";
import { PaidWorkError } from "./paid-work";
import type { ProcessingContext, ProcessingOutcome } from "./processing";
/** Reuses paid vectors across retries/revisions. Only the engine's fenced publication makes them eligible. */
export async function indexSavedSource(
  context: ProcessingContext,
): Promise<ProcessingOutcome> {
  const { owner, job, signal, deadline, checkpoint } = context;
  if (job.target !== INDEX_CONTRACT)
    return {
      state: "terminal",
      error:
        "This embedding contract is obsolete. Request a rebuild with the current contract.",
    };
  const [source] = await db().query(
    "select md5(doc::text) as fingerprint from articles where user_id=$1 and id=$2 and source_revision=$3 and not deleted and doc is not null",
    [owner, job.sourceId, job.sourceRevision],
  );
  if (!source)
    return { state: "terminal", error: "Source is no longer eligible." };
  const passages = await db().query(
    `select p.*,e.embedding is not null as cached from saved_passages p left join passage_embeddings e on e.user_id=p.user_id and e.contract=$4 and e.content_fingerprint=p.content_fingerprint where p.user_id=$1 and p.source_id=$2 and p.source_revision=$3 order by p.ordinal`,
    [owner, job.sourceId, job.sourceRevision, INDEX_CONTRACT],
  );
  const available = new Set(
    passages.filter((p) => p.cached).map((p) => p.content_fingerprint),
  );
  let completed = 0;
  for (const passage of passages) {
    if (signal.aborted || Date.now() + 500 >= deadline)
      return {
        state: "retryable",
        error: "Indexing checkpoint saved; resume processing to continue.",
        checkpoint: { completed },
      };
    if (!(await checkpoint({ completed })))
      return {
        state: "terminal",
        error: "Indexing lease or source revision is no longer current.",
      };
    if (!available.has(passage.content_fingerprint)) {
      try {
        const vector = await embedText(
          owner,
          passage.input,
          `index:${job.sourceId.slice(0, 80)}:${passage.content_fingerprint}`,
          signal,
        );
        await db().query(
          `insert into passage_embeddings(user_id,contract,content_fingerprint,model,dimensions,prompt_version,chunk_version,embedding) values($1,$2,$3,$4,$5,$6,$7,$8::public.vector) on conflict do nothing`,
          [
            owner,
            INDEX_CONTRACT,
            passage.content_fingerprint,
            EMBEDDING_CONTRACT.model,
            EMBEDDING_CONTRACT.dimensions,
            EMBEDDING_CONTRACT.promptVersion,
            EMBEDDING_CONTRACT.chunkVersion,
            JSON.stringify(vector),
          ],
        );
        available.add(passage.content_fingerprint);
      } catch (error) {
        return {
          state:
            error instanceof PaidWorkError && error.code === "provider_rejected"
              ? "terminal"
              : "retryable",
          error:
            error instanceof PaidWorkError
              ? error.message
              : "Embedding interrupted; potentially billed work remains reserved.",
          checkpoint: { completed },
        };
      }
    }
    completed++;
  }
  return {
    state: "complete",
    checkpoint: { completed },
    publication: {
      contract: INDEX_CONTRACT,
      contentFingerprint: source.fingerprint,
    },
  };
}
