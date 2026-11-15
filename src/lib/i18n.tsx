/**
 * Thai / English switch for the customer pages.
 *
 * Text is written as pairs next to where it is used: `tr("ไทย", "English")`. Thai is the
 * default (and what the server renders); the visitor's choice is kept in localStorage.
 * Admin pages always stay Thai. When the language changes, the page below the provider is
 * remounted so every `tr()` call and date/money formatter picks up the new language.
 *
 * The contract text itself is rendered by the database and stays Thai (it is the signed
 * document). Database error messages are translated with `trError()` where customers see them.
 */
import { useRouterState } from "@tanstack/react-router";
import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "th" | "en";

const STORAGE_KEY = "drive-dee-lang";

let current: Lang = "th";

/** The language being rendered right now. */
export const getLang = (): Lang => current;

/** Thai or English text for the current language. */
export const tr = (th: string, en: string): string => (current === "en" ? en : th);

/** Locale for Intl date and number formatting. */
export const intlLocale = (): string => (current === "en" ? "en-GB" : "th-TH");

/** A label map whose values follow the current language (keeps Record<string, string> use). */
export function bilingual<K extends string>(
  pairs: Record<K, [th: string, en: string]>,
): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of Object.keys(pairs) as K[]) {
    Object.defineProperty(out, key, {
      enumerable: true,
      get: () => tr(pairs[key][0], pairs[key][1]),
    });
  }
  return out;
}

/** Paths that always stay Thai (the admin side). */
export const isThaiOnlyPath = (pathname: string): boolean =>
  /^\/(admin|admin-invite|demo-admin)(\/|$)/.test(pathname);

type LanguageContext = {
  /** Language currently shown (Thai on admin pages whatever the choice). */
  lang: Lang;
  /** The visitor's choice. */
  chosen: Lang;
  setLang: (lang: Lang) => void;
  /** False on admin pages, where the switch is hidden. */
  switchable: boolean;
};

const Ctx = createContext<LanguageContext>({
  lang: "th",
  chosen: "th",
  setLang: () => {},
  switchable: true,
});

export const useLanguage = () => useContext(Ctx);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [chosen, setChosen] = useState<Lang>("th");
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const switchable = !isThaiOnlyPath(pathname);
  const lang: Lang = switchable ? chosen : "th";

  // The server always renders Thai; read the saved choice only in the browser, after mount
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "en") setChosen("en");
    } catch {
      // storage blocked: stay Thai
    }
  }, []);

  // Set before the children render so their tr() calls see it
  current = lang;

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (next: Lang) => {
    setChosen(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage blocked: the choice lasts for this visit only
    }
  };

  return (
    <Ctx.Provider value={{ lang, chosen, setLang, switchable }}>
      <Fragment key={lang}>{children}</Fragment>
    </Ctx.Provider>
  );
}

/**
 * English for the Thai error messages the database raises on customer actions.
 * Unknown messages are returned unchanged.
 */
const DB_ERRORS: [RegExp, string | ((m: RegExpExecArray) => string)][] = [
  [
    /^กรุณากรอกเลขบัตรประชาชน \(หรือพาสปอร์ต\) และเลขใบอนุญาตขับขี่ในหน้าโปรไฟล์ก่อนจองรถ$/,
    "Please add your ID card (or passport) number and driving licence number to your profile before booking.",
  ],
  [/^วันคืนรถต้องไม่ก่อนวันรับรถ$/, "The return date cannot be before the pickup date."],
  [/^ไม่สามารถจองย้อนหลังได้$/, "You cannot book a date in the past."],
  [/^รถคันนี้ไม่พร้อมให้เช่า$/, "This car is not available for rent."],
  [/^รถคันนี้ถูกจองในช่วงวันที่เลือกแล้ว$/, "This car is already booked for the selected dates."],
  [/^ไม่มีสิทธิ์แก้ไขการจองนี้$/, "You do not have permission to change this booking."],
  [/^ไม่มีสิทธิ์เปลี่ยนสถานะ$/, "You do not have permission to change the status."],
  [/^กรุณาเข้าสู่ระบบ$/, "Please sign in."],
  [
    /^กรุณาระบุเหตุผลอย่างน้อย (\d+) ตัวอักษร$/,
    (m) => `Please give a reason of at least ${m[1]} characters.`,
  ],
  [/^ไม่พบสัญญา$/, "Contract not found."],
  [/^ไม่พบการจอง(นี้)?$/, "Booking not found."],
  [
    /^ขอแก้ไขได้เฉพาะสัญญาที่รอลูกค้าตรวจสอบ$/,
    "You can only ask for changes while the contract is waiting for your review.",
  ],
  [
    /^ฉบับสัญญาไม่ใช่ฉบับล่าสุด กรุณาโหลดหน้าใหม่$/,
    "This is not the latest contract version. Please reload the page.",
  ],
  [
    /^ขอแก้ไขสัญญาได้สูงสุด (\d+) ครั้งต่อการจอง/,
    (m) =>
      `You can ask for changes at most ${m[1]} times per booking. Please confirm the contract or cancel the booking.`,
  ],
  [
    /^ยังไม่ได้แก้ไขข้อมูลใด/,
    "Nothing has changed. Change the name or a time before sending the request.",
  ],
  [
    /^ชำระยอดวันรับรถได้เมื่อผู้ดูแลยืนยันว่าคุณมารับรถแล้วเท่านั้น$/,
    "You can pay the pickup amount only after staff confirm you have picked up the car.",
  ],
  [/^การจองนี้ไม่มียอดวันรับรถให้ชำระออนไลน์$/, "This booking has no pickup amount to pay online."],
  [/^ชำระยอดวันรับรถแล้ว$/, "The pickup amount has already been paid."],
  [/^ข้อมูลบัตรไม่ถูกต้อง$/, "Invalid card details."],
  [/^เบอร์โทรศัพท์ไม่ถูกต้อง/, "Invalid phone number (9-10 digits starting with 0)."],
  [
    /^เลขบัตรประชาชน \(13 หลัก\) หรือเลขพาสปอร์ตไม่ถูกต้อง$/,
    "Invalid ID card number (13 digits) or passport number.",
  ],
  [/^กรุณากรอกหมายเลขใบอนุญาตขับขี่$/, "Please enter your driving licence number."],
  [/^หมายเลขใบอนุญาตขับขี่ไม่ถูกต้อง/, "Invalid driving licence number (6-20 letters or digits)."],
  [/^รถคันนี้ถูกจองซ้อนในช่วงวันที่นี้แล้ว$/, "This car is already booked for these dates."],
  [/^การจองนี้ชำระเงินแล้ว$/, "This booking has already been paid."],
  [/^การจองนี้ชำระเงินแล้วหรือถูกยกเลิก$/, "This booking has already been paid or cancelled."],
  [/^การจองนี้หมดเวลาแล้ว กรุณาจองใหม่$/, "This booking has expired. Please book again."],
  [/^หมดเวลาชำระเงิน กรุณาจองใหม่อีกครั้ง$/, "The payment time is up. Please book again."],
  [
    /^ยังชำระเงินไม่ได้ กรุณายืนยันสัญญาก่อน$/,
    "You cannot pay yet. Please confirm the contract first.",
  ],
  [
    /^ยังชำระเงินไม่ได้ ต้องรอผู้ดูแลอนุมัติสัญญาก่อน$/,
    "You cannot pay yet. The contract is waiting for staff approval.",
  ],
  [
    /^ชำระยอดวันรับรถได้หลังชำระค่าจองแล้วเท่านั้น$/,
    "You can pay the pickup amount only after the booking fee.",
  ],
  [
    /^ฉบับสัญญาที่(ยอมรับ|ยืนยัน)ไม่ใช่ฉบับล่าสุด กรุณาโหลดหน้าใหม่$/,
    "The contract version you confirmed is not the latest. Please reload the page.",
  ],
  [/^ฉบับสัญญาไม่ใช่ฉบับล่าสุด$/, "This is not the latest contract version."],
  [/^ฉบับสัญญานี้ถูกแทนที่แล้ว$/, "This contract version has been replaced."],
  [
    /^สัญญานี้ไม่อยู่ในสถานะรอลูกค้า(ยอมรับ|ยืนยัน)$/,
    "This contract is not waiting for your confirmation.",
  ],
  [/^ไม่สามารถ(ยอมรับ|ยืนยัน)สัญญาฉบับนี้ได้$/, "This contract version cannot be confirmed."],
  [/^สัญญาฉบับปัจจุบันยังไม่ได้รับการ/, "The current contract version has not been confirmed yet."],
  [
    /^ยืนยันการจองได้หลังผู้ดูแลอนุมัติสัญญาและลูกค้าชำระเงินแล้วเท่านั้น$/,
    "A booking is confirmed only after the contract is confirmed and paid.",
  ],
];

export function trError(message: string | null | undefined): string {
  const msg = (message ?? "").trim();
  if (current !== "en" || !msg) return msg;
  for (const [re, en] of DB_ERRORS) {
    const m = re.exec(msg);
    if (m) return typeof en === "string" ? en : en(m);
  }
  return msg;
}
