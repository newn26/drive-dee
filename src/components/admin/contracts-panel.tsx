import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/status-badge";
import { ContractView } from "@/components/contract/contract-view";
import { fmtDateTime } from "@/lib/format";
import { formatCountdown, holdSecondsLeft } from "@/lib/payment-window";
import { contractStatusLabel, type ContractStatus } from "@/lib/contract-workflow";
import { fetchContractEvents, fetchContractVersions, type ContractRow } from "@/lib/contract-api";

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

/**
 * Contracts are created automatically when a customer books and become payable once the
 * customer accepts them, so admins only follow along here (read-only).
 */
export type ContractPanelView = "pending_customer" | "approved" | "paid" | "cancelled" | "legacy";
type View = ContractPanelView;

/** Statuses left over from the old Admin-review flow. */
const LEGACY: readonly ContractStatus[] = ["draft", "pending_admin_review", "revision_requested"];
const viewOf = (status: string): View =>
  (LEGACY as readonly string[]).includes(status) ? "legacy" : (status as View);

const VIEWS: { value: View; label: string }[] = [
  { value: "pending_customer", label: contractStatusLabel.pending_customer },
  { value: "approved", label: contractStatusLabel.approved },
  { value: "paid", label: contractStatusLabel.paid },
  { value: "cancelled", label: contractStatusLabel.cancelled },
  { value: "legacy", label: "ระบบเดิม" },
];

/** Overview tiles: one per stage, each opens that tab of the panel. */
export function ContractWorkQueue({
  contracts,
  onOpen,
}: {
  contracts: { status: string }[];
  onOpen: (view: ContractPanelView) => void;
}) {
  const count = (v: View) => contracts.filter((c) => viewOf(c.status) === v).length;
  const tiles = VIEWS.filter((v) => v.value !== "legacy" || count("legacy") > 0);
  return (
    <Card className="border shadow-card" data-testid="contract-work-queue">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">สัญญาเช่า</CardTitle>
        <CardDescription>กดเพื่อเปิดรายการในแท็บสัญญาเช่าดิจิทัล</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => onOpen(t.value)}
            className="rounded-lg border bg-card p-3 text-left transition hover:bg-muted/60"
          >
            <span className="block text-2xl font-bold">{count(t.value)}</span>
            <span className="text-xs">{t.label}</span>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

export function AdminContractsPanel({
  contracts,
  profileMap,
  initialView = "pending_customer",
}: {
  contracts: PanelContract[];
  profileMap: Record<string, { full_name: string; phone?: string | null } | undefined>;
  /** Tab to open first (the overview tiles link straight to a stage). */
  initialView?: ContractPanelView;
}) {
  const [view, setView] = useState<View>(initialView);
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const [openId, setOpenId] = useState<string | null>(null);
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

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of contracts) m[viewOf(c.status)] = (m[viewOf(c.status)] ?? 0) + 1;
    return m;
  }, [contracts]);

  const q = search.trim().toLowerCase();
  const matches = (code: string | undefined, contractNo?: string, userId?: string) =>
    !q ||
    (code ?? "").toLowerCase().includes(q) ||
    (contractNo ?? "").toLowerCase().includes(q) ||
    (profileMap[userId ?? ""]?.full_name ?? "").toLowerCase().includes(q);

  const holdLabel = (b: PanelBooking | null) => {
    if (!b || b.status !== "pending") return "-";
    const s = holdSecondsLeft(b, now);
    return s === 0 ? "หมดเวลา" : formatCountdown(s);
  };

  const listed = contracts.filter(
    (c) => viewOf(c.status) === view && matches(c.bookings?.booking_code, c.contract_no, c.user_id),
  );
  const views = VIEWS.filter((v) => v.value !== "legacy" || (counts["legacy"] ?? 0) > 0);

  return (
    <Card className="border shadow-card">
      <CardHeader>
        <CardTitle className="text-xl">สัญญาเช่าดิจิทัล</CardTitle>
        <CardDescription>
          ลูกค้าจองรถ → ระบบสร้างสัญญาให้ทันที → ลูกค้ายอมรับสัญญา → ลูกค้าชำระเงิน (DEMO) ภายใน 15
          นาที · ผู้ดูแลดูสัญญาได้อย่างเดียว ไม่ต้องอนุมัติ
        </CardDescription>
        <Tabs value={view} onValueChange={(v) => setView(v as View)} className="mt-3">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4 [&>button]:whitespace-normal">
            {views.map((v) => (
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
      </CardContent>

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
        </DialogContent>
      </Dialog>
    </Card>
  );
}
