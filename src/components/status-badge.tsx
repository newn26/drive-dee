import { cn } from "@/lib/utils";
import { bookingStatusLabel, carStatusLabel, maintStatusLabel } from "@/lib/format";
import { contractStatusLabel } from "@/lib/contract-workflow";

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
  // contracts
  draft: "bg-muted text-muted-foreground",
  pending_customer: "bg-warning/20 text-warning-foreground",
  pending_admin_review: "bg-amber-100 text-amber-900",
  revision_requested: "bg-orange-100 text-orange-900",
  approved: "bg-primary/10 text-primary",
  paid: "bg-success/15 text-success",
};

const LABELS: Record<"booking" | "car" | "maint" | "contract", Record<string, string>> = {
  booking: bookingStatusLabel,
  car: carStatusLabel,
  maint: maintStatusLabel,
  contract: contractStatusLabel,
};

export function StatusBadge({
  status,
  kind = "booking",
  label: labelOverride,
}: {
  status: string;
  kind?: "booking" | "car" | "maint" | "contract";
  /** Optional text instead of the standard label (e.g. the customer's wording). */
  label?: string;
}) {
  const label = labelOverride ?? LABELS[kind][status] ?? status;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", tone[status] ?? "bg-muted")}>
      {label}
    </span>
  );
}
