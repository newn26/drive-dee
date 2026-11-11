/**
 * Demo payment helpers. Payments in this prototype are simulated: no money moves and
 * only the last 4 card digits are stored (by pay_booking in the database).
 */

/** Test card shown on the payment page. Never a real card. */
export const DEMO_CARD = {
  name: "DEMO CUSTOMER",
  number: "4242 4242 4242 4242",
  expiry: "12/30",
  cvv: "123",
} as const;

/** Test card that is always declined, to demo a failed payment. */
export const DEMO_DECLINED_CARD = {
  name: "DEMO DECLINED",
  number: "4000 0000 0000 0002",
  expiry: "12/30",
  cvv: "123",
} as const;

/** Demo rule: any card number ending in 0002 is declined (the database is never called). */
export function isDemoDeclinedCard(cardNumber: string): boolean {
  return cardNumber.replace(/\D/g, "").endsWith("0002");
}

/**
 * QR content for the demo. Deliberately NOT a PromptPay/EMVCo payload or payment link,
 * so a real banking app cannot turn a scan into a transfer.
 */
export function demoQrValue(bookingCode: string, amount: number): string {
  return `SIAM-WHEELS-DEMO|NOT-A-PAYMENT|${bookingCode}|${amount}`;
}

/** True when "MM/YY" is a real month that has not passed yet (`now` for tests). */
export function isValidCardExpiry(expiry: string, now: Date = new Date()): boolean {
  const m = /^(\d{2})\/(\d{2})$/.exec(expiry);
  if (!m) return false;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return false;
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;
  return year > thisYear || (year === thisYear && month >= thisMonth);
}
