import type { Production } from "./types";

/** A plan is a calendar entry, not an instruction to publish automatically. */
export function calendarProductions(productions: Production[]): Production[] {
  return productions.filter(post => post.status === "planned" && post.plannedAt && Number.isFinite(Date.parse(post.plannedAt)))
    .sort((first, second) => Date.parse(first.plannedAt!) - Date.parse(second.plannedAt!));
}

export function calendarDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function shiftCalendarMonth(month: string, offset: number): string {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function calendarDayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${day}T12:00:00Z`));
}

export function postCalendar(productions: Production[], month: string, timeZone: string, now: Date) {
  const today = calendarDate(now, timeZone);
  const events = calendarProductions(productions).map(post => ({
    post, day: calendarDate(new Date(post.plannedAt!), timeZone),
    time: new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(post.plannedAt!)),
  }));
  const first = new Date(`${month}-01T12:00:00Z`);
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first); date.setUTCDate(first.getUTCDate() - mondayOffset + index);
    const key = date.toISOString().slice(0, 10);
    return { key, number: date.getUTCDate(), label: calendarDayLabel(key), inMonth: key.startsWith(month), today: key === today, events: events.filter(event => event.day === key) };
  });
  return {
    label: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(first),
    today, days, events, count: events.filter(event => event.day.startsWith(month)).length,
  };
}
