// Shared by server and client code, so it must not import anything Node-only.

// Payout item and refund states that PayPal can still change.
export const PENDING_STATUSES = ["PENDING", "ONHOLD", "NEW", "PROCESSING", "UNCLAIMED"];

export const isSettled = (status: string) => status === "SUCCESS" || status === "COMPLETED";
