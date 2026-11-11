import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { resolveRole, type AppRole } from "@/lib/roles";

type AuthState = {
  user: User | null;
  session: Session | null;
  role: AppRole;
  /** Full administrator. */
  isAdmin: boolean;
  /** Restricted demonstration administrator. */
  isDemoAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState>({
  user: null,
  session: null,
  role: "customer",
  isAdmin: false,
  isDemoAdmin: false,
  loading: true,
  signOut: async () => {},
});

/** Reads the signed-in user's role from user_roles (RLS: users can only read their own rows). */
export async function fetchRole(userId: string): Promise<AppRole> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  return resolveRole(data);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole>("customer");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async (s: Session | null) => {
      setSession(s);
      setRole(s?.user ? await fetchRole(s.user.id) : "customer");
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
