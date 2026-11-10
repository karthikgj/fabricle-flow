
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useAuthContext } from "../../hooks/AuthContext";
import { supabase } from "../../lib/supabase";
import Login from "../../pages/Login";

type OrganisationDetails = {
  organisationName: string;
  legalName: string;
  phone: string;
  country: string;
  currency: string;
};

export default function AuthGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuthContext();
  const userId = user?.id ?? null;

  const [checking, setChecking] = useState(true);
  const [hasOrganisation, setHasOrganisation] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [checkedUserId, setCheckedUserId] = useState<string | null>(null);

  const [details, setDetails] = useState<OrganisationDetails>({
    organisationName: "",
    legalName: "",
    phone: "",
    country: "India",
    currency: "INR",
  });

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [requestKey] = useState(() => crypto.randomUUID());

  // Prevent an older request from overwriting a newer user's result.
  const requestId = useRef(0);

  const checkMembership = useCallback(async () => {
    const currentRequest = ++requestId.current;

    if (!userId) {
      setHasOrganisation(false);
      setCheckedUserId(null);
      setCheckError("");
      setChecking(false);
      return;
    }

    // Only show the blocking loader for the initial check.
    // Session refreshes must not hide an already-loaded workspace.
    if (checkedUserId !== userId) {
      setChecking(true);
    }

    setCheckError("");

    try {
      const { data, error } = await supabase
        .from("company_members")
        .select("company_id")
        .eq("user_id", userId)
        .eq("is_active", true)
        .limit(2);

      if (currentRequest !== requestId.current) return;

      if (error) {
        throw new Error(
          "We couldn't verify your organisation membership. Please try again."
        );
      }

      if ((data?.length ?? 0) > 1) {
        setHasOrganisation(false);
        setCheckError(
          "Multiple organisations found. Workspace selection is needed."
        );
      } else {
        setHasOrganisation(Boolean(data?.length));
      }

      setCheckedUserId(userId);
    } catch (error) {
      if (currentRequest !== requestId.current) return;

      setCheckError(
        error instanceof Error
          ? error.message
          : "We couldn't verify your organisation membership. Please try again."
      );

      // Keep a previously verified workspace accessible during
      // transient errors rather than forcing the user back to setup.
    } finally {
      if (currentRequest === requestId.current) {
        setChecking(false);
      }
    }
  }, [userId, checkedUserId]);

  useEffect(() => {
    if (loading) return;

    if (!userId) {
      requestId.current += 1;
      setHasOrganisation(false);
      setCheckedUserId(null);
      setCheckError("");
      setChecking(false);
      return;
    }

    // User identity, not the entire Supabase User object, controls checks.
    if (checkedUserId === userId) return;

    void checkMembership();
  }, [loading, userId, checkedUserId, checkMembership]);

  function updateDetail(
    field: keyof OrganisationDetails,
    value: string
  ) {
    setDetails((current) => ({
      ...current,
      [field]: value,
      ...(field === "country"
        ? {
            currency:
              value === "India"
                ? "INR"
                : value === "United States"
                  ? "USD"
                  : value === "United Kingdom"
                    ? "GBP"
                    : value === "Bangladesh"
                      ? "BDT"
                      : current.currency,
          }
        : {}),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!details.organisationName.trim()) {
      setMessage("Enter your organisation name.");
      return;
    }

    setSaving(true);

    try {
      const { data, error } = await supabase.rpc(
        "create_company_for_current_user",
        {
          p_display_name:
            user?.user_metadata?.full_name ||
            user?.email?.split("@")[0] ||
            "User",
          p_company_name: details.organisationName.trim(),
          p_country: details.country,
          p_currency: details.currency,
          p_phone: details.phone.trim() || null,
          p_legal_name: details.legalName.trim() || null,
          p_request_key: requestKey,
        }
      );

      if (error) throw error;

      if (!data) {
        throw new Error("Organisation creation returned no company ID.");
      }

      await checkMembership();
      setMessage("Organisation created. Your workspace is ready.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Organisation setup failed. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="auth-loading">
        <p>Loading Fabricle Flow...</p>
      </div>
    );
  }

  if (!user) return <Login />;

  // Don't block an already-verified workspace during a background check.
  if (checking && checkedUserId !== userId) {
    return (
      <div className="auth-loading">
        <p>Checking your organisation...</p>
      </div>
    );
  }

  if (checkError && !hasOrganisation) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Fabricle Flow</h1>
          <p className="auth-message" role="alert">
            {checkError}
          </p>
          <button
            className="auth-submit"
            type="button"
            onClick={() => void checkMembership()}
          >
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (!hasOrganisation) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Complete your organisation setup</h1>
          <p className="auth-subtitle">
            Your account is signed in, but it isn't linked to an
            organisation yet. Enter your business details to continue.
          </p>

          <form onSubmit={handleSubmit}>
            <label htmlFor="recoveryOrganisation">
              Organisation name
            </label>
            <input
              id="recoveryOrganisation"
              autoComplete="organization"
              maxLength={150}
              value={details.organisationName}
              onChange={(event) =>
                updateDetail("organisationName", event.target.value)
              }
              required
            />

            <label htmlFor="recoveryLegalName">
              Legal name (optional)
            </label>
            <input
              id="recoveryLegalName"
              value={details.legalName}
              onChange={(event) =>
                updateDetail("legalName", event.target.value)
              }
            />

            <label htmlFor="recoveryPhone">
              Business phone (optional)
            </label>
            <input
              id="recoveryPhone"
              type="tel"
              autoComplete="tel"
              value={details.phone}
              onChange={(event) =>
                updateDetail("phone", event.target.value)
              }
            />

            <label htmlFor="recoveryCountry">Country</label>
            <select
              id="recoveryCountry"
              value={details.country}
              onChange={(event) =>
                updateDetail("country", event.target.value)
              }
            >
              <option>India</option>
              <option>United States</option>
              <option>United Kingdom</option>
              <option>Bangladesh</option>
              <option>Other</option>
            </select>

            <label htmlFor="recoveryCurrency">Default currency</label>
            <select
              id="recoveryCurrency"
              value={details.currency}
              onChange={(event) =>
                updateDetail("currency", event.target.value)
              }
            >
              <option value="INR">INR — Indian Rupee</option>
              <option value="USD">USD — US Dollar</option>
              <option value="GBP">GBP — British Pound</option>
              <option value="BDT">BDT — Bangladeshi Taka</option>
            </select>

            {message && (
              <p className="auth-message" role="status">
                {message}
              </p>
            )}

            <button
              className="auth-submit"
              type="submit"
              disabled={saving}
            >
              {saving ? "Creating organisation..." : "Create organisation"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}
