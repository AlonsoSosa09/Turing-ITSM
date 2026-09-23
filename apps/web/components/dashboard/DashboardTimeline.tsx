"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useTransition } from "react";

type DashboardTimelineProps = { initialSelectedDate: string };

const dayFormatter = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", timeZone: "UTC" });
const weekdayFormatter = new Intl.DateTimeFormat("es-AR", { weekday: "short", timeZone: "UTC" });
const weekFormatter = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", timeZone: "UTC" });
const longDateFormatter = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function startOfWeek(date: Date): Date {
  const start = new Date(date);
  const day = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - (day === 0 ? 6 : day - 1));
  return start;
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

export function DashboardTimeline({ initialSelectedDate }: DashboardTimelineProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const today = dateKey(new Date());
  const selectedDate = initialSelectedDate || searchParams.get("selectedDate") || today;
  const selectedDateObject = useMemo(() => parseDate(selectedDate), [selectedDate]);
  const weekStart = useMemo(() => startOfWeek(selectedDateObject), [selectedDateObject]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const previousWeek = addDays(weekStart, -7);
  const nextWeek = addDays(weekStart, 7);
  const minDate = new Date(Date.UTC(2020, 0, 1));
  const maxDate = addDays(startOfWeek(parseDate(today)), 56);
  const atPreviousLimit = previousWeek < startOfWeek(minDate);
  const atNextLimit = nextWeek > maxDate;
  const minDateKey = dateKey(minDate);
  const maxDateKey = dateKey(addDays(maxDate, 6));

  const updateSelectedDate = useCallback(
    (value: string) => {
      if (value < minDateKey || value > maxDateKey) return;
      startTransition(() => {
        const next = new URLSearchParams(searchParams.toString());
        next.set("selectedDate", value);
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      });
    },
    [maxDateKey, minDateKey, pathname, router, searchParams],
  );

  const shiftWeek = useCallback(
    (amount: number) => {
      if ((amount < 0 && atPreviousLimit) || (amount > 0 && atNextLimit)) return;
      const dayOffset = Math.max(0, Math.min(6, Math.round((selectedDateObject.getTime() - weekStart.getTime()) / 86400000)));
      updateSelectedDate(dateKey(addDays(addDays(weekStart, amount * 7), dayOffset)));
    },
    [atNextLimit, atPreviousLimit, selectedDateObject, updateSelectedDate, weekStart],
  );

  const goToday = useCallback(() => updateSelectedDate(today), [today, updateSelectedDate]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        updateSelectedDate(dateKey(addDays(selectedDateObject, -1)));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        updateSelectedDate(dateKey(addDays(selectedDateObject, 1)));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        shiftWeek(-1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        shiftWeek(1);
      } else if (event.key.toLowerCase() === "t" || event.key === "Home") {
        event.preventDefault();
        goToday();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToday, selectedDateObject, shiftWeek, updateSelectedDate]);

  return (
    <div aria-busy={isPending} className="dashboard-timeline">
      <div className="dashboard-timeline-header">
        <button
          aria-label="Semana anterior"
          className="dashboard-timeline-arrow"
          disabled={isPending || atPreviousLimit}
          onClick={() => shiftWeek(-1)}
          type="button"
        >‹</button>
        <div className="dashboard-timeline-week">
          <span>{dateKey(weekStart) === dateKey(startOfWeek(parseDate(today))) ? "Semana actual" : "Semana seleccionada"}</span>
          <strong>{weekFormatter.format(weekStart)} — {weekFormatter.format(addDays(weekStart, 6))}</strong>
        </div>
        <button
          aria-label="Semana siguiente"
          className="dashboard-timeline-arrow"
          disabled={isPending || atNextLimit}
          onClick={() => shiftWeek(1)}
          type="button"
        >›</button>
        <button className="dashboard-timeline-today" disabled={isPending || selectedDate === today} onClick={goToday} type="button">
          Hoy
        </button>
      </div>
      <p aria-live="polite" className="dashboard-timeline-selected">
        {longDateFormatter.format(selectedDateObject)}
      </p>
      <div aria-label="Días de la semana" className="dashboard-timeline-days" role="tablist">
        {days.map((day) => {
          const key = dateKey(day);
          const active = key === selectedDate;
          const isToday = key === today;
          return (
            <button
              aria-selected={active}
              className={`dashboard-day-pill${active ? " active" : ""}${isToday ? " today" : ""}`}
              disabled={isPending}
              key={key}
              onClick={() => updateSelectedDate(key)}
              role="tab"
              type="button"
            >
              <span>{weekdayFormatter.format(day).replace(".", "")}</span>
              <strong>{dayFormatter.format(day)}</strong>
              {isToday ? <small>Hoy</small> : null}
            </button>
          );
        })}
      </div>
      <p className="dashboard-timeline-hint">Flechas: día/semana · T: volver a hoy</p>
    </div>
  );
}
