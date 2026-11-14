import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CalendarCheck, CreditCard, QrCode, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CarCard } from "@/components/car-card";
import { carsQuery, ratingsQuery } from "@/lib/queries";
import { todayBkk } from "@/lib/format";
import { adjustEndForStart, rentalDateError } from "@/lib/date-range";
import { LoadError } from "@/components/load-error";
import heroImg from "@/assets/car-sedan.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Drive Dee (ไดร์ฟดี รถเช่า) — Siam Wheels Rental Hub | Car Rental Management System" },
      { name: "description", content: "ค้นหาและจองรถเช่าออนไลน์ ชำระผ่าน QR Code หรือบัตรเครดิต ราคาเป็นเงินบาท" },
      { property: "og:title", content: "Drive Dee (ไดร์ฟดี รถเช่า) — Siam Wheels Rental Hub" },
      { property: "og:description", content: "ค้นหาและจองรถเช่าออนไลน์ ชำระผ่าน QR Code หรือบัตรเครดิต" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const [start, setStart] = useState(todayBkk(1));
  const [end, setEnd] = useState(todayBkk(3));
  const [dateError, setDateError] = useState<string | null>(null);
  const carsQ = useQuery(carsQuery());
  const cars = carsQ.data;
  const featured = cars?.filter((c) => c.status === "available").slice(0, 4) ?? [];
  const { data: ratings } = useQuery(ratingsQuery());

  return (
    <div>
      <section className="bg-hero text-ink-foreground">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
          <div className="space-y-6">
            <span className="inline-block rounded-full bg-accent/20 px-3 py-1 text-sm text-accent">เช่ารถง่าย ทั่วไทย</span>
            <h1 className="text-4xl font-bold leading-tight md:text-5xl">ออกเดินทางได้ทันที<br />กับรถที่ใช่สำหรับคุณ</h1>
            <p className="max-w-md text-ink-foreground/75">เลือกรถ จองออนไลน์ ชำระผ่าน QR Code หรือบัตรเครดิต รับสัญญาเช่าแบบดิจิทัลทันที ถ้ารีบมานักก็โปรดสั่งจองไวๆนะจ๊ะ!!!!</p>
            <form
              className="grid gap-3 rounded-2xl bg-card p-4 text-card-foreground shadow-lift sm:grid-cols-[1fr_1fr_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                const err = rentalDateError(start, end, todayBkk());
                setDateError(err);
                if (err) return;
                navigate({ to: "/cars", search: { start, end } });
              }}
            >
              <label className="text-xs text-muted-foreground">วันรับรถ
                <Input type="date" min={todayBkk()} value={start} onChange={(e) => {
                    setStart(e.target.value);
                    setEnd((prev) => adjustEndForStart(e.target.value, prev));
                    setDateError(null);
                  }} />
              </label>
              <label className="text-xs text-muted-foreground">วันคืนรถ
                <Input type="date" min={start} value={end} onChange={(e) => {
                    setEnd(e.target.value);
                    setDateError(null);
                  }} />
              </label>
              <Button type="submit" size="lg" className="self-end">ค้นหารถว่าง</Button>
              {dateError && (
                <p role="alert" className="text-sm text-destructive sm:col-span-3">
                  {dateError}
                </p>
              )}
            </form>
          </div>
          <img src={heroImg} alt="รถเช่า" width={1024} height={640} className="rounded-3xl shadow-lift" />
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: CalendarCheck, t: "จองออนไลน์ 24 ชม.", d: "เช็ครถว่างและจองได้ทันที" },
          { icon: QrCode, t: "ชำระด้วย QR Code", d: "พร้อมเพย์ สะดวก รวดเร็ว" },
          { icon: CreditCard, t: "บัตรเครดิต/เดบิต", d: "รองรับ Visa, Mastercard" },
          { icon: ShieldCheck, t: "สัญญาเช่าดิจิทัล", d: "ตรวจสอบได้ทุกเมื่อ" },
        ].map((f) => (
          <div key={f.t} className="rounded-2xl border bg-card p-5 shadow-card">
            <f.icon className="mb-3 h-6 w-6 text-primary" />
            <h3 className="font-semibold">{f.t}</h3>
            <p className="text-sm text-muted-foreground">{f.d}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="text-2xl font-semibold">รถแนะนำ</h2>
          <Link to="/cars" className="text-sm font-medium text-primary hover:underline">ดูทั้งหมด →</Link>
        </div>
        {carsQ.isLoading ? (
          <p role="status" className="py-10 text-center text-sm text-muted-foreground">กำลังโหลดรถแนะนำ...</p>
        ) : carsQ.isError ? (
          <LoadError title="โหลดรายการรถไม่สำเร็จ" onRetry={() => void carsQ.refetch()} />
        ) : featured.length === 0 ? (
          <p className="rounded-2xl border bg-card py-10 text-center text-sm text-muted-foreground">
            ขณะนี้ยังไม่มีรถว่างให้แนะนำ กรุณาลองใหม่ภายหลัง
          </p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((c) => (
              <CarCard key={c.id} car={c} rating={ratings?.[c.id]} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
