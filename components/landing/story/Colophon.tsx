import Link from "next/link";

export function Colophon() {
  return (
    <footer className="story-colophon">
      <p className="story-colophon-mark">Sakamoto</p>
      <p>Paper, ink, a yellow highlighter, and a vermilion pen.</p>
      <nav aria-label="Footer">
        <Link href="/library">Library</Link>
        <Link href="/write">Write</Link>
        <Link href="/calendar">Calendar</Link>
      </nav>
    </footer>
  );
}
