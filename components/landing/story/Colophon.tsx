import Link from "next/link";
import "@/app/landing.css";

export function Colophon() {
  return (
    <footer className="story-colophon">
      <p className="story-colophon-mark">InView</p>
      <p>Paper, ink, a yellow highlighter, and a vermilion pen.</p>
      <nav aria-label="Footer">
        <Link href="/library">Library</Link>
        <Link href="/write">Write</Link>
        <Link href="/calendar">Calendar</Link>
        <Link href="/privacy">Privacy Policy</Link>
        <Link href="/terms">Terms of Service</Link>
      </nav>
    </footer>
  );
}
