import { connectedOwner, connectFixtureProviders } from "./provider-fixtures";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { configureDatabase } from "../lib/db";
import { readAdminStats, loadAdminDashboard } from "../lib/admin-dashboard";
import { TOPICS } from "../lib/library";
import { readAdminFailures, manageAdminFailures } from "../lib/admin-failures";
import { adminFailuresHttp } from "../lib/admin-failure-http";
import { processingStatus, processLibrary, configureProcessing } from "../lib/processing";

const host = process.env.SAKAMOTO_TEST_PG_SOCKET;
if (!host?.startsWith("/tmp/sakamoto-")) throw new Error("Use an isolated /tmp/sakamoto-* PostgreSQL test socket.");
const schema = "admin_test_" + process.pid;
const pool = new Pool({ host, user: "sakamoto_test", database: "postgres", options: `-c search_path=${schema},public` });
before(async () => {
  process.env.TYPESAFE_API_KEY="fixture";process.env.GOOGLE_API_KEY="fixture";
  await pool.query(`create schema ${schema};
    create table articles(user_id text,id text,data jsonb,doc jsonb,deleted boolean default false,source_revision int default 1,manual_fields jsonb default '{}',primary key(user_id,id));
    create table post_sources(user_id text,post_id text,article_id text,role text);
    create table linked_sources(user_id text,source_id text,source_revision int,url text,article_id text);
    create table source_classifications(user_id text,source_id text,source_revision int,taxonomy text,topic text);
    create table processing_jobs(id serial,user_id text,source_id text,source_revision int,kind text,target text,state text default 'pending',next_attempt_at timestamptz default now(),lease_expires_at timestamptz,
      checkpoint jsonb default '{}',error text,attempts int default 0,max_attempts int default 4,lease_token text,updated_at timestamptz default now(),result_item_id text,
      unique(user_id,source_id,source_revision,kind,target));
    create table saved_passages(user_id text,source_id text,source_revision int,content_fingerprint text);
    create table passage_embeddings(user_id text,contract text,content_fingerprint text);
    create table paid_attempts(owner_id text,operation_id text,status text,actual_micros bigint,reserved_micros bigint);
    create table provider_connections(owner_id text,provider text,id uuid unique,key_id text,ciphertext text,expires_at text,updated_at timestamptz default now(),primary key(owner_id,provider));
    create table provider_budgets(owner_id text primary key,cap_micros bigint);
    create table deleted_credential_owners(owner_id text primary key);
    create table credential_audit(sequence bigserial,owner_id text,provider text,action text);
    create table paid_budget(id boolean primary key,halted boolean,settled_micros bigint,reserved_micros bigint,cap_micros bigint);
    create table x_bookmark_runs(user_id text,state text,mode text,completion_reason text,pages int,received int,updated_at timestamptz,retry_at timestamptz);
    create table x_bookmark_checkpoints(user_id text,x_user_id text,updated_at timestamptz);
    create table x_connections(user_id text,x_user_id text);`);
  configureDatabase({ query: async (sql, params) => (await pool.query(sql, params)).rows });
  const credentialsMigration=readFileSync(new URL("../db/migrations/026-provider-connections.sql",import.meta.url),"utf8");
  for(const name of ['save_provider_connection','disconnect_provider']) await pool.query(credentialsMigration.match(new RegExp('create function '+name+'[\\s\\S]*?end \\$\\$;'))![0]);

  await pool.query(readFileSync(new URL("../db/migrations/017-processing-classification-capacity.sql", import.meta.url), "utf8"));
  const processingMigration = readFileSync(new URL("../db/migrations/006-linked-processing.sql", import.meta.url), "utf8");
  await pool.query(processingMigration.match(/create function complete_processing\([\s\S]*?end \$\$;/)![0]);
  await pool.query(readFileSync(new URL("../db/migrations/018-preserve-lost-processing.sql", import.meta.url), "utf8"));
  const intakeMigration = readFileSync(new URL("../db/migrations/004-bookmark-intake.sql", import.meta.url), "utf8");
  await pool.query(intakeMigration.match(/create function sakamoto_x_post_id\(raw text\)[\s\S]*?\$\$;/)![0]);
  await pool.query(readFileSync(new URL("../db/migrations/020-resolve-saved-post-links.sql", import.meta.url), "utf8"));
});
after(async () => { await pool.query(`drop schema ${schema} cascade`); await pool.end(); });

test("an empty reader gets zeros and every existing category, including Unsorted", async () => {
  const stats = await readAdminStats("empty");
  assert.equal(stats.sources, 0);
  assert.deepEqual(stats.posts, { bookmarks: 0, context: 0 });
  assert.deepEqual(stats.links, { fetched: 0, pending: 0, failed: 0 });
  assert.deepEqual(stats.classification, { categorized: 0, pending: 0, uncertain: 0, failed: 0, paused: 0, lost: 0 });
  assert.deepEqual(stats.categories, TOPICS.map(t => ({ key: t.key, name: t.name, count: 0 })));
  assert.equal(stats.sync.run, null);
  assert.equal(stats.sync.checkpointAt, null);
});

test("bookmark and expanded context counts stay distinct and exclude other readers and removed sources", async () => {
  await source("reader", "bookmark", { topic: "ai-engineering" });
  await source("reader", "context", { topic: "obsolete-category" });
  await source("reader", "removed", {}, true);
  await source("someone-else", "bookmark", {});
  await pool.query(`insert into post_sources values
    ('reader','100','bookmark','bookmark'),('reader','101','context','context'),
    ('reader','102','removed','bookmark'),('someone-else','100','bookmark','bookmark')`);
  const stats = await readAdminStats("reader");
  assert.deepEqual(stats.posts, { bookmarks: 1, context: 1 });
  assert.equal(stats.sources, 2);
  assert.equal(stats.categories.find(t => t.key === "ai-engineering")?.count, 1);
  assert.equal(stats.categories.find(t => t.key === "unsorted")?.count, 1);
});

async function source(owner: string, id: string, data: Record<string, unknown>, deleted = false) {
  await connectFixtureProviders(owner);
  await pool.query("insert into articles(user_id,id,data,doc,deleted) values($1,$2,$3,'{}',$4)", [owner, id, data, deleted]);
}

test("linked reading counts unique fetched sources while outstanding URLs and current processing tasks are separate", async () => {
  for (const id of ["post", "second", "article", "document", "removed-target"]) await source("links", id, {});
  await pool.query("update articles set deleted=true where user_id='links' and id='removed-target'");
  await pool.query(`insert into linked_sources values
    ('links','post',1,'https://a','article'),('links','post',1,'https://alias','article'),
    ('links','second',1,'https://a','article'),('links','post',1,'https://pdf','document'),
    ('links','post',1,'https://removed','removed-target'),('links','post',2,'https://stale','second')`);
  await pool.query(`insert into processing_jobs(user_id,source_id,source_revision,kind,target,state) values
    ('links','post',1,'link','https://pending','pending'),('links','second',1,'link','https://pending','running'),
    ('links','post',1,'link','https://failed','terminal'),('links','second',1,'link','https://failed','terminal'),
    ('links','post',1,'link','https://pdf-pending','pdf_pending'),('links','post',1,'link','https://retry','retryable'),
    ('links','post',1,'classification','topics-v1','pending'),('links','post',1,'indexing','','complete'),
    ('links','post',2,'link','https://obsolete','pending'),('links','removed-target',1,'link','https://removed','pending')`);
  const stats = await readAdminStats("links");
  assert.deepEqual(stats.links, { fetched: 2, pending: 2, failed: 2 });
  assert.deepEqual(stats.backlog, { pending: 2, retryable: 1, running: 1, attention: 3 });
  assert.deepEqual((await readAdminStats("empty")).links, { fetched: 0, pending: 0, failed: 0 });
});

test("categorization states cover each source once and category counts follow the reader's assigned category", async () => {
  await source("categories", "complete", { topic: "ai", processing: { classification: "complete" } });
  await source("categories", "pending", {});
  await source("categories", "uncertain", { topic: "unsorted", processing: { classification: "uncertain" } });
  await source("categories", "failed", { processing: { classification: "failed" } });
  await source("categories", "paused", { processing: { classification: "paused" } });
  await source("categories", "receipt", {});
  await source("categories", "old-receipt", {});
  await source("categories", "manual", { topic: "programming", processing: { classification: "pending" } });
  await pool.query("update articles set manual_fields='{\"topic\":true}' where user_id='categories' and id='manual'");
  await pool.query(`insert into source_classifications values
    ('categories','receipt',1,'topics-v1','ai'),('categories','old-receipt',0,'topics-v1','ai'),
    ('someone-else','pending',1,'topics-v1','ai')`);
  const stats = await readAdminStats("categories");
  assert.deepEqual(stats.classification, { categorized: 3, pending: 2, uncertain: 1, failed: 1, paused: 1, lost: 0 });
  assert.equal(stats.categories.find(t => t.key === "ai")?.count, 1);
  assert.equal(stats.categories.find(t => t.key === "programming")?.count, 1);
  assert.equal(stats.categories.find(t => t.key === "unsorted")?.count, 6);
});

test("the dashboard loader requires a session and returns only that session's sync state", async () => {
  assert.deepEqual(await loadAdminDashboard(async () => ({ userId: null })), { state: "signed-out" });
  await pool.query(`insert into x_bookmark_runs values
    ('reader','limited','routine',null,3,30,'2026-10-29T10:00:00Z',null),
    ('someone-else','exhausted','initial','source_exhausted',90,900,'2026-10-29T12:00:00Z',null);
    insert into x_connections values ('reader','account-current');
    insert into x_bookmark_checkpoints values ('reader','account-old','2026-10-29T13:00:00Z'),
      ('reader','account-current','2026-10-29T09:00:00Z'),('someone-else','account-current','2026-10-29T14:00:00Z');`);
  const result = await loadAdminDashboard(async () => ({ userId: "reader" }));
  assert.equal(result.state, "ready");
  if (result.state !== "ready") throw new Error("Expected a private dashboard.");
  assert.equal(result.stats.posts.bookmarks, 1);
  assert.deepEqual(result.stats.sync, {
    run: { state: "limited", mode: "routine", completionReason: null, pages: 3, received: 30, updatedAt: "2026-10-29T10:00:00.000Z", retryAt: null },
    checkpointAt: "2026-10-29T09:00:00.000Z",
  });
});

test("signed-out loading never reads the database and database failure never becomes an empty library", async () => {
  configureDatabase({ query: async () => { throw new Error("private database diagnostic"); } });
  try {
    assert.deepEqual(await loadAdminDashboard(async () => ({ userId: null })), { state: "signed-out" });
    assert.deepEqual(await loadAdminDashboard(async () => ({ userId: "reader" })), { state: "unavailable" });
    await assert.rejects(readAdminStats(""), /reader is required/);
  } finally {
    configureDatabase({ query: async (sql, params) => (await pool.query(sql, params)).rows });

  }
});

test("completed classification tasks with failed or paused publications still need attention", async () => {
  await source("attention", "failed", { processing: { classification: "failed" } });
  await source("attention", "paused", { processing: { classification: "paused" } });
  await source("attention", "complete", { processing: { classification: "complete" } });
  await pool.query(`insert into processing_jobs(user_id,source_id,source_revision,kind,target,state) values
    ('attention','failed',1,'classification','topics-v1','complete'),
    ('attention','paused',1,'classification','topics-v1','complete'),
    ('attention','complete',1,'classification','topics-v1','complete')`);
  assert.deepEqual((await readAdminStats("attention")).backlog, { pending: 0, retryable: 0, running: 0, attention: 2 });
});

test("reader-supplied linked text remains a saved source but never counts as successfully fetched", async () => {
  await source("manual-links", "post", {});
  await source("manual-links", "recovery", { contentType: "document" });
  await pool.query(`update articles set doc='{"pdfSource":{"extractor":"reader-supplied-text","status":"manual"}}'
    where user_id='manual-links' and id='recovery';
    insert into linked_sources values ('manual-links','post',1,'https://recovered','recovery')`);
  const stats = await readAdminStats("manual-links");
  assert.equal(stats.sources, 2);
  assert.equal(stats.links.fetched, 0);
});

test("failure reasons reconcile with failed tasks, separate permanent errors, and stay private", async () => {
  await source("failure-reader", "post", { processing: { classification: "failed", classificationMessage: "TypeSafe throttled classification." } });
  await source("failure-reader", "removed", {}, true);
  await source("other-reader", "post", {});
  await pool.query(`insert into processing_jobs(user_id,source_id,source_revision,kind,target,state,error) values
    ('failure-reader','post',1,'link','https://missing','terminal','Source returned HTTP 404.'),
    ('failure-reader','post',1,'link','https://gone','terminal','Source returned HTTP 410.'),
    ('failure-reader','post',1,'link','https://timeout','terminal','Source deadline exceeded.'),
    ('failure-reader','post',1,'link','https://timeout-two','terminal','Source deadline exceeded.'),
    ('failure-reader','post',1,'classification','topics-v1','complete',null),
    ('failure-reader','post',1,'indexing','','running','Old failure'),
    ('failure-reader','post',0,'link','https://stale','terminal','Old revision'),
    ('failure-reader','removed',1,'link','https://removed','terminal','Removed source'),
    ('other-reader','post',1,'link','https://private','terminal','Private failure');`);
  const failures = await readAdminFailures("failure-reader");
  assert.deepEqual(failures.summary, { failed: 5, retryable: 3, unrecoverable: 2, blocked: 0, lost: 0 });
  assert.equal(failures.groups.find(g => g.reason === "Source deadline exceeded.")?.count, 2);
  assert.equal(failures.groups.find(g => g.kind === "classification")?.reason, "TypeSafe throttled classification.");
  assert.equal((await readAdminFailures("empty")).summary.failed, 0);
});

test("marking unrecoverable failures lost retains their reason and removes them from active failure counts", async () => {
  const result = await manageAdminFailures("failure-reader", { action: "lose-unrecoverable" });
  assert.equal(result.changed, 2);
  const failures = await readAdminFailures("failure-reader");
  assert.deepEqual(failures.summary, { failed: 3, retryable: 3, unrecoverable: 0, blocked: 0, lost: 2 });
  assert.equal(failures.groups.find(g => g.reason === "Source returned HTTP 404.")?.lost, true);
  assert.equal((await manageAdminFailures("failure-reader", { action: "lose-unrecoverable" })).changed, 0);
});

test("a reader can mark a reason group lost with their own reason; another reader cannot affect it", async () => {
  const group = (await readAdminFailures("failure-reader")).groups.find(g => g.reason === "Source deadline exceeded.")!;
  assert.equal((await manageAdminFailures("other-reader", { action: "lose-group", key: group.key, reason: "Site permanently offline" })).changed, 0);
  assert.equal((await manageAdminFailures("failure-reader", { action: "lose-group", key: group.key, reason: "Site permanently offline" })).changed, 2);
  const failures = await readAdminFailures("failure-reader");
  assert.equal(failures.groups.find(g => g.reason === "Site permanently offline")?.count, 2);
  assert.deepEqual(failures.summary, { failed: 1, retryable: 1, unrecoverable: 0, blocked: 0, lost: 4 });
  assert.equal((await readAdminStats("failure-reader")).backlog.attention, 1);
});

test("lost classification work stays out of the failed task and failed categorization counts", async () => {
  const group = (await readAdminFailures("failure-reader")).groups.find(g => g.kind === "classification")!;
  await manageAdminFailures("failure-reader", { action: "lose-group", key: group.key, reason: "No useful content to categorize" });
  const stats = await readAdminStats("failure-reader");
  assert.equal(stats.backlog.attention, 0);
  assert.equal(stats.classification.failed, 0);
  assert.equal(stats.classification.lost, 1);
});

test("retry all requeues eligible failures without resetting attempt identities, cooldowns, active jobs or permanent losses", async () => {
  await source("retry-reader", "post", { processing: { classification: "paused" } });
  await source("retry-reader", "removed", {}, true);
  await pool.query(`insert into processing_jobs(user_id,source_id,source_revision,kind,target,state,error,attempts,max_attempts,next_attempt_at) values
    ('retry-reader','post',1,'classification','topics-v1','complete','TypeSafe throttled classification.',8,8,now()+interval '5 minutes'),
    ('retry-reader','post',1,'link','https://timeout','terminal','Source deadline exceeded.',4,4,now()),
    ('retry-reader','post',1,'link','https://missing','terminal','Source returned HTTP 404.',4,4,now()),
    ('retry-reader','post',1,'link','https://active','running','Previous timeout',1,4,now()),
    ('retry-reader','post',0,'link','https://stale','terminal','Obsolete',4,4,now()),
    ('retry-reader','removed',1,'link','https://removed','terminal','Removed',4,4,now());`);
  const result = await manageAdminFailures("retry-reader", { action: "retry-all" });
  assert.equal(result.changed, 2);
  assert.equal((await readAdminFailures("retry-reader")).summary.unrecoverable, 1);
  assert.equal((await readAdminStats("retry-reader")).classification.pending, 1);
  const jobs = (await processingStatus("retry-reader")).jobs.filter(job => job.sourceRevision === 1);
  assert.equal(jobs[0].state, "pending");
  assert.equal(jobs[0].attempts, 8);
  assert.ok(new Date(jobs[0].nextAttemptAt).getTime() > Date.now()+240_000);
  assert.equal(jobs[1].state, "pending");
  assert.equal(jobs[2].state, "terminal");
  assert.equal(jobs[3].state, "running");
  assert.equal((await manageAdminFailures("failure-reader", { action: "retry-all" })).changed, 0);
  assert.equal((await readAdminFailures("failure-reader")).summary.lost, 5);
  let fetched = 0;
  configureProcessing({ fetchArticle: async () => { fetched++; return { ok: false, error: "Fixture rate limit", status: 429, retryable: true }; } });
  try {
    await processLibrary(await connectedOwner("retry-reader"), { limit: 1 });
    assert.equal(fetched, 1);
    const retried = (await processingStatus("retry-reader")).jobs.find(job => job.target === "https://timeout")!;
    assert.equal(retried.attempts, 5);
    assert.equal(retried.state, "retryable");
  } finally { configureProcessing({}); }
});

test("failure actions require a same-origin reader session and reject owner selection or oversized requests", async () => {
  const request = (body: unknown, headers: Record<string,string> = {}) => new Request("http://localhost/api/admin/failures", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await adminFailuresHttp(request({ action: "retry-all" }), null)).status, 401);
  assert.equal((await adminFailuresHttp(request({ action: "retry-all" }, { authorization: "Bearer token" }), "reader")).status, 401);
  assert.equal((await adminFailuresHttp(request({ action: "retry-all" }, { origin: "https://other.example" }), "reader")).status, 403);
  assert.equal((await adminFailuresHttp(request({ action: "retry-all", owner: "someone-else" }), "reader")).status, 400);
  assert.equal((await adminFailuresHttp(request({ action: "lose-group", key: "invalid", reason: "x".repeat(5000) }), "reader")).status, 400);
  assert.equal((await adminFailuresHttp(request({ action: "retry-all" }, { "x-sakamoto-owner": "someone-else" }), "reader")).status, 401);
  const result = await adminFailuresHttp(request({ action: "retry-all" }), "failure-reader");
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  const data = await result.json();
  assert.equal(data.changed, 0);
  assert.equal(data.failures.summary.lost, 5);
});

test("restoring a source cannot revive lost work or dispatch its external requests", async () => {
  await source("restore-reader", "post", {});
  await pool.query(`insert into processing_jobs(user_id,source_id,source_revision,kind,target,state,error)
    values ('restore-reader','post',1,'link','https://offline','terminal','Source returned HTTP 410.')`);
  await manageAdminFailures("restore-reader", { action: "lose-unrecoverable" });
  const sourceMigration = readFileSync(new URL("../db/migrations/006-linked-processing.sql", import.meta.url), "utf8");
  const restoreTrigger = sourceMigration.match(/create function schedule_article_links\(\)[\s\S]*?end \$\$;/)![0];
  await pool.query(restoreTrigger);
  await pool.query("create trigger articles_link_processing after insert or update on articles for each row execute function schedule_article_links()");
  await pool.query("update articles set deleted=true where user_id='restore-reader'; update articles set deleted=false where user_id='restore-reader'");
  assert.equal((await processingStatus("restore-reader")).jobs[0].state, "cancelled");
  let fetched = 0;
  configureProcessing({ fetchArticle: async () => { fetched++; throw new Error("Lost tasks must not dispatch"); } });
  try {
    assert.equal((await processLibrary(await connectedOwner("restore-reader"), { limit: 1 })).processed, 0);
    assert.equal(fetched, 0);
    assert.equal((await readAdminFailures("restore-reader")).summary.lost, 1);
  } finally { configureProcessing({}); }
});

test("loss actions stay unavailable until the database protection is installed and enabled", async () => {
  await pool.query("alter table processing_jobs disable trigger processing_jobs_preserve_loss");
  try {
    assert.equal((await readAdminFailures("other-reader")).canMarkLost, false);
    const request = new Request("http://localhost/api/admin/failures", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "lose-unrecoverable" }) });
    assert.equal((await adminFailuresHttp(request, "other-reader")).status, 503);
  } finally { await pool.query("alter table processing_jobs enable trigger processing_jobs_preserve_loss"); }
});

test("index scheduling and checkpoint replacement also preserve the original loss receipt", async () => {
  await source("index-restore-reader", "post", {});
  await pool.query(`insert into processing_jobs(user_id,source_id,source_revision,kind,target,state,error)
    values ('index-restore-reader','post',1,'indexing','gemini-embedding-2:768:search-prefix-v1:block-600-overlap-80-v1','terminal','Indexing unavailable')`);
  const group = (await readAdminFailures("index-restore-reader")).groups[0];
  await manageAdminFailures("index-restore-reader", { action: "lose-group", key: group.key, reason: "No usable source text" });
  const sourceMigration = readFileSync(new URL("../db/migrations/009-hybrid-retrieval.sql", import.meta.url), "utf8");
  await pool.query(sourceMigration.match(/create function schedule_source_indexing\(\)[\s\S]*?end \$\$;/)![0]);
  await pool.query("create trigger articles_z_indexing after insert or update on articles for each row execute function schedule_source_indexing()");
  await pool.query("update articles set deleted=true where user_id='index-restore-reader'; update articles set deleted=false where user_id='index-restore-reader'");
  await pool.query("update processing_jobs set state='pending',checkpoint='{}' where user_id='index-restore-reader'");
  assert.equal((await processingStatus("index-restore-reader")).jobs[0].state, "cancelled");
  assert.equal((await readAdminFailures("index-restore-reader")).groups[0].reason, "No usable source text");
  assert.equal((await processLibrary(await connectedOwner("index-restore-reader"), { limit: 1 })).processed, 0);
});

test("deleted posts are unrecoverable while access failures, rate limits, offline errors and server errors remain retryable", async () => {
  await source("policy-reader", "post", {});
  for (const [index, error] of ["Tweet has been deleted.", "Source returned HTTP 403.", "Source returned HTTP 429.", "Source returned HTTP 503.", "That address is not reachable from here.", "Source returned HTTP 404."].entries())
    await pool.query("insert into processing_jobs(user_id,source_id,source_revision,kind,target,state,error) values('policy-reader','post',1,'link',$1,'terminal',$2)", [`https://policy/${index}`, error]);
  assert.deepEqual((await readAdminFailures("policy-reader")).summary, { failed: 6, retryable: 4, unrecoverable: 2, blocked: 0, lost: 0 });
});

test("concurrent retry-all requests enqueue a failure once", async () => {
  await source("race-reader", "post", {});
  await pool.query("insert into processing_jobs(user_id,source_id,source_revision,kind,target,state,error) values('race-reader','post',1,'link','https://retry','terminal','Source deadline exceeded.')");
  const results = await Promise.all([manageAdminFailures("race-reader", { action: "retry-all" }), manageAdminFailures("race-reader", { action: "retry-all" })]);
  assert.equal(results[0].changed + results[1].changed, 1);
  assert.equal((await processingStatus("race-reader")).jobs.find(job => job.kind === "link")?.state, "pending");
});

test("retry all skips links that the installed importer explicitly cannot process automatically", async () => {
  await source("unsupported-reader", "post", {});
  for (const [index, error] of [
    "That link is a social post, not a readable article.",
    "Direct social or video link; not a readable linked article.",
    "That link is a video; save its transcript instead.",
    "This PDF has no readable text layer (it may be scanned). Supply extracted text; automatic OCR is not enabled.",
    "Source exceeds the import byte limit.",
  ].entries()) await pool.query("insert into processing_jobs(user_id,source_id,source_revision,kind,target,state,error) values('unsupported-reader','post',1,'link',$1,'terminal',$2)", [`https://unsupported/${index}`, error]);
  assert.deepEqual((await readAdminFailures("unsupported-reader")).summary, { failed: 5, retryable: 0, unrecoverable: 5, blocked: 0, lost: 0 });
  assert.equal((await manageAdminFailures("unsupported-reader", { action: "retry-all" })).changed, 0);
});
