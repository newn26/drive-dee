import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Car, LayoutDashboard, LogOut, Menu, MonitorPlay, ShieldCheck, User } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

const customerNav = [
  { to: "/cars", label: "ค้นหารถเช่า" },
  { to: "/dashboard", label: "แดชบอร์ด" },
  { to: "/bookings", label: "การจองของฉัน" },
  { to: "/profile", label: "โปรไฟล์" },
] as const;

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

  const links = user ? customerNav : ([{ to: "/cars", label: "ค้นหารถเช่า" }] as const);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur print:hidden">
      {isDemoAdmin && (
        <div
          role="status"
          className="bg-amber-400 px-4 py-1 text-center text-xs font-semibold text-amber-950"
        >
          โหมดสาธิต (DEMO ADMIN) · สิทธิ์จำกัด ไม่ใช่บัญชีผู้ดูแลระบบจริง
        </div>
      )}
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4">
        <Link to="/" className="flex items-center gap-2 font-display text-lg font-semibold">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Car className="h-5 w-5" />
          </span>
          ไดร์ฟดี <span className="hidden text-sm font-normal text-muted-foreground sm:inline">รถเช่า</span>
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
          <span className="ml-2 rounded-full border border-accent bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent-foreground" title="บัญชีทดลอง ข้อมูลสมมติ">
            บัญชีทดลอง DEMO
          </span>
        )}
        <div className="ml-auto hidden items-center gap-2 md:flex">
          {isAdmin && (
            <Button asChild variant="secondary" size="sm">
              <Link to="/admin">
                <ShieldCheck className="h-4 w-4" /> ระบบผู้ดูแล
              </Link>
            </Button>
          )}
          {isDemoAdmin && (
            <Button asChild variant="secondary" size="sm">
              <Link to="/demo-admin">
                <MonitorPlay className="h-4 w-4" /> แดชบอร์ดสาธิต
              </Link>
            </Button>
          )}
          {user ? (
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="h-4 w-4" /> ออกจากระบบ
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link to="/auth">
                <User className="h-4 w-4" /> เข้าสู่ระบบ
              </Link>
            </Button>
          )}
        </div>
        <Button variant="ghost" size="icon" className="ml-auto md:hidden" onClick={() => setOpen(!open)} aria-label="เมนู">
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
                ระบบผู้ดูแล
              </Link>
            )}
            {isDemoAdmin && (
              <Link to="/demo-admin" className="rounded-md px-3 py-2 text-sm hover:bg-muted">
                <MonitorPlay className="mr-2 inline h-4 w-4" />
                แดชบอร์ดสาธิต (Demo Admin)
              </Link>
            )}
            {user ? (
              <button onClick={logout} className="rounded-md px-3 py-2 text-left text-sm hover:bg-muted">
                ออกจากระบบ
              </button>
            ) : (
              <Link to="/auth" className="rounded-md px-3 py-2 text-sm hover:bg-muted">
                เข้าสู่ระบบ / สมัครสมาชิก
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
