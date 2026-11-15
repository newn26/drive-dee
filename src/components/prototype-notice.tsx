import { TriangleAlert } from "lucide-react";
import { tr } from "@/lib/i18n";

/** Thai notice shown to every visitor on every page (and on printouts): this is a demo system. */
export const PROTOTYPE_NOTICE_TEXT =
  "เว็บไซต์นี้เป็นระบบต้นแบบเพื่อการสาธิต (Prototype) ไม่มีการชำระเงินจริง — กรุณาอย่ากรอกข้อมูลส่วนตัวจริง เช่น เลขบัตรประชาชน เลขใบขับขี่ เบอร์โทร หรือข้อมูลบัตรเครดิตจริง";

export const PROTOTYPE_NOTICE_TEXT_EN =
  "This website is a demo prototype. No real payments are made. Please do not enter real personal data such as ID card, driving licence, phone or credit card numbers.";

export function PrototypeNotice() {
  return (
    <div role="note" aria-label={tr("ประกาศระบบต้นแบบ", "Prototype notice")} className="border-b border-amber-300 bg-amber-50 text-amber-900">
      <p className="mx-auto flex max-w-7xl items-start gap-2 px-4 py-2 text-xs leading-relaxed sm:items-center">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 sm:mt-0" aria-hidden="true" />
        <span>
          <strong className="font-semibold">{tr("ระบบต้นแบบ (DEMO):", "Prototype (DEMO):")}</strong>{" "}
          {tr(PROTOTYPE_NOTICE_TEXT, PROTOTYPE_NOTICE_TEXT_EN)}
        </span>
      </p>
    </div>
  );
}
