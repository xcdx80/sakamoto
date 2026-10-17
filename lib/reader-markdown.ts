import { markdownTree } from "./markdown";
import { decodeString } from "micromark-util-decode-string";
import type { Nodes } from "mdast";
import { blockText, type Block } from "./article";

/** Presentation ranges always refer to the unchanged saved block text. */
export type MarkdownPart = {
  kind: "text" | "syntax";
  from: number;
  to: number;
} | {
  kind: "replacement";
  from: number;
  to: number;
  value: string;
} | {
  kind: "element";
  tag: "div" | "span" | "p" | "h2" | "h3" | "h4" | "h5" | "h6" | "strong" | "em" | "del" | "code" | "pre" | "a" | "blockquote" | "ul" | "ol" | "li" | "hr" | "br";
  children: MarkdownPart[];
  href?: string;
  start?: number;
  at?: number;
  role?: "table" | "row" | "columnheader" | "cell";
};

function safeHref(url: string): string | undefined {
  const value = url.replace(/[\u0000-\u0020\u007f]/g, "");
  return !/^[a-z][\w+.-]*:/i.test(value) || /^(https?|mailto):/i.test(value) ? value : undefined;
}

/**
 * Only interpret raw paragraphs. Imported HTML and already formatted runs are
 * authoritative; parsing those again would turn literal punctuation into markup.
 * Hidden syntax remains in the DOM, so existing source offsets still work.
 */
export function readerMarkdown(block: Block): MarkdownPart[] | null {
  return rawParagraph(block) ? parseSource(blockText(block)) : null;
}

function rawParagraph(block: Block): boolean {
  return block.type === "p" && !block.runs.some(run => run.code || run.em || run.strong || run.href);
}

function parseSource(source: string): MarkdownPart[] | null {
  const root = markdownTree(source);
  const definitions = new Map(root.children.filter(node => node.type === "definition").map(node => [node.identifier, node.url]));
  const range = (node: Nodes) => [node.position!.start.offset!, node.position!.end.offset!] as const;
  const text = (from: number, to: number): MarkdownPart => ({ kind: "text", from, to });
  const syntax = (from: number, to: number): MarkdownPart => ({ kind: "syntax", from, to });
  const element = (tag: Extract<MarkdownPart, { kind: "element" }>["tag"], children: MarkdownPart[], props = {}): MarkdownPart => ({ kind: "element", tag, children, ...props });

  const headerCells = new Set<Nodes>();

  function childrenOf(node: Nodes, inQuote = false): MarkdownPart[] {
    const [from, to] = range(node);
    if (!("children" in node)) return [text(from, to)];
    const parts: MarkdownPart[] = [];
    let cursor = from;
    for (const child of node.children) {
      const [start, end] = range(child);
      if (start > cursor) parts.push(syntax(cursor, start));
      parts.push(convert(child, inQuote));
      cursor = end;
    }
    if (cursor < to) parts.push(syntax(cursor, to));
    return parts;
  }

  function convert(node: Nodes, inQuote = false): MarkdownPart {
    const [from, to] = range(node);
    switch (node.type) {
      case "paragraph": return element("p", childrenOf(node, inQuote));
      case "heading": return element((["h2", "h2", "h3", "h4", "h5", "h6"] as const)[node.depth - 1], childrenOf(node, inQuote));
      case "strong": return element("strong", childrenOf(node, inQuote));
      case "emphasis": return element("em", childrenOf(node, inQuote));
      case "delete": return element("del", childrenOf(node, inQuote));
      case "blockquote": return element("blockquote", childrenOf(node, true));
      case "list": return element(node.ordered ? "ol" : "ul", childrenOf(node, inQuote), node.ordered && node.start != null ? { start: node.start } : {});
      case "listItem": return element("li", childrenOf(node, inQuote));
      case "link": return element("a", childrenOf(node, inQuote), { href: safeHref(node.url) });
      case "linkReference": return element("a", childrenOf(node, inQuote), { href: safeHref(definitions.get(node.identifier) ?? "") });
      case "inlineCode": {
        const raw = source.slice(from, to);
        const delimiter = raw.match(/^`+/)![0].length;
        return element("code", [syntax(from, from + delimiter), text(from + delimiter, to - delimiter), syntax(to - delimiter, to)]);
      }
      case "code": {
        const raw = source.slice(from, to);
        const opening = raw.match(/^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/);
        if (!opening) return element("pre", [element("code", [text(from, to)])]);
        const start = from + opening[0].length;
        const closing = raw.slice(opening[0].length).match(new RegExp(`(?:^|\\n) {0,3}${opening[1][0]}{${opening[1].length},}[ \\t]*$`));
        const end = closing ? start + closing.index! : to;
        return element("pre", [element("code", [syntax(from, start), text(start, end), syntax(end, to)])]);
      }
      case "table": {
        node.children[0]?.children.forEach(cell => headerCells.add(cell));
        return element("div", childrenOf(node, inQuote), { role: "table" });
      }
      case "tableRow": return element("div", childrenOf(node, inQuote), { role: "row" });
      case "tableCell": return element("div", childrenOf(node, inQuote), { role: headerCells.has(node) ? "columnheader" : "cell" });
      case "thematicBreak": return element("div", [syntax(from, to), element("hr", [], { at: from })]);
      case "break": return element("span", [syntax(from, to), element("br", [], { at: from })]);
      case "definition": return syntax(from, to);
      case "text": {
        const parts: MarkdownPart[] = [];
        let cursor = from;
        // Decode only Markdown text leaves; code and literal HTML stay literal.
        const tokens = /\\[!-/:-@\[-`{-~]|&(?:#\d{1,7}|#x[\da-f]{1,6}|[a-z][a-z\d]{1,31});|\n([ \t]*> ?)+/gi;
        for (const match of source.slice(from, to).matchAll(tokens)) {
          const start = from + match.index;
          const end = start + match[0].length;
          if (match[0].startsWith("\n")) {
            if (!inQuote) continue;
            parts.push(text(cursor, start + 1), syntax(start + 1, end));
          } else {
            const value = decodeString(match[0]);
            if (value === match[0]) continue;
            parts.push(text(cursor, start), { kind: "replacement", from: start, to: end, value });
          }
          cursor = end;
        }
        parts.push(text(cursor, to));
        return element("span", parts);
      }
      default: return text(from, to);
    }
  }

  // Plain paragraphs keep the original renderer and its typography.
  if (root.children.every(node => node.type === "paragraph" && node.children.every(child => child.type === "text"))) return null;
  return childrenOf(root);
}

/** Parse adjacent saved paragraphs together so fences and reference links survive blank lines. */
export function readerMarkdownBlocks(blocks: Block[]): Map<string, MarkdownPart[] | null> {
  const result = new Map<string, MarkdownPart[] | null>();
  for (let i = 0; i < blocks.length;) {
    if (!rawParagraph(blocks[i])) { result.set(blocks[i++].id, null); continue; }
    const group: Block[] = [];
    while (i < blocks.length && rawParagraph(blocks[i])) group.push(blocks[i++]);
    const parts = parseSource(group.map(blockText).join("\n\n"));
    let offset = 0;
    for (const block of group) {
      const end = offset + blockText(block).length;
      result.set(block.id, parts ? clipParts(parts, offset, end) : null);
      offset = end + 2;
    }
  }
  return result;
}

function endOf(part: MarkdownPart): number {
  return part.kind === "element" ? Math.max(part.at ?? 0, ...part.children.map(endOf)) : part.to;
}

/** Slice presentation, never source data or paragraph identifiers. */
function clipParts(parts: MarkdownPart[], from: number, to: number): MarkdownPart[] {
  return parts.flatMap((part): MarkdownPart[] => {
    if (part.kind !== "element") {
      const start = Math.max(part.from, from), end = Math.min(part.to, to);
      return end > start ? [{ ...part, from: start - from, to: end - from }] : [];
    }
    const children = clipParts(part.children, from, to);
    if (!children.length && !(part.at !== undefined && part.at >= from && part.at < to)) return [];
    const skippedItems = part.tag === "ol" ? part.children.filter(child => child.kind === "element" && child.tag === "li" && endOf(child) <= from).length : 0;
    return [{ ...part, children, ...(part.tag === "ol" ? { start: (part.start ?? 1) + skippedItems } : {}) }];
  });
}

/** Read the displayed prose aloud while keeping stored source and block addresses unchanged. */
export function readerSpeechText(blocks: Block[]): Map<string, string> {
  const markdown = readerMarkdownBlocks(blocks);
  function spoken(part: MarkdownPart, source: string): string {
    if (part.kind === "replacement") return part.value;
    if (part.kind !== "element") return part.kind === "text" ? source.slice(part.from, part.to) : "";
    if (part.tag === "pre" || part.role === "table" || part.tag === "hr") return "";
    if (part.tag === "br") return "\n";
    const text = part.children.map(child => spoken(child, source)).join("");
    return text + (["p", "li", "h2", "h3", "h4", "h5", "h6", "blockquote"].includes(part.tag) ? "\n" : "");
  }
  return new Map(blocks.map(block => {
    const source = blockText(block), parts = markdown.get(block.id);
    return [block.id, (parts ? parts.map(part => spoken(part, source)).join("") : source).trim()];
  }));
}
