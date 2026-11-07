"use client";

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { defaultRangeExtractor, useWindowVirtualizer, type Range, type VirtualItem } from "@tanstack/react-virtual";
import type { LibraryView } from "./ContentCards";

type Layout = { width: number; columns: number; top: number };
type SavedWindow = { viewportWidth: number; layout: Layout; measurements: VirtualItem[] };
// Retain only recent presentation measurements, isolated by account, view and exact item order.
const recentWindows = new Map<string, SavedWindow>();

/** Window the page's scroll, measuring complete grid rows so linked reading can have any height. */
export function WindowedCards({ cacheKey, count, view, rowKey, renderRows }: {
  cacheKey: string;
  count: number;
  view: LibraryView;
  rowKey: (start: number, end: number) => string;
  renderRows: (start: number, end: number) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [saved] = useState(() => {
    const previous = recentWindows.get(cacheKey);
    return typeof window !== "undefined" && previous?.viewportWidth === window.innerWidth ? previous : undefined;
  });
  const [layout, setLayout] = useState<Layout>(saved?.layout ?? { width: 0, columns: 3, top: 0 });
  const latestLayout = useRef(layout);
  latestLayout.current = layout;
  const [focused, setFocused] = useState<number | null>(null);
  const columns = view === "list" ? 1 : layout.columns;
  const rows = Math.ceil(count / columns);
  const getItemKey = useCallback((index: number) => `${view}:${columns}:${rowKey(index * columns, Math.min(count, (index + 1) * columns))}`, [view, columns, rowKey, count]);
  const rangeExtractor = useCallback((range: Range) => {
    const indices = defaultRangeExtractor(range);
    // Keep keyboard focus and the next/previous row reachable while recycling other rows.
    if (focused !== null) for (let i = Math.max(0, focused - 1); i <= Math.min(rows - 1, focused + 1); i++) indices.push(i);
    return [...new Set(indices)].sort((a, b) => a - b);
  }, [focused, rows]);
  const virtualizer = useWindowVirtualizer<HTMLDivElement>({
    count: rows,
    getItemKey,
    // Conservative estimates keep a fast jump to the end from growing beneath the viewport.
    estimateSize: () => view === "list" ? 480 : 640,
    overscan: 8,
    scrollMargin: layout.top,
    initialRect: { width: 1100, height: 900 },
    initialOffset: () => typeof window === "undefined" ? 0 : window.scrollY || 0,
    rangeExtractor,
    initialMeasurementsCache: saved?.measurements ?? [],
  });

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const width = Math.round(element.getBoundingClientRect().width);
      const columns = Number(getComputedStyle(element).getPropertyValue("--library-columns")) || 3;
      const top = element.getBoundingClientRect().top + window.scrollY;
      setLayout(previous => previous.width === width && previous.columns === columns && Math.abs(previous.top - top) < 1 ? previous : { width, columns, top });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // Headers can grow when saved connections or sync notices arrive above the list.
    if (element.parentElement) observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, []);
  const measuredLayout = useRef({ width: layout.width, columns });
  useLayoutEffect(() => {
    if (measuredLayout.current.width !== layout.width || measuredLayout.current.columns !== columns) virtualizer.measure();
    measuredLayout.current = { width: layout.width, columns };
  }, [layout.width, columns, virtualizer]);
  useLayoutEffect(() => () => {
    recentWindows.delete(cacheKey);
    recentWindows.set(cacheKey, { viewportWidth: window.innerWidth, layout: latestLayout.current, measurements: virtualizer.takeSnapshot() });
    if (recentWindows.size > 3) recentWindows.delete(recentWindows.keys().next().value!);
  }, [cacheKey, virtualizer]);

  return <div ref={root} className="content-window" data-view={view} role="list" aria-label={view === "grid" ? "Library cards" : "Library list"}
    style={{ height: virtualizer.getTotalSize() }}
    onFocusCapture={event => {
      const index = (event.target as HTMLElement).closest<HTMLElement>("[data-index]")?.dataset.index;
      if (index !== undefined) setFocused(Number(index));
    }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(null); }}>
    {virtualizer.getVirtualItems().map(row => <div key={row.key} ref={virtualizer.measureElement} data-index={row.index} role="presentation"
      className="content-window-row" style={{ transform: `translateY(${row.start - layout.top}px)` }}>
      <ul className={view === "grid" ? "content-grid" : "content-list"} role="presentation">
        {renderRows(row.index * columns, Math.min(count, (row.index + 1) * columns))}
      </ul>
    </div>)}
  </div>;
}
