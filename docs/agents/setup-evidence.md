# Workflow setup evidence — 2026-10-15

Baseline: `54b13b8882d8a109132c5b2045acd6b45628563d`. Scope: workflow configuration only; no product implementation, commit, push, PR, migration, deployment or merge. Preserve the pre-existing `.gitignore` addition `.clerk/`.

## Skills

All 17 required skills plus optional `ask-matt` are reused from `~/.agents/skills`. Their complete recursive file sets and SHA-256 bytes match the upstream archive at v1.3.1 / `24fe0ef7737efae15c87225755e9f6f5965e4888`. [Machine-readable provenance](skills-provenance.json) records every selected skill, supporting-file hash and invocation metadata. No duplicate installation or upstream-body edits were made. The source repository's root license remains upstream at the pinned link recorded in provenance; there was no new installation stripping license files.

A new `codex app-server` process (CLI 0.132.0), initialized with the real host configuration, answered `skills/list` with `forceReload: true` for this checkout: all 18 selected skills enabled, global paths returned. [Discovery response extract](skill-discovery.json) preserves the selected records and loader errors. This tests host discovery rather than inferring it from filesystem presence. User-only skills need not appear in the model's automatically eligible catalog; their explicit invocation policy is intact.

Unrelated host warning: `~/.codex/skills/origami-sequencer/SKILL.md` has invalid YAML (line 2 column 509); selected Matt skills still load. Not repaired in this project scope.

## Tracker and configuration

Initial inspection found origin `xcdx80/sakamoto` is a fork with Issues disabled (`has_issues: false`), so setup initially used local Markdown. On the user's follow-up, Issues were enabled and verified (`has_issues: true`); GitHub Issues is now the configured tracker. All five standard labels are verified: existing `wontfix` plus four newly created roles. An initial unqualified label-create attempt targeted upstream and returned 404; no label was created. Every future GitHub command must explicitly target origin. Origin has no CI runs; upstream Copilot runs are not origin verification evidence.

Configuration files:

- `AGENTS.md`: preserves generated Next.js instructions, adds skill routing and context pointers.
- `docs/agents/issue-tracker.md`, `triage-labels.md`, `domain.md`, `engineering-workflow.md`: GitHub tracker, standard vocabulary, lazy domain docs and primary engineering method.
- `.github/workflows/verify.yml`: canonical PR/push verification; `.githooks/pre-commit`: staged whitespace check, activated for this clone.
- `docs/agents/runtime-verification.md`: narrow runtime recipe and five-journey map with explicit limits.
- `docs/agents/skills-provenance.json`, `skill-discovery.json`, `setup-evidence.md` and `evidence/`: version, loader, checks, reviews and runtime proof.

No empty domain documents were created.

## Checks and limits

- `npm run lint`: passed on the working checkout (TypeScript only).
- `actionlint .github/workflows/verify.yml`: passed.
- `.githooks/pre-commit` and `git diff --check`: passed; the hook is executable and `core.hooksPath` is `.githooks` in this clone.
- No automated behavior tests, formatting check, source-style lint, boundary checker, branch-protection rule, or e2e runner exists yet. Hosted CI requires publication and a real run before it counts as current CI.
- `npm run build`: passed in the isolated baseline export with development auth; a second clean build with no .env.local and only the synthetic CI publishable-key fixture also passed. Logs are in evidence/.
- Pre-commit hook behavior: a temporary Git repository with bad staged trailing whitespace was rejected; the repaired staged patch passed. Fixture repository removed after the check.
- Production sample runtime: passed launch, ownership/build/auth readiness, reader rendering, Keyboard shortcuts interaction, evidence capture and producer/tab cleanup. Other journeys and the development path remain unverified; see evidence/runtime-attempts.md.

## Runtime ownership

Borrowed: port 3100 / PID 21063, cwd this checkout; preserve it. Owned: isolated HEAD export `/tmp/sakamoto-workflow-runtime`, separate port 3101, dependency hard links, copied Clerk development configuration only (no database/provider keys). Source identity is baseline HEAD; workflow-only files do not change product rendering. Evidence stays outside disposable runtime state. Initial sandbox launch failed with EPERM; sandbox build was interrupted before a verdict. These are not product failures or passes.

## Fresh independent validation

A separate agent context loaded all 17 required skills plus ask-matt, all 53 recursive files and agents/openai.yaml metadata. File hashes matched the recorded upstream comparison and all 18 host-discovery entries. Eight model-eligible and ten explicit-only policies agree across SKILL.md and openai.yaml.

Dry-run routing: specified import bug -> diagnosis/TDD at an existing approved seam without unnecessary planning; unresolved account terminology -> grilling + domain-modeling; unnamed user-only workflows stay inactive; ordinary implement does not activate implement-spec. These checks validate routing decisions, not execution of product workflows.

## Standards review

Independent Standards reviewer found no hard violations. It flagged a CI build-auth gap, repaired by the synthetic build-only publishable key and verified clean build; reviewer confirmed resolution. Concise routing duplicated between AGENTS.md and the detailed workflow remains an acknowledged soft maintenance concern, justified by the request to put routing in project instructions.

## Spec review

Independent Spec reviewer found zero configuration defects against the attached originating request. It confirmed invocation metadata, scope boundaries, routing and independent-review support. Its initially pending checks are now covered by the recorded build, narrow runtime cycle and cleanup evidence. Standards and Spec contexts were separate.

Review result: Standards 0 unresolved hard findings (1 soft duplication concern); Spec 0 findings. Hosted CI, broader product journeys, real-provider and account-sync acceptance remain unverified.

## Teardown confirmed

Port 3101 has no listener after stopping the owned sessions. Borrowed port 3100 still has its original PID 21063. The owned browser tab was closed and the failed Chrome bridge stop was a no-op. Evidence files (screenshot, filtered state, attempt journal, success/failure/interruption logs) exist after teardown. Removed the copied credential file after stopping producers. A local dcg PreToolUse safety hook rejected recursive temporary-directory deletion (`heredoc.python:shutil_rmtree`); isolated export `/tmp/sakamoto-workflow-runtime`, source export `/tmp/sakamoto-workflow-sources` and downloaded archives remain for recovery/investigation. No attempt was made to bypass that guard. No user workspace, borrowed instance, global skill, shared resource or managed worktree was removed.

Setup is ready for a separate product request. Configuration remains local/uncommitted. GitHub Issues is enabled and configured; hosted CI awaits publication/execution. Unexercised journeys remain draft. The unrelated origami-sequencer loader warning remains outside scope.

## GitHub tracker follow-up

User explicitly requested enabling Issues. `gh-axi repo edit --enable-issues -R xcdx80/sakamoto` did not forward the advertised option and returned a noninteractive edit error, so `gh repo edit xcdx80/sakamoto --enable-issues` supplied the missing capability. `gh api repos/xcdx80/sakamoto` verified `has_issues: true`. Created needs-triage, needs-info, ready-for-agent and ready-for-human through gh-axi; reused wontfix. Origin label listing confirms all five. AGENTS.md, issue-tracker.md and triage-labels.md now use GitHub; there were no local planning files to migrate.

## Workspace instruction entry point

The Codex workspace opens at the parent `Sakamoto/` directory, above the Git root `sakamoto/`. Added a local parent `AGENTS.md` directing fresh sessions to read the repository AGENTS.md before repository work and run commands from the actual Git root. The pointer resolves to the canonical workflow; the parent file is outside the Git repository and is local workspace configuration. Existing fresh-session skill/routing evidence above was gathered at the repository root; the parent pointer was checked structurally, not through another fresh-agent routing run.
