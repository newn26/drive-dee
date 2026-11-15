import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CarCard } from "@/components/car-card";
import { Button } from "@/components/ui/button";
import { bookedCarIdsQuery, carsQuery } from "@/lib/queries";
import { categoryLabel, todayBkk } from "@/lib/format";
import { filterCarsForSearch, type Availability } from "@/lib/availability";
import { rentalDateError } from "@/lib/date-range";
import { LoadError } from "@/components/load-error";
import { tr } from "@/lib/i18n";

type S = { q?: string | undefined; category?: string | undefined; start?: string | undefined; end?: string | undefined; sort?: string | undefined };

export const Route = createFileRoute("/cars")({
  validateSearch: (s: Record<string, unknown>): S => ({
    q: typeof s["q"] === "string" ? s["q"] : undefined,
    category: typeof s["category"] === "string" ? s["category"] : undefined,
    start: typeof s["start"] === "string" ? s["start"] : undefined,
    end: typeof s["end"] === "string" ? s["end"] : undefined,
    sort: typeof s["sort"] === "string" ? s["sort"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "ค้นหารถเช่า — Drive Dee" },
      { name: "description", content: "ค้นหารถเช่าว่างตามวันที่ ประเภท และราคา" },
      { property: "og:title", content: "ค้นหารถเช่า — Drive Dee" },
      { property: "og:description", content: "ค้นหารถเช่าว่างตามวันที่ ประเภท และราคา" },
    ],
  }),
  component: CarsPage,
});

function CarsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/cars" });
  const set = (patch: Partial<S>) => navigate({ search: (p: S) => ({ ...p, ...patch }), replace: true });
  const carsQ = useQuery(carsQuery());
  const cars = useMemo(() => carsQ.data ?? [], [carsQ.data]);
  const hasDates = !!search.start && !!search.end;
  const dateError = hasDates ? rentalDateError(search.start!, search.end!, todayBkk()) : null;
  const datesValid = hasDates && !dateError;
  const bookedQ = useQuery({
    ...bookedCarIdsQuery(search.start ?? "", search.end ?? ""),
    enabled: datesValid,
  });
  // Only trust availability that was fetched for exactly these dates and is not being refreshed
  const availability = useMemo((): Availability => {
    if (!datesValid) return { kind: "none" };
    if (bookedQ.isError) return { kind: "error" };
    if (bookedQ.isFetching || !bookedQ.data) return { kind: "loading" };
    return { kind: "ready", bookedIds: bookedQ.data };
  }, [datesValid, bookedQ.isError, bookedQ.isFetching, bookedQ.data]);

  const list = useMemo(() => filterCarsForSearch(cars, search, availability), [cars, search, availability]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="mb-6 text-3xl font-semibold">{tr("ค้นหารถเช่า", "Search rental cars")}</h1>
      <div className="mb-8 grid gap-3 rounded-2xl border bg-card p-4 shadow-card md:grid-cols-5">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder={tr("ค้นหายี่ห้อหรือรุ่น", "Search brand or model")} value={search.q ?? ""} onChange={(e) => set({ q: e.target.value || undefined })} />
        </div>
        <Select value={search.category ?? "all"} onValueChange={(v) => set({ category: v })}>
          <SelectTrigger><SelectValue placeholder={tr("ประเภท", "Category")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tr("ทุกประเภท", "All categories")}</SelectItem>
            {Object.entries(categoryLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" min={todayBkk()} value={search.start ?? ""} onChange={(e) => set({ start: e.target.value || undefined })} aria-label={tr("วันรับรถ", "Pickup date")} />
        <Input type="date" min={search.start ?? todayBkk()} value={search.end ?? ""} onChange={(e) => set({ end: e.target.value || undefined })} aria-label={tr("วันคืนรถ", "Return date")} />
      </div>
      {dateError && (
        <p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm" role="alert">
          {dateError}
        </p>
      )}
      {availability.kind === "error" && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
          <span>{tr("ไม่สามารถตรวจสอบรถว่างในช่วงวันที่เลือกได้ กรุณาลองใหม่อีกครั้ง", "Could not check availability for the selected dates. Please try again.")}</span>
          <Button size="sm" variant="outline" onClick={() => bookedQ.refetch()}>
            {tr("ลองใหม่", "Try again")}
          </Button>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span role="status">
          {carsQ.isLoading
            ? tr("กำลังโหลดรายการรถ...", "Loading cars...")
            : availability.kind === "loading"
            ? tr("กำลังตรวจสอบรถว่าง...", "Checking availability...")
            : availability.kind === "error"
              ? tr("ไม่สามารถแสดงผลรถว่างได้", "Could not show available cars")
              : tr(
                  `พบ ${list.length} คัน${availability.kind === "ready" ? " ที่ว่างในช่วงวันที่เลือก" : ""}`,
                  `${list.length} cars found${availability.kind === "ready" ? " available for the selected dates" : ""}`,
                )}
        </span>
        <Select value={search.sort ?? "asc"} onValueChange={(v) => set({ sort: v })}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="asc">{tr("ราคาต่ำ → สูง", "Price: low to high")}</SelectItem>
            <SelectItem value="desc">{tr("ราคาสูง → ต่ำ", "Price: high to low")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {carsQ.isError ? (
        <LoadError title={tr("โหลดรายการรถไม่สำเร็จ", "Could not load the cars")} onRetry={() => void carsQ.refetch()} />
      ) : !carsQ.isLoading && availability.kind !== "loading" && availability.kind !== "error" && list.length === 0 ? (
        <div className="rounded-2xl border bg-card px-4 py-14 text-center">
          <p className="font-medium">{tr("ไม่พบรถที่ตรงกับเงื่อนไข", "No cars match your filters")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{tr("ลองเปลี่ยนคำค้นหา ประเภทรถ หรือช่วงวันที่", "Try another search, category or date range")}</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate({ search: {}, replace: true })}>
            {tr("ล้างตัวกรองทั้งหมด", "Clear all filters")}
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((c) => <CarCard key={c.id} car={c} />)}
        </div>
      )}
    </div>
  );
}
