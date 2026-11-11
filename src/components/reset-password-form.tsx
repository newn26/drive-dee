import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, KeyRound, Lock, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { MIN_PASSWORD_LENGTH, recoveryLinkError, validateNewPassword } from "@/lib/password";

/** How long to wait for Supabase to read the recovery session from the link. */
export const RECOVERY_SESSION_TIMEOUT_MS = 5000;

type Stage = "checking" | "ready" | "invalid" | "done";

/**
 * Shown on /auth?reset=true, where the password-reset email link lands.
 * Supabase signs the user in from the link (a recovery session); this form then
 * sets the new password with auth.updateUser.
 */
export function ResetPasswordForm({
  onDone,
  onRequestNewLink,
}: {
  onDone: () => void;
  onRequestNewLink: () => void;
}) {
  const [stage, setStage] = useState<Stage>("checking");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const urlError = recoveryLinkError(window.location.hash, window.location.search);
    if (urlError) {
      setLinkError(urlError);
      setStage("invalid");
      return;
    }

    let settled = false;
    const markReady = () => {
      if (settled) return;
      settled = true;
      setStage("ready");
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        session &&
        (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || event === "INITIAL_SESSION")
      )
        markReady();
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) markReady();
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      setLinkError("ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุ กรุณาขอลิงก์ใหม่");
      setStage("invalid");
    }, RECOVERY_SESSION_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateNewPassword(password, confirm);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast.error(
          /different from the old/i.test(error.message)
            ? "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม"
            : error.message || "ไม่สามารถตั้งรหัสผ่านใหม่ได้",
        );
        return;
      }
      setPassword("");
      setConfirm("");
      setStage("done");
      toast.success("ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว");
      onDone();
    } catch (err: unknown) {
      toast.error((err as Error).message || "เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="shadow-card border">
      <CardHeader className="space-y-1 text-center">
        <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <KeyRound className="h-6 w-6" />
        </div>
        <CardTitle className="text-2xl font-bold">ตั้งรหัสผ่านใหม่</CardTitle>
        <CardDescription>กรอกรหัสผ่านใหม่สำหรับบัญชีของคุณ</CardDescription>
      </CardHeader>

      {stage === "checking" && (
        <CardContent className="py-6 text-center text-sm text-muted-foreground" role="status">
          กำลังตรวจสอบลิงก์รีเซ็ตรหัสผ่าน...
        </CardContent>
      )}

      {stage === "invalid" && (
        <>
          <CardContent>
            <div
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              role="alert"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{linkError}</span>
            </div>
          </CardContent>
          <CardFooter>
            <Button className="w-full" onClick={onRequestNewLink}>
              ขอลิงก์รีเซ็ตรหัสผ่านใหม่
            </Button>
          </CardFooter>
        </>
      )}

      {stage === "done" && (
        <CardContent>
          <div
            className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success"
            role="status"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว</span>
          </div>
        </CardContent>
      )}

      {stage === "ready" && (
        <form onSubmit={submit}>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reset-pw" className="text-xs">
                รหัสผ่านใหม่
              </Label>
              <div className="relative">
                <Input
                  id="reset-pw"
                  type="password"
                  autoComplete="new-password"
                  placeholder={`อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`}
                  minLength={MIN_PASSWORD_LENGTH}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pl-9"
                />
                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reset-pw-confirm" className="text-xs">
                ยืนยันรหัสผ่านใหม่
              </Label>
              <div className="relative">
                <Input
                  id="reset-pw-confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="กรอกรหัสผ่านซ้ำอีกครั้ง"
                  minLength={MIN_PASSWORD_LENGTH}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  className="pl-9"
                />
                <ShieldCheck className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button className="w-full text-base" type="submit" disabled={saving}>
              {saving ? "กำลังบันทึก..." : "บันทึกรหัสผ่านใหม่"}
            </Button>
          </CardFooter>
        </form>
      )}
    </Card>
  );
}
