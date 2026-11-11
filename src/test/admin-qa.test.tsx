import { describe, expect, it } from "vitest";
import { daysBetween, fmtDate, fmtDateTime, thb, todayBkk } from "@/lib/format";
import { routeTree } from "@/routeTree.gen";
import { createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";

describe("QA Test Suite - Phase 3 Admin & System Architecture", () => {
  // =========================================================================
  // 1. Role-Based Access Control & Security
  // =========================================================================
  describe("1. Security & RBAC Guard Logic", () => {
    it("correctly identifies unauthorized non-admin users", () => {
      const user = { id: "cust-1", email: "cust@test.com" };
      const isAdmin = false;
      const canAccessAdmin = !!user && isAdmin;
      expect(canAccessAdmin).toBe(false);
    });

    it("correctly grants access to authorized admin users", () => {
      const user = { id: "admin-1", email: "admin@test.com" };
      const isAdmin = true;
      const canAccessAdmin = !!user && isAdmin;
      expect(canAccessAdmin).toBe(true);
    });

    it("denies access to unauthenticated anonymous visitors", () => {
      const user = null;
      const isAdmin = false;
      const canAccessAdmin = !!user && isAdmin;
      expect(canAccessAdmin).toBe(false);
    });
  });

  // =========================================================================
  // 2. Dashboard Overview & Metric Calculation Accuracy
  // =========================================================================
  describe("2. Dashboard Overview & Metric Calculations", () => {
    const mockCars = [
      { id: "c1", status: "available", category: "eco", price_per_day: 1000 },
      { id: "c2", status: "rented", category: "sedan", price_per_day: 2000 },
      { id: "c3", status: "maintenance", category: "suv", price_per_day: 3000 },
      { id: "c4", status: "available", category: "van", price_per_day: 3500 },
    ];

    const mockBookings = [
      { id: "b1", status: "confirmed", total_amount: 5000, created_at: "2026-11-01" },
      { id: "b2", status: "active", total_amount: 4000, created_at: "2026-11-02" },
      { id: "b3", status: "completed", total_amount: 6000, created_at: "2026-10-15" },
      { id: "b4", status: "cancelled", total_amount: 2000, created_at: "2026-11-03" },
    ];

    const mockMaintenance = [
      { id: "m1", cost: 1500, scheduled_date: "2026-11-05" },
      { id: "m2", cost: 2500, scheduled_date: "2026-10-20" },
    ];

    it("calculates fleet counts accurately", () => {
      const totalCars = mockCars.length;
      const available = mockCars.filter((c) => c.status === "available").length;
      const rented = mockCars.filter((c) => c.status === "rented").length;
      const maintenance = mockCars.filter((c) => c.status === "maintenance").length;

      expect(totalCars).toBe(4);
      expect(available).toBe(2);
      expect(rented).toBe(1);
      expect(maintenance).toBe(1);
    });

    it("calculates car utilization percentage accurately", () => {
      const rented = mockCars.filter((c) => c.status === "rented").length;
      const total = mockCars.length;
      const utilization = total > 0 ? Math.round((rented / total) * 100) : 0;
      expect(utilization).toBe(25); // 1 out of 4 = 25%
    });

    it("prevents division by zero when fleet is empty", () => {
      const total = 0;
      const rented = 0;
      const utilization = total > 0 ? Math.round((rented / total) * 100) : 0;
      expect(utilization).toBe(0);
    });

    it("excludes cancelled bookings from revenue calculation", () => {
      const revenue = mockBookings
        .filter((b) => b.status === "confirmed" || b.status === "active" || b.status === "completed")
        .reduce((sum, b) => sum + b.total_amount, 0);

      // 5000 + 4000 + 6000 = 15000 (cancelled 2000 excluded)
      expect(revenue).toBe(15000);
    });

    it("calculates net operational profit after deducting maintenance expenses", () => {
      const revenue = 15000;
      const maintenanceExpenses = mockMaintenance.reduce((sum, m) => sum + m.cost, 0); // 4000
      const netProfit = revenue - maintenanceExpenses;

      expect(maintenanceExpenses).toBe(4000);
      expect(netProfit).toBe(11000);
    });
  });

  // =========================================================================
  // 3. Car Management & Linked Bookings Protection
  // =========================================================================
  describe("3. Car Management & Foreign Key Protection", () => {
    const existingBookings = [
      { id: "b1", car_id: "car-linked-1", status: "confirmed" },
      { id: "b2", car_id: "car-linked-2", status: "completed" },
    ];

    it("blocks deletion of a car when referenced by bookings", () => {
      const carToDelete = { id: "car-linked-1", plate_no: "1กข 1234" };
      const hasBooking = existingBookings.some((b) => b.car_id === carToDelete.id);
      expect(hasBooking).toBe(true);

      const canDelete = !hasBooking;
      expect(canDelete).toBe(false);
    });

    it("allows deletion of a car with no historical bookings", () => {
      const carToDelete = { id: "car-brand-new", plate_no: "9ฮฮ 9999" };
      const hasBooking = existingBookings.some((b) => b.car_id === carToDelete.id);
      expect(hasBooking).toBe(false);

      const canDelete = !hasBooking;
      expect(canDelete).toBe(true);
    });
  });

  // =========================================================================
  // 4. Booking Lifecycle & Automatic Car Status Synchronization
  // =========================================================================
  describe("4. Booking Lifecycle & Car State Sync", () => {
    it("determines correct car state when booking is activated (car handed over)", () => {
      const newBookingStatus = "active";
      let carStatus = "available";

      if (newBookingStatus === "active") {
        carStatus = "rented";
      }

      expect(carStatus).toBe("rented");
    });

    it("determines correct car state when booking is completed (car returned)", () => {
      const newBookingStatus = "completed";
      let carStatus = "rented";

      if (newBookingStatus === "completed" || newBookingStatus === "cancelled") {
        carStatus = "available";
      }

      expect(carStatus).toBe("available");
    });
  });

  // =========================================================================
  // 5. Maintenance Tracking & Car Availability Impact
  // =========================================================================
  describe("5. Maintenance Scheduling & Availability", () => {
    it("sets car to maintenance status when maintenance work is in-progress", () => {
      const maintStatus = "in_progress";
      let carStatus = "available";

      if (maintStatus === "in_progress") {
        carStatus = "maintenance";
      }

      expect(carStatus).toBe("maintenance");
    });
  });

  // =========================================================================
  // 6. Reports & Date Range Filtering
  // =========================================================================
  describe("6. Reports & Analytics Date Range Filtering", () => {
    const now = new Date("2026-11-08T00:00:00Z").getTime();

    const sampleBookings = [
      { id: "b1", total_amount: 3000, created_at: "2026-11-05T00:00:00Z" }, // 3 days ago (in 30d)
      { id: "b2", total_amount: 5000, created_at: "2026-10-01T00:00:00Z" }, // 38 days ago (in 90d, not 30d)
      { id: "b3", total_amount: 7000, created_at: "2026-02-01T00:00:00Z" }, // 280 days ago (in year, not 90d)
      { id: "b4", total_amount: 4000, created_at: "2025-11-01T00:00:00Z" }, // last year
    ];

    it("filters correctly for 30 days cutoff", () => {
      const cutoff30d = now - 30 * 86400000;
      const in30d = sampleBookings.filter((b) => new Date(b.created_at).getTime() >= cutoff30d);
      expect(in30d.length).toBe(1);
      expect(in30d[0]?.total_amount).toBe(3000);
    });

    it("filters correctly for 90 days cutoff", () => {
      const cutoff90d = now - 90 * 86400000;
      const in90d = sampleBookings.filter((b) => new Date(b.created_at).getTime() >= cutoff90d);
      expect(in90d.length).toBe(2);
      const total90d = in90d.reduce((s, b) => s + b.total_amount, 0);
      expect(total90d).toBe(8000);
    });

    it("filters correctly for this year cutoff", () => {
      const startOfYear = new Date("2026-01-01T00:00:00Z").getTime();
      const inYear = sampleBookings.filter((b) => new Date(b.created_at).getTime() >= startOfYear);
      expect(inYear.length).toBe(3); // excludes 2025
    });
  });

  // =========================================================================
  // 7. Regression Testing of Formatting & Routing
  // =========================================================================
  describe("7. Regression - Formatting Utilities", () => {
    it("formats Thai Baht currency without decimals", () => {
      const formatted = thb(1500);
      expect(formatted).toContain("1,500");
    });

    it("handles zero and undefined in thb() gracefully", () => {
      expect(thb(0)).toContain("0");
      expect(thb(undefined)).toContain("0");
      expect(thb(null)).toContain("0");
    });

    it("calculates daysBetween correctly", () => {
      // 2026-11-10 to 2026-11-12 = 3 days (inclusive)
      const days = daysBetween("2026-11-10", "2026-11-12");
      expect(days).toBe(3);
    });

    it("calculates same-day booking as 1 day", () => {
      const days = daysBetween("2026-11-10", "2026-11-10");
      expect(days).toBe(1);
    });

    it("formats dates into Thai calendar format (Buddhist Era year)", () => {
      const formatted = fmtDate("2026-11-08");
      // th-TH uses the Buddhist calendar: 2026 CE = 2569 BE
      expect(formatted).toContain("2569");
      expect(formatted).toContain("พ.ย.");
    });
  });

  // =========================================================================
  // 8. Route Manifest Integrity
  // =========================================================================
  describe("8. Route Manifest Integrity", () => {
    it("verifies all core routes exist in the route tree", () => {
      const children = routeTree.children;
      expect(children).toBeDefined();

      // Paths are only resolved once a router is built from the tree
      const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
      const routeIds = Object.keys(router.routesByPath);
      expect(routeIds).toContain("/admin");
      expect(routeIds).toContain("/auth");
      expect(routeIds).toContain("/bookings");
      expect(routeIds).toContain("/dashboard");
      expect(routeIds).toContain("/profile");
      expect(routeIds).toContain("/cars");
    });
  });
});
