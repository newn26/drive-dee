/**
 * Calls to the contract-workflow and admin-management database functions
 * (drizzle/migrations/0004_contract_approval_workflow.sql).
 *
 * Row types come from the generated Supabase types. A few text columns are narrowed to the
 * values their CHECK constraints allow (status, permissions, actor role), so the UI can rely on them.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database, Tables } from "@/integrations/supabase/types";
import type { ContractStatus } from "@/lib/contract-workflow";

const db = supabase;

export type ContractRow = Omit<Tables<"contracts">, "status" | "revision_requested_by"> & {
  status: ContractStatus;
  revision_requested_by: "customer" | "admin" | null;
};

export type ContractVersionRow = Tables<"contract_versions">;

export type ContractEventRow = Omit<Tables<"contract_events">, "actor_role"> & {
  actor_role: "owner" | "admin" | "customer" | "system";
};

export type AdminPermission =
  | "contracts_manage"
  | "contracts_approve"
  | "bookings_manage"
  | "fleet_manage"
  | "reviews_moderate";

export const ADMIN_PERMISSIONS: readonly AdminPermission[] = [
  "contracts_manage",
  "contracts_approve",
  "bookings_manage",
  "fleet_manage",
  "reviews_moderate",
];

export const adminPermissionLabel: Record<AdminPermission, string> = {
  contracts_manage: "สร้าง/แก้ไขสัญญา (ระบบเดิม · ไม่ใช้แล้ว)",
  contracts_approve: "อนุมัติสัญญา (ระบบเดิม · ไม่ใช้แล้ว)",
  bookings_manage: "จัดการสถานะการจอง",
  fleet_manage: "จัดการรถและงานซ่อมบำรุง",
  reviews_moderate: "ดูแลรีวิว",
};

export type AdminMemberRow = Omit<Tables<"admin_members">, "status" | "permissions"> & {
  status: "active" | "suspended" | "revoked";
  permissions: AdminPermission[];
};

/** The columns the Owner's invitation list reads (never the token hash). */
export type AdminInvitationRow = Pick<
  Tables<"admin_invitations">,
  "id" | "email" | "invited_by" | "created_at" | "expires_at" | "accepted_at" | "revoked_at"
> & { permissions: AdminPermission[] };

export type AdminAuditRow = Omit<Tables<"admin_audit_log">, "details"> & {
  details: Record<string, unknown>;
};

type Fns = Database["public"]["Functions"];

/** Typed RPC; throws the database's (Thai) message so callers can show it. */
async function call<F extends keyof Fns>(fn: F, args: Fns[F]["Args"]): Promise<Fns[F]["Returns"]> {
  const { data, error } = await db.rpc(fn, args as never);
  if (error) throw new Error(error.message);
  return data as Fns[F]["Returns"];
}

// ------------------------------ reads ------------------------------

export async function fetchContractForBooking(bookingId: string): Promise<ContractRow | null> {
  const { data, error } = await db
    .from("contracts")
    .select("*")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ContractRow | null) ?? null;
}

export async function fetchContractVersions(contractId: string): Promise<ContractVersionRow[]> {
  const { data, error } = await db
    .from("contract_versions")
    .select("*")
    .eq("contract_id", contractId)
    .order("version", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ContractVersionRow[];
}

export async function fetchContractEvents(bookingId: string): Promise<ContractEventRow[]> {
  const { data, error } = await db
    .from("contract_events")
    .select("*")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ContractEventRow[];
}

/** The signed-in admin's own member row (null for customers, or before the migration). */
export async function fetchOwnAdminMember(userId: string): Promise<AdminMemberRow | null> {
  const { data, error } = await db
    .from("admin_members")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return null;
  return (data as AdminMemberRow | null) ?? null;
}

export async function fetchAdminMembers(): Promise<AdminMemberRow[]> {
  const { data, error } = await db.from("admin_members").select("*").order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as AdminMemberRow[];
}

export async function fetchAdminInvitations(): Promise<AdminInvitationRow[]> {
  const { data, error } = await db
    .from("admin_invitations")
    .select("id, email, permissions, invited_by, created_at, expires_at, accepted_at, revoked_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AdminInvitationRow[];
}

export async function fetchAdminAudit(limit = 100): Promise<AdminAuditRow[]> {
  const { data, error } = await db
    .from("admin_audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as AdminAuditRow[];
}

// ------------------------------ contract workflow ------------------------------

export const acceptContract = (contractId: string, version: number) =>
  call("customer_accept_contract", { _contract_id: contractId, _version: version });

/**
 * Creates the contract of a pending booking made before contracts were created automatically
 * (drizzle 0005). Returns the contract id; idempotent.
 */
export const customerPrepareContract = (bookingId: string) =>
  call("customer_prepare_contract", { _booking_id: bookingId });

export const ownerManualConfirm = (bookingId: string, reason: string) =>
  call("owner_manual_confirm_booking", { _booking_id: bookingId, _reason: reason.trim() });

/** Cancels expired holds server-side. Returns how many were cancelled (0 if the function is missing). */
export async function expireStaleBookings(): Promise<number> {
  const { data, error } = await db.rpc("expire_stale_bookings");
  if (error) return 0;
  return Number(data ?? 0);
}

// ------------------------------ admin management ------------------------------

export type CreatedInvitation = {
  invitation_id: string;
  invite_token: string;
  invite_expires_at: string;
};

export async function createAdminInvitation(
  email: string,
  permissions: AdminPermission[],
): Promise<CreatedInvitation> {
  const rows = await call("owner_create_admin_invitation", {
    _email: email.trim(),
    _permissions: permissions,
  });
  const first = rows[0];
  if (!first) throw new Error("สร้างคำเชิญไม่สำเร็จ");
  return first;
}

export const revokeAdminInvitation = (id: string) =>
  call("owner_revoke_admin_invitation", { _invitation_id: id });

export const acceptAdminInvitation = (token: string) =>
  call("accept_admin_invitation", { _token: token.trim() });

export const setAdminPermissions = (userId: string, permissions: AdminPermission[]) =>
  call("owner_set_admin_permissions", { _user_id: userId, _permissions: permissions });

export const setAdminStatus = (
  userId: string,
  status: "active" | "suspended" | "revoked",
  reason: string,
) =>
  call("owner_set_admin_status", {
    _user_id: userId,
    _status: status,
    _reason: reason.trim(),
  });

/** Link the Owner sends to the invited person (the token is shown once and never stored in plain text). */
export const invitationLink = (origin: string, token: string) =>
  `${origin}/admin-invite?token=${encodeURIComponent(token)}`;

/** An invitation token from a URL search param, or undefined if it is not a well-formed token. */
export const inviteTokenFrom = (value: unknown): string | undefined =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : undefined;
