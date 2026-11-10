
import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
};

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    loading: true,
  });

  useEffect(() => {
    let mounted = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setState({
          session,
          user: session?.user ?? null,
          loading: false,
        });
      }
    });

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (mounted) {
          if (error) {
            console.error("Unable to read auth session:", error.message);
          }

          setState({
            session: data.session,
            user: data.session?.user ?? null,
            loading: false,
          });
        }
      });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signIn(email: string, password: string) {
    return supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
  }

  async function signUp(email: string, password: string) {
    return supabase.auth.signUp({
      email: email.trim(),
      password,
    });
  }

  async function signOut() {
    return supabase.auth.signOut();
  }

  return {
    ...state,
    signIn,
    signUp,
    signOut,
  };
}
