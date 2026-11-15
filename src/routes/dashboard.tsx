import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  Car as CarIcon,
  CheckCircle2,
  Clock,
  CreditCard,
  FileCheck2,
  FileText,
  MapPin,
  PhoneCall,
  Search,
  ShieldCheck,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { customerStage, customerStageLabel } from "@/lib/contract-workflow";
import { LoadError } from "@/components/load-error";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { carImage } from "@/lib/car-images";
import { categoryLabel, fmtDate, pickupLocationLabel, thb } from "@/lib/format";
import { bookingContract, customerBookingsQuery, workflowContract } from "@/lib/queries";
import { tr } from "@/lib/i18n";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "แดชบอร์ดลูกค้า — Drive Dee" },
      { name: "description", content: "ศูนย์รวมข้อมูลการเช่ารถยนต์ การจองที่กำลังดำเนินอยู่ และสถานะเอกสารผู้ขับขี่" },
      { property: "og:title", content: "แดชบอร์ดของฉัน — Drive Dee" },
    ],
  }),
  component: CustomerDashboardPage,
});

function CustomerDashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // 1. Fetch Customer Profile
  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  // 2. Fetch Customer Bookings
  // Same query (key and shape) as /bookings, so the two pages never read each other's cache wrongly
  const {
    data: bookings = [],
    isLoading: bookingsLoading,
    isError: bookingsError,
    refetch: refetchBookings,
  } = useQuery({
    ...customerBookingsQuery(user?.id ?? ""),
    enabled: !!user,
  });

  // Loading state
  if (authLoading || bookingsLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-20 text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="mt-4 text-muted-foreground">{tr("กำลังโหลดข้อมูลแดชบอร์ดของคุณ...", "Loading your dashboard...")}</p>
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-warning" />
        <h2 className="mt-4 text-2xl font-semibold">{tr("กรุณาเข้าสู่ระบบ", "Please sign in")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{tr("เข้าสู่ระบบเพื่อตรวจสอบสถานะการเช่าและข้อมูลการจองของคุณ", "Sign in to check your rentals and bookings.")}</p>
        <Button className="mt-6 w-full" onClick={() => navigate({ to: "/auth" })}>
          {tr("เข้าสู่ระบบ / สมัครสมาชิก", "Sign in / Sign up")}
        </Button>
      </div>
    );
  }

  if (bookingsError) {
    return <LoadError title={tr("โหลดข้อมูลแดชบอร์ดไม่สำเร็จ", "Could not load your dashboard")} onRetry={() => void refetchBookings()} />;
  }

  const activeRentals = bookings.filter((b) => b.status === "confirmed" || b.status === "active");
  const completedRentals = bookings.filter((b) => b.status === "completed");
  const pendingRentals = bookings.filter((b) => b.status === "pending");
  const stageOf = (b: (typeof bookings)[number]) => customerStage(b, workflowContract(bookingContract(b)));
  // Pending bookings that wait on the customer (review the contract, or pay after approval)
  const needsAction = pendingRentals.filter((b) => ["review_contract", "awaiting_payment"].includes(stageOf(b)));
  const totalSpent = bookings
    .filter((b) => b.status !== "cancelled")
    .reduce((sum, b) => sum + Number(b.total_amount), 0);

  const primaryActiveBooking = activeRentals[0] || pendingRentals[0];
  const isLicenseReady = !!profile?.license_no?.trim();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      {/* Welcome Banner */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {tr("สวัสดี,", "Hello,")} {profile?.full_name || user.user_metadata?.["full_name"] || tr("ลูกค้า Drive Dee", "Drive Dee customer")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tr("ยินดีต้อนรับสู่แดชบอร์ดส่วนบุคคล ติดตามทริปการเดินทางและจัดการเอกสารเช่ารถ", "Welcome to your dashboard. Track your trips and manage your rental documents.")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link to="/cars">
              <Search className="mr-1.5 h-4 w-4" /> {tr("ค้นหารถเช่า", "Search cars")}
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-card border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tr("การเช่าที่กำลังดำเนินอยู่", "Current rentals")}</CardTitle>
            <CarIcon className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{activeRentals.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {needsAction.length > 0
                ? tr(
                    `และมี ${needsAction.length} รายการรอคุณดำเนินการ (ตรวจสัญญา/ชำระเงิน)`,
                    `and ${needsAction.length} waiting for you (review contract / pay)`,
                  )
                : pendingRentals.length > 0
                  ? tr(
                      `และมี ${pendingRentals.length} รายการอยู่ระหว่างทำสัญญา`,
                      `and ${pendingRentals.length} with a contract in progress`,
                    )
                  : tr("ทริปพร้อมออกเดินทาง", "Trip ready to go")}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-card border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tr("การเดินทางทั้งหมด", "All trips")}</CardTitle>
            <Calendar className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{bookings.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {tr("เสร็จสิ้นแล้ว", "Completed")} {completedRentals.length} {tr("ทริป", "trips")}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-card border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tr("ยอดการใช้งานสะสม", "Total spent")}</CardTitle>
            <CreditCard className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{thb(totalSpent)}</div>
            <p className="text-xs text-muted-foreground mt-1">{tr("คำนวณจากทุกการจองที่ยืนยันแล้ว", "Based on all confirmed bookings")}</p>
          </CardContent>
        </Card>

        <Card className="shadow-card border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tr("สถานะเอกสารผู้ขับขี่", "Driver documents")}</CardTitle>
            <FileText className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {isLicenseReady ? (
                <Badge variant="outline" className="border-success/30 bg-success/10 text-success gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {tr("พร้อมใช้งาน", "Ready")}
                </Badge>
              ) : (
                <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning gap-1">
                  <AlertCircle className="h-3.5 w-3.5" /> {tr("รอระบุใบขับขี่", "Licence missing")}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              <Link to="/profile" className="text-primary hover:underline">
                {isLicenseReady ? tr("ดูข้อมูลใบขับขี่ →", "View licence details →") : tr("กรอกเลขใบขับขี่ตอนนี้ →", "Add your licence number now →")}
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 lg:grid-cols-12">
        {/* Left Column: Active / Upcoming Spotlight (7 Cols) */}
        <div className="space-y-6 lg:col-span-7">
          <Card className="overflow-hidden shadow-card border">
            <CardHeader className="border-b bg-muted/20 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  <CardTitle className="text-lg">{tr("ทริปปัจจุบันของคุณ", "Your current trip")}</CardTitle>
                </div>
                {primaryActiveBooking && (
                  <StatusBadge status={primaryActiveBooking.status} kind="booking" />
                )}
              </div>
            </CardHeader>

            <CardContent className="p-6">
              {primaryActiveBooking ? (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row gap-4 items-start">
                    <img
                      src={carImage(primaryActiveBooking.cars?.image_url, primaryActiveBooking.cars?.category)}
                      alt={primaryActiveBooking.cars?.model || "Car"}
                      className="w-full sm:w-44 h-28 object-cover rounded-xl bg-muted border"
                    />
                    <div className="space-y-1.5 flex-1">
                      <h3 className="text-xl font-bold">
                        {primaryActiveBooking.cars?.brand} {primaryActiveBooking.cars?.model} ({primaryActiveBooking.cars?.year})
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {tr("ทะเบียน", "Plate")} {primaryActiveBooking.cars?.plate_no} · {categoryLabel[primaryActiveBooking.cars?.category || ""] || primaryActiveBooking.cars?.category}
                      </p>

                      <div className="space-y-1 pt-2 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-primary" />
                          <span>
                            {fmtDate(primaryActiveBooking.start_date)} — {fmtDate(primaryActiveBooking.end_date)} ({primaryActiveBooking.days} {tr("วัน", "days")})
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-primary" />
                          <span>{pickupLocationLabel(primaryActiveBooking.pickup_location)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                    <div className="text-sm">
                      <span className="text-xs text-muted-foreground">{tr("ยอดรวมการเช่า:", "Total rent:")}</span>
                      <p className="font-bold text-primary text-base">{thb(primaryActiveBooking.total_amount)}</p>
                    </div>

                    <div className="flex gap-2">
                      <Button asChild size="sm">
                        <Link to="/bookings/$id" params={{ id: primaryActiveBooking.id }}>
                          {primaryActiveBooking.status === "pending" ? (
                            stageOf(primaryActiveBooking) === "awaiting_payment" ? (
                              <>
                                <CreditCard className="mr-1.5 h-3.5 w-3.5" /> {tr("ชำระเงิน", "Pay now")}
                              </>
                            ) : (
                              <>
                                <FileCheck2 className="mr-1.5 h-3.5 w-3.5" />{" "}
                                {customerStageLabel[stageOf(primaryActiveBooking)]}
                              </>
                            )
                          ) : (
                            <>
                              <FileCheck2 className="mr-1.5 h-3.5 w-3.5" /> {tr("ดูสัญญาดิจิทัล", "View digital contract")}
                            </>
                          )}
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-10">
                  <CarIcon className="mx-auto h-12 w-12 text-muted-foreground/40" />
                  <h4 className="mt-3 font-semibold">{tr("ไม่มีการเช่าที่กำลังดำเนินอยู่", "No current rentals")}</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    {tr("พร้อมออกเดินทางไปกับ Drive Dee แล้วหรือยัง? ค้นหารถที่เหมาะกับคุณได้ทันที", "Ready to travel with Drive Dee? Find the right car for you now.")}
                  </p>
                  <Button className="mt-4" size="sm" asChild>
                    <Link to="/cars">{tr("ค้นหารถว่าง", "Find available cars")}</Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Emergency & Support Assistance */}
          <div className="rounded-2xl border bg-card p-5 shadow-card flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <PhoneCall className="h-4 w-4 text-primary" />
                <span>{tr("บริการช่วยเหลือฉุกเฉิน 24 ชั่วโมง", "24-hour emergency assistance")}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {tr("หากพบปัญหาเกี่ยวกับตัวรถหรือเกิดอุบัติเหตุ ติดต่อทีมช่วยเหลือ Drive Dee ได้ตลอดเวลา", "If you have a problem with the car or an accident, contact the Drive Dee support team any time.")}
              </p>
            </div>
            <a
              href="tel:021234567"
              className="inline-flex items-center justify-center rounded-lg bg-primary/10 px-4 py-2 text-xs font-semibold text-primary hover:bg-primary/20 shrink-0"
            >
              02-123-4567
            </a>
          </div>
        </div>

        {/* Right Column: Quick Shortcuts & Recent Activity (5 Cols) */}
        <div className="space-y-6 lg:col-span-5">
          {/* Quick Shortcuts */}
          <Card className="shadow-card border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">{tr("เมนูด่วนสำหรับลูกค้า", "Quick links")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Link
                to="/bookings"
                className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition"
              >
                <div className="flex items-center gap-2.5">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span>{tr("ดูประวัติการจองทั้งหมด", "View all bookings")}</span>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>

              <Link
                to="/profile"
                className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition"
              >
                <div className="flex items-center gap-2.5">
                  <User className="h-4 w-4 text-primary" />
                  <span>{tr("อัปเดตข้อมูลใบขับขี่ & ส่วนตัว", "Update licence & personal details")}</span>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>

              <Link
                to="/cars"
                className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition"
              >
                <div className="flex items-center gap-2.5">
                  <Search className="h-4 w-4 text-primary" />
                  <span>{tr("ค้นหารถเช่าโปรโมชั่น", "Find rental deals")}</span>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            </CardContent>
          </Card>

          {/* Recent Activity List */}
          <Card className="shadow-card border">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold">{tr("ประวัติการจองล่าสุด", "Recent bookings")}</CardTitle>
              <Link to="/bookings" className="text-xs text-primary hover:underline">
                {tr("ดูทั้งหมด (", "View all (")}{bookings.length})
              </Link>
            </CardHeader>
            <CardContent className="space-y-3">
              {bookings.slice(0, 3).map((b) => (
                <Link
                  key={b.id}
                  to="/bookings/$id"
                  params={{ id: b.id }}
                  className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/40 transition text-xs"
                >
                  <div className="space-y-0.5">
                    <span className="font-semibold text-foreground">
                      {b.cars?.brand} {b.cars?.model}
                    </span>
                    <p className="text-muted-foreground font-mono">{b.booking_code}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtDate(b.start_date)}</p>
                  </div>
                  <div className="text-right space-y-1">
                    <StatusBadge status={b.status} kind="booking" />
                    <p className="font-semibold text-primary">{thb(b.total_amount)}</p>
                  </div>
                </Link>
              ))}

              {bookings.length === 0 && (
                <p className="text-center py-4 text-xs text-muted-foreground">{tr("ยังไม่มีประวัติการจอง", "No bookings yet")}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
