// src/lib/bookings.ts
import { Contract, formatUnits } from "ethers";
import { toDayUTC } from "../utils/day";

export type PayoutMode = "Escrow" | "Instant";

export interface BookingRow {
  bookingId: bigint;
  listingId: bigint;
  guest: string;
  startDay: number;   // inclusive
  endDay: number;     // exclusive
  nights: number;
  totalPaid: string;  // "123.45 USDC"
  payoutMode: PayoutMode;
  status: "Booked" | "Cancelled" | "Settled";
  checkInTs: number; // seconds
}

const CHECKIN_HOUR_UTC = 15;
function checkInTs(startDay: number) {
  return startDay * 86400 + CHECKIN_HOUR_UTC * 3600;
}

export async function fetchAllBookings(
  stay: Contract,
  opts?: { fromBlock?: number }
): Promise<Map<bigint, BookingRow>> {
  // ---- fromBlock 안전 기본값 (RPC 로그 범위 제한 회피)
  const runner: any = (stay as any).runner ?? (stay as any).provider;
  const provider = runner?.provider ?? runner;
  let fromBlock =
    opts?.fromBlock ??
    Number(import.meta.env.VITE_STAYBOOK_DEPLOY_BLOCK ?? "0");
  if (!Number.isFinite(fromBlock) || fromBlock <= 0) {
    const current = await provider.getBlockNumber();
    fromBlock = Math.max(0, current - 500_000); // 최근 50만 블록만 스캔 (필요시 조정)
  }

  // ---- v6: 인자 없이 전체 필터 생성 (중요)
  const evBooked = await stay.queryFilter(stay.filters.Booked(), fromBlock, "latest");

  const rows = new Map<bigint, BookingRow>();
  for (const ev of evBooked) {
    const bookingId = ev.args[0] as bigint;
    const listingId = ev.args[1] as bigint;
    const guest = (ev.args[2] as string).toLowerCase();
    const startDay = Number(ev.args[3]);
    const endDay = Number(ev.args[4]);
    const total6 = ev.args[5] as bigint;
    const payoutMode: PayoutMode = (Number(ev.args[6]) === 0) ? "Escrow" : "Instant";
    const nights = endDay - startDay;

    rows.set(bookingId, {
      bookingId,
      listingId,
      guest,
      startDay,
      endDay,
      nights,
      totalPaid: `${Number(formatUnits(total6, 6))} USDC`,
      payoutMode,
      status: payoutMode === "Instant" ? "Settled" : "Booked",
      checkInTs: checkInTs(startDay),
    });
  }

  const evCancelled = await stay.queryFilter(stay.filters.Cancelled(), fromBlock, "latest");
  for (const ev of evCancelled) {
    const bookingId = ev.args[0] as bigint;
    const row = rows.get(bookingId);
    if (row) row.status = "Cancelled";
  }

  const evSettled = await stay.queryFilter(stay.filters.Settled(), fromBlock, "latest");
  for (const ev of evSettled) {
    const bookingId = ev.args[0] as bigint;
    const row = rows.get(bookingId);
    if (row && row.payoutMode === "Escrow") row.status = "Settled";
  }

  return rows;
}

export async function fetchHostBookings(stay: Contract, hostAddr: string) {
  const all = await fetchAllBookings(stay);
  const listingIds: bigint[] = [];

  const maxId: bigint = await stay.nextListingId();
  for (let i = 1n; i <= maxId; i++) {
    const L = await stay.listings(i);
    if ((L[0] as string).toLowerCase() === hostAddr.toLowerCase()) {
      listingIds.push(i);
    }
  }

  const out = [];
  for (const row of all.values()) {
    if (listingIds.includes(row.listingId)) out.push(row);
  }
  out.sort((a, b) => a.startDay - b.startDay);
  return out;
}

export async function fetchGuestBookings(stay: Contract, guestAddr: string) {
  const all = await fetchAllBookings(stay);
  const out = [];
  for (const row of all.values()) {
    if (row.guest === guestAddr.toLowerCase()) out.push(row);
  }
  out.sort((a, b) => a.startDay - b.startDay);
  return out;
}

export async function buildBlockedDaysForMonth(
  stay: Contract,
  listingId: number,
  year: number,
  month1to12: number
): Promise<Set<number>> {
  const all = await fetchAllBookings(stay);
  const firstDayUTC = toDayUTC(`${year}-${String(month1to12).padStart(2, "0")}-01`);
  const lastDate = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  const lastDayUTC = firstDayUTC + lastDate;

  const blocked = new Set<number>();
  for (const row of all.values()) {
    if (Number(row.listingId) !== listingId) continue;
    if (row.status === "Cancelled") continue;
    const s = Math.max(row.startDay, firstDayUTC);
    const e = Math.min(row.endDay, lastDayUTC);
    for (let d = s; d < e; d++) blocked.add(d - firstDayUTC + 1);
  }
  return blocked;
}
