/** Saved-source categorization, budget orchestration and explicit scheduling. */
import { blockText, type Article } from "./article";
import { db } from "./db";
import { TAXONOMY, jevRequest, decideCategory, categoryOf } from "./typesafe";
import {
  reservePaidWork,
  settlePaidWork,
  recordPaidResponse,
  recordPaidFailure,
  releaseRejectedPaidWork,
  PaidWorkError,
  type PaidReservation,
} from "./paid-work";
import type { ProcessingContext, ProcessingOutcome } from "./processing";
export async function classifySavedSource({
  owner,
  job,
  signal,
}: ProcessingContext): Promise<ProcessingOutcome> {
  const rows = await db().query(
    `select doc,md5(doc::text) as fingerprint from articles where user_id=$1 and id=$2 and source_revision=$3 and not deleted`,
    [owner, job.sourceId, job.sourceRevision],
  );
  if (!rows.length)
    return { state: "terminal", error: "Source is unavailable." };
  const { doc, fingerprint } = rows[0] as { doc: Article; fingerprint: string };
  const base = {
    taxonomy: TAXONOMY,
    fingerprint,
    sourceRevision: job.sourceRevision,
    requestedModel: "jev-latest",
  };
  let reservation: PaidReservation | undefined;
  try {
    const full = [doc.title, doc.author, ...doc.blocks.map(blockText)]
      .filter(Boolean)
      .join("\n");
    // Long sources use a declared bounded opening; source remains complete and unchanged.
    let state = full;
    while (Buffer.byteLength(state, "utf8") > 23000)
      state = state.slice(0, Math.floor(state.length * 0.9));
    const body = jevRequest(state),
      serializedInput = JSON.stringify(body);
    signal.throwIfAborted();
    reservation = await reservePaidWork({
      owner,
      operationId: `classify:${job.id}`,
      attemptId: `${job.attempts}`,
      model: "jev-latest",
      serializedInput,
      maxOutputTokens: 32768,
    });
    // No request has been sent while durable authorization was waiting.
    if (signal.aborted) {
      await releaseRejectedPaidWork(reservation);
      reservation = undefined;
      throw signal.reason;
    }
    const { data, cost } = await decideCategory(body, signal, (id) =>
      recordPaidResponse(reservation!, id ?? ""),
    );
    await settlePaidWork(reservation, cost);
    const result = categoryOf(data);
    return {
      state: "complete",
      publication: {
        ...base,
        ...result,
        status: result.uncertain ? "uncertain" : "complete",
        excerpted: state !== full,
        message: result.uncertain ? "No clear category; left Unsorted." : null,
      },
    };
  } catch (e) {
    if (reservation) {
      if (e instanceof PaidWorkError && e.code === "provider_rejected")
        await releaseRejectedPaidWork(reservation);
      else await recordPaidFailure(reservation, e);
    }
    const message =
      e instanceof PaidWorkError
        ? e.message
        : "Classification could not complete; source remains saved.";
    return {
      state: "complete",
      error: message,
      publication: {
        ...base,
        topic: "unsorted",
        status:
          e instanceof PaidWorkError &&
          ["budget_paused", "budget_unavailable", "configuration"].includes(
            e.code,
          )
            ? "paused"
            : "failed",
        message,
      },
    };
  }
}
/** Explicit reclassification, including existing articles/documents, shares the durable engine. */
export async function scheduleClassification(
  owner: string,
  args: { itemId?: unknown; reclassify?: unknown } = {},
) {
  if (
    typeof args.itemId !== "string" ||
    !args.itemId ||
    args.itemId.length > 300 ||
    (args.reclassify !== undefined && typeof args.reclassify !== "boolean")
  )
    throw new Error("Send a saved itemId and optional reclassify boolean.");
  const rows = await db().query(
    `insert into processing_jobs(user_id,source_id,source_revision,kind,target)
 select user_id,id,source_revision,'classification',$3 from articles where user_id=$1 and id=$2 and not deleted and doc is not null
 on conflict(user_id,source_id,source_revision,kind,target) do update set
 state=case when $4 and processing_jobs.state<>'running' then 'pending' else processing_jobs.state end,
 max_attempts=case when $4 and processing_jobs.state<>'running' then processing_jobs.attempts+4 else processing_jobs.max_attempts end,
 next_attempt_at=case when $4 and processing_jobs.state<>'running' then case when processing_jobs.error like 'TypeSafe throttled%' then greatest(clock_timestamp(),processing_jobs.updated_at+interval '1 minute') else clock_timestamp() end else processing_jobs.next_attempt_at end,
 error=case when $4 and processing_jobs.state<>'running' then null else processing_jobs.error end returning id::text,state`,
    [owner, args.itemId, TAXONOMY, args.reclassify === true],
  );
  if (!rows.length) throw new Error("Saved source not found.");
  return { itemId: args.itemId, jobId: rows[0].id, state: rows[0].state };
}
