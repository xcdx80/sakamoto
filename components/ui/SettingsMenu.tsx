"use client";

import { useId, useState, type MouseEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { spring } from "@/components/motion/tokens";
import { flushSync } from "react-dom";
import { AlignJustify, AlignLeft, Focus, Headphones, Map as MapIcon, Minus, Pilcrow, Plus, RotateCcw } from "lucide-react";
import { MODELS, type ModelKey } from "@/lib/models";
import { applySettings, DEFAULT_SETTINGS, FACES, MARKERS, PENS, resolveTheme, THEMES, type Settings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import { Popover, barBtn } from "./Popover";

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { key: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className="sk-seg" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={value === o.key} onClick={() => onChange(o.key)} className="sk-seg-option">
          <span className="relative inline-flex items-center gap-1.5">{o.label}</span>
          {value === o.key && <motion.span layoutId={id} className="sk-seg-ink" transition={spring.snap} />}
        </button>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3">
      <span className="sk-eyebrow">{label}</span>
      {children}
    </div>
  );
}

function Chip({ on, onChange, label, icon }: { on: boolean; onChange: (v: boolean) => void; label: string; icon: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="sk-switch-row">
      <span className="sk-switch-label">{icon}{label}</span>
      <span className="sk-switch" aria-hidden><motion.span className="sk-switch-knob" animate={{ x: on ? 14 : 0 }} transition={spring.snap} /></span>
    </button>
  );
}

const STOCK: Record<Settings["theme"], string> = {
  auto: "Follows your system, day and night",
  paper: "Warm paper, the house stock",
  sepia: "Old library stock, softer on the eyes",
  snow: "Bright and crisp, like new paper",
  night: "A dark desk with warm ink",
  ink: "Blue-black, for late reading",
};

/** A sheet of each paper stock: its ground, three lines of its ink, a highlighter stroke and the pen's tick. */
function Sheet({ theme }: { theme: (typeof THEMES)[number] }) {
  const ground = theme.key === "auto" ? "linear-gradient(135deg,#faf7f0 0 50%,#151412 50% 100%)" : theme.bg;
  const ink = theme.key === "auto" ? "#7d766a" : theme.fg;
  return (
    <span className="sk-sheet-face" style={{ background: ground }}>
      <span className="sk-sheet-line" style={{ background: ink, width: "78%" }} />
      <span className="sk-sheet-line is-marked" style={{ background: ink, width: "64%" }} />
      <span className="sk-sheet-line" style={{ background: ink, width: "70%" }} />
      <span className="sk-sheet-line" style={{ background: ink, width: "42%" }} />
      <span className="sk-sheet-tick" style={{ background: theme.dark ? "var(--pen-d)" : "var(--pen-l)" }} />
    </span>
  );
}

/** A short line of ink, the way each pen writes. */
function InkStroke({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 36 14" className="h-[14px] w-9" aria-hidden>
      <path d="M2 9c4-6 7-6 9-1s5 5 8 0 6-5 8-1 4 3 7-1" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

let swap: { finished: Promise<void> } | null = null;

/**
 * Type, colour and answers in one small panel. Every change applies to the
 * page underneath immediately, so the page itself is the preview.
 */
export function SettingsMenu({ compact = false }: { compact?: boolean }) {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const focusMode = useStore((s) => s.focusMode);
  const setUI = useStore((s) => s.setUI);
  const [tab, setTab] = useState<"look" | "text" | "answers">("look");

  const set = (patch: Partial<Settings>) => {
    setSettings(patch);
    applySettings({ ...useStore.getState().settings });
  };
  const size = (v: number) => set({ size: Math.max(15, Math.min(28, v)) });
  const dark = resolveTheme(settings.theme) === "night" || resolveTheme(settings.theme) === "ink";

  // A new theme is poured in as a circle that grows out of the swatch you picked.
  const pickTheme = (key: Settings["theme"], e: MouseEvent<HTMLButtonElement>) => {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void>; skipTransition: () => void } };
    const quiet = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!doc.startViewTransition || quiet || resolveTheme(key) === resolveTheme(settings.theme)) return set({ theme: key });
    // In percentages of the viewport, so the circle lands on the swatch at any zoom or pixel ratio.
    const r = e.currentTarget.getBoundingClientRect();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const x = r.left + r.width / 2;
    const y = r.top + 19;
    const at = `${((x / w) * 100).toFixed(2)}% ${((y / h) * 100).toFixed(2)}%`;
    const end = ((Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) / (Math.hypot(w, h) / Math.SQRT2)) * 100).toFixed(2);
    const root = document.documentElement;
    root.classList.add("theme-swap");
    // A new pick while one is pouring skips the old one; only the newest clears the flag.
    const vt = doc.startViewTransition(() => flushSync(() => set({ theme: key })));
    swap = vt;
    // While it pours, the browser sends every click to the root element instead of what is
    // under the pointer, so a quick second pick would be lost. Catch those clicks, end this
    // pour at once, and hand the click to the element underneath: a new pick pours in fresh.
    const passThrough = (ev: globalThis.MouseEvent) => {
      if (ev.target !== root) return;
      ev.stopPropagation();
      vt.skipTransition();
      const { clientX: x, clientY: y } = ev;
      vt.finished.finally(() => (document.elementFromPoint(x, y) as HTMLElement | null)?.click());
    };
    document.addEventListener("click", passThrough, true);
    vt.ready
      .then(() =>
        root.animate(
          { clipPath: [`circle(0% at ${at})`, `circle(${end}% at ${at})`] },
          { duration: 620, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" }
        )
      )
      .catch(() => {});
    vt.finished.finally(() => {
      document.removeEventListener("click", passThrough, true);
      if (swap === vt) {
        swap = null;
        root.classList.remove("theme-swap");
      }
    });
  };

  return (
    <Popover label="Appearance and answers" tip="Appearance" width={compact ? 316 : 348} triggerClass={barBtn} trigger={<span className="block translate-y-[0.5px] font-serif text-[18px] leading-none">Aa</span>}>
      {() => (
        <div>
          {!compact && (
            <div className="mb-4">
              <Seg
                label="Settings section"
                value={tab}
                onChange={setTab}
                options={[
                  { key: "look", label: "Look" },
                  { key: "text", label: "Text" },
                  { key: "answers", label: "Answers" },
                ]}
              />
            </div>
          )}

          {(compact || tab === "look") && (
            <div className="space-y-3.5">
              <div>
                <p className="sk-eyebrow mb-1">Paper</p>
                <div className="sk-fan" role="group" aria-label="Theme">
                  {THEMES.map((t, i) => {
                    const on = settings.theme === t.key;
                    return (
                      <motion.button
                        key={t.key}
                        type="button"
                        onClick={(e) => pickTheme(t.key, e)}
                        aria-pressed={on}
                        aria-label={`${t.label} theme`}
                        className="sk-sheet"
                        style={{ zIndex: on ? 10 : i }}
                        initial={false}
                        animate={{ y: on ? -12 : 0, rotate: on ? 0 : (i - (THEMES.length - 1) / 2) * 5 }}
                        whileHover={on ? undefined : { y: -6 }}
                        transition={spring.bouncy}
                      >
                        <Sheet theme={t} />
                        <span className="sk-sheet-name">{t.label}</span>
                      </motion.button>
                    );
                  })}
                </div>
                <p className="sk-fan-caption"><b>{THEMES.find((t) => t.key === settings.theme)?.label}</b> {STOCK[settings.theme]}</p>
              </div>

              <Row label="Pen">
                <div className="flex items-center gap-1">
                  {PENS.map((p) => (
                    <button key={p.key} type="button" onClick={() => set({ pen: p.key })} aria-pressed={settings.pen === p.key} aria-label={`${p.label} pen`} data-tip={p.label} className="sk-ink-choice">
                      <InkStroke color={dark ? p.dark : p.light} />
                    </button>
                  ))}
                </div>
              </Row>

              {!compact && (
                <>
                  <Row label="Highlighter">
                    <div className="flex items-center gap-2">
                      {MARKERS.map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => set({ marker: m.key })}
                          aria-pressed={settings.marker === m.key}
                          aria-label={`${m.label} highlighter`}
                          data-tip={m.label}
                          className="sk-ink-choice"
                        >
                          <span className="h-[11px] w-8 -rotate-3 rounded-[2px] opacity-80" style={{ background: m.color }} />
                        </button>
                      ))}
                    </div>
                  </Row>
                  <div className="sk-switches">
                    <Chip label="Paragraph numbers" icon={<Pilcrow size={14} />} on={settings.numbers} onChange={(v) => set({ numbers: v })} />
                    <Chip label="Reading map" icon={<MapIcon size={14} />} on={settings.rail} onChange={(v) => set({ rail: v })} />
                    <Chip label="Focus mode" icon={<Focus size={14} />} on={focusMode} onChange={(v) => setUI({ focusMode: v })} />
                    <p className="sk-switch-note" title="Reading aloud is unavailable. Saved text remains readable.">Reading aloud is unavailable for now.</p>
                  </div>
                </>
              )}
            </div>
          )}

          {!compact && tab === "text" && (
            <div className="space-y-3.5">
              <div>
                <p className="sk-eyebrow mb-3">Typeface</p>
                <div className="grid grid-cols-4 gap-2">
                  {FACES.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => set({ face: f.key })}
                      aria-pressed={settings.face === f.key}
                      className={`group flex h-[62px] flex-col items-center justify-center gap-1 rounded-[12px] border transition-[border-color,background-color,transform] active:scale-[0.97] ${
                        settings.face === f.key ? "border-ink bg-bg" : "border-rule hover:border-rule-strong"
                      }`}
                    >
                      <span className="text-[22px] leading-none text-ink" style={{ fontFamily: f.css }}>
                        Ag
                      </span>
                      <span className={`text-[11px] leading-none ${settings.face === f.key ? "font-medium text-ink" : "text-ink-3"}`}>{f.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <Row label="Size">
                <div className="flex items-center gap-1.5">
                  <button type="button" aria-label="Smaller text" data-tip="Smaller" onClick={() => size(settings.size - 1)} className="grid size-7 place-items-center rounded-lg text-ink-2 transition-transform hover:bg-sunk active:scale-90">
                    <Minus size={14} />
                  </button>
                  <input
                    type="range"
                    min={15}
                    max={28}
                    value={settings.size}
                    onChange={(e) => size(Number(e.target.value))}
                    aria-label="Text size"
                    className="h-1 min-w-0 flex-1 accent-[var(--rubric)]"
                  />
                  <button type="button" aria-label="Larger text" data-tip="Larger" onClick={() => size(settings.size + 1)} className="grid size-7 place-items-center rounded-lg text-ink-2 transition-transform hover:bg-sunk active:scale-90">
                    <Plus size={14} />
                  </button>
                  <span className="w-6 text-right text-[12px] tabular-nums text-ink-3">{settings.size}</span>
                </div>
              </Row>
              <Row label="Spacing">
                <Seg
                  label="Line spacing"
                  value={settings.leading}
                  onChange={(v) => set({ leading: v })}
                  options={[
                    { key: "tight", label: "Snug" },
                    { key: "normal", label: "Even" },
                    { key: "loose", label: "Airy" },
                  ]}
                />
              </Row>
              <Row label="Width">
                <Seg
                  label="Column width"
                  value={settings.width}
                  onChange={(v) => set({ width: v })}
                  options={[
                    { key: "narrow", label: "Narrow" },
                    { key: "normal", label: "Even" },
                    { key: "wide", label: "Wide" },
                  ]}
                />
              </Row>
              <Row label="Align">
                <Seg
                  label="Text alignment"
                  value={settings.align}
                  onChange={(v) => set({ align: v })}
                  options={[
                    { key: "left", label: <><AlignLeft size={13} /> Left</> },
                    { key: "justify", label: <><AlignJustify size={13} /> Justified</> },
                  ]}
                />
              </Row>
              <Row label="Paragraphs">
                <Seg
                  label="Paragraph style"
                  value={settings.paras}
                  onChange={(v) => set({ paras: v })}
                  options={[
                    { key: "spaced", label: "Spaced" },
                    { key: "indented", label: "Indented" },
                  ]}
                />
              </Row>
              {(["face", "size", "leading", "width", "align", "paras"] as const).some((k) => settings[k] !== DEFAULT_SETTINGS[k]) && (
                <button
                  type="button"
                  onClick={() =>
                    set({
                      face: DEFAULT_SETTINGS.face,
                      size: DEFAULT_SETTINGS.size,
                      leading: DEFAULT_SETTINGS.leading,
                      width: DEFAULT_SETTINGS.width,
                      align: DEFAULT_SETTINGS.align,
                      paras: DEFAULT_SETTINGS.paras,
                    })
                  }
                  className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3 transition-colors hover:text-ink"
                >
                  <RotateCcw size={12} /> Reset text settings
                </button>
              )}
            </div>
          )}

          {!compact && tab === "answers" && (
            <div className="space-y-4">
              <div>
                <p className="sk-eyebrow mb-2.5">Answer length</p>
                <Seg
                  label="Answer length"
                  value={settings.length}
                  onChange={(v) => set({ length: v })}
                  options={[
                    { key: "short", label: "Short" },
                    { key: "normal", label: "Balanced" },
                    { key: "long", label: "Detailed" },
                  ]}
                />
                <p className="mt-2 text-[12px] leading-snug text-ink-4">
                  {settings.length === "short" ? "A sentence or three." : settings.length === "long" ? "Room for nuance, up to a short paragraph or two." : "About a paragraph."}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </Popover>
  );
}
