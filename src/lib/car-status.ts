import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { todayBkk } from "@/lib/format";

type CarStatus = Tables<"cars">["status"];
type MaintLike = Pick<Tables<"maintenance">, "status" | "scheduled_date">;

/**
 * The status a car should have, from its maintenance jobs and bookings:
 * - "unavailable" is a manual admin setting and is never changed automatically
 * - maintenance in progress, or scheduled for today or earlier → "maintenance"
 * - an active (picked-up) booking → "rented"
 * - otherwise → "available"
 */
export function computeCarStatus(
  current: CarStatus,
  maintenance: MaintLike[],
  hasActiveBooking: boolean,
  today: string = todayBkk(),
): CarStatus {
  if (current === "unavailable") return "unavailable";
  const inMaintenance = maintenance.some(
    (m) => m.status === "in_progress" || (m.status === "scheduled" && m.scheduled_date <= today),
  );
  if (inMaintenance) return "maintenance";
  if (hasActiveBooking) return "rented";
  return "available";
}

/** Recalculates one car's status from the database and saves it if it changed (admin only). */
export async function syncCarStatus(carId: string): Promise<void> {
  const [carRes, maintRes, activeRes] = await Promise.all([
    supabase.from("cars").select("status").eq("id", carId).maybeSingle(),
    supabase
      .from("maintenance")
      .select("status, scheduled_date")
      .eq("car_id", carId)
      .neq("status", "completed"),
    supabase.from("bookings").select("id").eq("car_id", carId).eq("status", "active").limit(1),
  ]);
  if (carRes.error) throw carRes.error;
  if (maintRes.error) throw maintRes.error;
  if (activeRes.error) throw activeRes.error;
  if (!carRes.data) return;

  const next = computeCarStatus(
    carRes.data.status,
    maintRes.data ?? [],
    (activeRes.data ?? []).length > 0,
  );
  if (next === carRes.data.status) return;

  const { error } = await supabase.from("cars").update({ status: next }).eq("id", carId);
  if (error) throw error;
}
