import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Car, Languages, LayoutDashboard, LogOut, Menu, MonitorPlay, ShieldCheck, User } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { tr, useLanguage } from "@/lib/i18n";

const customerNav = () =>
  [
    { to: "/cars", label: tr("ค้นหารถเช่า", "Search cars") },
    { to: "/dashboard", label: tr("แดชบอร์ด", "Dashboard") },
    { to: "/bookings", label: tr("การจองของฉัน", "My bookings") },
    { to: "/profile", label: tr("โปรไฟล์", "Profile") },
  ] as const;

/** TH / EN switch (hidden on the admin pages, which stay Thai). */
export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { chosen, setLang, switchable } = useLanguage();
  if (!switchable) return null;
  const next = chosen === "th" ? "en" : "th";
  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      onClick={() => setLang(next)}
      aria-label={next === "en" ? "Switch to English" : "เปลี่ยนเป็นภาษาไทย"}
      data-testid="language-switch"
    >
      <Languages className="h-4 w-4" /> {next === "en" ? "EN" : "ไทย"}
    </Button>
  );
}

export function SiteHeader() {
  const { user, isAdmin, isDemoAdmin, isDemo, signOut } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const logout = async () => {
    await qc.cancelQueries();
    qc.clear();
    await signOut();
    navigate({ to: "/auth", replace: true });
  };

  const links = user ? customerNav() : ([{ to: "/cars", label: tr("ค้นหารถเช่า", "Search cars") }] as const);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur print:hidden">
      {isDemoAdmin && (
        <div
          role="status"
          className="bg-amber-400 px-4 py-1 text-center text-xs font-semibold text-amber-950"
        >
          {tr("โหมดสาธิต (DEMO ADMIN) · สิทธิ์จำกัด ไม่ใช่บัญชีผู้ดูแลระบบจริง", "Demo mode (DEMO ADMIN) · limited access, not a real admin account")}
        </div>
      )}
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4">
        <Link to="/" className="flex items-center gap-2 font-display text-lg font-semibold">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Car className="h-5 w-5" />
          </span>
          {tr("ไดร์ฟดี", "Drive Dee")} <span className="hidden text-sm font-normal text-muted-foreground sm:inline">{tr("รถเช่า", "Car Rental")}</span>
        </Link>
        <nav className="hidden flex-1 items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              activeProps={{ className: "bg-muted text-foreground font-medium" }}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        {isDemo && (
          <span className="ml-2 rounded-full border border-accent bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent-foreground" title={tr("บัญชีทดลอง ข้อมูลสมมติ", "Demo account with fictional data")}>
            {tr("บัญชีทดลอง DEMO", "DEMO account")}
          </span>
        )}
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <LanguageSwitch />
          {isAdmin && (
            <Button asChild variant="secondary" size="sm">
              <Link to="/admin">
                <ShieldCheck className="h-4 w-4" /> {tr("ระบบผู้ดูแล", "Admin")}
              </Link>
            </Button>
          )}
          {isDemoAdmin && (
            <Button asChild variant="secondary" size="sm">
              <Link to="/demo-admin">
                <MonitorPlay className="h-4 w-4" /> {tr("แดชบอร์ดสาธิต", "Demo dashboard")}
              </Link>
            </Button>
          )}
          {user ? (
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="h-4 w-4" /> {tr("ออกจากระบบ", "Sign out")}
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link to="/auth">
                <User className="h-4 w-4" /> {tr("เข้าสู่ระบบ", "Sign in")}
              </Link>
            </Button>
          )}
        </div>
        <LanguageSwitch className="ml-auto md:hidden" />
        <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(!open)} aria-label={tr("เมนู", "Menu")}>
          <Menu />
        </Button>
      </div>
      {open && (
        <div className="border-t px-4 py-3 md:hidden" onClick={() => setOpen(false)}>
          <div className="flex flex-col gap-1">
            {links.map((l) => (
              <Link key={l.to} to={l.to} className="rounded-md px-3 py-2 text-sm hover:bg-muted">
                {l.label}
              </Link>
            ))}
            {isAdmin && (
              <Link to="/admin" className="rounded-md px-3 py-2 text-sm hover:bg-muted">
                <LayoutDashboard className="mr-2 inline h-4 w-4" />
                {tr("ระบบผู้ดูแล", "Admin")}
              </Link>
            )}
            {isDemoAdmin && (
              <Link to="/demo-admin" className="rounded-md px-3 py-2 text-sm hover:bg-muted">
                <MonitorPlay className="mr-2 inline h-4 w-4" />
                {tr("แดชบอร์ดสาธิต (Demo Admin)", "Demo dashboard (Demo Admin)")}
              </Link>
            )}
            {user ? (
              <button onClick={logout} className="rounded-md px-3 py-2 text-left text-sm hover:bg-muted">
                {tr("ออกจากระบบ", "Sign out")}
              </button>
            ) : (
              <Link to="/auth" className="rounded-md px-3 py-2 text-sm hover:bg-muted">
                {tr("เข้าสู่ระบบ / สมัครสมาชิก", "Sign in / Sign up")}
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
