"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { linkedDiscoveries } from "@/lib/processing-client";
import type { LinkedDiscovery } from "@/lib/processing";
export function LinkedDiscoveries({ itemId }: { itemId: string }) {
  const owner = useStore((s) => s.scope),
    [sources, setSources] = useState<LinkedDiscovery[]>([]),
    [next, setNext] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setSources([]);
    setNext(null);
    if (owner)
      linkedDiscoveries(itemId)
        .then((result) => {
          if (active) {
            setSources(result.sources);
            setNext(result.next);
          }
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [owner, itemId]);
  if (!sources.length) return null;
  return (
    <aside
      aria-label="Linked from saved posts"
      className="focus-hide mt-4 text-[13px] text-ink-3"
    >
      <p>Linked from saved posts:</p>
      <ul>
        {sources.map((source) => (
          <li key={source.sourceId}>
            <Link
              className="underline"
              href={"/read/" + encodeURIComponent(source.sourceId)}
            >
              {source.title}
            </Link>
          </li>
        ))}
      </ul>
      {next && (
        <button
          onClick={async () => {
            const result = await linkedDiscoveries(itemId, next);
            setSources([...sources, ...result.sources]);
            setNext(result.next);
          }}
        >
          Show more sources
        </button>
      )}
    </aside>
  );
}
