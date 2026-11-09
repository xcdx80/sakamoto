# Create and revise posts through Sakamoto MCP

The same authenticated MCP endpoint now supports the writing desk journey. The adapter calls the existing owner-scoped production repository and generation/review/publishing workflow, not a separate writer. Library and source tools are unchanged.

## Connect

1. Run this checkout with `npm run dev` (port 3100), or deploy the changes through the normal approved release process. A cloud assistant needs a reachable HTTPS origin, not its own localhost.
2. Use an existing authorized Sakamoto personal token from Library → **Connect an agent**. Creating a new token is a separate account-access action. Nothing in these writing tools creates tokens or connects a publishing account.
3. Prefer `POST https://YOUR-SAKAMOTO-ORIGIN/mcp` with `Authorization: Bearer <personal-token>` and `Content-Type: application/json`. The existing `/mcp/<token>` compatibility endpoint also works, but credential URLs can leak through logs and must remain private.
4. Initialize the MCP client, then refresh `tools/list` to discover the new tools. The response advertises server version 1.1.0 and writing instructions. Authentication remains mandatory for discovery and every call. Revoking the token revokes writing access too.

Existing personal tokens are full account-agent tokens, not read-only tokens: when this server version is running, they can access the writing tools as well as the library. There is no separate writing scope or OAuth setup in this change. Only connect a trusted client. The server can validate the caller's explicit confirmation fields, but cannot independently prove that the human said yes; the client must obtain actual user approval rather than invent it.

## Conversation and generation

Start with `post_workflow` to read the saved voice, framework catalog, configured model readiness, publishing configuration and complete client instructions. Configuration readiness is not a live provider-connection check. Its `health` fields distinguish authenticated transport/database access from configured generation and publishing; `externalProvidersVerified: false` prevents a configuration check from claiming a live connection. Both MCP routes include the framework catalog in deployment tracing.

Frame the author's idea into a brief. `notes` contains only experience or facts they actually supplied, not an invented narrative. `idea` can contain proposed framing or an opinion. Choose the audience, goal, pillar, X/LinkedIn platforms, delivery and optional owned source IDs. The brief's delivery controls X; LinkedIn receives one long post.

Example `tools/call` payload:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "create_post",
    "arguments": {
      "brief": {
        "idea": "Why I check evidence before automating a decision",
        "notes": "The author's actual observations, or an empty string.",
        "audience": "Engineering leaders",
        "goal": "trust",
        "pillar": "engineering",
        "platforms": ["x", "linkedin"],
        "delivery": "single",
        "sourceIds": []
      }
    }
  }
}
```

`create_post` saves only a brief and returns the post ID, version and `/write?post=...` link. Call `advance_post` with `{ "id": "RETURNED_ID", "expectedVersion": RETURNED_VERSION }`, then use each new returned version. Each request executes one durable foreground stage: research, evidence signals, structure, writing, independent review or targeted automatic revision. This uses the existing provider configuration, budget reservations, ownership checks, source freshness and leases. Both MCP routes allow the same 300-second server duration as the writing desk. Clients should allow that request duration; after disconnection read the post before resuming.

Stop at `ready`, `needs_input` or `paused`. Show the exact draft, sources and review issues to the author. A paused response preserves the brief/draft and its notice; do not automatically retry failed or uncertain paid work. No drafting tool approves, submits or marks a post published.

## Supplied context and source controls

The optional `brief.sourcePolicy` object requires both `library` and `web` booleans. Omitting it preserves both defaults as `true`, also advertised by `post_workflow.defaults.sourcePolicy`. Set both to `false` to generate from the brief and supplied context without library retrieval or web research. Remove library `sourceIds` when library retrieval is disabled. These controls do not turn off evidence checks, paid writing, selection or independent review.

The optional `brief.agentContext` array accepts at most eight attributed items:

```json
{
  "id": "author_conversation_1",
  "title": "Why we retained the existing workflow",
  "text": "The exact relevant context supplied by the agent.",
  "kind": "author_statement",
  "provenance": {
    "label": "Author conversation on November 9",
    "url": "https://example.com/original",
    "author": "Author name",
    "capturedAt": "2026-11-09T12:00:00Z"
  }
}
```

`id`, `title`, `text`, `kind` and `provenance.label` are required. IDs must be unique and use 1–80 ASCII letters, digits, underscores or hyphens. Titles are at most 200 characters, each text at most 12,000 characters, and all context text together at most 24,000 UTF-8 bytes. Labels are at most 500 characters. Optional provenance URLs must be HTTP(S), without credentials, and at most 2,000 characters; authors at most 200; `capturedAt` is an ISO date-time of at most 100 characters. Inputs exceeding limits are rejected, not silently truncated. Combined source/evidence capacity also applies.

Use `author_statement` only for actual author-supplied observations or experience. Use `reference` for attributed external material and `analysis` for the agent's interpretation. Supplied material is evidence data, not system instructions. Neither analysis nor third-party reference establishes author experience. Attribution records where the caller says material came from; it is not independent verification. The context and source policy can also be supplied through `regenerate_post.parameters.brief`.

## Read the exact result and its provenance

Every detail response includes a revision-bound `result` (null until a draft exists):

- `posts`: complete saved platform/delivery variants and their exact ordered post strings, without summarization or invented opening lines.
- `alternateHooks`: saved alternative hook wording. These are separate from the actual opening of each full post and from `decisions.hook.catalogPattern`, which describes a catalog pattern rather than written text.
- `decisions.framework` and `decisions.hook`: actual selected IDs and matching recorded selection mode, reason and decision support. Explicit manual choices are labeled `manual` and do not borrow a provider's reason. An unrecorded reason is null with `reasonUnavailable`, never synthetic commentary. Catalog entries appear only for the snapshot's catalog version; recorded recommendations remain separately available.
- `settings`: immutable generation brief, resolved source policy, supplied context, generation parameters, voice profile and recorded model/prompt/catalog versions. A historical revision without a snapshot has null settings and `contextStatus: "unknown"`, not today's settings.
- `sources.candidateEvidence`: the complete saved evidence records, including source IDs, excerpts, URLs, attribution and agent provenance when recorded. These were available to generation; retrieval alone does not prove use.
- `sources.citedEvidence` (also `draftCitedEvidence`) and `claimMappings`: evidence explicitly referenced by the draft's saved claim mappings, with unknown references listed in `unresolvedCitationIds`. `reviewSupport` preserves the exact revision's recorded reviewer claim/source/quote/reason mappings, with `reviewStatus` and research status separately labeled. `reviewCitedEvidence` lists evidence referenced by reviewer quote support, including sources absent from writer hints. `decisionCitedEvidence` and `decisionSupport` independently expose matching recorded framework/hook quote support. `unresolvedReferenceIds` covers all three kinds of references. Signal and author signal assessments are separate; availability is not citation. Citation or review status is not an independent guarantee that a source is true.
- `review`: the selected revision's own independent review, or null if unavailable.

When regeneration is pending, `result` still describes the saved wording and its original settings. Historical `get_post` results also use only that revision's snapshot and review. `production`, `progress`, `next`, `currentContext` and `currentReview` describe the current production; the legacy `context` and `review` fields are aliases for that current workflow state. Never use those current fields to explain a historical draft's selection or evidence.

## Iterate and recover

- `get_post`: `{ "id": "..." }` returns the current draft, checkpoint/evidence, review, revision index, publishing destinations and next action. Optional `revisionId` reads historical exact wording and its immutable generation context. Historical content never replaces current wording. Current context/review remains separately labeled in the response; use the historical draft's own context/review for its provenance.
- `list_posts`: find a bounded index of the latest 200 owned productions, with IDs, 300-character idea previews, status/version and links. After a lost create response, find the saved brief rather than creating another blindly.
- `revise_post`: current ID/version plus `instruction` (up to 3,000 characters). Then advance generation again.
- `save_post_draft`: current ID/version plus complete `content` (`variants`, `hooks`, `claimSources`). Saves exact author edits as an immutable revision and removes approval. Advance to review it.
- `regenerate_post`: current ID/version plus `parameters`: complete `brief`, `frameworkId` and `hookPatternId` (or null), `sourceMode` (`automatic` or `selected`), and `evidenceIds`. Automatic mode requires empty evidence IDs. Selected mode uses current server-held evidence and owned pinned sources. Old wording remains available until the new revision is saved.
- `choose_post_structure`: select a current eligible `frameworkId` and optional `hookPatternId`. Does not bypass evidence eligibility.
- `assess_post_signals`: record only explicit author assessments of current evidence, using catalog signal IDs. Do not invent author assessments to bypass model decisions.

Responses expose durable `progress` (status, stage, saved-draft presence, revision count, review status and notice), the exact result and a next action. Tool failures include structured `status: error`, `code`, `message` and `recovery`. Invalid arguments, missing confirmation, stale versions, inaccessible posts, changed publishing destinations and database/configuration failures are distinguishable. Authentication errors occur before tools run: HTTP 401 / JSON-RPC -32001 means missing/revoked credentials; 503 means database/server access is unavailable. A client cannot diagnose tool availability until authenticated `tools/list` succeeds.

All writing calls accept only their advertised schema. Send one writing call per HTTP request, not mixed or parallel JSON-RPC batches. All mutations of an existing post require the latest version; stale callers must reread. Writing arguments are bounded to 250 KB. Oversized legacy responses return a `too_large` notice and Sakamoto link without truncating wording or repeating a mutation.

## Approve, then publish only on request

1. Show the final exact wording and platforms. Obtain explicit approval.
2. Call `approve_post` with current `id`, `expectedVersion`, `revisionId`, `platforms`, and `userConfirmed: true`. Current independent passing review and exact revision are required. **This does not publish.** Revisions remove previous approval.
3. If the user explicitly asks to publish now, show the exact approved wording/platforms and configured Postiz destinations from `get_post`. These identify configured integration IDs, not independently verified social-account names. Confirm the intended channels if their identity is unclear.
4. Call `publish_post` with the same exact confirmation fields and `destinationFingerprint` from `publishing.destinations.fingerprint`. It binds confirmation to the configured provider, credentials and selected channels without exposing secrets. Changed configuration requires rereading and confirmation.
5. Sakamoto uses the existing Postiz owner/platform configuration and rechecks channel availability. It durably reserves a submission before dispatch. `submitted` means Postiz accepted the submission, **not that the post is live**. `uncertain` means it may have accepted it. Never automatically retry either state; inspect Postiz first.

A request to draft or review is not permission to approve or publish. Never set `userConfirmed` based on model judgment, review success, or generic tool access. This change does not schedule publication, connect new accounts, bypass content-review gates, or automatically mark provider submissions as published.

## Verification

`tests/post-mcp.test.ts` exercises the actual authenticated JSON-RPC handler against the existing isolated PostgreSQL fixture. Providers and Postiz use controlled fixtures only. Use an owned socket via `SAKAMOTO_TEST_PG_SOCKET=/tmp/sakamoto-.../socket`; never point tests at the application database or load its `.env.local`. Real provider generation, remote MCP connection and live publication require separate authorized runtime verification.

## Shared API and writing-desk behavior

`POST /api/write` create/update/regenerate actions accept the same optional brief fields. Both entry points use shared normalization, persistence, source collection and provider prompts; no database migration or parallel generation API is needed because briefs and immutable generation contexts are already JSON snapshots.

The writing desk exposes **Paste supporting material**, **Library**, and **Web search** in creation/edit and next-version settings. Pasted material is a labeled reference item. Existing richer context items keep their IDs, content and provenance. Turning Library off clears/disables pins and excludes selected library evidence; Web off excludes selected web evidence. Context-only generation still uses the saved public voice profile, author topic/notes and supplied material and still runs writing/review under existing budget limits.

Supplied excerpts carry `kind: agent_context` and caller-asserted provenance, including `suppliedBy: caller`; this covers UI and MCP without claiming independent verification. URLs are recorded as attribution, never fetched automatically. Only the public `idea` is sent as a web-search query, not pasted context or author notes. The full bounded supplied excerpts are available to writing and independent review. Signal inspection retains its existing explicitly labeled 800-character-per-source scope. Agent analysis cannot substantiate factual findings. A caller-attributed `author_statement` does not automatically become firsthand experience: actual author experience belongs in `notes` and must pass the existing review checks.
