import type { AdminStats } from "@/lib/admin-dashboard";
import { AdminFailures } from "./AdminFailures";

function Count({ label, value, note }: { label: string; value: number; note?: string }) {
  return <div className="admin-count"><dt>{label}</dt><dd>{value.toLocaleString("en-US")}</dd>{note && <p>{note}</p>}</div>;
}

function Timestamp({ value }: { value: string | null }) {
  return value ? <time dateTime={value}>{new Date(value).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC</time> : <>None recorded</>;
}

export function AdminDashboardView({ stats, owner }: { stats: AdminStats; owner: string }) {
  return <>
    <section aria-labelledby="admin-sources"><h2 id="admin-sources">Saved material</h2>
      <dl className="admin-counts">
        <Count label="Saved bookmarked X posts" value={stats.posts.bookmarks} note="Distinct saved bookmarks; excludes expanded context posts." />
        <Count label="Expanded / context X posts" value={stats.posts.context} note="Additional posts saved for context or author threads." />
        <Count label="Fetched linked articles / documents" value={stats.links.fetched} note="Distinct saved sources, even when linked by several posts or URLs. Excludes reader-supplied recovery text." />
        <Count label="Pending linked URLs" value={stats.links.pending} note="Distinct URLs waiting, running or scheduled to retry." />
        <Count label="Failed / blocked linked URLs" value={stats.links.failed} note="Distinct URLs needing attention, including deferred PDFs." />
        <Count label="Saved sources with content" value={stats.sources} note="Posts, articles and documents, including expanded context. Removed items excluded." />
      </dl>
    </section>
    <section aria-labelledby="admin-classification"><h2 id="admin-classification">Categorization</h2>
      <p className="admin-caption">One status per saved source with content, including context posts. Reader-assigned categories are respected.</p>
      <dl className="admin-counts admin-compact">
        <Count label="Categorized" value={stats.classification.categorized} />
        <Count label="Pending" value={stats.classification.pending} />
        <Count label="Uncertain" value={stats.classification.uncertain} />
        <Count label="Failed" value={stats.classification.failed} />
        <Count label="Paused" value={stats.classification.paused} />
        <Count label="Lost" value={stats.classification.lost} />
      </dl>
    </section>
    <AdminFailures owner={owner} failures={stats.failures} />
    <div className="admin-columns">
      <section className="admin-panel"><h2>Sources per category</h2>
        <p className="admin-caption">Current assigned categories for saved sources with content. Unsorted can include pending, uncertain or failed categorization.</p>
        <table><caption className="sr-only">Saved sources in every library category</caption><thead><tr><th scope="col">Category</th><th scope="col">Sources</th></tr></thead>
          <tbody>{stats.categories.map(category => <tr key={category.key}><th scope="row">{category.name}</th><td>{category.count.toLocaleString("en-US")}</td></tr>)}</tbody>
        </table>
      </section>
      <div className="admin-side">
        <section className="admin-panel"><h2>Processing backlog</h2>
          <p className="admin-caption">Tasks for current source revisions. A single source can have several tasks.</p>
          <dl className="admin-detail">
            <div><dt>Pending tasks</dt><dd>{stats.backlog.pending.toLocaleString("en-US")}</dd></div>
            <div><dt>Tasks awaiting retry</dt><dd>{stats.backlog.retryable.toLocaleString("en-US")}</dd></div>
            <div><dt>Running tasks</dt><dd>{stats.backlog.running.toLocaleString("en-US")}</dd></div>
            <div><dt>Failed / blocked tasks</dt><dd>{stats.backlog.attention.toLocaleString("en-US")}</dd></div>
          </dl>
        </section>
        <section className="admin-panel"><h2>Latest X sync</h2>
          {stats.sync.run ? <dl className="admin-detail">
            <div><dt>State</dt><dd>{stats.sync.run.state}</dd></div>
            <div><dt>Mode</dt><dd>{stats.sync.run.mode}</dd></div>
            <div><dt>Pages received</dt><dd>{stats.sync.run.pages.toLocaleString("en-US")}</dd></div>
            <div><dt>Posts received in run</dt><dd>{stats.sync.run.received.toLocaleString("en-US")}</dd></div>
            <div><dt>Updated</dt><dd><Timestamp value={stats.sync.run.updatedAt} /></dd></div>
            <div><dt>Retry after</dt><dd><Timestamp value={stats.sync.run.retryAt} /></dd></div>
            {stats.sync.run.completionReason && <div><dt>Completion reason</dt><dd>{stats.sync.run.completionReason}</dd></div>}
          </dl> : <p className="admin-caption">No X sync run recorded.</p>}
          <dl className="admin-detail"><div><dt>Last checkpoint for connected X account</dt><dd><Timestamp value={stats.sync.checkpointAt} /></dd></div></dl>
          <p className="admin-caption">Run receipts are separate from total saved bookmarks. Refresh to read the latest server state.</p>
        </section>
      </div>
    </div>
  </>;
}
