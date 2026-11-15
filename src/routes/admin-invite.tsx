import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { acceptAdminInvitation, inviteTokenFrom } from "@/lib/contract-api";
import { tr, trError } from "@/lib/i18n";

type InviteSearch = { token?: string };

export const Route = createFileRoute("/admin-invite")({
  head: () => ({
    meta: [{ title: "รับคำเชิญผู้ดูแลระบบ — Drive Dee" }, { name: "robots", content: "noindex" }],
  }),
  validateSearch: (s: Record<string, unknown>): InviteSearch => {
    const token = inviteTokenFrom(s["token"]);
    return token ? { token } : {};
  },
  component: AdminInvitePage,
});

/**
 * An Owner's invitation link lands here. The database checks everything: the token (single use,
 * 72 h), that the signed-in account's email is the invited one, and that it is not a demo account.
 * Signing in or registering from here carries the token through /auth (and the sign-up
 * confirmation email) so the person comes back to this page to accept.
 */
function AdminInvitePage() {
  const { token } = Route.useSearch();
  const { user, loading, signOut } = useAuth();
  const [accepting, setAccepting] = useState(false);
  const [done, setDone] = useState(false);

  const accept = async () => {
    if (!token) return;
    setAccepting(true);
    try {
      await acceptAdminInvitation(token);
      setDone(true);
      toast.success(tr("คุณเป็นผู้ดูแลระบบแล้ว", "You are now an admin"));
    } catch (err: unknown) {
      toast.error(
        trError((err as Error).message) ||
          tr("รับคำเชิญไม่สำเร็จ", "Could not accept the invitation"),
      );
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card className="border shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />{" "}
            {tr("คำเชิญเป็นผู้ดูแลระบบ", "Admin invitation")}
          </CardTitle>
          <CardDescription>
            {tr(
              "ลิงก์นี้ใช้ได้ครั้งเดียว ภายใน 72 ชั่วโมง และเฉพาะบัญชีที่ใช้อีเมลที่ได้รับเชิญ",
              "This link works once, within 72 hours, and only for the account with the invited email.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!token ? (
            <p className="text-destructive">
              {tr(
                "ลิงก์คำเชิญไม่ถูกต้อง กรุณาขอลิงก์ใหม่จากเจ้าของระบบ",
                "Invalid invitation link. Please ask the owner for a new one.",
              )}
            </p>
          ) : loading ? (
            <p className="text-muted-foreground">
              {tr("กำลังตรวจสอบการเข้าสู่ระบบ...", "Checking your sign-in...")}
            </p>
          ) : !user ? (
            <>
              <p>
                {tr(
                  "ขั้นที่ 1: เข้าสู่ระบบด้วยอีเมลที่ได้รับเชิญ (ยังไม่มีบัญชี? สมัครสมาชิกด้วยอีเมลนั้นได้เลย)",
                  "Step 1: sign in with the invited email (no account yet? sign up with that email).",
                )}
              </p>
              <p className="text-muted-foreground">
                {tr(
                  "ขั้นที่ 2: ระบบจะพากลับมาหน้านี้ แล้วกด “ยอมรับคำเชิญ” จึงจะได้สิทธิ์ผู้ดูแล อีเมลยืนยันตอนสมัครเป็นแค่การยืนยันบัญชี ยังไม่ใช่การรับคำเชิญ",
                  "Step 2: you will come back to this page; press “Accept invitation” to get admin access. The sign-up confirmation email only confirms your account; it does not accept the invitation.",
                )}
              </p>
            </>
          ) : done ? (
            <p className="text-success">
              {tr(
                "รับคำเชิญเรียบร้อยแล้ว กรุณาโหลดหน้าใหม่เพื่อเข้าสู่แดชบอร์ดผู้ดูแล",
                "Invitation accepted. Reload the page to open the admin dashboard.",
              )}
            </p>
          ) : (
            <>
              <p>
                {tr("เข้าสู่ระบบเป็น", "Signed in as")} <strong>{user.email}</strong>{" "}
                {tr(
                  "กดยอมรับเพื่อรับสิทธิ์ผู้ดูแลตามที่เจ้าของระบบกำหนด",
                  "Accept to get the admin access the owner set for you.",
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {tr(
                  "ถ้านี่ไม่ใช่อีเมลที่ได้รับเชิญ ให้ออกจากระบบแล้วเข้าสู่ระบบด้วยอีเมลที่ถูกต้อง",
                  "If this is not the invited email, sign out and sign in with the right one.",
                )}
              </p>
            </>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          {token && !loading && !user && (
            <>
              <Button asChild>
                <Link to="/auth" search={{ invite: token }}>
                  {tr("เข้าสู่ระบบ", "Sign in")}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/auth" search={{ invite: token, register: true }}>
                  {tr("สมัครสมาชิก", "Sign up")}
                </Link>
              </Button>
            </>
          )}
          {token && user && !done && (
            <>
              <Button onClick={accept} disabled={accepting}>
                {accepting
                  ? tr("กำลังตรวจสอบ...", "Checking...")
                  : tr("ยอมรับคำเชิญ", "Accept invitation")}
              </Button>
              <Button variant="ghost" onClick={() => void signOut()} disabled={accepting}>
                {tr("ออกจากระบบ", "Sign out")}
              </Button>
            </>
          )}
          {done && (
            <Button onClick={() => window.location.assign("/admin")}>
              {tr("ไปที่แดชบอร์ดผู้ดูแล", "Go to the admin dashboard")}
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
