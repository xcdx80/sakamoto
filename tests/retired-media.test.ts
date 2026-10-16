import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { pool, setupPostgres } from "./postgres";
import { makeToken } from "../lib/agent";
import { createToken, saveCover, shelveForUser } from "../lib/db";
import { GET as cover } from "../app/api/covers/[id]/route";
import { GET as read } from "../app/api/articles/[id]/route";
let token = "",
  other = "";
before(async () => {
  await setupPostgres();
  for (const owner of ["legacy-owner", "other-owner"]) {
    const identity = makeToken();
    await createToken(
      owner,
      identity.id,
      identity.hash,
      "Preserved media fixture",
    );
    if (owner === "legacy-owner") token = identity.token;
    else other = identity.token;
  }
});
after(() => pool.end());
const request = (credential: string) =>
  new Request("http://localhost/api/retained", {
    headers: { authorization: "Bearer " + credential },
  });
test("existing saved covers and upgraded source blocks stay available only to their owner after generation retirement", async () => {
  const bytes = Uint8Array.from([255, 216, 255, 217]);
  await saveCover("legacy-owner", "retained-cover", bytes);
  const doc = {
    id: "legacy-pdf",
    title: "Saved PDF",
    origin: "file",
    contentType: "document",
    upgrade: [2],
    blocks: [
      {
        id: "u1-0",
        type: "p",
        page: 1,
        runs: [{ text: "Previously saved upgraded text." }],
      },
    ],
  };
  await shelveForUser(
    "legacy-owner",
    { id: doc.id, title: doc.title, cover: "painted" },
    doc,
  );
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("No retired provider");
  };
  try {
    const response = await cover(request(token), {
      params: Promise.resolve({ id: "retained-cover" }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.match(response.headers.get("cache-control")!, /private.*no-store/);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    assert.equal(
      (
        await cover(request(other), {
          params: Promise.resolve({ id: "retained-cover" }),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await cover(request("invalid"), {
          params: Promise.resolve({ id: "retained-cover" }),
        })
      ).status,
      401,
    );
    const source = await (
      await read(request(token), { params: Promise.resolve({ id: doc.id }) })
    ).json();
    assert.deepEqual(source.doc.blocks, doc.blocks);
    assert.deepEqual(source.doc.upgrade, [2]);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test("synchronized historical answers, notes and progress retain their stored model IDs and source anchors", async () => {
  const { POST: push, GET: pull } = await import("../app/api/sync/route");
  const gloss = {
    id: "saved-gloss",
    articleId: "legacy-pdf",
    at: "u1-0",
    action: "ask",
    turns: [
      {
        role: "assistant",
        content: "A retained historical answer.",
        modelKey: "flash",
        model: "DeepSeek V4.1 Flash",
      },
    ],
    createdAt: 1,
  };
  const highlight = {
    id: "saved-highlight",
    articleId: "legacy-pdf",
    anchor: {
      start: { b: "u1-0", o: 0 },
      end: { b: "u1-0", o: 10 },
      quote: "Previously",
    },
    note: "Keep this note.",
    createdAt: 1,
  };
  const progress = { block: "u1-0", pct: 0.5, at: 1 };
  const row = (id: string, data: unknown) => ({
    id,
    articleId: "legacy-pdf",
    data,
    revision: 0,
    sourceRevision: 1,
  });
  const response = await push(
    new Request("http://localhost/api/sync", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        changes: {
          glosses: [row(gloss.id, gloss)],
          highlights: [row(highlight.id, highlight)],
          progress: [row("legacy-pdf", progress)],
        },
      }),
    }),
  );
  assert.equal(response.status, 200);
  const result = await (await pull(request(token))).json();
  assert.deepEqual(
    result.changes.glosses.find((item: any) => item.id === gloss.id).data,
    gloss,
  );
  assert.deepEqual(
    result.changes.highlights.find((item: any) => item.id === highlight.id)
      .data,
    highlight,
  );
  assert.deepEqual(
    result.changes.progress.find((item: any) => item.id === "legacy-pdf").data,
    progress,
  );
});
