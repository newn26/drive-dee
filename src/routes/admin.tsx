import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  BarChart3,
  Calendar,
  Car as CarIcon,
  CheckCircle2,
  ChevronRight,
  Clock,
  DollarSign,
  Download,
  Edit,
  ExternalLink,
  FileCheck2,
  FileText,
  Filter,
  Fuel,
  LayoutDashboard,
  Lock,
  MessageSquareWarning,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Truck,
  Users,
  Wrench,
  X,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { carImage } from "@/lib/car-images";
import { bookingStatusLabel, categoryLabel, fmtDate, fmtDateTime, maintStatusLabel, thb, todayBkk } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";
import { invalidateBookingData } from "@/lib/queries";
import { cancelExpiredBookings } from "@/lib/payment-window";
import { syncCarStatus } from "@/lib/car-status";
import { adminReviewsQuery } from "@/lib/admin-reviews";
import { AdminReviewsPanel } from "@/components/admin/reviews-panel";
import { dashboardPermissions } from "@/lib/roles";
import {
  bookingReportCsv,
  bookingStatusMap,
  computeReport,
  countCustomers,
  downloadTextFile,
  maintenanceReportCsv,
  monthlyRevenueSeries,
  type ReportRange,
} from "@/lib/reports";
import {
  DEFAULT_ADMIN_CLAUSES,
  buildContractTerms,
  splitContractTerms,
  validateContractEdit,
} from "@/lib/contract-terms";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "ระบบผู้ดูแลระบบ (Admin) — Siam Wheels Rental Hub" },
      { name: "description", content: "ระบบบริหารจัดการรถเช่า รายการจอง สัญญา และงานซ่อมบำรุง" },
      { property: "og:title", content: "ระบบผู้ดูแลระบบ — Siam Wheels" },
    ],
  }),
  component: () => <AdminDashboard mode="admin" />,
});

/**
 * "admin": full administrator dashboard at /admin.
 * "demo": restricted demonstration dashboard at /demo-admin (demo_admin role only).
 */
export type DashboardMode = "admin" | "demo";

type AdminTab = "overview" | "cars" | "bookings" | "contracts" | "maintenance" | "reviews" | "reports";

type BookingWithCar = Tables<"bookings"> & {
  cars: Tables<"cars"> | null;
};

type MaintenanceWithCar = Tables<"maintenance"> & {
  cars: Tables<"cars"> | null;
};

type ContractWithBooking = Tables<"contracts"> & {
  bookings: (Tables<"bookings"> & { cars: Tables<"cars"> | null }) | null;
};

const CATEGORIES = [
  { value: "eco", label: "อีโคคาร์ (Eco)" },
  { value: "sedan", label: "ซีดาน (Sedan)" },
  { value: "suv", label: "SUV" },
  { value: "van", label: "รถตู้ (Van)" },
  { value: "ev", label: "รถไฟฟ้า (EV)" },
];

const CAR_STATUSES = [
  { value: "available", label: "ว่าง (พร้อมให้บริการ)" },
  { value: "rented", label: "ถูกเช่า (กำลังให้บริการ)" },
  { value: "maintenance", label: "ซ่อมบำรุง" },
  { value: "unavailable", label: "งดให้บริการ" },
];

const PIE_COLORS = ["#0ea5e9", "#10b981", "#f59e0b", "#6366f1", "#ec4899"];

export function AdminDashboard({ mode }: { mode: DashboardMode }) {
  const { user, role, loading: authLoading } = useAuth();
  const isDemo = mode === "demo";
  // Each dashboard only opens for its own role: admins use /admin, demo admins use /demo-admin.
  const allowed = isDemo ? role === "demo_admin" : role === "admin";
  const perms = dashboardPermissions(allowed ? role : "customer");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<AdminTab>("overview");

  // Filters & Search
  const [carSearch, setCarSearch] = useState("");
  const [carCategoryFilter, setCarCategoryFilter] = useState("all");
  const [carStatusFilter, setCarStatusFilter] = useState("all");

  const [bookingSearch, setBookingSearch] = useState("");
  const [bookingStatusFilter, setBookingStatusFilter] = useState("all");

  const [contractSearch, setContractSearch] = useState("");
  const [maintStatusFilter, setMaintStatusFilter] = useState("all");

  // Modals & Forms
  const [carModalOpen, setCarModalOpen] = useState(false);
  const [editingCar, setEditingCar] = useState<Tables<"cars"> | null>(null);
  const [carToDelete, setCarToDelete] = useState<Tables<"cars"> | null>(null);
  const [deletingCar, setDeletingCar] = useState(false);
  const [reportDateRange, setReportDateRange] = useState<ReportRange>("all");
  const [carForm, setCarForm] = useState({
    brand: "",
    model: "",
    year: new Date().getFullYear(),
    category: "sedan",
    seats: 5,
    transmission: "อัตโนมัติ",
    fuel: "เบนซิน",
    plate_no: "",
    price_per_day: 1500,
    mileage: 0,
    image_url: "",
    description: "",
    status: "available" as Tables<"cars">["status"],
  });

  // Maintenance Modal
  const [maintModalOpen, setMaintModalOpen] = useState(false);
  const [maintForm, setMaintForm] = useState({
    car_id: "",
    title: "",
    description: "",
    scheduled_date: todayBkk(),
    cost: 0,
    status: "scheduled" as Tables<"maintenance">["status"],
  });

  // Booking Status Update Dialog
  const [updatingBooking, setUpdatingBooking] = useState<BookingWithCar | null>(null);
  const [newBookingStatus, setNewBookingStatus] = useState<Tables<"bookings">["status"]>("confirmed");

  // Contract Terms Update Dialog
  const [editingContract, setEditingContract] = useState<ContractWithBooking | null>(null);
  const [viewingContract, setViewingContract] = useState<ContractWithBooking | null>(null);
  const [contractTerms, setContractTerms] = useState("");
  const [securityDeposit, setSecurityDeposit] = useState(DEFAULT_ADMIN_CLAUSES.securityDeposit);
  const [mileageAllowance, setMileageAllowance] = useState(DEFAULT_ADMIN_CLAUSES.mileageAllowance);
  const [latePenalty, setLatePenalty] = useState(DEFAULT_ADMIN_CLAUSES.latePenalty);
  const [savingContract, setSavingContract] = useState(false);

  // -------------------------------------------------------------
  // Data Queries
  // -------------------------------------------------------------
  const carsQ = useQuery({
    queryKey: ["admin-cars"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cars")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Tables<"cars">[];
    },
    enabled: perms.viewDashboard,
  });
  const cars = carsQ.data ?? [];
  const carsLoading = carsQ.isLoading;

  const bookingsQ = useQuery({
    queryKey: ["admin-bookings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*, cars(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Unpaid bookings older than 15 minutes are cancelled here (app-level expiry).
      return cancelExpiredBookings((data ?? []) as unknown as BookingWithCar[]);
    },
    enabled: perms.viewDashboard,
  });
  const bookings = bookingsQ.data ?? [];
  const bookingsLoading = bookingsQ.isLoading;

  const profilesQ = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*");
      if (error) throw error;
      return data as Tables<"profiles">[];
    },
    enabled: perms.viewDashboard,
  });
  const profiles = profilesQ.data ?? [];

  const maintQ = useQuery({
    queryKey: ["admin-maintenance"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance")
        .select("*, cars(*)")
        .order("scheduled_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as MaintenanceWithCar[];
    },
    enabled: perms.viewDashboard,
  });
  const maintenanceRecords = maintQ.data ?? [];

  const contractsQ = useQuery({
    queryKey: ["admin-contracts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contracts")
        .select("*, bookings(*, cars(*))")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ContractWithBooking[];
    },
    enabled: perms.viewDashboard,
  });
  const contracts = contractsQ.data ?? [];

  // Payments are the source of truth for revenue (unpaid bookings are never revenue)
  const paymentsQ = useQuery({
    queryKey: ["admin-payments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payments").select("*").order("paid_at", { ascending: false });
      if (error) throw error;
      return data as Tables<"payments">[];
    },
    enabled: perms.viewDashboard,
  });
  const payments = paymentsQ.data ?? [];

  // Roles, so admins are not counted as customers
  const rolesQ = useQuery({
    queryKey: ["admin-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("user_id, role");
      if (error) throw error;
      return data;
    },
    enabled: perms.viewDashboard,
  });
  const roles = rolesQ.data ?? [];

  const { data: reviewsForCount = [] } = useQuery({ ...adminReviewsQuery(), enabled: perms.moderateReviews });

  // A failed load must not look like "no data", so failures are listed in a banner with a retry
  const failedQueries = [
    { label: "รถยนต์", q: carsQ },
    { label: "การจอง", q: bookingsQ },
    { label: "ลูกค้า", q: profilesQ },
    { label: "ซ่อมบำรุง", q: maintQ },
    { label: "สัญญาเช่า", q: contractsQ },
    { label: "การชำระเงิน", q: paymentsQ },
    { label: "สิทธิ์ผู้ใช้", q: rolesQ },
  ].filter((x) => x.q.isError);
  const retryFailedQueries = () => failedQueries.forEach((x) => void x.q.refetch());

  const profileMap = useMemo(() => {
    const map: Record<string, Tables<"profiles">> = {};
    for (const p of profiles) {
      map[p.id] = p;
    }
    return map;
  }, [profiles]);

  // -------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------
  const openCarModal = (car?: Tables<"cars">) => {
    if (car) {
      setEditingCar(car);
      setCarForm({
        brand: car.brand,
        model: car.model,
        year: car.year,
        category: car.category,
        seats: car.seats,
        transmission: car.transmission,
        fuel: car.fuel,
        plate_no: car.plate_no,
        price_per_day: car.price_per_day,
        mileage: car.mileage,
        image_url: car.image_url || "",
        description: car.description || "",
        status: car.status,
      });
    } else {
      setEditingCar(null);
      setCarForm({
        brand: "",
        model: "",
        year: new Date().getFullYear(),
        category: "sedan",
        seats: 5,
        transmission: "อัตโนมัติ",
        fuel: "เบนซิน",
        plate_no: "",
        price_per_day: 1500,
        mileage: 0,
        image_url: "",
        description: "",
        status: "available",
      });
    }
    setCarModalOpen(true);
  };

  const handleSaveCar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!carForm.brand || !carForm.model || !carForm.plate_no) {
      toast.error("กรุณากรอกยี่ห้อ รุ่น และทะเบียนรถให้ครบถ้วน");
      return;
    }

    try {
      if (editingCar) {
        const { error } = await supabase
          .from("cars")
          .update({
            brand: carForm.brand.trim(),
            model: carForm.model.trim(),
            year: Number(carForm.year),
            category: carForm.category,
            seats: Number(carForm.seats),
            transmission: carForm.transmission,
            fuel: carForm.fuel,
            plate_no: carForm.plate_no.trim(),
            price_per_day: Number(carForm.price_per_day),
            mileage: Number(carForm.mileage),
            image_url: carForm.image_url.trim() || null,
            description: carForm.description.trim() || null,
            status: carForm.status,
          })
          .eq("id", editingCar.id);

        if (error) throw error;
        toast.success("อัปเดตข้อมูลรถยนต์สำเร็จ");
      } else {
        const { error } = await supabase.from("cars").insert({
          brand: carForm.brand.trim(),
          model: carForm.model.trim(),
          year: Number(carForm.year),
          category: carForm.category,
          seats: Number(carForm.seats),
          transmission: carForm.transmission,
          fuel: carForm.fuel,
          plate_no: carForm.plate_no.trim(),
          price_per_day: Number(carForm.price_per_day),
          mileage: Number(carForm.mileage),
          image_url: carForm.image_url.trim() || null,
          description: carForm.description.trim() || null,
          status: carForm.status,
        });

        if (error) throw error;
        toast.success("เพิ่มรถยนต์เข้าสู่ระบบสำเร็จ");
      }

      setCarModalOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["admin-cars"] });
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || "ไม่สามารถบันทึกข้อมูลรถยนต์ได้");
    }
  };

  const handleDeleteCar = async () => {
    if (!carToDelete) return;
    if (!perms.deleteCars) {
      toast.error("โหมดสาธิตไม่สามารถลบรถยนต์ได้");
      setCarToDelete(null);
      return;
    }
    setDeletingCar(true);
    try {
      const hasBooking = bookings.some((b) => b.car_id === carToDelete.id);
      if (hasBooking) {
        toast.error("ไม่สามารถลบรถคันนี้ได้เนื่องจากมีประวัติการจองผูกอยู่ในระบบ กรุณาเปลี่ยนสถานะเป็น 'งดให้บริการ' แทน");
        setCarToDelete(null);
        return;
      }

      const { error } = await supabase.from("cars").delete().eq("id", carToDelete.id);
      if (error) {
        if (error.code === "23503" || error.message.includes("foreign key") || error.message.includes("violates foreign key constraint")) {
          toast.error("ไม่สามารถลบรถคันนี้ได้เนื่องจากมีประวัติการจองผูกอยู่ในระบบ กรุณาเปลี่ยนสถานะเป็น 'งดให้บริการ' แทน");
        } else {
          toast.error(error.message || "ไม่สามารถลบรถยนต์ได้");
        }
        return;
      }

      toast.success("ลบรถยนต์ออกจากระบบเรียบร้อยแล้ว");
      setCarToDelete(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-cars"] });
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || "เกิดข้อผิดพลาดในการลบรถยนต์");
    } finally {
      setDeletingCar(false);
    }
  };

  const handleUpdateCarStatus = async (carId: string, status: Tables<"cars">["status"]) => {
    try {
      const { error } = await supabase
        .from("cars")
        .update({ status })
        .eq("id", carId);

      if (error) throw error;
      toast.success("ปรับปรุงสถานะรถยนต์เรียบร้อยแล้ว");
      await queryClient.invalidateQueries({ queryKey: ["admin-cars"] });
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || "ไม่สามารถเปลี่ยนสถานะได้");
    }
  };

  const handleUpdateBookingStatus = async () => {
    if (!updatingBooking) return;
    try {
      const { error } = await supabase
        .from("bookings")
        .update({ status: newBookingStatus })
        .eq("id", updatingBooking.id);

      if (error) throw error;

      // Car status follows its bookings and maintenance (rented / maintenance / available)
      await syncCarStatus(updatingBooking.car_id);

      toast.success("ปรับปรุงสถานะการจองเรียบร้อยแล้ว");
      setUpdatingBooking(null);
      await invalidateBookingData(queryClient);
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || "ไม่สามารถเปลี่ยนสถานะการจองได้");
    }
  };

  const handleSaveMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!maintForm.car_id || !maintForm.title) {
      toast.error("กรุณาเลือกรถและระบุชื่องานซ่อมบำรุง");
      return;
    }

    try {
      const { error } = await supabase.from("maintenance").insert({
        car_id: maintForm.car_id,
        title: maintForm.title.trim(),
        description: maintForm.description.trim() || null,
        scheduled_date: maintForm.scheduled_date,
        cost: Number(maintForm.cost),
        status: maintForm.status,
        completed_date: maintForm.status === "completed" ? todayBkk() : null,
      });

      if (error) throw error;

      // Car goes to "maintenance" when the job is in progress or due today
      await syncCarStatus(maintForm.car_id);

      toast.success("บันทึกตารางการซ่อมบำรุงเรียบร้อยแล้ว");
      setMaintModalOpen(false);
      setMaintForm({
        car_id: "",
        title: "",
        description: "",
        scheduled_date: todayBkk(),
        cost: 0,
        status: "scheduled",
      });
      await queryClient.invalidateQueries({ queryKey: ["admin-maintenance"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-cars"] });
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || "ไม่สามารถบันทึกงานซ่อมบำรุงได้");
    }
  };

  const handleMaintenanceStatus = async (m: MaintenanceWithCar, status: Tables<"maintenance">["status"]) => {
    try {
      const { error } = await supabase
        .from("maintenance")
        .update({ status, completed_date: status === "completed" ? todayBkk() : null })
        .eq("id", m.id);
      if (error) throw error;

      await syncCarStatus(m.car_id);
      toast.success(status === "completed" ? "ปิดงานซ่อมบำรุงเรียบร้อยแล้ว" : "เริ่มงานซ่อมบำรุงแล้ว");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-maintenance"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-cars"] }),
        queryClient.invalidateQueries({ queryKey: ["cars"] }),
        queryClient.invalidateQueries({ queryKey: ["car"] }),
      ]);
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || "ไม่สามารถเปลี่ยนสถานะงานซ่อมบำรุงได้");
    }
  };

  const openContractEditor = (c: ContractWithBooking) => {
    // Load the current values of the admin clauses instead of resetting them to defaults
    const { base, clauses } = splitContractTerms(c.terms);
    const values = clauses ?? DEFAULT_ADMIN_CLAUSES;
    setEditingContract(c);
    setContractTerms(base);
    setSecurityDeposit(values.securityDeposit);
    setMileageAllowance(values.mileageAllowance);
    setLatePenalty(values.latePenalty);
  };

  const handleSaveContractTerms = async () => {
    if (!editingContract) return;
    if (!perms.editContracts) {
      toast.error("โหมดสาธิตดูสัญญาได้อย่างเดียว");
      return;
    }
    const clauses = { securityDeposit, mileageAllowance, latePenalty };
    const problem = validateContractEdit(contractTerms, clauses);
    if (problem) {
      toast.error(problem);
      return;
    }

    setSavingContract(true);
    try {
      // Replace (never duplicate) the admin clause block with the current values
      const updatedTerms = buildContractTerms(contractTerms, clauses);
      const { data, error } = await supabase
        .from("contracts")
        .update({ terms: updatedTerms })
        .eq("id", editingContract.id)
        .select("id");

      if (error) throw error;
      if (!data || data.length === 0) throw new Error("ไม่สามารถบันทึกสัญญาได้ (ไม่พบสัญญาหรือไม่มีสิทธิ์)");

      toast.success("อัปเดตข้อกำหนดสัญญาเช่าเรียบร้อยแล้ว");
      setEditingContract(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-contracts"] }),
        queryClient.invalidateQueries({ queryKey: ["contract", editingContract.booking_id] }),
      ]);
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || "ไม่สามารถบันทึกข้อกำหนดสัญญาได้");
    } finally {
      setSavingContract(false);
    }
  };

  // -------------------------------------------------------------
  // Filtered Lists & Calculations
  // -------------------------------------------------------------
  const filteredCars = useMemo(() => {
    return cars.filter((c) => {
      const matchSearch =
        c.brand.toLowerCase().includes(carSearch.toLowerCase()) ||
        c.model.toLowerCase().includes(carSearch.toLowerCase()) ||
        c.plate_no.toLowerCase().includes(carSearch.toLowerCase());
      const matchCategory = carCategoryFilter === "all" || c.category === carCategoryFilter;
      const matchStatus = carStatusFilter === "all" || c.status === carStatusFilter;
      return matchSearch && matchCategory && matchStatus;
    });
  }, [cars, carSearch, carCategoryFilter, carStatusFilter]);

  const filteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      const car = b.cars;
      const profile = profileMap[b.user_id];
      const matchSearch =
        b.booking_code.toLowerCase().includes(bookingSearch.toLowerCase()) ||
        (car && `${car.brand} ${car.model} ${car.plate_no}`.toLowerCase().includes(bookingSearch.toLowerCase())) ||
        (profile && profile.full_name.toLowerCase().includes(bookingSearch.toLowerCase()));
      const matchStatus = bookingStatusFilter === "all" || b.status === bookingStatusFilter;
      return matchSearch && matchStatus;
    });
  }, [bookings, bookingSearch, bookingStatusFilter, profileMap]);

  const filteredContracts = useMemo(() => {
    return contracts.filter((c) => {
      const booking = c.bookings;
      const matchSearch =
        c.contract_no.toLowerCase().includes(contractSearch.toLowerCase()) ||
        (booking && booking.booking_code.toLowerCase().includes(contractSearch.toLowerCase()));
      return matchSearch;
    });
  }, [contracts, contractSearch]);

  const filteredMaintenance = useMemo(() => {
    return maintenanceRecords.filter((m) => {
      return maintStatusFilter === "all" || m.status === maintStatusFilter;
    });
  }, [maintenanceRecords, maintStatusFilter]);

  // Operational & Revenue Metrics
  const statusByBooking = useMemo(() => bookingStatusMap(bookings), [bookings]);

  const metrics = useMemo(() => {
    const totalCarsCount = cars.length;
    const availableCarsCount = cars.filter((c) => c.status === "available").length;
    const rentedCarsCount = cars.filter((c) => c.status === "rented").length;
    const maintenanceCarsCount = cars.filter((c) => c.status === "maintenance").length;

    const allTime = computeReport({ bookings, payments, maintenance: maintenanceRecords, range: "all" });

    return {
      totalCustomers: countCustomers(roles),
      totalCarsCount,
      availableCarsCount,
      rentedCarsCount,
      maintenanceCarsCount,
      activeBookingsCount: bookings.filter((b) => b.status === "confirmed" || b.status === "active").length,
      completedBookingsCount: bookings.filter((b) => b.status === "completed").length,
      totalRevenue: allTime.revenue,
      totalMaintenanceCost: allTime.maintCost,
      netProfit: allTime.profit,
      utilizationRate: totalCarsCount > 0 ? Math.round((rentedCarsCount / totalCarsCount) * 100) : 0,
    };
  }, [cars, bookings, payments, maintenanceRecords, roles]);

  // Date-filtered metrics for Reports tab
  const reportMetrics = useMemo(
    () => computeReport({ bookings, payments, maintenance: maintenanceRecords, range: reportDateRange }),
    [bookings, payments, maintenanceRecords, reportDateRange],
  );

  // Chart Data: revenue for the last 12 months (by payment date, Bangkok time)
  const chartData = useMemo(() => monthlyRevenueSeries(payments, statusByBooking), [payments, statusByBooking]);

  const exportBookingsCsv = () => {
    const names: Record<string, string> = {};
    for (const p of profiles) names[p.id] = p.full_name;
    const csv = bookingReportCsv({
      bookings,
      payments,
      customerNames: names,
      statusLabels: bookingStatusLabel,
      range: reportDateRange,
    });
    downloadTextFile(`siam-wheels-bookings-${reportDateRange}-${todayBkk()}.csv`, csv);
    toast.success("ดาวน์โหลดรายงานการจองและรายได้ (CSV) แล้ว");
  };

  const exportMaintenanceCsv = () => {
    const csv = maintenanceReportCsv({
      maintenance: maintenanceRecords,
      statusLabels: maintStatusLabel,
      range: reportDateRange,
    });
    downloadTextFile(`siam-wheels-maintenance-${reportDateRange}-${todayBkk()}.csv`, csv);
    toast.success("ดาวน์โหลดรายงานซ่อมบำรุง (CSV) แล้ว");
  };

  // Fleet distribution for PieChart
  const categoryData = useMemo(() => {
    const counts: Record<string, number> = {};
    cars.forEach((c) => {
      counts[c.category] = (counts[c.category] || 0) + 1;
    });
    return Object.entries(counts).map(([cat, count]) => ({
      name: categoryLabel[cat] || cat,
      value: count,
    }));
  }, [cars]);

  // -------------------------------------------------------------
  // Security Guard Check
  // -------------------------------------------------------------
  if (authLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-20 text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="mt-4 text-muted-foreground">กำลังตรวจสอบสิทธิ์ผู้ดูแลระบบ...</p>
      </div>
    );
  }

  if (!user || !allowed) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-destructive/10 text-destructive">
          <ShieldAlert className="h-8 w-8" />
        </div>
        <h2 className="text-2xl font-bold">ปฏิเสธการเข้าถึง (Access Denied)</h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          {isDemo
            ? "หน้านี้สงวนไว้สำหรับบัญชีผู้ดูแลระบบสาธิต (Demo Admin) เท่านั้น"
            : "หน้านี้สงวนไว้สำหรับผู้ดูแลระบบ (Administrator) ของ Siam Wheels Rental Hub เท่านั้น บัญชีของคุณไม่มีสิทธิ์ในการเข้าถึงระบบนี้"}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          {user && role === "demo_admin" && !isDemo && (
            <Button asChild>
              <Link to="/demo-admin">ไปที่แดชบอร์ดสาธิต (Demo Admin)</Link>
            </Button>
          )}
          {user && role === "admin" && isDemo && (
            <Button asChild>
              <Link to="/admin">ไปที่ระบบผู้ดูแล (Admin)</Link>
            </Button>
          )}
          <Button variant={user && role !== "customer" ? "outline" : "default"} asChild>
            <Link to="/">กลับสู่หน้าหลัก</Link>
          </Button>
          {!user && (
            <Button variant="outline" asChild>
              <Link to="/auth" search={isDemo ? { demo: true } : {}}>
                {isDemo ? "เข้าสู่ระบบ Demo Admin" : "เข้าสู่ระบบด้วยบัญชีผู้ดูแล"}
              </Link>
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {isDemo && (
        <div
          role="status"
          className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">โหมดสาธิต (Demo Admin)</p>
            <p className="mt-0.5">
              เพิ่ม/แก้ไขรถ เปลี่ยนสถานะการจอง และบันทึกงานซ่อมบำรุงได้ ดูสัญญาเช่าและรายงานได้
              แต่ลบข้อมูล แก้ไขสัญญา จัดการรีวิว หรือเปลี่ยนสิทธิ์ผู้ใช้ไม่ได้
            </p>
          </div>
        </div>
      )}
      {failedQueries.length > 0 && (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              โหลดข้อมูลบางส่วนไม่สำเร็จ: {failedQueries.map((x) => x.label).join(", ")} — ตัวเลขที่แสดงอาจไม่ครบถ้วน
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={retryFailedQueries}>
            ลองใหม่
          </Button>
        </div>
      )}
      {/* Admin Top Header */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b pb-6">
        <div>
          <div className="flex items-center gap-2">
            {isDemo ? (
              <Badge variant="outline" className="border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                <ShieldAlert className="mr-1 h-3.5 w-3.5" /> Demo Admin Portal
              </Badge>
            ) : (
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Administrator Portal
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">Siam Wheels Operations</span>
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">ศูนย์ควบคุมและบริหารจัดการรถเช่า</h1>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={() => openCarModal()} className="gap-1.5 shadow-sm">
            <Plus className="h-4 w-4" /> เพิ่มรถยนต์ใหม่
          </Button>
          <Button variant="outline" onClick={() => setMaintModalOpen(true)} className="gap-1.5">
            <Wrench className="h-4 w-4" /> บันทึกซ่อมบำรุง
          </Button>
        </div>
      </div>

      {/* Main Admin Navigation Tabs (Responsive Sidebar Layout) */}
      <div className="grid gap-8 lg:grid-cols-12">
        {/* Navigation Sidebar (3 Cols) */}
        <aside className="lg:col-span-3">
          <Card className="shadow-card border sticky top-24">
            <CardHeader className="pb-3 border-b bg-muted/20">
              <CardTitle className="text-sm font-semibold text-muted-foreground">เมนูการจัดการระบบ</CardTitle>
            </CardHeader>
            <CardContent className="p-2 space-y-1">
              {[
                { id: "overview", label: "ภาพรวมระบบ", icon: LayoutDashboard, count: null },
                { id: "cars", label: "จัดการรถยนต์ในระบบ", icon: CarIcon, count: cars.length },
                { id: "bookings", label: "รายการจองของลูกค้า", icon: Calendar, count: bookings.length },
                { id: "contracts", label: "สัญญาเช่าดิจิทัล", icon: FileCheck2, count: contracts.length },
                { id: "maintenance", label: "งานซ่อมบำรุง", icon: Wrench, count: maintenanceRecords.length },
                { id: "reviews", label: "รีวิวจากลูกค้า", icon: MessageSquareWarning, count: reviewsForCount.length },
                { id: "reports", label: "รายงานและสถิติ", icon: BarChart3, count: null },
              ]
                .filter((item) => item.id !== "reviews" || perms.moderateReviews)
                .map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as AdminTab)}
                  className={`w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    activeTab === item.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </div>
                  {item.count !== null && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        activeTab === item.id
                          ? "bg-primary-foreground/20 text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              ))}
            </CardContent>
          </Card>
        </aside>

        {/* Content Area (9 Cols) */}
        <main className="space-y-6 lg:col-span-9">
          {/* TAB 1: OVERVIEW */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* 6 Key Operational Metrics */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Card className="shadow-card border">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground">รายได้รวมสุทธิ (THB)</CardTitle>
                    <DollarSign className="h-4 w-4 text-primary" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-primary">{thb(metrics.totalRevenue)}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      กำไรจากการดำเนินงาน: <span className="font-semibold text-success">{thb(metrics.netProfit)}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">นับจากยอดชำระเงินจริง (DEMO) ไม่รวมรายการรอชำระ</p>
                  </CardContent>
                </Card>

                <Card className="shadow-card border">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground">กองยานพาหนะทั้งหมด</CardTitle>
                    <CarIcon className="h-4 w-4 text-primary" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-foreground">{metrics.totalCarsCount} คัน</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      ว่าง {metrics.availableCarsCount} · ถูกเช่า {metrics.rentedCarsCount} · ซ่อม {metrics.maintenanceCarsCount}
                    </p>
                  </CardContent>
                </Card>

                <Card className="shadow-card border">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground">อัตราการใช้งานรถยนต์</CardTitle>
                    <TrendingUp className="h-4 w-4 text-primary" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-foreground">{metrics.utilizationRate}%</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      กำลังถูกเช่าจริง {metrics.rentedCarsCount} จาก {metrics.totalCarsCount} คัน
                    </p>
                  </CardContent>
                </Card>

                <Card className="shadow-card border">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground">การจองที่รออนุมัติ / กำลังเช่า</CardTitle>
                    <Calendar className="h-4 w-4 text-primary" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-foreground">{metrics.activeBookingsCount} รายการ</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      เสร็จสิ้นทั้งหมด {metrics.completedBookingsCount} ทริป
                    </p>
                  </CardContent>
                </Card>

                <Card className="shadow-card border">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground">ลูกค้าที่ลงทะเบียน</CardTitle>
                    <Users className="h-4 w-4 text-primary" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-foreground">{metrics.totalCustomers} ท่าน</div>
                    <p className="text-xs text-muted-foreground mt-1">พร้อมประวัติและเอกสารยืนยันตัวตน</p>
                  </CardContent>
                </Card>

                <Card className="shadow-card border">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground">ค่าใช้จ่ายซ่อมบำรุงสะสม</CardTitle>
                    <Wrench className="h-4 w-4 text-warning" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-warning-foreground">{thb(metrics.totalMaintenanceCost)}</div>
                    <p className="text-xs text-muted-foreground mt-1">บันทึกแล้ว {maintenanceRecords.length} รายการ</p>
                  </CardContent>
                </Card>
              </div>

              {/* Monthly Revenue Chart */}
              <Card className="shadow-card border">
                <CardHeader>
                  <CardTitle className="text-base font-semibold">แนวโน้มรายได้และจำนวนการจองรายเดือน</CardTitle>
                  <CardDescription>รายได้จากการชำระเงิน 12 เดือนล่าสุด (ตามวันที่ชำระ เวลาประเทศไทย)</CardDescription>
                </CardHeader>
                <CardContent className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="name" fontSize={12} />
                      <YAxis fontSize={12} tickFormatter={(val) => `฿${(val / 1000).toFixed(0)}k`} />
                      <Tooltip
                        formatter={(val: unknown) => [thb(Number(val) || 0), "รายได้"]}
                        labelStyle={{ fontWeight: "bold" }}
                      />
                      <Bar dataKey="revenue" fill="currentColor" className="fill-primary" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Recent Bookings Overview Table */}
              <Card className="shadow-card border">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold">รายการจองล่าสุด</CardTitle>
                    <CardDescription>รายการจองที่เข้ามาในระบบล่าสุด 5 รายการ</CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setActiveTab("bookings")} className="gap-1">
                    ดูทั้งหมด <ChevronRight className="h-4 w-4" />
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>รหัสการจอง</TableHead>
                        <TableHead>ลูกค้า</TableHead>
                        <TableHead>รถยนต์</TableHead>
                        <TableHead>วันที่เช่า</TableHead>
                        <TableHead>สถานะ</TableHead>
                        <TableHead className="text-right">ยอดรวม</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bookings.slice(0, 5).map((b) => (
                        <TableRow key={b.id}>
                          <TableCell className="font-mono text-xs font-semibold">{b.booking_code}</TableCell>
                          <TableCell className="text-xs">
                            {profileMap[b.user_id]?.full_name || "ลูกค้าสมาชิก"}
                          </TableCell>
                          <TableCell className="text-xs font-medium">
                            {b.cars?.brand} {b.cars?.model} ({b.cars?.plate_no})
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {fmtDate(b.start_date)} — {fmtDate(b.end_date)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={b.status} kind="booking" />
                          </TableCell>
                          <TableCell className="text-right font-semibold text-primary">
                            {thb(b.total_amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {bookings.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                            ยังไม่มีรายการจองในระบบ
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {/* TAB 2: CAR FLEET MANAGEMENT */}
          {activeTab === "cars" && (
            <Card className="shadow-card border">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-xl">จัดการรถยนต์ในระบบ ({filteredCars.length} คัน)</CardTitle>
                    <CardDescription>เพิ่ม ลบ แก้ไข ข้อมูลสเปกและราคาเช่ารายวัน</CardDescription>
                  </div>
                  <Button onClick={() => openCarModal()} className="gap-1.5">
                    <Plus className="h-4 w-4" /> เพิ่มรถยนต์ใหม่
                  </Button>
                </div>

                {/* Filter Toolbar */}
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="relative">
                    <Input
                      placeholder="ค้นหายี่ห้อ รุ่น หรือทะเบียน..."
                      value={carSearch}
                      onChange={(e) => setCarSearch(e.target.value)}
                      className="pl-9"
                    />
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  </div>

                  <Select value={carCategoryFilter} onValueChange={setCarCategoryFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="ประเภทรถยนต์" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">ทุกประเภท</SelectItem>
                      {CATEGORIES.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={carStatusFilter} onValueChange={setCarStatusFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="สถานะรถยนต์" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">ทุกสถานะ</SelectItem>
                      {CAR_STATUSES.map((st) => (
                        <SelectItem key={st.value} value={st.value}>
                          {st.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>รูปรถ</TableHead>
                      <TableHead>ยี่ห้อ / รุ่น / ปี</TableHead>
                      <TableHead>ทะเบียน</TableHead>
                      <TableHead>ประเภท</TableHead>
                      <TableHead>ราคา / วัน</TableHead>
                      <TableHead>เลขไมล์</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCars.map((car) => (
                      <TableRow key={car.id}>
                        <TableCell>
                          <img
                            src={carImage(car.image_url, car.category)}
                            alt={car.model}
                            className="h-10 w-16 object-cover rounded border bg-muted"
                          />
                        </TableCell>
                        <TableCell>
                          <span className="font-semibold text-foreground">
                            {car.brand} {car.model}
                          </span>
                          <span className="block text-xs text-muted-foreground">ปี {car.year}</span>
                        </TableCell>
                        <TableCell className="font-mono text-xs font-semibold">{car.plate_no}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {categoryLabel[car.category] || car.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-semibold text-primary">{thb(car.price_per_day)}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {car.mileage.toLocaleString("th-TH")} กม.
                        </TableCell>
                        <TableCell>
                          <Select
                            value={car.status}
                            onValueChange={(val) => handleUpdateCarStatus(car.id, val as Tables<"cars">["status"])}
                          >
                            <SelectTrigger className="h-7 text-xs w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CAR_STATUSES.map((st) => (
                                <SelectItem key={st.value} value={st.value} className="text-xs">
                                  {st.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openCarModal(car)} title="แก้ไข">
                              <Edit className="h-4 w-4" />
                            </Button>
                            {perms.deleteCars && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:bg-destructive/10"
                                onClick={() => setCarToDelete(car)}
                                title="ลบรถยนต์"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredCars.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          ไม่พบรถยนต์ที่ตรงกับเงื่อนไขการค้นหา
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* TAB 3: BOOKINGS MANAGEMENT */}
          {activeTab === "bookings" && (
            <Card className="shadow-card border">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-xl">รายการจองของลูกค้า ({filteredBookings.length} รายการ)</CardTitle>
                    <CardDescription>ตรวจสอบ ยืนยันสถานะการเช่า และควบคุมการส่งมอบรถ</CardDescription>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="relative">
                    <Input
                      placeholder="ค้นหารหัสการจอง ชื่อลูกค้า หรือทะเบียนรถ..."
                      value={bookingSearch}
                      onChange={(e) => setBookingSearch(e.target.value)}
                      className="pl-9"
                    />
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  </div>

                  <Select value={bookingStatusFilter} onValueChange={setBookingStatusFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="กรองตามสถานะ" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">ทุกสถานะ</SelectItem>
                      <SelectItem value="pending">รอชำระเงิน</SelectItem>
                      <SelectItem value="confirmed">ยืนยันแล้ว</SelectItem>
                      <SelectItem value="active">กำลังเช่า (รับรถแล้ว)</SelectItem>
                      <SelectItem value="completed">เสร็จสิ้น</SelectItem>
                      <SelectItem value="cancelled">ยกเลิก</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>รหัสการจอง</TableHead>
                      <TableHead>ข้อมูลลูกค้า</TableHead>
                      <TableHead>รถยนต์</TableHead>
                      <TableHead>สาขา / วันที่</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead>ยอดรวม</TableHead>
                      <TableHead className="text-right">การจัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredBookings.map((b) => {
                      const profile = profileMap[b.user_id];
                      return (
                        <TableRow key={b.id}>
                          <TableCell className="font-mono text-xs font-bold text-foreground">
                            {b.booking_code}
                          </TableCell>
                          <TableCell>
                            <span className="font-medium text-xs block text-foreground">
                              {profile?.full_name || "ลูกค้าสมาชิก"}
                            </span>
                            <span className="text-[11px] text-muted-foreground font-mono">
                              {profile?.phone || "-"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs font-semibold block">
                              {b.cars?.brand} {b.cars?.model}
                            </span>
                            <span className="text-[11px] text-muted-foreground font-mono">
                              {b.cars?.plate_no}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className="block font-medium">{b.pickup_location}</span>
                            <span className="text-muted-foreground text-[11px]">
                              {fmtDate(b.start_date)} — {fmtDate(b.end_date)} ({b.days} วัน)
                            </span>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={b.status} kind="booking" />
                          </TableCell>
                          <TableCell className="font-semibold text-primary">{thb(b.total_amount)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => {
                                  setUpdatingBooking(b);
                                  setNewBookingStatus(b.status);
                                }}
                              >
                                เปลี่ยนสถานะ
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 px-2" asChild>
                                <Link to="/bookings/$id" params={{ id: b.id }} target="_blank">
                                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                                </Link>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {filteredBookings.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          ไม่พบรายการจองที่ตรงกับเงื่อนไข
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* TAB 4: CONTRACTS MANAGEMENT */}
          {activeTab === "contracts" && (
            <Card className="shadow-card border">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-xl">สัญญาเช่าดิจิทัล ({filteredContracts.length} ฉบับ)</CardTitle>
                    <CardDescription>ตรวจสอบข้อตกลง สภาพการลงนาม และกำหนดเงื่อนไขเพิ่มเติม</CardDescription>
                  </div>
                </div>

                <div className="mt-4 relative max-w-sm">
                  <Input
                    placeholder="ค้นหาเลขที่สัญญา หรือรหัสการจอง..."
                    value={contractSearch}
                    onChange={(e) => setContractSearch(e.target.value)}
                    className="pl-9"
                  />
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>

              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>เลขที่สัญญา</TableHead>
                      <TableHead>รหัสการจอง</TableHead>
                      <TableHead>รถยนต์</TableHead>
                      <TableHead>สถานะการลงนาม</TableHead>
                      <TableHead>วันที่สร้างสัญญา</TableHead>
                      <TableHead className="text-right">จัดการข้อตกลง</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredContracts.map((c) => {
                      const isSigned = !!c.customer_accepted_at;
                      return (
                        <TableRow key={c.id}>
                          <TableCell className="font-mono text-xs font-bold text-foreground">
                            {c.contract_no}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {c.bookings?.booking_code || "-"}
                          </TableCell>
                          <TableCell className="text-xs font-medium">
                            {c.bookings?.cars?.brand} {c.bookings?.cars?.model} ({c.bookings?.cars?.plate_no})
                          </TableCell>
                          <TableCell>
                            {isSigned ? (
                              <Badge variant="outline" className="border-success/30 bg-success/10 text-success text-xs">
                                <CheckCircle2 className="h-3 w-3 mr-1" /> ลงนามแล้ว
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning text-xs">
                                <Clock className="h-3 w-3 mr-1" /> รอลูกค้าลงนาม
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtDateTime(c.created_at)}</TableCell>
                          <TableCell className="text-right">
                            {perms.editContracts ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => openContractEditor(c)}
                              >
                                แก้ไขข้อตกลง
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setViewingContract(c)}
                              >
                                ดูสัญญา
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {filteredContracts.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          ไม่พบสัญญาเช่าในระบบ
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* TAB 5: MAINTENANCE TRACKING */}
          {activeTab === "maintenance" && (
            <Card className="shadow-card border">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-xl">งานซ่อมบำรุงและดูแลรักษารถยนต์</CardTitle>
                    <CardDescription>บันทึกประวัติการเข้าศูนย์ เช็คระยะ และค่าใช้จ่ายการซ่อมบำรุง</CardDescription>
                  </div>
                  <Button onClick={() => setMaintModalOpen(true)} className="gap-1.5">
                    <Plus className="h-4 w-4" /> บันทึกงานซ่อมบำรุง
                  </Button>
                </div>

                <div className="mt-4 max-w-xs">
                  <Select value={maintStatusFilter} onValueChange={setMaintStatusFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="กรองสถานะซ่อมบำรุง" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">ทุกสถานะ</SelectItem>
                      <SelectItem value="scheduled">นัดหมายแล้ว</SelectItem>
                      <SelectItem value="in_progress">กำลังดำเนินการ</SelectItem>
                      <SelectItem value="completed">เสร็จสิ้น</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>รถยนต์ / ทะเบียน</TableHead>
                      <TableHead>รายการซ่อมบำรุง</TableHead>
                      <TableHead>วันที่นัดหมาย</TableHead>
                      <TableHead>ค่าใช้จ่าย</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMaintenance.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <span className="font-semibold text-xs block">
                            {m.cars?.brand} {m.cars?.model}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">{m.cars?.plate_no}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs font-medium block text-foreground">{m.title}</span>
                          <span className="text-[11px] text-muted-foreground">{m.description || "-"}</span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(m.scheduled_date)}</TableCell>
                        <TableCell className="font-semibold text-primary text-xs">{thb(m.cost)}</TableCell>
                        <TableCell>
                          <StatusBadge status={m.status} kind="maint" />
                          {m.completed_date && (
                            <span className="block text-[11px] text-muted-foreground mt-1">
                              เสร็จ {fmtDate(m.completed_date)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            {m.status === "scheduled" && (
                              <Button size="sm" variant="outline" className="text-xs h-7"
                                onClick={() => handleMaintenanceStatus(m, "in_progress")}>
                                เริ่มซ่อม
                              </Button>
                            )}
                            {m.status !== "completed" && (
                              <Button size="sm" className="text-xs h-7"
                                onClick={() => handleMaintenanceStatus(m, "completed")}>
                                เสร็จสิ้น
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredMaintenance.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          ไม่พบประวัติงานซ่อมบำรุง
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* TAB: CUSTOMER REVIEWS (moderation) */}
          {activeTab === "reviews" && <AdminReviewsPanel isAdmin={perms.moderateReviews} />}

          {/* TAB 6: REPORTS & ANALYTICS */}
          {activeTab === "reports" && (
            <div className="space-y-6">
              {/* Date Filter Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm">
                <div>
                  <h3 className="font-semibold text-sm">ช่วงเวลาสำหรับรายงาน (Date Range Filter)</h3>
                  <p className="text-xs text-muted-foreground">กรองสถิติรายได้และข้อมูลการใช้งานตามช่วงเวลา</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={reportDateRange} onValueChange={(val) => setReportDateRange(val as ReportRange)}>
                    <SelectTrigger className="w-48 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">ข้อมูลทั้งหมด (All Time)</SelectItem>
                      <SelectItem value="30d">30 วันล่าสุด (Last 30 Days)</SelectItem>
                      <SelectItem value="90d">90 วันล่าสุด (Last 90 Days)</SelectItem>
                      <SelectItem value="year">ปีปัจจุบัน (This Year)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={exportBookingsCsv}>
                    <Download className="h-3.5 w-3.5" /> ส่งออกการจองและรายได้ (CSV)
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={exportMaintenanceCsv}>
                    <Download className="h-3.5 w-3.5" /> ส่งออกงานซ่อมบำรุง (CSV)
                  </Button>
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                {/* Revenue Overview */}
                <Card className="shadow-card border">
                  <CardHeader>
                    <CardTitle className="text-base font-semibold">สรุปผลประกอบการทางการเงิน</CardTitle>
                    <CardDescription>วิเคราะห์รายรับ ค่าใช้จ่าย และกำไรสุทธิตามช่วงเวลา</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">รายได้จากการเช่า:</span>
                        <span className="font-semibold text-primary">{thb(reportMetrics.revenue)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">ค่าใช้จ่ายซ่อมบำรุงรวม:</span>
                        <span className="font-semibold text-destructive">- {thb(reportMetrics.maintCost)}</span>
                      </div>
                      <div className="border-t pt-2 flex justify-between text-base font-bold">
                        <span>กำไรสุทธิจากการดำเนินงาน:</span>
                        <span className={reportMetrics.profit < 0 ? "text-destructive" : "text-success"}>
                          {thb(reportMetrics.profit)}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3 text-xs">
                      <span className="text-muted-foreground">รายการชำระเงิน:</span>
                      <span className="text-right font-medium">{reportMetrics.paidCount} รายการ</span>
                      <span className="text-muted-foreground">การจองใหม่ (ไม่รวมยกเลิก):</span>
                      <span className="text-right font-medium">{reportMetrics.bookingCount} รายการ</span>
                      <span className="text-muted-foreground">รอชำระเงิน:</span>
                      <span className="text-right font-medium">{reportMetrics.pendingCount} รายการ</span>
                      <span className="text-muted-foreground">เสร็จสิ้น / ยกเลิก:</span>
                      <span className="text-right font-medium">
                        {reportMetrics.completedCount} / {reportMetrics.cancelledCount}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      รายได้นับจากการชำระเงิน (โหมด DEMO) ของการจองที่ยืนยันแล้ว กำลังเช่า หรือเสร็จสิ้น ตามวันที่ชำระ
                      ไม่รวมการจองที่รอชำระหรือถูกยกเลิก
                    </p>

                    <div className="pt-4 border-t">
                      <p className="text-xs text-muted-foreground mb-3 font-medium">สัดส่วนประเภทยานพาหนะในระบบ</p>
                      <div className="h-44">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={categoryData}
                              cx="50%"
                              cy="50%"
                              innerRadius={40}
                              outerRadius={65}
                              paddingAngle={4}
                              dataKey="value"
                            >
                              {categoryData.map((_, index) => (
                                <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Operational Performance */}
                <Card className="shadow-card border">
                  <CardHeader>
                    <CardTitle className="text-base font-semibold">ดัชนีชี้วัดประสิทธิภาพการดำเนินงาน (KPIs)</CardTitle>
                    <CardDescription>วิเคราะห์การใช้งานกองยานพาหนะและความคุ้มค่า</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm">
                    <div className="rounded-xl bg-muted/40 p-4 space-y-2.5">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">อัตราการใช้งานรถยนต์ (Utilization):</span>
                        <span className="font-bold text-foreground">{metrics.utilizationRate}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">ค่าเฉลี่ยรายได้ต่อคัน:</span>
                        <span className="font-semibold text-foreground">
                          {metrics.totalCarsCount > 0 ? thb(metrics.totalRevenue / metrics.totalCarsCount) : thb(0)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">จำนวนทริปที่สำเร็จแล้ว:</span>
                        <span className="font-semibold text-foreground">{metrics.completedBookingsCount} ทริป</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">รถที่พร้อมให้บริการทันที:</span>
                        <span className="font-semibold text-success">{metrics.availableCarsCount} คัน</span>
                      </div>
                    </div>

                    <div className="p-4 border rounded-xl text-xs text-muted-foreground space-y-1.5">
                      <p className="font-medium text-foreground">💡 ข้อแนะนำสำหรับการดำเนินงาน:</p>
                      <p>• หากอัตรา Utilization สูงกว่า 80% ควรพิจารณาเพิ่มจำนวนรถในหมวดหมู่ยอดนิยม (Eco/Sedan)</p>
                      <p>• ตรวจสอบรถยนต์ที่มีกำหนดซ่อมบำรุงสม่ำเสมอเพื่อลดความเสี่ยงต่ออุบัติเหตุ</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* DIALOG 1: ADD / EDIT CAR */}
      {/* ------------------------------------------------------------- */}
      <Dialog open={carModalOpen} onOpenChange={setCarModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCar ? "แก้ไขข้อมูลรถยนต์" : "เพิ่มรถยนต์ใหม่เข้าสู่ระบบ"}</DialogTitle>
            <DialogDescription>
              ระบุรายละเอียดของตัวรถ หมายเลขทะเบียน และอัตราค่าเช่าต่อวัน
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveCar} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="car-brand" className="text-xs">ยี่ห้อ (Brand) *</Label>
                <Input
                  id="car-brand"
                  placeholder="เช่น Toyota, Honda"
                  value={carForm.brand}
                  onChange={(e) => setCarForm({ ...carForm, brand: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="car-model" className="text-xs">รุ่น (Model) *</Label>
                <Input
                  id="car-model"
                  placeholder="เช่น Yaris, Camry"
                  value={carForm.model}
                  onChange={(e) => setCarForm({ ...carForm, model: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="car-year" className="text-xs">ปีรถ (Year)</Label>
                <Input
                  id="car-year"
                  type="number"
                  value={carForm.year}
                  onChange={(e) => setCarForm({ ...carForm, year: Number(e.target.value) })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="car-category" className="text-xs">หมวดหมู่</Label>
                <Select
                  value={carForm.category}
                  onValueChange={(val) => setCarForm({ ...carForm, category: val })}
                >
                  <SelectTrigger id="car-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="car-plate" className="text-xs">หมายเลขทะเบียน *</Label>
                <Input
                  id="car-plate"
                  placeholder="เช่น 1กข 1234"
                  value={carForm.plate_no}
                  onChange={(e) => setCarForm({ ...carForm, plate_no: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="car-seats" className="text-xs">จำนวนที่นั่ง</Label>
                <Input
                  id="car-seats"
                  type="number"
                  value={carForm.seats}
                  onChange={(e) => setCarForm({ ...carForm, seats: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label htmlFor="car-trans" className="text-xs">ระบบเกียร์</Label>
                <Input
                  id="car-trans"
                  value={carForm.transmission}
                  onChange={(e) => setCarForm({ ...carForm, transmission: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="car-fuel" className="text-xs">เชื้อเพลิง</Label>
                <Input
                  id="car-fuel"
                  value={carForm.fuel}
                  onChange={(e) => setCarForm({ ...carForm, fuel: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="car-price" className="text-xs">ราคาต่อวัน (THB) *</Label>
                <Input
                  id="car-price"
                  type="number"
                  value={carForm.price_per_day}
                  onChange={(e) => setCarForm({ ...carForm, price_per_day: Number(e.target.value) })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="car-mileage" className="text-xs">เลขไมล์สะสม (กม.)</Label>
                <Input
                  id="car-mileage"
                  type="number"
                  value={carForm.mileage}
                  onChange={(e) => setCarForm({ ...carForm, mileage: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label htmlFor="car-status-select" className="text-xs">สถานะเริ่มต้น</Label>
                <Select
                  value={carForm.status}
                  onValueChange={(val) => setCarForm({ ...carForm, status: val as Tables<"cars">["status"] })}
                >
                  <SelectTrigger id="car-status-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CAR_STATUSES.map((st) => (
                      <SelectItem key={st.value} value={st.value}>
                        {st.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="car-img" className="text-xs">URL รูปภาพรถยนต์ (เว้นว่างไว้เพื่อใช้รูปมาตรฐาน)</Label>
              <Input
                id="car-img"
                placeholder="https://images.unsplash.com/..."
                value={carForm.image_url}
                onChange={(e) => setCarForm({ ...carForm, image_url: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="car-desc" className="text-xs">คำอธิบายเพิ่มเติม</Label>
              <Textarea
                id="car-desc"
                rows={2}
                placeholder="รายละเอียดอุปกรณ์ ความสะดวกสบาย..."
                value={carForm.description}
                onChange={(e) => setCarForm({ ...carForm, description: e.target.value })}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCarModalOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="submit">บันทึกข้อมูลรถยนต์</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------- */}
      {/* DIALOG 2: UPDATE BOOKING STATUS */}
      {/* ------------------------------------------------------------- */}
      <Dialog open={!!updatingBooking} onOpenChange={(open) => !open && setUpdatingBooking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ปรับปรุงสถานะการจอง</DialogTitle>
            <DialogDescription>
              รหัสการจอง: <span className="font-mono font-bold text-foreground">{updatingBooking?.booking_code}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs">เลือกสถานะใหม่</Label>
              <Select
                value={newBookingStatus}
                onValueChange={(val) => setNewBookingStatus(val as Tables<"bookings">["status"])}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">รอชำระเงิน (Pending)</SelectItem>
                  <SelectItem value="confirmed">ยืนยันแล้ว (Confirmed)</SelectItem>
                  <SelectItem value="active">กำลังเช่า - ส่งมอบรถแล้ว (Active)</SelectItem>
                  <SelectItem value="completed">เสร็จสิ้น - รับรถคืนแล้ว (Completed)</SelectItem>
                  <SelectItem value="cancelled">ยกเลิกการจอง (Cancelled)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground space-y-1">
              <p>• เมื่อเปลี่ยนเป็น <strong>กำลังเช่า (Active)</strong> ระบบจะปรับสถานะรถคันนี้เป็น "ถูกเช่า" อัตโนมัติ</p>
              <p>• เมื่อเปลี่ยนเป็น <strong>เสร็จสิ้น (Completed)</strong> รถจะกลับสู่สถานะ "ว่าง" พร้อมให้บริการต่อ</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdatingBooking(null)}>
              ยกเลิก
            </Button>
            <Button onClick={handleUpdateBookingStatus}>บันทึกสถานะ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------- */}
      {/* DIALOG 3: CREATE MAINTENANCE SCHEDULE */}
      {/* ------------------------------------------------------------- */}
      <Dialog open={maintModalOpen} onOpenChange={setMaintModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>บันทึกตารางการซ่อมบำรุง</DialogTitle>
            <DialogDescription>
              สร้างงานเช็คระยะ ตรวจสภาพ หรือซ่อมแซมสำหรับรถยนต์ในกองยานพาหนะ
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveMaintenance} className="space-y-3.5 pt-2">
            <div>
              <Label className="text-xs">เลือกรถยนต์ที่ต้องการซ่อมบำรุง *</Label>
              <Select
                value={maintForm.car_id}
                onValueChange={(val) => setMaintForm({ ...maintForm, car_id: val })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="ค้นหาและเลือกรถยนต์..." />
                </SelectTrigger>
                <SelectContent>
                  {cars.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.brand} {c.model} (ทะเบียน {c.plate_no})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="maint-title" className="text-xs">หัวข้องานซ่อมบำรุง *</Label>
              <Input
                id="maint-title"
                placeholder="เช่น เปลี่ยนถ่ายน้ำมันเครื่อง 20,000 กม."
                value={maintForm.title}
                onChange={(e) => setMaintForm({ ...maintForm, title: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="maint-date" className="text-xs">วันที่นัดหมาย</Label>
                <Input
                  id="maint-date"
                  type="date"
                  value={maintForm.scheduled_date}
                  onChange={(e) => setMaintForm({ ...maintForm, scheduled_date: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="maint-cost" className="text-xs">ค่าใช้จ่ายโดยประมาณ (THB)</Label>
                <Input
                  id="maint-cost"
                  type="number"
                  value={maintForm.cost}
                  onChange={(e) => setMaintForm({ ...maintForm, cost: Number(e.target.value) })}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">สถานะงานซ่อมบำรุง</Label>
              <Select
                value={maintForm.status}
                onValueChange={(val) => setMaintForm({ ...maintForm, status: val as Tables<"maintenance">["status"] })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="scheduled">นัดหมายแล้ว</SelectItem>
                  <SelectItem value="in_progress">กำลังดำเนินการ (รถจะงดให้บริการ)</SelectItem>
                  <SelectItem value="completed">เสร็จสิ้นเรียบร้อย</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="maint-desc" className="text-xs">รายละเอียดการซ่อมเพิ่มเติม</Label>
              <Textarea
                id="maint-desc"
                rows={2}
                placeholder="ศูนย์บริการ อะไหล่ที่เปลี่ยน..."
                value={maintForm.description}
                onChange={(e) => setMaintForm({ ...maintForm, description: e.target.value })}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMaintModalOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="submit">บันทึกข้อมูลซ่อมบำรุง</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------- */}
      {/* DIALOG 4: EDIT CONTRACT TERMS */}
      {/* ------------------------------------------------------------- */}
      <Dialog open={!!editingContract} onOpenChange={(open) => !open && setEditingContract(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>ปรับปรุงข้อกำหนดสัญญาเช่า</DialogTitle>
            <DialogDescription>
              เลขที่สัญญา: <span className="font-mono font-bold text-foreground">{editingContract?.contract_no}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {editingContract?.customer_accepted_at && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs" role="alert">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>
                  ลูกค้าลงนามยอมรับสัญญาฉบับเดิมแล้วเมื่อ {fmtDateTime(editingContract.customer_accepted_at)}
                  การแก้ไขจะเปลี่ยนข้อความที่ลูกค้าเห็น กรุณาแจ้งลูกค้าทุกครั้ง
                </span>
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="depo-val" className="text-xs">เงินมัดจำประกัน (THB)</Label>
                <Input
                  id="depo-val"
                  type="number"
                  min={0}
                  value={securityDeposit}
                  onChange={(e) => setSecurityDeposit(Number(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="mile-val" className="text-xs">ระยะทางที่อนุญาต</Label>
                <Input
                  id="mile-val"
                  value={mileageAllowance}
                  onChange={(e) => setMileageAllowance(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="late-val" className="text-xs">ค่าปรับส่งคืนล่าช้า</Label>
                <Input
                  id="late-val"
                  value={latePenalty}
                  onChange={(e) => setLatePenalty(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="terms-text" className="text-xs">ข้อความสัญญา (ข้อกำหนดเพิ่มเติมด้านบนจะถูกแนบท้ายให้อัตโนมัติ)</Label>
              <Textarea
                id="terms-text"
                rows={10}
                className="font-mono text-xs leading-relaxed mt-1.5"
                value={contractTerms}
                onChange={(e) => setContractTerms(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingContract(null)}>
              ยกเลิก
            </Button>
            <Button onClick={handleSaveContractTerms} disabled={savingContract}>
              {savingContract ? "กำลังบันทึก..." : "บันทึกข้อกำหนดสัญญา"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------- */}
      {/* DIALOG 5: DELETE CAR CONFIRMATION */}
      {/* ------------------------------------------------------------- */}
      <Dialog open={!!viewingContract} onOpenChange={(open) => !open && setViewingContract(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>สัญญาเช่า {viewingContract?.contract_no}</DialogTitle>
            <DialogDescription>
              การจอง {viewingContract?.bookings?.booking_code ?? "-"} · ดูได้อย่างเดียว (โหมดสาธิต)
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/30 p-4 font-sans text-sm leading-relaxed">
            {viewingContract?.terms}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingContract(null)}>
              ปิด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!carToDelete && perms.deleteCars} onOpenChange={(open) => !open && setCarToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" /> ยืนยันการลบรถยนต์ออกจากระบบ
            </DialogTitle>
            <DialogDescription>
              คุณแน่ใจหรือไม่ว่าต้องการลบรถยนต์{" "}
              <strong className="text-foreground">
                {carToDelete?.brand} {carToDelete?.model} (ทะเบียน {carToDelete?.plate_no})
              </strong>{" "}
              ออกจากระบบ?
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive border border-destructive/20 space-y-1">
            <p className="font-semibold">⚠️ ข้อกำหนดความปลอดภัยของระบบ:</p>
            <p>• หากรถยนต์คันนี้เคยมีประวัติการจองหรือสัญญาเช่าในระบบ ระบบจะไม่อนุญาตให้ลบ เพื่อป้องกันข้อมูลสูญหาย</p>
            <p>• หากต้องการหยุดให้บริการรถคันนี้ กรุณาเปลี่ยนสถานะเป็น "งดให้บริการ" หรือ "ซ่อมบำรุง" แทน</p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCarToDelete(null)}>
              ยกเลิก
            </Button>
            <Button variant="destructive" disabled={deletingCar} onClick={handleDeleteCar}>
              {deletingCar ? "กำลังลบ..." : "ยืนยันการลบ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
