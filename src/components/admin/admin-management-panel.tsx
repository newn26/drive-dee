import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, ShieldAlert, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
import { LoadError } from "@/components/load-error";
import { fmtDateTime } from "@/lib/format";
import { reasonError } from "@/lib/contract-workflow";
import {
  ADMIN_PERMISSIONS,
  adminPermissionLabel,
  createAdminInvitation,
  fetchAdminAudit,
  fetchAdminInvitations,
  fetchAdminMembers,
  invitationLink,
  revokeAdminInvitation,
  setAdminPermissions,
  setAdminStatus,
  type AdminInvitationRow,
  type AdminMemberRow,
  type AdminPermission,
} from "@/lib/contract-api";
import { bilingual, tr, trError } from "@/lib/i18n";

const auditLabel: Record<string, string> = bilingual({
  admin_role_granted: ["ให้สิทธิ์ผู้ดูแล (นอกแอป)", "Admin role granted (outside the app)"],
  owner_bootstrapped: ["ตั้งเจ้าของระบบ", "Owner set"],
  invite_created: ["สร้างคำเชิญ", "Invitation created"],
  invite_revoked: ["ยกเลิกคำเชิญ", "Invitation revoked"],
  invite_accepted: ["รับคำเชิญ", "Invitation accepted"],
  permissions_changed: ["เปลี่ยนสิทธิ์", "Permissions changed"],
  admin_suspended: ["ระงับผู้ดูแล", "Admin suspended"],
  admin_reactivated: ["คืนสิทธิ์ผู้ดูแล", "Admin reactivated"],
  admin_revoked: ["เพิกถอนผู้ดูแล", "Admin revoked"],
  booking_manual_confirm: ["ยืนยันการจองด้วยตนเอง", "Booking confirmed manually"],
});

const memberStatusLabel: Record<AdminMemberRow["status"], string> = bilingual({
  active: ["ใช้งาน", "Active"],
  suspended: ["ระงับชั่วคราว", "Suspended"],
  revoked: ["เพิกถอนแล้ว", "Revoked"],
});

/** Not yet an admin: the invited person still has to open the link and press "accept". */
const PENDING = "pending";

const invitationStateLabel: Record<string, string> = bilingual({
  accepted: ["รับแล้ว", "Accepted"],
  revoked: ["ยกเลิกแล้ว", "Revoked"],
  expired: ["หมดอายุ", "Expired"],
  pending: ["รอผู้รับกดยอมรับ", "Waiting for the invitee to accept"],
});

function invitationState(i: AdminInvitationRow, now: number = Date.now()) {
  if (i.accepted_at) return "accepted";
  if (i.revoked_at) return "revoked";
  if (new Date(i.expires_at).getTime() <= now) return "expired";
  return PENDING;
}

function PermissionPicker({
  value,
  onChange,
  idPrefix,
}: {
  value: AdminPermission[];
  onChange: (v: AdminPermission[]) => void;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {ADMIN_PERMISSIONS.map((p) => (
        <div key={p} className="flex items-center gap-2">
          <Checkbox
            id={`${idPrefix}-${p}`}
            checked={value.includes(p)}
            onCheckedChange={(c) => onChange(c ? [...value, p] : value.filter((x) => x !== p))}
          />
          <Label htmlFor={`${idPrefix}-${p}`} className="cursor-pointer text-xs">
            {adminPermissionLabel[p]}
          </Label>
        </div>
      ))}
    </div>
  );
}

/** Owner only. The database refuses every action here for anyone else. */
export function AdminManagementPanel({ ownerId }: { ownerId: string }) {
  const queryClient = useQueryClient();
  const members = useQuery({ queryKey: ["admin-members"], queryFn: fetchAdminMembers });
  const invitations = useQuery({ queryKey: ["admin-invitations"], queryFn: fetchAdminInvitations });
  const audit = useQuery({ queryKey: ["admin-audit"], queryFn: () => fetchAdminAudit(100) });

  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePerms, setInvitePerms] = useState<AdminPermission[]>(["contracts_manage"]);
  const [createdLink, setCreatedLink] = useState<{
    link: string;
    email: string;
    expires: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const [permsFor, setPermsFor] = useState<AdminMemberRow | null>(null);
  const [permsDraft, setPermsDraft] = useState<AdminPermission[]>([]);
  const [statusFor, setStatusFor] = useState<{
    m: AdminMemberRow;
    to: "active" | "suspended" | "revoked";
  } | null>(null);
  const [statusReason, setStatusReason] = useState("");

  const refresh = () =>
    Promise.all(
      ["admin-members", "admin-invitations", "admin-audit"].map((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }),
      ),
    );

  const run = async (action: () => Promise<unknown>, success: string, after?: () => void) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      after?.();
    } catch (err: unknown) {
      toast.error(trError((err as Error).message) || tr("ดำเนินการไม่สำเร็จ", "The action failed"));
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const handleInvite = () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inviteEmail.trim()))
      return void toast.error(tr("อีเมลไม่ถูกต้อง", "Invalid email"));
    if (invitePerms.length === 0)
      return void toast.error(
        tr("กรุณาเลือกสิทธิ์อย่างน้อย 1 รายการ", "Please choose at least one permission"),
      );
    void run(
      async () => {
        const inv = await createAdminInvitation(inviteEmail, invitePerms);
        setCreatedLink({
          link: invitationLink(window.location.origin, inv.invite_token),
          email: inviteEmail.trim().toLowerCase(),
          expires: inv.invite_expires_at,
        });
      },
      tr("สร้างคำเชิญแล้ว", "Invitation created"),
      () => setInviteEmail(""),
    );
  };

  if (members.isError)
    return (
      <LoadError
        title={tr("โหลดรายชื่อผู้ดูแลไม่สำเร็จ", "Could not load the admins")}
        onRetry={() => void members.refetch()}
      />
    );

  return (
    <div className="space-y-6">
      <Card className="border shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <KeyRound className="h-5 w-5 text-primary" /> {tr("ผู้ดูแลระบบ", "Admins")}
          </CardTitle>
          <CardDescription>
            {tr(
              "เฉพาะเจ้าของระบบ (Owner) เท่านั้นที่เชิญ เปลี่ยนสิทธิ์ ระงับ หรือเพิกถอนผู้ดูแลได้ ทุกการกระทำถูกบันทึกในบันทึกตรวจสอบ",
              "Only the Owner can invite, change permissions, suspend or revoke admins. Every action is recorded in the audit log.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("อีเมล", "Email")}</TableHead>
                <TableHead>{tr("บทบาท", "Role")}</TableHead>
                <TableHead>{tr("สถานะ", "Status")}</TableHead>
                <TableHead>{tr("สิทธิ์", "Permissions")}</TableHead>
                <TableHead className="text-right">{tr("จัดการ", "Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(members.data ?? []).map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell className="text-xs">{m.email || "-"}</TableCell>
                  <TableCell className="text-xs">
                    {m.is_owner ? <Badge>Owner</Badge> : tr("ผู้ดูแล", "Admin")}
                  </TableCell>
                  <TableCell className="text-xs">
                    {memberStatusLabel[m.status]}
                    {m.status_reason && (
                      <span className="block text-[11px] text-muted-foreground">
                        {m.status_reason}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">
                    {m.is_owner
                      ? tr("ทั้งหมด", "All")
                      : m.permissions.map((p) => adminPermissionLabel[p] ?? p).join(", ")}
                  </TableCell>
                  <TableCell className="text-right">
                    {!m.is_owner && m.user_id !== ownerId && m.status !== "revoked" && (
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            setPermsFor(m);
                            setPermsDraft([...m.permissions]);
                          }}
                        >
                          {tr("สิทธิ์", "Permissions")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() =>
                            setStatusFor({ m, to: m.status === "active" ? "suspended" : "active" })
                          }
                        >
                          {m.status === "active"
                            ? tr("ระงับ", "Suspend")
                            : tr("คืนสิทธิ์", "Reactivate")}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setStatusFor({ m, to: "revoked" })}
                        >
                          {tr("เพิกถอน", "Revoke")}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserPlus className="h-5 w-5 text-primary" />{" "}
            {tr("เชิญผู้ดูแลใหม่", "Invite a new admin")}
          </CardTitle>
          <CardDescription>
            {tr(
              "ระบบไม่ส่งอีเมลคำเชิญให้ — หลังสร้างลิงก์ กรุณาคัดลอกแล้วส่งให้ผู้รับด้วยตนเอง (ลิงก์แสดงเพียงครั้งเดียว ใช้ได้ครั้งเดียว ภายใน 72 ชั่วโมง และเฉพาะบัญชีที่ใช้อีเมลนี้) ผู้รับต้องเปิดลิงก์ เข้าสู่ระบบหรือสมัครด้วยอีเมลนี้ แล้วกด “ยอมรับคำเชิญ” อีเมลยืนยันตอนสมัครสมาชิกเป็นแค่การยืนยันบัญชี ยังไม่ทำให้เป็นผู้ดูแล",
              "No invitation email is sent. After creating the link, copy it and send it to the invitee yourself (the link is shown once, works once, within 72 hours, and only for the account with this email). The invitee must open the link, sign in or sign up with this email, and press “Accept invitation”. The sign-up confirmation email only confirms the account; it does not make them an admin.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="invite-email" className="text-xs">
              {tr(
                "อีเมลของผู้ที่จะเชิญ (ต้องสมัครบัญชีด้วยอีเมลนี้)",
                "Invitee's email (they must sign up with this email)",
              )}
            </Label>
            <Input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="mt-1 max-w-sm"
            />
          </div>
          <PermissionPicker value={invitePerms} onChange={setInvitePerms} idPrefix="invite" />
          <Button onClick={handleInvite} disabled={busy}>
            {tr("สร้างลิงก์คำเชิญ", "Create invitation link")}
          </Button>
          {createdLink && (
            <div
              className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
              role="status"
            >
              <p className="flex items-center gap-1 font-semibold">
                <ShieldAlert className="h-4 w-4" /> {tr("ลิงก์สำหรับ", "Link for")}{" "}
                {createdLink.email} (หมดอายุ {fmtDateTime(createdLink.expires)})
              </p>
              <p className="break-all font-mono">{createdLink.link}</p>
              <p>
                {tr(
                  "คัดลอกลิงก์นี้ส่งให้ผู้รับตอนนี้ (ระบบไม่ส่งอีเมลให้ และลิงก์จะไม่แสดงอีก) ใครได้ลิงก์ไปก็ใช้ไม่ได้หากไม่ได้เข้าสู่ระบบด้วยอีเมลนี้",
                  "Copy this link and send it to the invitee now (no email is sent and the link will not be shown again). Nobody can use it without signing in with this email.",
                )}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 bg-white text-xs"
                onClick={() => {
                  void navigator.clipboard?.writeText(createdLink.link);
                  toast.success(tr("คัดลอกลิงก์แล้ว", "Link copied"));
                }}
              >
                <Copy className="mr-1 h-3.5 w-3.5" /> {tr("คัดลอกลิงก์", "Copy link")}
              </Button>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("อีเมล", "Email")}</TableHead>
                <TableHead>{tr("สิทธิ์", "Permissions")}</TableHead>
                <TableHead>{tr("หมดอายุ", "Expires")}</TableHead>
                <TableHead>{tr("สถานะ", "Status")}</TableHead>
                <TableHead className="text-right">{tr("จัดการ", "Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(invitations.data ?? []).map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="text-xs">{i.email}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">
                    {i.permissions.map((p) => adminPermissionLabel[p] ?? p).join(", ")}
                  </TableCell>
                  <TableCell className="text-xs">{fmtDateTime(i.expires_at)}</TableCell>
                  <TableCell className="text-xs">
                    {invitationStateLabel[invitationState(i)]}
                  </TableCell>
                  <TableCell className="text-right">
                    {invitationState(i) === PENDING && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => revokeAdminInvitation(i.id),
                            tr("ยกเลิกคำเชิญแล้ว", "Invitation revoked"),
                          )
                        }
                      >
                        {tr("ยกเลิก", "Revoke")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border shadow-card">
        <CardHeader>
          <CardTitle className="text-lg">{tr("บันทึกตรวจสอบ (Audit log)", "Audit log")}</CardTitle>
          <CardDescription>
            {tr(
              "แก้ไขหรือลบไม่ได้ · แสดง 100 รายการล่าสุด",
              "Cannot be edited or deleted · latest 100 entries",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("เวลา", "Time")}</TableHead>
                <TableHead>{tr("การกระทำ", "Action")}</TableHead>
                <TableHead>{tr("เป้าหมาย", "Target")}</TableHead>
                <TableHead>{tr("รายละเอียด", "Details")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(audit.data ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {fmtDateTime(a.created_at)}
                  </TableCell>
                  <TableCell className="text-xs">{auditLabel[a.action] ?? a.action}</TableCell>
                  <TableCell className="text-xs">{a.target_email || "-"}</TableCell>
                  <TableCell
                    className="max-w-xs truncate font-mono text-[11px] text-muted-foreground"
                    title={JSON.stringify(a.details)}
                  >
                    {JSON.stringify(a.details)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!permsFor} onOpenChange={(o) => !o && setPermsFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr("สิทธิ์ของ", "Permissions for")} {permsFor?.email}
            </DialogTitle>
            <DialogDescription>
              {tr(
                "ทุกผู้ดูแลที่ใช้งานอยู่ดูข้อมูลได้ สิทธิ์ด้านล่างควบคุมการแก้ไข",
                "Every active admin can view data; the permissions below control editing.",
              )}
            </DialogDescription>
          </DialogHeader>
          <PermissionPicker value={permsDraft} onChange={setPermsDraft} idPrefix="edit" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermsFor(null)}>
              {tr("ยกเลิก", "Revoke")}
            </Button>
            <Button
              disabled={busy || permsDraft.length === 0}
              onClick={() =>
                permsFor &&
                void run(
                  () => setAdminPermissions(permsFor.user_id, permsDraft),
                  tr("บันทึกสิทธิ์แล้ว", "Permissions saved"),
                  () => setPermsFor(null),
                )
              }
            >
              {tr("บันทึกสิทธิ์", "Save permissions")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!statusFor} onOpenChange={(o) => !o && setStatusFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {statusFor?.to === "revoked"
                ? tr("เพิกถอน", "Revoke")
                : statusFor?.to === "suspended"
                  ? tr("ระงับ", "Suspend")
                  : tr("คืนสิทธิ์", "Reactivate")}{" "}
              {statusFor?.m.email}
            </DialogTitle>
            <DialogDescription>
              {statusFor?.to === "revoked"
                ? tr(
                    "การเพิกถอนถาวร: บัญชีนี้จะกลับมาเป็นผู้ดูแลได้ด้วยคำเชิญใหม่เท่านั้น",
                    "Revoking is permanent: this account can become an admin again only with a new invitation.",
                  )
                : statusFor?.to === "suspended"
                  ? tr(
                      "ผู้ดูแลที่ถูกระงับจะใช้สิทธิ์ผู้ดูแลไม่ได้ทันทีจนกว่าจะคืนสิทธิ์",
                      "A suspended admin loses admin access immediately until reactivated.",
                    )
                  : tr(
                      "ผู้ดูแลจะกลับมาใช้สิทธิ์เดิมได้",
                      "The admin gets their previous access back.",
                    )}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={statusReason}
            onChange={(e) => setStatusReason(e.target.value)}
            placeholder={tr("เหตุผล (อย่างน้อย 5 ตัวอักษร)", "Reason (at least 5 characters)")}
            aria-label={tr("เหตุผล", "Reason")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusFor(null)}>
              {tr("ยกเลิก", "Revoke")}
            </Button>
            <Button
              variant={statusFor?.to === "active" ? "default" : "destructive"}
              disabled={busy}
              onClick={() => {
                if (!statusFor) return;
                const problem = reasonError(statusReason, 5);
                if (problem) return void toast.error(problem);
                void run(
                  () => setAdminStatus(statusFor.m.user_id, statusFor.to, statusReason),
                  tr("บันทึกแล้ว", "Saved"),
                  () => {
                    setStatusFor(null);
                    setStatusReason("");
                  },
                );
              }}
            >
              {tr("ยืนยัน", "Confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
