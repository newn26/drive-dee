import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { invitationLink, inviteTokenFrom } from "@/lib/contract-api";

const TOKEN = "a".repeat(64);

describe("Admin invitation token carry-through", () => {
  it("accepts only well-formed tokens", () => {
    expect(inviteTokenFrom(TOKEN)).toBe(TOKEN);
    expect(inviteTokenFrom("A".repeat(64))).toBeUndefined();
    expect(inviteTokenFrom("a".repeat(63))).toBeUndefined();
    expect(inviteTokenFrom(123)).toBeUndefined();
    expect(inviteTokenFrom(undefined)).toBeUndefined();
  });

  it("/auth keeps ?invite and ?register so sign-in can return to the invitation", async () => {
    const { Route } = await import("@/routes/auth");
    const validate = Route.options.validateSearch as (s: Record<string, unknown>) => {
      invite?: string;
      register?: boolean;
    };
    expect(validate({ invite: TOKEN, register: "true" })).toMatchObject({
      invite: TOKEN,
      register: true,
    });
    expect(validate({ invite: "<script>" }).invite).toBeUndefined();
  });

  it("/admin-invite keeps a valid token and drops a bad one", async () => {
    const { Route } = await import("@/routes/admin-invite");
    const validate = Route.options.validateSearch as (s: Record<string, unknown>) => {
      token?: string;
    };
    expect(validate({ token: TOKEN })).toEqual({ token: TOKEN });
    expect(validate({ token: "nope" })).toEqual({});
  });

  it("the sign-up confirmation link returns to the invitation page", () => {
    expect(invitationLink("https://drive-dee.lovable.app", TOKEN)).toBe(
      `https://drive-dee.lovable.app/admin-invite?token=${TOKEN}`,
    );
  });
});
