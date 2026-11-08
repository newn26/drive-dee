import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "เข้าสู่ระบบ — ไดร์ฟดี รถเช่า" }, { name: "description", content: "เข้าสู่ระบบหรือสมัครสมาชิก" }, { property: "og:title", content: "เข้าสู่ระบบ — ไดร์ฟดี" }, { property: "og:description", content: "เข้าสู่ระบบหรือสมัครสมาชิก" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
      if (error) return toast.error("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
      navigate({ to: "/" });
    } else {
      const { error } = await supabase.auth.signUp({ email, password: pw, options: { emailRedirectTo: window.location.origin, data: { full_name: name } } });
      if (error) return toast.error(error.message);
      toast.success("สมัครสำเร็จ กรุณายืนยันอีเมลของคุณ");
    }
  };
  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-2xl font-semibold">{mode === "in" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}</h1>
      <form onSubmit={submit} className="space-y-3 rounded-2xl border bg-card p-6 shadow-card">
        {mode === "up" && <Input placeholder="ชื่อ-นามสกุล" value={name} onChange={(e) => setName(e.target.value)} required />}
        <Input type="email" placeholder="อีเมล" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input type="password" placeholder="รหัสผ่าน" minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} required />
        <Button className="w-full" type="submit">{mode === "in" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}</Button>
        <button type="button" className="w-full text-sm text-primary" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "ยังไม่มีบัญชี? สมัครสมาชิก" : "มีบัญชีแล้ว? เข้าสู่ระบบ"}
        </button>
      </form>
    </div>
  );
}
