/** Thai vowels written before the consonant they follow in speech (เ แ โ ใ ไ). */
const LEADING_THAI_VOWELS = /^[เ-ไ]+/;
const DEMO_PREFIX = "[DEMO]";
const MAX_LENGTH = 40;

/**
 * Public name shown on a review: first name plus the initial of the last name
 * ("สมชาย มั่นคง" → "สมชาย ม.", "John Smith" → "John S."). Reviews are readable by
 * everyone, so the full sign-up name is never stored there. The Demo Customer
 * "[DEMO]" prefix is kept so demo reviews stay clearly labelled.
 */
export function reviewerDisplayName(fullName: string | null | undefined): string {
  let name = (fullName ?? "").replace(/\s+/g, " ").trim();
  const isDemo = name.startsWith(DEMO_PREFIX);
  if (isDemo) name = name.slice(DEMO_PREFIX.length).trim();

  const parts = name.split(" ").filter(Boolean);
  let display = "ลูกค้า";
  if (parts.length === 1) display = parts[0]!;
  if (parts.length > 1) {
    const last = parts[parts.length - 1]!.replace(LEADING_THAI_VOWELS, "");
    const initial = Array.from(last)[0]?.toLocaleUpperCase() ?? "";
    display = initial ? `${parts[0]} ${initial}.` : parts[0]!;
  }

  const result = isDemo ? `${DEMO_PREFIX} ${display}` : display;
  return Array.from(result).slice(0, MAX_LENGTH).join("");
}
