import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate } from "@/lib/format";
import { overdueHandovers, overdueReturns, type FleetBooking } from "@/lib/fleet";

export type OverdueBooking = FleetBooking & {
  booking_code: string;
  cars: { brand: string; model: string; plate_no: string } | null;
};

/**
 * Bookings that need an admin today: the pickup day has come but the car was not handed over,
 * or the return day has passed but the car was not taken back.
 */
export function OverdueBookingsCard<B extends OverdueBooking>({
  bookings,
  today,
  customerName,
  onUpdate,
  canUpdate,
}: {
  bookings: B[];
  today: string;
  customerName: (b: B) => string;
  onUpdate: (b: B) => void;
  canUpdate: boolean;
}) {
  const handovers = overdueHandovers(bookings, today);
  const returns = overdueReturns(bookings, today);
  const total = handovers.length + returns.length;

  const row = (b: B, note: string) => (
    <li
      key={b.id}
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-2.5 text-xs"
    >
      <div className="min-w-0">
        <span className="font-mono font-semibold">{b.booking_code}</span>
        <span className="text-muted-foreground">
          {" "}
          · {customerName(b)} · {b.cars?.brand} {b.cars?.model} ({b.cars?.plate_no})
        </span>
        <p className="text-amber-800">{note}</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        disabled={!canUpdate}
        onClick={() => onUpdate(b)}
      >
        เปลี่ยนสถานะ
      </Button>
    </li>
  );

  return (
    <Card
      className={`border shadow-card ${total > 0 ? "border-amber-400" : ""}`}
      data-testid="overdue-bookings"
    >
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          {total > 0 ? (
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-success" />
          )}
          <CardTitle className="text-base">ต้องดำเนินการวันนี้ ({total})</CardTitle>
        </div>
        <CardDescription>
          การจองที่ถึงวันรับรถแล้วแต่ยังไม่ได้บันทึกส่งมอบ หรือเลยวันคืนรถแล้วแต่ยังไม่ได้รับคืน
          (สถานะรถและรายได้ ณ วันรับรถจะถูกต้องเมื่อบันทึกแล้ว)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {total === 0 && <p className="text-sm text-muted-foreground">ไม่มีรายการค้าง</p>}
        {handovers.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold">
              ถึงวันรับรถแล้ว ยังไม่ส่งมอบ ({handovers.length})
            </p>
            <ul className="space-y-1.5">
              {handovers.map((b) =>
                row(
                  b,
                  b.end_date < today
                    ? `ช่วงเช่า ${fmtDate(b.start_date)} — ${fmtDate(b.end_date)} สิ้นสุดแล้ว: บันทึกว่าเสร็จสิ้น หรือยกเลิก`
                    : `รับรถ ${fmtDate(b.start_date)}: บันทึก "กำลังเช่า" เมื่อส่งมอบรถ หรือยกเลิกถ้าลูกค้าไม่มารับ`,
                ),
              )}
            </ul>
          </div>
        )}
        {returns.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold">
              เลยวันคืนรถแล้ว ยังไม่รับคืน ({returns.length})
            </p>
            <ul className="space-y-1.5">
              {returns.map((b) =>
                row(b, `กำหนดคืน ${fmtDate(b.end_date)}: บันทึก "เสร็จสิ้น" เมื่อรับรถคืน`),
              )}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
