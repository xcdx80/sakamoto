import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { configureArticleFetch, fetchArticle } from "../lib/fetch-article";
afterEach(() => configureArticleFetch({}));
test("public article fetch rejects hexadecimal IPv4-mapped loopback and private redirect targets before requesting them", async () => {
  let requests = 0;
  configureArticleFetch({
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async () => {
      requests++;
      return new Response(null, {
        status: 302,
        headers: { location: "http://[::ffff:169.254.169.254]/meta" },
      });
    },
  });
  const direct = await fetchArticle("http://[::ffff:127.0.0.1]/secret");
  assert.equal(direct.ok, false);
  assert.equal(requests, 0);
  const redirect = await fetchArticle("https://public.example");
  assert.equal(redirect.ok, false);
  assert.equal(requests, 1);
});
test("actual streamed bytes are bounded and the oversized body is cancelled without trusting Content-Length", async () => {
  let cancelled = false;
  configureArticleFetch({
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async () =>
      new Response(
        new ReadableStream({
          pull(c) {
            c.enqueue(new Uint8Array(1_000_000));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "text/html", "content-length": "12" } },
      ),
  });
  const result = await fetchArticle("https://public.example/large");
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.status, 413);
  assert.equal(cancelled, true);
});
test("one absolute deadline bounds all redirects and the response body", async () => {
  let requests = 0;
  configureArticleFetch({
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async () => {
      requests++;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return new Response(null, {
        status: 302,
        headers: { location: "/next" },
      });
    },
  });
  const result = await fetchArticle("https://public.example/start", {
    deadline: Date.now() + 25,
  });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.retryable, true);
  assert.ok(requests < 5);
});
test("private address policy rejects expanded reserved IPv6 while preserving ordinary public IPv4 ranges", async () => {
  let requests = 0;
  configureArticleFetch({
    lookup: async () => [
      { address: "2001:0db8:0000:0000:0000:0000:0000:0001", family: 6 },
    ],
    request: async () => {
      requests++;
      return new Response("fixture", {
        headers: { "content-type": "text/plain" },
      });
    },
  });
  await fetchArticle("https://public.example/reserved");
  assert.equal(requests, 0);
  configureArticleFetch({
    lookup: async () => [{ address: "198.51.12.34", family: 4 }],
    request: async () => {
      requests++;
      return new Response("fixture", {
        headers: { "content-type": "text/plain" },
      });
    },
  });
  await fetchArticle("https://public.example/ordinary-public");
  assert.equal(requests, 1);
});
test("large PDF links remain eligible without downloading them as web articles", async () => {
  let cancelled = false;
  configureArticleFetch({
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async () =>
      new Response(
        new ReadableStream({
          pull(c) {
            c.enqueue(new Uint8Array(100));
          },
          cancel() {
            cancelled = true;
          },
        }),
        {
          headers: {
            "content-type": "Application/PDF",
            "content-length": "9000000",
          },
        },
      ),
  });
  const result = await fetchArticle("https://public.example/document");
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.kind, "pdf");
  assert.equal(cancelled, true);
});
test("invalid native HTTP response status becomes a structured fetch failure without an uncaught callback error", async () => {
  const http = await import("node:http"),
    { syncBuiltinESMExports } = await import("node:module"),
    { PassThrough } = await import("node:stream"),
    { EventEmitter } = await import("node:events"),
    { mock } = await import("node:test");
  let destroyed = false;
  const response = new PassThrough() as any;
  response.statusCode = 600;
  response.headers = {};
  response.on("close", () => {
    destroyed = true;
  });
  const original = http.default.request;
  mock.method(http.default, "request", ((
    _url: any,
    _options: any,
    callback: any,
  ) => {
    const request = new EventEmitter() as any;
    request.end = () => queueMicrotask(() => callback(response));
    return request;
  }) as typeof original);
  syncBuiltinESMExports();
  configureArticleFetch({
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      fetchArticle("http://public.example/status"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Native callback did not settle.")),
          500,
        );
      }),
    ]);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.retryable, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(destroyed, true);
  } finally {
    clearTimeout(timer);
    mock.restoreAll();
    syncBuiltinESMExports();
    response.destroy();
  }
});
