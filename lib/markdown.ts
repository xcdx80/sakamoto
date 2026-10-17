import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { Nodes } from "mdast";

export const markdownTree = (source: string) => fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });

export const markdownText = (node: Nodes): string => "value" in node ? node.value : "children" in node ? node.children.map(markdownText).join("") : "";
