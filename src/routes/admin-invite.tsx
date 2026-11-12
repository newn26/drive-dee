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
import { acceptAdminInvitation } from "@/lib/contract-api";

type InviteSearch = { token?: string };

export const Route = createFileRoute("/admin-invite")({
  head: () => ({
    meta: [{ title: "รับคำเชิญผู้ดูแลระบบ — Drive Dee" }, { name: "robots", content: "noindex" }],
  }),
  validateSearch: (s: Record<string, unknown>): InviteSearch =>
    typeof s["token"] === "string" && /^[0-9a-f]{64}$/.test(s["token"])
      ? { token: s["token"] }
      : {},
  component: AdminInvitePage,
});

/**
 * An Owner's invitation link lands here. The database checks everything: the token (single use,
 * 72 h), that the signed-in account's email is the invited one, and that it is not a demo account.
 */
function AdminInvitePage() {
  const { token } = Route.useSearch();
  const { user, loading } = useAuth();
  const [accepting, setAccepting] = useState(false);
  const [done, setDone] = useState(false);

  const accept = async () => {
    if (!token) return;
    setAccepting(true);
    try {
      await acceptAdminInvitation(token);
      setDone(true);
      toast.success("คุณเป็นผู้ดูแลระบบแล้ว");
    } catch (err: unknown) {
      toast.error((err as Error).message || "รับคำเชิญไม่สำเร็จ");
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card className="border shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" /> คำเชิญเป็นผู้ดูแลระบบ
          </CardTitle>
          <CardDescription>
            ลิงก์นี้ใช้ได้ครั้งเดียว ภายใน 72 ชั่วโมง และเฉพาะบัญชีที่ใช้อีเมลที่ได้รับเชิญ
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!token ? (
            <p className="text-destructive">ลิงก์คำเชิญไม่ถูกต้อง กรุณาขอลิงก์ใหม่จากเจ้าของระบบ</p>
          ) : loading ? (
            <p className="text-muted-foreground">กำลังตรวจสอบการเข้าสู่ระบบ...</p>
          ) : !user ? (
            <p>
              กรุณาเข้าสู่ระบบ (หรือสมัครสมาชิก) ด้วยอีเมลที่ได้รับเชิญ แล้วเปิดลิงก์นี้อีกครั้ง
            </p>
          ) : done ? (
            <p className="text-success">
              รับคำเชิญเรียบร้อยแล้ว กรุณาโหลดหน้าใหม่เพื่อเข้าสู่แดชบอร์ดผู้ดูแล
            </p>
          ) : (
            <p>
              เข้าสู่ระบบเป็น <strong>{user.email}</strong>{" "}
              กดยอมรับเพื่อรับสิทธิ์ผู้ดูแลตามที่เจ้าของระบบกำหนด
            </p>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          {token && !loading && !user && (
            <Button asChild>
              <Link to="/auth">เข้าสู่ระบบ</Link>
            </Button>
          )}
          {token && user && !done && (
            <Button onClick={accept} disabled={accepting}>
              {accepting ? "กำลังตรวจสอบ..." : "ยอมรับคำเชิญ"}
            </Button>
          )}
          {done && (
            <Button onClick={() => window.location.assign("/admin")}>ไปที่แดชบอร์ดผู้ดูแล</Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
