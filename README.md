<p align="center"><img alt="Sakamoto" src="public/sakamoto.svg"></p>

# Sakamoto

A private knowledge library for saved X posts, articles and documents. Read the original text, keep notes and highlights, search saved passages, and ask questions with citations that open the supporting saved source.

## Application

Sakamoto is one Next.js application with Clerk authentication and Neon Postgres as its only server database. Neon stores source revisions, annotations, import relationships, durable processing jobs, full-text passages, pgvector embeddings and the cumulative processing ledger. Account-scoped browser storage caches reading data and local PDF originals; it is not a second server database. Public bundled samples and anonymous local reading remain available; private synchronization, agent connections and paid processing require an authenticated account.

- Google `gemini-embedding-2` supplies 768-dimensional retrieval vectors. Exact-word search remains available while indexing or embedding work is pending or paused.
- TypeSafe `jev-latest` chooses from a finite taxonomy. Manual categories, titles and tags are preserved; Jev does not invent free-form tags.
- OpenAI `gpt-6-luna` answers reader and library questions under the same durable budget. Library answers use saved evidence only. Source IDs, current revisions and saved addresses are checked; inspect the excerpts to assess substantive support.
- Optional Exa lookup is limited to the existing reader Web/fact-check operation and requires its configured spending ceiling. It is not mixed into library evidence.

Grok-assisted v1 accepts full bookmarked posts through authenticated MCP. Grok owns X access and the bookmark-fetch routine; Sakamoto owns persistence, deduplication, author-thread/context reading, directly linked article/PDF imports, classification, indexing and answers. There is no Birdclaw, SQLite, Redis or separate worker deployment. A daily processing cron advances material already received; it cannot wake Grok or fetch new bookmarks itself.

The library offers cards/list, sorting and topic/tag/content-type filters. Reader notes, highlights, progress, previously generated answers and saved cover images remain readable. New speech, cover generation, PDF OCR and paid layout/careful parsing are unavailable; no replacement model is silently invoked. Local PDF text-layer import remains supported without a personal model key, up to 400 pages, with explicit incomplete coverage. Server linked-PDF processing retains its bounded text-layer extractor and page addresses; scanned/password-protected documents expose a recovery path for supplied text.

## Run locally

1. Use the repository's Node/npm toolchain (locally verified with Node 20.20.2) and run `npm ci`.
2. Populate ignored `.env.local` from `.env.example`. Set Neon and Clerk credentials; configure server-side Google, TypeSafe and OpenAI keys for their operations. Missing providers pause the corresponding paid work rather than return demo answers. No personal provider key belongs in the browser.
3. Confirm that `DATABASE_URL` names the intended Neon project/branch before running `npm run db:migrate`. This applies recorded ordered migrations, including pgvector, without resetting existing source IDs or data. Never use an unknown database as a test target.
4. Run `npm run dev` and open [localhost:3100](http://localhost:3100). Sign in for your private library. Read a bundled sample or import a link, pasted text, `.txt`, `.md` or readable PDF.
5. Open Connect an agent to create a personal MCP token. Use `/mcp` with an Authorization Bearer header when supported. The setup panel offers an explicit URL-token compatibility option only for clients that require it; credential URLs must remain private and can appear in logs. Token creation/list/revocation requires the Clerk session and intended account, not an agent token.

MCP supports structured bookmark batches/receipts, thread/source reading, received-work status/processing, direct source recovery, category/index scheduling, metadata/passage search and `ask_library`. `read_saved_source` retrieves the exact retained source separately from bounded retrieval excerpts. In Connect an agent, prepare the daily Grok prompt after entering the public HTTPS Sakamoto origin and routine time. Preparing a prompt does not enable or verify a Grok routine. Save per-item receipts and resume batches; an accepted batch is not proof of a complete bookmark archive.

## Processing budget

`SAKAMOTO_BUDGET_USD=10` is one cumulative deployment-wide cap with no monthly reset. Each paid call reserves a conservative maximum in Neon before dispatch. Reported usage settles the reservation; uncertain dispatched usage remains reserved. New paid work pauses when authorization is unavailable, leaving saved text, manual organization and available lexical search usable. Raising the configured cap is intentional; retries or redeploys do not reset the ledger.

Inspect Processing budget in the app. Reconcile only independently verified receipts using `npm run budget:reconcile -- /absolute/receipt.json`; the receipt contract is in `scripts/reconcile-paid.ts`. This ledger controls application requests, not other uses of the same keys, Grok subscriptions or an exact external invoice total.

## Verification and deployment

Run `npm run lint`, `npm run build` and `git diff --check`. `lint` is TypeScript checking. Behavior tests require an explicitly owned isolated Postgres instance with pgvector and the `sakamoto_test` role: `SAKAMOTO_TEST_PG_SOCKET=/tmp/sakamoto-tests/socket npm test`. Each process creates its own schema; tests never fall back to `.env.local`/`DATABASE_URL`. Provider transports use deterministic fixtures; that does not establish actual provider or hosted acceptance.

Vercel configuration enables Fluid compute and one daily secured processing cron (`0 5 * * *`, UTC). Existing route durations fit Hobby's documented Fluid limit; Hobby daily cron execution can occur within the scheduled hour. Verify actual project/runtime/account settings before release. See [Fluid compute](https://vercel.com/docs/fluid-compute), [function limits](https://vercel.com/docs/functions/limitations) and [Hobby cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Before an authorized deployment, configure the intended Clerk application/domain, known Neon branch/migrations, server provider keys, unique `CRON_SECRET` and public HTTPS `NEXT_PUBLIC_SITE_URL`. Preserve `next.config.ts` PDF-worker JS/WASM tracing; the Node worker runs within the app. The cron authenticates its secret and processes bounded durable work. Deployment does not establish Grok connectivity: separately verify the public MCP origin, intended account, real mixed source delivery, daily routine and resumed backfill.

Record the exact candidate and distinguish deterministic tests, actual account/provider/browser results and hosted/Grok results. Do not claim a recovered ~1,800-item collection from synthetic scale tests or partial receipts. Publication/deployment is a separate authorized action; prepare the reviewable release candidate first.

Historical `scripts/pdf-eval/` and `scripts/image-eval/` tools retain their explicit optional legacy-provider prerequisites and evidence. They are not application runtime requirements and must not be run as ordinary verification.

Public-domain samples: Huxley, “On a Piece of Chalk”; Schopenhauer, “On Thinking for Oneself”; Thoreau, “Reading” from Walden. Rebuild with `scripts/build-samples.mjs`.
