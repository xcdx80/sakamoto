import type { Metadata } from "next";
import { WriteDesk } from "@/components/write/WriteDesk";
import "@/app/write/write.css";

export const metadata: Metadata = { title: "Write · InView", alternates: { canonical: "/write" } };

export default function WritePage() { return <WriteDesk />; }
