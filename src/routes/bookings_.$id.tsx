import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  FileCheck2,
  FileText,
  MapPin,
  Printer,
  QrCode,
  ShieldCheck,
  AlertCircle,
  ArrowLeft,
  Car as CarIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/status-badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { carImage } from "@/lib/car-images";
import { categoryLabel, fmtDate, fmtDateTime, thb } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";
import { invalidateBookingData } from "@/lib/queries";
import { cancelExpiredBookings, formatCountdown, paymentSecondsLeft } from "@/lib/payment-window";
import { DEMO_CARD, demoQrValue, isValidCardExpiry } from "@/lib/demo-payment";
import { LoadError } from "@/components/load-error";

export const Route = createFileRoute("/bookings_/$id")({
  head: () => ({
    meta: [
      { title: "ชำระเงินและสัญญาเช่า — Siam Wheels Rental Hub" },
      { name: "description", content: "ชำระเงินค่าเช่ารถออนไลน์และตรวจสอบสัญญาเช่าดิจิทัล" },
      { property: "og:title", content: "ชำระเงินและสัญญาเช่า — Siam Wheels" },
    ],
  }),
  component: BookingDetailsPage,
});

type BookingWithCar = Tables<"bookings"> & {
  cars: Tables<"cars"> | null;
};

function BookingDetailsPage() {
  const { id } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [paymentTab, setPaymentTab] = useState<"qr" | "card">("qr");
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [acceptingContract, setAcceptingContract] = useState(false);
  const [contractAgreed, setContractAgreed] = useState(false);

  // Credit Card Form State
  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");

  // Payment countdown: 15 minutes from when the booking was created
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 1. Fetch Booking and Vehicle Data
  const {
    data: booking,
    isLoading: bookingLoading,
    error: bookingError,
    refetch: refetchBooking,
  } = useQuery({
    queryKey: ["booking", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*, cars(*)")
        .eq("id", id)
        .maybeSingle();

      if (error) throw error;
      return data as BookingWithCar | null;
    },
    enabled: !!id,
  });

  // 2. Fetch Payment Information (if exists)
  const { data: payment, isLoading: paymentLoading } = useQuery({
    queryKey: ["payment", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("booking_id", id)
        .maybeSingle();

      if (error) return null;
      return data;
    },
    enabled: !!id && booking?.status !== "pending",
  });

  // 3. Fetch Digital Contract Information (if exists)
  const { data: contract } = useQuery({
    queryKey: ["contract", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contracts")
        .select("*")
        .eq("booking_id", id)
        .maybeSingle();

      if (error) return null;
      return data;
    },
    enabled: !!id && (booking?.status === "confirmed" || booking?.status === "active" || booking?.status === "completed"),
  });

  const timeLeft = booking ? paymentSecondsLeft(booking.created_at, now) : 0;
  const paymentExpired = booking?.status === "pending" && timeLeft === 0;

  // When the payment time runs out, cancel the booking so the car is released
  useEffect(() => {
    if (!booking || !paymentExpired) return;
    cancelExpiredBookings([booking]).then(() => invalidateBookingData(queryClient));
  }, [booking, paymentExpired, queryClient]);

  // Handle Card input format
  const handleCardNumberChange = (val: string) => {
    const cleaned = val.replace(/\D/g, "").slice(0, 16);
    const formatted = cleaned.match(/.{1,4}/g)?.join(" ") || cleaned;
    setCardNumber(formatted);
  };

  const handleExpiryChange = (val: string) => {
    const cleaned = val.replace(/\D/g, "").slice(0, 4);
    if (cleaned.length >= 3) {
      setCardExpiry(`${cleaned.slice(0, 2)}/${cleaned.slice(2)}`);
    } else {
      setCardExpiry(cleaned);
    }
  };

  // Payment Submission
  const handlePayment = async (method: "qr" | "card") => {
    if (!booking) return;
    if (paymentExpired) {
      toast.error("หมดเวลาชำระเงิน กรุณาจองใหม่อีกครั้ง");
      return;
    }

    if (method === "card") {
      const rawNumber = cardNumber.replace(/\s/g, "");
      if (rawNumber.length < 16) {
        toast.error("กรุณากรอกหมายเลขบัตรเครดิตให้ครบ 16 หลัก");
        return;
      }
      if (!cardName.trim()) {
        toast.error("กรุณากรอกชื่อบนบัตร");
        return;
      }
      if (!isValidCardExpiry(cardExpiry)) {
        toast.error("กรุณากรอกวันหมดอายุให้ถูกต้อง (MM/YY) และบัตรต้องยังไม่หมดอายุ");
        return;
      }
      if (cardCvv.length < 3) {
        toast.error("กรุณากรอกรหัส CVV 3 หลัก");
        return;
      }
    }

    setSubmittingPayment(true);
    try {
      const last4 = method === "card" ? cardNumber.replace(/\s/g, "").slice(-4) : undefined;

      const rpcParams = last4
        ? {
            _booking_id: booking.id,
            _method: method,
            _card_last4: last4,
          }
        : {
            _booking_id: booking.id,
            _method: method,
          };

      const { data, error } = await supabase.rpc("pay_booking", rpcParams);

      if (error) {
        throw error;
      }

      // Demo only: card details never leave the browser except the last 4 digits; clear them now
      setCardName("");
      setCardNumber("");
      setCardExpiry("");
      setCardCvv("");
      toast.success("ชำระเงินสำเร็จ (DEMO)! สัญญาเช่าได้รับการสร้างเรียบร้อยแล้ว");
      // Refresh this booking plus every list and availability cache that depends on it
      await invalidateBookingData(queryClient);
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || "เกิดข้อผิดพลาดในการชำระเงิน กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSubmittingPayment(false);
    }
  };

  // Contract Acceptance Submission
  const handleAcceptContract = async () => {
    if (!contract) return;
    if (!contractAgreed) {
      toast.error("กรุณาทำเครื่องหมายยินยอมรับข้อกำหนดและเงื่อนไข");
      return;
    }

    setAcceptingContract(true);
    try {
      const { error } = await supabase
        .from("contracts")
        .update({
          customer_accepted_at: new Date().toISOString(),
          status: "accepted",
        })
        .eq("id", contract.id);

      if (error) throw error;

      toast.success("ลงนามยอมรับสัญญาเช่าเรียบร้อยแล้ว");
      await queryClient.invalidateQueries({ queryKey: ["contract", id] });
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || "ไม่สามารถบันทึกการยอมรับสัญญาได้");
    } finally {
      setAcceptingContract(false);
    }
  };

  // Loading States
  if (authLoading || bookingLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-20 text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="mt-4 text-muted-foreground">กำลังโหลดข้อมูลการจองและสัญญาเช่า...</p>
      </div>
    );
  }

  // Not Authenticated
  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-warning" />
        <h2 className="mt-4 text-2xl font-semibold">กรุณาเข้าสู่ระบบ</h2>
        <p className="mt-2 text-sm text-muted-foreground">คุณต้องเข้าสู่ระบบเพื่อดูรายละเอียดการจองและชำระเงิน</p>
        <Button className="mt-6 w-full" onClick={() => navigate({ to: "/auth" })}>
          เข้าสู่ระบบ / สมัครสมาชิก
        </Button>
      </div>
    );
  }

  if (bookingError) {
    return (
      <LoadError
        title="โหลดข้อมูลการจองไม่สำเร็จ"
        onRetry={() => void refetchBooking()}
      >
        <Button variant="outline" asChild>
          <Link to="/bookings">ไปที่การจองของฉัน</Link>
        </Button>
      </LoadError>
    );
  }

  // Not Found or Unauthorized
  if (!booking) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
        <h2 className="mt-4 text-2xl font-semibold">ไม่พบข้อมูลการจอง</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          รหัสการจองไม่ถูกต้อง หรือคุณไม่มีสิทธิ์ในการเข้าถึงการจองนี้
        </p>
        <Button variant="outline" className="mt-6" asChild>
          <Link to="/cars">
            <ArrowLeft className="mr-2 h-4 w-4" /> กลับสู่หน้ารถเช่า
          </Link>
        </Button>
      </div>
    );
  }

  const car = booking.cars;
  const isPaid = booking.status !== "pending" && booking.status !== "cancelled";
  // Admins can open any booking, but only the customer who made it can pay or sign
  const isOwner = booking.user_id === user.id;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      {/* Header breadcrumb & Status banner */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            to="/cars"
            className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" /> เลือกดูรถคันอื่น
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">
            {isPaid ? "ยืนยันการจองและสัญญาเช่า" : "ชำระเงินค่าเช่ารถ"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            หมายเลขการจอง: <span className="font-mono font-medium text-foreground">{booking.booking_code}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={booking.status} kind="booking" />
        </div>
      </div>

      {/* Main Grid Content */}
      <div className="grid gap-8 lg:grid-cols-12">
        {/* Left Column: Vehicle & Booking Information (5 Cols) */}
        <div className="space-y-6 lg:col-span-5">
          <Card className="overflow-hidden shadow-card border">
            {car && (
              <div className="relative aspect-[16/10] bg-muted">
                <img
                  src={carImage(car.image_url, car.category)}
                  alt={`${car.brand} ${car.model}`}
                  className="h-full w-full object-cover"
                />
                <Badge className="absolute left-3 top-3" variant="secondary">
                  {categoryLabel[car.category] ?? car.category}
                </Badge>
              </div>
            )}
            <CardHeader className="pb-3">
              <CardTitle className="text-xl">
                {car?.brand} {car?.model} ({car?.year})
              </CardTitle>
              <CardDescription>
                ทะเบียน {car?.plate_no} · เกียร์{car?.transmission} · เชื้อเพลิง{car?.fuel}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="space-y-2 rounded-lg bg-muted/60 p-3.5">
                <div className="flex items-start gap-2.5">
                  <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <span className="font-medium text-foreground">สถานที่รับรถ:</span>
                    <p className="text-muted-foreground">{booking.pickup_location}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Calendar className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <span className="font-medium text-foreground">ระยะเวลาเช่า ({booking.days} วัน):</span>
                    <p className="text-muted-foreground">
                      {fmtDate(booking.start_date)} — {fmtDate(booking.end_date)}
                    </p>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Price Calculation breakdown */}
              <div className="space-y-2">
                <div className="flex justify-between text-muted-foreground">
                  <span>ค่าเช่ารายวัน</span>
                  <span>{thb(car?.price_per_day)} / วัน</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>จำนวนวัน ({booking.days} วัน)</span>
                  <span>{thb(car ? car.price_per_day * booking.days : booking.total_amount)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>ประกันภัยชั้น 1 พื้นฐาน</span>
                  <span className="text-success font-medium">รวมแล้ว</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>ภาษีมูลค่าเพิ่ม (VAT 7%)</span>
                  <span className="text-success font-medium">รวมแล้ว</span>
                </div>
                <Separator />
                <div className="flex items-baseline justify-between pt-1">
                  <span className="font-semibold text-foreground text-base">ยอดรวมทั้งสิ้น</span>
                  <span className="font-display text-2xl font-bold text-primary">
                    {thb(booking.total_amount)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Customer Protection Notice */}
          <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground space-y-2 shadow-sm">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <span>การรับประกันจาก Siam Wheels</span>
            </div>
            <p className="text-xs leading-relaxed">
              รถทุกคันผ่านการตรวจสภาพ 30 จุดก่อนส่งมอบ มีประกันภัยชั้น 1 และบริการช่วยเหลือฉุกเฉินตลอด 24 ชั่วโมง
            </p>
          </div>
        </div>

        {/* Right Column: Dynamic View (Payment Interface OR Confirmed Contract View) (7 Cols) */}
        <div className="space-y-6 lg:col-span-7">
          {/* SCENARIO 1: BOOKING IS PENDING PAYMENT */}
          {!isPaid && booking.status !== "cancelled" && !isOwner && (
            <Card className="shadow-card border">
              <CardHeader>
                <CardTitle className="text-xl">รอลูกค้าชำระเงิน</CardTitle>
                <CardDescription>
                  การจองนี้เป็นของลูกค้า มีเพียงลูกค้าเจ้าของการจองเท่านั้นที่ชำระเงินได้
                  {" · "}
                  {paymentExpired ? "หมดเวลาชำระเงินแล้ว" : `เหลือเวลา ${formatCountdown(timeLeft)} นาที`}
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {!isPaid && booking.status !== "cancelled" && isOwner && (
            <Card className="shadow-card border">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-xl">เลือกช่องทางชำระเงิน</CardTitle>
                  <Badge variant="outline" className="border-amber-400 bg-amber-100 text-amber-900">
                    DEMO · ไม่มีการตัดเงินจริง
                  </Badge>
                </div>
                <CardDescription>
                  ยอดที่ต้องชำระ: <strong className="text-foreground">{thb(booking.total_amount)}</strong>
                  {" · "}
                  {paymentExpired ? (
                    <span className="font-semibold text-destructive">หมดเวลาชำระเงินแล้ว</span>
                  ) : (
                    <span>
                      กรุณาชำระภายใน <span className="font-mono font-bold text-warning">{formatCountdown(timeLeft)}</span> นาที
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={paymentTab} onValueChange={(v) => setPaymentTab(v as "qr" | "card")}>
                  <TabsList className="grid w-full grid-cols-2 mb-6">
                    <TabsTrigger value="qr" className="flex items-center gap-2">
                      <QrCode className="h-4 w-4" /> Thai QR PromptPay
                    </TabsTrigger>
                    <TabsTrigger value="card" className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4" /> บัตรเครดิต / เดบิต
                    </TabsTrigger>
                  </TabsList>

                  {/* Tab 1: Thai QR PromptPay */}
                  <TabsContent value="qr" className="space-y-6 focus-visible:outline-none">
                    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-muted/30 p-6 text-center">
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <Clock className="h-3.5 w-3.5 text-warning" />
                        <span>หมดอายุใน: <span className="font-mono text-warning font-bold">{formatCountdown(timeLeft)}</span> นาที</span>
                      </div>

                      {/* Demo QR: not a PromptPay payload, so a real banking app cannot pay it */}
                      <div className="relative rounded-2xl bg-white p-4 shadow-sm border">
                        <QRCodeSVG
                          value={demoQrValue(booking.booking_code, Number(booking.total_amount))}
                          size={190}
                          level="M"
                          includeMargin={false}
                          aria-label="QR Code ตัวอย่างสำหรับการสาธิต ใช้ชำระเงินจริงไม่ได้"
                        />
                        <span className="absolute -right-2 -top-2 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-950">
                          DEMO
                        </span>
                      </div>

                      <div className="mt-4 space-y-1">
                        <p className="font-semibold text-foreground text-sm">บจก. สยาม วีลส์ เรนทัล (Siam Wheels)</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          เลขอ้างอิง: {booking.booking_code}
                        </p>
                        <p className="font-display text-xl font-bold text-primary mt-1">
                          {thb(booking.total_amount)}
                        </p>
                      </div>

                      <div className="mt-4 max-w-xs text-left rounded-lg bg-card p-3 border text-xs text-muted-foreground space-y-1">
                        <p className="font-medium text-foreground">ขั้นตอนการชำระเงิน (สาธิต):</p>
                        <p>1. QR Code นี้เป็นตัวอย่าง ไม่ต้องสแกนด้วยแอปธนาคาร</p>
                        <p>2. ตรวจสอบยอดเงินและเลขอ้างอิงให้ถูกต้อง</p>
                        <p>3. กดปุ่ม "จำลองยืนยันการชำระเงิน" ด้านล่าง</p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                      <strong>โหมดสาธิต (DEMO):</strong> ไม่มีการโอนหรือตัดเงินจริง กดปุ่มด้านล่างเพื่อจำลองการชำระเงินและออกสัญญาเช่าได้ทันที
                    </div>

                    <Button
                      size="lg"
                      className="w-full text-base font-medium shadow-md"
                      disabled={submittingPayment || paymentExpired}
                      onClick={() => handlePayment("qr")}
                    >
                      {submittingPayment ? "กำลังตรวจสอบการชำระเงิน..." : "จำลองยืนยันการชำระเงินผ่าน QR Code"}
                    </Button>
                  </TabsContent>

                  {/* Tab 2: Credit / Debit Card */}
                  <TabsContent value="card" className="space-y-4 focus-visible:outline-none">
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="card-name" className="text-xs">ชื่อบนบัตร (Cardholder Name)</Label>
                        <Input
                          id="card-name"
                          placeholder="SOMCHAI DEE"
                          value={cardName}
                          onChange={(e) => setCardName(e.target.value.toUpperCase())}
                          className="mt-1"
                        />
                      </div>

                      <div>
                        <Label htmlFor="card-number" className="text-xs">หมายเลขบัตร 16 หลัก</Label>
                        <div className="relative mt-1">
                          <Input
                            id="card-number"
                            placeholder="4000 1234 5678 9010"
                            value={cardNumber}
                            onChange={(e) => handleCardNumberChange(e.target.value)}
                            className="pr-10 font-mono"
                          />
                          <CreditCard className="absolute right-3 top-2.5 h-5 w-5 text-muted-foreground" />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor="card-expiry" className="text-xs">วันหมดอายุ (MM/YY)</Label>
                          <Input
                            id="card-expiry"
                            placeholder="12/28"
                            value={cardExpiry}
                            onChange={(e) => handleExpiryChange(e.target.value)}
                            className="mt-1 font-mono"
                          />
                        </div>
                        <div>
                          <Label htmlFor="card-cvv" className="text-xs">รหัสความปลอดภัย (CVV)</Label>
                          <Input
                            id="card-cvv"
                            type="password"
                            maxLength={4}
                            placeholder="•••"
                            value={cardCvv}
                            onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                            className="mt-1 font-mono"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                      <p>
                        <strong>โหมดสาธิต (DEMO):</strong> ไม่มีการตัดเงินจริง กรุณา<strong>อย่ากรอกข้อมูลบัตรจริง</strong>
                        ระบบบันทึกเฉพาะเลข 4 หลักสุดท้ายเพื่อแสดงในประวัติ
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 border-amber-400 bg-white text-xs"
                        onClick={() => {
                          setCardName(DEMO_CARD.name);
                          setCardNumber(DEMO_CARD.number);
                          setCardExpiry(DEMO_CARD.expiry);
                          setCardCvv(DEMO_CARD.cvv);
                        }}
                      >
                        กรอกบัตรทดสอบ ({DEMO_CARD.number})
                      </Button>
                    </div>

                    <Button
                      size="lg"
                      className="w-full text-base font-medium shadow-md"
                      disabled={submittingPayment || paymentExpired}
                      onClick={() => handlePayment("card")}
                    >
                      {submittingPayment ? "กำลังประมวลผลบัตรเครดิต..." : `จำลองชำระเงิน ${thb(booking.total_amount)} (DEMO)`}
                    </Button>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}

          {/* SCENARIO 2: BOOKING IS CONFIRMED / ACTIVE (CONTRACT DISPLAY & ACCEPTANCE) */}
          {isPaid && (
            <div className="space-y-6">
              {/* Payment Success Receipt Card */}
              <Card className="border-success/30 bg-success/5 shadow-card">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-6 w-6 text-success" />
                    <div>
                      <CardTitle className="text-lg text-success">ชำระเงินเรียบร้อยแล้ว</CardTitle>
                      <CardDescription>
                        การจองของคุณได้รับการยืนยันแล้ว สามารถนำหลักฐานนี้ไปรับรถตามวันและเวลาที่กำหนด
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="text-sm">
                  {paymentLoading ? (
                    <p className="rounded-lg border bg-card p-3 text-muted-foreground" role="status">
                      กำลังโหลดรายละเอียดการชำระเงิน...
                    </p>
                  ) : !payment ? (
                    <p className="rounded-lg border bg-card p-3 text-muted-foreground">
                      ไม่พบรายละเอียดการชำระเงินของการจองนี้
                    </p>
                  ) : (
                  <div className="grid grid-cols-2 gap-3 rounded-lg bg-card p-3 border">
                    <div>
                      <span className="text-xs text-muted-foreground">ช่องทางชำระ:</span>
                      <p className="font-medium text-foreground capitalize">
                        {payment.method === "qr" ? "QR PromptPay (DEMO)" : `บัตรเครดิต (••• ${payment.card_last4 ?? "XXXX"}) (DEMO)`}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">รหัสอ้างอิงการชำระ:</span>
                      <p className="font-mono text-foreground">{payment.reference ?? "-"}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">ยอดเงินที่ชำระ:</span>
                      <p className="font-semibold text-primary">{thb(payment.amount)}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">วันที่ชำระเงิน:</span>
                      <p className="text-foreground">{fmtDateTime(payment.paid_at)}</p>
                    </div>
                  </div>
                  )}
                </CardContent>
              </Card>

              {/* Digital Rental Contract Card */}
              <Card className="shadow-card border">
                <CardHeader className="flex flex-row items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <FileCheck2 className="h-5 w-5 text-primary" />
                      <CardTitle className="text-xl">สัญญาเช่ารถยนต์อิเล็กทรอนิกส์</CardTitle>
                    </div>
                    <CardDescription className="mt-1">
                      เลขที่สัญญา: <span className="font-mono font-medium text-foreground">{contract?.contract_no ?? "CT-PENDING"}</span>
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => window.print()} className="print:hidden">
                    <Printer className="mr-1.5 h-4 w-4" /> พิมพ์สัญญา
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Contract Text Body */}
                  <div className="rounded-xl border bg-muted/40 p-4 font-mono text-xs leading-relaxed max-h-80 overflow-y-auto whitespace-pre-wrap">
                    {contract?.terms || "กำลังจัดเตรียมสัญญาเช่า..."}
                  </div>

                  {/* Contract Acceptance Status or Action */}
                  {contract?.customer_accepted_at ? (
                    <div className="flex items-center gap-2.5 rounded-lg bg-success/10 p-3 text-xs text-success border border-success/20">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>
                        ผู้เช่าลงนามยอมรับสัญญาแล้วเมื่อ <strong>{fmtDateTime(contract.customer_accepted_at)}</strong>
                      </span>
                    </div>
                  ) : !isOwner ? (
                    <div className="flex items-center gap-2.5 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>รอลูกค้าลงนามยอมรับสัญญา (เฉพาะลูกค้าเจ้าของการจองเท่านั้นที่ลงนามได้)</span>
                    </div>
                  ) : (
                    <div className="space-y-3 rounded-xl border border-warning/30 bg-warning/5 p-4">
                      <div className="flex items-start gap-2 text-warning-foreground">
                        <AlertCircle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-sm">กรุณาลงนามยอมรับสัญญาเช่า</p>
                          <p className="text-xs text-muted-foreground">
                            ผู้เช่าต้องตรวจสอบเงื่อนไขและลงนามยินยอมก่อนทำการรับรถยนต์
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 pt-2">
                        <Checkbox
                          id="contract-terms"
                          checked={contractAgreed}
                          onCheckedChange={(checked) => setContractAgreed(!!checked)}
                        />
                        <Label htmlFor="contract-terms" className="text-xs leading-tight cursor-pointer">
                          ข้าพเจ้าได้อ่าน เข้าใจ และยินยอมปฏิบัติตามข้อกำหนดและเงื่อนไขในสัญญาเช่าฉบับนี้ทุกประการ
                        </Label>
                      </div>

                      <Button
                        size="sm"
                        disabled={!contractAgreed || acceptingContract}
                        onClick={handleAcceptContract}
                        className="w-full mt-2"
                      >
                        {acceptingContract ? "กำลังบันทึกการยอมรับสัญญา..." : "ลงนามยอมรับสัญญาเช่าดิจิทัล"}
                      </Button>
                    </div>
                  )}
                </CardContent>
                <CardFooter className="flex flex-wrap justify-between gap-3 border-t pt-4 print:hidden">
                  <Button variant="outline" asChild>
                    <Link to="/bookings">
                      <FileText className="mr-1.5 h-4 w-4" /> ดูรายการจองทั้งหมดของฉัน
                    </Link>
                  </Button>
                  <Button asChild>
                    <Link to="/cars">
                      <CarIcon className="mr-1.5 h-4 w-4" /> ค้นหารถคันอื่นเพิ่มเติม
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            </div>
          )}

          {/* SCENARIO 3: BOOKING IS CANCELLED */}
          {booking.status === "cancelled" && (
            <Card className="border-destructive/30 bg-destructive/5 shadow-card">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <AlertCircle className="h-6 w-6 text-destructive" />
                  <CardTitle className="text-lg text-destructive">การจองนี้ถูกยกเลิกแล้ว</CardTitle>
                </div>
                <CardDescription>
                  รายการจองนี้ถูกยกเลิกเรียบร้อยแล้ว ไม่สามารถดำเนินการชำระเงินหรือทำสัญญาเช่าได้
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <Button asChild>
                  <Link to="/cars">
                    <CarIcon className="mr-1.5 h-4 w-4" /> ค้นหาและจองรถคันใหม่
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
