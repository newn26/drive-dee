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

const auditLabel: Record<string, string> = {
  admin_role_granted: "ให้สิทธิ์ผู้ดูแล (นอกแอป)",
  owner_bootstrapped: "ตั้งเจ้าของระบบ",
  invite_created: "สร้างคำเชิญ",
  invite_revoked: "ยกเลิกคำเชิญ",
  invite_accepted: "รับคำเชิญ",
  permissions_changed: "เปลี่ยนสิทธิ์",
  admin_suspended: "ระงับผู้ดูแล",
  admin_reactivated: "คืนสิทธิ์ผู้ดูแล",
  admin_revoked: "เพิกถอนผู้ดูแล",
  booking_manual_confirm: "ยืนยันการจองด้วยตนเอง",
};

const memberStatusLabel: Record<AdminMemberRow["status"], string> = {
  active: "ใช้งาน",
  suspended: "ระงับชั่วคราว",
  revoked: "เพิกถอนแล้ว",
};

/** Not yet an admin: the invited person still has to open the link and press "accept". */
const PENDING = "รอผู้รับกดยอมรับ";

function invitationState(i: AdminInvitationRow, now: number = Date.now()) {
  if (i.accepted_at) return "รับแล้ว";
  if (i.revoked_at) return "ยกเลิกแล้ว";
  if (new Date(i.expires_at).getTime() <= now) return "หมดอายุ";
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
      toast.error((err as Error).message || "ดำเนินการไม่สำเร็จ");
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const handleInvite = () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inviteEmail.trim()))
      return void toast.error("อีเมลไม่ถูกต้อง");
    if (invitePerms.length === 0) return void toast.error("กรุณาเลือกสิทธิ์อย่างน้อย 1 รายการ");
    void run(
      async () => {
        const inv = await createAdminInvitation(inviteEmail, invitePerms);
        setCreatedLink({
          link: invitationLink(window.location.origin, inv.invite_token),
          email: inviteEmail.trim().toLowerCase(),
          expires: inv.invite_expires_at,
        });
      },
      "สร้างคำเชิญแล้ว",
      () => setInviteEmail(""),
    );
  };

  if (members.isError)
    return <LoadError title="โหลดรายชื่อผู้ดูแลไม่สำเร็จ" onRetry={() => void members.refetch()} />;

  return (
    <div className="space-y-6">
      <Card className="border shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <KeyRound className="h-5 w-5 text-primary" /> ผู้ดูแลระบบ
          </CardTitle>
          <CardDescription>
            เฉพาะเจ้าของระบบ (Owner) เท่านั้นที่เชิญ เปลี่ยนสิทธิ์ ระงับ หรือเพิกถอนผู้ดูแลได้
            ทุกการกระทำถูกบันทึกในบันทึกตรวจสอบ
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>อีเมล</TableHead>
                <TableHead>บทบาท</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead>สิทธิ์</TableHead>
                <TableHead className="text-right">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(members.data ?? []).map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell className="text-xs">{m.email || "-"}</TableCell>
                  <TableCell className="text-xs">
                    {m.is_owner ? <Badge>Owner</Badge> : "ผู้ดูแล"}
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
                      ? "ทั้งหมด"
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
                          สิทธิ์
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() =>
                            setStatusFor({ m, to: m.status === "active" ? "suspended" : "active" })
                          }
                        >
                          {m.status === "active" ? "ระงับ" : "คืนสิทธิ์"}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setStatusFor({ m, to: "revoked" })}
                        >
                          เพิกถอน
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
            <UserPlus className="h-5 w-5 text-primary" /> เชิญผู้ดูแลใหม่
          </CardTitle>
          <CardDescription>
            ระบบไม่ส่งอีเมลคำเชิญให้ — หลังสร้างลิงก์ กรุณาคัดลอกแล้วส่งให้ผู้รับด้วยตนเอง
            (ลิงก์แสดงเพียงครั้งเดียว ใช้ได้ครั้งเดียว ภายใน 72 ชั่วโมง และเฉพาะบัญชีที่ใช้อีเมลนี้)
            ผู้รับต้องเปิดลิงก์ เข้าสู่ระบบหรือสมัครด้วยอีเมลนี้ แล้วกด “ยอมรับคำเชิญ”
            อีเมลยืนยันตอนสมัครสมาชิกเป็นแค่การยืนยันบัญชี ยังไม่ทำให้เป็นผู้ดูแล
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="invite-email" className="text-xs">
              อีเมลของผู้ที่จะเชิญ (ต้องสมัครบัญชีด้วยอีเมลนี้)
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
            สร้างลิงก์คำเชิญ
          </Button>
          {createdLink && (
            <div
              className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
              role="status"
            >
              <p className="flex items-center gap-1 font-semibold">
                <ShieldAlert className="h-4 w-4" /> ลิงก์สำหรับ {createdLink.email} (หมดอายุ{" "}
                {fmtDateTime(createdLink.expires)})
              </p>
              <p className="break-all font-mono">{createdLink.link}</p>
              <p>
                คัดลอกลิงก์นี้ส่งให้ผู้รับตอนนี้ (ระบบไม่ส่งอีเมลให้ และลิงก์จะไม่แสดงอีก)
                ใครได้ลิงก์ไปก็ใช้ไม่ได้หากไม่ได้เข้าสู่ระบบด้วยอีเมลนี้
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 bg-white text-xs"
                onClick={() => {
                  void navigator.clipboard?.writeText(createdLink.link);
                  toast.success("คัดลอกลิงก์แล้ว");
                }}
              >
                <Copy className="mr-1 h-3.5 w-3.5" /> คัดลอกลิงก์
              </Button>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>อีเมล</TableHead>
                <TableHead>สิทธิ์</TableHead>
                <TableHead>หมดอายุ</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead className="text-right">จัดการ</TableHead>
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
                  <TableCell className="text-xs">{invitationState(i)}</TableCell>
                  <TableCell className="text-right">
                    {invitationState(i) === PENDING && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={busy}
                        onClick={() =>
                          void run(() => revokeAdminInvitation(i.id), "ยกเลิกคำเชิญแล้ว")
                        }
                      >
                        ยกเลิก
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
          <CardTitle className="text-lg">บันทึกตรวจสอบ (Audit log)</CardTitle>
          <CardDescription>แก้ไขหรือลบไม่ได้ · แสดง 100 รายการล่าสุด</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เวลา</TableHead>
                <TableHead>การกระทำ</TableHead>
                <TableHead>เป้าหมาย</TableHead>
                <TableHead>รายละเอียด</TableHead>
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
            <DialogTitle>สิทธิ์ของ {permsFor?.email}</DialogTitle>
            <DialogDescription>
              ทุกผู้ดูแลที่ใช้งานอยู่ดูข้อมูลได้ สิทธิ์ด้านล่างควบคุมการแก้ไข
            </DialogDescription>
          </DialogHeader>
          <PermissionPicker value={permsDraft} onChange={setPermsDraft} idPrefix="edit" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermsFor(null)}>
              ยกเลิก
            </Button>
            <Button
              disabled={busy || permsDraft.length === 0}
              onClick={() =>
                permsFor &&
                void run(
                  () => setAdminPermissions(permsFor.user_id, permsDraft),
                  "บันทึกสิทธิ์แล้ว",
                  () => setPermsFor(null),
                )
              }
            >
              บันทึกสิทธิ์
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!statusFor} onOpenChange={(o) => !o && setStatusFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {statusFor?.to === "revoked"
                ? "เพิกถอน"
                : statusFor?.to === "suspended"
                  ? "ระงับ"
                  : "คืนสิทธิ์"}{" "}
              {statusFor?.m.email}
            </DialogTitle>
            <DialogDescription>
              {statusFor?.to === "revoked"
                ? "การเพิกถอนถาวร: บัญชีนี้จะกลับมาเป็นผู้ดูแลได้ด้วยคำเชิญใหม่เท่านั้น"
                : statusFor?.to === "suspended"
                  ? "ผู้ดูแลที่ถูกระงับจะใช้สิทธิ์ผู้ดูแลไม่ได้ทันทีจนกว่าจะคืนสิทธิ์"
                  : "ผู้ดูแลจะกลับมาใช้สิทธิ์เดิมได้"}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={statusReason}
            onChange={(e) => setStatusReason(e.target.value)}
            placeholder="เหตุผล (อย่างน้อย 5 ตัวอักษร)"
            aria-label="เหตุผล"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusFor(null)}>
              ยกเลิก
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
                  "บันทึกแล้ว",
                  () => {
                    setStatusFor(null);
                    setStatusReason("");
                  },
                );
              }}
            >
              ยืนยัน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
