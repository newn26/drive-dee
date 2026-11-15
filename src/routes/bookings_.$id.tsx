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
import { carSpecLabel, categoryLabel, fmtDate, fmtDateTime, pickupLocationLabel, thb } from "@/lib/format";
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
  fetchReceiptDetails,
  type ReceiptDetails,
} from "@/lib/contract-api";
import {
  canCustomerRespond,
  canPay,
  customerStage,
  customerStageLabel,
  bangkokTime,
  CLOSING_TIME,
  OPENING_TIME,
  customerRevisionCount,
  MAX_CUSTOMER_REVISIONS,
  REVISION_UNCHANGED_MESSAGE,
  revisionReasonText,
  revisionRequestError,
  revisionUnchanged,
  type RevisionRequest,
  refundStatusLabel,
} from "@/lib/contract-workflow";
import { LoadError } from "@/components/load-error";
import { BOOKING_FEE, rentalCharges } from "@/lib/booking-fee";
import { tr, trError } from "@/lib/i18n";

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
/** kind/deposit come from docs/database/booking-fee-flow.sql (not in the generated types yet). */
type PaymentRow = Tables<"payments"> & { kind?: string; deposit?: number | string };

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
  const [revision, setRevision] = useState<RevisionRequest>({
    customerName: "",
    pickupTime: "10:00",
    returnTime: "18:00",
  });
  // What the sent version says; a request must change at least one of these
  const [revisionOriginal, setRevisionOriginal] = useState<RevisionRequest | null>(null);
  const revisionIsUnchanged = !!revisionOriginal && revisionUnchanged(revisionOriginal, revision);
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
    // While the customer waits at the counter for the hand-over, check every 10 s so the
    // pickup QR appears as soon as the admin marks the booking "active"
    refetchInterval: (q) => (q.state.data?.status === "confirmed" ? 10_000 : false),
  });

  // 2. Payments (only once the booking is no longer pending): booking fee, then the pickup amount
  const { data: payments = [], isLoading: paymentLoading } = useQuery({
    queryKey: ["payment", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("booking_id", id)
        .order("paid_at");
      if (error) return [];
      return data as PaymentRow[];
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

  // 4. Receipt: the customer's full details and the admin who created the contract
  const receiptQ = useQuery({
    queryKey: ["receipt", id],
    queryFn: () => fetchReceiptDetails(id),
    enabled: !!id && !!booking && booking.status !== "pending" && booking.status !== "cancelled",
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
    if (!booking || !payKind) return;
    if (payKind === "booking_fee" && !canPay(booking, contract, Date.now())) {
      toast.error(
        holdExpired
          ? tr("หมดเวลาชำระเงิน กรุณาจองใหม่อีกครั้ง", "The payment time is up. Please book again.")
          : tr("ยังชำระเงินไม่ได้ กรุณายืนยันสัญญาก่อน", "You cannot pay yet. Please confirm the contract first."),
      );
      return;
    }

    if (method === "card") {
      const rawNumber = cardNumber.replace(/\s/g, "");
      if (rawNumber.length < 16) {
        toast.error(tr("กรุณากรอกหมายเลขบัตรเครดิตให้ครบ 16 หลัก", "Please enter all 16 digits of the card number"));
        return;
      }
      if (!cardName.trim()) {
        toast.error(tr("กรุณากรอกชื่อบนบัตร", "Please enter the name on the card"));
        return;
      }
      if (!isValidCardExpiry(cardExpiry)) {
        toast.error(tr("กรุณากรอกวันหมดอายุให้ถูกต้อง (MM/YY) และบัตรต้องยังไม่หมดอายุ", "Please enter a valid expiry date (MM/YY); the card must not be expired"));
        return;
      }
      if (cardCvv.length < 3) {
        toast.error(tr("กรุณากรอกรหัส CVV 3 หลัก", "Please enter the 3-digit CVV"));
        return;
      }
      // Demo decline: nothing is sent to the database; booking and contract stay unpaid.
      if (isDemoDeclinedCard(rawNumber)) {
        const msg =
          tr("บัตรถูกปฏิเสธ (DEMO) — ไม่มีการตัดเงิน การจองยังรอชำระเงิน กรุณาลองใหม่ด้วยบัตรอื่นหรือ QR Code", "Card declined (DEMO). No money was taken and the booking is still awaiting payment. Please try another card or the QR code.");
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

      const { error } =
        payKind === "booking_fee"
          ? await supabase.rpc("pay_booking", rpcParams)
          : await supabase.rpc("pay_pickup" as never, rpcParams as never);
      if (error) throw error;

      setCardName("");
      toast.success(
        payKind === "booking_fee"
          ? tr("ชำระค่าจองสำเร็จ (DEMO)! การจองได้รับการยืนยันแล้ว", "Booking fee paid (DEMO)! Your booking is confirmed.")
          : tr("ชำระยอดวันรับรถสำเร็จ (DEMO)! นำหลักฐานนี้ไปรับรถได้เลย", "Pickup amount paid (DEMO)! Show this receipt when you collect the car."),
      );
      await refreshAll();
    } catch (err: unknown) {
      const error = err as Error;
      const msg = trError(error.message) || tr("เกิดข้อผิดพลาดในการชำระเงิน กรุณาลองใหม่อีกครั้ง", "The payment failed. Please try again.");
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
      toast.error(tr("กรุณาทำเครื่องหมายยินยอมรับข้อกำหนดและเงื่อนไข", "Please tick the box to agree to the terms and conditions"));
      return;
    }
    setAcceptingContract(true);
    try {
      await acceptContract(contract.id, contract.sent_version);
      toast.success(
        tr(
          `ยืนยันสัญญาฉบับที่ ${contract.sent_version} แล้ว กรุณาชำระค่าจอง ${thb(BOOKING_FEE)} ภายใน 15 นาที`,
          `Contract version ${contract.sent_version} confirmed. Please pay the ${thb(BOOKING_FEE)} booking fee within 15 minutes.`,
        ),
      );
      setContractAgreed(false);
      await refreshAll();
    } catch (err: unknown) {
      toast.error(trError((err as Error).message) || tr("ไม่สามารถบันทึกการยอมรับสัญญาได้", "Could not save your confirmation"));
      await refreshAll();
    } finally {
      setAcceptingContract(false);
    }
  };

  // Prefill the request with what the sent version says now
  const openRevision = () => {
    const v = versions.find((x) => x.version === contract?.sent_version);
    const current = {
      customerName: v?.customer_name ?? "",
      pickupTime: bangkokTime(v?.pickup_at, "10:00"),
      returnTime: bangkokTime(v?.return_at, "18:00"),
    };
    setRevision(current);
    setRevisionOriginal(current);
    setRevisionOpen(true);
  };

  const handleRequestRevision = async () => {
    if (!contract || contract.sent_version === null || !booking || !user) return;
    const problem = revisionIsUnchanged
      ? trError(REVISION_UNCHANGED_MESSAGE)
      : revisionRequestError(revision, booking.start_date === booking.end_date);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSendingRevision(true);
    try {
      // A new name is only a request: the admin applies it (admin_apply_requested_name)
      await customerRequestRevision(
        contract.id,
        contract.sent_version,
        revisionReasonText(revision),
      );
      toast.success(tr("ส่งคำขอแก้ไขสัญญาแล้ว ผู้ดูแลจะจัดทำฉบับใหม่ให้", "Change request sent. Staff will prepare a new version."));
      setRevisionOpen(false);
      await refreshAll();
    } catch (err: unknown) {
      toast.error(trError((err as Error).message) || tr("ส่งคำขอแก้ไขไม่สำเร็จ", "Could not send the change request"));
    } finally {
      setSendingRevision(false);
    }
  };

  // Loading States
  if (authLoading || bookingLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-20 text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="mt-4 text-muted-foreground">{tr("กำลังโหลดข้อมูลการจองและสัญญาเช่า...", "Loading the booking and contract...")}</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-warning" />
        <h2 className="mt-4 text-2xl font-semibold">{tr("กรุณาเข้าสู่ระบบ", "Please sign in")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {tr("คุณต้องเข้าสู่ระบบเพื่อดูรายละเอียดการจองและชำระเงิน", "You need to sign in to see this booking and pay.")}
        </p>
        <Button className="mt-6 w-full" onClick={() => navigate({ to: "/auth" })}>
          {tr("เข้าสู่ระบบ / สมัครสมาชิก", "Sign in / Sign up")}
        </Button>
      </div>
    );
  }

  if (bookingError) {
    return (
      <LoadError title={tr("โหลดข้อมูลการจองไม่สำเร็จ", "Could not load the booking")} onRetry={() => void refetchBooking()}>
        <Button variant="outline" asChild>
          <Link to="/bookings">{tr("ไปที่การจองของฉัน", "Go to my bookings")}</Link>
        </Button>
      </LoadError>
    );
  }

  if (!booking) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
        <h2 className="mt-4 text-2xl font-semibold">{tr("ไม่พบข้อมูลการจอง", "Booking not found")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {tr("รหัสการจองไม่ถูกต้อง หรือคุณไม่มีสิทธิ์ในการเข้าถึงการจองนี้", "The booking code is wrong, or you do not have access to this booking.")}
        </p>
        <Button variant="outline" className="mt-6" asChild>
          <Link to="/cars">
            <ArrowLeft className="mr-2 h-4 w-4" /> {tr("กลับสู่หน้ารถเช่า", "Back to cars")}
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
  const feePayment = payments.find((p) => (p.kind ?? "booking_fee") === "booking_fee") ?? null;
  const pickupPayment = payments.find((p) => p.kind === "pickup") ?? null;
  // Which payment the customer can make now: the 1,000 fee, then the rest (before or at pickup)
  const payKind: "booking_fee" | "pickup" | null = !isOwner
    ? null
    : booking.status === "pending" && stage === "awaiting_payment"
      ? "booking_fee"
      : booking.status === "active" && // the admin confirmed the customer picked up the car
          Number(feePayment?.amount) === BOOKING_FEE && // not bookings that paid full rent before the fee
          !pickupPayment
        ? "pickup"
        : null;
  const canRespond = isOwner && canCustomerRespond(booking, contract, now);
  const revisionsLeft = Math.max(MAX_CUSTOMER_REVISIONS - customerRevisionCount(events), 0);
  const charges = rentalCharges(Number(booking.total_amount));
  const payAmount = payKind === "pickup" ? charges.dueAtPickup : BOOKING_FEE;
  const paymentOpen =
    payKind === "pickup" || (payKind === "booking_fee" && canPay(booking, contract, now));
  const holdText =
    booking.status !== "pending"
      ? null
      : holdExpired
        ? tr("หมดเวลาแล้ว", "Time is up")
        : stage === "awaiting_payment"
          ? tr(`ชำระภายใน ${formatCountdown(timeLeft)}`, `Pay within ${formatCountdown(timeLeft)}`)
          : tr(
              `ขั้นตอนนี้ต้องเสร็จภายใน ${formatCountdown(timeLeft)}`,
              `This step must be done within ${formatCountdown(timeLeft)}`,
            );

  const contractBlock = contract && (versions.length > 0 || contract.sent_version !== null) && (
    <Card className="border shadow-card print:border-0 print:shadow-none">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <FileCheck2 className="h-5 w-5 text-primary" />
          <CardTitle className="text-xl">{tr("สัญญาเช่ารถยนต์อิเล็กทรอนิกส์", "Electronic car rental contract")}</CardTitle>
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
            <ArrowLeft className="mr-1.5 h-4 w-4" /> {tr("การจองของฉัน", "My bookings")}
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">
            {isPaid
              ? tr("ยืนยันการจองและสัญญาเช่า", "Confirm booking and contract")
              : stage === "awaiting_payment"
                ? tr("ชำระค่าจอง", "Pay booking fee")
                : tr("สัญญาเช่ารถ", "Rental contract")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tr("หมายเลขการจอง:", "Booking code:")}{" "}
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
                {tr("ทะเบียน", "Plate")} {car?.plate_no} {tr("· เกียร์", "· Transmission")}{carSpecLabel(car?.transmission)} {tr("· เชื้อเพลิง", "· Fuel")}{carSpecLabel(car?.fuel)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="space-y-2 rounded-lg bg-muted/60 p-3.5">
                <div className="flex items-start gap-2.5">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <span className="font-medium text-foreground">{tr("สถานที่รับรถ:", "Pickup location:")}</span>
                    <p className="text-muted-foreground">{pickupLocationLabel(booking.pickup_location)}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <span className="font-medium text-foreground">
                      {tr("ระยะเวลาเช่า (", "Rental period (")}{booking.days} วัน):
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
                          {tr("(ถึง", "(until")} {fmtDateTime(booking.hold_expires_at)})
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex justify-between text-muted-foreground">
                  <span>{tr("ค่าเช่ารายวัน", "Daily rate")}</span>
                  <span>{thb(car?.price_per_day)} {tr("/ วัน", "/ day")}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>{tr("ค่าเช่า (", "Rent (")}{booking.days} วัน)</span>
                  <span>{thb(charges.rent)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>{tr("เงินประกันความเสียหาย (เท่ากับค่าเช่า)", "Damage deposit (equal to the rent)")}</span>
                  <span>{thb(charges.insurance)}</span>
                </div>
                <Separator />
                <div className="flex items-baseline justify-between pt-1">
                  <span className="text-base font-semibold text-foreground">
                    {tr("1. ชำระออนไลน์ (ค่าจอง)", "1. Paid online (booking fee)")}
                  </span>
                  <span className="font-display text-2xl font-bold text-primary">
                    {thb(charges.fee)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold text-foreground">{tr("2. ชำระ ณ วันรับรถ", "2. Paid on the pickup day")}</span>
                  <span className="font-semibold text-foreground" data-testid="due-at-pickup">
                    {thb(charges.dueAtPickup)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {tr("ยอดวันรับรถ = ค่าเช่า + เงินประกัน − ค่าจองที่จ่ายไปแล้ว · ค่าจองไม่คืนเมื่อยกเลิกการจอง · เงินประกัน", "Pickup amount = rent + deposit − booking fee already paid · the booking fee is non-refundable · the deposit")} {thb(charges.insurance)}{" "}
                  {tr("ได้รับคืนเมื่อนำรถมาคืน", "returned when you bring the car back")}
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2 rounded-xl border bg-card p-4 text-sm text-muted-foreground shadow-sm">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <span>{tr("ขั้นตอนการเช่า", "How renting works")}</span>
            </div>
            <ol className="list-decimal space-y-0.5 pl-5 text-xs leading-relaxed">
              <li>{tr("ผู้ดูแลยืนยันการจองและส่งฉบับร่างสัญญาให้คุณ", "Staff confirm the booking and send you a draft contract")}</li>
              <li>{tr("คุณตรวจสอบสัญญา ขอแก้ไขได้ แล้วกดยืนยัน", "You review the contract, ask for changes if needed, then confirm")}</li>
              <li>{tr("ชำระค่าจอง", "Pay booking fee")} {thb(BOOKING_FEE)} ด้วย QR หรือบัตร ภายใน 15 นาทีหลังยืนยัน (DEMO)</li>
              <li>
                {tr("วันรับรถ เมื่อผู้ดูแลยืนยันว่าคุณมารับรถ QR สำหรับชำระค่าเช่า + เงินประกัน (หักค่าจองแล้ว) จะขึ้นที่หน้านี้", "On the pickup day, once staff confirm you have collected the car, a QR code for rent + deposit (minus the booking fee) appears on this page")}
              </li>
              <li>{tr("คืนรถ รับเงินประกันคืน", "Return the car and get your deposit back")}</li>
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
                  {tr("การจองนี้เป็นของลูกค้า มีเพียงลูกค้าเจ้าของการจองเท่านั้นที่ยอมรับสัญญาและชำระเงินได้ จัดการสัญญาได้ที่แดชบอร์ดผู้ดูแล", "This booking belongs to a customer. Only that customer can confirm the contract and pay. Manage contracts from the admin dashboard.")}
                  {holdText && ` · ${holdText}`}
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {booking.status === "pending" && isOwner && stage === "awaiting_contract" && (
            <StageCard
              icon={<Hourglass className="h-6 w-6 text-warning" />}
              title={contract?.sent_version ? tr("ผู้ดูแลกำลังแก้ไขสัญญา", "Staff are updating the contract") : tr("รอผู้ดูแลจัดทำสัญญาเช่า", "Waiting for staff to prepare the contract")}
              text={
                contract?.sent_version
                  ? tr("ผู้ดูแลกำลังจัดทำสัญญาฉบับใหม่ คุณจะต้องตรวจสอบและยอมรับฉบับใหม่อีกครั้ง ฉบับก่อนหน้าแสดงไว้ด้านล่าง", "Staff are preparing a new version. You will need to review and confirm it again. The previous version is shown below.")
                  : tr("ผู้ดูแลจะจัดทำสัญญาจากข้อมูลการจองของคุณ เมื่อส่งแล้วคุณจะเห็นสัญญาที่หน้านี้ ยังไม่ต้องชำระเงิน", "Staff will prepare the contract from your booking. Once sent, it will appear on this page. No payment is needed yet.")
              }
            />
          )}

          {booking.status === "pending" && isOwner && stage === "review_contract" && (
            <Card className="border-warning/40 bg-warning/5 shadow-card print:hidden">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">
                  {tr("กรุณาตรวจสอบสัญญาฉบับที่", "Please review contract version")} {contract?.sent_version}
                </CardTitle>
                <CardDescription>
                  {tr(
                    `อ่านฉบับร่างสัญญาด้านล่าง ถ้าต้องการเปลี่ยนอะไร กด "ขอแก้ไขสัญญา" ผู้ดูแลจะส่งฉบับใหม่ให้ ถ้าถูกต้องแล้วกดยืนยัน จากนั้นชำระค่าจอง ${thb(BOOKING_FEE)} ภายใน 15 นาที`,
                    `Read the draft contract below. To change anything, press "Request changes" and staff will send a new version. If it is correct, confirm it, then pay the ${thb(BOOKING_FEE)} booking fee within 15 minutes.`,
                  )}
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
                    {tr("ข้าพเจ้าได้อ่าน เข้าใจ และยินยอมปฏิบัติตามข้อกำหนดและเงื่อนไขในสัญญาเช่าฉบับที่", "I have read, understood and agree to the terms and conditions of rental contract version")}{" "}
                    {contract?.sent_version} {tr("ทุกประการ", "in full")}
                  </Label>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    className="flex-1"
                    disabled={!canRespond || !contractAgreed || acceptingContract}
                    onClick={handleAcceptContract}
                  >
                    {acceptingContract
                      ? tr("กำลังบันทึก...", "Saving...")
                      : tr(`ยืนยันสัญญาฉบับที่ ${contract?.sent_version}`, `Confirm contract version ${contract?.sent_version}`)}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={!canRespond || revisionsLeft === 0}
                    onClick={openRevision}
                  >
                    <MessageSquareWarning className="mr-1.5 h-4 w-4" /> {tr("ขอแก้ไขสัญญา", "Request changes")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground" data-testid="revisions-left">
                  {revisionsLeft > 0
                    ? tr(
                        `ขอแก้ไขได้อีก ${revisionsLeft} ครั้ง (สูงสุด ${MAX_CUSTOMER_REVISIONS} ครั้งต่อการจอง)`,
                        `${revisionsLeft} change request(s) left (max ${MAX_CUSTOMER_REVISIONS} per booking)`,
                      )
                    : tr(
                        `ขอแก้ไขครบ ${MAX_CUSTOMER_REVISIONS} ครั้งแล้ว กรุณายืนยันสัญญา หรือยกเลิกการจองหากไม่ต้องการเช่าต่อ`,
                        `You have used all ${MAX_CUSTOMER_REVISIONS} change requests. Please confirm the contract, or cancel the booking if you no longer want it.`,
                      )}
                </p>
              </CardContent>
            </Card>
          )}

          {booking.status === "pending" && isOwner && stage === "awaiting_approval" && (
            <StageCard
              icon={<CheckCircle2 className="h-6 w-6 text-success" />}
              title={tr("ยอมรับสัญญาแล้ว รอผู้ดูแลอนุมัติ", "Contract confirmed, waiting for staff approval")}
              text={tr(
                `คุณยอมรับสัญญาเมื่อ ${fmtDateTime(contract?.customer_accepted_at)} เมื่อผู้ดูแลอนุมัติ คุณจะชำระเงินได้ภายใน 15 นาที`,
                `You confirmed the contract on ${fmtDateTime(contract?.customer_accepted_at)}. Once staff approve it, you can pay within 15 minutes.`,
              )}
            />
          )}

          {booking.status === "pending" && isOwner && stage === "revision_requested" && (
            <StageCard
              icon={<MessageSquareWarning className="h-6 w-6 text-orange-600" />}
              title={tr("กำลังแก้ไขสัญญา", "Contract being updated")}
              text={tr("ผู้ดูแลจะจัดทำสัญญาฉบับใหม่ คุณจะต้องตรวจสอบและยอมรับฉบับใหม่อีกครั้งก่อนชำระเงิน", "Staff will prepare a new version. You will need to review and confirm it again before paying.")}
            />
          )}

          {isOwner &&
            booking.status === "confirmed" &&
            Number(feePayment?.amount) === BOOKING_FEE &&
            !pickupPayment && (
              <StageCard
                icon={<Hourglass className="h-6 w-6 text-primary" />}
                title={tr("ชำระค่าจองแล้ว · ชำระยอดที่เหลือเมื่อมารับรถ", "Booking fee paid · pay the rest when you pick up the car")}
                text={tr(
                  `วันรับรถ ${fmtDate(booking.start_date)} เมื่อผู้ดูแลยืนยันว่าคุณมารับรถแล้ว QR สำหรับชำระ ${thb(charges.dueAtPickup)} (ค่าเช่า + เงินประกัน − ค่าจอง) จะขึ้นที่หน้านี้โดยอัตโนมัติ`,
                  `Pickup day ${fmtDate(booking.start_date)}: once staff confirm you have collected the car, a QR code to pay ${thb(charges.dueAtPickup)} (rent + deposit − booking fee) appears here automatically.`,
                )}
                testId="pickup-waiting"
              />
            )}

          {/* Payment: the booking fee once the contract is confirmed, then the pickup amount
              once the admin has marked the car handed over (active) */}
          {payKind && (
            <Card className="border shadow-card" data-testid="payment-card">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-xl">
                    {payKind === "pickup" ? tr("ชำระยอดวันรับรถ", "Pay pickup amount") : tr("เลือกช่องทางชำระเงิน", "Choose a payment method")}
                  </CardTitle>
                  <Badge variant="outline" className="border-amber-400 bg-amber-100 text-amber-900">
                    {tr("DEMO · ไม่มีการตัดเงินจริง", "DEMO · no real charge")}
                  </Badge>
                </div>
                {payKind === "pickup" ? (
                  <CardDescription data-testid="pickup-breakdown">
                    {tr("ผู้ดูแลยืนยันว่าคุณมารับรถแล้ว · กรุณาชำระยอดวันรับรถ: ค่าเช่า", "Staff confirmed you have picked up the car · please pay the pickup amount: rent")}{" "}
                    {thb(charges.rent)} {tr("+ เงินประกัน", "+ deposit")} {thb(charges.insurance)} {tr("− ค่าจอง", "− booking fee")}{" "}
                    {thb(charges.fee)} ={" "}
                    <strong className="text-foreground">{thb(charges.dueAtPickup)}</strong>
                    {" · "}{tr("เงินประกันได้รับคืนเมื่อนำรถมาคืนตามสภาพเดิม", "The deposit is returned when the car is returned in its original condition")}
                  </CardDescription>
                ) : (
                  <CardDescription>
                    {tr("ยืนยันสัญญาแล้ว · ค่าจอง (ไม่ว่าจะเช่ากี่วัน):", "Contract confirmed · booking fee (whatever the rental length):")}{" "}
                    <strong className="text-foreground">{thb(BOOKING_FEE)}</strong>
                    {" · "}
                    {holdExpired ? (
                      <span className="font-semibold text-destructive">{tr("หมดเวลาชำระเงินแล้ว", "Payment time is up")}</span>
                    ) : (
                      <span>
                        {tr("กรุณาชำระภายใน", "Please pay within")}{" "}
                        <span className="font-mono font-bold text-warning">
                          {formatCountdown(timeLeft)}
                        </span>
                      </span>
                    )}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                {paymentError && (
                  <div
                    role="alert"
                    className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">{tr("ชำระเงินไม่สำเร็จ (DEMO)", "Payment failed (DEMO)")}</p>
                      <p className="text-xs">
                        {paymentError} {tr("— ยังไม่มีการตัดเงิน กรุณาลองใหม่อีกครั้ง", "— no money was taken. Please try again.")}
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
                      <CreditCard className="h-4 w-4" /> {tr("บัตรเครดิต / เดบิต", "Credit / debit card")}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="qr" className="space-y-6 focus-visible:outline-none">
                    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-muted/30 p-6 text-center">
                      {payKind === "booking_fee" && (
                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <Clock className="h-3.5 w-3.5 text-warning" />
                          <span>
                            {tr("หมดอายุใน:", "Expires in:")}{" "}
                            <span className="font-mono font-bold text-warning">
                              {formatCountdown(timeLeft)}
                            </span>
                          </span>
                        </div>
                      )}
                      {/* Demo QR: not a PromptPay payload, so a real banking app cannot pay it */}
                      <div className="relative rounded-2xl border bg-white p-4 shadow-sm">
                        <QRCodeSVG
                          value={demoQrValue(booking.booking_code, payAmount)}
                          size={190}
                          level="M"
                          includeMargin={false}
                          aria-label={tr("QR Code ตัวอย่างสำหรับการสาธิต ใช้ชำระเงินจริงไม่ได้", "Sample QR code for the demo; it cannot be used for real payments")}
                        />
                        <span className="absolute -right-2 -top-2 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-950">
                          DEMO
                        </span>
                      </div>
                      <div className="mt-4 space-y-1">
                        <p className="text-sm font-semibold text-foreground">
                          {tr("ไดร์ฟดี รถเช่า (Drive Dee)", "Drive Dee Car Rental")}
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {tr("เลขอ้างอิง:", "Reference:")} {booking.booking_code}
                        </p>
                        <p className="mt-1 font-display text-xl font-bold text-primary">
                          {thb(payAmount)}
                        </p>
                      </div>
                      <div className="mt-4 max-w-xs space-y-1 rounded-lg border bg-card p-3 text-left text-xs text-muted-foreground">
                        <p className="font-medium text-foreground">{tr("ขั้นตอนการชำระเงิน (สาธิต):", "How to pay (demo):")}</p>
                        <p>{tr("1. QR Code นี้เป็นตัวอย่าง ไม่ต้องสแกนด้วยแอปธนาคาร", "1. This QR code is a sample; do not scan it with a banking app")}</p>
                        <p>{tr("2. ตรวจสอบยอดเงินและเลขอ้างอิงให้ถูกต้อง", "2. Check the amount and reference")}</p>
                        <p>{tr(`3. กดปุ่ม "จำลองยืนยันการชำระเงิน" ด้านล่าง`, `3. Press "Simulate payment confirmation" below`)}</p>
                      </div>
                    </div>
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                      <strong>{tr("โหมดสาธิต (DEMO):", "Demo mode (DEMO):")}</strong> {tr("ไม่มีการโอนหรือตัดเงินจริง กดปุ่มด้านล่างเพื่อจำลองการชำระเงิน", "No real transfer or charge. Press the button below to simulate the payment.")}
                    </div>
                    <Button
                      size="lg"
                      className="w-full text-base font-medium shadow-md"
                      disabled={submittingPayment || !paymentOpen}
                      onClick={() => handlePayment("qr")}
                    >
                      {submittingPayment
                        ? tr("กำลังตรวจสอบการชำระเงิน...", "Checking the payment...")
                        : tr("จำลองยืนยันการชำระเงินผ่าน QR Code", "Simulate QR code payment")}
                    </Button>
                  </TabsContent>

                  <TabsContent value="card" className="space-y-4 focus-visible:outline-none">
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="card-name" className="text-xs">
                          {tr("ชื่อบนบัตร (Cardholder Name)", "Cardholder name")}
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
                          {tr("หมายเลขบัตร 16 หลัก", "16-digit card number")}
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
                            {tr("วันหมดอายุ (MM/YY)", "Expiry (MM/YY)")}
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
                            {tr("รหัสความปลอดภัย (CVV)", "Security code (CVV)")}
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
                        <strong>{tr("โหมดสาธิต (DEMO):", "Demo mode (DEMO):")}</strong> {tr("ไม่มีการตัดเงินจริง กรุณา", "No real charge. Please")}
                        <strong>{tr("อย่ากรอกข้อมูลบัตรจริง", "do not enter real card details")}</strong>
                        {tr("ระบบบันทึกเฉพาะเลข 4 หลักสุดท้ายเพื่อแสดงในประวัติ", "Only the last 4 digits are stored, for your history.")}
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
                        {tr("กรอกบัตรทดสอบ (", "Fill in test card (")}{DEMO_CARD.number})
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
                        {tr("บัตรทดสอบถูกปฏิเสธ (…0002)", "Declined test card (…0002)")}
                      </Button>
                    </div>
                    <Button
                      size="lg"
                      className="w-full text-base font-medium shadow-md"
                      disabled={submittingPayment || !paymentOpen}
                      onClick={() => handlePayment("card")}
                    >
                      {submittingPayment
                        ? tr("กำลังประมวลผลบัตรเครดิต...", "Processing card...")
                        : payKind === "pickup"
                          ? tr(`จำลองชำระยอดวันรับรถ ${thb(payAmount)} (DEMO)`, `Simulate paying the pickup amount ${thb(payAmount)} (DEMO)`)
                          : tr(`จำลองชำระค่าจอง ${thb(BOOKING_FEE)} (DEMO)`, `Simulate paying the ${thb(BOOKING_FEE)} booking fee (DEMO)`)}
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
                      {tr("การจองได้รับการยืนยันแล้ว", "Your booking is confirmed")}
                    </CardTitle>
                    <CardDescription>
                      {tr("สามารถนำหลักฐานนี้ไปรับรถตามวันและเวลาที่กำหนดในสัญญา", "Show this receipt when you collect the car at the date and time in your contract.")}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <ReceiptCustomer
                  loading={receiptQ.isLoading}
                  failed={receiptQ.isError}
                  details={receiptQ.data ?? null}
                  bookingNo={booking.booking_code}
                />
                <p className="text-xs font-medium text-muted-foreground">{tr("ค่าจอง", "Booking fee")}</p>
                <PaymentDetails loading={paymentLoading} payment={feePayment} />
                {pickupPayment ? (
                  <>
                    <p className="text-xs font-medium text-muted-foreground">
                      {tr("ยอดวันรับรถ (ค่าเช่า + เงินประกัน − ค่าจอง)", "Pickup amount (rent + deposit − booking fee)")}
                    </p>
                    <PaymentDetails loading={false} payment={pickupPayment} />
                    <p className="text-xs text-muted-foreground" data-testid="paid-in-full">
                      {tr("ชำระครบแล้ว · เงินประกัน", "Paid in full · deposit")} {thb(charges.insurance)} {tr("ได้รับคืนเมื่อนำรถมาคืน", "returned when you bring the car back")}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {tr("ยอดวันรับรถที่ยังต้องชำระ:", "Pickup amount still due:")}{" "}
                    <strong className="text-foreground">{thb(charges.dueAtPickup)}</strong> {tr("(ค่าเช่า", "(rent")}{" "}
                    {thb(charges.rent)} {tr("+ เงินประกัน", "+ deposit")} {thb(charges.insurance)} {tr("− ค่าจอง", "− booking fee")}{" "}
                    {thb(charges.fee)}) · {tr("เงินประกันได้รับคืนเมื่อคืนรถ", "the deposit is returned when you return the car")}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {booking.status === "cancelled" && (
            <Card className="border-destructive/30 bg-destructive/5 shadow-card">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <AlertCircle className="h-6 w-6 text-destructive" />
                  <CardTitle className="text-lg text-destructive">{tr("การจองนี้ถูกยกเลิกแล้ว", "This booking has been cancelled")}</CardTitle>
                </div>
                <CardDescription>
                  {tr("รายการจองนี้ถูกยกเลิกหรือหมดเวลาแล้ว ไม่สามารถทำสัญญาหรือชำระเงินได้", "This booking was cancelled or expired. You can no longer confirm a contract or pay.")}
                </CardDescription>
              </CardHeader>
              {payments.length > 0 && (
                <CardContent className="space-y-3 text-sm">
                  {payments.map((p) => (
                    <PaymentDetails key={p.id} loading={false} payment={p} />
                  ))}
                </CardContent>
              )}
              <CardFooter>
                <Button asChild>
                  <Link to="/cars">
                    <CarIcon className="mr-1.5 h-4 w-4" /> {tr("ค้นหาและจองรถคันใหม่", "Find and book another car")}
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
                  <FileText className="mr-1.5 h-4 w-4" /> {tr("ดูรายการจองทั้งหมดของฉัน", "View all my bookings")}
                </Link>
              </Button>
              <Button asChild>
                <Link to="/cars">
                  <CarIcon className="mr-1.5 h-4 w-4" /> {tr("ค้นหารถคันอื่นเพิ่มเติม", "Browse more cars")}
                </Link>
              </Button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={revisionOpen} onOpenChange={setRevisionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("ขอแก้ไขสัญญาฉบับที่", "Request changes to contract version")} {contract?.sent_version}</DialogTitle>
            <DialogDescription>
              {tr("แก้ชื่อหรือเวลาที่ต้องการ ผู้ดูแลจะตรวจสอบและจัดทำฉบับใหม่ให้คุณยืนยันอีกครั้ง (ชื่อในโปรไฟล์จะเปลี่ยนเมื่อผู้ดูแลยืนยันการแก้ไข)", "Change the name or times you need. Staff will check and prepare a new version for you to confirm (your profile name changes once staff accept it).")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="revision-name" className="text-xs">
                {tr("ชื่อลูกค้า", "Customer name")}
              </Label>
              <Input
                id="revision-name"
                className="mt-1"
                value={revision.customerName}
                maxLength={100}
                autoComplete="name"
                onChange={(e) => setRevision((r) => ({ ...r, customerName: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="revision-pickup" className="text-xs">
                  {tr("เวลารับรถ (", "Pickup time (")}{booking && fmtDate(booking.start_date)})
                </Label>
                <Input
                  id="revision-pickup"
                  type="time"
                  className="mt-1"
                  min={OPENING_TIME}
                  max={CLOSING_TIME}
                  value={revision.pickupTime}
                  onChange={(e) => setRevision((r) => ({ ...r, pickupTime: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="revision-return" className="text-xs">
                  {tr("เวลาคืนรถ (", "Return time (")}{booking && fmtDate(booking.end_date)})
                </Label>
                <Input
                  id="revision-return"
                  type="time"
                  className="mt-1"
                  min={OPENING_TIME}
                  max={CLOSING_TIME}
                  value={revision.returnTime}
                  onChange={(e) => setRevision((r) => ({ ...r, returnTime: e.target.value }))}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {tr("รับและคืนรถได้ระหว่าง", "Pickup and return between")} {OPENING_TIME}-{CLOSING_TIME} {tr("น.", "")}
            </p>
            {revisionIsUnchanged && (
              <p
                className="text-xs text-amber-700 dark:text-amber-400"
                data-testid="revision-unchanged"
              >
                {tr("ยังไม่ได้แก้ไขข้อมูลใด เปลี่ยนชื่อหรือเวลาที่ต้องการก่อนส่งคำขอ (การขอแก้ไขแต่ละครั้งนับเป็น 1 สิทธิ์)", "Nothing has changed yet. Change the name or a time before sending (each request uses one of your requests).")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisionOpen(false)}>
              {tr("ยกเลิก", "Cancel")}
            </Button>
            <Button
              onClick={handleRequestRevision}
              disabled={sendingRevision || revisionIsUnchanged}
            >
              {sendingRevision ? tr("กำลังส่ง...", "Sending...") : tr("ส่งคำขอแก้ไข", "Send change request")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StageCard({
  icon,
  title,
  text,
  testId = "stage-card",
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  testId?: string;
}) {
  return (
    <Card className="border shadow-card" data-testid={testId}>
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

function ReceiptField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}:</span>
      <p className={`break-all text-foreground ${mono ? "font-mono" : "font-medium"}`}>
        {value?.trim() ? value : "-"}
      </p>
    </div>
  );
}

/** Customer and contract details printed on the receipt. */
function ReceiptCustomer({
  loading,
  failed,
  details,
  bookingNo,
}: {
  loading: boolean;
  failed: boolean;
  details: ReceiptDetails | null;
  bookingNo: string | null;
}) {
  if (loading) {
    return (
      <p className="rounded-lg border bg-card p-3 text-muted-foreground" role="status">
        {tr("กำลังโหลดข้อมูลลูกค้า...", "Loading customer details...")}
      </p>
    );
  }
  if (failed || !details) {
    return (
      <p className="rounded-lg border bg-card p-3 text-muted-foreground">
        {tr("โหลดข้อมูลลูกค้าบนใบเสร็จไม่สำเร็จ กรุณารีเฟรชหน้านี้", "Could not load the customer details for the receipt. Please refresh the page.")}
      </p>
    );
  }
  return (
    <div className="space-y-3" data-testid="receipt-customer">
      <p className="text-xs font-medium text-muted-foreground">{tr("ข้อมูลลูกค้า", "Customer details")}</p>
      <div className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-3">
        <ReceiptField label={tr("ชื่อ-นามสกุล", "Full name")} value={details.customer_name} />
        <ReceiptField label={tr("อีเมล", "Email")} value={details.customer_email} />
        <ReceiptField label={tr("เบอร์โทรศัพท์", "Phone")} value={details.customer_phone} mono />
        <ReceiptField label={tr("เลขบัตรประชาชน / พาสปอร์ต", "ID card / passport number")} value={details.customer_id_card_no} mono />
        <ReceiptField label={tr("เลขใบอนุญาตขับขี่", "Driving licence number")} value={details.customer_license_no} mono />
        <ReceiptField label={tr("รหัสการจอง", "Booking code")} value={bookingNo} mono />
        <div className="col-span-2">
          <ReceiptField label={tr("ที่อยู่", "Address")} value={details.customer_address} />
        </div>
      </div>
      <p className="text-xs font-medium text-muted-foreground">{tr("ข้อมูลสัญญา", "Contract details")}</p>
      <div className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-3">
        <ReceiptField label={tr("เลขที่สัญญา", "Contract number")} value={details.contract_no} mono />
        <ReceiptField label={tr("ผู้จัดทำสัญญา (แอดมิน)", "Contract prepared by (staff)")} value={details.contract_created_by_name} />
      </div>
    </div>
  );
}

function PaymentDetails({ loading, payment }: { loading: boolean; payment: PaymentRow | null }) {
  if (loading) {
    return (
      <p className="rounded-lg border bg-card p-3 text-muted-foreground" role="status">
        {tr("กำลังโหลดรายละเอียดการชำระเงิน...", "Loading payment details...")}
      </p>
    );
  }
  if (!payment) {
    return (
      <p className="rounded-lg border bg-card p-3 text-muted-foreground">
        {tr("ไม่พบรายละเอียดการชำระเงินของการจองนี้", "No payment details found for this booking")}
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
        <span className="text-xs text-muted-foreground">{tr("ช่องทางชำระ:", "Payment method:")}</span>
        <p className="font-medium capitalize text-foreground">
          {payment.method === "qr"
            ? "QR PromptPay (DEMO)"
            : tr(
                `บัตรเครดิต (••• ${payment.card_last4 ?? "XXXX"}) (DEMO)`,
                `Credit card (••• ${payment.card_last4 ?? "XXXX"}) (DEMO)`,
              )}
        </p>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">{tr("รหัสอ้างอิงการชำระ:", "Payment reference:")}</span>
        <p className="break-all font-mono text-foreground">{payment.reference ?? "-"}</p>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">{tr("ยอดเงินที่ชำระ:", "Amount paid:")}</span>
        <p className="font-semibold text-primary">{thb(payment.amount)}</p>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">{tr("วันที่ชำระเงิน:", "Paid on:")}</span>
        <p className="text-foreground">{fmtDateTime(payment.paid_at)}</p>
      </div>
      {refund && (
        <div className="col-span-2" data-testid="refund-status">
          <span className="text-xs text-muted-foreground">{tr("สถานะการคืนเงิน:", "Refund status:")}</span>
          <p className="font-medium text-destructive">{refund}</p>
        </div>
      )}
    </div>
  );
}
