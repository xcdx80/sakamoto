<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Agent skills

Matt Pocock's pinned skills are the primary engineering method. Global installation and invocation rules: [engineering workflow](docs/agents/engineering-workflow.md). Read that document before implementation, verification, review, publication, or cleanup.

### Issue tracker

Track issues and specs in GitHub Issues on origin, `xcdx80/sakamoto`. Read [issue tracker](docs/agents/issue-tracker.md) before planning, ticket operations, or publication. Always target `xcdx80/sakamoto` explicitly for GitHub operations; `upstream` belongs to another project.

### Triage labels

Use the five standard roles in [triage labels](docs/agents/triage-labels.md).

### Domain docs

Single-context: root `GLOSSARY.md` and `docs/adr/`, created only as real terms and decisions arise. Read [domain rules](docs/agents/domain.md) before domain exploration.

### Routing and responsibilities

- Complete authorized work through verification and repairs; stop at an explicit review boundary or concrete blocker. Preserve unrelated user work.
- Use `grilling` for unresolved requirements, `domain-modeling` for terminology or domain decisions, `codebase-design` for module boundaries/interfaces/seams, and `diagnosing-bugs` for regressions with an unclear cause.
- Use `tdd` for behavior changes at agreed public interfaces: failing test, minimal repair, next vertical slice. Reuse approved seams; confirm only genuinely new boundaries before writing tests. Test observable behavior; mock external boundaries when needed and avoid private implementation coupling.
- Use `code-review` for independent Standards and Spec reviews against a pinned baseline and originating requirements. Follow `pr` when preparing a pull request.
- User-invoked workflows require the user to name them: `grill-with-docs`, `to-spec`, `to-tickets`, `implement`, `implement-spec`, `triage`, `handoff`, `retro`, and optional `ask-matt`. Ordinary `implement` does not activate parallel ticket orchestration. Installation makes model-invoked skills eligible; it does not guarantee execution.
- A small specified fix can proceed directly through diagnosis/TDD, verification and review without a new interview/spec/ticket hierarchy.
- UI owns rendering, local presentation state and event wiring. Services/domain modules own domain rules, calculations and transformations; adapters own API calls, database access and external I/O. Preserve stable interfaces and clear responsibilities; abstract only at real boundaries.
- Prefer `rg` and noninteractive one-shot commands; start a persistent server only for required runtime inspection. Trace affected callers, contracts and dependencies far enough to explain the change.
- Lint changed source and run relevant behavior checks plus broader gates selected by the workflow. Repair introduced failures without suppressing controls, then rerun affected checks.
