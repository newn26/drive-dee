import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type AdminReview = Tables<"reviews"> & {
  cars: Pick<Tables<"cars">, "brand" | "model" | "plate_no"> | null;
  bookings: Pick<Tables<"bookings">, "booking_code"> | null;
};

export const adminReviewsQuery = () =>
  queryOptions({
    queryKey: ["admin-reviews"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reviews")
        .select("*, cars(brand, model, plate_no), bookings(booking_code)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as AdminReview[];
    },
  });

export type DeleteReviewResult =
  | { ok: true }
  | { ok: false; reason: "not_signed_in" | "not_admin" | "not_found" | "error"; message: string };

/**
 * Delete a review as an administrator.
 *
 * 1. Re-reads the signed-in user from the auth server (not cached client state).
 * 2. Re-checks the admin role in user_roles.
 * 3. Deletes and asks for the deleted row back: row-level security silently
 *    deletes nothing for non-admins, so an empty result is treated as a failure.
 */
export async function deleteReviewAsAdmin(reviewId: string): Promise<DeleteReviewResult> {
  try {
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) {
      return { ok: false, reason: "not_signed_in", message: "กรุณาเข้าสู่ระบบอีกครั้ง" };
    }

    const { data: roles, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.user.id)
      .eq("role", "admin");
    if (roleError) return { ok: false, reason: "error", message: roleError.message };
    if (!roles || roles.length === 0) {
      return { ok: false, reason: "not_admin", message: "เฉพาะผู้ดูแลระบบเท่านั้นที่ลบรีวิวได้" };
    }

    const { data: deleted, error } = await supabase
      .from("reviews")
      .delete()
      .eq("id", reviewId)
      .select("id");
    if (error) return { ok: false, reason: "error", message: error.message };
    if (!deleted || deleted.length === 0) {
      return {
        ok: false,
        reason: "not_found",
        message: "ไม่พบรีวิวนี้ หรือไม่มีสิทธิ์ลบ (อาจถูกลบไปแล้ว)",
      };
    }
    return { ok: true };
  } catch (err: unknown) {
    return {
      ok: false,
      reason: "error",
      message: (err as Error).message || "เกิดข้อผิดพลาดในการเชื่อมต่อ",
    };
  }
}
