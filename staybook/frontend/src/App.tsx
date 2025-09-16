// src/App.tsx
import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { toDayUTC, dayToISO } from "./utils/day";
import ABI from "./abi/StayBookUSDC";
import AvailabilityCalendar from "./components/AvailabilityCalendar";
import { fetchGuestBookings, fetchHostBookings } from "./lib/bookings";

const STAYBOOK_ADDRESS = import.meta.env.VITE_STAYBOOK_ADDRESS as string;
const USDC_ADDRESS = import.meta.env.VITE_USDC_ADDRESS as string;
const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7"; // 11155111

const ERC20_ABI = [
  "function approve(address spender,uint256 value) returns (bool)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)"
];

type PayoutMode = "0" | "1"; // 0: Escrow, 1: Instant

export default function App() {
  const [account, setAccount] = useState<string>("");
  const [provider, setProvider] = useState<ethers.BrowserProvider>();
  const [signer, setSigner] = useState<ethers.Signer>();
  const [log, setLog] = useState("");
  const [activeTab, setActiveTab] = useState<"host" | "guest">("host");

  const append = (m: string) => setLog((s) => s + m + "\n");

  const [busy, setBusy] = useState(false);
  const [loadingListings, setLoadingListings] = useState(false);

  // contracts (v6)
  const stay = useMemo(() => {
    if (!signer) return null;
    return new ethers.Contract(STAYBOOK_ADDRESS, ABI, signer);
  }, [signer]);

  const usdc = useMemo(() => {
    if (!signer) return null;
    return new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
  }, [signer]);

  async function connect() {
    try {
      if (!(window as any).ethereum) {
        alert("메타마스크가 필요합니다.");
        return;
      }
      setBusy(true);
      const p = new ethers.BrowserProvider((window as any).ethereum);
      await p.send("eth_requestAccounts", []);
      try {
        await p.send("wallet_switchEthereumChain", [{ chainId: SEPOLIA_CHAIN_ID_HEX }]);
      } catch {
        append("네트워크 전환이 필요합니다(수동으로 Sepolia 선택).");
      }
      const s = await p.getSigner();
      setProvider(p);
      setSigner(s);
      const addr = await s.getAddress();
      setAccount(addr);
      append("✅ 지갑 연결됨: " + addr);
    } catch (e: any) {
      append("connect error: " + (e?.shortMessage || e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  }

  // ===== Host: Create Listing =====
  const [nightly, setNightly] = useState("100"); // 100 USDC
  const [cancelHours, setCancelHours] = useState("24");
  const [payoutMode, setPayoutMode] = useState<PayoutMode>("0"); // 0: Escrow, 1: Instant

  async function createListing() {
    if (!stay) { append("contract not ready"); return; }
    try {
      setBusy(true);
      const n = Number(nightly || "0");
      if (!isFinite(n) || n <= 0) { append("1박 요금을 확인하세요."); return; }
      const price6 = ethers.parseUnits(nightly || "0", 6);
      const tx = await stay.createListing(price6, Number(cancelHours || "0"), Number(payoutMode));
      append("createListing tx: " + tx.hash);
      await tx.wait();
      append("✅ 숙소가 등록되었습니다.");
      await loadListings();
    } catch (e: any) {
      append("createListing error: " + (e?.shortMessage || e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  }

  // ===== Listings =====
  const [listings, setListings] = useState<any[]>([]);
  async function loadListings() {
    if (!stay) { append("contract not ready"); return; }
    try {
      setLoadingListings(true);
      const maxId = await stay.nextListingId();
      const arr: any[] = [];
      for (let i = 1; i <= Number(maxId); i++) {
        const L = await stay.listings(i);
        arr.push({
          id: i,
          host: L[0],
          nightly: Number(ethers.formatUnits(L[1], 6)),
          cancelHours: Number(L[2]),
          active: L[3],
          payoutMode: Number(L[4]) === 0 ? "Escrow" : "Instant"
        });
      }
      setListings(arr);
    } catch (e: any) {
      append("loadListings error: " + (e?.shortMessage || e?.message || String(e)));
    } finally {
      setLoadingListings(false);
    }
  }

  // ===== Guest: 입금(=결제 한도) / 예약 =====
  const [approveAmt, setApproveAmt] = useState("1000"); // 1000 USDC
  const [allowance, setAllowance] = useState<string>("-");

  async function refreshAllowance() {
    if (!usdc || !account) return;
    try {
      const a = await usdc.allowance(account, STAYBOOK_ADDRESS);
      const display = Number(ethers.formatUnits(a, 6)).toLocaleString();
      setAllowance(display + " USDC");
    } catch (e: any) {
      append("allowance error: " + (e?.shortMessage || e?.message || String(e)));
    }
  }

  async function approve() {
    if (!usdc) { append("usdc not ready"); return; }
    try {
      setBusy(true);
      const n = Number(approveAmt || "0");
      if (!isFinite(n) || n <= 0) { append("입금 한도를 확인하세요."); return; }
      const value = ethers.parseUnits(approveAmt || "0", 6);
      const tx = await usdc.approve(STAYBOOK_ADDRESS, value);
      append("approve tx: " + tx.hash);
      await tx.wait();
      append("✅ 입금 한도 설정 완료");
      await refreshAllowance();
    } catch (e: any) {
      append("approve error: " + (e?.shortMessage || e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  }

  const [listingId, setListingId] = useState("1");
  const [startISO, setStartISO] = useState("2025-09-20");
  const [endISO, setEndISO] = useState("2025-09-23");
  const [rangeAvailable, setRangeAvailable] = useState<string>("-");

  async function checkRange() {
    if (!stay) { append("contract not ready"); return; }
    try {
      setBusy(true);
      const s = toDayUTC(startISO);
      const e = toDayUTC(endISO);
      if (!(e > s)) { append("종료일은 시작일보다 커야 합니다."); return; }
      const ok: boolean = await stay.isRangeAvailable(Number(listingId), s, e);
      setRangeAvailable(ok ? "가능" : "불가");
    } catch (e: any) {
      append("isRangeAvailable error: " + (e?.shortMessage || e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function book() {
    if (!stay) { append("contract not ready"); return; }
    try {
      setBusy(true);
      const s = toDayUTC(startISO);
      const e = toDayUTC(endISO);
      if (!(e > s)) { append("종료일은 시작일보다 커야 합니다."); return; }
      const idNum = Number(listingId);
      if (!Number.isFinite(idNum) || idNum <= 0) { append("숙소 ID를 확인하세요."); return; }

      const tx = await stay.bookUSDC(idNum, s, e);
      append("bookUSDC tx: " + tx.hash);
      await tx.wait();
      append("✅ 예약 완료");
      await refreshPending();
    } catch (e: any) {
      append("book error: " + (e?.shortMessage || e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  }

  // ===== Cancel / Settle / Withdraw =====
  const [bookingId, setBookingId] = useState("1");
  const [pending, setPending] = useState<string>("-");

  async function cancelGuestByIds(listingIdNum: number, bookingIdNum: number) {
    if (!stay) { append("contract not ready"); return; }
    try {
      setBusy(true);
      const tx = await stay.cancelByGuest(listingIdNum, bookingIdNum);
      append(`cancel tx(${bookingIdNum}): ${tx.hash}`);
      await tx.wait();
      append("✅ 예약 취소 (환불 대기 중)");
      await refreshPending();
    } catch (e: any) {
      append("cancel error: " + (e?.shortMessage || e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function cancelGuest() {
    return cancelGuestByIds(Number(listingId), Number(bookingId));
  }

  async function settleHost() {
    if (!stay) { append("contract not ready"); return; }
    try {
      setBusy(true);
      const tx = await stay.settleToHost(Number(bookingId), Number(listingId));
      append("settle tx: " + tx.hash);
      await tx.wait();
      append("✅ 정산 완료 (출금 대기 중)");
      await refreshPending();
    } catch (e: any) {
      append("settle error: " + (e?.shortMessage || e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!stay) { append("contract not ready"); return; }
    try {
      setBusy(true);
      const tx = await stay.withdrawUSDC();
      append("withdraw tx: " + tx.hash);
      await tx.wait();
      append("✅ 출금 완료");
      await refreshPending();
    } catch (e: any) {
      append("withdraw error: " + (e?.shortMessage || e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function refreshPending() {
    if (!stay || !account) return;
    try {
      const p = await stay.pendingUSDC6(account);
      const display = Number(ethers.formatUnits(p, 6)).toLocaleString();
      setPending(display + " USDC");
    } catch (e: any) {
      append("pending error: " + (e?.shortMessage || e?.message || String(e)));
    }
  }

  useEffect(() => {
    if (account && stay) {
      loadListings();
      refreshAllowance();
      refreshPending();
    }
  }, [account, stay]);

  // ===================== UI =====================
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="max-w-screen-xl mx-auto px-6 py-3 flex items-center justify-between">
          <h1 className="text-xl sm:text-2xl font-bold">StayBook · USDC (Sepolia)</h1>
          <div className="flex gap-2 items-center">
            <button
              onClick={connect}
              className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90 shadow"
            >
              지갑 연결
            </button>
            <span className="text-sm text-gray-600 hidden sm:block">
              계정: {account ? `${account.slice(0,6)}…${account.slice(-4)}` : "-"}
            </span>
          </div>
        </div>
      </header>

      {/* 탭 */}
      <div className="max-w-screen-xl mx-auto px-6 pt-4">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("host")}
            className={`px-4 py-2 rounded-xl ${
              activeTab === "host"
                ? "border-2 border-gray-800 bg-white font-bold"
                : "border border-gray-300 bg-white/70"
            }`}
          >
            호스트 페이지
          </button>
          <button
            onClick={() => setActiveTab("guest")}
            className={`px-4 py-2 rounded-xl ${
              activeTab === "guest"
                ? "border-2 border-gray-800 bg-white font-bold"
                : "border border-gray-300 bg-white/70"
            }`}
          >
            게스트 페이지
          </button>
        </div>
      </div>

      {/* 본문 */}
      <main className="max-w-screen-xl mx-auto px-6 py-6">
        {activeTab === "host" ? (
          <HostPage
            nightly={nightly}
            setNightly={setNightly}
            cancelHours={cancelHours}
            setCancelHours={setCancelHours}
            payoutMode={payoutMode}
            setPayoutMode={setPayoutMode}
            createListing={createListing}
            listings={listings}
            loadListings={loadListings}
            settleHost={settleHost}
            withdraw={withdraw}
            bookingId={bookingId}
            setBookingId={setBookingId}
            pending={pending}
            stay={stay}
            account={account}
            loadingListings={loadingListings}
          />
        ) : (
          <GuestPage
            approveAmt={approveAmt}
            setApproveAmt={setApproveAmt}
            approve={approve}
            allowance={allowance}
            listings={listings}
            loadListings={loadListings}
            listingId={listingId}
            setListingId={setListingId}
            startISO={startISO}
            setStartISO={setStartISO}
            endISO={endISO}
            setEndISO={setEndISO}
            checkRange={checkRange}
            rangeAvailable={rangeAvailable}
            book={book}
            cancelGuest={cancelGuest}
            cancelGuestByIds={cancelGuestByIds}
            bookingId={bookingId}
            setBookingId={setBookingId}
            withdraw={withdraw}
            pending={pending}
            stay={stay}
            account={account}
            loadingListings={loadingListings}
          />
        )}

        <pre className="bg-[#0b1020] text-[#9dfca6] p-3 rounded-xl mt-6 whitespace-pre-wrap">
          {log}
        </pre>
      </main>

      {/* 로딩 오버레이 */}
      {busy && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="rounded-2xl bg-white p-4 shadow flex items-center">
            <div className="animate-spin h-6 w-6 rounded-full border-2 border-gray-300 border-t-transparent" />
            <span className="ml-3">처리 중…</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ===================== Host Page =====================
function HostPage(props: {
  nightly: string;
  setNightly: (v: string) => void;
  cancelHours: string;
  setCancelHours: (v: string) => void;
  payoutMode: "0" | "1";
  setPayoutMode: (v: "0" | "1") => void;
  createListing: () => void;
  listings: any[];
  loadListings: () => void;
  settleHost: () => void;
  withdraw: () => void;
  bookingId: string;
  setBookingId: (v: string) => void;
  pending: string;
  stay: ethers.Contract | null;
  account: string;
  loadingListings: boolean;
}) {
  const {
    nightly, setNightly,
    cancelHours, setCancelHours,
    payoutMode, setPayoutMode,
    createListing,
    listings, loadListings,
    settleHost, withdraw,
    bookingId, setBookingId,
    pending, stay, account,
    loadingListings
  } = props;

  const [hostRows, setHostRows] = useState<any[]>([]);
  const [calListingId, setCalListingId] = useState("1");
  const [loadingHostBookings, setLoadingHostBookings] = useState(false);

  async function loadHostBookings() {
    if (!stay || !account) return;
    setLoadingHostBookings(true);
    try {
      const rows = await fetchHostBookings(stay, account);
      setHostRows(rows);
    } finally {
      setLoadingHostBookings(false);
    }
  }

  return (
    <div className="grid gap-6">
      {/* 숙소 등록 */}
      <section className="p-5 rounded-2xl bg-white/90 backdrop-blur border shadow space-y-3">
        <h2 className="text-xl font-semibold">숙소 등록</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="grid [grid-template-columns:140px_1fr] gap-2 items-center">
            <label>1박 요금(USDC)</label>
            <input value={nightly} onChange={(e)=>setNightly(e.target.value)} className="border rounded px-2 py-1" />
            <label>무료 취소 마감(시간)</label>
            <input value={cancelHours} onChange={(e)=>setCancelHours(e.target.value)} className="border rounded px-2 py-1" />
            <label>정산 방식</label>
            <select value={payoutMode} onChange={(e)=>setPayoutMode(e.target.value as "0"|"1")} className="border rounded px-2 py-1">
              <option value="0">에스크로 (체크인 후 정산)</option>
              <option value="1">즉시 정산</option>
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={createListing} className="px-4 py-3 rounded-xl bg-black text-white hover:opacity-90 shadow">
              숙소 만들기
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500">* 호스트 지갑으로 실행하세요.</p>
      </section>

      {/* 숙소 목록 (카드) */}
      <section className="p-5 rounded-2xl bg-white/90 backdrop-blur border shadow">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold">숙소 목록</h2>
          <button onClick={loadListings} className="px-3 py-2 rounded-xl bg-gray-800 text-white hover:opacity-90">
            새로고침
          </button>
        </div>
        {loadingListings ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin h-6 w-6 rounded-full border-2 border-gray-300 border-t-transparent" />
            <span className="ml-2 text-sm text-gray-600">불러오는 중…</span>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {listings.map((L) => (
              <article key={L.id} className="rounded-2xl bg-white border shadow p-4">
                <div className="text-lg font-semibold mb-1">숙소 #{L.id}</div>
                <div className="text-2xl font-bold">{L.nightly}<span className="text-sm font-normal"> USDC / night</span></div>
                <div className="mt-2 text-sm text-gray-600">취소 {L.cancelHours}시간 전까지 가능</div>
                <div className="mt-2 flex gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full border ${L.payoutMode==='Escrow'?'border-amber-300 bg-amber-50 text-amber-800':'border-emerald-300 bg-emerald-50 text-emerald-800'}`}>
                    {L.payoutMode}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded-full border ${L.active?'border-emerald-300 bg-emerald-50 text-emerald-800':'border-gray-300 bg-gray-100 text-gray-600'}`}>
                    {L.active ? "활성" : "비활성"}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 예약 현황(호스트) */}
      <section className="p-5 rounded-2xl bg-white/90 backdrop-blur border shadow">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold">예약 현황</h2>
          <button onClick={loadHostBookings} className="px-3 py-2 rounded-xl bg-gray-800 text-white hover:opacity-90">
            예약 불러오기
          </button>
        </div>
        {loadingHostBookings ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin h-6 w-6 rounded-full border-2 border-gray-300 border-t-transparent" />
            <span className="ml-2 text-sm text-gray-600">불러오는 중…</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="p-2">예약ID</th>
                  <th className="p-2">숙소ID</th>
                  <th className="p-2">게스트</th>
                  <th className="p-2">체크인</th>
                  <th className="p-2">박수</th>
                  <th className="p-2">결제</th>
                  <th className="p-2">상태</th>
                </tr>
              </thead>
              <tbody>
                {hostRows.map((r:any)=>(
                  <tr key={String(r.bookingId)} className="border-t">
                    <td className="p-2">{String(r.bookingId)}</td>
                    <td className="p-2">{String(r.listingId)}</td>
                    <td className="p-2">{r.guest.slice(0,6)}…{r.guest.slice(-4)}</td>
                    <td className="p-2">{dayToISO(r.startDay)}</td>
                    <td className="p-2">{r.nights}</td>
                    <td className="p-2">{r.totalPaid}</td>
                    <td className="p-2">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 방 캘린더(색상 표시) */}
      <section className="p-5 rounded-2xl bg-white/90 backdrop-blur border shadow space-y-3">
        <h2 className="text-xl font-semibold">방 캘린더</h2>
        <div className="grid [grid-template-columns:140px_1fr] gap-2 items-center">
          <label>숙소 ID</label>
          <input value={calListingId} onChange={(e)=>setCalListingId(e.target.value)} className="border rounded px-2 py-1" />
        </div>
        {stay && Number(calListingId) > 0 ? (
          <AvailabilityCalendar stay={stay} listingId={Number(calListingId)} selectable={false} />
        ) : <p className="text-sm text-gray-500">숙소 ID를 먼저 입력하세요.</p>}
      </section>

      {/* 정산/출금 */}
      <section className="p-5 rounded-2xl bg-white/90 backdrop-blur border shadow space-y-3">
        <h2 className="text-xl font-semibold">정산 / 출금 (에스크로)</h2>
        <div className="grid [grid-template-columns:140px_1fr] gap-2 items-center">
          <label>예약 ID</label>
          <input value={bookingId} onChange={(e)=>setBookingId(e.target.value)} className="border rounded px-2 py-1" />
        </div>
        <div className="flex gap-2">
          <button onClick={settleHost} className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:opacity-90">정산하기</button>
          <button onClick={withdraw} className="px-4 py-2 rounded-xl bg-indigo-600 text-white hover:opacity-90">출금하기</button>
        </div>
        <div className="text-sm text-gray-700">대기 중 금액: <strong>{pending}</strong></div>
      </section>
    </div>
  );
}

// ===================== Guest Page =====================
function GuestPage(props: {
  approveAmt: string;
  setApproveAmt: (v: string) => void;
  approve: () => void;
  allowance: string;
  listings: any[];
  loadListings: () => void;
  listingId: string;
  setListingId: (v: string) => void;
  startISO: string;
  setStartISO: (v: string) => void;
  endISO: string;
  setEndISO: (v: string) => void;
  checkRange: () => void;
  rangeAvailable: string;
  book: () => void;
  cancelGuest: () => void;
  cancelGuestByIds: (listingIdNum: number, bookingIdNum: number) => Promise<void>;
  bookingId: string;
  setBookingId: (v: string) => void;
  withdraw: () => void;
  pending: string;
  stay: ethers.Contract | null;
  account: string;
  loadingListings: boolean;
}) {
  const {
    approveAmt, setApproveAmt, approve, allowance,
    listings, loadListings, loadingListings,
    listingId, setListingId,
    startISO, setStartISO,
    endISO, setEndISO,
    checkRange, rangeAvailable, book,
    cancelGuestByIds, bookingId, setBookingId,
    withdraw, pending,
    stay, account
  } = props;

  const [calRange, setCalRange] = useState<{ start?: string; end?: string }>({});
  const [myBookings, setMyBookings] = useState<any[]>([]);
  const [loadingMy, setLoadingMy] = useState(false);

  async function loadMyBookings() {
    if (!stay || !account) return;
    try {
      const rows = await fetchGuestBookings(stay, account);
      setMyBookings(rows);
    } catch (e:any) {
      append("loadMyBookings error: " + (e?.shortMessage || e?.message || String(e)));
    }
  }

  // 선택된 숙소의 가격 표시 (가이드)
  const selectedListing = listings.find((l)=> String(l.id) === String(listingId));
  const selectedNights = calRange.start && calRange.end
    ? toDayUTC(calRange.end) - toDayUTC(calRange.start)
    : 0;
  const estTotal = selectedListing ? (selectedListing.nightly * selectedNights) : 0;

  return (
    <div className="grid gap-6">
      {/* 숙소 목록 (카드) */}
      <section className="p-5 rounded-2xl bg-white/90 backdrop-blur border shadow">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold">숙소 목록</h2>
          <button onClick={loadListings} className="px-3 py-2 rounded-xl bg-gray-800 text-white hover:opacity-90">
            새로고침
          </button>
        </div>
        {loadingListings ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin h-6 w-6 rounded-full border-2 border-gray-300 border-t-transparent" />
            <span className="ml-2 text-sm text-gray-600">불러오는 중…</span>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {listings.map((L) => (
              <article key={L.id} className={`rounded-2xl bg-white border shadow p-4 ${String(L.id)===String(listingId) ? "ring-2 ring-indigo-300":""}`}>
                <div className="text-lg font-semibold mb-1">숙소 #{L.id}</div>
                <div className="text-2xl font-bold">{L.nightly}<span className="text-sm font-normal"> USDC / night</span></div>
                <div className="mt-2 text-sm text-gray-600">취소 {L.cancelHours}시간 전까지 가능</div>
                <div className="mt-2 flex gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full border ${L.payoutMode==='Escrow'?'border-amber-300 bg-amber-50 text-amber-800':'border-emerald-300 bg-emerald-50 text-emerald-800'}`}>
                    {L.payoutMode}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded-full border ${L.active?'border-emerald-300 bg-emerald-50 text-emerald-800':'border-gray-300 bg-gray-100 text-gray-600'}`}>
                    {L.active ? "활성" : "비활성"}
                  </span>
                </div>
                <button
                  onClick={()=>setListingId(String(L.id))}
                  className="mt-3 w-full px-3 py-2 rounded-xl border hover:bg-gray-50"
                >
                  이 숙소 선택
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 입금(한도 설정) */}
      <section className="p-5 rounded-2xl bg-white/90 backdrop-blur border shadow space-y-2">
        <h2 className="text-xl font-semibold">입금 (결제 한도 설정)</h2>
        <p className="text-sm text-gray-600">지갑에서 이 사이트가 사용할 수 있는 USDC 한도를 설정합니다. 예약 때 자동 결제돼요.</p>
        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
          <input value={approveAmt} onChange={(e)=>setApproveAmt(e.target.value)} className="border rounded px-2 py-2 w-full sm:w-60" />
          <button onClick={approve} className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90 shadow">입금(한도) 허용</button>
          <span className="text-sm">현재 한도: {allowance}</span>
        </div>
      </section>

      {/* 예약하기 + 달력 */}
      <section className="p-5 rounded-2xl bg-white/90 backdrop-blur border shadow space-y-3">
        <h2 className="text-xl font-semibold">예약하기</h2>
        <div className="grid [grid-template-columns:140px_1fr] gap-2 items-center">
          <label>숙소 ID</label>
          <input value={listingId} onChange={(e)=>setListingId(e.target.value)} className="border rounded px-2 py-1" />
        </div>

        {stay && Number(listingId) > 0 ? (
          <>
            <AvailabilityCalendar
              stay={stay}
              listingId={Number(listingId)}
              value={calRange}
              onChange={setCalRange}
            />
            <div className="text-sm text-gray-700">
              {calRange.start && calRange.end ? (
                <>선택 기간: <strong>{calRange.start}</strong> → <strong>{calRange.end}</strong> ({selectedNights}박)
                {selectedListing ? <> · 예상 결제: <strong>{estTotal}</strong> USDC</> : null}</>
              ) : "달력에서 기간을 선택하세요."}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={async ()=>{
                  if (!calRange.start || !calRange.end) { alert("달력에서 기간을 선택하세요."); return; }
                  setStartISO(calRange.start); setEndISO(calRange.end);
                  await checkRange();
                }}
                className="px-4 py-2 rounded-xl border hover:bg-gray-50"
              >
                가능 여부 확인
              </button>
              <button
                onClick={async ()=>{
                  if (!calRange.start || !calRange.end) { alert("달력에서 기간을 선택하세요."); return; }
                  setStartISO(calRange.start); setEndISO(calRange.end);
                  await book();
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:opacity-90"
              >
                예약
              </button>
            </div>
            <div className="text-sm">기간 가능 여부: <strong>{rangeAvailable}</strong></div>
          </>
        ) : <p className="text-sm text-gray-500">숙소 ID를 먼저 입력하세요.</p>}
      </section>

      {/* 취소 / 출금 (빠른 액션) */}
      <section className="p-5 rounded-2xl bg-white/90 backdrop-blur border shadow space-y-2">
        <h2 className="text-xl font-semibold">출금</h2>
        <div className="flex items-center gap-2">
          <button onClick={withdraw} className="px-4 py-2 rounded-xl bg-indigo-600 text-white hover:opacity-90">출금하기</button>
          <span className="text-sm text-gray-700">대기 중 금액: <strong>{pending}</strong></span>
        </div>
      </section>

      {/* 내 예약 (취소 버튼 포함) */}
      <section className="p-5 rounded-2xl bg-white/90 backdrop-blur border shadow">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold">내 예약</h2>
          <button onClick={loadMyBookings} className="px-3 py-2 rounded-xl bg-gray-800 text-white hover:opacity-90">내 예약 불러오기</button>
        </div>

        {loadingMy ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin h-6 w-6 rounded-full border-2 border-gray-300 border-t-transparent" />
            <span className="ml-2 text-sm text-gray-600">불러오는 중…</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="p-2">예약ID</th>
                  <th className="p-2">숙소ID</th>
                  <th className="p-2">체크인</th>
                  <th className="p-2">박수</th>
                  <th className="p-2">결제</th>
                  <th className="p-2">정산</th>
                  <th className="p-2">상태</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {myBookings.map((r:any)=>(
                  <tr key={String(r.bookingId)} className="border-t">
                    <td className="p-2">{String(r.bookingId)}</td>
                    <td className="p-2">{String(r.listingId)}</td>
                    <td className="p-2">{dayToISO(r.startDay)}</td>
                    <td className="p-2">{r.nights}</td>
                    <td className="p-2">{r.totalPaid}</td>
                    <td className="p-2">{r.payoutMode}</td>
                    <td className="p-2">
                      <span className={
                        r.status==="Cancelled" ? "text-red-600" :
                        r.status==="Settled" ? "text-emerald-600" : "text-gray-800"
                      }>{r.status}</span>
                    </td>
                    <td className="p-2">
                      <button
                        disabled={r.status!=="Booked"}
                        onClick={()=>props.cancelGuestByIds(Number(r.listingId), Number(r.bookingId))}
                        className={`px-3 py-1 rounded-lg border ${r.status==="Booked" ? "hover:bg-gray-50" : "opacity-40 cursor-not-allowed"}`}
                      >
                        취소
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
