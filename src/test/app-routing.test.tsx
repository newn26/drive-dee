import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("17 still matches the booking, car, dashboard and admin pages, plus the new invite page", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    const id = (path: string) => router.matchRoutes(path).at(-1)?.routeId;
    expect(id("/cars/abc")).toBe("/cars_/$id");
    expect(id("/bookings")).toBe("/bookings");
    expect(id("/bookings/abc")).toBe("/bookings_/$id");
    expect(id("/dashboard")).toBe("/dashboard");
    expect(id("/admin")).toBe("/admin");
    expect(id("/admin-invite")).toBe("/admin-invite");
  });
});
