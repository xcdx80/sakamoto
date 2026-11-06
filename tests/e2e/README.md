# Editor browser regressions

This private package uses Node 24.8+ separately from the application's Node 20 runtime. Install the application's locked dependencies first; the harness bundles its actual `ProductionEditor`, `WritingForms`, HTTP client and React from the application's `node_modules`.

From `tests/e2e`, using Node 24:

```sh
npm ci
npm run browser:install
npm run typecheck
npm test
```

`npm run test:list` shows the selected cases without launching a browser. `npm test -- --grep 'earlier revisions'` runs one case.

The runner starts the fixture server on an owned dynamic localhost port and stops its process after the run. No existing application server or browser profile is borrowed. Use Ctrl-C to interrupt the runner; it owns cleanup of its child server. Do not kill unrelated listeners. `.e2e/logs/fixture-server.log` records the selected port for diagnosis if the runner itself is forcibly terminated.

These are deterministic browser tests of the actual editor with synthetic HTTP responses. They prove editable platform selection, retained history, controls around unsaved/manual revisions and display of current reviewed source mappings. They do not exercise Clerk, the API server, database, paid providers, editorial quality, publication or production styling. No authentication is bypassed: the harness mounts the editor directly and makes no claim about signed-in routing. Real account/provider acceptance remains a separate journey. Root `tests/post-contract-audit.test.ts` covers the actual backend author-edit citation repair.

No model is configured and tests use no `agent.*` steps. Browser installation may download Chromium; these tests make no paid provider calls. Reports, traces, failure videos and server logs are under ignored `.e2e/`. Retain evidence before removing run output.
