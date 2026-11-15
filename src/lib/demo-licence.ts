/**
 * Fake driving licence number for a demo account ("DEMO-" + 8 digits), so a demo customer can
 * book (bookings need a licence) without ever typing real data. One digit per random byte.
 */
export function demoLicenceNo(bytes: Uint8Array): string {
  const digits = Array.from({ length: 8 }, (_, i) => (bytes[i] ?? 0) % 10).join("");
  return `DEMO-${digits}`;
}
