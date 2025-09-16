// src/utils/day.ts
// 'YYYY-MM-DD' → UTC 자정 기준 epoch days(정수)
export function toDayUTC(isoYYYYMMDD: string): number {
  const [y, m, d] = isoYYYYMMDD.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d, 0, 0, 0);
  return Math.floor(ms / 86400000);
}

// epoch days → 'YYYY-MM-DD'
export function dayToISO(day: number): string {
  const d = new Date(day * 86400000);
  return d.toISOString().slice(0, 10);
}
