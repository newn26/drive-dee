import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Fuel, Gauge, Settings2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { LoadError } from "@/components/load-error";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { carImage, isStockCarImage } from "@/lib/car-images";
import { carSpecLabel, categoryLabel, daysBetween, fmtDate, pickupLocationLabel, thb, todayBkk } from "@/lib/format";
import { bookedCarIdsQuery, invalidateBookingData } from "@/lib/queries";
import { adjustEndForStart, rentalDateError } from "@/lib/date-range";
import { rentalCharges } from "@/lib/booking-fee";
import { missingBookingDocuments } from "@/lib/profile-validation";
import { intlLocale, tr, trError } from "@/lib/i18n";

export const Route = createFileRoute("/cars_/$id")({
  head: () => ({
    meta: [
      { title: "รายละเอียดรถเช่า — Drive Dee" },
      { name: "description", content: "ดูรายละเอียดและจองรถเช่าออนไลน์" },
      { property: "og:title", content: "รายละเอียดรถเช่า — Drive Dee" },
      { property: "og:description", content: "ดูรายละเอียดและจองรถเช่าออนไลน์" },
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
  // Booking needs an ID card / passport and a driver's licence in the profile (the DB checks too)
  const profileQ = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
  const missingDocs = user && profileQ.isSuccess ? missingBookingDocuments(profileQ.data) : [];

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
        <p className="mt-4 text-muted-foreground">{tr("กำลังโหลดข้อมูลรถ...", "Loading car details...")}</p>
      </div>
    );
  }
  if (carQ.isError) {
    return (
      <LoadError title={tr("โหลดข้อมูลรถไม่สำเร็จ", "Could not load the car")} onRetry={() => void carQ.refetch()}>
        <Button variant="outline" asChild>
          <Link to="/cars">{tr("กลับสู่หน้ารถเช่า", "Back to cars")}</Link>
        </Button>
      </LoadError>
    );
  }
  if (!car) {
    return (
      <LoadError title={tr("ไม่พบรถคันนี้", "Car not found")} message={tr("รถคันนี้อาจถูกนำออกจากระบบแล้ว หรือลิงก์ไม่ถูกต้อง", "This car may have been removed, or the link is wrong.")}>
        <Button asChild>
          <Link to="/cars">{tr("เลือกดูรถคันอื่น", "Browse other cars")}</Link>
        </Button>
      </LoadError>
    );
  }
  const days = datesValid ? daysBetween(start, end) : 0;
  const charges = rentalCharges(car.price_per_day * days);

  const book = async () => {
    if (!user) return navigate({ to: "/auth" });
    if (dateError || days <= 0) return toast.error(dateError ?? tr("กรุณาเลือกวันที่ให้ถูกต้อง", "Please choose valid dates"));
    if (bookedForDates) return toast.error(tr("รถคันนี้ไม่ว่างในช่วงวันที่เลือก", "This car is not available for the selected dates"));
    if (missingDocs.length)
      return toast.error(
        tr(
          `กรุณากรอก${missingDocs.join(" และ ")}ในหน้าโปรไฟล์ก่อนจองรถ`,
          `Please add your ${missingDocs.join(" and ")} to your profile before booking`,
        ),
      );
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
      return toast.error(trError(error.message) || tr("ไม่สามารถสร้างการจองได้ กรุณาลองใหม่อีกครั้ง", "Could not create the booking. Please try again."));
    }
    await invalidateBookingData(queryClient);
    toast.success(tr("สร้างการจองแล้ว รอผู้ดูแลยืนยันและส่งฉบับร่างสัญญาให้คุณตรวจสอบ", "Booking created. Staff will prepare the contract and send it to you for review."));
    navigate({ to: "/bookings/$id", params: { id: data.id } });
  };

  return (
    <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 lg:grid-cols-[1fr_380px]">
      <div className="space-y-8">
        <div className="relative">
          <img src={carImage(car.image_url, car.category)} alt={car.model} width={1024} height={640} className="w-full rounded-3xl border bg-muted object-cover" />
          {isStockCarImage(car.image_url) && (
            <span className="absolute bottom-3 right-3 rounded-full bg-background/85 px-2.5 py-1 text-xs text-muted-foreground" data-testid="stock-photo">
              {tr("ภาพประกอบตามประเภทรถ ไม่ใช่รถคันจริง", "Stock photo for this category, not the actual car")}
            </span>
          )}
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold">{car.brand} {car.model}</h1>
            <StatusBadge status={car.status} kind="car" />
          </div>
          <p className="mt-1 text-muted-foreground">{categoryLabel[car.category]} {tr("· ปี", "· Year")} {car.year} {tr("· ทะเบียน", "· Plate")} {car.plate_no}</p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { i: Users, t: tr(`${car.seats} ที่นั่ง`, `${car.seats} seats`) },
              { i: Settings2, t: carSpecLabel(car.transmission) },
              { i: Fuel, t: carSpecLabel(car.fuel) },
              { i: Gauge, t: `${car.mileage.toLocaleString(intlLocale())} ${tr("กม.", "km")}` },
            ].map((x) => (
              <div key={x.t} className="flex items-center gap-2 rounded-xl border bg-card p-3 text-sm"><x.i className="h-4 w-4 text-primary" />{x.t}</div>
            ))}
          </div>
          <p className="mt-4 leading-relaxed">{car.description}</p>
        </div>
      </div>

      <aside className="h-fit space-y-4 rounded-2xl border bg-card p-6 shadow-card lg:sticky lg:top-24">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-3xl font-semibold text-primary">{thb(car.price_per_day)}</span>
          <span className="text-sm text-muted-foreground">{tr("/ วัน", "/ day")}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>{tr("วันรับรถ", "Pickup date")}</Label><Input type="date" min={todayBkk()} value={start} onChange={(e) => { setStart(e.target.value); setEnd((prev) => adjustEndForStart(e.target.value, prev)); }} /></div>
          <div><Label>{tr("วันคืนรถ", "Return date")}</Label><Input type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        <div>
          <Label>{tr("สถานที่รับรถ", "Pickup location")}</Label>
          <Select value={loc} onValueChange={setLoc}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{branches.map((b) => <SelectItem key={b} value={b}>{pickupLocationLabel(b)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1 rounded-xl bg-muted p-4 text-sm">
          <div className="flex justify-between"><span>{thb(car.price_per_day)} × {days} {tr("วัน", "days")}</span><span>{thb(car.price_per_day * days)}</span></div>
          <div className="flex justify-between"><span>{tr("เงินประกัน (เท่ากับค่าเช่า)", "Deposit (equal to the rent)")}</span><span>{thb(charges.insurance)}</span></div>
          <div className="flex justify-between border-t pt-2 font-semibold" data-testid="fee-online"><span>{tr("1. ค่าจอง ชำระออนไลน์หลังยืนยันสัญญา", "1. Booking fee, paid online after you confirm the contract")}</span><span>{thb(charges.fee)}</span></div>
          <div className="flex justify-between font-semibold" data-testid="due-at-pickup"><span>{tr("2. ชำระ ณ วันรับรถ", "2. Paid on the pickup day")}</span><span>{thb(charges.dueAtPickup)}</span></div>
          <p className="text-xs text-muted-foreground">{tr("ยอดวันรับรถ = ค่าเช่า + เงินประกัน − ค่าจองที่จ่ายไปแล้ว", "Pickup amount = rent + deposit − booking fee already paid")}</p>
          <p className="pt-1 text-xs text-muted-foreground">{tr("ค่าจองไม่คืนเมื่อยกเลิก · เงินประกันได้คืนเมื่อคืนรถ", "The booking fee is non-refundable · the deposit is returned when you return the car")}</p>
        </div>
        {dateError && (
          <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs" role="alert">
            {dateError}
          </p>
        )}
        {bookedForDates && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive" role="alert">
            {tr("รถคันนี้ไม่ว่างในช่วงวันที่เลือก กรุณาเลือกวันอื่น", "This car is not available for the selected dates. Please choose other dates.")}
          </p>
        )}
        {missingDocs.length > 0 && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs" role="alert" data-testid="missing-docs">
            {tr("ต้องมีเลขบัตรประชาชน (หรือพาสปอร์ต) และเลขใบอนุญาตขับขี่จึงจะจองรถได้ ยังขาด:", "You need an ID card (or passport) number and a driving licence number to book. Missing:")} {missingDocs.join(", ")}{" "}
            <Link to="/profile" className="font-medium text-primary underline">{tr("กรอกข้อมูลในโปรไฟล์", "Add them to your profile")}</Link>
          </div>
        )}
        {checkingDates && <p className="text-xs text-muted-foreground" role="status">{tr("กำลังตรวจสอบวันว่าง...", "Checking availability...")}</p>}
        <Button
          className="w-full"
          size="lg"
          disabled={busy || (!!user && !!dateError) || missingDocs.length > 0 || bookedForDates || car.status === "maintenance" || car.status === "unavailable"}
          onClick={book}
        >
          {user ? tr("จองรถคันนี้", "Book this car") : tr("เข้าสู่ระบบเพื่อจอง", "Sign in to book")}
        </Button>
        {!user && <p className="text-center text-xs text-muted-foreground">{tr("ยังไม่มีบัญชี?", "No account yet?")} <Link to="/auth" className="text-primary underline">{tr("สมัครสมาชิก", "Sign up")}</Link></p>}
      </aside>
    </div>
  );
}
