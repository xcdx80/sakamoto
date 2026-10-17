"use client";
import type { LayoutBlock } from "@llamaindex/liteparse-wasm";
import {
  inlineMd,
  slugify,
  tidyTitle,
  undash,
  type Article,
  type Block,
} from "./article";
/** Browser text-layer extraction only. No OCR, layout model or personal model key. */
export const PDF_MAX_PAGES = 400;
const WASM = "/liteparse-2.15.1.wasm";
export class PdfError extends Error {}
export type PdfProgress = (pct: number, label?: string) => void;
type LP = typeof import("@llamaindex/liteparse-wasm");
let lib: Promise<LP> | null = null;
function liteparse(): Promise<LP> {
  lib ??= import("@llamaindex/liteparse-wasm").then(async (m) => {
    await m.default({ module_or_path: WASM });
    return m;
  });
  lib.catch(() => {
    lib = null;
  });
  return lib;
}
export async function pdfToArticle(
  file: File,
  onProgress?: PdfProgress,
): Promise<Article> {
  const bytes = new Uint8Array(await file.arrayBuffer()),
    lp = await liteparse();
  const parser = new lp.LiteParse({
    ocrEnabled: false,
    outputFormat: "json",
    extractBlocks: true,
    imageMode: "off",
    quiet: true,
    maxPages: PDF_MAX_PAGES,
  });
  let session: Awaited<ReturnType<typeof parser.openBatchSession>> | undefined;
  let total = 0,
    pages = 0;
  const byPage = new Map<number, LayoutBlock[]>(),
    textByPage = new Map<number, string>();
  try {
    session = await parser.openBatchSession(bytes, 25);
    total = session.totalPages;
    pages = Math.min(total, PDF_MAX_PAGES);
    onProgress?.(0, `Reading ${pages} pages`);
    for (
      let batch = await session.nextBatch();
      batch;
      batch = await session.nextBatch()
    ) {
      for (const page of batch.result.pages) {
        byPage.set(page.pageNum, page.blocks ?? []);
        textByPage.set(page.pageNum, page.text ?? "");
      }
      onProgress?.(
        Math.min(1, batch.endPage / pages),
        `Reading ${pages} pages`,
      );
    }
  } catch (error) {
    throw new PdfError(
      /password/i.test(String(error))
        ? "This PDF is password protected. Remove the password and try again."
        : "Could not read this PDF's text layer.",
    );
  } finally {
    session?.free();
    parser.free();
  }
  let title = "";
  const blocks: Block[] = [],
    parsedPages: number[] = [],
    missingPages: number[] = [];
  for (let page = 1; page <= pages; page++) {
    const local: Block[] = [];
    for (const block of byPage.get(page) ?? []) {
      if (
        !title &&
        page <= 2 &&
        block.kind === "heading" &&
        block.level === 1 &&
        block.text &&
        block.text.length < 200
      ) {
        title = plain(block.text);
        continue;
      }
      const converted = toBlock(block);
      if (converted) local.push({ ...converted, page });
    }
    if (!local.length && textByPage.get(page)?.trim())
      local.push({
        id: "",
        type: "p",
        page,
        runs: [{ text: textByPage.get(page)! }],
      });
    // Stitch only inside one physical page: a missing page is never silently bridged.
    const retained = stitchBlocks(local);
    if (retained.length) parsedPages.push(page);
    else missingPages.push(page);
    blocks.push(
      ...retained.map((block, index) => ({
        ...block,
        id: `b${blocks.length + index + 1}`,
      })),
    );
  }
  if (!blocks.length)
    throw new PdfError(
      "This PDF has no usable text layer. PDF OCR is unavailable; supply extracted text instead.",
    );
  const partial = missingPages.length > 0 || total > pages;
  const reason =
    total > pages
      ? `Stopped at the ${PDF_MAX_PAGES} page limit.`
      : missingPages.length
        ? "Some pages have no usable text layer; OCR and layout upgrades are unavailable."
        : undefined;
  if (partial)
    blocks.unshift({
      id: "pdf-coverage",
      type: "note",
      runs: [
        {
          text: `Partial PDF text: ${parsedPages.length} of ${total} pages retained.${missingPages.length ? ` Pages without usable text: ${missingPages.join(", ")}.` : ""} ${reason ?? ""}`,
        },
      ],
    });
  title ||= file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ");
  return {
    id: `${slugify(title)}-${Math.random().toString(36).slice(2, 7)}`,
    title: tidyTitle(undash(title)),
    source: file.name,
    blocks,
    origin: "file",
    contentType: "document",
    addedAt: Date.now(),
    pdfSource: {
      extractor: "liteparse-text-2.15.1",
      status: partial ? "partial" : "complete",
      totalPages: total,
      parsedPages,
      missingPages,
      ...(reason ? { reason } : {}),
    },
  };
}

const plain = (md: string) =>
  inlineMd(md)
    .map((r) => r.text)
    .join("")
    .trim();

/** One LiteParse block as a Sakamoto block, or nothing for rules, pictures and the shards of diagrams. */
function toBlock(b: LayoutBlock): Block | null {
  const runs = (t: string) => inlineMd(undash(t.replace(/\s+/g, " ").trim()));
  switch (b.kind) {
    case "heading": {
      const t = (b.text ?? "").trim();
      // Labels lifted out of a diagram ("##Coefficient") are not headings.
      if (!t || t.startsWith("#")) return null;
      if (t.length > 160) return { id: "", type: "p", runs: runs(t) };
      return { id: "", type: (b.level ?? 2) <= 2 ? "h2" : "h3", runs: runs(t) };
    }
    case "paragraph":
      return b.text?.trim() ? { id: "", type: "p", runs: runs(b.text) } : null;
    case "list_item":
      return b.text?.trim() ? { id: "", type: "li", runs: runs(b.text) } : null;
    case "code":
    case "grid_fallback": {
      const t = (b.lines ?? []).join("\n").replace(/\s+$/, "");
      return t.trim()
        ? { id: "", type: "pre", runs: [{ text: t, code: true }] }
        : null;
    }
    case "table": {
      const rows = [...(b.header ? [b.header] : []), ...(b.rows ?? [])].map(
        (r) => r.map((c) => plain(c.text ?? "")),
      );
      const cells = rows.flat();
      const cols = Math.max(0, ...rows.map((r) => r.length));
      // A diagram read as a grid is mostly empty cells; a real table is mostly full.
      if (
        rows.length < 2 ||
        cols < 2 ||
        cells.filter(Boolean).length / Math.max(1, cells.length) < 0.6
      )
        return null;
      return {
        id: "",
        type: "table",
        runs: [],
        rows: rows.map((r) => [...r, ...Array(cols - r.length).fill("")]),
        head: Boolean(b.header),
      };
    }
    default:
      return null;
  }
}

const text = (b: Block) => b.runs.map((r) => r.text).join("");

/** Short things a page sets between the two halves of a paragraph: footnotes, captions, a figure's labels, a table. */
const LOOKBACK = 10;
const interlude = (b: Block) => b.type !== "p" || text(b).length < 260;

/**
 * Paragraphs broken by a page or column end, or by a footnote, figure or
 * table set in their middle, are joined again: the last long paragraph
 * stops without closing punctuation, and this one starts in lowercase or
 * with a bracket. What sat between them stays, after the joined paragraph.
 */
export function stitchBlocks(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.type === "p" && /^[a-z(\[]/.test(text(b).trimStart())) {
      let at = out.length - 1;
      while (at >= 0 && out.length - at <= LOOKBACK && interlude(out[at])) at--;
      const prev = at >= 0 && out.length - at <= LOOKBACK ? out[at] : null;
      if (prev?.type === "p" && !/[.!?:;"”’)\]]\s*$/.test(text(prev))) {
        out[at] = { ...prev, runs: [...prev.runs, { text: " " }, ...b.runs] };
        continue;
      }
    }
    out.push(b);
  }
  return out;
}
