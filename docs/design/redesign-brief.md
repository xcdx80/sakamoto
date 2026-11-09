# Sakamoto redesign brief

## The idea

**The Desk.** Everything you ever saved is a mess of paper on a desk. Sakamoto gathers it, marks it up, answers from it, and helps you write from it. The app is an annotator's desk: paper, ink, a yellow highlighter, a vermilion pen, and a few delightful objects that behave like real things.

Quality bar: top 1% of the web. Primary reference is v7labs.com (vast white space, large light serif, hairlines, particles gathering into meaning, patience). Playfulness reference is feather.computer (tactile paper objects, dot-grid desk, stamps, sticky notes, file tabs, mono annotations). Take the spirit only. Copy no layouts, assets or text from either.

Character: **minimal, clean, elegant, and quietly funny.** Mostly nothing on the page. Then one object that makes you smile.

## Rules of taste

1. One idea per screen. If in doubt, remove it.
2. Generous space. Sections breathe. Dense tools get calm, not cramped.
3. Hairlines over boxes. Shadows only on things that are physically lifted (paper, popovers).
4. Serif for voice, sans for tools, mono for tiny annotations. Display serif is large, light and tightly tracked.
5. Colour is rationed: ink on paper, vermilion for the model, marigold for your highlights. Object colours (`--toy-*`) appear only on small paper objects.
6. Play lives in small objects and in how things move: a stamp thuds, a sticky note peels, a paper plane loops, the logo's dot hops. Never in layout chaos or in tools people need to read.
7. Every empty, loading and error state is designed, and says something human.
8. No gradients as decoration, no glassmorphism, no emoji, no purple, no generic card grids with icons in circles.

## Copy

Keep existing product copy unless it is clearly improved, and keep every string listed under Hard constraints. Short. Plain. A little dry.

## Motion language

Use `motion/react`. Shared tokens and primitives are in `components/motion`:

- `tokens.ts`: `ease`, `spring.soft | snap | bouncy | thud`, `stagger`.
- `Reveal`, `Stagger`, `StaggerItem`, `Words`: entrance choreography.
- `Scribble` (`circle | underline | arrow | squiggle`) and `Marker`: hand-drawn ink and highlighter sweeps.
- `PageCurtain`: full-screen paper sheet on route change. Already mounted in the root layout.

Principles:

- Physical. Paper has weight: it settles with springs and slight rotation. Ink draws along its path. Highlighter sweeps left to right. Stamps overshoot, then thud.
- Tools respond in under 200ms. Choreography over 600ms is only for arrivals and stories.
- Animate `transform` and `opacity`. No layout-thrashing properties on long lists.
- Lists stagger only the first screenful (max 8 items, 40ms apart). Windowed lists never animate per item on scroll.
- `MotionConfig reducedMotion="user"` is global. Anything driven by `useScroll` or hand-rolled must also check `useReducedMotion()` and show a static, complete composition.
- Never apply `transform` to an ancestor of the reader text or of `position: fixed/sticky` chrome.
- Whole-screen moments: the arrival, the scroll story, the page curtain, the file-drop overlay, the generating-draft stage, the first-open of a text.

## System

Tokens live at the top of `app/globals.css`; components in `app/system.css`:

- Colours: `--bg --bg-raised --bg-sunk --ink --ink-2 --ink-3 --ink-4 --rule --rule-strong --rubric --mk-yellow`, objects `--toy-marigold --toy-vermilion --toy-cobalt --toy-moss --toy-blush --toy-sky --toy-kraft --toy-lilac`. Use tokens, never hex, so all five themes keep working.
- Fonts: `font-serif`, `font-sans`, `font-mono` (DM Mono), `font-hand` (handwriting, margin notes and story only).
- Classes: `sk-btn sk-btn-ink|ghost|quiet`, `sk-chip`, `sk-field`, `sk-eyebrow`, `sk-paper`, `sk-hairline`, `sk-display`, `sk-desk` (dot grid), `sk-panel`, `sk-empty`.

## Hard constraints

This is a presentation change. Do not change domain logic, API calls, stores or lib modules.

### Safety

- The dev server uses the real database and paid providers. Never submit imports, questions, generations or destructive actions while checking your work. Do not sign in or enter credentials.
- Do not commit, stash, reset, or discard anything. There is uncommitted user work everywhere.
- Edit only the files your assignment owns.

### Home and library hooks

- `.home-answer textarea` (used by the `/` shortcut), `[data-row]`, `--library-columns`, `[data-index]`, `.content-window`, `.content-card` with `aria-setsize` and `aria-posinset`, `theme-swap`, all `data-tip*` attributes, events `gloss:key` and `sakamoto:budget`.
- `h1` matches `/Ask.*knowledge base/`. `textarea[placeholder="Ask anything about what you’ve saved…"]` (curly apostrophe). Submit button text exactly `Ask your knowledge base`. Home must not contain "Paste a link" or "selected content type".
- `ContinueReading` stays exported from `LibraryLine`, with `section[aria-label="Continue reading"]`, `N% read`, links to `/read/id` and `/library`.
- `button[aria-label="X sync status"]` with `aria-expanded` and `aria-haspopup=dialog`; closed state renders no dialog or section, no "Process now" or "Last posts delivered".
- `ImportBar` keeps props and "Processing budget".
- `ContentCards`: "Category queued", "Search indexing queued", no nested anchors, `[aria-label="Related saved sources"]`, "Linked reading", "From X bookmark", "From saved X post", link `aria-label="Read {title}"`.

### Reader, load-bearing

- Keep exactly: `[data-block] .blk-text data-type data-n .prose-read .pnum` (outside `.blk-text`, `user-select: none`), `.reader-md-syntax { display: none }`, `[data-md-replacement] data-source-from data-source-to`, `white-space: pre-wrap` on `.reader-markdown`, `[data-g] [data-h] data-c .m-hl .m-gloss .m-pending is-active is-hover is-new`.
- `.blk-text` textContent must equal the source: no injected text.
- `.m-*` styling must not change text metrics. `Margin` positions from range rects.
- Do not add `content-visibility` or windowing.
- Outside-click allowlist: `.gloss, [data-g], .lens, .pop, header, aside, [role=dialog], .cite, .sheet`. Do not rename.
- `.lens` and its `onMouseDown` preventDefault preserve the selection.
- Grid: `.reader-grid .rg-rail .rg-numgap .rg-gutter .rg-margin`, breakpoints 720, 1080, 1260, Margin leader gutter 52/64.
- `.gloss` and `.mnote` are placed by `transform: translateY` from `marginStyle`. Do not animate their transform with Motion.
- JS reads or sets: `.focus-mode .focus-hide .blk[data-read] .hide-nums .nb-open .is-flash .is-cursor [data-lens-docked] .composer`, `--topbar-h` (60px), `[data-face] [data-align] [data-paras] [data-theme] --read-size --measure-k`.
- Tests: `[aria-labelledby="saved-text-heading"]` and its `h2` labels; `[aria-label="About author-thread context"]`; `section[aria-label="Author thread and context"]` without `.focus-hide`; `ol > li[data-post-id]`; `[aria-label="Thread gaps"]`; `ListenButton` disabled, "Reading aloud unavailable".

### Write and calendar

Accessible names and text used by tests must stay exact: "Edit post", "Save draft", "Save & review edits", "Copy X", "Copied", "Continue to draft", "Continue review", "Approve revision 1", "Brief", "Generate new version", "Add to calendar", "Hide draft context", "Show draft context", "New post", "Calendar", "Today", "Next month", "Previous month"; regions "X feed preview", "LinkedIn feed preview", "Selected day"; headings starting "Issues", "Research & citations", "Posts 1"; text "Revision 1 · saved"; labels "X post", "LinkedIn post", "Plan a publication time", "What do you want to post about"; day label format "Tuesday, 10 November 2026 · 2 planned posts"; "0 planned posts · America/New York"; `img` "X + LinkedIn"; fieldset legends "Find additional sources", "Paste supporting material"; `input[aria-label="Pin source source: Saved source"]`; "Context only", "Open original source", "already has 8 context items". "Good writing begins" and "Publication calendar" must stay absent.

## Verifying your work

- Dev server: `http://localhost:3100` (already running; do not start another). Signed-out states are visible directly. Do not sign in.
- `npx tsc --noEmit` must stay clean. Relevant tests: `npm test`.
- Write screens have a synthetic harness in `tests/e2e`.
- Check desktop 1440 and phone 375, paper theme and night theme.
