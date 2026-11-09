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
  piece("tweet", createElement(O.TweetSlip), [10.5, 19], -5, 0.9, 0, [23, 13.2]),
  piece("sticky-a", createElement(O.Sticky, { tone: "marigold", children: "read this!!" }), [21.5, 13], 6, 1.4, 1),
  piece("clip", createElement(O.Clipping), [8, 49], 3, 0.6, 0),
  piece("stamp", createElement(O.Stamp), [4, 31], -9, 1.5, 2),
  piece("pencil", createElement(O.Pencil), [13.5, 33.5], -14, 1.1, 2),
  piece("due", createElement(O.DueCard), [17, 66], -4, 0.8, 1),
  piece("book-a", createElement(O.Book, { cover: cover("on-thinking-for-oneself"), title: "On Thinking for Oneself" }), [6.5, 74], -7, 1, 0, [9, 97.5]),
  piece("ticket", createElement(O.Ticket), [16.5, 88.5], 3, 0.7, 1),
  piece("clip-metal", createElement(O.Paperclip), [25, 92], 22, 1.6, 2),
  piece("sticker", createElement(O.Sticker), [3.6, 92], 10, 1.3, 2),
  piece("receipt", createElement(O.Receipt), [78.5, 15.5], 4, 1, 1),
  piece("pdf", createElement(O.PdfCorner), [90.5, 21], -4, 0.7, 0, [80, 15]),
  piece("ribbon", createElement(O.Ribbon), [97.4, 37], 8, 1.5, 2),
  piece("index", createElement(O.IndexCard), [88, 45], 5, 0.9, 0),
  piece("sticky-b", createElement(O.Sticky, { tone: "blush", children: "why did I save this?" }), [83.5, 65], -6, 1.2, 1, [50.5, 12]),
  piece("book-b", createElement(O.Book, { cover: cover("walden-reading"), title: "Reading" }), [95, 67], 8, 0.8, 2),
  piece("envelope", createElement(O.Envelope), [90, 84], -3, 0.6, 0, [88, 98.5]),
  piece("marker", createElement(O.Highlighter), [83, 94.5], -8, 1.1, 2),
  piece("shot", createElement(O.Screenshot), [76.5, 86], 5, 1.4, 2),
  piece("tag", createElement(O.Tag), [24.8, 78.5], -8, 1.5, 2),
];
