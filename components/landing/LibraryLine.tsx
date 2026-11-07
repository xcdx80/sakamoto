"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, Check } from "lucide-react";
import { tidyTitle } from "@/lib/article";
import { useLibraryPrefs } from "@/lib/library-prefs";
import { SAMPLE_SHELF } from "@/lib/classics";
import { SAMPLES } from "@/lib/samples";
import { useStore } from "@/lib/store";

export type Saved = { id: string; title: string };

export function ContinueReading({ reading }: { reading: { id: string; title: string; pct: number } }) {
  return (
    <section className="home-reading" aria-label="Continue reading">
      <header className="home-reading-header">
        <h2>Continue reading</h2>
        <Link href="/library" className="inline-flex items-center gap-1 hover:text-ink">Your library <ArrowRight size={13} aria-hidden /></Link>
      </header>
      <Link href={`/read/${reading.id}`} className="home-reading-card">
        <div className="min-w-0">
          <p className="home-reading-title">{reading.title}</p>
          <p className="home-reading-progress"><Ring pct={reading.pct} /> {Math.round(reading.pct * 100)}% read</p>
        </div>
        <ArrowRight size={18} className="shrink-0 text-ink-3" aria-hidden />
      </Link>
    </section>
  );
}

/** How far along, as a small ring in the pen's colour. */
function Ring({ pct }: { pct: number }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 14 14" className="size-3.5 shrink-0 -rotate-90" aria-hidden>
      <circle cx="7" cy="7" r={r} fill="none" stroke="var(--rule-strong)" strokeWidth="1.8" />
      <circle cx="7" cy="7" r={r} fill="none" stroke="var(--rubric)" strokeWidth="1.8" strokeLinecap="round" strokeDasharray={`${Math.max(0.08, pct) * c} ${c}`} />
    </svg>
  );
}

/**
 * Secondary home reading: resume saved progress, a save receipt, or the library.
 */
export function LibraryLine({ saved }: { saved: Saved | null }) {
  const hydrated = useStore((s) => s.hydrated);
  const library = useStore((s) => s.library);
  const progress = useStore((s) => s.progress);
  const { hiddenSamples } = useLibraryPrefs();

  const reading = useMemo(() => {
    const samples = SAMPLES.filter((a) => !hiddenSamples.includes(a.id));
    const titles = new Map<string, string>([...samples.map((a) => [a.id, a.title] as const), ...library.map((x) => [x.id, x.title] as const)]);
    const cur = Object.entries(progress)
      .filter(([id, p]) => titles.has(id) && p.pct > 0 && p.pct < 1)
      .sort((a, b) => b[1].at - a[1].at)[0];
    return cur ? { id: cur[0], title: tidyTitle(titles.get(cur[0])!), pct: cur[1].pct } : null;
  }, [library, progress, hiddenSamples]);

  if (!hydrated) return <div className="lib-line" aria-hidden />;

  if (saved)
    return (
      <p className="lib-line" key={saved.id}>
        <span className="lib-line-note">
          <Check size={14} className="shrink-0 text-good" />
          <span className="min-w-0 truncate">
            Saved <span className="text-ink">{tidyTitle(saved.title)}</span> to your library
          </span>
        </span>
        <Link href="/library" className="lib-line-go">
          Open <ArrowRight size={13} />
        </Link>
      </p>
    );

  // Nothing of your own yet: the bundled samples, one click from reading.
  if (!reading && !library.length) {
    const samples = SAMPLES.filter((a) => !hiddenSamples.includes(a.id));
    if (!samples.length) return <div className="lib-line" aria-hidden />;
    return (
      <p className="lib-line">
        <span>No link handy? Try</span>
        {samples.map((a) => (
          <Link key={a.id} href={`/read/${a.id}`} className="lib-sample" data-tip={a.title} data-tip-hint={`${a.author}, ${a.published}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SAMPLE_SHELF[a.id]?.cover} alt="" draggable={false} />
            {a.author?.split(" ").slice(-1)[0]}
          </Link>
        ))}
      </p>
    );
  }

  if (reading) return <ContinueReading reading={reading} />;

  return (
    <p className="lib-line">
        <span className="lib-line-note">
          {library.length} {library.length === 1 ? "text" : "texts"} on your shelves
        </span>
      {library.length > 0 && (
        <Link href="/library" className="lib-line-go">
          Your library <ArrowRight size={13} />
        </Link>
      )}
    </p>
  );
}
