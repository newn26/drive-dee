import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  FileText,
  KeyRound,
  Lock,
  Mail,
  MapPin,
  Phone,
  Save,
  ShieldCheck,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/load-error";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "โปรไฟล์และข้อมูลผู้ขับขี่ — Siam Wheels Rental Hub" },
      { name: "description", content: "จัดการข้อมูลส่วนตัว ข้อมูลใบอนุญาตขับขี่ และความปลอดภัยของบัญชีผู้ใช้งาน" },
      { property: "og:title", content: "โปรไฟล์ของฉัน — Siam Wheels" },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, isDemo, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [savingProfile, setSavingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Form states for profile
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [licenseNo, setLicenseNo] = useState("");
  const [idCardNo, setIdCardNo] = useState("");

  // Form states for password change
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Fetch current user profile
  const {
    data: profile,
    isLoading: profileLoading,
    isError: profileError,
    refetch: refetchProfile,
  } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

      if (error) throw error;
      return data as Tables<"profiles"> | null;
    },
    enabled: !!user,
  });

  // Populate profile fields once loaded
  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
      setPhone(profile.phone || "");
      setAddress(profile.address || "");
      setLicenseNo(profile.license_no || "");
      setIdCardNo(profile.id_card_no || "");
    } else if (user) {
      setFullName(user.user_metadata?.["full_name"] || "");
      setPhone(user.user_metadata?.["phone"] || "");
    }
  }, [profile, user]);

  // Handle saving profile information
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!fullName.trim()) {
      toast.error("กรุณาระบุชื่อ-นามสกุลจริง");
      return;
    }

    setSavingProfile(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .upsert({
          id: user.id,
          full_name: fullName.trim(),
          phone: phone.trim(),
          address: address.trim(),
          license_no: licenseNo.trim(),
          id_card_no: idCardNo.trim(),
          updated_at: new Date().toISOString(),
        });

      if (error) throw error;

      toast.success("บันทึกข้อมูลโปรไฟล์และข้อมูลผู้ขับขี่เรียบร้อยแล้ว");
      await queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || "ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSavingProfile(false);
    }
  };

  // Handle password change
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.length < 6) {
      toast.error("รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 6 ตัวอักษร");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน");
      return;
    }

    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      toast.success("เปลี่ยนรหัสผ่านสำเร็จเรียบร้อยแล้ว");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || "ไม่สามารถเปลี่ยนรหัสผ่านได้");
    } finally {
      setChangingPassword(false);
    }
  };

  // Loading indicator
  if (authLoading || profileLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-20 text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="mt-4 text-muted-foreground">กำลังโหลดข้อมูลโปรไฟล์...</p>
      </div>
    );
  }

  // Authentication check
  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-warning" />
        <h2 className="mt-4 text-2xl font-semibold">กรุณาเข้าสู่ระบบ</h2>
        <p className="mt-2 text-sm text-muted-foreground">คุณต้องเข้าสู่ระบบก่อนจึงจะสามารถจัดการข้อมูลโปรไฟล์ได้</p>
        <Button className="mt-6 w-full" onClick={() => navigate({ to: "/auth" })}>
          เข้าสู่ระบบ / สมัครสมาชิก
        </Button>
      </div>
    );
  }

  // Never show the form with empty fields after a failed load: saving it would wipe saved details
  if (profileError) {
    return <LoadError title="โหลดข้อมูลโปรไฟล์ไม่สำเร็จ" onRetry={() => void refetchProfile()} />;
  }

  const isLicenseComplete = !!licenseNo.trim();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {isDemo && (
        <div className="mb-6 rounded-lg border border-dashed border-accent bg-accent/10 p-4 text-sm">
          <strong>บัญชีทดลอง (DEMO):</strong> ข้อมูลในบัญชีนี้เป็นข้อมูลสมมติ กรุณาอย่ากรอกข้อมูลส่วนตัวจริง เช่น เบอร์โทร เลขบัตรประชาชน หรือเลขใบขับขี่
        </div>
      )}
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">โปรไฟล์และข้อมูลผู้ขับขี่</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            จัดการข้อมูลส่วนตัว เอกสารสำหรับเช่ารถ และความปลอดภัยของบัญชี
          </p>
        </div>
        <div>
          {isLicenseComplete ? (
            <Badge variant="outline" className="border-success/30 bg-success/10 text-success gap-1.5 py-1 px-3">
              <CheckCircle2 className="h-4 w-4" /> ข้อมูลผู้ขับขี่พร้อมใช้งาน
            </Badge>
          ) : (
            <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning gap-1.5 py-1 px-3">
              <AlertCircle className="h-4 w-4" /> รอระบุข้อมูลใบขับขี่
            </Badge>
          )}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-12">
        {/* Left Column: Personal & Driver Info (8 Cols) */}
        <div className="space-y-6 lg:col-span-8">
          <Card className="shadow-card border">
            <CardHeader>
              <div className="flex items-center gap-2.5">
                <User className="h-5 w-5 text-primary" />
                <CardTitle className="text-xl">ข้อมูลส่วนตัวและผู้ขับขี่</CardTitle>
              </div>
              <CardDescription>
                ข้อมูลนี้จะถูกใช้เพื่อจัดทำสัญญาเช่ารถยนต์และออกเอกสารยืนยันการรับรถ
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleSaveProfile}>
              <CardContent className="space-y-5">
                {/* Full Name & Email */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="prof-name" className="text-xs">ชื่อ-นามสกุลจริง *</Label>
                    <Input
                      id="prof-name"
                      placeholder="นายสมชาย มั่นคง"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="prof-email" className="text-xs">อีเมล (ใช้เข้าสู่ระบบ)</Label>
                    <div className="relative">
                      <Input
                        id="prof-email"
                        value={user.email || ""}
                        disabled
                        className="bg-muted text-muted-foreground"
                      />
                      <Mail className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </div>

                {/* Phone & National ID */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="prof-phone" className="text-xs">เบอร์โทรศัพท์ติดต่อ</Label>
                    <div className="relative">
                      <Input
                        id="prof-phone"
                        placeholder="0812345678"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="font-mono"
                      />
                      <Phone className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="prof-idcard" className="text-xs">เลขบัตรประชาชน / พาสปอร์ต</Label>
                    <div className="relative">
                      <Input
                        id="prof-idcard"
                        placeholder="1100000000000"
                        value={idCardNo}
                        onChange={(e) => setIdCardNo(e.target.value)}
                        className="font-mono"
                      />
                      <CreditCard className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </div>

                {/* Driver's License Number */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="prof-license" className="text-xs font-semibold text-foreground">
                      หมายเลขใบอนุญาตขับขี่รถยนต์ (Driver's License No.) *
                    </Label>
                    <span className="text-[11px] text-muted-foreground">จำเป็นสำหรับการเช่ารถ</span>
                  </div>
                  <div className="relative">
                    <Input
                      id="prof-license"
                      placeholder="เช่น 12345678"
                      value={licenseNo}
                      onChange={(e) => setLicenseNo(e.target.value)}
                      className="font-mono"
                    />
                    <FileText className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    ผู้เช่าต้องแสดงใบอนุญาตขับขี่ตัวจริงที่ยังไม่หมดอายุ ณ วันรับรถยนต์
                  </p>
                </div>

                {/* Contact Address */}
                <div className="space-y-1.5">
                  <Label htmlFor="prof-address" className="text-xs">ที่อยู่สำหรับออกเอกสาร</Label>
                  <Textarea
                    id="prof-address"
                    rows={3}
                    placeholder="เลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
              </CardContent>

              <CardFooter className="flex justify-end border-t pt-4">
                <Button type="submit" disabled={savingProfile} className="gap-2">
                  <Save className="h-4 w-4" />
                  {savingProfile ? "กำลังบันทึก..." : "บันทึกข้อมูลส่วนตัว"}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>

        {/* Right Column: Security & Privacy (4 Cols) */}
        <div className="space-y-6 lg:col-span-4">
          {/* Change Password Card */}
          <Card className="shadow-card border">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">เปลี่ยนรหัสผ่าน</CardTitle>
              </div>
              <CardDescription>
                ตั้งรหัสผ่านใหม่เพื่อความปลอดภัยในการเข้าใช้งาน
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleChangePassword}>
              <CardContent className="space-y-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="new-pw" className="text-xs">รหัสผ่านใหม่</Label>
                  <div className="relative">
                    <Input
                      id="new-pw"
                      type="password"
                      placeholder="อย่างน้อย 6 ตัวอักษร"
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                    />
                    <Lock className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirm-pw" className="text-xs">ยืนยันรหัสผ่านใหม่</Label>
                  <div className="relative">
                    <Input
                      id="confirm-pw"
                      type="password"
                      placeholder="กรอกรหัสผ่านซ้ำอีกครั้ง"
                      minLength={6}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                    />
                    <Lock className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>

              <CardFooter className="border-t pt-3.5">
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={changingPassword || !newPassword}
                  className="w-full"
                >
                  {changingPassword ? "กำลังอัปเดตรหัสผ่าน..." : "เปลี่ยนรหัสผ่าน"}
                </Button>
              </CardFooter>
            </form>
          </Card>

          {/* Privacy & Security Guarantee Card */}
          <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground space-y-2 shadow-sm">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <span>การคุ้มครองข้อมูลส่วนบุคคล</span>
            </div>
            <p className="text-xs leading-relaxed">
              ข้อมูลใบขับขี่และข้อมูลระบุตัวตนของคุณได้รับการปกป้องตามมาตรฐาน PDPA เพื่อใช้ในการทำสัญญาเช่ารถยนต์เท่านั้น และจะไม่ถูกนำไปเปิดเผยต่อบุคคลภายนอก
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
