import { cn } from "@/lib/utils";
import { bookingStatusLabel, carStatusLabel, maintStatusLabel } from "@/lib/format";

const tone: Record<string, string> = {
  pending: "bg-warning/20 text-warning-foreground",
  scheduled: "bg-warning/20 text-warning-foreground",
  confirmed: "bg-primary/10 text-primary",
  in_progress: "bg-primary/10 text-primary",
  active: "bg-primary/10 text-primary",
  rented: "bg-primary/10 text-primary",
  completed: "bg-success/15 text-success",
  available: "bg-success/15 text-success",
  cancelled: "bg-destructive/10 text-destructive",
  unavailable: "bg-destructive/10 text-destructive",
  maintenance: "bg-warning/20 text-warning-foreground",
};

export function StatusBadge({ status, kind = "booking" }: { status: string; kind?: "booking" | "car" | "maint" }) {
  const label = (kind === "car" ? carStatusLabel : kind === "maint" ? maintStatusLabel : bookingStatusLabel)[status] ?? status;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", tone[status] ?? "bg-muted")}>
      {label}
    </span>
  );
}
