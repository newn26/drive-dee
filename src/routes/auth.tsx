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
import { tr } from "@/lib/i18n";

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
      toast.success(tr("เข้าสู่ระบบด้วยบัญชีทดลองแล้ว (ข้อมูลสมมติ)", "Signed in with a demo account (fictional data)"));
      navigate({ to: "/" });
    } catch {
      toast.error(tr("ไม่สามารถเริ่มโหมดทดลองได้ กรุณาลองใหม่", "Could not start demo mode. Please try again."));
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
        toast.error(tr("กรุณากรอกอีเมลที่ถูกต้อง", "Please enter a valid email"));
        return;
      }
      setLoading(true);
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth?reset=true`,
        });
        if (error) {
          toast.error(error.message || tr("ไม่สามารถส่งคำขอรีเซ็ตรหัสผ่านได้", "Could not send the password reset request"));
        } else {
          toast.success(tr("ส่งลิงก์สำหรับรีเซ็ตรหัสผ่านไปยังอีเมลของคุณเรียบร้อยแล้ว", "A password reset link has been sent to your email"));
          switchMode("login");
        }
      } catch (err: unknown) {
        const error = err as Error;
        toast.error(error.message || tr("เกิดข้อผิดพลาดในการเชื่อมต่อ", "A connection error occurred"));
      } finally {
        setLoading(false);
      }
      return;
    }

    // 2. Sign In Flow (customer/admin, or the separate Demo Admin option)
    if (mode === "login" || mode === "demo") {
      if (!email.trim() || !password) {
        toast.error(tr("กรุณากรอกอีเมลและรหัสผ่าน", "Please enter your email and password"));
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
            toast.error(tr("อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง", "Incorrect email or password. Please check and try again."));
          } else if (error.message.toLowerCase().includes("email not confirmed")) {
            toast.error(tr("อีเมลนี้ยังไม่ได้ยืนยัน กรุณากดลิงก์ยืนยันในอีเมลของคุณก่อนเข้าสู่ระบบ", "This email is not confirmed yet. Please click the confirmation link in your email before signing in."));
          } else {
            toast.error(error.message || tr("เกิดข้อผิดพลาดในการเข้าสู่ระบบ", "Sign-in failed"));
          }
          return;
        }

        // The role comes from user_roles in the database, never from the form.
        const role = data.user ? await fetchRole(data.user) : "customer";

        if (mode === "demo") {
          if (role !== "demo_admin") {
            await supabase.auth.signOut();
            toast.error(tr("บัญชีนี้ไม่ใช่บัญชีผู้ดูแลระบบสาธิต (Demo Admin)", "This account is not a Demo Admin account"));
            return;
          }
          toast.success(tr("เข้าสู่ระบบโหมดสาธิต (Demo Admin) สำเร็จ", "Signed in to demo mode (Demo Admin)"));
          navigate({ to: "/demo-admin" });
          return;
        }

        toast.success(tr("เข้าสู่ระบบสำเร็จ ยินดีต้อนรับกลับมา", "Signed in. Welcome back!"));
        if (invite) {
          goToInvite(invite);
          return;
        }
        // Admins land on the admin dashboard, demo admins on their restricted one, customers on home
        navigate({ to: homeForRole(role) });
      } catch (err: unknown) {
        const error = err as Error;
        toast.error(error.message || tr("ไม่สามารถเชื่อมต่อระบบได้", "Could not connect to the system"));
      } finally {
        setLoading(false);
      }
      return;
    }

    // 3. Registration Flow
    if (mode === "register") {
      if (!name.trim()) {
        toast.error(tr("กรุณากรอกชื่อ-นามสกุล", "Please enter your full name"));
        return;
      }
      if (!phone.trim() || phone.replace(/\D/g, "").length < 9) {
        toast.error(tr("กรุณากรอกเบอร์โทรศัพท์ที่ติดต่อได้ (9-10 หลัก)", "Please enter a contact phone number (9-10 digits)"));
        return;
      }
      if (!email.trim() || !email.includes("@")) {
        toast.error(tr("กรุณากรอกอีเมลให้ถูกต้อง", "Please enter a valid email"));
        return;
      }
      if (password.length < 6) {
        toast.error(tr("รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร", "The password must be at least 6 characters"));
        return;
      }
      if (password !== confirmPassword) {
        toast.error(tr("รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน", "The passwords do not match"));
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
            toast.error(tr("อีเมลนี้ถูกลงทะเบียนไว้แล้ว กรุณาเข้าสู่ระบบ", "This email is already registered. Please sign in."));
            switchMode("login");
          } else {
            toast.error(error.message || tr("เกิดข้อผิดพลาดในการลงทะเบียน", "Sign-up failed"));
          }
          return;
        }

        if (!data.session) {
          // Email confirmation is on: the account exists but cannot sign in until confirmed
          switchMode("login");
          setConfirmEmailFor(email.trim());
          toast.success(tr("สมัครสมาชิกสำเร็จ กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ", "Signed up. Please confirm your email before signing in."));
          return;
        }
        toast.success(tr("สมัครสมาชิกสำเร็จ! ยินดีต้อนรับสู่ Drive Dee", "Signed up! Welcome to Drive Dee"));
        if (invite) {
          goToInvite(invite);
          return;
        }
        navigate({ to: "/" });
      } catch (err: unknown) {
        const error = err as Error;
        toast.error(error.message || tr("ไม่สามารถลงทะเบียนได้", "Could not sign up"));
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
            {tr("คุณเข้าสู่ระบบอยู่แล้ว", "You are already signed in")}{isDemo ? tr(" (บัญชีทดลอง DEMO)", " (DEMO account)") : ""}
            {user.email && !isDemo ? <> {tr("ในชื่อ", "as")} <strong>{user.email}</strong></> : null}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {tr("การเข้าสู่ระบบด้วยบัญชีอื่นด้านล่างจะออกจากบัญชีปัจจุบันโดยอัตโนมัติ", "Signing in with another account below will sign you out of the current one.")}
          </p>
          <Button size="sm" className="mt-3" onClick={() => navigate({ to: homeForRole(role) })}>
            {tr("ไปที่หน้าหลักของบัญชีนี้", "Go to this account's home page")}
          </Button>
        </div>
      )}
      {invite && (
        <div role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">{tr("คุณกำลังรับคำเชิญเป็นผู้ดูแลระบบ", "You are accepting an admin invitation")}</p>
          <p className="mt-1">
            {tr("เข้าสู่ระบบหรือสมัครด้วยอีเมลที่ได้รับเชิญ แล้วระบบจะพากลับไปหน้าคำเชิญ ต้องกด “ยอมรับคำเชิญ” ที่หน้านั้นจึงจะได้สิทธิ์ผู้ดูแล", "Sign in or sign up with the invited email and you will be taken back to the invitation. You must click “Accept invitation” there to get admin access.")}
          </p>
          {user && !authLoading && (
            <Button size="sm" variant="outline" className="mt-3 bg-white" onClick={() => goToInvite(invite)}>
              {tr("กลับไปหน้าคำเชิญด้วยบัญชีนี้", "Back to the invitation with this account")}
            </Button>
          )}
        </div>
      )}
      {confirmEmailFor && mode === "login" && (
        <div role="status" className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
          <p className="font-semibold">{tr("กรุณายืนยันอีเมลของคุณ", "Please confirm your email")}</p>
          <p className="mt-1 text-muted-foreground">
            {tr("เราได้ส่งลิงก์ยืนยันไปที่", "We sent a confirmation link to")} <strong className="break-all text-foreground">{confirmEmailFor}</strong> {tr("แล้ว กดลิงก์ในอีเมลก่อน แล้วจึงเข้าสู่ระบบด้านล่าง (หากไม่พบ โปรดตรวจสอบโฟลเดอร์สแปม)", "— click the link in the email first, then sign in below (check your spam folder if you cannot find it).")}
          </p>
          {invite && (
            <p className="mt-2 text-muted-foreground">
              {tr("อีเมลนี้เป็นการยืนยันบัญชีเท่านั้น ยังไม่ใช่การรับคำเชิญ หลังยืนยันแล้วต้องกด “ยอมรับคำเชิญ” ในหน้าคำเชิญ", "This email only confirms your account; it does not accept the invitation. After confirming, click “Accept invitation” on the invitation page.")}
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
              ? tr("เข้าสู่ระบบ", "Sign in")
              : mode === "register"
                ? tr("สมัครสมาชิกใหม่", "Create an account")
                : mode === "demo"
                  ? tr("เข้าสู่ระบบ Demo Admin", "Demo Admin sign-in")
                  : tr("รีเซ็ตรหัสผ่าน", "Reset password")}
          </CardTitle>
          <CardDescription>
            {mode === "login"
              ? tr("ยินดีต้อนรับกลับสู่ Drive Dee", "Welcome back to Drive Dee")
              : mode === "register"
                ? tr("สร้างบัญชีผู้ใช้งานเพื่อเริ่มต้นจองรถเช่าออนไลน์ได้ทันที", "Create an account to start booking rental cars online")
                : mode === "demo"
                  ? tr("สำหรับบัญชีสาธิตที่เจ้าของระบบสร้างให้เท่านั้น สิทธิ์จำกัด (ลบข้อมูลหรือเปลี่ยนสิทธิ์ผู้ใช้ไม่ได้)", "Only for demo accounts created by the owner. Limited access (cannot delete data or change user permissions).")
                  : tr("กรอกอีเมลของคุณเพื่อรับลิงก์สำหรับตั้งรหัสผ่านใหม่", "Enter your email to receive a link to set a new password")}
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {/* Registration specific fields */}
            {mode === "register" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="auth-name" className="text-xs">{tr("ชื่อ-นามสกุล", "Full name")}</Label>
                  <div className="relative">
                    <Input
                      id="auth-name"
                      placeholder={tr("นายสมชาย มั่นคง", "John Smith")}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="pl-9"
                    />
                    <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="auth-phone" className="text-xs">{tr("เบอร์โทรศัพท์มือถือ", "Mobile phone number")}</Label>
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
              <Label htmlFor="auth-email" className="text-xs">{tr("อีเมล (Email)", "Email")}</Label>
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
                  <Label htmlFor="auth-pw" className="text-xs">{tr("รหัสผ่าน", "Password")}</Label>
                  {mode === "login" && (
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className="text-xs text-primary hover:underline"
                    >
                      {tr("ลืมรหัสผ่าน?", "Forgot password?")}
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Input
                    id="auth-pw"
                    type="password"
                    placeholder={tr("อย่างน้อย 6 ตัวอักษร", "At least 6 characters")}
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
                <Label htmlFor="auth-confirm-pw" className="text-xs">{tr("ยืนยันรหัสผ่าน", "Confirm password")}</Label>
                <div className="relative">
                  <Input
                    id="auth-confirm-pw"
                    type="password"
                    placeholder={tr("กรอกรหัสผ่านซ้ำอีกครั้ง", "Enter the password again")}
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
                ? tr("กำลังดำเนินการ...", "Working...")
                : mode === "login" || mode === "demo"
                  ? tr("เข้าสู่ระบบ", "Sign in")
                  : mode === "register"
                    ? tr("สร้างบัญชีผู้ใช้งาน", "Create account")
                    : tr("ส่งลิงก์รีเซ็ตรหัสผ่าน", "Send reset link")}
            </Button>

            {mode === "login" && (
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => switchMode("register")}
              >
                {tr("ยังไม่มีบัญชีผู้ใช้?", "Don't have an account?")} <span className="text-primary font-medium underline">{tr("สมัครสมาชิก", "Sign up")}</span>
              </button>
            )}

            {mode === "login" && DEMO_ADMIN_SIGN_IN_ENABLED && (
              <button
                type="button"
                className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
                onClick={() => switchMode("demo")}
              >
                <MonitorPlay className="mr-1 h-3.5 w-3.5" /> {tr("เข้าสู่ระบบสำหรับผู้ดูแลระบบสาธิต (Demo Admin)", "Sign in as a Demo Admin")}
              </button>
            )}

            {mode === "register" && (
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => switchMode("login")}
              >
                {tr("มีบัญชีผู้ใช้งานแล้ว?", "Already have an account?")} <span className="text-primary font-medium underline">{tr("เข้าสู่ระบบ", "Sign in")}</span>
              </button>
            )}

            {(mode === "forgot" || mode === "demo") && (
              <button
                type="button"
                className="inline-flex items-center text-sm text-primary hover:underline"
                onClick={() => switchMode("login")}
              >
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> {tr("กลับสู่หน้าเข้าสู่ระบบ", "Back to sign-in")}
              </button>
            )}
          </CardFooter>
        </form>
      </Card>
      {/* Demo Customer: separate from the Demo Admin sign-in, so hide it on that screen */}
      {(mode === "login" || mode === "register") && (
        <Card className="mt-4 border-dashed border-accent">
          <CardContent className="space-y-3 pt-6 text-center">
            <p className="text-sm font-semibold">{tr("โหมดทดลองลูกค้า (Demo Customer)", "Demo Customer mode")}</p>
            <p className="text-xs text-muted-foreground">
              {tr("สร้างบัญชีลูกค้าทดลองพร้อมข้อมูลสมมติทันที ไม่ต้องใช้อีเมลหรือเบอร์โทรจริง บัญชีทดลองเป็นลูกค้าเท่านั้น ไม่สามารถเป็นผู้ดูแลระบบได้ และการชำระเงินเป็นการจำลอง", "Create a demo customer account with fictional data instantly, with no real email or phone needed. Demo accounts are customers only, can never be admins, and payments are simulated.")}
            </p>
            <p className="text-xs text-muted-foreground">
              {tr("หมายเหตุ: เมื่อออกจากระบบแล้วจะกลับเข้าบัญชีทดลองเดิมไม่ได้ ต้องสร้างบัญชีทดลองใหม่", "Note: once you sign out you cannot return to the same demo account; create a new one instead.")}
            </p>
            <Button type="button" variant="outline" className="w-full" disabled={loading} onClick={startDemo}>
              {loading ? tr("กำลังสร้างบัญชีทดลอง...", "Creating demo account...") : tr("ทดลองใช้งานในฐานะลูกค้าตัวอย่าง", "Try it as a sample customer")}
            </Button>
          </CardContent>
        </Card>
      )}
      {/* Demo Admin: the admin dashboard on in-browser sample data (no account, no real data) */}
      {(mode === "login" || mode === "register") && (
        <Card className="mt-4 border-dashed border-amber-400" data-testid="demo-admin-card">
          <CardContent className="space-y-3 pt-6 text-center">
            <p className="text-sm font-semibold">{tr("โหมดทดลองผู้ดูแลระบบ (Demo Admin)", "Demo Admin mode")}</p>
            <p className="text-xs text-muted-foreground">
              {tr(
                "เปิดหน้าผู้ดูแลระบบด้วยข้อมูลตัวอย่างทันที ไม่ต้องมีบัญชี ลองจัดการรถ การจอง สัญญา รายงาน และผู้ดูแลได้ทุกเมนู ข้อมูลทั้งหมดเป็นข้อมูลสมมติ ไม่เห็นข้อมูลลูกค้าจริง และการเปลี่ยนแปลงไม่ถูกบันทึก",
                "Open the admin dashboard with sample data instantly, no account needed. Try cars, bookings, contracts, reports and admin management. Everything is fictional, no real customer data is shown, and nothing is saved.",
              )}
            </p>
            <Button type="button" variant="outline" className="w-full gap-1.5" onClick={() => navigate({ to: "/demo-admin" })}>
              <MonitorPlay className="h-4 w-4" /> {tr("ทดลองใช้งานในฐานะผู้ดูแลระบบ", "Try it as an admin")}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
