import { createElement, type ReactNode } from "react";
import { SAMPLE_SHELF } from "@/lib/classics";
import * as O from "./objects";

export type PieceDef = {
  id: string;
  node: ReactNode;
  /** Resting place on the desk, as percentages of the viewport. */
  at: [number, number];
  /** Resting place on a phone. Only pieces with one appear there. */
  phone?: [number, number];
  rotate: number;
  /** How far it drifts with the cursor. */
  depth: number;
  /** 0 and 1 stay on narrower desktops. */
  tier: 0 | 1 | 2;
};

const cover = (id: string) => SAMPLE_SHELF[id]?.cover ?? "";

const piece = (id: string, node: ReactNode, at: [number, number], rotate: number, depth: number, tier: 0 | 1 | 2, phone?: [number, number]): PieceDef => ({ id, node, at, rotate, depth, tier, phone });

export const PIECES: PieceDef[] = [
  piece("tweet", createElement(O.XBookmark), [10.5, 19], -5, 0.9, 0, [21.87, 13.11]),
  piece("sticky-a", createElement(O.Sticky, { tone: "marigold", children: "save for later" }), [22.77, 13.21], 6, 1.4, 1),
  piece("clip", createElement(O.Clipping), [16.5, 86], 3, 0.6, 0, [79.11, 13.57]),
  piece("stamp", createElement(O.Stamp), [4, 31], -9, 1.5, 2),
  piece("pencil", createElement(O.Pencil), [16.73, 30.12], -14, 1.1, 2),
  piece("due", createElement(O.DueCard), [20.26, 66.63], -4, 0.8, 1),
  piece("book-a", createElement(O.Book, { cover: cover("on-thinking-for-oneself"), title: "On Thinking for Oneself" }), [6.5, 74], -7, 1, 0, [17.38, 95.77]),
  piece("clip-metal", createElement(O.Paperclip), [25, 92], 22, 1.6, 2),
  piece("sticker", createElement(O.Sticker), [3.6, 92], 10, 1.3, 2),
  piece("receipt", createElement(O.Receipt), [78.1, 13.74], 4, 1, 1, [51.44, 9.55]),
  piece("pdf", createElement(O.PdfCorner), [92.67, 18.58], -4, 0.7, 0),
  piece("ribbon", createElement(O.Ribbon), [94.9, 41.55], 8, 1.5, 2),
  piece("index", createElement(O.IndexCard), [82.69, 69.82], 5, 0.9, 0),
  piece("sticky-b", createElement(O.Sticky, { tone: "blush", children: "paste a link" }), [85.5, 51.27], -6, 1.2, 1),
  piece("book-b", createElement(O.Book, { cover: cover("walden-reading"), title: "Reading" }), [95, 67], 8, 0.8, 2),
  piece("envelope", createElement(O.Envelope), [94, 94], -3, 0.6, 0, [85.15, 96.49]),
  piece("marker", createElement(O.Highlighter), [82.58, 87.76], -8, 1.1, 2),
  piece("shot", createElement(O.Screenshot), [72.33, 87.86], 5, 1.4, 2),
  piece("tag", createElement(O.Tag), [28.06, 80.61], -8, 1.5, 2),
  piece("x-thread", createElement(O.XThreadStack), [10.55, 51.2], 3, 0.7, 0, [29.92, 86.13]),
  piece("x-linked-articles", createElement(O.XLinkedArticlesStack), [82.03, 31.75], -4, 0.7, 0, [77.19, 81.05]),
];
