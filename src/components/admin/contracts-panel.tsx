import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCheck,
  FilePlus2,
  Search,
  Send,
  ShieldCheck,
  MessageSquareWarning,
  Save,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { StatusBadge } from "@/components/status-badge";
import { ContractView } from "@/components/contract/contract-view";
import { fmtDate, fmtDateTime, thb } from "@/lib/format";
import { formatCountdown, holdSecondsLeft } from "@/lib/payment-window";
import { invalidateBookingData } from "@/lib/queries";
import {
  DEFAULT_CONTRACT_FORM,
  bangkokTime,
  canAdminEdit,
  canAdminReview,
  canAdminSend,
  contractStatusLabel,
  parseRevisionReason,
  reasonError,
  validateContractForm,
  type ContractForm,
  type ContractStatus,
} from "@/lib/contract-workflow";
import {
  adminRequestRevision,
  approveContract,
  createContract,
  fetchContractEvents,
  fetchContractVersions,
  adminApplyRequestedName,
  sendContract,
  updateContract,
  type ContractRow,
  type ContractVersionRow,
} from "@/lib/contract-api";
import type { DashboardPermissions } from "@/lib/roles";
import { tr, trError } from "@/lib/i18n";

/** A booking as the admin dashboard loads it (with its car). */
export type PanelBooking = {
  id: string;
  booking_code: string;
  user_id: string;
  status: string;
  start_date: string;
  end_date: string;
  days: number;
  total_amount: number;
  pickup_location: string;
  created_at: string;
  hold_expires_at?: string | null;
  cars: { brand: string; model: string; plate_no: string } | null;
};

export type PanelContract = ContractRow & { bookings: PanelBooking | null };

export type ContractPanelView = "create" | ContractStatus;
type View = ContractPanelView;

const VIEWS: { value: View; label: string }[] = [
  {
    value: "create",
    get label() {
      return tr("สร้างสัญญา", "Create contract");
    },
  },
  {
    value: "draft",
    get label() {
      return contractStatusLabel.draft;
    },
  },
  {
    value: "pending_customer",
    get label() {
      return contractStatusLabel.pending_customer;
    },
  },
  {
    value: "pending_admin_review",
    get label() {
      return contractStatusLabel.pending_admin_review;
    },
  },
  {
    value: "revision_requested",
    get label() {
      return contractStatusLabel.revision_requested;
    },
  },
  {
    value: "approved",
    get label() {
      return contractStatusLabel.approved;
    },
  },
  {
    value: "paid",
    get label() {
      return contractStatusLabel.paid;
    },
  },
  {
    value: "cancelled",
    get label() {
      return contractStatusLabel.cancelled;
    },
  },
];

function formFromVersion(v: ContractVersionRow | undefined): ContractForm {
  if (!v || v.is_legacy) return { ...DEFAULT_CONTRACT_FORM };
  return {
    pickupTime: bangkokTime(v.pickup_at, DEFAULT_CONTRACT_FORM.pickupTime),
    returnTime: bangkokTime(v.return_at, DEFAULT_CONTRACT_FORM.returnTime),
    deposit: Number(v.deposit ?? DEFAULT_CONTRACT_FORM.deposit),
    mileageAllowance: v.mileage_allowance ?? DEFAULT_CONTRACT_FORM.mileageAllowance,
    latePenalty: v.late_penalty ?? DEFAULT_CONTRACT_FORM.latePenalty,
    additionalConditions: v.additional_conditions ?? "",
    includeLicence: !!v.customer_license_no,
  };
}

/** The contract terms an admin can set. Price and dates always come from the booking. */
export function ContractFormFields({
  form,
  onChange,
  booking,
  disabled,
}: {
  form: ContractForm;
  onChange: (f: ContractForm) => void;
  booking: PanelBooking;
  disabled?: boolean;
}) {
  const set = <K extends keyof ContractForm>(k: K, v: ContractForm[K]) =>
    onChange({ ...form, [k]: v });
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        {tr("ค่าเช่ารวม", "Total rent")}{" "}
        <strong className="text-foreground">{thb(booking.total_amount)}</strong>{" "}
        {tr(
          `(${booking.days} วัน) และวันที่รับ-คืนรถ มาจากการจองโดยตรง แก้ไขในสัญญาไม่ได้`,
          `(${booking.days} days) and the pickup/return dates come from the booking and cannot be changed in the contract`,
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="cf-pickup" className="text-xs">
            {tr("เวลารับรถ (", "Pickup time (")}
            {fmtDate(booking.start_date)})
          </Label>
          <Input
            id="cf-pickup"
            type="time"
            value={form.pickupTime}
            disabled={disabled}
            onChange={(e) => set("pickupTime", e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="cf-return" className="text-xs">
            {tr("เวลาคืนรถ (", "Return time (")}
            {fmtDate(booking.end_date)})
          </Label>
          <Input
            id="cf-return"
            type="time"
            value={form.returnTime}
            disabled={disabled}
            onChange={(e) => set("returnTime", e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="cf-deposit" className="text-xs">
            {tr(
              "เงินประกัน (บาท, เท่ากับค่าเช่า ชำระ ณ วันรับรถ)",
              "Deposit (THB, equal to the rent, paid on the pickup day)",
            )}
          </Label>
          {/* The database sets deposit = rent (docs/database/booking-fee-flow.sql) */}
          <Input
            id="cf-deposit"
            type="number"
            value={Number(booking.total_amount)}
            disabled
            readOnly
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="cf-mileage" className="text-xs">
            {tr("ข้อกำหนดระยะทาง", "Mileage")}
          </Label>
          <Input
            id="cf-mileage"
            value={form.mileageAllowance}
            disabled={disabled}
            onChange={(e) => set("mileageAllowance", e.target.value)}
            className="mt-1"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="cf-late" className="text-xs">
            {tr("ค่าปรับส่งคืนรถล่าช้า", "Late return penalty")}
          </Label>
          <Input
            id="cf-late"
            value={form.latePenalty}
            disabled={disabled}
            onChange={(e) => set("latePenalty", e.target.value)}
            className="mt-1"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="cf-extra" className="text-xs">
            {tr("เงื่อนไขเพิ่มเติม (ไม่บังคับ)", "Additional conditions (optional)")}
          </Label>
          <Textarea
            id="cf-extra"
            value={form.additionalConditions}
            disabled={disabled}
            maxLength={2000}
            onChange={(e) => set("additionalConditions", e.target.value)}
            className="mt-1"
          />
        </div>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id="cf-licence"
          checked={form.includeLicence}
          disabled={disabled}
          onCheckedChange={(c) => set("includeLicence", !!c)}
        />
        <Label htmlFor="cf-licence" className="cursor-pointer text-xs leading-tight">
          {tr(
            "ระบุเลขใบอนุญาตขับขี่ของลูกค้าในสัญญา (เฉพาะเมื่อจำเป็น · ไม่มีการใส่เลขบัตรประชาชน)",
            "Include the customer's driving licence number in the contract (only when needed · the ID card number is never included)",
          )}
        </Label>
      </div>
    </div>
  );
}

/** Pending bookings that still need a contract (hold not yet expired). */
const bookingsAwaitingContract = (
  bookings: PanelBooking[],
  contracts: { booking_id: string }[],
  now: number = Date.now(),
) => {
  const withContract = new Set(contracts.map((c) => c.booking_id));
  return bookings.filter(
    (b) => b.status === "pending" && !withContract.has(b.id) && holdSecondsLeft(b, now) > 0,
  );
};

/** Work queue for the admin overview: one tile per stage, each opens that tab of the panel. */
export function ContractWorkQueue({
  contracts,
  bookings,
  onOpen,
  loading = false,
}: {
  contracts: { status: string; booking_id: string }[];
  bookings: PanelBooking[];
  onOpen: (view: ContractPanelView) => void;
  /** While the data loads, show a placeholder instead of misleading zeros. */
  loading?: boolean;
}) {
  const count = (s: string) => contracts.filter((c) => c.status === s).length;
  const tiles: { view: ContractPanelView; label: string; n: number; urgent?: boolean }[] = [
    {
      view: "create",
      label: tr("การจองรอสร้างสัญญา", "Bookings awaiting a contract"),
      n: bookingsAwaitingContract(bookings, contracts).length,
      urgent: true,
    },
    { view: "draft", label: contractStatusLabel.draft, n: count("draft") },
    {
      view: "pending_customer",
      label: contractStatusLabel.pending_customer,
      n: count("pending_customer"),
    },
    {
      view: "pending_admin_review",
      label: contractStatusLabel.pending_admin_review,
      n: count("pending_admin_review"),
      urgent: true,
    },
    {
      view: "revision_requested",
      label: contractStatusLabel.revision_requested,
      n: count("revision_requested"),
      urgent: true,
    },
    { view: "approved", label: contractStatusLabel.approved, n: count("approved") },
    { view: "paid", label: contractStatusLabel.paid, n: count("paid") },
    { view: "cancelled", label: contractStatusLabel.cancelled, n: count("cancelled") },
  ];
  return (
    <Card className="border shadow-card" data-testid="contract-work-queue">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{tr("งานสัญญาเช่า", "Contract work queue")}</CardTitle>
        <CardDescription>
          {tr(
            "กดเพื่อเปิดรายการในแท็บสัญญาเช่าดิจิทัล",
            "Click to open the list in the Contracts tab",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles
          // the old flow's admin approval: shown only while such a contract is still waiting
          .filter((t) => t.view !== "pending_admin_review" || (!loading && t.n > 0))
          .map((t) => (
            <button
              key={t.view}
              type="button"
              onClick={() => onOpen(t.view)}
              className={`rounded-lg border p-3 text-left transition hover:bg-muted/60 ${
                t.urgent && t.n > 0 ? "border-amber-400 bg-amber-50 text-amber-900" : "bg-card"
              }`}
            >
              <span className="block text-2xl font-bold" aria-busy={loading}>
                {loading ? "…" : t.n}
              </span>
              <span className="text-xs">{t.label}</span>
            </button>
          ))}
      </CardContent>
    </Card>
  );
}

export function AdminContractsPanel({
  perms,
  contracts,
  bookings,
  profileMap,
  initialView = "create",
}: {
  perms: DashboardPermissions;
  contracts: PanelContract[];
  bookings: PanelBooking[];
  profileMap: Record<string, { full_name: string; phone?: string | null } | undefined>;
  /** Tab to open first (the overview work queue links straight to a stage). */
  initialView?: ContractPanelView;
}) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>(initialView);
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  // Detail / create dialogs
  const [openId, setOpenId] = useState<string | null>(null);
  const [createFor, setCreateFor] = useState<PanelBooking | null>(null);
  const [form, setForm] = useState<ContractForm>({ ...DEFAULT_CONTRACT_FORM });
  const [busy, setBusy] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionReason, setRevisionReason] = useState("");

  const open = contracts.find((c) => c.id === openId) ?? null;
  const { data: versions = [] } = useQuery({
    queryKey: ["contract-versions", openId],
    queryFn: () => fetchContractVersions(openId!),
    enabled: !!openId,
  });
  const { data: events = [] } = useQuery({
    queryKey: ["contract-events", open?.booking_id],
    queryFn: () => fetchContractEvents(open!.booking_id),
    enabled: !!open,
  });
  const currentVersion = versions.find((v) => v.version === open?.current_version);

  // Reset the edit form whenever another contract (or version) is opened
  useEffect(() => {
    setForm(formFromVersion(currentVersion));
  }, [openId, currentVersion?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const creatable = bookingsAwaitingContract(bookings, contracts, now);
  const counts = useMemo(() => {
    const m: Record<string, number> = { create: creatable.length };
    for (const c of contracts) m[c.status] = (m[c.status] ?? 0) + 1;
    return m;
  }, [contracts, creatable.length]);

  const q = search.trim().toLowerCase();
  const matches = (code: string | undefined, contractNo?: string, userId?: string) =>
    !q ||
    (code ?? "").toLowerCase().includes(q) ||
    (contractNo ?? "").toLowerCase().includes(q) ||
    (profileMap[userId ?? ""]?.full_name ?? "").toLowerCase().includes(q);

  const refresh = () =>
    Promise.all([
      invalidateBookingData(queryClient),
      queryClient.invalidateQueries({ queryKey: ["contract-versions"] }),
      queryClient.invalidateQueries({ queryKey: ["contract-events"] }),
    ]);

  const run = async (action: () => Promise<unknown>, success: string, after?: () => void) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      after?.();
    } catch (err: unknown) {
      toast.error(trError((err as Error).message) || tr("ดำเนินการไม่สำเร็จ", "The action failed"));
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const handleCreate = () => {
    if (!createFor) return;
    const problem = validateContractForm(form, createFor.start_date, createFor.end_date);
    if (problem) return void toast.error(problem);
    void run(
      async () => {
        const id = await createContract(
          createFor.id,
          form,
          createFor.start_date,
          createFor.end_date,
        );
        setOpenId(id);
      },
      tr(
        "สร้างสัญญาฉบับร่างแล้ว ตรวจสอบแล้วกดส่งให้ลูกค้า",
        "Draft contract created. Check it, then send it to the customer.",
      ),
      () => {
        setCreateFor(null);
        setView("draft");
      },
    );
  };

  const handleSave = () => {
    if (!open?.bookings) return;
    const b = open.bookings;
    const problem = validateContractForm(form, b.start_date, b.end_date);
    if (problem) return void toast.error(problem);
    const newVersion = !!currentVersion?.sent_at;
    void run(
      () => updateContract(open.id, form, b.start_date, b.end_date),
      newVersion
        ? tr(
            `สร้างฉบับที่ ${open.current_version + 1} แล้ว (ฉบับเดิมเก็บไว้ไม่เปลี่ยนแปลง)`,
            `Version ${open.current_version + 1} created (the previous version is kept unchanged)`,
          )
        : tr("บันทึกฉบับร่างแล้ว", "Draft saved"),
    );
  };

  // A customer's structured request (name + times) that the admin can apply in one click
  const requested =
    open?.status === "revision_requested" && open.revision_requested_by === "customer"
      ? parseRevisionReason(open.revision_reason)
      : null;

  const handleApplyRequest = () => {
    if (!open?.bookings || !requested) return;
    const b = open.bookings;
    const next: ContractForm = {
      ...formFromVersion(currentVersion),
      pickupTime: requested.pickupTime,
      returnTime: requested.returnTime,
    };
    const problem = validateContractForm(next, b.start_date, b.end_date);
    if (problem) return void toast.error(problem);
    void run(
      async () => {
        // The contract takes the name from the profile: apply the requested name first
        if (requested.customerName !== (currentVersion?.customer_name ?? "")) {
          await adminApplyRequestedName(open.id, requested.customerName);
        }
        await updateContract(open.id, next, b.start_date, b.end_date);
        await sendContract(open.id);
      },
      tr(
        `ยืนยันการแก้ไขแล้ว ส่งฉบับที่ ${open.current_version + 1} ให้ลูกค้ายืนยัน`,
        `Changes confirmed. Version ${open.current_version + 1} sent to the customer to confirm.`,
      ),
    );
  };

  const handleRevision = () => {
    if (!open) return;
    const problem = reasonError(revisionReason, 5);
    if (problem) return void toast.error(problem);
    void run(
      () => adminRequestRevision(open.id, open.current_version, revisionReason),
      tr("ส่งคำขอแก้ไขแล้ว", "Change request sent"),
      () => {
        setRevisionOpen(false);
        setRevisionReason("");
      },
    );
  };

  const holdLabel = (b: PanelBooking | null) => {
    if (!b || b.status !== "pending") return "-";
    const s = holdSecondsLeft(b, now);
    return s === 0 ? tr("หมดเวลา", "Expired") : formatCountdown(s);
  };

  const listed = contracts.filter(
    (c) =>
      view !== "create" &&
      c.status === view &&
      matches(c.bookings?.booking_code, c.contract_no, c.user_id),
  );

  return (
    <Card className="border shadow-card">
      <CardHeader>
        <CardTitle className="text-xl">{tr("สัญญาเช่าดิจิทัล", "Contracts")}</CardTitle>
        <CardDescription>
          {tr(
            "ยืนยันการจองโดยสร้างสัญญา → ส่งฉบับร่างให้ลูกค้า → ลูกค้าขอแก้ไขหรือยืนยัน → ลูกค้าชำระค่าจอง 1,000 บาท (DEMO) ภายใน 15 นาที",
            "Confirm a booking by creating a contract → send the draft to the customer → the customer asks for changes or confirms → the customer pays the 1,000 THB booking fee (DEMO) within 15 minutes",
          )}
        </CardDescription>
        <Tabs value={view} onValueChange={(v) => setView(v as View)} className="mt-3">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4 [&>button]:whitespace-normal">
            {VIEWS.filter(
              (v) =>
                v.value !== "pending_admin_review" ||
                (counts["pending_admin_review"] ?? 0) > 0 ||
                view === "pending_admin_review",
            ).map((v) => (
              <TabsTrigger key={v.value} value={v.value} className="text-xs">
                {v.label} ({counts[v.value] ?? 0})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative mt-3 max-w-sm">
          <Input
            placeholder={tr(
              "ค้นหาเลขที่สัญญา รหัสการจอง หรือชื่อลูกค้า...",
              "Search contract no., booking code or customer...",
            )}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>

      <CardContent className="overflow-x-auto p-0">
        {view === "create" ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("รหัสการจอง", "Booking code")}</TableHead>
                <TableHead>{tr("ลูกค้า", "Customer")}</TableHead>
                <TableHead>{tr("รถยนต์", "Car")}</TableHead>
                <TableHead>{tr("วันที่เช่า", "Rental dates")}</TableHead>
                <TableHead>{tr("เวลาที่เหลือ", "Time left")}</TableHead>
                <TableHead className="text-right">{tr("จัดการ", "Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {creatable
                .filter((b) => matches(b.booking_code, undefined, b.user_id))
                .map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-xs font-bold">{b.booking_code}</TableCell>
                    <TableCell className="text-xs">
                      {profileMap[b.user_id]?.full_name || tr("ลูกค้าสมาชิก", "Member")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {b.cars?.brand} {b.cars?.model} ({b.cars?.plate_no})
                    </TableCell>
                    <TableCell className="text-xs">
                      {fmtDate(b.start_date)} — {fmtDate(b.end_date)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{holdLabel(b)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={!perms.editContracts}
                        onClick={() => {
                          setForm({ ...DEFAULT_CONTRACT_FORM });
                          setCreateFor(b);
                        }}
                      >
                        <FilePlus2 className="mr-1 h-3.5 w-3.5" />{" "}
                        {tr("สร้างสัญญา", "Create contract")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              {creatable.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {tr("ไม่มีการจองที่รอสร้างสัญญา", "No bookings awaiting a contract")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("เลขที่สัญญา", "Contract no.")}</TableHead>
                <TableHead>{tr("รหัสการจอง", "Booking code")}</TableHead>
                <TableHead>{tr("ลูกค้า", "Customer")}</TableHead>
                <TableHead>{tr("รถยนต์", "Car")}</TableHead>
                <TableHead>{tr("ฉบับ", "Version")}</TableHead>
                <TableHead>{tr("สถานะ", "Status")}</TableHead>
                <TableHead>{tr("เวลาที่เหลือ", "Time left")}</TableHead>
                <TableHead>{tr("อัปเดตล่าสุด", "Last updated")}</TableHead>
                <TableHead className="text-right">{tr("จัดการ", "Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listed.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs font-bold">{c.contract_no}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {c.bookings?.booking_code ?? "-"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {profileMap[c.user_id]?.full_name || tr("ลูกค้าสมาชิก", "Member")}
                  </TableCell>
                  <TableCell className="text-xs">
                    {c.bookings?.cars?.brand} {c.bookings?.cars?.model}
                  </TableCell>
                  <TableCell className="text-xs">{c.current_version ?? 1}</TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} kind="contract" />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{holdLabel(c.bookings)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {fmtDateTime(c.updated_at ?? c.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setOpenId(c.id)}
                    >
                      {tr("เปิดสัญญา", "Open")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {listed.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    {tr("ไม่มีสัญญาในสถานะนี้", "No contracts with this status")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Create */}
      <Dialog open={!!createFor} onOpenChange={(o) => !o && setCreateFor(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tr("สร้างสัญญาเช่า (ฉบับร่าง)", "Create contract (draft)")}</DialogTitle>
            <DialogDescription>
              {tr("การจอง", "Booking")}{" "}
              <span className="font-mono font-bold text-foreground">{createFor?.booking_code}</span>{" "}
              ·{" "}
              {createFor &&
                (profileMap[createFor.user_id]?.full_name || tr("ลูกค้าสมาชิก", "Member"))}{" "}
              {tr(
                "· ลูกค้าจะยังไม่เห็นจนกว่าคุณจะกดส่ง",
                "· the customer will not see it until you send it",
              )}
            </DialogDescription>
          </DialogHeader>
          {createFor && <ContractFormFields form={form} onChange={setForm} booking={createFor} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFor(null)}>
              {tr("ยกเลิก", "Cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={busy}>
              {busy ? tr("กำลังสร้าง...", "Creating...") : tr("สร้างฉบับร่าง", "Create draft")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail / review */}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {tr("สัญญา", "Contract")} {open?.contract_no}
            </DialogTitle>
            <DialogDescription>
              {tr("การจอง", "Booking")} {open?.bookings?.booking_code ?? "-"} ·{" "}
              {open && (profileMap[open.user_id]?.full_name || tr("ลูกค้าสมาชิก", "Member"))}{" "}
              {tr("· เวลาที่เหลือ", "· time left")} {holdLabel(open?.bookings ?? null)}
            </DialogDescription>
          </DialogHeader>

          {open && (
            <ContractView contract={open} versions={versions} events={events} audience="admin" />
          )}

          {open && requested && perms.editContracts && open.bookings?.status === "pending" && (
            <div
              className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
              data-testid="customer-request"
            >
              <p className="font-semibold">
                {tr("ลูกค้าขอแก้ไขฉบับที่", "Customer requested changes to version")}{" "}
                {open.current_version}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-8 text-amber-900">{tr("รายการ", "items")}</TableHead>
                    <TableHead className="h-8 text-amber-900">
                      {tr("ฉบับปัจจุบัน", "Current version")}
                    </TableHead>
                    <TableHead className="h-8 text-amber-900">
                      {tr("ลูกค้าขอ", "Customer asked for")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(
                    [
                      [
                        tr("ชื่อลูกค้า", "Customer name"),
                        currentVersion?.customer_name ?? "-",
                        requested.customerName,
                      ],
                      [
                        tr("เวลารับรถ", "Pickup time"),
                        bangkokTime(currentVersion?.pickup_at, "-"),
                        requested.pickupTime,
                      ],
                      [
                        tr("เวลาคืนรถ", "Return time"),
                        bangkokTime(currentVersion?.return_at, "-"),
                        requested.returnTime,
                      ],
                    ] as const
                  ).map(([label, now, want]) => (
                    <TableRow key={label}>
                      <TableCell className="py-1.5">{label}</TableCell>
                      <TableCell className="py-1.5">{now}</TableCell>
                      <TableCell
                        className={`py-1.5 ${now !== want ? "font-semibold text-amber-950" : ""}`}
                      >
                        {want}
                        {now !== want && tr(" (เปลี่ยน)", " (changed)")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs">
                {tr(
                  "กดยืนยันแล้ว ระบบสร้างฉบับที่",
                  "When you confirm, the system creates version",
                )}{" "}
                {open.current_version + 1}{" "}
                {tr(
                  "ตามที่ลูกค้าขอ (รวมถึงเปลี่ยนชื่อในโปรไฟล์ลูกค้าถ้าขอเปลี่ยนชื่อ) และส่งให้ลูกค้าทันที ถ้าไม่ต้องการใช้ชื่อหรือเวลาที่ขอ ให้แก้ไขสัญญาเองด้านล่างแทน",
                  "as the customer asked (including the profile name if they asked to change it) and sends it to them right away. If you do not want the requested name or times, edit the contract yourself below instead.",
                )}
              </p>
              <Button size="sm" disabled={busy} onClick={handleApplyRequest}>
                <CheckCheck className="mr-1 h-4 w-4" />{" "}
                {tr("ยืนยันการแก้ไขและส่งให้ลูกค้า", "Confirm changes and send to customer")}
              </Button>
            </div>
          )}

          {open &&
            canAdminReview(open) &&
            perms.approveContracts &&
            currentVersion?.accepted_at && (
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">
                  {tr("ลูกค้ายอมรับฉบับที่", "Customer confirmed version")} {open.current_version}{" "}
                  {tr("เมื่อ", "on")} {fmtDateTime(currentVersion.accepted_at)}
                </p>
                <p className="text-xs">
                  {tr(
                    "เมื่ออนุมัติ ลูกค้าจะชำระเงินได้ภายใน 15 นาที",
                    "Once approved, the customer can pay within 15 minutes",
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => approveContract(open.id, open.current_version),
                        tr(
                          `อนุมัติฉบับที่ ${open.current_version} แล้ว`,
                          `Version ${open.current_version} approved`,
                        ),
                      )
                    }
                  >
                    <ShieldCheck className="mr-1 h-4 w-4" />{" "}
                    {tr("อนุมัติฉบับที่", "Approve version")} {open.current_version}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setRevisionOpen(true)}
                  >
                    <MessageSquareWarning className="mr-1 h-4 w-4" />{" "}
                    {tr("ขอแก้ไข", "Request changes")}
                  </Button>
                </div>
              </div>
            )}

          {open &&
            canAdminSend(open) &&
            perms.editContracts &&
            currentVersion &&
            !currentVersion.sent_at && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                <span>
                  {tr("ฉบับที่", "Version")} {open.current_version}{" "}
                  {tr(
                    "ยังเป็นฉบับร่าง ลูกค้ายังไม่เห็น",
                    "Still a draft; the customer cannot see it yet",
                  )}
                </span>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => sendContract(open.id),
                      tr("ส่งสัญญาให้ลูกค้าแล้ว", "Contract sent to the customer"),
                    )
                  }
                >
                  <Send className="mr-1 h-4 w-4" /> {tr("ส่งให้ลูกค้าตรวจสอบ", "Send to customer")}
                </Button>
              </div>
            )}

          {open?.bookings &&
            canAdminEdit(open) &&
            perms.editContracts &&
            open.bookings.status === "pending" && (
              <details
                className="rounded-lg border p-3"
                open={open.status === "draft" || open.status === "revision_requested"}
              >
                <summary className="cursor-pointer text-sm font-semibold">
                  {currentVersion?.sent_at
                    ? tr(
                        `แก้ไขสัญญา (สร้างฉบับที่ ${open.current_version + 1} · ลูกค้าต้องยอมรับใหม่)`,
                        `Edit contract (creates version ${open.current_version + 1} · the customer must confirm again)`,
                      )
                    : tr(
                        `แก้ไขฉบับร่าง (ฉบับที่ ${open.current_version})`,
                        `Edit draft (version ${open.current_version})`,
                      )}
                </summary>
                <div className="mt-3 space-y-3">
                  <ContractFormFields form={form} onChange={setForm} booking={open.bookings} />
                  <Button size="sm" onClick={handleSave} disabled={busy}>
                    <Save className="mr-1 h-4 w-4" />
                    {currentVersion?.sent_at
                      ? tr("สร้างฉบับใหม่", "Create new version")
                      : tr("บันทึกฉบับร่าง", "Save draft")}
                  </Button>
                </div>
              </details>
            )}

          {open && !perms.editContracts && !perms.approveContracts && (
            <Badge variant="outline">
              {tr(
                "ดูได้อย่างเดียว (ไม่มีสิทธิ์จัดการสัญญา)",
                "View only (no permission to manage contracts)",
              )}
            </Badge>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={revisionOpen} onOpenChange={setRevisionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr("ขอแก้ไขสัญญาฉบับที่", "Request changes to version")} {open?.current_version}
            </DialogTitle>
            <DialogDescription>
              {tr(
                "ระบุเหตุผล จากนั้นสร้างฉบับใหม่ ลูกค้าต้องยอมรับฉบับใหม่อีกครั้ง",
                "Give a reason, then create a new version. The customer must confirm the new version again.",
              )}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={revisionReason}
            onChange={(e) => setRevisionReason(e.target.value)}
            maxLength={1000}
            aria-label={tr("เหตุผลที่ขอแก้ไข", "Reason for changes")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisionOpen(false)}>
              {tr("ยกเลิก", "Cancel")}
            </Button>
            <Button onClick={handleRevision} disabled={busy}>
              {tr("ส่งคำขอแก้ไข", "Send change request")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
