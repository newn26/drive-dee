import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  FileText,
  Mail,
  MapPin,
  Phone,
  Save,
  ShieldCheck,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/load-error";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { ChangePasswordCard } from "@/components/change-password-card";
import { useAuth } from "@/hooks/use-auth";
import type { Tables } from "@/integrations/supabase/types";
import {
  type ProfileErrors,
  normalizeIdCard,
  normalizeLicense,
  normalizePhone,
  profileErrors,
} from "@/lib/profile-validation";
import { tr, trError } from "@/lib/i18n";

function FieldError({ id, message }: { id: string; message?: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "โปรไฟล์และข้อมูลผู้ขับขี่ — Drive Dee" },
      {
        name: "description",
        content: "จัดการข้อมูลส่วนตัว ข้อมูลใบอนุญาตขับขี่ และความปลอดภัยของบัญชีผู้ใช้งาน",
      },
      { property: "og:title", content: "โปรไฟล์ของฉัน — Drive Dee" },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, isDemo, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [savingProfile, setSavingProfile] = useState(false);

  // Form states for profile
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [licenseNo, setLicenseNo] = useState("");
  const [idCardNo, setIdCardNo] = useState("");
  const [errors, setErrors] = useState<ProfileErrors>({});

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

    const problems = profileErrors({ fullName, phone, idCardNo, licenseNo });
    setErrors(problems);
    if (Object.keys(problems).length > 0) {
      toast.error(tr("กรุณาตรวจสอบข้อมูลที่กรอกให้ถูกต้อง", "Please check the details you entered"));
      return;
    }

    setSavingProfile(true);
    try {
      const { error } = await supabase.from("profiles").upsert({
        id: user.id,
        full_name: fullName.trim(),
        phone: normalizePhone(phone),
        address: address.trim(),
        license_no: normalizeLicense(licenseNo),
        id_card_no: normalizeIdCard(idCardNo),
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;

      toast.success(tr("บันทึกข้อมูลโปรไฟล์และข้อมูลผู้ขับขี่เรียบร้อยแล้ว", "Profile and driver details saved"));
      await queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(trError(error.message) || tr("ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง", "Could not save. Please try again."));
    } finally {
      setSavingProfile(false);
    }
  };

  // Loading indicator
  if (authLoading || profileLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-20 text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="mt-4 text-muted-foreground">{tr("กำลังโหลดข้อมูลโปรไฟล์...", "Loading your profile...")}</p>
      </div>
    );
  }

  // Authentication check
  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-warning" />
        <h2 className="mt-4 text-2xl font-semibold">{tr("กรุณาเข้าสู่ระบบ", "Please sign in")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {tr("คุณต้องเข้าสู่ระบบก่อนจึงจะสามารถจัดการข้อมูลโปรไฟล์ได้", "You need to sign in to manage your profile.")}
        </p>
        <Button className="mt-6 w-full" onClick={() => navigate({ to: "/auth" })}>
          {tr("เข้าสู่ระบบ / สมัครสมาชิก", "Sign in / Sign up")}
        </Button>
      </div>
    );
  }

  // Never show the form with empty fields after a failed load: saving it would wipe saved details
  if (profileError) {
    return <LoadError title={tr("โหลดข้อมูลโปรไฟล์ไม่สำเร็จ", "Could not load your profile")} onRetry={() => void refetchProfile()} />;
  }

  const isLicenseComplete = !!licenseNo.trim();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {isDemo && (
        <div className="mb-6 rounded-lg border border-dashed border-accent bg-accent/10 p-4 text-sm">
          <strong>{tr("บัญชีทดลอง (DEMO):", "Demo account (DEMO):")}</strong> {tr("ข้อมูลในบัญชีนี้เป็นข้อมูลสมมติ กรุณาอย่ากรอกข้อมูลส่วนตัวจริง เช่น เบอร์โทร เลขบัตรประชาชน หรือเลขใบขับขี่", "The data in this account is fictional. Please do not enter real personal data such as a phone, ID card or driving licence number.")}
        </div>
      )}
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{tr("โปรไฟล์และข้อมูลผู้ขับขี่", "Profile and driver details")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tr("จัดการข้อมูลส่วนตัว เอกสารสำหรับเช่ารถ และความปลอดภัยของบัญชี", "Manage your personal details, rental documents and account security")}
          </p>
        </div>
        <div>
          {isLicenseComplete ? (
            <Badge
              variant="outline"
              className="border-success/30 bg-success/10 text-success gap-1.5 py-1 px-3"
            >
              <CheckCircle2 className="h-4 w-4" /> {tr("ข้อมูลผู้ขับขี่พร้อมใช้งาน", "Driver details complete")}
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-warning/30 bg-warning/10 text-warning gap-1.5 py-1 px-3"
            >
              <AlertCircle className="h-4 w-4" /> {tr("รอระบุข้อมูลใบขับขี่", "Driving licence missing")}
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
                <CardTitle className="text-xl">{tr("ข้อมูลส่วนตัวและผู้ขับขี่", "Personal and driver details")}</CardTitle>
              </div>
              <CardDescription>
                {tr("ข้อมูลนี้จะถูกใช้เพื่อจัดทำสัญญาเช่ารถยนต์และออกเอกสารยืนยันการรับรถ", "These details are used for your rental contract and pickup documents.")}
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleSaveProfile} noValidate>
              <CardContent className="space-y-5">
                {/* Full Name & Email */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="prof-name" className="text-xs">
                      {tr("ชื่อ-นามสกุล *", "Full name *")}
                    </Label>
                    <Input
                      id="prof-name"
                      placeholder={tr("นายสมชาย มั่นคง", "John Smith")}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                      aria-invalid={!!errors.fullName}
                      aria-describedby={errors.fullName ? "prof-name-error" : undefined}
                    />
                    <FieldError id="prof-name-error" message={errors.fullName} />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="prof-email" className="text-xs">
                      {tr("อีเมล (ใช้เข้าสู่ระบบ)", "Email (used to sign in)")}
                    </Label>
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
                    <Label htmlFor="prof-phone" className="text-xs">
                      {tr("เบอร์โทรศัพท์ติดต่อ", "Contact phone number")}
                    </Label>
                    <div className="relative">
                      <Input
                        id="prof-phone"
                        placeholder="0812345678"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="font-mono"
                        type="tel"
                        inputMode="tel"
                        maxLength={15}
                        autoComplete="tel"
                        aria-invalid={!!errors.phone}
                        aria-describedby={errors.phone ? "prof-phone-error" : undefined}
                      />
                      <Phone className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    </div>
                    <FieldError id="prof-phone-error" message={errors.phone} />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="prof-idcard" className="text-xs">
                      {tr("เลขบัตรประชาชน / พาสปอร์ต *", "ID card / passport number *")}
                    </Label>
                    <div className="relative">
                      <Input
                        id="prof-idcard"
                        placeholder="1100000000000"
                        value={idCardNo}
                        onChange={(e) => setIdCardNo(e.target.value)}
                        className="font-mono"
                        maxLength={17}
                        required
                        aria-invalid={!!errors.idCardNo}
                        aria-describedby={errors.idCardNo ? "prof-idcard-error" : undefined}
                      />
                      <CreditCard className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    </div>
                    <FieldError id="prof-idcard-error" message={errors.idCardNo} />
                  </div>
                </div>

                {/* Driver's License Number */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="prof-license" className="text-xs font-semibold text-foreground">
                      {tr("หมายเลขใบอนุญาตขับขี่รถยนต์ (Driver's License No.) *", "Driving licence number *")}
                    </Label>
                    <span className="text-[11px] text-muted-foreground">{tr("จำเป็นสำหรับการเช่ารถ", "Required to rent a car")}</span>
                  </div>
                  <div className="relative">
                    <Input
                      id="prof-license"
                      placeholder={tr("เช่น 12345678", "e.g. 12345678")}
                      value={licenseNo}
                      onChange={(e) => setLicenseNo(e.target.value)}
                      className="font-mono"
                      required
                      maxLength={24}
                      aria-invalid={!!errors.licenseNo}
                      aria-describedby={errors.licenseNo ? "prof-license-error" : undefined}
                    />
                    <FileText className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  </div>
                  <FieldError id="prof-license-error" message={errors.licenseNo} />
                  <p className="text-xs text-muted-foreground">
                    {tr("ผู้เช่าต้องแสดงใบอนุญาตขับขี่ตัวจริงที่ยังไม่หมดอายุ ณ วันรับรถยนต์", "You must show your valid original driving licence at pickup.")}
                  </p>
                </div>

                {/* Contact Address */}
                <div className="space-y-1.5">
                  <Label htmlFor="prof-address" className="text-xs">
                    {tr("ที่อยู่สำหรับออกเอกสาร", "Address for documents")}
                  </Label>
                  <Textarea
                    id="prof-address"
                    rows={3}
                    placeholder={tr("เลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์", "House no., street, subdistrict, district, province, postcode")}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
              </CardContent>

              <CardFooter className="flex justify-end border-t pt-4">
                <Button type="submit" disabled={savingProfile} className="gap-2">
                  <Save className="h-4 w-4" />
                  {savingProfile ? tr("กำลังบันทึก...", "Saving...") : tr("บันทึกข้อมูลส่วนตัว", "Save personal details")}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>

        {/* Right Column: Security & Privacy (4 Cols) */}
        <div className="space-y-6 lg:col-span-4">
          {/* Change Password Card */}
          <ChangePasswordCard email={user.email ?? ""} isDemo={isDemo} />

          {/* Privacy & Security Guarantee Card */}
          <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground space-y-2 shadow-sm">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <span>{tr("การคุ้มครองข้อมูลส่วนบุคคล", "Personal data protection")}</span>
            </div>
            <p className="text-xs leading-relaxed">
              {tr("ข้อมูลใบขับขี่และข้อมูลระบุตัวตนของคุณได้รับการปกป้องตามมาตรฐาน PDPA เพื่อใช้ในการทำสัญญาเช่ารถยนต์เท่านั้น และจะไม่ถูกนำไปเปิดเผยต่อบุคคลภายนอก", "Your licence and identity details are protected under the PDPA, used only for your rental contract, and never shared with third parties.")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
