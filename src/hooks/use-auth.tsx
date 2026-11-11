import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { isDemoCustomerAccount, resolveRole, roleForAccount, type AppRole } from "@/lib/roles";

type AuthState = {
  user: User | null;
  session: Session | null;
  role: AppRole;
  /** Full administrator. */
  isAdmin: boolean;
  /** Restricted demonstration administrator (demo_admin role). */
  isDemoAdmin: boolean;
  /** Demo Customer account with fictional data (app_metadata.demo). Always a customer. */
  isDemo: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState>({
  user: null,
  session: null,
  role: "customer",
  isAdmin: false,
  isDemoAdmin: false,
  isDemo: false,
  loading: true,
  signOut: async () => {},
});

/**
 * Reads the signed-in user's role from user_roles (RLS: users can only read their own rows).
 * Demo Customer accounts are always treated as customers.
 */
export async function fetchRole(user: User): Promise<AppRole> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  return roleForAccount(resolveRole(data), user.app_metadata);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole>("customer");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async (s: Session | null) => {
      setSession(s);
      setRole(s?.user ? await fetchRole(s.user) : "customer");
      setLoading(false);
    };
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setTimeout(() => load(s), 0);
    });
    supabase.auth.getSession().then(({ data }) => load(data.session));
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <Ctx.Provider
      value={{
        session,
        user: session?.user ?? null,
        role,
        isAdmin: role === "admin",
        isDemoAdmin: role === "demo_admin",
        isDemo: isDemoCustomerAccount(session?.user?.app_metadata),
        loading,
        signOut: async () => {
          await supabase.auth.signOut();
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
