# Runtime setup acceptance

Date: 2026-10-15. Isolated source export: baseline `54b13b8882d8a109132c5b2045acd6b45628563d` from `/Users/b/Documents/ChatGPT/Sakamoto/sakamoto`. No product diff. Export directory `/tmp/sakamoto-workflow-runtime`; installed dependencies hard-linked, Clerk development configuration copied without displaying values. No database or provider keys copied. No migration, model call, sign-in or account write performed.

1. Borrowed instance: port 3100, PID 21063, original checkout. Preserved.
2. Sandbox dev launch: `node node_modules/next/dist/bin/next dev --port 3101 --hostname 127.0.0.1` failed EPERM. Sandbox build was interrupted before a verdict; retained log is not a build failure or pass.
3. With permission, `npm run build` passed using Clerk development configuration. It compiled, type-checked and generated 21 static pages. Build log preserved.
4. Network-enabled dev at 127.0.0.1:3101 became process-ready (PID 1037), but route readiness failed: HTTP request timed out and middleware logged localhost proxy ECONNRESET. Browser showed Internal Server Error. Stop recorded session; do not infer root cause or claim dev acceptance.
5. Preferred Chrome CLI failed BRIDGE_NOT_READY. Its stop command later reported stopped (no-op). Used the in-app browser fallback.
6. Clean build experiment: temporarily remove .env.local, set only synthetic `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZXhhbXBsZS5jb20k`, run `npm run build`: exit 0. Restore configuration. This proves compilation/prerendering without account secrets, not working authentication. This exact fixture is now the CI build env.
7. Rebuild with development auth restored: exit 0. Owned final production command: `node node_modules/next/dist/bin/next start --port 3101 --hostname localhost`. Ready in 287ms. Listener PID 11436 on ::1:3101, `lsof -a -p 11436 -d cwd -Fn` verified isolated export. Build ID `RxYDUaL3frMlSXcBPiP_k`.
8. Owned browser tab 1: navigate to `http://localhost:3101/read/on-a-piece-of-chalk`. Observed title, body, 63 paragraphs, and Sign in control (signed out). Click current Keyboard shortcuts button; resulting Keys panel listed selection questions, paragraph navigation and other controls. No model/provider action was invoked. screenshot and filtered AX state preserved beside this report.
9. Closed owned tab. Interrupted only the recorded production session; it exited. Preserve evidence before removing disposable runtime state. Post-teardown ownership/evidence checks are recorded in setup-evidence.md.

Acceptance: production sample rendering and shortcuts only. Library/search, importing/persistence, PDF, model/search providers, quota and account sync are unverified. This is narrow local runtime proof, not full product acceptance.

Stored build logs normalize trailing whitespace; original temporary logs are retained for investigation.
