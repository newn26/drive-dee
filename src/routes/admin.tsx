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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
// Real database, or the in-browser sample data on the public Demo Admin page
import { db as supabase } from "@/lib/db";
import { SANDBOX_OWNER_ID } from "@/lib/demo-sandbox";
import { useAuth } from "@/hooks/use-auth";
import { carImage } from "@/lib/car-images";
import {
  bookingStatusLabel,
  categoryLabel,
  fmtDate,
  fmtDateTime,
  maintStatusLabel,
  thb,
  todayBkk,
  pickupLocationLabel,
} from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";
import { invalidateBookingData } from "@/lib/queries";
import { cancelExpiredBookings } from "@/lib/payment-window";
import { syncCarStatus } from "@/lib/car-status";
import { AdminCustomersPanel } from "@/components/admin/customers-panel";
import { buildCustomerRows } from "@/lib/customers";
import { DEMO_ADMIN_SIGN_IN_ENABLED, dashboardPermissions } from "@/lib/roles";
import {
  bookingReportCsv,
  bookingStatusMap,
  computeReport,
  countCustomers,
  downloadTextFile,
  maintenanceReportCsv,
  monthlyRevenueSeries,
  maintenanceCostError,
  type ReportRange,
} from "@/lib/reports";
import { KeyRound } from "lucide-react";
import {
  AdminContractsPanel,
  ContractWorkQueue,
  type ContractPanelView,
  type PanelBooking,
  type PanelContract,
} from "@/components/admin/contracts-panel";
import { AdminManagementPanel } from "@/components/admin/admin-management-panel";
import { bookingMovesOn, defaultBookingMove, reasonError } from "@/lib/contract-workflow";
import { ownerManualConfirm } from "@/lib/contract-api";
import { fleetCounts } from "@/lib/fleet";
import { CAR_LIMITS, carFormError } from "@/lib/car-validation";
import { OverdueBookingsCard } from "@/components/admin/overdue-bookings-card";
import { bilingual, tr, trError } from "@/lib/i18n";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "ระบบผู้ดูแลระบบ (Admin) — Drive Dee" },
      { name: "description", content: "ระบบบริหารจัดการรถเช่า รายการจอง สัญญา และงานซ่อมบำรุง" },
      { property: "og:title", content: "ระบบผู้ดูแลระบบ — Drive Dee" },
    ],
  }),
  component: () => <AdminDashboard mode="admin" />,
});

/**
 * "admin": full administrator dashboard at /admin.
 * "demo": restricted demonstration dashboard at /demo-admin (demo_admin role only).
 */
export type DashboardMode = "admin" | "demo";

type AdminTab =
  | "overview"
  | "cars"
  | "bookings"
  | "customers"
  | "contracts"
  | "maintenance"
  | "reports"
  | "admins";

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
  { value: "eco", get label() {
      return tr("อีโคคาร์ (Eco)", "Eco car");
    } },
  { value: "sedan", get label() {
      return tr("ซีดาน (Sedan)", "Sedan");
    } },
  { value: "suv", label: "SUV" },
  { value: "van", get label() {
      return tr("รถตู้ (Van)", "Van");
    } },
  { value: "ev", get label() {
      return tr("รถไฟฟ้า (EV)", "Electric (EV)");
    } },
];

const CAR_STATUSES = [
  { value: "available", get label() {
      return tr("ว่าง (พร้อมให้บริการ)", "Available");
    } },
  { value: "rented", get label() {
      return tr("ถูกเช่า (กำลังให้บริการ)", "Rented (in service)");
    } },
  { value: "maintenance", get label() {
      return tr("ซ่อมบำรุง", "Maintenance");
    } },
  { value: "unavailable", get label() {
      return tr("งดให้บริการ", "Unavailable");
    } },
];

const PIE_COLORS = ["#0ea5e9", "#10b981", "#f59e0b", "#6366f1", "#ec4899"];

const BOOKING_MOVE_LABEL: Record<string, string> = bilingual({
  active: ["กำลังเช่า - ส่งมอบรถแล้ว (Active)", "In progress - car handed over (Active)"],
  completed: ["เสร็จสิ้น - รับรถคืนแล้ว (Completed)", "Completed - car returned"],
  cancelled: ["ยกเลิกการจอง (Cancelled)", "Cancel booking"],
});

export function AdminDashboard({ mode }: { mode: DashboardMode }) {
  const { user, role, adminMember, loading: authLoading } = useAuth();
  const isDemo = mode === "demo";
  // /admin opens for admins only. /demo-admin is open to anyone: it runs on in-browser sample
  // data (src/lib/demo-sandbox.ts), never on the real database, with every Owner feature.
  const allowed = isDemo || role === "admin";
  // Admins: the member row decides (Owner / suspended / fine-grained permissions)
  const perms = isDemo
    ? dashboardPermissions("admin", { is_owner: true, status: "active", permissions: [] })
    : dashboardPermissions(allowed ? role : "customer", adminMember);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  // Which contracts tab to open (set by the overview work queue)
  const [contractView, setContractView] = useState<ContractPanelView>("create");

  // Filters & Search
  const [carSearch, setCarSearch] = useState("");
  const [carCategoryFilter, setCarCategoryFilter] = useState("all");
  const [carStatusFilter, setCarStatusFilter] = useState("all");

  const [bookingSearch, setBookingSearch] = useState("");
  const [bookingStatusFilter, setBookingStatusFilter] = useState("all");

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
  // "" = nothing chosen yet (cancelling is never preselected)
  const [newBookingStatus, setNewBookingStatus] = useState<Tables<"bookings">["status"] | "">("");

  // Owner-only manual confirmation (reason required, audited in the database)
  const [manualConfirmFor, setManualConfirmFor] = useState<BookingWithCar | null>(null);
  // A maintenance job being closed before its scheduled day (asks for confirmation first)
  const [earlyComplete, setEarlyComplete] = useState<MaintenanceWithCar | null>(null);
  const [manualReason, setManualReason] = useState("");
  const [confirmingManually, setConfirmingManually] = useState(false);

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
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .order("paid_at", { ascending: false });
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

  // A failed load must not look like "no data", so failures are listed in a banner with a retry
  const failedQueries = [
    { label: tr("รถยนต์", "Cars"), q: carsQ },
    { label: tr("การจอง", "Bookings"), q: bookingsQ },
    { label: tr("ลูกค้า", "Customers"), q: profilesQ },
    { label: tr("ซ่อมบำรุง", "Maintenance"), q: maintQ },
    { label: tr("สัญญาเช่า", "Contracts"), q: contractsQ },
    { label: tr("การชำระเงิน", "Payments"), q: paymentsQ },
    { label: tr("สิทธิ์ผู้ใช้", "User roles"), q: rolesQ },
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
      toast.error(tr("กรุณากรอกยี่ห้อ รุ่น และทะเบียนรถให้ครบถ้วน", "Please fill in the brand, model and plate"));
      return;
    }
    const numbersProblem = carFormError({
      price_per_day: Number(carForm.price_per_day),
      seats: Number(carForm.seats),
      mileage: Number(carForm.mileage),
      year: Number(carForm.year),
    });
    if (numbersProblem) {
      toast.error(numbersProblem);
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
        toast.success(tr("อัปเดตข้อมูลรถยนต์สำเร็จ", "Car updated"));
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
        toast.success(tr("เพิ่มรถยนต์เข้าสู่ระบบสำเร็จ", "Car added"));
      }

      setCarModalOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["admin-cars"] });
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(trError(error.message) || tr("ไม่สามารถบันทึกข้อมูลรถยนต์ได้", "Could not save the car"));
    }
  };

  const handleDeleteCar = async () => {
    if (!carToDelete) return;
    if (!perms.deleteCars) {
      toast.error(tr("โหมดสาธิตไม่สามารถลบรถยนต์ได้", "Demo mode cannot delete cars"));
      setCarToDelete(null);
      return;
    }
    setDeletingCar(true);
    try {
      const hasBooking = bookings.some((b) => b.car_id === carToDelete.id);
      if (hasBooking) {
        toast.error(
          tr("ไม่สามารถลบรถคันนี้ได้เนื่องจากมีประวัติการจองผูกอยู่ในระบบ กรุณาเปลี่ยนสถานะเป็น 'งดให้บริการ' แทน", "This car cannot be deleted because it has bookings. Set its status to 'Unavailable' instead."),
        );
        setCarToDelete(null);
        return;
      }

      const { error } = await supabase.from("cars").delete().eq("id", carToDelete.id);
      if (error) {
        if (
          error.code === "23503" ||
          error.message.includes("foreign key") ||
          error.message.includes("violates foreign key constraint")
        ) {
          toast.error(
            tr("ไม่สามารถลบรถคันนี้ได้เนื่องจากมีประวัติการจองผูกอยู่ในระบบ กรุณาเปลี่ยนสถานะเป็น 'งดให้บริการ' แทน", "This car cannot be deleted because it has bookings. Set its status to 'Unavailable' instead."),
          );
        } else {
          toast.error(trError(error.message) || tr("ไม่สามารถลบรถยนต์ได้", "Could not delete the car"));
        }
        return;
      }

      toast.success(tr("ลบรถยนต์ออกจากระบบเรียบร้อยแล้ว", "Car deleted"));
      setCarToDelete(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-cars"] });
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(trError(error.message) || tr("เกิดข้อผิดพลาดในการลบรถยนต์", "An error occurred while deleting the car"));
    } finally {
      setDeletingCar(false);
    }
  };

  const handleUpdateCarStatus = async (carId: string, status: Tables<"cars">["status"]) => {
    try {
      const { error } = await supabase.from("cars").update({ status }).eq("id", carId);

      if (error) throw error;
      toast.success(tr("ปรับปรุงสถานะรถยนต์เรียบร้อยแล้ว", "Car status updated"));
      await queryClient.invalidateQueries({ queryKey: ["admin-cars"] });
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(trError(error.message) || tr("ไม่สามารถเปลี่ยนสถานะได้", "Could not change the status"));
    }
  };

  const handleUpdateBookingStatus = async () => {
    if (!updatingBooking) return;
    if (!newBookingStatus) {
      toast.error(tr("กรุณาเลือกสถานะใหม่", "Please choose a new status"));
      return;
    }
    if (
      !perms.updateBookingStatus ||
      !bookingMovesOn(updatingBooking, todayBkk()).includes(newBookingStatus)
    ) {
      toast.error(
        tr("เปลี่ยนสถานะนี้ไม่ได้ การยืนยันการจองต้องผ่านการยืนยันสัญญาและการชำระค่าจองของลูกค้า และส่งมอบ/รับรถคืนได้ตั้งแต่วันรับรถเท่านั้น", "This status change is not allowed. A booking is confirmed only after the customer confirms the contract and pays the booking fee, and hand-over/return is only possible from the pickup day."),
      );
      return;
    }
    try {
      const { error } = await supabase
        .from("bookings")
        .update({ status: newBookingStatus })
        .eq("id", updatingBooking.id);

      if (error) throw error;

      // Car status follows its bookings and maintenance (rented / maintenance / available)
      await syncCarStatus(updatingBooking.car_id);

      toast.success(tr("ปรับปรุงสถานะการจองเรียบร้อยแล้ว", "Booking status updated"));
      setUpdatingBooking(null);
      await invalidateBookingData(queryClient);
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(trError(error.message) || tr("ไม่สามารถเปลี่ยนสถานะการจองได้", "Could not change the booking status"));
    }
  };

  const handleSaveMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!maintForm.car_id || !maintForm.title) {
      toast.error(tr("กรุณาเลือกรถและระบุชื่องานซ่อมบำรุง", "Please choose a car and enter the job title"));
      return;
    }
    const costProblem = maintenanceCostError(Number(maintForm.cost));
    if (costProblem) {
      toast.error(costProblem);
      return;
    }
    if (maintForm.status === "completed" && maintForm.scheduled_date > todayBkk()) {
      toast.error(
        tr("ยังไม่ถึงวันนัดหมาย จึงบันทึกว่าเสร็จสิ้นไม่ได้ ถ้าทำเสร็จแล้วจริง ให้แก้วันนัดหมายเป็นวันที่ทำ", "The scheduled date has not arrived, so it cannot be marked completed. If the work is really done, change the scheduled date to the day it was done."),
      );
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

      toast.success(tr("บันทึกตารางการซ่อมบำรุงเรียบร้อยแล้ว", "Maintenance job saved"));
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
      toast.error(trError(error.message) || tr("ไม่สามารถบันทึกงานซ่อมบำรุงได้", "Could not save the maintenance job"));
    }
  };

  const handleMaintenanceStatus = async (
    m: MaintenanceWithCar,
    status: Tables<"maintenance">["status"],
  ) => {
    try {
      const { error } = await supabase
        .from("maintenance")
        .update({ status, completed_date: status === "completed" ? todayBkk() : null })
        .eq("id", m.id);
      if (error) throw error;

      await syncCarStatus(m.car_id);
      toast.success(
        status === "completed" ? tr("ปิดงานซ่อมบำรุงเรียบร้อยแล้ว", "Maintenance job completed") : tr("เริ่มงานซ่อมบำรุงแล้ว", "Maintenance job started"),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-maintenance"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-cars"] }),
        queryClient.invalidateQueries({ queryKey: ["cars"] }),
        queryClient.invalidateQueries({ queryKey: ["car"] }),
      ]);
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(trError(error.message) || tr("ไม่สามารถเปลี่ยนสถานะงานซ่อมบำรุงได้", "Could not change the maintenance status"));
    }
  };

  const handleManualConfirm = async () => {
    if (!manualConfirmFor || !perms.manualConfirm) return;
    const problem = reasonError(manualReason, 10);
    if (problem) {
      toast.error(problem);
      return;
    }
    setConfirmingManually(true);
    try {
      await ownerManualConfirm(manualConfirmFor.id, manualReason);
      await syncCarStatus(manualConfirmFor.car_id);
      toast.success(tr("ยืนยันการจองด้วยตนเองแล้ว (บันทึกในบันทึกตรวจสอบ)", "Booking confirmed manually (recorded in the audit log)"));
      setManualConfirmFor(null);
      setManualReason("");
    } catch (err: unknown) {
      toast.error(trError((err as Error).message) || tr("ยืนยันการจองไม่สำเร็จ", "Could not confirm the booking"));
    } finally {
      setConfirmingManually(false);
      await invalidateBookingData(queryClient);
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
        (car &&
          `${car.brand} ${car.model} ${car.plate_no}`
            .toLowerCase()
            .includes(bookingSearch.toLowerCase())) ||
        (profile && profile.full_name.toLowerCase().includes(bookingSearch.toLowerCase()));
      const matchStatus = bookingStatusFilter === "all" || b.status === bookingStatusFilter;
      return matchSearch && matchStatus;
    });
  }, [bookings, bookingSearch, bookingStatusFilter, profileMap]);

  const filteredMaintenance = useMemo(() => {
    return maintenanceRecords.filter((m) => {
      return maintStatusFilter === "all" || m.status === maintStatusFilter;
    });
  }, [maintenanceRecords, maintStatusFilter]);

  // Operational & Revenue Metrics
  const statusByBooking = useMemo(() => bookingStatusMap(bookings), [bookings]);
  // What each booking has paid online (DEMO), for the bookings tables
  const paidOnline = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments)
      if (p.status === "paid")
        m.set(p.booking_id, (m.get(p.booking_id) ?? 0) + Number(p.amount ?? 0));
    return m;
  }, [payments]);

  const customerRows = useMemo(
    () => buildCustomerRows({ profiles, bookings, payments, roles }),
    [profiles, bookings, payments, roles],
  );

  const metrics = useMemo(() => {
    // Counts a car as rented when it is with a customer today, even if the hand-over was not recorded
    const fleet = fleetCounts(cars, bookings, todayBkk());
    const totalCarsCount = fleet.total;
    const availableCarsCount = fleet.available;
    const rentedCarsCount = fleet.rented;
    const maintenanceCarsCount = fleet.maintenance;

    const allTime = computeReport({
      bookings,
      payments,
      maintenance: maintenanceRecords,
      range: "all",
    });

    return {
      totalCustomers: countCustomers(roles),
      totalCarsCount,
      availableCarsCount,
      rentedCarsCount,
      maintenanceCarsCount,
      activeBookingsCount: bookings.filter((b) => b.status === "confirmed" || b.status === "active")
        .length,
      completedBookingsCount: bookings.filter((b) => b.status === "completed").length,
      totalRevenue: allTime.revenue,
      totalMaintenanceCost: allTime.maintCost,
      netProfit: allTime.profit,
      utilizationRate: fleet.utilizationRate,
    };
  }, [cars, bookings, payments, maintenanceRecords, roles]);

  // Date-filtered metrics for Reports tab
  const reportMetrics = useMemo(
    () =>
      computeReport({
        bookings,
        payments,
        maintenance: maintenanceRecords,
        range: reportDateRange,
      }),
    [bookings, payments, maintenanceRecords, reportDateRange],
  );

  // Chart Data: revenue for the last 12 months (by payment date, Bangkok time)
  const chartData = useMemo(
    () => monthlyRevenueSeries(payments, statusByBooking, new Date(), 12, bookings),
    [payments, statusByBooking, bookings],
  );

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
    toast.success(tr("ดาวน์โหลดรายงานการจองและรายได้ (CSV) แล้ว", "Bookings and revenue report (CSV) downloaded"));
  };

  const exportMaintenanceCsv = () => {
    const csv = maintenanceReportCsv({
      maintenance: maintenanceRecords,
      statusLabels: maintStatusLabel,
      range: reportDateRange,
    });
    downloadTextFile(`siam-wheels-maintenance-${reportDateRange}-${todayBkk()}.csv`, csv);
    toast.success(tr("ดาวน์โหลดรายงานซ่อมบำรุง (CSV) แล้ว", "Maintenance report (CSV) downloaded"));
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
  if (authLoading && !isDemo) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-20 text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="mt-4 text-muted-foreground">{tr("กำลังตรวจสอบสิทธิ์ผู้ดูแลระบบ...", "Checking admin access...")}</p>
      </div>
    );
  }

  if (!isDemo && (!user || !allowed)) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-destructive/10 text-destructive">
          <ShieldAlert className="h-8 w-8" />
        </div>
        <h2 className="text-2xl font-bold">{tr("ปฏิเสธการเข้าถึง (Access Denied)", "Access denied")}</h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          {isDemo
            ? tr("หน้านี้สงวนไว้สำหรับบัญชีผู้ดูแลระบบสาธิต (Demo Admin) เท่านั้น", "This page is only for Demo Admin accounts.")
            : tr("หน้านี้สงวนไว้สำหรับผู้ดูแลระบบ (Administrator) ของ Siam Wheels Rental Hub เท่านั้น บัญชีของคุณไม่มีสิทธิ์ในการเข้าถึงระบบนี้", "This page is only for Siam Wheels Rental Hub administrators. Your account does not have access.")}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          {user && role === "demo_admin" && !isDemo && (
            <Button asChild>
              <Link to="/demo-admin">{tr("ไปที่แดชบอร์ดสาธิต (Demo Admin)", "Go to the demo dashboard (Demo Admin)")}</Link>
            </Button>
          )}
          {user && role === "admin" && isDemo && (
            <Button asChild>
              <Link to="/admin">{tr("ไปที่ระบบผู้ดูแล (Admin)", "Go to Admin")}</Link>
            </Button>
          )}
          <Button variant={user && role !== "customer" ? "outline" : "default"} asChild>
            <Link to="/">{tr("กลับสู่หน้าหลัก", "Back to home")}</Link>
          </Button>
          {!user && (!isDemo || DEMO_ADMIN_SIGN_IN_ENABLED) && (
            <Button variant="outline" asChild>
              <Link to="/auth" search={isDemo ? { demo: true } : {}}>
                {isDemo ? tr("เข้าสู่ระบบ Demo Admin", "Demo Admin sign-in") : tr("เข้าสู่ระบบด้วยบัญชีผู้ดูแล", "Sign in with an admin account")}
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
            <p className="font-semibold">{tr("โหมดสาธิต (Demo Admin) · ข้อมูลตัวอย่าง", "Demo mode (Demo Admin) · sample data")}</p>
            <p className="mt-0.5">
              {tr(
                "ทุกอย่างในหน้านี้เป็นข้อมูลสมมติ ไม่ใช่ข้อมูลลูกค้าจริง ลองใช้ได้ทุกเมนู (เพิ่มรถ เปลี่ยนสถานะการจอง ทำสัญญา จัดการผู้ดูแล) แต่การเปลี่ยนแปลงไม่ถูกบันทึกลงระบบจริง และจะหายเมื่อรีเฟรชหน้า",
                "Everything on this page is fictional sample data, not real customers. Try every menu (add cars, change bookings, create contracts, manage admins), but nothing is saved to the real system and changes disappear when you reload.",
              )}
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
              {tr("โหลดข้อมูลบางส่วนไม่สำเร็จ:", "Some data failed to load:")} {failedQueries.map((x) => x.label).join(", ")} {tr("— ตัวเลขที่แสดงอาจไม่ครบถ้วน", "— the figures shown may be incomplete")}
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={retryFailedQueries}>
            {tr("ลองใหม่", "Try again")}
          </Button>
        </div>
      )}
      {/* Admin Top Header */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b pb-6">
        <div>
          <div className="flex items-center gap-2">
            {isDemo ? (
              <Badge
                variant="outline"
                className="border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
              >
                <ShieldAlert className="mr-1 h-3.5 w-3.5" /> Demo Admin Portal
              </Badge>
            ) : (
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Administrator Portal
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">Siam Wheels Operations</span>
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            {tr("ศูนย์ควบคุมและบริหารจัดการรถเช่า", "Rental management centre")}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => openCarModal()} className="gap-1.5 shadow-sm">
            <Plus className="h-4 w-4" /> {tr("เพิ่มรถยนต์ใหม่", "Add car")}
          </Button>
          <Button variant="outline" onClick={() => setMaintModalOpen(true)} className="gap-1.5">
            <Wrench className="h-4 w-4" /> {tr("บันทึกซ่อมบำรุง", "Log maintenance")}
          </Button>
        </div>
      </div>

      {/* Main Admin Navigation Tabs (Responsive Sidebar Layout) */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Navigation Sidebar (3 Cols) */}
        <aside className="min-w-0 lg:col-span-3">
          <Card className="shadow-card border lg:sticky lg:top-24">
            <CardHeader className="pb-3 border-b bg-muted/20">
              <CardTitle className="text-sm font-semibold text-muted-foreground">
                {tr("เมนูการจัดการระบบ", "Admin menu")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 space-y-1">
              {[
                { id: "overview", label: tr("ภาพรวมระบบ", "Overview"), icon: LayoutDashboard, count: null },
                { id: "cars", label: tr("จัดการรถยนต์ในระบบ", "Cars"), icon: CarIcon, count: cars.length },
                {
                  id: "bookings",
                  label: tr("รายการจองของลูกค้า", "Bookings"),
                  icon: Calendar,
                  count: bookings.length,
                },
                { id: "customers", label: tr("ข้อมูลลูกค้า", "Customers"), icon: Users, count: customerRows.length },
                {
                  id: "contracts",
                  label: tr("สัญญาเช่าดิจิทัล", "Contracts"),
                  icon: FileCheck2,
                  count: contracts.length,
                },
                {
                  id: "maintenance",
                  label: tr("งานซ่อมบำรุง", "Maintenance"),
                  icon: Wrench,
                  count: maintenanceRecords.length,
                },
                { id: "reports", label: tr("รายงานและสถิติ", "Reports"), icon: BarChart3, count: null },
                { id: "admins", label: tr("ผู้ดูแลระบบ (Owner)", "Admins (Owner)"), icon: KeyRound, count: null },
              ]
                .filter((item) => item.id !== "admins" || perms.manageAdmins)
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
        <main className="min-w-0 space-y-6 lg:col-span-9">
          {/* TAB 1: OVERVIEW */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              {perms.viewContracts && (
                <ContractWorkQueue
                  loading={contractsQ.isLoading || bookingsQ.isLoading}
                  contracts={contracts}
                  bookings={bookings as unknown as PanelBooking[]}
                  onOpen={(v) => {
                    setContractView(v);
                    setActiveTab("contracts");
                  }}
                />
              )}
              <OverdueBookingsCard
                bookings={bookings}
                today={todayBkk()}
                customerName={(b) => profileMap[b.user_id]?.full_name || tr("ลูกค้าสมาชิก", "Member")}
                canUpdate={perms.updateBookingStatus}
                onUpdate={(b) => {
                  setUpdatingBooking(b);
                  setNewBookingStatus(
                    defaultBookingMove(bookingMovesOn(b, todayBkk())) as
                      Tables<"bookings">["status"] | "",
                  );
                }}
              />
              {/* 6 Key Operational Metrics */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Card className="shadow-card border">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground">
                      {tr("รายได้รวมสุทธิ (THB)", "Total revenue (THB)")}
                    </CardTitle>
                    <DollarSign className="h-4 w-4 text-primary" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-primary">
                      {thb(metrics.totalRevenue)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {tr("กำไรจากการดำเนินงาน:", "Operating profit:")}{" "}
                      <span className="font-semibold text-success">{thb(metrics.netProfit)}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {tr("เงินที่ชำระออนไลน์ (DEMO) + ค่าเช่าส่วนที่เหลือที่เก็บ ณ วันรับรถ (นับเมื่อสถานะเป็นกำลังเช่า/เสร็จสิ้น) + ค่าจองที่ไม่คืนจากการจองที่ยกเลิก ไม่รวมเงินประกัน", "Online payments (DEMO) + remaining rent collected at pickup (counted once in progress/completed) + kept booking fees of cancelled bookings, excluding deposits")}
                    </p>
                  </CardContent>
                </Card>

                <Card className="shadow-card border">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground">
                      {tr("กองยานพาหนะทั้งหมด", "Total fleet")}
                    </CardTitle>
                    <CarIcon className="h-4 w-4 text-primary" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-foreground">
                      {metrics.totalCarsCount} {tr("คัน", "cars")}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {tr("ว่าง", "Available")} {metrics.availableCarsCount} {tr("· ถูกเช่า", "· rented")} {metrics.rentedCarsCount} {tr("· ซ่อม", "· maintenance")}{" "}
                      {metrics.maintenanceCarsCount}
                    </p>
                  </CardContent>
                </Card>

                <Card className="shadow-card border">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground">
                      {tr("อัตราการใช้งานรถยนต์", "Fleet utilisation")}
                    </CardTitle>
                    <TrendingUp className="h-4 w-4 text-primary" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-foreground">
                      {metrics.utilizationRate}%
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {tr("อยู่กับลูกค้า", "with customers")} {metrics.rentedCarsCount} {tr("จาก", "of")} {metrics.totalCarsCount} {tr("คัน", "cars")}
                      {tr("(รวมที่ถึงวันรับรถแล้ว)", "(including pickups due today)")}
                    </p>
                  </CardContent>
                </Card>

                <Card className="shadow-card border">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground">
                      {tr("การจองที่รอดำเนินการ / กำลังเช่า", "Pending / in-progress bookings")}
                    </CardTitle>
                    <Calendar className="h-4 w-4 text-primary" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-foreground">
                      {metrics.activeBookingsCount} {tr("รายการ", "items")}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {tr("เสร็จสิ้นทั้งหมด", "Completed in total")} {metrics.completedBookingsCount} {tr("ทริป", "trips")}
                    </p>
                  </CardContent>
                </Card>

                <Card className="shadow-card border">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground">
                      {tr("ลูกค้าที่ลงทะเบียน", "Registered customers")}
                    </CardTitle>
                    <Users className="h-4 w-4 text-primary" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-foreground">
                      {metrics.totalCustomers} {tr("ท่าน", "people")}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {tr("พร้อมประวัติและเอกสารยืนยันตัวตน", "with history and identity documents")}
                    </p>
                  </CardContent>
                </Card>

                <Card className="shadow-card border">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground">
                      {tr("ค่าใช้จ่ายซ่อมบำรุงสะสม", "Total maintenance cost")}
                    </CardTitle>
                    <Wrench className="h-4 w-4 text-warning" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-warning-foreground">
                      {thb(metrics.totalMaintenanceCost)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {tr("บันทึกแล้ว", "recorded")} {maintenanceRecords.length} {tr("รายการ", "items")}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Monthly Revenue Chart */}
              <Card className="shadow-card border">
                <CardHeader>
                  <CardTitle className="text-base font-semibold">
                    {tr("แนวโน้มรายได้และจำนวนการจองรายเดือน", "Monthly revenue and bookings")}
                  </CardTitle>
                  <CardDescription>
                    {tr("รายได้ 12 เดือนล่าสุด: ค่าจองตามวันที่ชำระ + ค่าเช่าที่เก็บ ณ วันรับรถ ตามวันรับรถ (เวลาประเทศไทย)", "Revenue for the last 12 months: booking fees by payment date + rent collected at pickup by pickup date (Thailand time)")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="name" fontSize={12} />
                      <YAxis
                        fontSize={12}
                        tickFormatter={(val) => `฿${(val / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        formatter={(val: unknown) => [thb(Number(val) || 0), tr("รายได้", "Revenue")]}
                        labelStyle={{ fontWeight: "bold" }}
                      />
                      <Bar
                        dataKey="revenue"
                        fill="currentColor"
                        className="fill-primary"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Recent Bookings Overview Table */}
              <Card className="shadow-card border">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold">{tr("รายการจองล่าสุด", "Latest bookings")}</CardTitle>
                    <CardDescription>{tr("รายการจองที่เข้ามาในระบบล่าสุด 5 รายการ", "The 5 most recent bookings")}</CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveTab("bookings")}
                    className="gap-1"
                  >
                    {tr("ดูทั้งหมด", "View all")} <ChevronRight className="h-4 w-4" />
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr("รหัสการจอง", "Booking code")}</TableHead>
                        <TableHead>{tr("ลูกค้า", "Customers")}</TableHead>
                        <TableHead>{tr("รถยนต์", "Cars")}</TableHead>
                        <TableHead>{tr("วันที่เช่า", "Rental dates")}</TableHead>
                        <TableHead>{tr("สถานะ", "Status")}</TableHead>
                        <TableHead className="text-right">{tr("ค่าเช่า", "Rent")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bookings.slice(0, 5).map((b) => (
                        <TableRow key={b.id}>
                          <TableCell className="font-mono text-xs font-semibold">
                            {b.booking_code}
                          </TableCell>
                          <TableCell className="text-xs">
                            {profileMap[b.user_id]?.full_name || tr("ลูกค้าสมาชิก", "Member")}
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
                            {paidOnline.has(b.id) && (
                              <span className="block text-[11px] font-normal text-muted-foreground">
                                {tr("ชำระออนไลน์", "Paid online")} {thb(paidOnline.get(b.id))}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {bookings.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                            {tr("ยังไม่มีรายการจองในระบบ", "No bookings yet")}
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
                    <CardTitle className="text-xl">
                      {tr("จัดการรถยนต์ในระบบ (", "Cars (")}{filteredCars.length}{tr(" คัน)", ")")}
                    </CardTitle>
                    <CardDescription>{tr("เพิ่ม ลบ แก้ไข ข้อมูลสเปกและราคาเช่ารายวัน", "Add, delete and edit specs and daily rates")}</CardDescription>
                  </div>
                  <Button onClick={() => openCarModal()} className="gap-1.5">
                    <Plus className="h-4 w-4" /> {tr("เพิ่มรถยนต์ใหม่", "Add car")}
                  </Button>
                </div>

                {/* Filter Toolbar */}
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="relative">
                    <Input
                      placeholder={tr("ค้นหายี่ห้อ รุ่น หรือทะเบียน...", "Search brand, model or plate...")}
                      value={carSearch}
                      onChange={(e) => setCarSearch(e.target.value)}
                      className="pl-9"
                    />
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  </div>

                  <Select value={carCategoryFilter} onValueChange={setCarCategoryFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder={tr("ประเภทรถยนต์", "Car category")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{tr("ทุกประเภท", "All categories")}</SelectItem>
                      {CATEGORIES.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={carStatusFilter} onValueChange={setCarStatusFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder={tr("สถานะรถยนต์", "Car status")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{tr("ทุกสถานะ", "All statuses")}</SelectItem>
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
                      <TableHead>{tr("รูปรถ", "Photo")}</TableHead>
                      <TableHead>{tr("ยี่ห้อ / รุ่น / ปี", "Brand / model / year")}</TableHead>
                      <TableHead>{tr("ทะเบียน", "Plate")}</TableHead>
                      <TableHead>{tr("ประเภท", "Category")}</TableHead>
                      <TableHead>{tr("ราคา / วัน", "Price / day")}</TableHead>
                      <TableHead>{tr("เลขไมล์", "Mileage")}</TableHead>
                      <TableHead>{tr("สถานะ", "Status")}</TableHead>
                      <TableHead className="text-right">{tr("จัดการ", "Actions")}</TableHead>
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
                          <span className="block text-xs text-muted-foreground">{tr("ปี", "Year")} {car.year}</span>
                        </TableCell>
                        <TableCell className="font-mono text-xs font-semibold">
                          {car.plate_no}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {categoryLabel[car.category] || car.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-semibold text-primary">
                          {thb(car.price_per_day)}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {car.mileage.toLocaleString("th-TH")} {tr("กม.", "km")}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={car.status}
                            onValueChange={(val) =>
                              handleUpdateCarStatus(car.id, val as Tables<"cars">["status"])
                            }
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
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openCarModal(car)}
                              title={tr("แก้ไข", "Edit")}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            {perms.deleteCars && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:bg-destructive/10"
                                onClick={() => setCarToDelete(car)}
                                title={tr("ลบรถยนต์", "Delete car")}
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
                          {tr("ไม่พบรถยนต์ที่ตรงกับเงื่อนไขการค้นหา", "No cars match your search")}
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
                    <CardTitle className="text-xl">
                      {tr("รายการจองของลูกค้า (", "Bookings (")}{filteredBookings.length}{tr(" รายการ)", ")")}
                    </CardTitle>
                    <CardDescription>
                      {tr("ตรวจสอบ ยืนยันสถานะการเช่า และควบคุมการส่งมอบรถ", "Check bookings, update rental status and manage hand-overs")}
                    </CardDescription>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="relative">
                    <Input
                      placeholder={tr("ค้นหารหัสการจอง ชื่อลูกค้า หรือทะเบียนรถ...", "Search booking code, customer or plate...")}
                      value={bookingSearch}
                      onChange={(e) => setBookingSearch(e.target.value)}
                      className="pl-9"
                    />
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  </div>

                  <Select value={bookingStatusFilter} onValueChange={setBookingStatusFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder={tr("กรองตามสถานะ", "Filter by status")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{tr("ทุกสถานะ", "All statuses")}</SelectItem>
                      <SelectItem value="pending">{tr("รอดำเนินการ (สัญญา/ชำระเงิน)", "Pending (contract/payment)")}</SelectItem>
                      <SelectItem value="confirmed">{tr("ยืนยันแล้ว", "Confirmed")}</SelectItem>
                      <SelectItem value="active">{tr("กำลังเช่า (รับรถแล้ว)", "In progress (picked up)")}</SelectItem>
                      <SelectItem value="completed">{tr("เสร็จสิ้น", "Completed")}</SelectItem>
                      <SelectItem value="cancelled">{tr("ยกเลิก", "Cancelled")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("รหัสการจอง", "Booking code")}</TableHead>
                      <TableHead>{tr("ข้อมูลลูกค้า", "Customers")}</TableHead>
                      <TableHead>{tr("รถยนต์", "Cars")}</TableHead>
                      <TableHead>{tr("สาขา / วันที่", "Branch / dates")}</TableHead>
                      <TableHead>{tr("สถานะ", "Status")}</TableHead>
                      <TableHead>{tr("ค่าเช่า / ชำระออนไลน์", "Rent / paid online")}</TableHead>
                      <TableHead className="text-right">{tr("การจัดการ", "Actions")}</TableHead>
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
                              {profile?.full_name || tr("ลูกค้าสมาชิก", "Member")}
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
                            <span className="block font-medium">{pickupLocationLabel(b.pickup_location)}</span>
                            <span className="text-muted-foreground text-[11px]">
                              {fmtDate(b.start_date)} — {fmtDate(b.end_date)} ({b.days} {tr("วัน", "days")})
                            </span>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={b.status} kind="booking" />
                          </TableCell>
                          <TableCell
                            className="font-semibold text-primary"
                            data-testid="booking-amounts"
                          >
                            {thb(b.total_amount)}
                            <span className="block text-[11px] font-normal text-muted-foreground">
                              {paidOnline.has(b.id)
                                ? `${tr("ชำระออนไลน์", "Paid online")} ${thb(paidOnline.get(b.id))}`
                                : tr("ยังไม่ชำระ", "Not paid")}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                disabled={
                                  !perms.updateBookingStatus ||
                                  bookingMovesOn(b, todayBkk()).length === 0
                                }
                                onClick={() => {
                                  setUpdatingBooking(b);
                                  setNewBookingStatus(
                                    defaultBookingMove(bookingMovesOn(b, todayBkk())) as
                                      Tables<"bookings">["status"] | "",
                                  );
                                }}
                              >
                                {tr("เปลี่ยนสถานะ", "Change status")}
                              </Button>
                              {perms.manualConfirm && b.status === "pending" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 border-amber-400 text-xs"
                                  onClick={() => {
                                    setManualConfirmFor(b);
                                    setManualReason("");
                                  }}
                                >
                                  {tr("ยืนยันด้วยตนเอง", "Confirm manually")}
                                </Button>
                              )}
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
                          {tr("ไม่พบรายการจองที่ตรงกับเงื่อนไข", "No bookings match your filters")}
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
            <AdminContractsPanel
              key={contractView}
              initialView={contractView}
              perms={perms}
              contracts={contracts as unknown as PanelContract[]}
              bookings={bookings as unknown as PanelBooking[]}
              profileMap={profileMap}
            />
          )}

          {/* TAB 5: MAINTENANCE TRACKING */}
          {activeTab === "maintenance" && (
            <Card className="shadow-card border">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-xl">{tr("งานซ่อมบำรุงและดูแลรักษารถยนต์", "Maintenance and servicing")}</CardTitle>
                    <CardDescription>
                      {tr("บันทึกประวัติการเข้าศูนย์ เช็คระยะ และค่าใช้จ่ายการซ่อมบำรุง", "Record service visits, scheduled checks and maintenance costs")}
                    </CardDescription>
                  </div>
                  <Button onClick={() => setMaintModalOpen(true)} className="gap-1.5">
                    <Plus className="h-4 w-4" /> {tr("บันทึกงานซ่อมบำรุง", "Log maintenance job")}
                  </Button>
                </div>

                <div className="mt-4 max-w-xs">
                  <Select value={maintStatusFilter} onValueChange={setMaintStatusFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder={tr("กรองสถานะซ่อมบำรุง", "Filter maintenance status")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{tr("ทุกสถานะ", "All statuses")}</SelectItem>
                      <SelectItem value="scheduled">{tr("นัดหมายแล้ว", "Scheduled")}</SelectItem>
                      <SelectItem value="in_progress">{tr("กำลังดำเนินการ", "In progress")}</SelectItem>
                      <SelectItem value="completed">{tr("เสร็จสิ้น", "Completed")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("รถยนต์ / ทะเบียน", "Car / plate")}</TableHead>
                      <TableHead>{tr("รายการซ่อมบำรุง", "Job")}</TableHead>
                      <TableHead>{tr("วันที่นัดหมาย", "Scheduled date")}</TableHead>
                      <TableHead>{tr("ค่าใช้จ่าย", "Cost")}</TableHead>
                      <TableHead>{tr("สถานะ", "Status")}</TableHead>
                      <TableHead className="text-right">{tr("จัดการ", "Actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMaintenance.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <span className="font-semibold text-xs block">
                            {m.cars?.brand} {m.cars?.model}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {m.cars?.plate_no}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs font-medium block text-foreground">
                            {m.title}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {m.description || "-"}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDate(m.scheduled_date)}
                        </TableCell>
                        <TableCell className="font-semibold text-primary text-xs">
                          {thb(m.cost)}
                          {Number(m.cost) < 0 && (
                            <span
                              className="block text-[11px] font-normal text-destructive"
                              data-testid="negative-cost"
                            >
                              {tr("ค่าใช้จ่ายติดลบไม่ถูกต้อง (ไม่นับในรายงาน)", "Negative cost is invalid (not counted in reports)")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={m.status} kind="maint" />
                          {m.completed_date && (
                            <span className="block text-[11px] text-muted-foreground mt-1">
                              {tr("เสร็จ", "Done")} {fmtDate(m.completed_date)}
                              {m.completed_date < m.scheduled_date && (
                                <span className="text-amber-700"> {tr("(ก่อนวันนัด)", "(early)")}</span>
                              )}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            {m.status === "scheduled" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7"
                                onClick={() => handleMaintenanceStatus(m, "in_progress")}
                              >
                                {tr("เริ่มซ่อม", "Start")}
                              </Button>
                            )}
                            {m.status !== "completed" && (
                              <Button
                                size="sm"
                                className="text-xs h-7"
                                onClick={() =>
                                  m.scheduled_date > todayBkk()
                                    ? setEarlyComplete(m)
                                    : handleMaintenanceStatus(m, "completed")
                                }
                              >
                                {tr("เสร็จสิ้น", "Completed")}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredMaintenance.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          {tr("ไม่พบประวัติงานซ่อมบำรุง", "No maintenance records")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* TAB: CUSTOMERS (view only) */}
          {activeTab === "customers" && <AdminCustomersPanel rows={customerRows} />}

          {/* TAB: ADMIN MANAGEMENT (Owner only; the database enforces it) */}
          {activeTab === "admins" && perms.manageAdmins && (isDemo || user) && (
            <AdminManagementPanel ownerId={isDemo ? SANDBOX_OWNER_ID : user!.id} />
          )}

          {/* TAB 6: REPORTS & ANALYTICS */}
          {activeTab === "reports" && (
            <div className="space-y-6">
              {/* Date Filter Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm">
                <div>
                  <h3 className="font-semibold text-sm">
                    {tr("ช่วงเวลาสำหรับรายงาน (Date Range Filter)", "Report date range")}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {tr("กรองสถิติรายได้และข้อมูลการใช้งานตามช่วงเวลา", "Filter revenue and usage by period")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={reportDateRange}
                    onValueChange={(val) => setReportDateRange(val as ReportRange)}
                  >
                    <SelectTrigger className="w-48 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{tr("ข้อมูลทั้งหมด (All Time)", "All time")}</SelectItem>
                      <SelectItem value="30d">{tr("30 วันล่าสุด (Last 30 Days)", "Last 30 days")}</SelectItem>
                      <SelectItem value="90d">{tr("90 วันล่าสุด (Last 90 Days)", "Last 90 days")}</SelectItem>
                      <SelectItem value="year">{tr("ปีปัจจุบัน (This Year)", "This year")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={exportBookingsCsv}
                  >
                    <Download className="h-3.5 w-3.5" /> {tr("ส่งออกการจองและรายได้ (CSV)", "Export bookings and revenue (CSV)")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={exportMaintenanceCsv}
                  >
                    <Download className="h-3.5 w-3.5" /> {tr("ส่งออกงานซ่อมบำรุง (CSV)", "Export maintenance (CSV)")}
                  </Button>
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                {/* Revenue Overview */}
                <Card className="shadow-card border">
                  <CardHeader>
                    <CardTitle className="text-base font-semibold">
                      {tr("สรุปผลประกอบการทางการเงิน", "Financial summary")}
                    </CardTitle>
                    <CardDescription>
                      {tr("วิเคราะห์รายรับ ค่าใช้จ่าย และกำไรสุทธิตามช่วงเวลา", "Revenue, costs and net profit for the period")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{tr("รายได้จากการเช่า:", "Rental revenue:")}</span>
                        <span className="font-semibold text-primary">
                          {thb(reportMetrics.revenue)}
                        </span>
                      </div>
                      <div
                        className="flex justify-between pl-3 text-xs"
                        data-testid="revenue-online"
                      >
                        <span className="text-muted-foreground">{tr("· ชำระออนไลน์:", "· Paid online:")}</span>
                        <span>{thb(reportMetrics.onlineRevenue)}</span>
                      </div>
                      <div
                        className="flex justify-between pl-3 text-xs"
                        data-testid="revenue-pickup"
                      >
                        <span className="text-muted-foreground">
                          {tr("· เก็บ ณ วันรับรถ (ค่าเช่าส่วนที่เหลือ):", "· Collected at pickup (remaining rent):")}
                        </span>
                        <span>{thb(reportMetrics.pickupRevenue)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{tr("ค่าใช้จ่ายซ่อมบำรุงรวม:", "Total maintenance cost:")}</span>
                        <span className="font-semibold text-destructive">
                          - {thb(reportMetrics.maintCost)}
                        </span>
                      </div>
                      <div className="border-t pt-2 flex justify-between text-base font-bold">
                        <span>{tr("กำไรสุทธิจากการดำเนินงาน:", "Net operating profit:")}</span>
                        <span
                          className={reportMetrics.profit < 0 ? "text-destructive" : "text-success"}
                        >
                          {thb(reportMetrics.profit)}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3 text-xs">
                      <span className="text-muted-foreground">{tr("รายการชำระเงิน:", "Payments:")}</span>
                      <span className="text-right font-medium">
                        {reportMetrics.paidCount} {tr("รายการ", "items")}
                      </span>
                      <span className="text-muted-foreground">{tr("การจองใหม่ (ไม่รวมยกเลิก):", "New bookings (excl. cancelled):")}</span>
                      <span className="text-right font-medium">
                        {reportMetrics.bookingCount} {tr("รายการ", "items")}
                      </span>
                      <span className="text-muted-foreground">{tr("รอดำเนินการ (สัญญา/ชำระเงิน):", "Pending (contract/payment):")}</span>
                      <span className="text-right font-medium">
                        {reportMetrics.pendingCount} {tr("รายการ", "items")}
                      </span>
                      <span className="text-muted-foreground">{tr("เสร็จสิ้น / ยกเลิก:", "Completed / cancelled:")}</span>
                      <span className="text-right font-medium">
                        {reportMetrics.completedCount} / {reportMetrics.cancelledCount}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {tr(
                        `รายได้ = เงินที่ชำระออนไลน์ (DEMO) ของการจองที่ยืนยันแล้ว กำลังเช่า หรือเสร็จสิ้น ตามวันที่ชำระ + ค่าเช่าส่วนที่เหลือที่เก็บ ณ วันรับรถ ตามวันรับรถ เมื่อผู้ดูแลเปลี่ยนสถานะเป็น "กำลังเช่า" หรือ "เสร็จสิ้น" + ค่าจองของการจองที่ถูกยกเลิก (ไม่คืนตามเงื่อนไขสัญญา) ไม่รวมเงินประกัน (คืนให้ลูกค้า) และการจองที่รอชำระ`,
                        `Revenue = online payments (DEMO) of confirmed, in-progress or completed bookings by payment date + remaining rent collected at pickup, by pickup date, once staff set the status to "In progress" or "Completed" + booking fees kept from cancelled bookings (non-refundable under the contract). Excludes deposits (returned to customers) and unpaid bookings.`,
                      )}
                    </p>

                    <div className="pt-4 border-t">
                      <p className="text-xs text-muted-foreground mb-3 font-medium">
                        {tr("สัดส่วนประเภทยานพาหนะในระบบ", "Fleet by category")}
                      </p>
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
                                <Cell
                                  key={`cell-${index}`}
                                  fill={PIE_COLORS[index % PIE_COLORS.length]}
                                />
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
                    <CardTitle className="text-base font-semibold">
                      {tr("ดัชนีชี้วัดประสิทธิภาพการดำเนินงาน (KPIs)", "Key performance indicators (KPIs)")}
                    </CardTitle>
                    <CardDescription>{tr("วิเคราะห์การใช้งานกองยานพาหนะและความคุ้มค่า", "Fleet usage and value")}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm">
                    <div className="rounded-xl bg-muted/40 p-4 space-y-2.5">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {tr("อัตราการใช้งานรถยนต์ (Utilization):", "Utilisation:")}
                        </span>
                        <span className="font-bold text-foreground">
                          {metrics.utilizationRate}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{tr("ค่าเฉลี่ยรายได้ต่อคัน:", "Average revenue per car:")}</span>
                        <span className="font-semibold text-foreground">
                          {metrics.totalCarsCount > 0
                            ? thb(metrics.totalRevenue / metrics.totalCarsCount)
                            : thb(0)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{tr("จำนวนทริปที่สำเร็จแล้ว:", "Completed trips:")}</span>
                        <span className="font-semibold text-foreground">
                          {metrics.completedBookingsCount} {tr("ทริป", "trips")}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{tr("รถที่พร้อมให้บริการทันที:", "Cars available now:")}</span>
                        <span className="font-semibold text-success">
                          {metrics.availableCarsCount} {tr("คัน", "cars")}
                        </span>
                      </div>
                    </div>

                    <div className="p-4 border rounded-xl text-xs text-muted-foreground space-y-1.5">
                      <p className="font-medium text-foreground">{tr("💡 ข้อแนะนำสำหรับการดำเนินงาน:", "💡 Operating tips:")}</p>
                      <p>
                        {tr("• หากอัตรา Utilization สูงกว่า 80% ควรพิจารณาเพิ่มจำนวนรถในหมวดหมู่ยอดนิยม (Eco/Sedan)", "• If utilisation is above 80%, consider adding cars in popular categories (Eco/Sedan)")}
                      </p>
                      <p>
                        {tr("• ตรวจสอบรถยนต์ที่มีกำหนดซ่อมบำรุงสม่ำเสมอเพื่อลดความเสี่ยงต่ออุบัติเหตุ", "• Service cars on schedule to reduce accident risk")}
                      </p>
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
            <DialogTitle>
              {editingCar ? tr("แก้ไขข้อมูลรถยนต์", "Edit car") : tr("เพิ่มรถยนต์ใหม่เข้าสู่ระบบ", "Add a new car")}
            </DialogTitle>
            <DialogDescription>
              {tr("ระบุรายละเอียดของตัวรถ หมายเลขทะเบียน และอัตราค่าเช่าต่อวัน", "Enter the car details, plate number and daily rate")}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveCar} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="car-brand" className="text-xs">
                  {tr("ยี่ห้อ (Brand) *", "Brand *")}
                </Label>
                <Input
                  id="car-brand"
                  placeholder={tr("เช่น Toyota, Honda", "e.g. Toyota, Honda")}
                  value={carForm.brand}
                  onChange={(e) => setCarForm({ ...carForm, brand: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="car-model" className="text-xs">
                  {tr("รุ่น (Model) *", "Model *")}
                </Label>
                <Input
                  id="car-model"
                  placeholder={tr("เช่น Yaris, Camry", "e.g. Yaris, Camry")}
                  value={carForm.model}
                  onChange={(e) => setCarForm({ ...carForm, model: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="car-year" className="text-xs">
                  {tr("ปีรถ (Year)", "Year")}
                </Label>
                <Input
                  id="car-year"
                  type="number"
                  min={CAR_LIMITS.minYear}
                  max={CAR_LIMITS.maxYear}
                  value={carForm.year}
                  onChange={(e) => setCarForm({ ...carForm, year: Number(e.target.value) })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="car-category" className="text-xs">
                  {tr("หมวดหมู่", "Category")}
                </Label>
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
                <Label htmlFor="car-plate" className="text-xs">
                  {tr("หมายเลขทะเบียน *", "Plate number *")}
                </Label>
                <Input
                  id="car-plate"
                  placeholder={tr("เช่น 1กข 1234", "e.g. 1กข 1234")}
                  value={carForm.plate_no}
                  onChange={(e) => setCarForm({ ...carForm, plate_no: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="car-seats" className="text-xs">
                  {tr("จำนวนที่นั่ง", "Seats")}
                </Label>
                <Input
                  id="car-seats"
                  type="number"
                  min={CAR_LIMITS.minSeats}
                  max={CAR_LIMITS.maxSeats}
                  value={carForm.seats}
                  onChange={(e) => setCarForm({ ...carForm, seats: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label htmlFor="car-trans" className="text-xs">
                  {tr("ระบบเกียร์", "Transmission")}
                </Label>
                <Input
                  id="car-trans"
                  value={carForm.transmission}
                  onChange={(e) => setCarForm({ ...carForm, transmission: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="car-fuel" className="text-xs">
                  {tr("เชื้อเพลิง", "Fuel")}
                </Label>
                <Input
                  id="car-fuel"
                  value={carForm.fuel}
                  onChange={(e) => setCarForm({ ...carForm, fuel: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="car-price" className="text-xs">
                  {tr("ราคาต่อวัน (THB) *", "Price per day (THB) *")}
                </Label>
                <Input
                  id="car-price"
                  type="number"
                  min={1}
                  value={carForm.price_per_day}
                  onChange={(e) =>
                    setCarForm({ ...carForm, price_per_day: Number(e.target.value) })
                  }
                  required
                />
              </div>
              <div>
                <Label htmlFor="car-mileage" className="text-xs">
                  {tr("เลขไมล์สะสม (กม.)", "Mileage (km)")}
                </Label>
                <Input
                  id="car-mileage"
                  type="number"
                  min={0}
                  value={carForm.mileage}
                  onChange={(e) => setCarForm({ ...carForm, mileage: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label htmlFor="car-status-select" className="text-xs">
                  {tr("สถานะเริ่มต้น", "Initial status")}
                </Label>
                <Select
                  value={carForm.status}
                  onValueChange={(val) =>
                    setCarForm({ ...carForm, status: val as Tables<"cars">["status"] })
                  }
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
              <Label htmlFor="car-img" className="text-xs">
                {tr("URL รูปภาพรถยนต์ (เว้นว่างไว้เพื่อใช้รูปมาตรฐาน)", "Car photo URL (leave empty for a stock photo)")}
              </Label>
              <Input
                id="car-img"
                placeholder="https://images.unsplash.com/..."
                value={carForm.image_url}
                onChange={(e) => setCarForm({ ...carForm, image_url: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="car-desc" className="text-xs">
                {tr("คำอธิบายเพิ่มเติม", "Description")}
              </Label>
              <Textarea
                id="car-desc"
                rows={2}
                placeholder={tr("รายละเอียดอุปกรณ์ ความสะดวกสบาย...", "Equipment and comfort details...")}
                value={carForm.description}
                onChange={(e) => setCarForm({ ...carForm, description: e.target.value })}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCarModalOpen(false)}>
                {tr("ยกเลิก", "Cancel")}
              </Button>
              <Button type="submit">{tr("บันทึกข้อมูลรถยนต์", "Save car")}</Button>
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
            <DialogTitle>{tr("ปรับปรุงสถานะการจอง", "Update booking status")}</DialogTitle>
            <DialogDescription>
              {tr("รหัสการจอง:", "Booking code:")}{" "}
              <span className="font-mono font-bold text-foreground">
                {updatingBooking?.booking_code}
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs">{tr("เลือกสถานะใหม่", "Choose a new status")}</Label>
              <Select
                value={newBookingStatus}
                onValueChange={(val) => setNewBookingStatus(val as Tables<"bookings">["status"])}
              >
                <SelectTrigger className="mt-1.5" aria-label={tr("เลือกสถานะใหม่", "Choose a new status")}>
                  <SelectValue placeholder={tr("เลือกสถานะ...", "Choose a status...")} />
                </SelectTrigger>
                <SelectContent>
                  {(updatingBooking ? bookingMovesOn(updatingBooking, todayBkk()) : []).map((s) => (
                    <SelectItem key={s} value={s}>
                      {BOOKING_MOVE_LABEL[s] ?? s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground space-y-1">
              <p>
                {tr("• การจองที่รอดำเนินการจะ", "• A pending booking is")} <strong>{tr("ยืนยัน", "confirmed")}</strong>{" "}
                {tr("ได้หลังลูกค้ายืนยันสัญญาและชำระค่าจองแล้วเท่านั้น", "only after the customer confirms the contract and pays the booking fee")}
              </p>
              <p>
                {tr("• เมื่อเปลี่ยนเป็น", "• When changed to")} <strong>{tr("กำลังเช่า (Active)", "In progress (Active)")}</strong>{" "}
                {tr(
                  `ระบบจะปรับสถานะรถคันนี้เป็น "ถูกเช่า" อัตโนมัติ และลูกค้าจะเห็น QR สำหรับชำระยอดวันรับรถ (ค่าเช่า + เงินประกัน − ค่าจอง) ทันที`,
                  `the car is set to "Rented" automatically and the customer sees the QR code to pay the pickup amount (rent + deposit − booking fee) right away.`,
                )}
              </p>
              {updatingBooking && todayBkk() < updatingBooking.start_date && (
                <p className="font-medium text-amber-700" data-testid="before-pickup-note">
                  {tr("• ส่งมอบรถ (กำลังเช่า) และรับรถคืน (เสร็จสิ้น) ได้ตั้งแต่วันรับรถ", "• Hand-over (in progress) and return (completed) are possible from the pickup day")}{" "}
                  {fmtDate(updatingBooking.start_date)} {tr("เป็นต้นไป", "onwards")}
                </p>
              )}
              <p>
                {tr("• เมื่อเปลี่ยนเป็น", "• When changed to")} <strong>{tr("เสร็จสิ้น (Completed)", "Completed")}</strong>{" "}
                {tr(`รถจะกลับสู่สถานะ "ว่าง" พร้อมให้บริการต่อ`, `the car goes back to "Available" for the next rental.`)}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdatingBooking(null)}>
              {tr("ยกเลิก", "Cancel")}
            </Button>
            <Button
              onClick={handleUpdateBookingStatus}
              disabled={!perms.updateBookingStatus || !newBookingStatus}
              variant={newBookingStatus === "cancelled" ? "destructive" : "default"}
            >
              {tr("บันทึกสถานะ", "Save status")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------- */}
      {/* DIALOG 3: CREATE MAINTENANCE SCHEDULE */}
      {/* ------------------------------------------------------------- */}
      <Dialog open={maintModalOpen} onOpenChange={setMaintModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("บันทึกตารางการซ่อมบำรุง", "Log maintenance")}</DialogTitle>
            <DialogDescription>
              {tr("สร้างงานเช็คระยะ ตรวจสภาพ หรือซ่อมแซมสำหรับรถยนต์ในกองยานพาหนะ", "Create a scheduled check, inspection or repair for a fleet car")}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveMaintenance} className="space-y-3.5 pt-2">
            <div>
              <Label className="text-xs">{tr("เลือกรถยนต์ที่ต้องการซ่อมบำรุง *", "Car to service *")}</Label>
              <Select
                value={maintForm.car_id}
                onValueChange={(val) => setMaintForm({ ...maintForm, car_id: val })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={tr("ค้นหาและเลือกรถยนต์...", "Search and choose a car...")} />
                </SelectTrigger>
                <SelectContent>
                  {cars.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.brand} {c.model} ({tr("ทะเบียน", "plate")} {c.plate_no})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="maint-title" className="text-xs">
                {tr("หัวข้องานซ่อมบำรุง *", "Job title *")}
              </Label>
              <Input
                id="maint-title"
                placeholder={tr("เช่น เปลี่ยนถ่ายน้ำมันเครื่อง 20,000 กม.", "e.g. 20,000 km oil change")}
                value={maintForm.title}
                onChange={(e) => setMaintForm({ ...maintForm, title: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="maint-date" className="text-xs">
                  {tr("วันที่นัดหมาย", "Scheduled date")}
                </Label>
                <Input
                  id="maint-date"
                  type="date"
                  value={maintForm.scheduled_date}
                  onChange={(e) => setMaintForm({ ...maintForm, scheduled_date: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="maint-cost" className="text-xs">
                  {tr("ค่าใช้จ่ายโดยประมาณ (THB)", "Estimated cost (THB)")}
                </Label>
                <Input
                  id="maint-cost"
                  type="number"
                  min={0}
                  step={1}
                  value={maintForm.cost}
                  onChange={(e) => setMaintForm({ ...maintForm, cost: Number(e.target.value) })}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">{tr("สถานะงานซ่อมบำรุง", "Job status")}</Label>
              <Select
                value={maintForm.status}
                onValueChange={(val) =>
                  setMaintForm({ ...maintForm, status: val as Tables<"maintenance">["status"] })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="scheduled">{tr("นัดหมายแล้ว", "Scheduled")}</SelectItem>
                  <SelectItem value="in_progress">{tr("กำลังดำเนินการ (รถจะงดให้บริการ)", "In progress (car unavailable)")}</SelectItem>
                  <SelectItem value="completed">{tr("เสร็จสิ้นเรียบร้อย", "Completed")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="maint-desc" className="text-xs">
                {tr("รายละเอียดการซ่อมเพิ่มเติม", "Job details")}
              </Label>
              <Textarea
                id="maint-desc"
                rows={2}
                placeholder={tr("ศูนย์บริการ อะไหล่ที่เปลี่ยน...", "Service centre, parts replaced...")}
                value={maintForm.description}
                onChange={(e) => setMaintForm({ ...maintForm, description: e.target.value })}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMaintModalOpen(false)}>
                {tr("ยกเลิก", "Cancel")}
              </Button>
              <Button type="submit">{tr("บันทึกข้อมูลซ่อมบำรุง", "Save maintenance job")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------- */}
      {/* DIALOG 4: OWNER MANUAL CONFIRMATION (exceptional, audited) */}
      {/* ------------------------------------------------------------- */}
      <Dialog open={!!earlyComplete} onOpenChange={(open) => !open && setEarlyComplete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("ยังไม่ถึงวันนัดหมาย", "Not yet the scheduled date")}</DialogTitle>
            <DialogDescription>
              {tr(
                `งาน "${earlyComplete?.title ?? ""}" ของ ${earlyComplete?.cars?.brand ?? ""} ${earlyComplete?.cars?.model ?? ""} นัดไว้วันที่ ${earlyComplete ? fmtDate(earlyComplete.scheduled_date) : ""} ยืนยันว่าทำเสร็จแล้ววันนี้ (${fmtDate(todayBkk())}) ใช่ไหม? ระบบจะบันทึกวันที่เสร็จเป็นวันนี้ และแสดงว่า "ก่อนวันนัด"`,
                `The job "${earlyComplete?.title ?? ""}" for the ${earlyComplete?.cars?.brand ?? ""} ${earlyComplete?.cars?.model ?? ""} is scheduled for ${earlyComplete ? fmtDate(earlyComplete.scheduled_date) : ""}. Confirm it was done today (${fmtDate(todayBkk())})? Today will be saved as the completion date and the job shows as "early".`,
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEarlyComplete(null)}>
              {tr("ยังไม่เสร็จ", "Not yet")}
            </Button>
            <Button
              onClick={() => {
                const m = earlyComplete;
                setEarlyComplete(null);
                if (m) void handleMaintenanceStatus(m, "completed");
              }}
            >
              {tr("ยืนยันว่าเสร็จแล้ววันนี้", "Confirm it is done today")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!manualConfirmFor} onOpenChange={(open) => !open && setManualConfirmFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("ยืนยันการจองด้วยตนเอง (เฉพาะเจ้าของระบบ)", "Confirm booking manually (Owner only)")}</DialogTitle>
            <DialogDescription>
              {tr("การจอง", "Bookings")}{" "}
              <span className="font-mono font-bold text-foreground">
                {manualConfirmFor?.booking_code}
              </span>{" "}
              {tr("จะถูกยืนยันโดยไม่ผ่านขั้นตอนสัญญาและการชำระเงิน ระบบจะไม่สร้างรายการชำระเงิน และบันทึกเหตุผลพร้อมชื่อผู้ทำรายการในบันทึกตรวจสอบ", "will be confirmed without the contract and payment steps. No payment is created; the reason and your name are recorded in the audit log.")}
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="manual-reason" className="text-xs">
            {tr("เหตุผล (อย่างน้อย 10 ตัวอักษร)", "Reason (at least 10 characters)")}
          </Label>
          <Textarea
            id="manual-reason"
            value={manualReason}
            onChange={(e) => setManualReason(e.target.value)}
            maxLength={1000}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualConfirmFor(null)}>
              {tr("ยกเลิก", "Cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleManualConfirm}
              disabled={confirmingManually}
            >
              {confirmingManually ? tr("กำลังยืนยัน...", "Confirming...") : tr("ยืนยันการจอง", "Confirm booking")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!carToDelete && perms.deleteCars}
        onOpenChange={(open) => !open && setCarToDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" /> {tr("ยืนยันการลบรถยนต์ออกจากระบบ", "Delete this car?")}
            </DialogTitle>
            <DialogDescription>
              {tr("คุณแน่ใจหรือไม่ว่าต้องการลบรถยนต์", "Are you sure you want to delete")}{" "}
              <strong className="text-foreground">
                {carToDelete?.brand} {carToDelete?.model} ({tr("ทะเบียน", "plate")} {carToDelete?.plate_no})
              </strong>{" "}
              {tr("ออกจากระบบ?", "from the system?")}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive border border-destructive/20 space-y-1">
            <p className="font-semibold">{tr("⚠️ ข้อกำหนดความปลอดภัยของระบบ:", "⚠️ Safety rule:")}</p>
            <p>
              {tr("• หากรถยนต์คันนี้เคยมีประวัติการจองหรือสัญญาเช่าในระบบ ระบบจะไม่อนุญาตให้ลบ เพื่อป้องกันข้อมูลสูญหาย", "• If this car has any bookings or contracts, it cannot be deleted, to prevent data loss")}
            </p>
            <p>
              {tr(
                `• หากต้องการหยุดให้บริการรถคันนี้ กรุณาเปลี่ยนสถานะเป็น "งดให้บริการ" หรือ "ซ่อมบำรุง" แทน`,
                `• To take this car out of service, set its status to "Unavailable" or "Maintenance" instead.`,
              )}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCarToDelete(null)}>
              {tr("ยกเลิก", "Cancel")}
            </Button>
            <Button variant="destructive" disabled={deletingCar} onClick={handleDeleteCar}>
              {deletingCar ? tr("กำลังลบ...", "Deleting...") : tr("ยืนยันการลบ", "Delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
