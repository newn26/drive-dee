import { useState } from "react";
import { KeyRound, Lock } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { MIN_PASSWORD_LENGTH, validatePasswordChange } from "@/lib/password";

/**
 * Change the password of the signed-in user. The current password is checked first by
 * signing in again with it; only then is the new password saved.
 */
export function ChangePasswordCard({ email, isDemo }: { email: string; isDemo: boolean }) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setCurrent("");
    setPassword("");
    setConfirm("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validatePasswordChange(current, password, confirm);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      // 1. Confirm it is really the account owner
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      if (verifyError) {
        toast.error("รหัสผ่านปัจจุบันไม่ถูกต้อง");
        setCurrent("");
        return;
      }
      // 2. Save the new password
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("เปลี่ยนรหัสผ่านสำเร็จเรียบร้อยแล้ว");
      reset();
    } catch (err: unknown) {
      toast.error((err as Error).message || "ไม่สามารถเปลี่ยนรหัสผ่านได้");
    } finally {
      setBusy(false);
    }
  };

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    autoComplete: string,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type="password"
          placeholder={placeholder}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={isDemo || busy}
          required
        />
        <Lock className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
      </div>
    </div>
  );

  return (
    <Card className="shadow-card border">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">เปลี่ยนรหัสผ่าน</CardTitle>
        </div>
        <CardDescription>
          กรอกรหัสผ่านปัจจุบันเพื่อยืนยันว่าเป็นเจ้าของบัญชี แล้วตั้งรหัสผ่านใหม่
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-3.5">
          {isDemo && (
            <p
              className="rounded-lg border bg-muted/40 p-2.5 text-xs text-muted-foreground"
              data-testid="demo-password-note"
            >
              บัญชีทดลองไม่มีรหัสผ่านที่คุณรู้ จึงเปลี่ยนรหัสผ่านไม่ได้
            </p>
          )}
          {field(
            "current-pw",
            "รหัสผ่านปัจจุบัน",
            current,
            setCurrent,
            "รหัสผ่านที่ใช้อยู่ตอนนี้",
            "current-password",
          )}
          {field(
            "new-pw",
            "รหัสผ่านใหม่",
            password,
            setPassword,
            `อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`,
            "new-password",
          )}
          {field(
            "confirm-pw",
            "ยืนยันรหัสผ่านใหม่",
            confirm,
            setConfirm,
            "กรอกรหัสผ่านใหม่ซ้ำอีกครั้ง",
            "new-password",
          )}
        </CardContent>

        <CardFooter className="border-t pt-3.5">
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={isDemo || busy || !current || !password}
            className="w-full"
          >
            {busy ? "กำลังตรวจสอบและอัปเดตรหัสผ่าน..." : "เปลี่ยนรหัสผ่าน"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
