import { Link } from "@tanstack/react-router";
import { Car } from "lucide-react";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t bg-muted/40 print:hidden">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <Link to="/" className="flex items-center gap-2 font-display font-semibold text-foreground">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <Car className="h-4 w-4" />
          </span>
          ไดร์ฟดี รถเช่า
        </Link>
        <nav className="flex flex-wrap gap-x-4 gap-y-1">
          <Link to="/" className="hover:text-foreground">
            หน้าหลัก
          </Link>
          <Link to="/cars" className="hover:text-foreground">
            ค้นหารถเช่า
          </Link>
          <Link to="/bookings" className="hover:text-foreground">
            การจองของฉัน
          </Link>
        </nav>
        <p>© {year} Drive Dee · Siam Wheels Rental Hub</p>
      </div>
    </footer>
  );
}
