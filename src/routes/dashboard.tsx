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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { carImage } from "@/lib/car-images";
import { categoryLabel, fmtDate, thb } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "แดชบอร์ดลูกค้า — Siam Wheels Rental Hub" },
      { name: "description", content: "ศูนย์รวมข้อมูลการเช่ารถยนต์ การจองที่กำลังดำเนินอยู่ และสถานะเอกสารผู้ขับขี่" },
      { property: "og:title", content: "แดชบอร์ดของฉัน — Siam Wheels" },
    ],
  }),
  component: CustomerDashboardPage,
});

type BookingWithCar = Tables<"bookings"> & {
  cars: Tables<"cars"> | null;
};

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
  const { data: bookings = [], isLoading: bookingsLoading } = useQuery({
    queryKey: ["customer-bookings", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from("bookings")
        .select("*, cars(*)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      return (data ?? []) as unknown as BookingWithCar[];
    },
    enabled: !!user,
  });

  // Loading state
  if (authLoading || bookingsLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-20 text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="mt-4 text-muted-foreground">กำลังโหลดข้อมูลแดชบอร์ดของคุณ...</p>
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-warning" />
        <h2 className="mt-4 text-2xl font-semibold">กรุณาเข้าสู่ระบบ</h2>
        <p className="mt-2 text-sm text-muted-foreground">เข้าสู่ระบบเพื่อตรวจสอบสถานะการเช่าและข้อมูลการจองของคุณ</p>
        <Button className="mt-6 w-full" onClick={() => navigate({ to: "/auth" })}>
          เข้าสู่ระบบ / สมัครสมาชิก
        </Button>
      </div>
    );
  }

  const activeRentals = bookings.filter((b) => b.status === "confirmed" || b.status === "active");
  const completedRentals = bookings.filter((b) => b.status === "completed");
  const pendingRentals = bookings.filter((b) => b.status === "pending");
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
            สวัสดี, {profile?.full_name || user.user_metadata?.["full_name"] || "ลูกค้า Siam Wheels"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ยินดีต้อนรับสู่แดชบอร์ดส่วนบุคคล ติดตามทริปการเดินทางและจัดการเอกสารเช่ารถ
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link to="/cars">
              <Search className="mr-1.5 h-4 w-4" /> ค้นหารถเช่า
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-card border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">การเช่าที่กำลังดำเนินอยู่</CardTitle>
            <CarIcon className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{activeRentals.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {pendingRentals.length > 0 ? `และมี ${pendingRentals.length} รายการรอชำระเงิน` : "ทริปพร้อมออกเดินทาง"}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-card border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">การเดินทางทั้งหมด</CardTitle>
            <Calendar className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{bookings.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              เสร็จสิ้นแล้ว {completedRentals.length} ทริป
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-card border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">ยอดการใช้งานสะสม</CardTitle>
            <CreditCard className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{thb(totalSpent)}</div>
            <p className="text-xs text-muted-foreground mt-1">คำนวณจากทุกการจองที่ยืนยันแล้ว</p>
          </CardContent>
        </Card>

        <Card className="shadow-card border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">สถานะเอกสารผู้ขับขี่</CardTitle>
            <FileText className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {isLicenseReady ? (
                <Badge variant="outline" className="border-success/30 bg-success/10 text-success gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> พร้อมใช้งาน
                </Badge>
              ) : (
                <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning gap-1">
                  <AlertCircle className="h-3.5 w-3.5" /> รอระบุใบขับขี่
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              <Link to="/profile" className="text-primary hover:underline">
                {isLicenseReady ? "ดูข้อมูลใบขับขี่ →" : "กรอกเลขใบขับขี่ตอนนี้ →"}
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
                  <CardTitle className="text-lg">ทริปปัจจุบันของคุณ</CardTitle>
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
                        ทะเบียน {primaryActiveBooking.cars?.plate_no} · {categoryLabel[primaryActiveBooking.cars?.category || ""] || primaryActiveBooking.cars?.category}
                      </p>

                      <div className="space-y-1 pt-2 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-primary" />
                          <span>
                            {fmtDate(primaryActiveBooking.start_date)} — {fmtDate(primaryActiveBooking.end_date)} ({primaryActiveBooking.days} วัน)
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-primary" />
                          <span>{primaryActiveBooking.pickup_location}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                    <div className="text-sm">
                      <span className="text-xs text-muted-foreground">ยอดรวมการเช่า:</span>
                      <p className="font-bold text-primary text-base">{thb(primaryActiveBooking.total_amount)}</p>
                    </div>

                    <div className="flex gap-2">
                      <Button asChild size="sm">
                        <Link to="/bookings/$id" params={{ id: primaryActiveBooking.id }}>
                          {primaryActiveBooking.status === "pending" ? (
                            <>
                              <CreditCard className="mr-1.5 h-3.5 w-3.5" /> ชำระเงิน
                            </>
                          ) : (
                            <>
                              <FileCheck2 className="mr-1.5 h-3.5 w-3.5" /> ดูสัญญาดิจิทัล
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
                  <h4 className="mt-3 font-semibold">ไม่มีการเช่าที่กำลังดำเนินอยู่</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    พร้อมออกเดินทางไปกับ Siam Wheels แล้วหรือยัง? ค้นหารถที่เหมาะกับคุณได้ทันที
                  </p>
                  <Button className="mt-4" size="sm" asChild>
                    <Link to="/cars">ค้นหารถว่าง</Link>
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
                <span>บริการช่วยเหลือฉุกเฉิน 24 ชั่วโมง</span>
              </div>
              <p className="text-xs text-muted-foreground">
                หากพบปัญหาเกี่ยวกับตัวรถหรือเกิดอุบัติเหตุ ติดต่อทีมช่วยเหลือ Siam Wheels ได้ตลอดเวลา
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
              <CardTitle className="text-base font-semibold">เมนูด่วนสำหรับลูกค้า</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Link
                to="/bookings"
                className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition"
              >
                <div className="flex items-center gap-2.5">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span>ดูประวัติการจองทั้งหมด</span>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>

              <Link
                to="/profile"
                className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition"
              >
                <div className="flex items-center gap-2.5">
                  <User className="h-4 w-4 text-primary" />
                  <span>อัปเดตข้อมูลใบขับขี่ & ส่วนตัว</span>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>

              <Link
                to="/cars"
                className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition"
              >
                <div className="flex items-center gap-2.5">
                  <Search className="h-4 w-4 text-primary" />
                  <span>ค้นหารถเช่าโปรโมชั่น</span>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            </CardContent>
          </Card>

          {/* Recent Activity List */}
          <Card className="shadow-card border">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold">ประวัติการจองล่าสุด</CardTitle>
              <Link to="/bookings" className="text-xs text-primary hover:underline">
                ดูทั้งหมด ({bookings.length})
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
                <p className="text-center py-4 text-xs text-muted-foreground">ยังไม่มีประวัติการจอง</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
