import { useState } from "react";
import { CheckCircle2, Clock, History, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { fmtDateTime, thb } from "@/lib/format";
import { actorRoleLabel, contractEventLabel, customerContractLabel } from "@/lib/contract-workflow";
import { rentalCharges } from "@/lib/booking-fee";
import type { ContractEventRow, ContractRow, ContractVersionRow } from "@/lib/contract-api";

const bkkDateTime = (iso: string | null) => (iso ? fmtDateTime(iso) : "-");

/** Structured summary of one version (legacy versions only have their original text). */
export function ContractSummary({ v }: { v: ContractVersionRow }) {
  if (v.is_legacy) {
    return (
      <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        สัญญาฉบับเดิม (ก่อนระบบอนุมัติสัญญา) — แสดงตามข้อความต้นฉบับด้านล่าง
      </p>
    );
  }
  const rows: [string, string][] = [
    ["ผู้เช่า", `${v.customer_name ?? "-"}${v.customer_phone ? ` · โทร ${v.customer_phone}` : ""}`],
    ...(v.customer_license_no
      ? ([["เลขที่ใบอนุญาตขับขี่", v.customer_license_no]] as [string, string][])
      : []),
    ["รถยนต์", `${v.car_label ?? "-"} · ทะเบียน ${v.car_plate_no ?? "-"}`],
    ["สถานที่รับรถ", v.pickup_location ?? "-"],
    ["รับรถ", bkkDateTime(v.pickup_at)],
    ["คืนรถ", `${bkkDateTime(v.return_at)}${v.rental_days ? ` (${v.rental_days} วัน)` : ""}`],
    ...moneyRows(v),
    ["ข้อกำหนดระยะทาง", v.mileage_allowance ?? "-"],
    ["ค่าปรับส่งคืนรถล่าช้า", v.late_penalty ?? "-"],
  ];
  return (
    <dl className="grid gap-x-4 gap-y-2 rounded-lg border bg-card p-3 text-sm sm:grid-cols-[max-content_1fr]">
      {rows.map(([k, val]) => (
        <div key={k} className="contents">
          <dt className="text-xs text-muted-foreground sm:text-sm">{k}</dt>
          <dd className="font-medium text-foreground">{val}</dd>
        </div>
      ))}
      {v.additional_conditions.trim() && (
        <div className="contents">
          <dt className="text-xs text-muted-foreground sm:text-sm">เงื่อนไขเพิ่มเติม</dt>
          <dd className="whitespace-pre-wrap font-medium text-foreground">
            {v.additional_conditions}
          </dd>
        </div>
      )}
    </dl>
  );
}

/**
 * Money rows. Versions written after the booking-fee migration (0007) say so in their terms
 * ("ค่าจอง"): 1,000 THB online, rent + deposit − fee at pickup. Older versions were paid in
 * full online, so they keep the wording they were signed with.
 */
function moneyRows(v: ContractVersionRow): [string, string][] {
  const rent = Number(v.rental_price ?? 0);
  if (!v.terms.includes("ค่าจอง")) {
    return [
      ["ค่าเช่ารวม (ชำระออนไลน์)", thb(rent)],
      ["เงินประกันความเสียหาย", `${thb(v.deposit)} — ชำระ ณ วันรับรถ ไม่รวมในการชำระเงินออนไลน์`],
    ];
  }
  const c = rentalCharges(rent);
  const deposit = Number(v.deposit ?? c.insurance);
  return [
    ["ค่าเช่ารวม", `${thb(rent)} — ชำระ ณ วันรับรถ`],
    ["เงินประกันความเสียหาย", `${thb(deposit)} — ชำระ ณ วันรับรถ ได้คืนเมื่อคืนรถตามสภาพเดิม`],
    ["ค่าจอง (ชำระออนไลน์)", `${thb(c.fee)} — หลังยืนยันสัญญา ไม่คืนเมื่อยกเลิก`],
    [
      "ยอดชำระ ณ วันรับรถ",
      `${thb(Math.max(rent + deposit - c.fee, 0))} (ค่าเช่า + เงินประกัน − ค่าจอง)`,
    ],
  ];
}

/** Sent / accepted / approved / superseded stamps of a version. */
export function VersionStamps({ v }: { v: ContractVersionRow }) {
  const stamps: [string, string | null][] = [
    ["ส่งให้ลูกค้า", v.sent_at],
    ["ลูกค้ายอมรับ", v.accepted_at],
    ["ผู้ดูแลอนุมัติ", v.approved_at],
    ["ถูกแทนที่ด้วยฉบับใหม่", v.superseded_at],
  ];
  return (
    <ul className="flex flex-wrap gap-2 text-xs">
      {stamps
        .filter(([, at]) => at)
        .map(([label, at]) => (
          <li
            key={label}
            className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5"
          >
            <CheckCircle2 className="h-3 w-3 text-success" />
            {label} {fmtDateTime(at)}
          </li>
        ))}
    </ul>
  );
}

export function ContractTimeline({ events }: { events: ContractEventRow[] }) {
  if (events.length === 0) return null;
  return (
    <ol className="space-y-2 border-l pl-4 text-xs" aria-label="ประวัติสัญญา">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span
            className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-primary"
            aria-hidden
          />
          <span className="font-medium text-foreground">
            {contractEventLabel[e.action] ?? e.action}
          </span>
          {e.version !== null && (
            <span className="text-muted-foreground"> · ฉบับที่ {e.version}</span>
          )}
          <span className="text-muted-foreground">
            {" "}
            · {actorRoleLabel[e.actor_role] ?? e.actor_role}
          </span>
          <span className="text-muted-foreground"> · {fmtDateTime(e.created_at)}</span>
          {e.note && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}

/**
 * A contract with its current version, older versions and history.
 * `audience` only changes wording; what the viewer may see is decided by RLS.
 */
export function ContractView({
  contract,
  versions,
  events,
  audience,
  printable = true,
}: {
  contract: ContractRow;
  versions: ContractVersionRow[];
  events: ContractEventRow[];
  audience: "customer" | "admin";
  printable?: boolean;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  // Customers only ever receive sent versions; show the newest of those.
  const current = sorted[0];
  const older = sorted.slice(1);
  const label =
    audience === "customer"
      ? customerContractLabel(contract.status, contract.sent_version !== null)
      : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          {/* div, not p: Badge renders a <div>, which is invalid inside <p> (hydration error) */}
          <div className="text-sm text-muted-foreground">
            เลขที่สัญญา{" "}
            <span className="font-mono font-semibold text-foreground">{contract.contract_no}</span>
            {current && (
              <Badge variant="outline" className="ml-2 align-middle">
                ฉบับที่ {current.version}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {label ? (
              <StatusBadge status={contract.status} kind="contract" label={label} />
            ) : (
              <StatusBadge status={contract.status} kind="contract" />
            )}
            <span className="text-xs text-muted-foreground">
              อัปเดตล่าสุด {fmtDateTime(contract.updated_at)}
            </span>
          </div>
        </div>
        {printable && current && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="print:hidden"
          >
            <Printer className="mr-1.5 h-4 w-4" /> พิมพ์สัญญา
          </Button>
        )}
      </div>

      {contract.revision_reason && contract.status === "revision_requested" && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900">
          <p className="font-semibold">
            {contract.revision_requested_by === "customer"
              ? "ลูกค้าขอแก้ไขสัญญา"
              : "ผู้ดูแลขอแก้ไขสัญญา"}
          </p>
          <p className="whitespace-pre-wrap">{contract.revision_reason}</p>
        </div>
      )}

      {current ? (
        <>
          <ContractSummary v={current} />
          <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl border bg-muted/40 p-4 font-mono text-xs leading-relaxed print:max-h-none print:overflow-visible print:bg-transparent">
            {current.terms}
          </div>
          <VersionStamps v={current} />
        </>
      ) : (
        <p className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" /> ยังไม่มีสัญญาฉบับที่ส่งให้ลูกค้า
        </p>
      )}

      {(older.length > 0 || events.length > 0) && (
        <div className="print:hidden">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setShowHistory((s) => !s)}
          >
            <History className="mr-1 h-3.5 w-3.5" />
            {showHistory ? "ซ่อนประวัติสัญญา" : `ดูประวัติสัญญา (${older.length} ฉบับก่อนหน้า)`}
          </Button>
          {showHistory && (
            <div className="mt-3 space-y-4">
              <ContractTimeline events={events} />
              {older.map((v) => (
                <details key={v.id} className="rounded-lg border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    ฉบับที่ {v.version} {v.superseded_at ? "(ถูกแทนที่แล้ว)" : ""}
                  </summary>
                  <div className="mt-3 space-y-3">
                    <ContractSummary v={v} />
                    <div className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 font-mono text-xs">
                      {v.terms}
                    </div>
                    <VersionStamps v={v} />
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
