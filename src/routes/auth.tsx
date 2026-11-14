import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Lock, Mail, Phone, User, ArrowLeft, ShieldCheck, KeyRound, MonitorPlay } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { fetchRole, useAuth } from "@/hooks/use-auth";
import { createDemoAccount } from "@/lib/demo.functions";
import { DEMO_ADMIN_SIGN_IN_ENABLED, homeForRole, initialAuthMode } from "@/lib/roles";
import { invitationLink, inviteTokenFrom } from "@/lib/contract-api";

type AuthSearch = {
  reset?: boolean | undefined;
  demo?: boolean | undefined;
  /** Admin invitation token: after signing in (or confirming sign-up) go back to accept it. */
  invite?: string | undefined;
  register?: boolean | undefined;
};

const flag = (v: unknown) => (v === true || v === "true" ? true : undefined);

export const Route = createFileRoute("/auth")({
  // The password-reset email links back to /auth?reset=true.
  // The router parses "true" into a boolean, so accept both forms.
  validateSearch: (s: Record<string, unknown>): AuthSearch => ({
    reset: flag(s["reset"]),
    demo: flag(s["demo"]),
    invite: inviteTokenFrom(s["invite"]),
    register: flag(s["register"]),
  }),
  head: () => ({
    meta: [
      { title: "เข้าสู่ระบบและสมัครสมาชิก — Drive Dee" },
      { name: "description", content: "เข้าสู่ระบบหรือสมัครสมาชิกเพื่อจองรถเช่าออนไลน์และจัดการการจอง" },
      { property: "og:title", content: "เข้าสู่ระบบ — Drive Dee" },
    ],
  }),
  component: AuthPage,
});

type AuthMode = "login" | "register" | "forgot" | "demo";

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [mode, setMode] = useState<AuthMode>(
    search.register ? "register" : initialAuthMode(search.demo),
  );

  if (search.reset) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-md flex-col justify-center px-4 py-12">
        <ResetPasswordForm
          onDone={() => navigate({ to: "/dashboard", replace: true })}
          onRequestNewLink={() => {
            setMode("forgot");
            navigate({ to: "/auth", search: {}, replace: true });
          }}
        />
      </div>
    );
  }

  return <AuthForms mode={mode} setMode={setMode} invite={search.invite} />;
}

function AuthForms({
  mode,
  setMode,
  invite,
}: {
  mode: AuthMode;
  setMode: (m: AuthMode) => void;
  invite?: string | undefined;
}) {
  const navigate = useNavigate();
  const goToInvite = (token: string) =>
    navigate({ to: "/admin-invite", search: { token }, replace: true });
  const { user, role, isDemo, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  // Shown after sign-up when Supabase still needs the user to confirm their email
  const [confirmEmailFor, setConfirmEmailFor] = useState<string | null>(null);

  // Form Fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const startDemo = async () => {
    setLoading(true);
    try {
      const creds = await createDemoAccount();
      const { error } = await supabase.auth.signInWithPassword(creds);
      if (error) throw error;
      toast.success("เข้าสู่ระบบด้วยบัญชีทดลองแล้ว (ข้อมูลสมมติ)");
      navigate({ to: "/" });
    } catch {
      toast.error("ไม่สามารถเริ่มโหมดทดลองได้ กรุณาลองใหม่");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setPassword("");
    setConfirmPassword("");
  };

  const switchMode = (newMode: AuthMode) => {
    setMode(newMode);
    if (newMode !== "login") setConfirmEmailFor(null);
    resetForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 1. Password Reset Flow
    if (mode === "forgot") {
      if (!email.trim() || !email.includes("@")) {
        toast.error("กรุณากรอกอีเมลที่ถูกต้อง");
        return;
      }
      setLoading(true);
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth?reset=true`,
        });
        if (error) {
          toast.error(error.message || "ไม่สามารถส่งคำขอรีเซ็ตรหัสผ่านได้");
        } else {
          toast.success("ส่งลิงก์สำหรับรีเซ็ตรหัสผ่านไปยังอีเมลของคุณเรียบร้อยแล้ว");
          switchMode("login");
        }
      } catch (err: unknown) {
        const error = err as Error;
        toast.error(error.message || "เกิดข้อผิดพลาดในการเชื่อมต่อ");
      } finally {
        setLoading(false);
      }
      return;
    }

    // 2. Sign In Flow (customer/admin, or the separate Demo Admin option)
    if (mode === "login" || mode === "demo") {
      if (!email.trim() || !password) {
        toast.error("กรุณากรอกอีเมลและรหัสผ่าน");
        return;
      }
      setLoading(true);
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) {
          if (error.message.includes("Invalid login credentials")) {
            toast.error("อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง");
          } else if (error.message.toLowerCase().includes("email not confirmed")) {
            toast.error("อีเมลนี้ยังไม่ได้ยืนยัน กรุณากดลิงก์ยืนยันในอีเมลของคุณก่อนเข้าสู่ระบบ");
          } else {
            toast.error(error.message || "เกิดข้อผิดพลาดในการเข้าสู่ระบบ");
          }
          return;
        }

        // The role comes from user_roles in the database, never from the form.
        const role = data.user ? await fetchRole(data.user) : "customer";

        if (mode === "demo") {
          if (role !== "demo_admin") {
            await supabase.auth.signOut();
            toast.error("บัญชีนี้ไม่ใช่บัญชีผู้ดูแลระบบสาธิต (Demo Admin)");
            return;
          }
          toast.success("เข้าสู่ระบบโหมดสาธิต (Demo Admin) สำเร็จ");
          navigate({ to: "/demo-admin" });
          return;
        }

        toast.success("เข้าสู่ระบบสำเร็จ ยินดีต้อนรับกลับมา");
        if (invite) {
          goToInvite(invite);
          return;
        }
        // Demo admins always land on their restricted dashboard
        navigate({ to: role === "demo_admin" ? homeForRole(role) : "/" });
      } catch (err: unknown) {
        const error = err as Error;
        toast.error(error.message || "ไม่สามารถเชื่อมต่อระบบได้");
      } finally {
        setLoading(false);
      }
      return;
    }

    // 3. Registration Flow
    if (mode === "register") {
      if (!name.trim()) {
        toast.error("กรุณากรอกชื่อ-นามสกุล");
        return;
      }
      if (!phone.trim() || phone.replace(/\D/g, "").length < 9) {
        toast.error("กรุณากรอกเบอร์โทรศัพท์ที่ติดต่อได้ (9-10 หลัก)");
        return;
      }
      if (!email.trim() || !email.includes("@")) {
        toast.error("กรุณากรอกอีเมลให้ถูกต้อง");
        return;
      }
      if (password.length < 6) {
        toast.error("รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร");
        return;
      }
      if (password !== confirmPassword) {
        toast.error("รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน");
        return;
      }

      setLoading(true);
      try {
        const cleanPhone = phone.replace(/\D/g, "");
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            // From an admin invitation, the confirmation link returns to it so the person can accept.
            // (Supabase falls back to the Site URL if this URL is not in its redirect allow list.)
            emailRedirectTo: invite
              ? invitationLink(window.location.origin, invite)
              : window.location.origin,
            data: {
              full_name: name.trim(),
              phone: cleanPhone,
            },
          },
        });

        if (error) {
          if (error.message.toLowerCase().includes("user already registered") || error.message.toLowerCase().includes("already registered")) {
            toast.error("อีเมลนี้ถูกลงทะเบียนไว้แล้ว กรุณาเข้าสู่ระบบ");
            switchMode("login");
          } else {
            toast.error(error.message || "เกิดข้อผิดพลาดในการลงทะเบียน");
          }
          return;
        }

        if (!data.session) {
          // Email confirmation is on: the account exists but cannot sign in until confirmed
          switchMode("login");
          setConfirmEmailFor(email.trim());
          toast.success("สมัครสมาชิกสำเร็จ กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ");
          return;
        }
        toast.success("สมัครสมาชิกสำเร็จ! ยินดีต้อนรับสู่ Siam Wheels");
        if (invite) {
          goToInvite(invite);
          return;
        }
        navigate({ to: "/" });
      } catch (err: unknown) {
        const error = err as Error;
        toast.error(error.message || "ไม่สามารถลงทะเบียนได้");
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-md flex-col justify-center px-4 py-12">
      {!authLoading && user && (
        <div role="status" className="mb-4 rounded-lg border bg-muted/40 p-4 text-sm">
          <p>
            คุณเข้าสู่ระบบอยู่แล้ว{isDemo ? " (บัญชีทดลอง DEMO)" : ""}
            {user.email && !isDemo ? <> ในชื่อ <strong>{user.email}</strong></> : null}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            การเข้าสู่ระบบด้วยบัญชีอื่นด้านล่างจะออกจากบัญชีปัจจุบันโดยอัตโนมัติ
          </p>
          <Button size="sm" className="mt-3" onClick={() => navigate({ to: homeForRole(role) })}>
            ไปที่หน้าหลักของบัญชีนี้
          </Button>
        </div>
      )}
      {invite && (
        <div role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">คุณกำลังรับคำเชิญเป็นผู้ดูแลระบบ</p>
          <p className="mt-1">
            เข้าสู่ระบบหรือสมัครด้วยอีเมลที่ได้รับเชิญ แล้วระบบจะพากลับไปหน้าคำเชิญ
            ต้องกด “ยอมรับคำเชิญ” ที่หน้านั้นจึงจะได้สิทธิ์ผู้ดูแล
          </p>
          {user && !authLoading && (
            <Button size="sm" variant="outline" className="mt-3 bg-white" onClick={() => goToInvite(invite)}>
              กลับไปหน้าคำเชิญด้วยบัญชีนี้
            </Button>
          )}
        </div>
      )}
      {confirmEmailFor && mode === "login" && (
        <div role="status" className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
          <p className="font-semibold">กรุณายืนยันอีเมลของคุณ</p>
          <p className="mt-1 text-muted-foreground">
            เราได้ส่งลิงก์ยืนยันไปที่ <strong className="break-all text-foreground">{confirmEmailFor}</strong> แล้ว
            กดลิงก์ในอีเมลก่อน แล้วจึงเข้าสู่ระบบด้านล่าง (หากไม่พบ โปรดตรวจสอบโฟลเดอร์สแปม)
          </p>
          {invite && (
            <p className="mt-2 text-muted-foreground">
              อีเมลนี้เป็นการยืนยันบัญชีเท่านั้น ยังไม่ใช่การรับคำเชิญ
              หลังยืนยันแล้วต้องกด “ยอมรับคำเชิญ” ในหน้าคำเชิญ
            </p>
          )}
        </div>
      )}
      <Card className="shadow-card border">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            {mode === "login" ? (
              <Lock className="h-6 w-6" />
            ) : mode === "register" ? (
              <User className="h-6 w-6" />
            ) : mode === "demo" ? (
              <MonitorPlay className="h-6 w-6" />
            ) : (
              <KeyRound className="h-6 w-6" />
            )}
          </div>
          <CardTitle className="text-2xl font-bold">
            {mode === "login"
              ? "เข้าสู่ระบบ"
              : mode === "register"
                ? "สมัครสมาชิกใหม่"
                : mode === "demo"
                  ? "เข้าสู่ระบบ Demo Admin"
                  : "รีเซ็ตรหัสผ่าน"}
          </CardTitle>
          <CardDescription>
            {mode === "login"
              ? "ยินดีต้อนรับกลับสู่ Siam Wheels Rental Hub"
              : mode === "register"
                ? "สร้างบัญชีผู้ใช้งานเพื่อเริ่มต้นจองรถเช่าออนไลน์ได้ทันที"
                : mode === "demo"
                  ? "สำหรับบัญชีสาธิตที่เจ้าของระบบสร้างให้เท่านั้น สิทธิ์จำกัด (ลบข้อมูลหรือเปลี่ยนสิทธิ์ผู้ใช้ไม่ได้)"
                  : "กรอกอีเมลของคุณเพื่อรับลิงก์สำหรับตั้งรหัสผ่านใหม่"}
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {/* Registration specific fields */}
            {mode === "register" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="auth-name" className="text-xs">ชื่อ-นามสกุล</Label>
                  <div className="relative">
                    <Input
                      id="auth-name"
                      placeholder="นายสมชาย มั่นคง"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="pl-9"
                    />
                    <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="auth-phone" className="text-xs">เบอร์โทรศัพท์มือถือ</Label>
                  <div className="relative">
                    <Input
                      id="auth-phone"
                      type="tel"
                      placeholder="0812345678"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                      className="pl-9 font-mono"
                    />
                    <Phone className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              </>
            )}

            {/* Email field (All modes) */}
            <div className="space-y-1.5">
              <Label htmlFor="auth-email" className="text-xs">อีเมล (Email)</Label>
              <div className="relative">
                <Input
                  id="auth-email"
                  type="email"
                  placeholder={mode === "demo" ? "demo-admin@example.com" : "customer@example.com"}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="pl-9"
                />
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              </div>
            </div>

            {/* Password field (Login and Register only) */}
            {mode !== "forgot" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="auth-pw" className="text-xs">รหัสผ่าน</Label>
                  {mode === "login" && (
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className="text-xs text-primary hover:underline"
                    >
                      ลืมรหัสผ่าน?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Input
                    id="auth-pw"
                    type="password"
                    placeholder="อย่างน้อย 6 ตัวอักษร"
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="pl-9"
                  />
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            )}

            {/* Confirm Password (Register only) */}
            {mode === "register" && (
              <div className="space-y-1.5">
                <Label htmlFor="auth-confirm-pw" className="text-xs">ยืนยันรหัสผ่าน</Label>
                <div className="relative">
                  <Input
                    id="auth-confirm-pw"
                    type="password"
                    placeholder="กรอกรหัสผ่านซ้ำอีกครั้ง"
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="pl-9"
                  />
                  <ShieldCheck className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            )}
          </CardContent>

          <CardFooter className="flex flex-col space-y-3 pt-2">
            <Button className="w-full text-base" type="submit" disabled={loading}>
              {loading
                ? "กำลังดำเนินการ..."
                : mode === "login" || mode === "demo"
                  ? "เข้าสู่ระบบ"
                  : mode === "register"
                    ? "สร้างบัญชีผู้ใช้งาน"
                    : "ส่งลิงก์รีเซ็ตรหัสผ่าน"}
            </Button>

            {mode === "login" && (
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => switchMode("register")}
              >
                ยังไม่มีบัญชีผู้ใช้? <span className="text-primary font-medium underline">สมัครสมาชิก</span>
              </button>
            )}

            {mode === "login" && DEMO_ADMIN_SIGN_IN_ENABLED && (
              <button
                type="button"
                className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
                onClick={() => switchMode("demo")}
              >
                <MonitorPlay className="mr-1 h-3.5 w-3.5" /> เข้าสู่ระบบสำหรับผู้ดูแลระบบสาธิต (Demo Admin)
              </button>
            )}

            {mode === "register" && (
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => switchMode("login")}
              >
                มีบัญชีผู้ใช้งานแล้ว? <span className="text-primary font-medium underline">เข้าสู่ระบบ</span>
              </button>
            )}

            {(mode === "forgot" || mode === "demo") && (
              <button
                type="button"
                className="inline-flex items-center text-sm text-primary hover:underline"
                onClick={() => switchMode("login")}
              >
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> กลับสู่หน้าเข้าสู่ระบบ
              </button>
            )}
          </CardFooter>
        </form>
      </Card>
      {/* Demo Customer: separate from the Demo Admin sign-in, so hide it on that screen */}
      {(mode === "login" || mode === "register") && (
        <Card className="mt-4 border-dashed border-accent">
          <CardContent className="space-y-3 pt-6 text-center">
            <p className="text-sm font-semibold">โหมดทดลองลูกค้า (Demo Customer)</p>
            <p className="text-xs text-muted-foreground">
              สร้างบัญชีลูกค้าทดลองพร้อมข้อมูลสมมติทันที ไม่ต้องใช้อีเมลหรือเบอร์โทรจริง บัญชีทดลองเป็นลูกค้าเท่านั้น ไม่สามารถเป็นผู้ดูแลระบบได้ และการชำระเงินเป็นการจำลอง
            </p>
            <p className="text-xs text-muted-foreground">
              หมายเหตุ: เมื่อออกจากระบบแล้วจะกลับเข้าบัญชีทดลองเดิมไม่ได้ ต้องสร้างบัญชีทดลองใหม่
            </p>
            <Button type="button" variant="outline" className="w-full" disabled={loading} onClick={startDemo}>
              {loading ? "กำลังสร้างบัญชีทดลอง..." : "ทดลองใช้งานในฐานะลูกค้าตัวอย่าง"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
