// src/components/AvailabilityCalendar.tsx
import { useEffect, useMemo, useState } from "react";
import { buildBlockedDaysForMonth } from "../lib/bookings";
import { Contract } from "ethers";

function daysInMonth(year: number, month1to12: number) {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}
function weekdayOf1st(year: number, month1to12: number) {
  return new Date(Date.UTC(year, month1to12 - 1, 1)).getUTCDay();
}

export default function AvailabilityCalendar({
  stay,
  listingId,
  value,
  onChange,
  selectable = true,
}: {
  stay: Contract;
  listingId: number;
  value?: { start?: string; end?: string };
  onChange?: (v: { start?: string; end?: string }) => void;
  selectable?: boolean;
}) {
  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getUTCFullYear());
  const [mon, setMon] = useState(today.getUTCMonth() + 1);
  const [blocked, setBlocked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      if (!stay) return;
      setLoading(true);
      try {
        const b = await buildBlockedDaysForMonth(stay, listingId, year, mon);
        setBlocked(b);
      } finally {
        setLoading(false);
      }
    })();
  }, [stay, listingId, year, mon]);

  const last = daysInMonth(year, mon);
  const firstW = weekdayOf1st(year, mon);

  function toISO(day: number) {
    return `${year}-${String(mon).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  }
  function pick(day: number) {
    if (!selectable) return;
    if (blocked.has(day)) return;
    if (!onChange) return;
    const cur = value ?? {};
    if (!cur.start || (cur.start && cur.end)) {
      onChange({ start: toISO(day), end: undefined });
    } else {
      const s = new Date(cur.start + "T00:00:00Z");
      const e = new Date(toISO(day) + "T00:00:00Z");
      if (e <= s) return;
      onChange({ start: cur.start, end: toISO(day) });
    }
  }

  return (
    <div className="p-4 rounded-2xl bg-white/90 backdrop-blur border shadow">
      <div className="flex items-center justify-between mb-3">
        <button className="px-2 py-1 border rounded" onClick={()=>{
          let m = mon - 1, y = year; if (m === 0) { m = 12; y -= 1; }
          setYear(y); setMon(m);
        }}>◀</button>
        <div className="font-semibold">{year}.{String(mon).padStart(2,"0")}</div>
        <button className="px-2 py-1 border rounded" onClick={()=>{
          let m = mon + 1, y = year; if (m === 13) { m = 1; y += 1; }
          setYear(y); setMon(m);
        }}>▶</button>
      </div>

      <div className="grid grid-cols-7 text-center text-xs mb-1">
        {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => <div key={d} className="text-gray-500">{d}</div>)}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-gray-300 border-t-transparent" />
          <span className="ml-2 text-sm text-gray-600">달력을 불러오는 중…</span>
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstW }).map((_,i)=><div key={"x"+i}></div>)}
          {Array.from({ length: last }).map((_,i)=>{
            const day = i+1;
            const isBlocked = blocked.has(day);
            const isInRange =
              value?.start && value?.end &&
              new Date(value.start+"T00:00:00Z") <= new Date(`${year}-${String(mon).padStart(2,"0")}-${String(day).padStart(2,"0")}T00:00:00Z`) &&
              new Date(`${year}-${String(mon).padStart(2,"0")}-${String(day).padStart(2,"0")}T00:00:00Z`) < new Date(value.end+"T00:00:00Z");

            const cls = [
              "h-10 rounded-lg border text-sm",
              isBlocked
                ? "bg-rose-300 border-rose-400 text-white cursor-not-allowed"  // 예약됨(빨강)
                : isInRange
                  ? "bg-emerald-400/70 border-emerald-500 text-white"         // 선택 구간(진한 초록)
                  : "bg-emerald-50 border-emerald-200 hover:bg-emerald-100",   // 예약 가능(연한 초록)
            ].join(" ");

            return (
              <button key={day} disabled={isBlocked} onClick={()=>pick(day)} className={cls}>
                {day}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-emerald-200 border border-emerald-300" /> 예약 가능
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-rose-400 border border-rose-500" /> 예약됨
        </span>
        {selectable && (
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-emerald-400/70 border border-emerald-500" /> 선택 구간
          </span>
        )}
      </div>
    </div>
  );
}
