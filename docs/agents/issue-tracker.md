# Issue tracker: GitHub

Issues, specs and tickets live in [xcdx80/sakamoto Issues](https://github.com/xcdx80/sakamoto/issues), the repository's origin. Issues were enabled on 2026-10-15 at the user's request. Upstream `Nutlope/gloss` is not our tracker.

## Operations

Use explicit `-R xcdx80/sakamoto` for every supported `gh-axi issue`, `pr`, `label`, or `run` command; fork defaults can target upstream. Inspect `--help`; use `gh` only when the wrapper lacks or fails to forward a needed capability.

- Read a ticket: `gh-axi issue view <number> -R xcdx80/sakamoto`; include comments when relevant using the supported flags.
- List work: `gh-axi issue list --state open -R xcdx80/sakamoto`, with applicable status/label filters.
- Publish a spec or ticket: create a GitHub issue in origin within the request's authorized publication scope. Use the originating requirements as the body and preserve acceptance criteria.
- Use a body file for multiline issue descriptions or comments. If unsupported by gh-axi, use the corresponding `gh issue` operation with `--repo xcdx80/sakamoto --body-file <path>`.
- Apply the canonical labels in [triage labels](triage-labels.md). Record execution progress and evidence in the issue; claim work explicitly before acting.
- Use native GitHub issue dependencies where supported. Otherwise record `Blocked by: #N` near the top and check the referenced issues' live states. Work is actionable only when all blockers are resolved and it is unclaimed.
- Fetch every relevant ticket and its discussion before implementation. Append decisions and verification evidence rather than discarding history.

## Pull requests as a triage surface

PRs as a request surface: no.

## Scope

Planning, publication, implementation, commits/pushes and merges are distinct actions. A planning request grants only its stated scope. No product issues or tickets were created by this setup. The previous local Markdown fallback is retired; no local planning files needed migration.
