import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import type { Production } from "@/lib/post-production/types";
import { calendarDate, calendarDayLabel, postCalendar, shiftCalendarMonth } from "@/lib/post-production/calendar";
import { PostPlatformIcons } from "./PostPlatformIcons";
import { ease, spring } from "@/components/motion/tokens";
import "@/app/calendar/calendar.css";

const TONES = ["marigold", "blush", "sky", "lilac"];

/** The same post keeps the same coloured tab, whichever month it is seen in. */
function tabTone(id: string) {
  let sum = 0;
  for (const letter of id) sum = (sum + letter.charCodeAt(0)) % TONES.length;
  return { "--tab": `var(--toy-${TONES[sum]})` } as CSSProperties;
}

export function PostCalendar({ productions, now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: { productions: Production[]; now?: Date; timeZone?: string }) {
  const [month, setMonth] = useState(() => calendarDate(now, timeZone).slice(0, 7));
  const [selectedDay, setSelectedDay] = useState(() => calendarDate(now, timeZone));
  const [flight, setFlight] = useState({ id: 0, direction: 1 });
  const calendar = postCalendar(productions, month, timeZone, now);
  const selected = calendar.events.filter(event => event.day === selectedDay);
  function move(offset: number) { const next = shiftCalendarMonth(month, offset); setMonth(next); setSelectedDay(`${next}-01`); setFlight(previous => ({ id: previous.id + 1, direction: offset })); }
  return <section className="post-calendar" aria-label="Post calendar">
    <header className="post-calendar-toolbar">
      {flight.id > 0 && <motion.span key={flight.id} className="post-calendar-flight" aria-hidden="true" initial={{ x: flight.direction > 0 ? "-6%" : "100%", opacity: 0 }} animate={{ x: flight.direction > 0 ? "100%" : "-6%", opacity: [0, 1, 1, 0] }} transition={{ duration: 1.25, ease: ease.inOut }}><motion.svg viewBox="0 0 34 30" animate={{ y: [8, -10, 4, -14] }} transition={{ duration: 1.25, ease: "easeInOut" }} style={{ scaleX: flight.direction > 0 ? 1 : -1 }}><path d="M2 14 32 2 22 28l-7-10Z" fill="var(--bg-raised)" stroke="var(--ink-3)" strokeLinejoin="round" /><path d="M15 18 32 2" stroke="var(--ink-3)" /></motion.svg></motion.span>}
      <div><h2 aria-live="polite">{calendar.label}</h2><p>{calendar.count} planned {calendar.count === 1 ? "post" : "posts"} · {timeZone.replaceAll("_", " ")}</p></div>
      <div className="post-calendar-navigation"><button className="write-button write-quiet" onClick={() => { setMonth(calendar.today.slice(0, 7)); setSelectedDay(calendar.today); }}>Today</button><button className="write-button write-icon-button" aria-label="Previous month" onClick={() => move(-1)}><ChevronLeft size={18} /></button><button className="write-button write-icon-button" aria-label="Next month" onClick={() => move(1)}><ChevronRight size={18} /></button></div>
    </header>
    <p className="post-calendar-notice">Publication plans. Posts are not published automatically.</p>
    <table className="post-calendar-grid" aria-label={`${calendar.label} publication plans`}><thead><tr>{["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(day => <th scope="col" key={day}><abbr title={day}>{day.slice(0, 3)}</abbr></th>)}</tr></thead><tbody key={month} className="post-calendar-month">{Array.from({ length: 6 }, (_, week) => <tr key={week}>{calendar.days.slice(week * 7, week * 7 + 7).map(day => <td key={day.key} className={`${day.inMonth ? "" : "is-adjacent"}${day.key === selectedDay ? " is-selected" : ""}`}><button className={`post-calendar-day${day.today ? " is-today" : ""}`} aria-label={`${day.label} · ${day.events.length} planned ${day.events.length === 1 ? "post" : "posts"}`} aria-pressed={day.key === selectedDay} onClick={() => setSelectedDay(day.key)}>{day.key === selectedDay && <motion.span layoutId="post-calendar-selected" className="post-calendar-selected" transition={spring.snap} />}<time dateTime={day.key}>{day.number}</time></button><div className="post-calendar-events">{day.events.map(event => <Link className="post-calendar-event" style={tabTone(event.post.id)} key={event.post.id} href={`/write?post=${encodeURIComponent(event.post.id)}`} prefetch={false} aria-label={`${event.time} ${event.post.brief.idea}`} title={event.post.brief.idea}><span className="post-calendar-event-meta"><time dateTime={event.post.plannedAt!}>{event.time}</time><PostPlatformIcons platforms={event.post.brief.platforms} /></span><span className="post-calendar-event-title">{event.post.brief.idea}</span></Link>)}</div></td>)}</tr>)}</tbody></table>
    <section className="post-calendar-agenda" aria-label="Selected day"><header><h3>{calendarDayLabel(selectedDay)}</h3><span>{selected.length} planned</span></header>{selected.length ? selected.map(event => <Link href={`/write?post=${encodeURIComponent(event.post.id)}`} key={event.post.id} className="post-calendar-agenda-entry" prefetch={false}><time dateTime={event.post.plannedAt!}>{event.time}</time><PostPlatformIcons platforms={event.post.brief.platforms} /><strong>{event.post.brief.idea}</strong><ArrowUpRight size={16} aria-hidden="true" /></Link>) : <p>No posts planned for this day.</p>}</section>
  </section>;
}
