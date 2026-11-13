"use client";

import { WritingLink as Link, type WritingNavigationState } from "@/components/write/WritingLink";
import { motion } from "motion/react";
import { CalendarDays, Library, PenLine, type LucideIcon } from "lucide-react";
import { useId, useState } from "react";
import { Account } from "@/components/account/Account";
import { Lockup } from "@/components/brand/InView";
import { spring } from "@/components/motion/tokens";
import { KeyMenu } from "@/components/ui/KeyMenu";
import { SettingsMenu } from "@/components/ui/SettingsMenu";

type Here = "library" | "write" | "calendar";

const PLACES: { key: Here; href: string; label: string; Icon: LucideIcon }[] = [
  { key: "library", href: "/library", label: "Library", Icon: Library },
  { key: "write", href: "/write", label: "Write", Icon: PenLine },
  { key: "calendar", href: "/calendar", label: "Calendar", Icon: CalendarDays },
];

/**
 * The bar across the top of the home page and the library: the same pieces in
 * the same places on both, so moving between them never shifts anything.
 * A single soft pill follows the pointer and rests on the current place.
 */
export function TopBar({ here, onLibrary, writingState }: { here?: Here; onLibrary?: () => void; writingState?: WritingNavigationState }) {
  const pill = useId();
  const [hovered, setHovered] = useState<Here | null>(null);
  const active = hovered ?? here ?? null;

  return (
    <header className="relative z-20 mx-auto flex h-[var(--topbar-h)] w-full max-w-[1400px] shrink-0 items-center justify-between px-5 max-[380px]:px-4 sm:px-8">
      <Lockup />
      <nav aria-label="Main" className="flex items-center gap-1 max-[380px]:gap-0">
        <div className="mr-1 flex items-center gap-0.5" onMouseLeave={() => setHovered(null)}>
          {PLACES.map(({ key, href, label, Icon }) => (
            <Link
              key={key}
              href={href}
              writingState={writingState}
              aria-label={label}
              aria-current={here === key ? "page" : undefined}
              onMouseEnter={() => setHovered(key)}
              onClick={(e) => {
                if (key !== "library" || !onLibrary) return;
                e.preventDefault();
                onLibrary();
              }}
              className="relative inline-flex h-9 items-center gap-2 rounded-full px-3 text-[14px] font-medium text-ink-2 transition-colors hover:text-ink aria-[current=page]:text-ink max-sm:w-9 max-sm:justify-center max-sm:px-0"
            >
              {active === key && <motion.span layoutId={pill} aria-hidden className="absolute inset-0 rounded-full bg-sunk" transition={spring.snap} />}
              <Icon size={16} strokeWidth={1.7} className="relative" aria-hidden />
              <span className="relative max-sm:hidden">{label}</span>
            </Link>
          ))}
        </div>
        <SettingsMenu compact />
        <KeyMenu />
        <Account />
      </nav>
    </header>
  );
}
