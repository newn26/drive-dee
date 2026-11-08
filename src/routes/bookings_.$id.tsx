import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/bookings_/$id")({
  component: () => <div className="mx-auto max-w-3xl px-4 py-20 text-center text-muted-foreground">สร้างการจองแล้ว — หน้าชำระเงินยังอยู่ระหว่างการพัฒนา</div>,
});
