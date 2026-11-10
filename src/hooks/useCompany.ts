
import { useCallback, useEffect, useState } from "react";
import { useAuthContext } from "./AuthContext";
import { supabase } from "../lib/supabase";

type Company = {
  id: string;
  name: string;
  country: string;
  base_currency: string;
};

export function useCompany() {
  const { user } = useAuthContext();

  // Depend on the stable user ID, not the changing Supabase User object.
  const userId = user?.id ?? null;

  const [company, setCompany] = useState<Company | null>(null);
  const [loadedForUser, setLoadedForUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadCompany = useCallback(async () => {
    if (!userId) {
      setCompany(null);
      setLoadedForUser(null);
      setError("");
      setLoading(false);
      return;
    }

    // Don't hide an organisation that is already visible.
    if (loadedForUser !== userId) {
      setLoading(true);
    }

    setError("");

    try {
      const { data: memberships, error: membershipError } =
        await supabase
          .from("company_members")
          .select("company_id")
          .eq("user_id", userId)
          .eq("is_active", true)
          .limit(2);

      if (membershipError) {
        throw new Error("Unable to load your organisation.");
      }

      if (!memberships?.length) {
        setCompany(null);
        setLoadedForUser(userId);
        return;
      }

      if (memberships.length > 1) {
        setCompany(null);
        setLoadedForUser(userId);
        setError(
          "Multiple organisations found. Workspace selection is needed."
        );
        return;
      }

      const { data, error: companyError } = await supabase
        .from("companies")
        .select("id, name, country, base_currency")
        .eq("id", memberships[0].company_id)
        .maybeSingle();

      if (companyError || !data) {
        throw new Error("Unable to load your organisation details.");
      }

      setCompany(data as Company);
      setLoadedForUser(userId);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load your organisation."
      );

      // Keep any previously loaded company visible on transient errors.
    } finally {
      setLoading(false);
    }
  }, [userId, loadedForUser]);

  useEffect(() => {
    let active = true;

    async function initialLoad() {
      if (!userId) {
        setCompany(null);
        setLoadedForUser(null);
        setError("");
        setLoading(false);
        return;
      }

      if (loadedForUser !== userId) {
        setLoading(true);
      }

      try {
        const { data: memberships, error: membershipError } =
          await supabase
            .from("company_members")
            .select("company_id")
            .eq("user_id", userId)
            .eq("is_active", true)
            .limit(2);

        if (!active) return;

        if (membershipError) {
          throw new Error("Unable to load your organisation.");
        }

        if (!memberships?.length) {
          setCompany(null);
          setLoadedForUser(userId);
          return;
        }

        if (memberships.length > 1) {
          setCompany(null);
          setLoadedForUser(userId);
          setError(
            "Multiple organisations found. Workspace selection is needed."
          );
          return;
        }

        const { data, error: companyError } = await supabase
          .from("companies")
          .select("id, name, country, base_currency")
          .eq("id", memberships[0].company_id)
          .maybeSingle();

        if (!active) return;

        if (companyError || !data) {
          throw new Error("Unable to load your organisation details.");
        }

        setCompany(data as Company);
        setLoadedForUser(userId);
        setError("");
      } catch (loadError) {
        if (!active) return;

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load your organisation."
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void initialLoad();

    return () => {
      active = false;
    };
  }, [userId]); // Deliberately do not depend on the whole user object.

  return {
    company,
    loading,
    error,
    refreshCompany: loadCompany,
  };
}
