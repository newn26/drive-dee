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
  MessageSquarePlus,
  Star,
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { carImage } from "@/lib/car-images";
import { categoryLabel, fmtDate, thb } from "@/lib/format";
import { BOOKING_FEE, rentalCharges } from "@/lib/booking-fee";
import {
  bookingContract,
  bookingReview,
  customerBookingsQuery,
  invalidateBookingData,
  workflowContract,
  type CustomerBooking,
} from "@/lib/queries";
import { reviewerDisplayName } from "@/lib/reviewer-name";

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

type BookingWithCarAndReview = CustomerBooking;

function BookingsHistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<string>("all");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Review modal state
  // Ticks the payment countdown shown on unpaid bookings
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [reviewBooking, setReviewBooking] = useState<BookingWithCarAndReview | null>(null);
  const [reviewRating, setReviewRating] = useState<number>(5);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  // Fetch all customer bookings with car and review
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

      toast.success("ยกเลิกการจองเรียบร้อยแล้ว");
      setCancellingId(null);
      // Cancelling frees the car, so availability caches must refresh too
      await invalidateBookingData(queryClient);
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || "ไม่สามารถยกเลิกการจองได้");
    } finally {
      setCancelling(false);
    }
  };

  // Handle review submission
  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewBooking || !user) return;

    setSubmittingReview(true);
    try {
      const { error } = await supabase
        .from("reviews")
        .insert({
          booking_id: reviewBooking.id,
          car_id: reviewBooking.car_id,
          user_id: user.id,
          // Reviews are public: store a short display name, never the full sign-up name
          reviewer_name: reviewerDisplayName(user.user_metadata?.["full_name"]),
          rating: reviewRating,
          comment: reviewComment.trim(),
        });

      if (error) throw error;

      toast.success("ขอบคุณสำหรับความคิดเห็นและการให้คะแนน");
      setReviewBooking(null);
      setReviewComment("");
      setReviewRating(5);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customer-bookings", user.id] }),
        queryClient.invalidateQueries({ queryKey: ["ratings"] }),
        queryClient.invalidateQueries({ queryKey: ["reviews", reviewBooking.car_id] }),
      ]);
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || "ไม่สามารถบันทึกรีวิวได้");
    } finally {
      setSubmittingReview(false);
    }
  };

  const cancellingBooking = bookings.find((b) => b.id === cancellingId);

  // Each booking's place in the contract workflow
  const stageOf = (b: BookingWithCarAndReview): CustomerStage =>
    customerStage(b, workflowContract(bookingContract(b)));
  const TABS: { value: string; label: string; stages: CustomerStage[] }[] = [
    { value: "contract", label: "รอสัญญา", stages: ["awaiting_contract"] },
    { value: "review", label: "รอตรวจสัญญา", stages: ["review_contract"] },
    { value: "approval", label: "ขอแก้ไขสัญญา", stages: ["awaiting_approval", "revision_requested"] },
    { value: "payment", label: "รอชำระเงิน", stages: ["awaiting_payment"] },
    { value: "active", label: "ยืนยันแล้ว/กำลังเช่า", stages: ["confirmed"] },
    { value: "completed", label: "เสร็จสิ้น", stages: ["completed"] },
    { value: "cancelled", label: "ยกเลิก", stages: ["cancelled"] },
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
        <p className="mt-4 text-muted-foreground">กำลังโหลดประวัติการจองของคุณ...</p>
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-warning" />
        <h2 className="mt-4 text-2xl font-semibold">กรุณาเข้าสู่ระบบ</h2>
        <p className="mt-2 text-sm text-muted-foreground">คุณต้องเข้าสู่ระบบก่อนจึงจะสามารถดูประวัติการจองของคุณได้</p>
        <Button className="mt-6 w-full" onClick={() => navigate({ to: "/auth" })}>
          เข้าสู่ระบบ / สมัครสมาชิก
        </Button>
      </div>
    );
  }

  if (bookingsError) {
    return <LoadError title="โหลดประวัติการจองไม่สำเร็จ" onRetry={() => void refetchBookings()} />;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {/* Page Header */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">การจองของฉัน</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ติดตามสถานะการจอง ชำระเงิน ตรวจสอบสัญญาเช่าดิจิทัล และเขียนรีวิว
          </p>
        </div>
        <Button asChild>
          <Link to="/cars">
            <CarIcon className="mr-1.5 h-4 w-4" /> จองรถคันใหม่
          </Link>
        </Button>
      </div>

      {/* Status Filter Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4 [&>button]:whitespace-normal">
          <TabsTrigger value="all">ทั้งหมด ({bookings.length})</TabsTrigger>
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
          <h3 className="mt-4 text-lg font-semibold">ไม่พบรายการจอง</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeTab === "all"
              ? "คุณยังไม่มีประวัติการจองรถยนต์ เลือกรถที่ถูกใจแล้วออกเดินทางได้ทันที"
              : "ไม่พบรายการจองในหมวดหมู่นี้"}
          </p>
          <div className="mt-6">
            <Button asChild>
              <Link to="/cars">ค้นหารถเช่า</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredBookings.map((b) => {
            const car = b.cars;
            const review = bookingReview(b);
            const canCancel = b.status === "pending" || b.status === "confirmed";
            const canReview = b.status === "completed" && !review;
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
                          {fmtDate(b.start_date)} — {fmtDate(b.end_date)} ({b.days} วัน)
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="truncate">{b.pickup_location}</span>
                      </div>
                    </div>

                    {b.status === "pending" && (
                      <p className="flex items-center gap-1.5 text-xs font-medium text-warning" role="timer">
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                        {secondsLeft === 0
                          ? "หมดเวลาแล้ว การจองจะถูกยกเลิก"
                          : stage === "awaiting_payment"
                            ? `ชำระเงินภายใน ${formatCountdown(secondsLeft)}`
                            : `ขั้นตอนนี้ต้องเสร็จภายใน ${formatCountdown(secondsLeft)}`}
                      </p>
                    )}

                    {/* Review Badge if already reviewed */}
                    {review && (
                      <div className="flex items-center gap-1 text-xs text-accent">
                        <Star className="h-3.5 w-3.5 fill-accent text-accent" />
                        <span>ให้คะแนนแล้ว {review.rating} ดาว: "{review.comment}"</span>
                      </div>
                    )}
                  </div>

                  {/* Price & Actions (3 Cols) */}
                  <div className="flex flex-col sm:items-end justify-between gap-3 sm:col-span-3 border-t sm:border-t-0 sm:border-l sm:pl-4 pt-3 sm:pt-0">
                    <div className="sm:text-right">
                      <span className="text-xs text-muted-foreground">ค่าเช่ารวม</span>
                      <p className="font-display text-xl font-bold text-primary">
                        {thb(b.total_amount)}
                      </p>
                      {b.status === "pending" && (
                        <p className="text-xs text-muted-foreground" data-testid="fee-breakdown">
                          ค่าจองออนไลน์ {thb(BOOKING_FEE)} · ชำระวันรับรถ{" "}
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
                                <CreditCard className="h-3.5 w-3.5" /> ชำระเงิน
                              </>
                            ) : (
                              <>
                                <FileCheck2 className="h-3.5 w-3.5" />{" "}
                                {stage === "review_contract" ? "ตรวจสอบสัญญา" : "ดูรายละเอียด"}
                              </>
                            )}
                          </Link>
                        </Button>
                      )}

                      {(b.status === "confirmed" || b.status === "active" || b.status === "completed") && (
                        <Button variant="outline" size="sm" className="w-full gap-1.5" asChild>
                          <Link to="/bookings/$id" params={{ id: b.id }}>
                            <FileCheck2 className="h-3.5 w-3.5" /> ดูสัญญาเช่า
                          </Link>
                        </Button>
                      )}

                      {canReview && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="w-full gap-1.5"
                          onClick={() => setReviewBooking(b)}
                        >
                          <MessageSquarePlus className="h-3.5 w-3.5" /> เขียนรีวิว
                        </Button>
                      )}

                      {canCancel && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setCancellingId(b.id)}
                        >
                          <XCircle className="h-3.5 w-3.5 mr-1" /> ยกเลิกการจอง
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
            <DialogTitle>ยืนยันการยกเลิกการจอง</DialogTitle>
            <DialogDescription>
              คุณแน่ใจหรือไม่ว่าต้องการยกเลิกการจองนี้? การดำเนินการนี้ไม่สามารถย้อนกลับได้
            </DialogDescription>
          </DialogHeader>
          {cancellingBooking?.status === "pending" ? (
            <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
              การจองนี้ยังไม่ได้ชำระค่าจอง ยกเลิกได้โดยไม่มีค่าใช้จ่าย
            </p>
          ) : (
            <p
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              data-testid="cancel-fee-warning"
            >
              เงินที่ชำระออนไลน์แล้ว (ค่าจอง) จะไม่ได้รับคืนเมื่อยกเลิก ตามเงื่อนไขในสัญญา
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setCancellingId(null)}>
              ย้อนกลับ
            </Button>
            <Button variant="destructive" disabled={cancelling} onClick={handleCancelBooking}>
              {cancelling ? "กำลังยกเลิก..." : "ยืนยันยกเลิกการจอง"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Modal Dialog */}
      <Dialog open={!!reviewBooking} onOpenChange={(open) => !open && setReviewBooking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เขียนรีวิวประสบการณ์การเช่ารถ</DialogTitle>
            <DialogDescription>
              ให้คะแนนความพึงพอใจสำหรับ {reviewBooking?.cars?.brand} {reviewBooking?.cars?.model}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitReview} className="space-y-4 pt-2">
            <div>
              <Label className="text-xs">คะแนนความพึงพอใจ (1-5 ดาว)</Label>
              <div className="flex gap-2 mt-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setReviewRating(star)}
                    className="p-1 hover:scale-110 transition"
                  >
                    <Star
                      className={`h-7 w-7 ${star <= reviewRating ? "fill-accent text-accent" : "text-muted-foreground/30"}`}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rev-comment" className="text-xs">ความคิดเห็นของคุณ</Label>
              <Textarea
                id="rev-comment"
                rows={3}
                placeholder="บอกเล่าความประทับใจ สภาพรถยนต์ หรือการให้บริการ..."
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                required
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setReviewBooking(null)}>
                ยกเลิก
              </Button>
              <Button type="submit" disabled={submittingReview}>
                {submittingReview ? "กำลังบันทึก..." : "ส่งความคิดเห็น"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
