import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Search, Star, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { adminReviewsQuery, deleteReviewAsAdmin, type AdminReview } from "@/lib/admin-reviews";
import { fmtDateTime } from "@/lib/format";

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex" aria-label={`${rating} ดาว`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${i < rating ? "fill-accent text-accent" : "text-border"}`}
        />
      ))}
    </span>
  );
}

/** Admin tab: list customer reviews and remove inappropriate ones after confirmation. */
export function AdminReviewsPanel({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const {
    data: reviews = [],
    isLoading,
    isError,
  } = useQuery({ ...adminReviewsQuery(), enabled: isAdmin });

  const [search, setSearch] = useState("");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [toDelete, setToDelete] = useState<AdminReview | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reviews.filter((r) => {
      const matchRating = ratingFilter === "all" || r.rating === Number(ratingFilter);
      const text = `${r.reviewer_name} ${r.comment ?? ""} ${r.cars?.brand ?? ""} ${r.cars?.model ?? ""} ${r.bookings?.booking_code ?? ""}`;
      return matchRating && (!q || text.toLowerCase().includes(q));
    });
  }, [reviews, search, ratingFilter]);

  if (!isAdmin) return null;

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    const result = await deleteReviewAsAdmin(toDelete.id);
    setDeleting(false);
    if (!result.ok) {
      toast.error(result.message);
      if (result.reason === "not_found")
        void queryClient.invalidateQueries({ queryKey: ["admin-reviews"] });
      return;
    }
    toast.success("ลบรีวิวเรียบร้อยแล้ว");
    const carId = toDelete.car_id;
    setToDelete(null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-reviews"] }),
      queryClient.invalidateQueries({ queryKey: ["ratings"] }),
      queryClient.invalidateQueries({ queryKey: ["reviews", carId] }),
      queryClient.invalidateQueries({ queryKey: ["customer-bookings"] }),
    ]);
  };

  return (
    <Card className="shadow-card border">
      <CardHeader>
        <CardTitle className="text-xl">รีวิวจากลูกค้า ({filtered.length} รายการ)</CardTitle>
        <CardDescription>ตรวจสอบและลบรีวิวที่ไม่เหมาะสม การลบไม่สามารถย้อนกลับได้</CardDescription>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="relative sm:col-span-2">
            <Input
              placeholder="ค้นหาชื่อผู้รีวิว ข้อความ รถยนต์ หรือรหัสการจอง..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          </div>
          <Select value={ratingFilter} onValueChange={setRatingFilter}>
            <SelectTrigger aria-label="กรองตามคะแนน">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทุกคะแนน</SelectItem>
              {[5, 4, 3, 2, 1].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} ดาว
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
              <TableHead>ผู้รีวิว</TableHead>
              <TableHead>รถยนต์</TableHead>
              <TableHead>คะแนน</TableHead>
              <TableHead>ความคิดเห็น</TableHead>
              <TableHead>วันที่</TableHead>
              <TableHead className="text-right">จัดการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs">
                  <span className="block font-medium">{r.reviewer_name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {r.bookings?.booking_code ?? "-"}
                  </span>
                </TableCell>
                <TableCell className="text-xs">
                  {r.cars ? `${r.cars.brand} ${r.cars.model}` : "-"}
                  {r.cars && (
                    <span className="block font-mono text-[11px] text-muted-foreground">
                      {r.cars.plate_no}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Stars rating={r.rating} />
                </TableCell>
                <TableCell className="max-w-xs whitespace-pre-wrap break-words text-xs">
                  {r.comment || "-"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {fmtDateTime(r.created_at)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setToDelete(r)}
                    aria-label={`ลบรีวิวของ ${r.reviewer_name}`}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> ลบ
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  {isLoading
                    ? "กำลังโหลดรีวิว..."
                    : isError
                      ? "ไม่สามารถโหลดรีวิวได้"
                      : "ไม่พบรีวิว"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={!!toDelete} onOpenChange={(open) => !open && !deleting && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" /> ยืนยันการลบรีวิว
            </DialogTitle>
            <DialogDescription>
              ต้องการลบรีวิวของ{" "}
              <strong className="text-foreground">{toDelete?.reviewer_name}</strong> สำหรับ{" "}
              {toDelete?.cars ? `${toDelete.cars.brand} ${toDelete.cars.model}` : "รถคันนี้"}{" "}
              ใช่หรือไม่? การลบไม่สามารถย้อนกลับได้ และคะแนนเฉลี่ยของรถจะถูกคำนวณใหม่
            </DialogDescription>
          </DialogHeader>
          {toDelete && (
            <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
              <Stars rating={toDelete.rating} />
              <p className="whitespace-pre-wrap break-words">{toDelete.comment || "-"}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={deleting} onClick={() => setToDelete(null)}>
              ยกเลิก
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={confirmDelete}>
              {deleting ? "กำลังลบ..." : "ยืนยันการลบรีวิว"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
