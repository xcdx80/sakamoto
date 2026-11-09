import type { Metadata } from "next";
import { WriteDesk } from "@/components/write/WriteDesk";
import "../write/write.css";

export const metadata: Metadata = { title: "Calendar · Sakamoto", alternates: { canonical: "/calendar" } };

export default function CalendarPage() { return <WriteDesk surface="calendar" />; }
