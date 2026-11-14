import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, Search, Send, ShieldCheck, MessageSquareWarning, Save } from "lucide-react";
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
  sendContract,
  updateContract,
  type ContractRow,
  type ContractVersionRow,
} from "@/lib/contract-api";
import type { DashboardPermissions } from "@/lib/roles";

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
  { value: "create", label: "สร้างสัญญา" },
  { value: "draft", label: contractStatusLabel.draft },
  { value: "pending_customer", label: contractStatusLabel.pending_customer },
  { value: "pending_admin_review", label: contractStatusLabel.pending_admin_review },
  { value: "revision_requested", label: contractStatusLabel.revision_requested },
  { value: "approved", label: contractStatusLabel.approved },
  { value: "paid", label: contractStatusLabel.paid },
  { value: "cancelled", label: contractStatusLabel.cancelled },
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
        ค่าเช่ารวม <strong className="text-foreground">{thb(booking.total_amount)}</strong> (
        {booking.days} วัน) และวันที่รับ-คืนรถ มาจากการจองโดยตรง แก้ไขในสัญญาไม่ได้
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="cf-pickup" className="text-xs">
            เวลารับรถ ({fmtDate(booking.start_date)})
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
            เวลาคืนรถ ({fmtDate(booking.end_date)})
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
            เงินประกัน (บาท, ชำระ ณ วันรับรถ)
          </Label>
          <Input
            id="cf-deposit"
            type="number"
            min={0}
            value={form.deposit}
            disabled={disabled}
            onChange={(e) => set("deposit", Number(e.target.value))}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="cf-mileage" className="text-xs">
            ข้อกำหนดระยะทาง
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
            ค่าปรับส่งคืนรถล่าช้า
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
            เงื่อนไขเพิ่มเติม (ไม่บังคับ)
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
          ระบุเลขใบอนุญาตขับขี่ของลูกค้าในสัญญา (เฉพาะเมื่อจำเป็น · ไม่มีการใส่เลขบัตรประชาชน)
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
}: {
  contracts: { status: string; booking_id: string }[];
  bookings: PanelBooking[];
  onOpen: (view: ContractPanelView) => void;
}) {
  const count = (s: string) => contracts.filter((c) => c.status === s).length;
  const tiles: { view: ContractPanelView; label: string; n: number; urgent?: boolean }[] = [
    {
      view: "create",
      label: "การจองรอสร้างสัญญา",
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
        <CardTitle className="text-base">งานสัญญาเช่า</CardTitle>
        <CardDescription>กดเพื่อเปิดรายการในแท็บสัญญาเช่าดิจิทัล</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <button
            key={t.view}
            type="button"
            onClick={() => onOpen(t.view)}
            className={`rounded-lg border p-3 text-left transition hover:bg-muted/60 ${
              t.urgent && t.n > 0 ? "border-amber-400 bg-amber-50 text-amber-900" : "bg-card"
            }`}
          >
            <span className="block text-2xl font-bold">{t.n}</span>
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
  initialView = "pending_admin_review",
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
      toast.error((err as Error).message || "ดำเนินการไม่สำเร็จ");
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
      "สร้างสัญญาฉบับร่างแล้ว ตรวจสอบแล้วกดส่งให้ลูกค้า",
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
        ? `สร้างฉบับที่ ${open.current_version + 1} แล้ว (ฉบับเดิมเก็บไว้ไม่เปลี่ยนแปลง)`
        : "บันทึกฉบับร่างแล้ว",
    );
  };

  const handleRevision = () => {
    if (!open) return;
    const problem = reasonError(revisionReason, 5);
    if (problem) return void toast.error(problem);
    void run(
      () => adminRequestRevision(open.id, open.current_version, revisionReason),
      "ส่งคำขอแก้ไขแล้ว",
      () => {
        setRevisionOpen(false);
        setRevisionReason("");
      },
    );
  };

  const holdLabel = (b: PanelBooking | null) => {
    if (!b || b.status !== "pending") return "-";
    const s = holdSecondsLeft(b, now);
    return s === 0 ? "หมดเวลา" : formatCountdown(s);
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
        <CardTitle className="text-xl">สัญญาเช่าดิจิทัล</CardTitle>
        <CardDescription>
          สร้างสัญญาจากการจอง → ส่งให้ลูกค้า → ลูกค้ายอมรับ → ผู้ดูแลอนุมัติ → ลูกค้าชำระเงิน (DEMO)
          ภายใน 15 นาที
        </CardDescription>
        <Tabs value={view} onValueChange={(v) => setView(v as View)} className="mt-3">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4 [&>button]:whitespace-normal">
            {VIEWS.map((v) => (
              <TabsTrigger key={v.value} value={v.value} className="text-xs">
                {v.label} ({counts[v.value] ?? 0})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative mt-3 max-w-sm">
          <Input
            placeholder="ค้นหาเลขที่สัญญา รหัสการจอง หรือชื่อลูกค้า..."
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
                <TableHead>รหัสการจอง</TableHead>
                <TableHead>ลูกค้า</TableHead>
                <TableHead>รถยนต์</TableHead>
                <TableHead>วันที่เช่า</TableHead>
                <TableHead>เวลาที่เหลือ</TableHead>
                <TableHead className="text-right">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {creatable
                .filter((b) => matches(b.booking_code, undefined, b.user_id))
                .map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-xs font-bold">{b.booking_code}</TableCell>
                    <TableCell className="text-xs">
                      {profileMap[b.user_id]?.full_name || "ลูกค้าสมาชิก"}
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
                        <FilePlus2 className="mr-1 h-3.5 w-3.5" /> สร้างสัญญา
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              {creatable.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    ไม่มีการจองที่รอสร้างสัญญา
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เลขที่สัญญา</TableHead>
                <TableHead>รหัสการจอง</TableHead>
                <TableHead>ลูกค้า</TableHead>
                <TableHead>รถยนต์</TableHead>
                <TableHead>ฉบับ</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead>เวลาที่เหลือ</TableHead>
                <TableHead>อัปเดตล่าสุด</TableHead>
                <TableHead className="text-right">จัดการ</TableHead>
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
                    {profileMap[c.user_id]?.full_name || "ลูกค้าสมาชิก"}
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
                      เปิดสัญญา
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {listed.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    ไม่มีสัญญาในสถานะนี้
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
            <DialogTitle>สร้างสัญญาเช่า (ฉบับร่าง)</DialogTitle>
            <DialogDescription>
              การจอง{" "}
              <span className="font-mono font-bold text-foreground">{createFor?.booking_code}</span>{" "}
              · {createFor && (profileMap[createFor.user_id]?.full_name || "ลูกค้าสมาชิก")} ·
              ลูกค้าจะยังไม่เห็นจนกว่าคุณจะกดส่ง
            </DialogDescription>
          </DialogHeader>
          {createFor && <ContractFormFields form={form} onChange={setForm} booking={createFor} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFor(null)}>
              ยกเลิก
            </Button>
            <Button onClick={handleCreate} disabled={busy}>
              {busy ? "กำลังสร้าง..." : "สร้างฉบับร่าง"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail / review */}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>สัญญา {open?.contract_no}</DialogTitle>
            <DialogDescription>
              การจอง {open?.bookings?.booking_code ?? "-"} ·{" "}
              {open && (profileMap[open.user_id]?.full_name || "ลูกค้าสมาชิก")} · เวลาที่เหลือ{" "}
              {holdLabel(open?.bookings ?? null)}
            </DialogDescription>
          </DialogHeader>

          {open && (
            <ContractView contract={open} versions={versions} events={events} audience="admin" />
          )}

          {open &&
            canAdminReview(open) &&
            perms.approveContracts &&
            currentVersion?.accepted_at && (
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">
                  ลูกค้ายอมรับฉบับที่ {open.current_version} เมื่อ{" "}
                  {fmtDateTime(currentVersion.accepted_at)}
                </p>
                <p className="text-xs">เมื่ออนุมัติ ลูกค้าจะชำระเงินได้ภายใน 15 นาที</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => approveContract(open.id, open.current_version),
                        `อนุมัติฉบับที่ ${open.current_version} แล้ว`,
                      )
                    }
                  >
                    <ShieldCheck className="mr-1 h-4 w-4" /> อนุมัติฉบับที่ {open.current_version}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setRevisionOpen(true)}
                  >
                    <MessageSquareWarning className="mr-1 h-4 w-4" /> ขอแก้ไข
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
                <span>ฉบับที่ {open.current_version} ยังเป็นฉบับร่าง ลูกค้ายังไม่เห็น</span>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(() => sendContract(open.id), "ส่งสัญญาให้ลูกค้าแล้ว")}
                >
                  <Send className="mr-1 h-4 w-4" /> ส่งให้ลูกค้าตรวจสอบ
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
                    ? `แก้ไขสัญญา (สร้างฉบับที่ ${open.current_version + 1} · ลูกค้าต้องยอมรับใหม่)`
                    : `แก้ไขฉบับร่าง (ฉบับที่ ${open.current_version})`}
                </summary>
                <div className="mt-3 space-y-3">
                  <ContractFormFields form={form} onChange={setForm} booking={open.bookings} />
                  <Button size="sm" onClick={handleSave} disabled={busy}>
                    <Save className="mr-1 h-4 w-4" />
                    {currentVersion?.sent_at ? "สร้างฉบับใหม่" : "บันทึกฉบับร่าง"}
                  </Button>
                </div>
              </details>
            )}

          {open && !perms.editContracts && !perms.approveContracts && (
            <Badge variant="outline">ดูได้อย่างเดียว (ไม่มีสิทธิ์จัดการสัญญา)</Badge>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={revisionOpen} onOpenChange={setRevisionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ขอแก้ไขสัญญาฉบับที่ {open?.current_version}</DialogTitle>
            <DialogDescription>
              ระบุเหตุผล จากนั้นสร้างฉบับใหม่ ลูกค้าต้องยอมรับฉบับใหม่อีกครั้ง
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={revisionReason}
            onChange={(e) => setRevisionReason(e.target.value)}
            maxLength={1000}
            aria-label="เหตุผลที่ขอแก้ไข"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisionOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={handleRevision} disabled={busy}>
              ส่งคำขอแก้ไข
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
