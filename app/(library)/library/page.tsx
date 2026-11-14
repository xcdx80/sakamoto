import type { Metadata } from "next";
import { Library } from "@/components/library/Library";
import "@/app/library/library.css";

export const metadata: Metadata = { title: "Library", alternates: { canonical: "/library" } };

export default function LibraryPage() {
  return <Library />;
}
