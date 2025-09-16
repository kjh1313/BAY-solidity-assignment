# StayBook · 숙소 예약 DApp

StayBook은 블록체인 기반으로 숙소를 등록하고 예약할 수 있는 간단한 DApp입니다.  
호스트는 숙소를 등록하고 게스트는 날짜를 선택해 예약할 수 있으며, 결제는 USDC(Sepolia 테스트넷)로 진행됩니다.  

### 🏠 호스트 페이지
- 숙소 등록 (1박 요금, 취소 가능 시간, 정산 방식 설정)
- 등록된 숙소 목록 확인
- 예약 현황 달력에서 예약일자 확인
- 예약 정산 및 출금 (에스크로 모드)

### 🧳 게스트 페이지
- 등록된 숙소 목록 확인
- 날짜 선택 후 예약 가능 여부 확인
- 숙소 예약 및 결제
- 내 예약 내역 불러오기 및 취소
- 예약 현황 달력에서 예약/가능 일자 확인


## 🚀 실행 방법

### 1. 클론 및 설치
```bash
git clone https://github.com/your-username/staybook.git
cd staybook/frontend
npm install

### 2. 개발서버 실행
```bash
npm run dev

