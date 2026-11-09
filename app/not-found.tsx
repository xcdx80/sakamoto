import Link from "next/link";
import { FallingPage } from "@/components/ui/FallingPage";

export default function NotFound() {
  return (
    <main className="sk-desk relative z-[1] flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-16 text-center">
      <FallingPage />
      <h1 className="sk-display mt-14 text-[clamp(2.75rem,7vw,5rem)] text-ink">Nothing written here.</h1>
      <p className="mt-4 text-[16px] text-ink-3">This page is blank in every edition.</p>
      <Link href="/" className="sk-btn sk-btn-ink relative z-10 mt-9">
        Back to Sakamoto
      </Link>
    </main>
  );
}
