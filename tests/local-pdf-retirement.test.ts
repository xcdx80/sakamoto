import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { textPdf } from "./pdf-fixtures";
import { importFromFile } from "../lib/import";
const original = globalThis.fetch;
test("a readable PDF longer than twenty pages imports through the real local WASM without a model key or paid fallback", async () => {
  const wasm = await readFile(
    new URL("../public/liteparse-2.15.1.wasm", import.meta.url),
  );
  const calls: string[] = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    assert.equal(String(url), "/liteparse-2.15.1.wasm");
    return new Response(wasm, {
      headers: { "content-type": "application/wasm" },
    });
  };
  try {
    const result = await importFromFile(
      new File(
        [
          textPdf(
            Array.from(
              { length: 21 },
              (_, n) =>
                `Physical page ${n + 1} contains retained optical calibration text.`,
            ),
          ),
        ],
        "calibration.pdf",
        { type: "application/pdf" },
      ),
    );
    assert.equal(result.ok, true, result.ok ? "" : result.error);
    assert.equal(result.article.contentType, "document");
    assert.ok(
      result.article.blocks.some(
        (block) =>
          block.page === 21 &&
          block.runs.some((run) => run.text.includes("Physical page 21")),
      ),
    );
    assert.equal(result.file?.type, "application/pdf");
    assert.deepEqual(calls, ["/liteparse-2.15.1.wasm"]);
  } finally {
    globalThis.fetch = original;
  }
});
test("scans give an honest unsupported result and mixed PDFs retain only real physical pages without paid OCR", async () => {
  const { scanPdf } = await import("./pdf-fixtures");
  globalThis.fetch = async () => {
    throw new Error("No OCR or layout provider may run");
  };
  try {
    const scanned = await importFromFile(
      new File([scanPdf()], "scan.pdf", { type: "application/pdf" }),
    );
    assert.equal(scanned.ok, false);
    if (scanned.ok) throw new Error("Scanned text must not be invented");
    assert.match(scanned.error, /text layer.*OCR is unavailable/i);
    assert.equal(scanned.needKey, undefined);
    const mixed = await importFromFile(
      new File(
        [textPdf(["A retained physical first page.", ""])],
        "mixed.pdf",
        { type: "application/pdf" },
      ),
    );
    assert.equal(mixed.ok, true);
    assert.equal(mixed.article.pdfSource?.status, "partial");
    assert.deepEqual(mixed.article.pdfSource?.parsedPages, [1]);
    assert.deepEqual(mixed.article.pdfSource?.missingPages, [2]);
    assert.equal(
      mixed.article.blocks.some((block) => block.page === 2),
      false,
    );
    assert.equal(mixed.article.upgrade, undefined);
    assert.match(mixed.article.blocks[0].runs[0].text, /Partial PDF text/);
  } finally {
    globalThis.fetch = original;
  }
});
