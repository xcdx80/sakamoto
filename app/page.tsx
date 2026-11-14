import type { Metadata } from "next";
import { AccountLibrary } from "@/components/account/SyncAgent";
import { Colophon } from "@/components/landing/story/Colophon";
import { Landing } from "@/components/landing/Landing";

export const metadata: Metadata = { title: "InView", alternates: { canonical: "/" } };

export default function Home() {
  return (
    <>
      <AccountLibrary><Landing /></AccountLibrary>
      <Colophon />
    </>
  );
}
