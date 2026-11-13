# Engineering workflow

## Skills and invocation

Use Matt Pocock v1.3.1, commit `24fe0ef7737efae15c87225755e9f6f5965e4888`, from `https://github.com/mattpocock/skills`. Reuse `~/.agents/skills/<name>/SKILL.md`; do not duplicate upstream skill bodies into this repository. [Provenance and setup evidence](setup-evidence.md) records the selected skills and host discovery. Load the applicable skill before applying it.

Model-invoked disciplines: `grilling`, `domain-modeling`, `codebase-design`, `diagnosing-bugs`, `tdd`, `code-review`, `pr`, `writing-for-agents`. Model invocation is eligibility, not an execution guarantee.

Explicit user invocation only: `setup-matt-pocock-skills`, `grill-with-docs`, `to-spec`, `to-tickets`, `implement`, `implement-spec`, `triage`, `handoff`, `retro`, optional `ask-matt`. Preserve both SKILL.md invocation metadata and `agents/openai.yaml` policy. `ask-matt` is an optional router, not another planner.

## Feature work

1. Resolve unsettled requirements and terminology using grilling/domain modeling; reuse settled decisions. Read the tracker and domain instructions linked from AGENTS.md.
2. On explicit request, `grill-with-docs` combines the interview and domain documentation; `to-spec` synthesizes scope, acceptance criteria, module boundaries and public test seams; `to-tickets` creates vertical slices with dependency relationships.
3. On explicit request, use `implement` for a scoped build. Only explicit `implement-spec` starts parallel work across the ticket graph. Small specified fixes go directly through diagnosis/TDD and checks.
4. Agree new test seams before writing tests. Reuse approved seams. Work one failing behavioral test and minimal implementation at a time; mock external boundaries rather than internals.
5. Run applicable repository checks, independent Standards/Spec reviews, repair findings and reverify affected areas. Trace consumers and dependencies for risky changes; prove the key safety assumption with executable checks.
6. Commit/publish only within authorization. An authorized merge additionally requires current CI for the candidate and applicable runtime evidence. If CI is blocked by billing/quota, run the exact canonical commands natively and record explicit maintainer attestation before merge; a local pass alone is not that attestation.
7. Preserve evidence and clean up owned resources using the rules below.

For `code-review`, pin a resolved baseline SHA before changes and identify the originating user request/issue/spec. Use two independent parallel reviewers: Standards applies repository instructions and the skill's Fowler smell baseline; Spec checks the originating requirements. Each reviewer receives the same candidate and baseline, and works independently. For uncommitted setup or WIP, include tracked changes against the pinned baseline plus the explicitly listed new files; a three-dot HEAD diff alone misses uncommitted files. Keep reports separate, repair findings and reverify; mark review unavailable if independent execution cannot run.

## Actual checks and stages

Run commands from the repository root (`sakamoto/`). Node 24.22.2 (`.nvmrc`) and npm/package-lock.json are the current local toolchain. Production uses Node 24.x. The package manifest remains authoritative.

| Stage | Responsibility / current command |
| --- | --- |
| Install | `npm ci` uses the committed lockfile |
| Editing | Focused behavior check at an agreed seam; no automated application test runner exists yet |
| Completion | `npm run lint` (currently `tsc --noEmit`, type checking rather than a source style linter), then `npm run build`; `git diff --check`; applicable behavior/runtime acceptance |
| Pre-commit | `.githooks/pre-commit`: inexpensive `git diff --cached --check` on staged contents |
| Push | No push hook or repeated application suite |
| PR CI | `.github/workflows/verify.yml`: npm ci, npm run lint, npm run build, patch whitespace check; no behavior suite is implied |
| Runtime acceptance | Drive affected journeys in [runtime verification](runtime-verification.md); capture actions, outcomes and applicable external effects |

Activate the tracked hook in each clone with `git config core.hooksPath .githooks`, preserving an existing hook setup if one appears. Never bypass existing checks. No formatter, source style linter, automated boundary check, unit/integration test runner or required branch-protection rule is configured yet. Add ordinary stack tooling with the first agreed behavior change when needed; do not invent `npm test` or claim type checking is full lint coverage. Existing `scripts/pdf-eval/` and `scripts/image-eval/` are specialized evaluations; inspect prerequisites and costs before running, and preserve them.

Build fetches Google fonts and may need network access. CI uses a synthetic Clerk publishable key for compilation/prerendering only; this does not prove runtime authentication. A clean isolated build with that fixture passed. CI added here is unexecuted until published and run on GitHub. Do not add VM/container runners, daemons or trusted publishers for a future quota fallback. Change-aware selection is unnecessary at this size.

## Runtime and selected P-stack practices

Matt remains workflow owner. Selected practices come from [P-stack at 1dcc2ba](https://github.com/cursor/plugins/tree/1dcc2bacde73ddd284803b7af28164d0436198fc/pstack), specifically `create-verification-skill`, `principle-prove-it-works` and `blast-radius`: drive the real app, check readiness/build/auth/ownership first, maintain a small journey map, prefer semantic selectors and existing infrastructure, and capture action/state/side effects. Local fixtures and fake providers establish only local proof; authenticated account and real-provider results require separate evidence.

Use TesterArmy/e2e for new journey, smoke or live acceptance where supported; preserve existing runners. No supported automated journey runner is configured today. Browser control is currently `chrome-devtools-axi`; do not introduce Maestro. No P-stack installation, poteto-mode, automatic model panel, autonomous shipping, second queue/planner, or duplicate vendor `tdd` is enabled.

Project runtime guidance is a draft until launch, readiness, drive, evidence and cleanup have all succeeded for its stated journey. Keep any unexercised journeys explicitly unverified; do not promote a generated verification skill on filesystem presence alone.

## Ownership, evidence and cleanup

For every attempt, record borrowed resources separately from owned process IDs, ports, browser profiles, fixtures and scratch directories. Check build identity, authentication and owning checkout before driving. Stop only processes/simulators created by the run, using recorded identity; stop producers before removing disposable fixtures/state. Preserve logs, reports and relevant screenshots through teardown, and confirm they still exist. Retain failed/interrupted attempts for investigation.

Protect active, shared, pinned, unknown and unmerged resources. Archive eligible managed worktrees through supported recovery tooling. Default retention: seven days for bulky artifacts, thirty days for compact evidence, conditional on closure, evidence preservation and ownership checks; elapsed time alone never authorizes deletion. Do not install broad cleanup daemons or delete by name alone.
