import type { Metadata } from "next";
import { Landing } from "@/components/landing/Landing";

export const metadata: Metadata = { title: "InView", alternates: { canonical: "/" } };

export default function Home() {
  return <Landing />;
}
