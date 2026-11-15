import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  Car as CarIcon,
  Clock,
  CreditCard,
  FileCheck2,
  MapPin,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/load-error";
import { formatCountdown, holdSecondsLeft } from "@/lib/payment-window";
import { customerStage, customerStageLabel, type CustomerStage } from "@/lib/contract-workflow";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { carImage } from "@/lib/car-images";
import { categoryLabel, fmtDate, pickupLocationLabel, thb } from "@/lib/format";
import { BOOKING_FEE, rentalCharges } from "@/lib/booking-fee";
import {
  bookingContract,
  customerBookingsQuery,
  invalidateBookingData,
  workflowContract,
  type CustomerBooking,
  cancellationMoney,
} from "@/lib/queries";
import { tr, trError } from "@/lib/i18n";

export const Route = createFileRoute("/bookings")({
  head: () => ({
    meta: [
      { title: "ประวัติการจองของฉัน — Drive Dee" },
      { name: "description", content: "ตรวจสอบประวัติการเช่ารถยนต์ รายละเอียดการชำระเงิน และสัญญาเช่าดิจิทัล" },
      { property: "og:title", content: "การจองของฉัน — Drive Dee" },
    ],
  }),
  component: BookingsHistoryPage,
});

type BookingWithCar = CustomerBooking;

function BookingsHistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<string>("all");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Ticks the payment countdown shown on unpaid bookings
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // Fetch all customer bookings with car and contract
  const {
    data: bookings = [],
    isLoading: bookingsLoading,
    isError: bookingsError,
    refetch: refetchBookings,
  } = useQuery({
    ...customerBookingsQuery(user?.id ?? ""),
    enabled: !!user,
  });

  // Handle booking cancellation
  const handleCancelBooking = async () => {
    if (!cancellingId || !user) return;
    setCancelling(true);
    try {
      const { error } = await supabase
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", cancellingId)
        .eq("user_id", user.id);

      if (error) throw error;

      toast.success(tr("ยกเลิกการจองเรียบร้อยแล้ว", "Booking cancelled"));
      setCancellingId(null);
      // Cancelling frees the car, so availability caches must refresh too
      await invalidateBookingData(queryClient);
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(trError(error.message) || tr("ไม่สามารถยกเลิกการจองได้", "Could not cancel the booking"));
    } finally {
      setCancelling(false);
    }
  };

  const cancellingBooking = bookings.find((b) => b.id === cancellingId);

  // Each booking's place in the contract workflow
  const stageOf = (b: BookingWithCar): CustomerStage =>
    customerStage(b, workflowContract(bookingContract(b)));
  const TABS: { value: string; label: string; stages: CustomerStage[] }[] = [
    { value: "contract", label: tr("รอสัญญา", "Awaiting contract"), stages: ["awaiting_contract"] },
    { value: "review", label: tr("รอตรวจสัญญา", "Review contract"), stages: ["review_contract"] },
    { value: "approval", label: tr("ขอแก้ไขสัญญา", "Changes requested"), stages: ["awaiting_approval", "revision_requested"] },
    { value: "payment", label: tr("รอชำระเงิน", "Awaiting payment"), stages: ["awaiting_payment"] },
    { value: "active", label: tr("ยืนยันแล้ว/กำลังเช่า", "Confirmed / in progress"), stages: ["confirmed"] },
    { value: "completed", label: tr("เสร็จสิ้น", "Completed"), stages: ["completed"] },
    { value: "cancelled", label: tr("ยกเลิก", "Cancelled"), stages: ["cancelled"] },
  ];
  const countFor = (stages: CustomerStage[]) => bookings.filter((b) => stages.includes(stageOf(b))).length;

  // Filter bookings based on active tab
  const filteredBookings = bookings.filter((b) => {
    if (activeTab === "all") return true;
    const tab = TABS.find((t) => t.value === activeTab);
    return tab ? tab.stages.includes(stageOf(b)) : true;
  });

  // Loading state
  if (authLoading || bookingsLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-20 text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="mt-4 text-muted-foreground">{tr("กำลังโหลดประวัติการจองของคุณ...", "Loading your bookings...")}</p>
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-warning" />
        <h2 className="mt-4 text-2xl font-semibold">{tr("กรุณาเข้าสู่ระบบ", "Please sign in")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{tr("คุณต้องเข้าสู่ระบบก่อนจึงจะสามารถดูประวัติการจองของคุณได้", "You need to sign in to see your bookings.")}</p>
        <Button className="mt-6 w-full" onClick={() => navigate({ to: "/auth" })}>
          {tr("เข้าสู่ระบบ / สมัครสมาชิก", "Sign in / Sign up")}
        </Button>
      </div>
    );
  }

  if (bookingsError) {
    return <LoadError title={tr("โหลดประวัติการจองไม่สำเร็จ", "Could not load your bookings")} onRetry={() => void refetchBookings()} />;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {/* Page Header */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{tr("การจองของฉัน", "My bookings")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tr("ติดตามสถานะการจอง ชำระเงิน และตรวจสอบสัญญาเช่าดิจิทัล", "Track your bookings, payments and digital rental contracts")}
          </p>
        </div>
        <Button asChild>
          <Link to="/cars">
            <CarIcon className="mr-1.5 h-4 w-4" /> {tr("จองรถคันใหม่", "Book a new car")}
          </Link>
        </Button>
      </div>

      {/* Status Filter Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4 [&>button]:whitespace-normal">
          <TabsTrigger value="all">{tr("ทั้งหมด (", "All (")}{bookings.length})</TabsTrigger>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label} ({countFor(t.stages)})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Bookings List */}
      {filteredBookings.length === 0 ? (
        <Card className="shadow-card border text-center py-16 px-4">
          <CarIcon className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">{tr("ไม่พบรายการจอง", "No bookings found")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeTab === "all"
              ? tr("คุณยังไม่มีประวัติการจองรถยนต์ เลือกรถที่ถูกใจแล้วออกเดินทางได้ทันที", "You have no bookings yet. Pick a car you like and hit the road.")
              : tr("ไม่พบรายการจองในหมวดหมู่นี้", "No bookings in this category")}
          </p>
          <div className="mt-6">
            <Button asChild>
              <Link to="/cars">{tr("ค้นหารถเช่า", "Search cars")}</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredBookings.map((b) => {
            const car = b.cars;
            const canCancel = b.status === "pending" || b.status === "confirmed";
            const stage = stageOf(b);
            const secondsLeft = holdSecondsLeft(b, now);

            return (
              <Card key={b.id} className="overflow-hidden shadow-card border transition hover:shadow-md">
                <div className="grid gap-4 sm:grid-cols-12 items-center p-5">
                  {/* Car Image (3 Cols) */}
                  <div className="relative aspect-[16/10] sm:col-span-3 rounded-lg overflow-hidden bg-muted">
                    <img
                      src={carImage(car?.image_url, car?.category)}
                      alt={`${car?.brand} ${car?.model}`}
                      className="h-full w-full object-cover"
                    />
                    <Badge className="absolute left-2 top-2 text-[10px]" variant="secondary">
                      {categoryLabel[car?.category || ""] || car?.category}
                    </Badge>
                  </div>

                  {/* Booking Details (6 Cols) */}
                  <div className="space-y-2 sm:col-span-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-muted-foreground">
                        {b.booking_code}
                      </span>
                      <StatusBadge status={b.status} kind="booking" />
                      {b.status === "pending" && <Badge variant="outline">{customerStageLabel[stage]}</Badge>}
                    </div>

                    <h3 className="text-lg font-bold">
                      {car?.brand} {car?.model} ({car?.year})
                    </h3>

                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span>
                          {fmtDate(b.start_date)} — {fmtDate(b.end_date)} ({b.days} {tr("วัน", "days")})
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="truncate">{pickupLocationLabel(b.pickup_location)}</span>
                      </div>
                    </div>

                    {b.status === "pending" && (
                      <p className="flex items-center gap-1.5 text-xs font-medium text-warning" role="timer">
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                        {secondsLeft === 0
                          ? tr("หมดเวลาแล้ว การจองจะถูกยกเลิก", "Time is up. The booking will be cancelled.")
                          : stage === "awaiting_payment"
                            ? tr(`ชำระเงินภายใน ${formatCountdown(secondsLeft)}`, `Pay within ${formatCountdown(secondsLeft)}`)
                            : tr(
                                `ขั้นตอนนี้ต้องเสร็จภายใน ${formatCountdown(secondsLeft)}`,
                                `This step must be done within ${formatCountdown(secondsLeft)}`,
                              )}
                      </p>
                    )}

                  </div>

                  {/* Price & Actions (3 Cols) */}
                  <div className="flex flex-col sm:items-end justify-between gap-3 sm:col-span-3 border-t sm:border-t-0 sm:border-l sm:pl-4 pt-3 sm:pt-0">
                    <div className="sm:text-right">
                      <span className="text-xs text-muted-foreground">{tr("ค่าเช่ารวม", "Total rent")}</span>
                      <p className="font-display text-xl font-bold text-primary">
                        {thb(b.total_amount)}
                      </p>
                      {b.status === "pending" && (
                        <p className="text-xs text-muted-foreground" data-testid="fee-breakdown">
                          {tr("ค่าจองออนไลน์", "Online booking fee")} {thb(BOOKING_FEE)} {tr("· ชำระวันรับรถ", "· due at pickup")}{" "}
                          {thb(rentalCharges(b.total_amount).dueAtPickup)}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:flex-col">
                      {b.status === "pending" && (
                        <Button
                          size="sm"
                          variant={stage === "review_contract" || stage === "awaiting_payment" ? "default" : "outline"}
                          className="w-full gap-1.5"
                          asChild
                        >
                          <Link to="/bookings/$id" params={{ id: b.id }}>
                            {stage === "awaiting_payment" ? (
                              <>
                                <CreditCard className="h-3.5 w-3.5" /> {tr("ชำระเงิน", "Pay now")}
                              </>
                            ) : (
                              <>
                                <FileCheck2 className="h-3.5 w-3.5" />{" "}
                                {stage === "review_contract" ? tr("ตรวจสอบสัญญา", "Review contract") : tr("ดูรายละเอียด", "View details")}
                              </>
                            )}
                          </Link>
                        </Button>
                      )}

                      {(b.status === "confirmed" || b.status === "active" || b.status === "completed") && (
                        <Button variant="outline" size="sm" className="w-full gap-1.5" asChild>
                          <Link to="/bookings/$id" params={{ id: b.id }}>
                            <FileCheck2 className="h-3.5 w-3.5" /> {tr("ดูสัญญาเช่า", "View contract")}
                          </Link>
                        </Button>
                      )}

                      {canCancel && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setCancellingId(b.id)}
                        >
                          <XCircle className="h-3.5 w-3.5 mr-1" /> {tr("ยกเลิกการจอง", "Cancel booking")}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Cancel Confirmation Dialog */}
      <Dialog open={!!cancellingId} onOpenChange={(open) => !open && setCancellingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("ยืนยันการยกเลิกการจอง", "Confirm cancellation")}</DialogTitle>
            <DialogDescription>
              {tr("คุณแน่ใจหรือไม่ว่าต้องการยกเลิกการจองนี้? การดำเนินการนี้ไม่สามารถย้อนกลับได้", "Are you sure you want to cancel this booking? This cannot be undone.")}
            </DialogDescription>
          </DialogHeader>
          {cancellingBooking?.status === "pending" ? (
            <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
              {tr("การจองนี้ยังไม่ได้ชำระค่าจอง ยกเลิกได้โดยไม่มีค่าใช้จ่าย", "The booking fee has not been paid, so you can cancel at no cost.")}
            </p>
          ) : (
            cancellingBooking && (
              <div
                className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
                data-testid="cancel-fee-warning"
              >
                {(() => {
                  const m = cancellationMoney(cancellingBooking);
                  return (
                    <>
                      <p className="text-destructive">
                        {tr("ไม่ได้รับคืน: เงินที่ชำระออนไลน์แล้ว (ค่าจอง)", "Not refunded: the amount already paid online (booking fee)")}{m.kept > 0 ? ` ${thb(m.kept)}` : ""} {tr("ตามเงื่อนไขในสัญญา", "under the contract terms")}
                      </p>
                      {m.refunded > 0 && (
                        <p className="text-foreground" data-testid="cancel-refund">
                          {tr("ได้รับคืน: ยอดที่ชำระเพิ่ม (ค่าเช่า + เงินประกัน − ค่าจอง)", "Refunded: the additional payment (rent + deposit − booking fee)")} {thb(m.refunded)} (DEMO)
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
            )
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setCancellingId(null)}>
              {tr("ย้อนกลับ", "Go back")}
            </Button>
            <Button variant="destructive" disabled={cancelling} onClick={handleCancelBooking}>
              {cancelling ? tr("กำลังยกเลิก...", "Cancelling...") : tr("ยืนยันยกเลิกการจอง", "Yes, cancel booking")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
