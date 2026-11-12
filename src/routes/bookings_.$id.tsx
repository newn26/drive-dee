import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  FileCheck2,
  FileText,
  MapPin,
  QrCode,
  ShieldCheck,
  AlertCircle,
  ArrowLeft,
  Car as CarIcon,
  Hourglass,
  MessageSquareWarning,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/status-badge";
import { ContractView } from "@/components/contract/contract-view";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { carImage } from "@/lib/car-images";
import { categoryLabel, fmtDate, fmtDateTime, thb } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";
import { invalidateBookingData } from "@/lib/queries";
import { cancelExpiredBookings, formatCountdown, holdSecondsLeft } from "@/lib/payment-window";
import {
  DEMO_CARD,
  DEMO_DECLINED_CARD,
  demoQrValue,
  isDemoDeclinedCard,
  isValidCardExpiry,
} from "@/lib/demo-payment";
import {
  acceptContract,
  customerRequestRevision,
  fetchContractEvents,
  fetchContractForBooking,
  fetchContractVersions,
} from "@/lib/contract-api";
import {
  canCustomerRespond,
  canPay,
  customerStage,
  customerStageLabel,
  reasonError,
  refundStatusLabel,
} from "@/lib/contract-workflow";
import { LoadError } from "@/components/load-error";

export const Route = createFileRoute("/bookings_/$id")({
  head: () => ({
    meta: [
      { title: "สัญญาเช่าและการชำระเงิน — Drive Dee" },
      {
        name: "description",
        content: "ตรวจสอบสัญญาเช่าดิจิทัล ยอมรับสัญญา และชำระเงินค่าเช่ารถออนไลน์",
      },
      { property: "og:title", content: "สัญญาเช่าและการชำระเงิน — Drive Dee" },
    ],
  }),
  component: BookingDetailsPage,
});

type BookingWithCar = Tables<"bookings"> & {
  cars: Tables<"cars"> | null;
};
type PaymentRow = Tables<"payments">;

const contractQueryKey = (id: string) => ["contract", id] as const;

function BookingDetailsPage() {
  const { id } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [paymentTab, setPaymentTab] = useState<"qr" | "card">("qr");
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [acceptingContract, setAcceptingContract] = useState(false);
  const [contractAgreed, setContractAgreed] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionReason, setRevisionReason] = useState("");
  const [sendingRevision, setSendingRevision] = useState(false);

  // Credit Card Form State
  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Countdown to the server's hold deadline (stage-based; 15 minutes once payment opens)
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 1. Booking and car
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

  // 2. Payment (only once the booking is no longer pending)
  const { data: payment, isLoading: paymentLoading } = useQuery({
    queryKey: ["payment", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("booking_id", id)
        .maybeSingle();
      if (error) return null;
      return data as PaymentRow | null;
    },
    enabled: !!id && !!booking && booking.status !== "pending",
  });

  // 3. Contract, its versions and history (RLS: customers only ever see sent versions)
  const { data: contract } = useQuery({
    queryKey: contractQueryKey(id),
    queryFn: () => fetchContractForBooking(id),
    enabled: !!id && !!booking,
  });
  const { data: versions = [] } = useQuery({
    queryKey: ["contract-versions", contract?.id],
    queryFn: () => fetchContractVersions(contract!.id),
    enabled: !!contract,
  });
  const { data: events = [] } = useQuery({
    queryKey: ["contract-events", id],
    queryFn: () => fetchContractEvents(id),
    enabled: !!contract,
  });

  const timeLeft = booking ? holdSecondsLeft(booking, now) : 0;
  const holdExpired = booking?.status === "pending" && timeLeft === 0;

  // When the hold runs out, ask the server to tidy it up so the car is shown as released
  useEffect(() => {
    if (!booking || !holdExpired) return;
    cancelExpiredBookings([booking]).then(() => invalidateBookingData(queryClient));
  }, [booking, holdExpired, queryClient]);

  const refreshAll = () =>
    Promise.all([
      invalidateBookingData(queryClient),
      queryClient.invalidateQueries({ queryKey: ["contract-versions"] }),
      queryClient.invalidateQueries({ queryKey: ["contract-events"] }),
    ]);

  const handleCardNumberChange = (val: string) => {
    const cleaned = val.replace(/\D/g, "").slice(0, 16);
    const formatted = cleaned.match(/.{1,4}/g)?.join(" ") || cleaned;
    setCardNumber(formatted);
  };

  const handleExpiryChange = (val: string) => {
    const cleaned = val.replace(/\D/g, "").slice(0, 4);
    setCardExpiry(cleaned.length >= 3 ? `${cleaned.slice(0, 2)}/${cleaned.slice(2)}` : cleaned);
  };

  // Payment Submission (DEMO). The database refuses it unless the contract is approved.
  const handlePayment = async (method: "qr" | "card") => {
    if (!booking) return;
    if (!canPay(booking, contract, Date.now())) {
      toast.error(
        holdExpired
          ? "หมดเวลาชำระเงิน กรุณาจองใหม่อีกครั้ง"
          : "ยังชำระเงินไม่ได้ ต้องรอผู้ดูแลอนุมัติสัญญาก่อน",
      );
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
      // Demo decline: nothing is sent to the database; booking and contract stay unpaid.
      if (isDemoDeclinedCard(rawNumber)) {
        const msg =
          "บัตรถูกปฏิเสธ (DEMO) — ไม่มีการตัดเงิน การจองยังรอชำระเงิน กรุณาลองใหม่ด้วยบัตรอื่นหรือ QR Code";
        setPaymentError(msg);
        toast.error(msg);
        setCardNumber("");
        setCardExpiry("");
        setCardCvv("");
        return;
      }
    }

    setPaymentError(null);
    setSubmittingPayment(true);
    try {
      const last4 = method === "card" ? cardNumber.replace(/\s/g, "").slice(-4) : undefined;
      const rpcParams = last4
        ? { _booking_id: booking.id, _method: method, _card_last4: last4 }
        : { _booking_id: booking.id, _method: method };

      const { error } = await supabase.rpc("pay_booking", rpcParams);
      if (error) throw error;

      setCardName("");
      toast.success("ชำระเงินสำเร็จ (DEMO)! การจองได้รับการยืนยันแล้ว");
      await refreshAll();
    } catch (err: unknown) {
      const error = err as Error;
      const msg = error.message || "เกิดข้อผิดพลาดในการชำระเงิน กรุณาลองใหม่อีกครั้ง";
      setPaymentError(msg);
      toast.error(msg);
    } finally {
      // Demo only: card details never leave the browser except the last 4 digits.
      setCardNumber("");
      setCardExpiry("");
      setCardCvv("");
      setSubmittingPayment(false);
    }
  };

  // Accept exactly the version shown
  const handleAcceptContract = async () => {
    if (!contract || contract.sent_version === null) return;
    if (!contractAgreed) {
      toast.error("กรุณาทำเครื่องหมายยินยอมรับข้อกำหนดและเงื่อนไข");
      return;
    }
    setAcceptingContract(true);
    try {
      await acceptContract(contract.id, contract.sent_version);
      toast.success(`ยอมรับสัญญาฉบับที่ ${contract.sent_version} แล้ว รอผู้ดูแลอนุมัติ`);
      setContractAgreed(false);
      await refreshAll();
    } catch (err: unknown) {
      toast.error((err as Error).message || "ไม่สามารถบันทึกการยอมรับสัญญาได้");
      await refreshAll();
    } finally {
      setAcceptingContract(false);
    }
  };

  const handleRequestRevision = async () => {
    if (!contract || contract.sent_version === null) return;
    const problem = reasonError(revisionReason, 5);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSendingRevision(true);
    try {
      await customerRequestRevision(contract.id, contract.sent_version, revisionReason);
      toast.success("ส่งคำขอแก้ไขสัญญาแล้ว ผู้ดูแลจะจัดทำฉบับใหม่ให้");
      setRevisionOpen(false);
      setRevisionReason("");
      await refreshAll();
    } catch (err: unknown) {
      toast.error((err as Error).message || "ส่งคำขอแก้ไขไม่สำเร็จ");
    } finally {
      setSendingRevision(false);
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

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-warning" />
        <h2 className="mt-4 text-2xl font-semibold">กรุณาเข้าสู่ระบบ</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          คุณต้องเข้าสู่ระบบเพื่อดูรายละเอียดการจองและชำระเงิน
        </p>
        <Button className="mt-6 w-full" onClick={() => navigate({ to: "/auth" })}>
          เข้าสู่ระบบ / สมัครสมาชิก
        </Button>
      </div>
    );
  }

  if (bookingError) {
    return (
      <LoadError title="โหลดข้อมูลการจองไม่สำเร็จ" onRetry={() => void refetchBooking()}>
        <Button variant="outline" asChild>
          <Link to="/bookings">ไปที่การจองของฉัน</Link>
        </Button>
      </LoadError>
    );
  }

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
  const stage = customerStage(booking, contract);
  const isPaid = stage === "confirmed" || stage === "completed";
  // Admins can open any booking, but only the customer who made it can accept, revise or pay
  const isOwner = booking.user_id === user.id;
  const paymentOpen = isOwner && canPay(booking, contract, now);
  const canRespond = isOwner && canCustomerRespond(booking, contract, now);
  const holdText =
    booking.status !== "pending"
      ? null
      : holdExpired
        ? "หมดเวลาแล้ว"
        : stage === "awaiting_payment"
          ? `ชำระภายใน ${formatCountdown(timeLeft)}`
          : `ขั้นตอนนี้ต้องเสร็จภายใน ${formatCountdown(timeLeft)}`;

  const contractBlock = contract && (versions.length > 0 || contract.sent_version !== null) && (
    <Card className="border shadow-card print:border-0 print:shadow-none">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <FileCheck2 className="h-5 w-5 text-primary" />
          <CardTitle className="text-xl">สัญญาเช่ารถยนต์อิเล็กทรอนิกส์</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <ContractView
          contract={contract}
          versions={versions}
          events={events}
          audience={isOwner ? "customer" : "admin"}
        />
      </CardContent>
    </Card>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            to="/bookings"
            className="mb-2 inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground print:hidden"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" /> การจองของฉัน
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">
            {isPaid
              ? "ยืนยันการจองและสัญญาเช่า"
              : stage === "awaiting_payment"
                ? "ชำระเงินค่าเช่ารถ"
                : "สัญญาเช่ารถ"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            หมายเลขการจอง:{" "}
            <span className="font-mono font-medium text-foreground">{booking.booking_code}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={booking.status} kind="booking" />
          {booking.status === "pending" && (
            <Badge variant="outline" data-testid="customer-stage">
              {customerStageLabel[stage]}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-12">
        {/* Left Column: Vehicle & Booking Information */}
        <div className="space-y-6 lg:col-span-5 print:hidden">
          <Card className="overflow-hidden border shadow-card">
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
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <span className="font-medium text-foreground">สถานที่รับรถ:</span>
                    <p className="text-muted-foreground">{booking.pickup_location}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <span className="font-medium text-foreground">
                      ระยะเวลาเช่า ({booking.days} วัน):
                    </span>
                    <p className="text-muted-foreground">
                      {fmtDate(booking.start_date)} — {fmtDate(booking.end_date)}
                    </p>
                  </div>
                </div>
                {holdText && (
                  <div className="flex items-start gap-2.5">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <p
                      className={
                        holdExpired ? "font-semibold text-destructive" : "text-muted-foreground"
                      }
                    >
                      {holdText}
                      {booking.hold_expires_at && !holdExpired && (
                        <span className="block text-xs">
                          (ถึง {fmtDateTime(booking.hold_expires_at)})
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </div>

              <Separator />

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
                  <span className="font-medium text-success">รวมแล้ว</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>ภาษีมูลค่าเพิ่ม (VAT 7%)</span>
                  <span className="font-medium text-success">รวมแล้ว</span>
                </div>
                <Separator />
                <div className="flex items-baseline justify-between pt-1">
                  <span className="text-base font-semibold text-foreground">ยอดชำระออนไลน์</span>
                  <span className="font-display text-2xl font-bold text-primary">
                    {thb(booking.total_amount)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  เงินประกันความเสียหายชำระ ณ วันรับรถ ตามที่ระบุในสัญญา
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2 rounded-xl border bg-card p-4 text-sm text-muted-foreground shadow-sm">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <span>ขั้นตอนการเช่า</span>
            </div>
            <ol className="list-decimal space-y-0.5 pl-5 text-xs leading-relaxed">
              <li>ผู้ดูแลจัดทำสัญญาเช่าและส่งให้คุณ</li>
              <li>คุณตรวจสอบและยอมรับสัญญา (หรือขอแก้ไข)</li>
              <li>ผู้ดูแลอนุมัติสัญญาฉบับที่คุณยอมรับ</li>
              <li>ชำระเงินภายใน 15 นาทีหลังอนุมัติ (DEMO)</li>
            </ol>
          </div>
        </div>

        {/* Right Column: one card per stage */}
        <div className="space-y-6 lg:col-span-7">
          {/* Someone other than the customer (an admin) */}
          {booking.status === "pending" && !isOwner && (
            <Card className="border shadow-card">
              <CardHeader>
                <CardTitle className="text-xl">{customerStageLabel[stage]}</CardTitle>
                <CardDescription>
                  การจองนี้เป็นของลูกค้า
                  มีเพียงลูกค้าเจ้าของการจองเท่านั้นที่ยอมรับสัญญาและชำระเงินได้
                  จัดการสัญญาได้ที่แดชบอร์ดผู้ดูแล
                  {holdText && ` · ${holdText}`}
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {booking.status === "pending" && isOwner && stage === "awaiting_contract" && (
            <StageCard
              icon={<Hourglass className="h-6 w-6 text-warning" />}
              title={contract?.sent_version ? "ผู้ดูแลกำลังแก้ไขสัญญา" : "รอผู้ดูแลจัดทำสัญญาเช่า"}
              text={
                contract?.sent_version
                  ? "ผู้ดูแลกำลังจัดทำสัญญาฉบับใหม่ คุณจะต้องตรวจสอบและยอมรับฉบับใหม่อีกครั้ง ฉบับก่อนหน้าแสดงไว้ด้านล่าง"
                  : "ผู้ดูแลจะจัดทำสัญญาจากข้อมูลการจองของคุณ เมื่อส่งแล้วคุณจะเห็นสัญญาที่หน้านี้ ยังไม่ต้องชำระเงิน"
              }
            />
          )}

          {booking.status === "pending" && isOwner && stage === "review_contract" && (
            <Card className="border-warning/40 bg-warning/5 shadow-card print:hidden">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">
                  กรุณาตรวจสอบสัญญาฉบับที่ {contract?.sent_version}
                </CardTitle>
                <CardDescription>
                  อ่านรายละเอียดสัญญาด้านล่าง แล้วยอมรับ หรือขอให้ผู้ดูแลแก้ไข
                  คุณไม่สามารถแก้ไขข้อความสัญญาเองได้ ยังไม่ต้องชำระเงินในขั้นตอนนี้
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start space-x-2">
                  <Checkbox
                    id="contract-terms"
                    checked={contractAgreed}
                    disabled={!canRespond}
                    onCheckedChange={(checked) => setContractAgreed(!!checked)}
                  />
                  <Label htmlFor="contract-terms" className="cursor-pointer text-xs leading-tight">
                    ข้าพเจ้าได้อ่าน เข้าใจ และยินยอมปฏิบัติตามข้อกำหนดและเงื่อนไขในสัญญาเช่าฉบับที่{" "}
                    {contract?.sent_version} ทุกประการ
                  </Label>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    className="flex-1"
                    disabled={!canRespond || !contractAgreed || acceptingContract}
                    onClick={handleAcceptContract}
                  >
                    {acceptingContract
                      ? "กำลังบันทึก..."
                      : `ยอมรับสัญญาฉบับที่ ${contract?.sent_version}`}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={!canRespond}
                    onClick={() => setRevisionOpen(true)}
                  >
                    <MessageSquareWarning className="mr-1.5 h-4 w-4" /> ขอแก้ไขสัญญา
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {booking.status === "pending" && isOwner && stage === "awaiting_approval" && (
            <StageCard
              icon={<CheckCircle2 className="h-6 w-6 text-success" />}
              title="ยอมรับสัญญาแล้ว รอผู้ดูแลอนุมัติ"
              text={`คุณยอมรับสัญญาเมื่อ ${fmtDateTime(contract?.customer_accepted_at)} เมื่อผู้ดูแลอนุมัติ คุณจะชำระเงินได้ภายใน 15 นาที`}
            />
          )}

          {booking.status === "pending" && isOwner && stage === "revision_requested" && (
            <StageCard
              icon={<MessageSquareWarning className="h-6 w-6 text-orange-600" />}
              title="กำลังแก้ไขสัญญา"
              text="ผู้ดูแลจะจัดทำสัญญาฉบับใหม่ คุณจะต้องตรวจสอบและยอมรับฉบับใหม่อีกครั้งก่อนชำระเงิน"
            />
          )}

          {/* Payment: only for an approved contract */}
          {booking.status === "pending" && isOwner && stage === "awaiting_payment" && (
            <Card className="border shadow-card" data-testid="payment-card">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-xl">เลือกช่องทางชำระเงิน</CardTitle>
                  <Badge variant="outline" className="border-amber-400 bg-amber-100 text-amber-900">
                    DEMO · ไม่มีการตัดเงินจริง
                  </Badge>
                </div>
                <CardDescription>
                  สัญญาได้รับอนุมัติแล้ว · ยอดที่ต้องชำระ:{" "}
                  <strong className="text-foreground">{thb(booking.total_amount)}</strong>
                  {" · "}
                  {holdExpired ? (
                    <span className="font-semibold text-destructive">หมดเวลาชำระเงินแล้ว</span>
                  ) : (
                    <span>
                      กรุณาชำระภายใน{" "}
                      <span className="font-mono font-bold text-warning">
                        {formatCountdown(timeLeft)}
                      </span>
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {paymentError && (
                  <div
                    role="alert"
                    className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">ชำระเงินไม่สำเร็จ (DEMO)</p>
                      <p className="text-xs">
                        {paymentError} — ยังไม่มีการตัดเงิน กรุณาลองใหม่อีกครั้ง
                      </p>
                    </div>
                  </div>
                )}
                <Tabs value={paymentTab} onValueChange={(v) => setPaymentTab(v as "qr" | "card")}>
                  <TabsList className="mb-6 grid h-auto w-full grid-cols-2">
                    <TabsTrigger
                      value="qr"
                      className="flex items-center gap-2 whitespace-normal text-xs sm:text-sm"
                    >
                      <QrCode className="h-4 w-4" /> Thai QR PromptPay
                    </TabsTrigger>
                    <TabsTrigger
                      value="card"
                      className="flex items-center gap-2 whitespace-normal text-xs sm:text-sm"
                    >
                      <CreditCard className="h-4 w-4" /> บัตรเครดิต / เดบิต
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="qr" className="space-y-6 focus-visible:outline-none">
                    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-muted/30 p-6 text-center">
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <Clock className="h-3.5 w-3.5 text-warning" />
                        <span>
                          หมดอายุใน:{" "}
                          <span className="font-mono font-bold text-warning">
                            {formatCountdown(timeLeft)}
                          </span>
                        </span>
                      </div>
                      {/* Demo QR: not a PromptPay payload, so a real banking app cannot pay it */}
                      <div className="relative rounded-2xl border bg-white p-4 shadow-sm">
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
                        <p className="text-sm font-semibold text-foreground">
                          บจก. สยาม วีลส์ เรนทัล (Siam Wheels)
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">
                          เลขอ้างอิง: {booking.booking_code}
                        </p>
                        <p className="mt-1 font-display text-xl font-bold text-primary">
                          {thb(booking.total_amount)}
                        </p>
                      </div>
                      <div className="mt-4 max-w-xs space-y-1 rounded-lg border bg-card p-3 text-left text-xs text-muted-foreground">
                        <p className="font-medium text-foreground">ขั้นตอนการชำระเงิน (สาธิต):</p>
                        <p>1. QR Code นี้เป็นตัวอย่าง ไม่ต้องสแกนด้วยแอปธนาคาร</p>
                        <p>2. ตรวจสอบยอดเงินและเลขอ้างอิงให้ถูกต้อง</p>
                        <p>3. กดปุ่ม "จำลองยืนยันการชำระเงิน" ด้านล่าง</p>
                      </div>
                    </div>
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                      <strong>โหมดสาธิต (DEMO):</strong> ไม่มีการโอนหรือตัดเงินจริง
                      กดปุ่มด้านล่างเพื่อจำลองการชำระเงิน
                    </div>
                    <Button
                      size="lg"
                      className="w-full text-base font-medium shadow-md"
                      disabled={submittingPayment || !paymentOpen}
                      onClick={() => handlePayment("qr")}
                    >
                      {submittingPayment
                        ? "กำลังตรวจสอบการชำระเงิน..."
                        : "จำลองยืนยันการชำระเงินผ่าน QR Code"}
                    </Button>
                  </TabsContent>

                  <TabsContent value="card" className="space-y-4 focus-visible:outline-none">
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="card-name" className="text-xs">
                          ชื่อบนบัตร (Cardholder Name)
                        </Label>
                        <Input
                          id="card-name"
                          placeholder="SOMCHAI DEE"
                          value={cardName}
                          onChange={(e) => setCardName(e.target.value.toUpperCase())}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="card-number" className="text-xs">
                          หมายเลขบัตร 16 หลัก
                        </Label>
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
                          <Label htmlFor="card-expiry" className="text-xs">
                            วันหมดอายุ (MM/YY)
                          </Label>
                          <Input
                            id="card-expiry"
                            placeholder="12/28"
                            value={cardExpiry}
                            onChange={(e) => handleExpiryChange(e.target.value)}
                            className="mt-1 font-mono"
                          />
                        </div>
                        <div>
                          <Label htmlFor="card-cvv" className="text-xs">
                            รหัสความปลอดภัย (CVV)
                          </Label>
                          <Input
                            id="card-cvv"
                            type="password"
                            maxLength={4}
                            placeholder="•••"
                            value={cardCvv}
                            onChange={(e) =>
                              setCardCvv(e.target.value.replace(/\D/g, "").slice(0, 4))
                            }
                            className="mt-1 font-mono"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                      <p>
                        <strong>โหมดสาธิต (DEMO):</strong> ไม่มีการตัดเงินจริง กรุณา
                        <strong>อย่ากรอกข้อมูลบัตรจริง</strong>
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
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="ml-2 h-7 border-amber-400 bg-white text-xs"
                        onClick={() => {
                          setCardName(DEMO_DECLINED_CARD.name);
                          setCardNumber(DEMO_DECLINED_CARD.number);
                          setCardExpiry(DEMO_DECLINED_CARD.expiry);
                          setCardCvv(DEMO_DECLINED_CARD.cvv);
                        }}
                      >
                        บัตรทดสอบถูกปฏิเสธ (…0002)
                      </Button>
                    </div>
                    <Button
                      size="lg"
                      className="w-full text-base font-medium shadow-md"
                      disabled={submittingPayment || !paymentOpen}
                      onClick={() => handlePayment("card")}
                    >
                      {submittingPayment
                        ? "กำลังประมวลผลบัตรเครดิต..."
                        : `จำลองชำระเงิน ${thb(booking.total_amount)} (DEMO)`}
                    </Button>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}

          {/* Paid: receipt */}
          {isPaid && (
            <Card className="border-success/30 bg-success/5 shadow-card print:hidden">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-6 w-6 text-success" />
                  <div>
                    <CardTitle className="text-lg text-success">
                      การจองได้รับการยืนยันแล้ว
                    </CardTitle>
                    <CardDescription>
                      สามารถนำหลักฐานนี้ไปรับรถตามวันและเวลาที่กำหนดในสัญญา
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="text-sm">
                <PaymentDetails loading={paymentLoading} payment={payment ?? null} />
              </CardContent>
            </Card>
          )}

          {booking.status === "cancelled" && (
            <Card className="border-destructive/30 bg-destructive/5 shadow-card">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <AlertCircle className="h-6 w-6 text-destructive" />
                  <CardTitle className="text-lg text-destructive">การจองนี้ถูกยกเลิกแล้ว</CardTitle>
                </div>
                <CardDescription>
                  รายการจองนี้ถูกยกเลิกหรือหมดเวลาแล้ว ไม่สามารถทำสัญญาหรือชำระเงินได้
                </CardDescription>
              </CardHeader>
              {payment && (
                <CardContent className="text-sm">
                  <PaymentDetails loading={false} payment={payment} />
                </CardContent>
              )}
              <CardFooter>
                <Button asChild>
                  <Link to="/cars">
                    <CarIcon className="mr-1.5 h-4 w-4" /> ค้นหาและจองรถคันใหม่
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          )}

          {contractBlock}

          {isPaid && (
            <div className="flex flex-wrap justify-between gap-3 print:hidden">
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
            </div>
          )}
        </div>
      </div>

      <Dialog open={revisionOpen} onOpenChange={setRevisionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ขอแก้ไขสัญญาฉบับที่ {contract?.sent_version}</DialogTitle>
            <DialogDescription>
              บอกผู้ดูแลว่าต้องการให้แก้ไขส่วนใด
              ผู้ดูแลจะจัดทำฉบับใหม่ให้คุณตรวจสอบและยอมรับอีกครั้ง
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="revision-reason" className="text-xs">
            เหตุผล / สิ่งที่ต้องการแก้ไข
          </Label>
          <Textarea
            id="revision-reason"
            value={revisionReason}
            onChange={(e) => setRevisionReason(e.target.value)}
            maxLength={1000}
            placeholder="เช่น ขอเปลี่ยนเวลารับรถเป็น 09:00 น."
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisionOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={handleRequestRevision} disabled={sendingRevision}>
              {sendingRevision ? "กำลังส่ง..." : "ส่งคำขอแก้ไข"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StageCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <Card className="border shadow-card" data-testid="stage-card">
      <CardHeader>
        <div className="flex items-start gap-3">
          {icon}
          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription className="mt-1">{text}</CardDescription>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}

function PaymentDetails({ loading, payment }: { loading: boolean; payment: PaymentRow | null }) {
  if (loading) {
    return (
      <p className="rounded-lg border bg-card p-3 text-muted-foreground" role="status">
        กำลังโหลดรายละเอียดการชำระเงิน...
      </p>
    );
  }
  if (!payment) {
    return (
      <p className="rounded-lg border bg-card p-3 text-muted-foreground">
        ไม่พบรายละเอียดการชำระเงินของการจองนี้
      </p>
    );
  }
  const refund =
    payment.refund_status && payment.refund_status !== "none"
      ? refundStatusLabel[payment.refund_status]
      : null;
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-3">
      <div>
        <span className="text-xs text-muted-foreground">ช่องทางชำระ:</span>
        <p className="font-medium capitalize text-foreground">
          {payment.method === "qr"
            ? "QR PromptPay (DEMO)"
            : `บัตรเครดิต (••• ${payment.card_last4 ?? "XXXX"}) (DEMO)`}
        </p>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">รหัสอ้างอิงการชำระ:</span>
        <p className="break-all font-mono text-foreground">{payment.reference ?? "-"}</p>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">ยอดเงินที่ชำระ:</span>
        <p className="font-semibold text-primary">{thb(payment.amount)}</p>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">วันที่ชำระเงิน:</span>
        <p className="text-foreground">{fmtDateTime(payment.paid_at)}</p>
      </div>
      {refund && (
        <div className="col-span-2" data-testid="refund-status">
          <span className="text-xs text-muted-foreground">สถานะการคืนเงิน:</span>
          <p className="font-medium text-destructive">{refund}</p>
        </div>
      )}
    </div>
  );
}
