import type { Metadata } from "next";
import { Landing } from "@/components/landing/Landing";

export const metadata: Metadata = { title: "Sakamoto", alternates: { canonical: "/" } };

export default function Home() {
  return <Landing />;
}
