// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * StayBookUSDC (Sepolia 등에서 USDC 결제)
 * - 날짜는 "epoch 이후 일 수" 정수 (UTC 기준)로 가정 (예: day = floor(timestamp / 1 days))
 * - 체크인 시간은 UTC 기준 CHECKIN_HOUR_UTC 시각으로 계산
 * - Escrow 모드: 예약 시 에스크로에 보관 → 체크인 이후 호스트 정산/출금
 * - Instant 모드: 예약 시점에 바로 호스트에게 전송(비환불 권장, on-chain 환불 불가)
 */
contract StayBookUSDC is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ====== Config ======
    uint32  public constant MAX_NIGHTS        = 30;   // 가스/운영 안전상 최대 숙박일수
    uint32  public constant CHECKIN_HOUR_UTC  = 15;   // UTC 15:00 체크인(원하면 변경 가능)

    enum PayoutMode { Escrow, Instant }

    IERC20 public immutable USDC; // 네트워크별 USDC 주소로 배포

    // ====== Data ======
    struct Listing {
        address    host;
        uint96     nightlyPrice6;     // USDC 6 decimals (예: 100 USDC => 100 * 1e6)
        uint32     cancelBeforeHours; // 체크인 몇 시간 전까지 취소 허용(Escrow 모드에서만 의미)
        bool       active;
        PayoutMode payoutMode;
    }

    struct Booking {
        address    guest;
        uint32     startDay;   // inclusive
        uint32     endDay;     // exclusive
        uint96     totalPaid6; // 6-decimals
        bool       settled;    // Escrow: 정산 완료 여부 / Instant: 예약 시 true
        uint64     checkInTs;  // 계산된 체크인 타임스탬프(초)
    }

    uint256 public nextListingId;
    uint256 public nextBookingId;

    mapping(uint256 => Listing) public listings;
    mapping(uint256 => Booking) public bookings;

    // 이중예약 방지: listingId -> day -> guest
    mapping<uint256 => mapping(uint32 => address)) public bookedBy;

    // Escrow 정산/환불 대기 잔액(USDC 6-decimals)
    mapping(address => uint256) public pendingUSDC6;

    // ====== Events ======
    event Listed(uint256 indexed listingId, address indexed host, uint96 nightlyPrice6, uint32 cancelBeforeHours, PayoutMode payoutMode);
    event Booked(
        uint256 indexed bookingId,
        uint256 indexed listingId,
        address indexed guest,
        uint32 startDay,
        uint32 endDay,
        uint96 totalPaid6,
        PayoutMode payoutMode
    );
    event Cancelled(uint256 indexed bookingId, uint256 refund6, uint256 payout6);
    event Settled(uint256 indexed bookingId, uint256 payout6);
    event WithdrawUSDC(address indexed to, uint256 amount6);

    // ====== Ctor ======
    constructor(address usdc) {
        require(usdc != address(0), "USDC addr");
        USDC = IERC20(usdc);
    }

    // ====== Utils ======
    function _daysBetween(uint32 s, uint32 e) internal pure returns (uint32) {
        require(e > s, "range");
        unchecked { return e - s; }
    }

    function _checkInTs(uint32 startDay) internal pure returns (uint64) {
        // startDay는 epoch 이후 일 수로 가정
        return uint64(startDay) * 1 days + uint64(CHECKIN_HOUR_UTC) * 1 hours;
    }

    // ====== Host ======
    function createListing(
        uint96 nightlyPrice6,
        uint32 cancelBeforeHours,
        PayoutMode payoutMode
    ) external returns (uint256 id) {
        id = ++nextListingId;
        listings[id] = Listing({
            host: msg.sender,
            nightlyPrice6: nightlyPrice6,
            cancelBeforeHours: cancelBeforeHours,
            active: true,
            payoutMode: payoutMode
        });
        emit Listed(id, msg.sender, nightlyPrice6, cancelBeforeHours, payoutMode);
    }

    function updateListing(
        uint256 listingId,
        uint96 nightlyPrice6,
        uint32 cancelBeforeHours,
        bool active,
        PayoutMode payoutMode
    ) external {
        Listing storage L = listings[listingId];
        require(msg.sender == L.host, "not host");
        L.nightlyPrice6      = nightlyPrice6;
        L.cancelBeforeHours  = cancelBeforeHours;
        L.active             = active;
        L.payoutMode         = payoutMode;
    }

    function setActive(uint256 listingId, bool active) external {
        Listing storage L = listings[listingId];
        require(msg.sender == L.host, "not host");
        L.active = active;
    }

    // ====== Guest: Book with USDC ======
    /**
     * 예약 시:
     * - Escrow: guest -> contract로 USDC 예치, 날짜 마킹, Booking 생성(정산 전)
     * - Instant: guest -> host로 USDC 즉시 전송, 날짜 마킹, Booking 생성(즉시 settled=true)
     */
    function bookUSDC(uint256 listingId, uint32 startDay, uint32 endDay)
        external
        nonReentrant
        returns (uint256 bid)
    {
        Listing storage L = listings[listingId];
        require(L.active, "inactive");

        uint32 nights = _daysBetween(startDay, endDay);
        require(nights <= MAX_NIGHTS, "too long");

        // 중복 체크
        for (uint32 d = startDay; d < endDay; d++) {
            require(bookedBy[listingId][d] == address(0), "date taken");
        }

        uint256 need6 = uint256(L.nightlyPrice6) * nights;

        // 정산 방식에 따라 처리
        if (L.payoutMode == PayoutMode.Escrow) {
            // Escrow: 컨트랙트로 예치
            USDC.safeTransferFrom(msg.sender, address(this), need6);
        } else {
            // Instant: 예약과 동시에 호스트로 송금 (비환불 권장)
            USDC.safeTransferFrom(msg.sender, L.host, need6);
        }

        // 슬롯 확정
        for (uint32 d = startDay; d < endDay; d++) {
            bookedBy[listingId][d] = msg.sender;
        }

        // 예약 생성
        uint64 checkInTs = _checkInTs(startDay);
        bid = ++nextBookingId;
        bookings[bid] = Booking({
            guest: msg.sender,
            startDay: startDay,
            endDay: endDay,
            totalPaid6: uint96(need6),
            settled: (L.payoutMode == PayoutMode.Instant), // 즉시 정산
            checkInTs: checkInTs
        });

        emit Booked(bid, listingId, msg.sender, startDay, endDay, uint96(need6), L.payoutMode);
    }

    // ====== Cancel / Settle ======

    /**
     * 게스트 취소:
     * - Escrow 모드에서만 허용. 취소 마감 시간(체크인 - cancelBeforeHours) 이전에만 가능.
     * - Instant 모드는 on-chain 환불이 불가(바로 호스트에게 전송되므로). 오프체인 조율 필요.
     */
    function cancelByGuest(uint256 listingId, uint256 bookingId) external nonReentrant {
        Listing  storage L = listings[listingId];
        Booking  storage B = bookings[bookingId];

        require(msg.sender == B.guest, "not guest");
        require(!B.settled, "settled");

        require(L.payoutMode == PayoutMode.Escrow, "non-refundable");

        // 취소 마감 시각 계산 (언더플로 방지)
        uint256 cancelWindow = uint256(L.cancelBeforeHours) * 1 hours;
        uint256 checkIn      = uint256(B.checkInTs);
        uint256 deadline     = (checkIn > cancelWindow) ? (checkIn - cancelWindow) : 0;
        require(block.timestamp <= deadline, "too late");

        // 슬롯 해제
        for (uint32 d = B.startDay; d < B.endDay; d++) {
            bookedBy[listingId][d] = address(0);
        }

        // 전액 게스트 환불(사용자 출금)
        B.settled = true;
        pendingUSDC6[B.guest] += uint256(B.totalPaid6);
        emit Cancelled(bookingId, B.totalPaid6, 0);
    }

    /**
     * Escrow 정산: 체크인 이후 호스트 수익 확정.
     * Instant 모드에서는 이미 정산됨.
     */
    function settleToHost(uint256 bookingId, uint256 listingId) external nonReentrant {
        Listing storage L = listings[listingId];
        Booking storage B = bookings[bookingId];

        require(msg.sender == L.host, "not host");
        require(!B.settled, "settled");
        require(L.payoutMode == PayoutMode.Escrow, "instant");
        require(block.timestamp >= B.checkInTs, "before check-in");

        B.settled = true;
        pendingUSDC6[L.host] += uint256(B.totalPaid6);
        emit Settled(bookingId, B.totalPaid6);
    }

    /**
     * 호스트 취소:
     * - Escrow 모드: 정산 전이라면 on-chain 전액 환불 처리
     * - Instant 모드: 이미 호스트가 수령했으므로 on-chain 환불 불가(오프체인 조율)
     */
    function cancelByHost(uint256 listingId, uint256 bookingId) external nonReentrant {
        Listing storage L = listings[listingId];
        Booking storage B = bookings[bookingId];

        require(msg.sender == L.host, "not host");
        require(!B.settled || L.payoutMode == PayoutMode.Instant, "settled");

        // 슬롯 해제
        for (uint32 d = B.startDay; d < B.endDay; d++) {
            bookedBy[listingId][d] = address(0);
        }

        if (L.payoutMode == PayoutMode.Escrow && !B.settled) {
            // Escrow: 게스트 전액 환불(출금 대기)
            B.settled = true;
            pendingUSDC6[B.guest] += uint256(B.totalPaid6);
            emit Cancelled(bookingId, B.totalPaid6, 0);
        } else {
            // Instant: 이미 호스트가 수령한 금액 → on-chain 환불 없음
            B.settled = true;
            emit Cancelled(bookingId, 0, 0);
        }
    }

    // ====== Withdraw (Escrow 정산/환불 대기 금액 출금) ======
    function withdrawUSDC() external nonReentrant {
        uint256 amt6 = pendingUSDC6[msg.sender];
        require(amt6 > 0, "no balance");
        pendingUSDC6[msg.sender] = 0;
        USDC.safeTransfer(msg.sender, amt6);
        emit WithdrawUSDC(msg.sender, amt6);
    }

    // ====== Views ======
    function isAvailable(uint256 listingId, uint32 day) external view returns (bool) {
        return bookedBy[listingId][day] == address(0);
    }

    function isRangeAvailable(uint256 listingId, uint32 startDay, uint32 endDay) external view returns (bool) {
        for (uint32 d = startDay; d < endDay; d++) {
            if (bookedBy[listingId][d] != address(0)) return false;
        }
        return true;
    }
}
