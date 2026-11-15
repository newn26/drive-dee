/**
 * Thai / English switch for the whole site (customer and admin pages).
 *
 * Text is written as pairs next to where it is used: `tr("ไทย", "English")`. Thai is the
 * default (and what the server renders); the visitor's choice is kept in localStorage.
 * When the language changes, the page below the provider is
 * remounted so every `tr()` call and date/money formatter picks up the new language.
 *
 * The contract text itself is rendered by the database and stays Thai (it is the signed
 * document). Database error messages are translated with `trError()` where they are shown.
 */
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

type LanguageContext = {
  /** Language currently shown. */
  lang: Lang;
  /** The visitor's choice (same as lang). */
  chosen: Lang;
  setLang: (lang: Lang) => void;
  /** Whether the switch is shown (always, now that the admin pages are translated too). */
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
  const switchable = true;
  const lang: Lang = chosen;

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
  // Admin side
  [
    /^ส่งมอบรถหรือรับรถคืนได้ตั้งแต่วันรับรถ \((.+)\) เป็นต้นไป$/,
    (m) => `Hand-over and return are possible from the pickup day (${m[1]}) onwards.`,
  ],
  [/^ไม่มีสิทธิ์ดำเนินการนี้ \((.+)\)$/, (m) => `You do not have permission to do this (${m[1]}).`],
  [/^การจองนี้มีสัญญาอยู่แล้ว$/, "This booking already has a contract."],
  [
    /^การจองนี้ไม่อยู่ในขั้นตอนทำสัญญา \(สถานะ: (.+)\)$/,
    (m) => `This booking is not at the contract stage (status: ${m[1]}).`,
  ],
  [/^ส่งได้เฉพาะสัญญาฉบับร่าง$/, "Only a draft contract can be sent."],
  [/^ไม่พบฉบับร่างที่จะส่ง$/, "No draft to send."],
  [
    /^ฉบับร่างนี้ถูกส่งให้ลูกค้าแล้ว กรุณาสร้างฉบับใหม่$/,
    "This draft was already sent. Please create a new version.",
  ],
  [
    /^สัญญาฉบับที่ส่งให้ลูกค้าแล้วแก้ไขไม่ได้ กรุณาสร้างฉบับใหม่$/,
    "A sent contract version cannot be edited. Please create a new version.",
  ],
  [
    /^สัญญาที่ชำระเงิน(แล้ว)?หรือยกเลิกแล้วแก้ไข(ข้อความ)?ไม่ได้$/,
    "A paid or cancelled contract cannot be edited.",
  ],
  [/^สัญญานี้ไม่มีคำขอแก้ไขจากลูกค้า$/, "This contract has no change request from the customer."],
  [/^ชื่อไม่ตรงกับที่ลูกค้าขอแก้ไข$/, "The name does not match the customer's request."],
  [/^ชื่อลูกค้าไม่ถูกต้อง$/, "Invalid customer name."],
  [
    /^ลูกค้ายังไม่ได้กรอกเลขใบอนุญาตขับขี่$/,
    "The customer has not entered a driving licence number.",
  ],
  [/^โปรไฟล์ลูกค้ายังไม่มีชื่อ-นามสกุล$/, "The customer's profile has no full name."],
  [/^กรุณาระบุวันและเวลารับ-คืนรถ$/, "Please enter the pickup and return date and time."],
  [
    /^(วันรับรถ|วันคืนรถ)ต้องตรงกับวันที่จอง \((.+)\)$/,
    (m) =>
      `The ${m[1] === "วันรับรถ" ? "pickup" : "return"} date must match the booking (${m[2]}).`,
  ],
  [/^เวลาคืนรถต้องหลังเวลารับรถ$/, "The return time must be after the pickup time."],
  [/^กรุณาระบุข้อกำหนดระยะทาง$/, "Please enter the mileage terms."],
  [/^กรุณาระบุค่าปรับส่งคืนล่าช้า$/, "Please enter the late return penalty."],
  [/^เงินประกันต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป$/, "The deposit must be a number of 0 or more."],
  [
    /^อนุมัติได้เฉพาะสัญญาที่ลูกค้ายอมรับแล้ว$/,
    "Only a contract the customer has confirmed can be approved.",
  ],
  [
    /^ขอแก้ไขได้เฉพาะสัญญาที่รอผู้ดูแลตรวจสอบ$/,
    "Changes can only be requested while the contract waits for staff review.",
  ],
  [
    /^ยืนยันด้วยตนเองได้เฉพาะการจองที่รอดำเนินการ$/,
    "Only a pending booking can be confirmed manually.",
  ],
  [/^อีเมลไม่ถูกต้อง$/, "Invalid email."],
  [/^อีเมลนี้เป็นผู้ดูแลระบบอยู่แล้ว$/, "This email is already an admin."],
  [/^กรุณาเลือกสิทธิ์อย่างน้อย 1 รายการ$/, "Please choose at least one permission."],
  [/^มีสิทธิ์ที่ไม่รู้จัก$/, "Unknown permission."],
  [/^ไม่พบผู้ดูแลระบบ$/, "Admin not found."],
  [/^เปลี่ยนสถานะบัญชีของตนเองไม่ได้$/, "You cannot change your own status."],
  [/^บัญชีสาธิตเป็นผู้ดูแลระบบไม่ได้$/, "A demo account cannot be an admin."],
  [
    /^เปลี่ยนสถานะ(สัญญา)?จาก (.+) เป็น (.+) ไม่ได้$/,
    (m) => `Cannot change the status from ${m[2]} to ${m[3]}.`,
  ],
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
