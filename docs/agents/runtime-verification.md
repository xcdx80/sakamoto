# Runtime verification

Status: production bundled-reader/shortcuts cycle exercised on 2026-10-15; other journeys and development launch remain draft. This is project guidance, not an installed verification skill. See setup-evidence.md for the exact local proof and limits.

## Launch and doctor

1. Read `.env.example` and use authorized development credentials. Clerk's provider and middleware are unconditional even though signing in is optional; a running process alone does not prove signed-out readiness. Keep secrets out of logs. Provider keys and Neon are needed only for their corresponding journeys; do not run `npm run db:migrate` against an unknown database.
2. Record checkout path, `git rev-parse HEAD`, working-tree changes, tool versions, chosen port, launch command and owned/borrowed resources in an evidence directory outside disposable state. Default dev: `npm run dev` (port 3100); development readiness has not passed this setup acceptance. Prefer the exercised production launch for the sample smoke check. For an owned alternate instance: `npm run dev -- --port 3101 --hostname localhost`. Production: `npm run build`, then `npm run start -- --port 3101 --hostname localhost`.
3. Check `lsof -nP -iTCP:3101 -sTCP:LISTEN` and `lsof -a -p <recorded-pid> -d cwd -Fn`. If occupied or unknown, borrow only after verifying ownership and auth state, or choose another unused port. Never kill an unknown listener. Read the launch log for Ready, then GET the target route and confirm its expected UI.
4. Before driving, confirm the URL/port, owning checkout, source revision and dirty-state identity, auth state and visible target route. For production, record `.next/BUILD_ID`; for dev record the launch manifest/source revision instead. A redirect to sign-in, a Clerk setup screen, or HTTP 500 is a readiness failure.

## Drive and evidence

Prefer TesterArmy/e2e when configured; no runner exists in this project yet. Preferred host browser entry (bridge unavailable during setup): `chrome-devtools-axi open http://localhost:3101/read/on-a-piece-of-chalk`, then `snapshot`. Obtain current element IDs from each snapshot before `click @<uid>` or `fill @<uid> <text>`. Use semantic accessible names in the map; never cache IDs across navigation. Capture `screenshot <absolute-evidence-path>` and console/network evidence when relevant. If that bridge is unavailable, use the supported CUA in-app browser: `cua.createBrowserTab("iab", "http://localhost:3101/read/on-a-piece-of-chalk", {visible:false})`; inspect `getAXState()`, click the current Keyboard shortcuts element, inspect the resulting Keys panel, save `getScreenshot()` bytes and the relevant state, then close only that owned tab. This fallback was exercised during setup. Do not export auth headers, tokens, private reading content or environment values.

| Journey | Entry point and prerequisites | Actions and expected outcome | Failure states / proof limits |
| --- | --- | --- | --- |
| Bundled reader | `/read/on-a-piece-of-chalk`, signed-out isolated browser; bundled sample needs no model/DB | Verify title On a Piece of Chalk and body text; open Keyboard shortcuts and observe the shortcuts UI | Wrong route, blank reader, missing sample, Clerk setup/error; proves rendering only |
| Local library | `/library`, clean local browser data | Search using Search the library, open a bundled sample, return to library; verify results and reader title | Empty/wrong filter or missing sample; sample visibility can be persisted per device |
| Import text | Home Paste text flow; disposable browser profile | Paste a distinctive disposable article, open it, reload, verify title/body and library entry | Parse failure or missing persisted text; IndexedDB/localStorage persist per browser profile; URL import is a separate network path |
| Ask in margin | Reader selection/composer; authorized Together development provider or labelled demo behavior | Ask a question, observe streamed margin answer and paragraph citations; capture request outcome without secrets | Demo output is not provider proof; real Together/Exa usage and quota behavior need separate checks |
| Account sync | Authorized Clerk test account and isolated Neon DB/schema | Sign in, create disposable reading state, load it on a second isolated browser, verify sync and cleanup | Signed-out local persistence does not prove sync; identify and remove only owned account fixtures |

Record action + resulting state for each attempted journey, URL/build/auth identity, verdict and relevant side effects. For local persistence, reload through the public UI. For sync/provider work, include the relevant external result at the public interface; do not infer it from a screenshot alone. Track failures and unsupported prerequisites explicitly.

## Cleanup

Record the exact owned launch session/PIDs and browser tabs/profile before acting. Stop that session, confirm its port is closed, then remove disposable fixtures/profile/state. Use `localhost` consistently for the exercised production path; the attempted 127.0.0.1 development path failed middleware readiness. Keep borrowed port 3100 and existing user data untouched. Close only tabs created by the run; stop a browser only if the run created it and it has no borrowed tabs. Preserve evidence, including failed/interrupted attempts, outside the disposable runtime directory and confirm it survives. Follow retention and protected-resource rules in engineering-workflow.md.

Setup attempt details and remaining limitations are in [setup evidence](setup-evidence.md).
