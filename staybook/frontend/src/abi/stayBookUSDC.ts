const ABI = [
  // host
  "function createListing(uint96 nightlyPrice6, uint32 cancelBeforeHours, uint8 payoutMode) returns (uint256)",
  "function updateListing(uint256 listingId, uint96 nightlyPrice6, uint32 cancelBeforeHours, bool active, uint8 payoutMode)",
  "function setActive(uint256 listingId, bool active)",
  // guest
  "function bookUSDC(uint256 listingId, uint32 startDay, uint32 endDay) returns (uint256)",
  "function cancelByGuest(uint256 listingId, uint256 bookingId)",
  // host settle
  "function settleToHost(uint256 bookingId, uint256 listingId)",
  // withdraw (escrow/refund)
  "function withdrawUSDC()",
  // views
  "function isRangeAvailable(uint256 listingId, uint32 startDay, uint32 endDay) view returns (bool)",
  "function pendingUSDC6(address) view returns (uint256)",
  "function nextListingId() view returns (uint256)",
  "function listings(uint256) view returns (address host,uint96 nightlyPrice6,uint32 cancelBeforeHours,bool active,uint8 payoutMode)"

];
export default ABI;
