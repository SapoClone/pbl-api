/** A subscription that ends within this many days is "expiring soon" (the design's amber badge) */
export const EXPIRING_SOON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function expiryOf(expiresAt: Date | null, now = new Date()) {
  if (!expiresAt) return { isExpiringSoon: false, daysLeft: null };
  const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS);
  return {
    isExpiringSoon: daysLeft <= EXPIRING_SOON_DAYS,
    daysLeft,
  };
}

/** Fallback of the platform setting `billing.graceDays` (D31): days a paid plan keeps its limits after it ended */
export const GRACE_DAYS = 7;
