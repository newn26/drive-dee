import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Fuel, Gauge, Settings2, Star, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { LoadError } from "@/components/load-error";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { carImage } from "@/lib/car-images";
import { categoryLabel, daysBetween, fmtDate, thb, todayBkk } from "@/lib/format";
import { bookedCarIdsQuery, invalidateBookingData } from "@/lib/queries";
import { adjustEndForStart, rentalDateError } from "@/lib/date-range";
import { rentalCharges } from "@/lib/booking-fee";

export const Route = createFileRoute("/cars_/$id")({
  head: () => ({
    meta: [
      { title: "รายละเอียดรถเช่า — Drive Dee" },
      { name: "description", content: "ดูรายละเอียด รีวิว และจองรถเช่าออนไลน์" },
      { property: "og:title", content: "รายละเอียดรถเช่า — Drive Dee" },
      { property: "og:description", content: "ดูรายละเอียด รีวิว และจองรถเช่าออนไลน์" },
    ],
  }),
  component: CarDetail,
});

const branches = ["สาขากรุงเทพฯ (สุขุมวิท)", "สนามบินสุวรรณภูมิ", "สนามบินดอนเมือง", "สาขาเชียงใหม่", "สาขาภูเก็ต"];

function CarDetail() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [start, setStart] = useState(todayBkk(1));
  const [end, setEnd] = useState(todayBkk(3));
  const [loc, setLoc] = useState<string>(branches[0]!);
  const [busy, setBusy] = useState(false);

  const carQ = useQuery({
    queryKey: ["car", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("cars").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const car = carQ.data;
  const { data: reviews = [] } = useQuery({
    queryKey: ["reviews", id],
    queryFn: async () =>
      (await supabase.from("reviews").select("*").eq("car_id", id).order("created_at", { ascending: false })).data ?? [],
  });

  const dateError = rentalDateError(start, end, todayBkk());
  const datesValid = !dateError;
  const bookedQ = useQuery({ ...bookedCarIdsQuery(start, end), enabled: datesValid });
  // Fresh result for exactly these dates only; the database re-checks on insert anyway
  const checkingDates = datesValid && (bookedQ.isFetching || !bookedQ.data) && !bookedQ.isError;
  const bookedForDates = datesValid && !bookedQ.isFetching && !!bookedQ.data?.includes(id);

  if (carQ.isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-20 text-center" role="status">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="mt-4 text-muted-foreground">กำลังโหลดข้อมูลรถ...</p>
      </div>
    );
  }
  if (carQ.isError) {
    return (
      <LoadError title="โหลดข้อมูลรถไม่สำเร็จ" onRetry={() => void carQ.refetch()}>
        <Button variant="outline" asChild>
          <Link to="/cars">กลับสู่หน้ารถเช่า</Link>
        </Button>
      </LoadError>
    );
  }
  if (!car) {
    return (
      <LoadError title="ไม่พบรถคันนี้" message="รถคันนี้อาจถูกนำออกจากระบบแล้ว หรือลิงก์ไม่ถูกต้อง">
        <Button asChild>
          <Link to="/cars">เลือกดูรถคันอื่น</Link>
        </Button>
      </LoadError>
    );
  }
  const days = datesValid ? daysBetween(start, end) : 0;
  const charges = rentalCharges(car.price_per_day * days);
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;

  const book = async () => {
    if (!user) return navigate({ to: "/auth" });
    if (dateError || days <= 0) return toast.error(dateError ?? "กรุณาเลือกวันที่ให้ถูกต้อง");
    if (bookedForDates) return toast.error("รถคันนี้ไม่ว่างในช่วงวันที่เลือก");
    setBusy(true);
    const { data, error } = await supabase
      .from("bookings")
      .insert({ user_id: user.id, car_id: car.id, start_date: start, end_date: end, pickup_location: loc, days, total_amount: 0 })
      .select("id")
      .single();
    setBusy(false);
    if (error) {
      // Someone may have booked these dates first: refresh what this page believes
      void queryClient.invalidateQueries({ queryKey: ["booked"] });
      return toast.error(error.message || "ไม่สามารถสร้างการจองได้ กรุณาลองใหม่อีกครั้ง");
    }
    await invalidateBookingData(queryClient);
    toast.success("สร้างการจองแล้ว รอผู้ดูแลยืนยันและส่งฉบับร่างสัญญาให้คุณตรวจสอบ");
    navigate({ to: "/bookings/$id", params: { id: data.id } });
  };

  return (
    <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 lg:grid-cols-[1fr_380px]">
      <div className="space-y-8">
        <img src={carImage(car.image_url, car.category)} alt={car.model} width={1024} height={640} className="w-full rounded-3xl border bg-muted object-cover" />
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold">{car.brand} {car.model}</h1>
            <StatusBadge status={car.status} kind="car" />
          </div>
          <p className="mt-1 text-muted-foreground">{categoryLabel[car.category]} · ปี {car.year} · ทะเบียน {car.plate_no}</p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { i: Users, t: `${car.seats} ที่นั่ง` },
              { i: Settings2, t: car.transmission },
              { i: Fuel, t: car.fuel },
              { i: Gauge, t: `${car.mileage.toLocaleString("th-TH")} กม.` },
            ].map((x) => (
              <div key={x.t} className="flex items-center gap-2 rounded-xl border bg-card p-3 text-sm"><x.i className="h-4 w-4 text-primary" />{x.t}</div>
            ))}
          </div>
          <p className="mt-4 leading-relaxed">{car.description}</p>
        </div>
        <div>
          <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold">
            รีวิวจากลูกค้า <span className="flex items-center gap-1 text-base font-normal text-muted-foreground"><Star className="h-4 w-4 fill-accent text-accent" />{avg.toFixed(1)} ({reviews.length})</span>
          </h2>
          {reviews.length === 0 && <p className="text-sm text-muted-foreground">ยังไม่มีรีวิว</p>}
          <div className="space-y-3">
            {reviews.map((r) => (
              <div key={r.id} className="rounded-xl border bg-card p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{r.reviewer_name}</span>
                  <span className="text-xs text-muted-foreground">{fmtDate(r.created_at)}</span>
                </div>
                <div className="my-1 flex">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-4 w-4 ${i < r.rating ? "fill-accent text-accent" : "text-border"}`} />)}</div>
                <p className="text-sm">{r.comment}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <aside className="h-fit space-y-4 rounded-2xl border bg-card p-6 shadow-card lg:sticky lg:top-24">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-3xl font-semibold text-primary">{thb(car.price_per_day)}</span>
          <span className="text-sm text-muted-foreground">/ วัน</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>วันรับรถ</Label><Input type="date" min={todayBkk()} value={start} onChange={(e) => { setStart(e.target.value); setEnd((prev) => adjustEndForStart(e.target.value, prev)); }} /></div>
          <div><Label>วันคืนรถ</Label><Input type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        <div>
          <Label>สถานที่รับรถ</Label>
          <Select value={loc} onValueChange={setLoc}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1 rounded-xl bg-muted p-4 text-sm">
          <div className="flex justify-between"><span>{thb(car.price_per_day)} × {days} วัน</span><span>{thb(car.price_per_day * days)}</span></div>
          <div className="flex justify-between"><span>เงินประกัน (เท่ากับค่าเช่า)</span><span>{thb(charges.insurance)}</span></div>
          <div className="flex justify-between"><span>หักค่าจอง</span><span>−{thb(charges.fee)}</span></div>
          <div className="flex justify-between border-t pt-2 font-semibold"><span>ค่าจอง (ชำระหลังยืนยันสัญญา)</span><span>{thb(charges.fee)}</span></div>
          <div className="flex justify-between font-semibold"><span>ชำระ ณ วันรับรถ</span><span>{thb(charges.dueAtPickup)}</span></div>
          <p className="pt-1 text-xs text-muted-foreground">ค่าจองไม่คืนเมื่อยกเลิก · เงินประกันได้คืนเมื่อคืนรถ</p>
        </div>
        {dateError && (
          <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs" role="alert">
            {dateError}
          </p>
        )}
        {bookedForDates && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive" role="alert">
            รถคันนี้ไม่ว่างในช่วงวันที่เลือก กรุณาเลือกวันอื่น
          </p>
        )}
        {checkingDates && <p className="text-xs text-muted-foreground" role="status">กำลังตรวจสอบวันว่าง...</p>}
        <Button
          className="w-full"
          size="lg"
          disabled={busy || (!!user && !!dateError) || bookedForDates || car.status === "maintenance" || car.status === "unavailable"}
          onClick={book}
        >
          {user ? "จองรถคันนี้" : "เข้าสู่ระบบเพื่อจอง"}
        </Button>
        {!user && <p className="text-center text-xs text-muted-foreground">ยังไม่มีบัญชี? <Link to="/auth" className="text-primary underline">สมัครสมาชิก</Link></p>}
      </aside>
    </div>
  );
}
