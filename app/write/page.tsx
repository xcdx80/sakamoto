import type { Metadata } from "next";
import { WriteDesk } from "@/components/write/WriteDesk";
import "./write.css";

export const metadata: Metadata = { title: "Write · Sakamoto", alternates: { canonical: "/write" } };

export default function WritePage() { return <WriteDesk />; }
