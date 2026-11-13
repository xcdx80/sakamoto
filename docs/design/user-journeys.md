# InView user journeys

Mapped from the code on 2026-11-09. Each journey lists its entry point and owning component. The redesign changes how these look and move, not what they do.

## First contact

| # | Journey | Entry | Owner | States to design |
|---|---|---|---|---|
| 1 | App boot and account gate | Every route | `components/account/SyncAgent.tsx` | Loading library |
| 2 | Sign in (Clerk modal) | TopBar, "Sign in to ask", connect, import, admin | `components/account/Account.tsx` | Signed out, signed in |
| 3 | Sign-in nudge after a first mark | Reader | `components/account/SignInNudge.tsx` | Hidden, toast |
| 4 | Adopt anonymous library | Library, signed in with local items | `components/library/Library.tsx` | Offer, kept separate, failed |

## Home

| # | Journey | Entry | Owner | States to design |
|---|---|---|---|---|
| 5 | Ask your knowledge base | `/` | `Landing`, `Hero`, `LibraryAnswer` | Signed out, busy, answer, partial, insufficient, error |
| 6 | Intake by paste, drop, `?url=`, `?save=` | Anywhere on `/` | `Landing` | Dragging, busy, error, saved |
| 7 | Secondary line | `/` | `LibraryLine` | Blank, saved, samples, continue reading, count |
| 8 | Shelf sheet | `S` key | `ShelfSheet` | Texts, highlights, empty, no match, rename, exported |
| 9 | The story (new) | Scroll on `/`, signed out | `components/landing/story` | Full, reduced motion, phone |

## Library

| # | Journey | Entry | Owner | States to design |
|---|---|---|---|---|
| 10 | Browse, search, filter, sort | `/library` | `Library`, `ContentCards`, `WindowedCards` | Skeleton, grid, list, empty, filtered empty, sync error, retries |
| 11 | Manage an item | Card, Manage | `ContentDetails` | Form, sample, confirm remove, scheduling |
| 12 | Add links | Add articles | `AddPanel` Links | Idle, saving, per-row states, note |
| 13 | Connect an agent | Add articles | `AddPanel` Agent | Signed out, form, token once, connected, error |
| 14 | Starter shelf | Fewer than 6 own items | `Starter` | Idle, saving, failed |
| 15 | Library Q&A and passages | Signed in | `LibraryAnswer`, `EvidenceSearch` | Busy, answer, hybrid or exact notices |
| 16 | Processing and arrivals | Background | `LibraryProcessing`, `XSyncStatus`, `Processing`, `Arrivals` | Checking, paused, error, processing, done |
| 17 | Bookmark import | `/library/import` | `BookmarkImport` | Loading, signed out, unconfigured, connected, all run states |

## Reading

| # | Journey | Entry | Owner | States to design |
|---|---|---|---|---|
| 18 | Open and resume | `/read/[id]` | `Reader` | Loading, missing, ready, archived banner, resumed toast |
| 19 | Select, then ask, highlight or note | Text selection | `Lens` | Actions, ask, note, docked on touch, existing highlight |
| 20 | Gloss lifecycle | Lens, Composer | `GlossCard`, `Margin` | Collapsed, mini, active, writing, streaming, error, budget |
| 21 | Ask about the whole text | `/`, Cmd-K | `Composer` | Idle, focused, hidden while docked |
| 22 | Overview | `B`, pill | `Brief` | None, loading, error, ready |
| 23 | Notebook | `N` | `Notebook` | Empty, list, filtered, archived, signed-out note |
| 24 | Navigate and focus | Scroll, rail, `F` | `Rail`, reader `TopBar` | Tucked, progress, focus mode |
| 25 | Source context | Below the text | `ThreadReading`, `ReadingConnections`, `LinkedDocuments` | Loading, signed out, unavailable, ready, gaps |

## Writing

| # | Journey | Entry | Owner | States to design |
|---|---|---|---|---|
| 26 | Gate and desk | `/write` | `WriteDesk`, `PostsOverview` | Auth loading, signed out, failed, empty, list, ideas |
| 27 | Brief | New post, `?source=` | `BriefForm` | Valid, invalid, busy, missing source |
| 28 | Generating | After brief | `ProductionEditor` | Five stages, paused, resume |
| 29 | Edit and review | `?post=` | `ProductionEditor`, `PostInspector`, `SourcesPanel`, `BriefPanel`, `DecisionsPanel`, `ReviewPanel`, `PlatformPostPreview` | Dirty, history, comparing, stale, 409 |
| 30 | Approve, plan, publish | Editor | `ProductionEditor` | Approved, planned, published, cancelled |
| 31 | Voice and notes | Your voice | `ProfileForm` | Default, saved, busy |
| 32 | Calendar | `/calendar` | `PostCalendar` | Month, selected day, empty day |

## Around the edges

| # | Journey | Entry | Owner | States to design |
|---|---|---|---|---|
| 33 | Appearance | Aa | `SettingsMenu` | Compact, tabs |
| 34 | Processing budget | Wallet | `KeyMenu` | Loading, error, paused, halted, reserved |
| 35 | Tooltips | `data-tip` | `Tooltips` | Shown, suppressed |
| 36 | Error and 404 | Runtime, unknown route | `app/error.tsx`, `app/not-found.tsx` | Static, retry |
| 37 | Dashboard | `/admin` | `AdminDashboardView`, `AdminFailures` | Signed out, unavailable, ready, busy |

## Found while mapping

- `HomeBelow`, `DailyHighlight`, `Desk`, `PasteSheet`, `Shelf`, `Topics` and `BookOpen` are not mounted anywhere.
- The shelf sheet can only be opened with the `S` key.
- The error page's "Library" link goes to `/`, not `/library`.
- `/admin` has no role check; it shows the signed-in user's own statistics.
- README mentions "I've published this", which has no UI.
