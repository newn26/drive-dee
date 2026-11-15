import { useState } from "react";
import { CheckCircle2, Clock, History, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { fmtDateTime, pickupLocationLabel, thb } from "@/lib/format";
import { actorRoleLabel, contractEventLabel, customerContractLabel } from "@/lib/contract-workflow";
import { rentalCharges } from "@/lib/booking-fee";
import type { ContractEventRow, ContractRow, ContractVersionRow } from "@/lib/contract-api";
import { tr } from "@/lib/i18n";

const bkkDateTime = (iso: string | null) => (iso ? fmtDateTime(iso) : "-");

/** Structured summary of one version (legacy versions only have their original text). */
export function ContractSummary({ v }: { v: ContractVersionRow }) {
  if (v.is_legacy) {
    return (
      <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        {tr("สัญญาฉบับเดิม (ก่อนระบบอนุมัติสัญญา) — แสดงตามข้อความต้นฉบับด้านล่าง", "Legacy contract (before the approval workflow), shown in its original text below")}
      </p>
    );
  }
  const rows: [string, string][] = [
    [tr("ผู้เช่า", "Renter"), `${v.customer_name ?? "-"}${v.customer_phone ? ` · โทร ${v.customer_phone}` : ""}`],
    ...(v.customer_license_no
      ? ([[tr("เลขที่ใบอนุญาตขับขี่", "Driving licence no."), v.customer_license_no]] as [string, string][])
      : []),
    [tr("รถยนต์", "Car"), `${v.car_label ?? "-"} · ${tr("ทะเบียน", "Plate")} ${v.car_plate_no ?? "-"}`],
    [tr("สถานที่รับรถ", "Pickup location"), pickupLocationLabel(v.pickup_location)],
    [tr("รับรถ", "Pickup"), bkkDateTime(v.pickup_at)],
    [tr("คืนรถ", "Return"), `${bkkDateTime(v.return_at)}${v.rental_days ? ` (${v.rental_days} วัน)` : ""}`],
    ...moneyRows(v),
    [tr("ข้อกำหนดระยะทาง", "Mileage"), v.mileage_allowance ?? "-"],
    [tr("ค่าปรับส่งคืนรถล่าช้า", "Late return penalty"), v.late_penalty ?? "-"],
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
          <dt className="text-xs text-muted-foreground sm:text-sm">{tr("เงื่อนไขเพิ่มเติม", "Additional conditions")}</dt>
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
 * (tr("ค่าจอง", "Booking fee")): 1,000 THB online, rent + deposit − fee at pickup. Older versions were paid in
 * full online, so they keep the wording they were signed with.
 */
function moneyRows(v: ContractVersionRow): [string, string][] {
  const rent = Number(v.rental_price ?? 0);
  // Contract text is always Thai: contracts from before the booking fee do not mention it
  if (!v.terms.includes("ค่าจอง")) {
    return [
      [tr("ค่าเช่ารวม (ชำระออนไลน์)", "Total rent (paid online)"), thb(rent)],
      [tr("เงินประกันความเสียหาย", "Damage deposit"), `${thb(v.deposit)} — ${tr("ชำระ ณ วันรับรถ ไม่รวมในการชำระเงินออนไลน์", "paid on the pickup day, not included in the online payment")}`],
    ];
  }
  const c = rentalCharges(rent);
  const deposit = Number(v.deposit ?? c.insurance);
  return [
    [tr("ค่าเช่ารวม", "Total rent"), `${thb(rent)} — ${tr("ชำระ ณ วันรับรถ", "paid on the pickup day")}`],
    [tr("เงินประกันความเสียหาย", "Damage deposit"), `${thb(deposit)} — ${tr("ชำระ ณ วันรับรถ ได้คืนเมื่อคืนรถตามสภาพเดิม", "paid on the pickup day, returned when the car comes back in its original condition")}`],
    [tr("ค่าจอง (ชำระออนไลน์)", "Booking fee (paid online)"), `${thb(c.fee)} — ${tr("หลังยืนยันสัญญา ไม่คืนเมื่อยกเลิก", "after you confirm the contract, non-refundable")}`],
    [
      tr("ยอดชำระ ณ วันรับรถ", "Due on the pickup day"),
      `${thb(Math.max(rent + deposit - c.fee, 0))} ${tr("(ค่าเช่า + เงินประกัน − ค่าจอง)", "(rent + deposit − booking fee)")}`,
    ],
  ];
}

/** Sent / accepted / approved / superseded stamps of a version. */
export function VersionStamps({ v }: { v: ContractVersionRow }) {
  const stamps: [string, string | null][] = [
    [tr("ส่งให้ลูกค้า", "Sent to customer"), v.sent_at],
    [tr("ลูกค้ายอมรับ", "Customer confirmed"), v.accepted_at],
    [tr("ผู้ดูแลอนุมัติ", "Staff approved"), v.approved_at],
    [tr("ถูกแทนที่ด้วยฉบับใหม่", "Replaced by a newer version"), v.superseded_at],
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
    <ol className="space-y-2 border-l pl-4 text-xs" aria-label={tr("ประวัติสัญญา", "Contract history")}>
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
            <span className="text-muted-foreground"> {tr("· ฉบับที่", "· Version")} {e.version}</span>
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
            {tr("เลขที่สัญญา", "Contract no.")}{" "}
            <span className="font-mono font-semibold text-foreground">{contract.contract_no}</span>
            {current && (
              <Badge variant="outline" className="ml-2 align-middle">
                {tr("ฉบับที่", "Version")} {current.version}
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
              {tr("อัปเดตล่าสุด", "Last updated")} {fmtDateTime(contract.updated_at)}
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
            <Printer className="mr-1.5 h-4 w-4" /> {tr("พิมพ์สัญญา", "Print contract")}
          </Button>
        )}
      </div>

      {contract.revision_reason && contract.status === "revision_requested" && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900">
          <p className="font-semibold">
            {contract.revision_requested_by === "customer"
              ? tr("ลูกค้าขอแก้ไขสัญญา", "Customer requested changes")
              : tr("ผู้ดูแลขอแก้ไขสัญญา", "Staff requested changes")}
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
          <Clock className="h-4 w-4" /> {tr("ยังไม่มีสัญญาฉบับที่ส่งให้ลูกค้า", "No contract version has been sent yet")}
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
            {showHistory ? tr("ซ่อนประวัติสัญญา", "Hide contract history") : tr(`ดูประวัติสัญญา (${older.length} ฉบับก่อนหน้า)`, `Show contract history (${older.length} earlier versions)`)}
          </Button>
          {showHistory && (
            <div className="mt-3 space-y-4">
              <ContractTimeline events={events} />
              {older.map((v) => (
                <details key={v.id} className="rounded-lg border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {tr("ฉบับที่", "Version")} {v.version} {v.superseded_at ? tr("(ถูกแทนที่แล้ว)", "(replaced)") : ""}
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
