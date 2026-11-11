import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CarCard } from "@/components/car-card";
import { Button } from "@/components/ui/button";
import { bookedCarIdsQuery, carsQuery, ratingsQuery } from "@/lib/queries";
import { categoryLabel, todayBkk } from "@/lib/format";
import { filterCarsForSearch, type Availability } from "@/lib/availability";

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
      { title: "ค้นหารถเช่า — ไดร์ฟดี รถเช่า" },
      { name: "description", content: "ค้นหารถเช่าว่างตามวันที่ ประเภท และราคา" },
      { property: "og:title", content: "ค้นหารถเช่า — ไดร์ฟดี" },
      { property: "og:description", content: "ค้นหารถเช่าว่างตามวันที่ ประเภท และราคา" },
    ],
  }),
  component: CarsPage,
});

function CarsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/cars" });
  const set = (patch: Partial<S>) => navigate({ search: (p: S) => ({ ...p, ...patch }), replace: true });
  const { data: cars = [] } = useQuery(carsQuery());
  const { data: ratings } = useQuery(ratingsQuery());
  const hasDates = !!search.start && !!search.end;
  const datesValid = hasDates && search.end! >= search.start!;
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
      <h1 className="mb-6 text-3xl font-semibold">ค้นหารถเช่า</h1>
      <div className="mb-8 grid gap-3 rounded-2xl border bg-card p-4 shadow-card md:grid-cols-5">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="ค้นหายี่ห้อหรือรุ่น" value={search.q ?? ""} onChange={(e) => set({ q: e.target.value || undefined })} />
        </div>
        <Select value={search.category ?? "all"} onValueChange={(v) => set({ category: v })}>
          <SelectTrigger><SelectValue placeholder="ประเภท" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกประเภท</SelectItem>
            {Object.entries(categoryLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" min={todayBkk()} value={search.start ?? ""} onChange={(e) => set({ start: e.target.value || undefined })} aria-label="วันรับรถ" />
        <Input type="date" min={search.start ?? todayBkk()} value={search.end ?? ""} onChange={(e) => set({ end: e.target.value || undefined })} aria-label="วันคืนรถ" />
      </div>
      {hasDates && !datesValid && (
        <p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm" role="alert">
          วันคืนรถต้องไม่ก่อนวันรับรถ
        </p>
      )}
      {availability.kind === "error" && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
          <span>ไม่สามารถตรวจสอบรถว่างในช่วงวันที่เลือกได้ กรุณาลองใหม่อีกครั้ง</span>
          <Button size="sm" variant="outline" onClick={() => bookedQ.refetch()}>
            ลองใหม่
          </Button>
        </div>
      )}
      <div className="mb-4 flex items-center justify-between text-sm text-muted-foreground">
        <span role="status">
          {availability.kind === "loading"
            ? "กำลังตรวจสอบรถว่าง..."
            : availability.kind === "error"
              ? "ไม่สามารถแสดงผลรถว่างได้"
              : `พบ ${list.length} คัน${availability.kind === "ready" ? " ที่ว่างในช่วงวันที่เลือก" : ""}`}
        </span>
        <Select value={search.sort ?? "asc"} onValueChange={(v) => set({ sort: v })}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="asc">ราคาต่ำ → สูง</SelectItem>
            <SelectItem value="desc">ราคาสูง → ต่ำ</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {list.map((c) => <CarCard key={c.id} car={c} rating={ratings?.[c.id]} />)}
      </div>
    </div>
  );
}
