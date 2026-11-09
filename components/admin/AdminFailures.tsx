"use client";

import { useState, type FormEvent } from "react";
import type { AdminFailures as Failures, FailureAction } from "@/lib/admin-failures";
import { submitFailureAction } from "@/lib/admin-failure-client";

export function AdminFailures({ owner, failures }: { owner: string; failures: Failures }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = failures.groups.filter(group => !group.lost);
  const lost = failures.groups.filter(group => group.lost);
  async function submit(command: FailureAction) {
    setBusy(true);
    setMessage("");
    try {
      const { changed } = await submitFailureAction(owner, command);
      setMessage(`${changed.toLocaleString("en-US")} tasks ${command.action === "retry-all" ? "queued for retry" : "marked lost"}. Refreshing…`);
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The action could not complete. Refresh and try again.");
      setBusy(false);
    }
  }
  function markGroup(event: FormEvent<HTMLFormElement>, key: string) {
    event.preventDefault();
    void submit({ action: "lose-group", key, reason: String(new FormData(event.currentTarget).get("reason") ?? "") });
  }
  return <section className="admin-panel admin-failures" aria-labelledby="admin-failures-heading" aria-busy={busy}>
    <h2 id="admin-failures-heading">Failure reasons</h2>
    <p className="admin-caption">{failures.summary.failed.toLocaleString("en-US")} failed / blocked tasks · {failures.summary.retryable.toLocaleString("en-US")} retryable · {failures.summary.blocked.toLocaleString("en-US")} blocked · {failures.summary.unrecoverable.toLocaleString("en-US")} unrecoverable · {failures.summary.lost.toLocaleString("en-US")} lost.</p>
    <div className="admin-failure-actions">
      <button disabled={busy || !failures.summary.retryable} onClick={() => void submit({ action: "retry-all" })}>Retry all eligible failures</button>
      <button disabled={busy || !failures.canMarkLost || !failures.summary.unrecoverable} onClick={() => void submit({ action: "lose-unrecoverable" })}>Mark unrecoverable as lost</button>
    </div>
    <p className="admin-caption">Retry queues work for the existing processor and respects cooldowns and budget limits. It skips budget/configuration/reconciliation blocks, lost tasks, HTTP 404/410, deleted posts, unsupported social/video links and documents that require manual text.</p>
    {!failures.canMarkLost && <p className="admin-caption">Marking tasks lost is unavailable until the processing protection update is installed.</p>}
    <p role="status" className="admin-action-status">{busy && !message ? "Updating tasks…" : message}</p>
    {active.length ? <div className="admin-table-scroll"><table>
      <caption className="sr-only">Failure reasons and actions</caption>
      <thead><tr><th scope="col">Task type / reason</th><th scope="col">Tasks</th><th scope="col">Action</th></tr></thead>
      <tbody>{active.map(group => <tr key={group.key}>
        <th scope="row"><span className="admin-task-kind">{group.kind} · {group.retryable ? "Retryable" : group.blocked ? "Blocked" : "Unrecoverable"}</span><span className="admin-failure-reason">{group.reason}</span></th>
        <td>{group.count.toLocaleString("en-US")}</td>
        <td><details><summary>Mark group lost</summary>
          <form onSubmit={event => markGroup(event, group.key)}>
            <label htmlFor={`lost-${group.key}`}>Reason for stopping retries</label>
            <textarea id={`lost-${group.key}`} name="reason" defaultValue={group.reason} maxLength={2000} required disabled={busy} />
            <button type="submit" disabled={busy || !failures.canMarkLost}>Mark all {group.count.toLocaleString("en-US")} tasks lost</button>
          </form>
        </details></td>
      </tr>)}</tbody>
    </table></div> : <p className="admin-caption">No active failures.</p>}
    {!!lost.length && <details className="admin-lost"><summary>Lost tasks and recorded reasons ({failures.summary.lost.toLocaleString("en-US")})</summary>
      <p className="admin-caption">Ignored by processing and retry-all. Already saved text remains in your library.</p>
      <table><caption className="sr-only">Lost tasks and their reasons</caption><thead><tr><th scope="col">Task type / recorded reason</th><th scope="col">Tasks</th></tr></thead>
        <tbody>{lost.map(group => <tr key={group.key}><th scope="row"><span className="admin-task-kind">{group.kind}</span><span className="admin-failure-reason">{group.reason}</span></th><td>{group.count.toLocaleString("en-US")}</td></tr>)}</tbody>
      </table>
    </details>}
  </section>;
}
