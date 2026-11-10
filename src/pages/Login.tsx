
import { useState, type FormEvent } from "react";
import { useAuthContext } from "../hooks/AuthContext";
import { supabase } from "../lib/supabase";

type Mode = "login" | "signup";


type PendingOrganisation = {
  fullName: string;
  organisationName: string;
  legalName: string;
  phone: string;
  country: string;
  currency: string;
  requestKey: string;
};

const PENDING_ORGANISATION_KEY = "fabricle-flow-pending-organisation";

function savePendingOrganisation(details: PendingOrganisation) {
  localStorage.setItem(PENDING_ORGANISATION_KEY, JSON.stringify(details));
}

function getPendingOrganisation(): PendingOrganisation | null {
  try {
    const value = localStorage.getItem(PENDING_ORGANISATION_KEY);
    if (!value) return null;

    const details = JSON.parse(value) as PendingOrganisation;

    if (
      !details.fullName ||
      !details.organisationName ||
      !details.requestKey
    ) {
      return null;
    }

    return details;
  } catch {
    return null;
  }
}

function clearPendingOrganisation() {
  localStorage.removeItem(PENDING_ORGANISATION_KEY);
}


async function createPendingOrganisation(details: PendingOrganisation) {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) throw sessionError;

  if (!session?.user) {
    throw new Error("Please sign in before completing organisation setup.");
  }

  const { error } = await supabase.rpc(
    "create_company_for_current_user",
    {
      p_display_name: details.fullName.trim(),
      p_company_name: details.organisationName.trim(),
      p_country: details.country,
      p_currency: details.currency,
      p_phone: details.phone.trim() || null,
      p_legal_name: details.legalName.trim() || null,
      p_request_key: details.requestKey,
    }
  );

  if (error) throw error;

  clearPendingOrganisation();
}


export default function Login() {
  const { signIn, signUp } = useAuthContext();

  const [mode, setMode] = useState<Mode>("login");
  const [step, setStep] = useState(1);

  const [fullName, setFullName] = useState("");
  const [organisationName, setOrganisationName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("India");
  const [currency, setCurrency] = useState("INR");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Keep the same key for retries of this organisation-creation request.
  const [requestKey] = useState(() => crypto.randomUUID());

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    setStep(1);
    setMessage("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (mode === "signup" && step === 1) {
      if (password !== confirmPassword) {
        setMessage("Passwords do not match.");
        return;
      }

      if (password.length < 8) {
        setMessage("Use a password with at least 8 characters.");
        return;
      }

      setStep(2);
      return;
    }

    if (mode === "signup") {
      if (password !== confirmPassword) {
        setStep(1);
        setMessage("Passwords do not match. Please check them.");
        return;
      }

      if (!organisationName.trim()) {
        setMessage("Enter your organisation name.");
        return;
      }
    }

    setLoading(true);

    try {
      if (mode === "login") {
  await signIn(email, password);

  const pending = getPendingOrganisation();

  if (pending) {
    await createPendingOrganisation(pending);
    setMessage(
      "Your organisation is ready. Your workspace is being opened."
    );
  } else {
    setMessage("Signed in successfully.");
  }

  return;
}

      // Create the Supabase Auth account.
      
const pending: PendingOrganisation = {
  fullName: fullName.trim(),
  organisationName: organisationName.trim(),
  legalName: legalName.trim(),
  phone: phone.trim(),
  country,
  currency,
  requestKey,
};

// Save before signup so email confirmation or a reload
// doesn't discard the organisation setup details.
savePendingOrganisation(pending);

const sessionCreated = await signUp(email, password, fullName);

if (!sessionCreated) {
  setMessage(
    "Your account was submitted. Check your email to confirm your address. Then sign in with the same browser to finish organisation setup."
  );
  return;
}

await createPendingOrganisation(pending);

setMessage(
  "Your account and organisation were created successfully. Your workspace is ready."
);


      if (!sessionCreated) {
        // Supabase email confirmation is enabled. The browser has no
        // authenticated session, so it must not call the company RPC.
        setMessage(
          "Your account was submitted. Check your email to confirm your address. Then sign in to finish organisation setup."
        );
        return;
      }

      // Verify that a session is currently available before calling the RPC.
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      if (!session?.user) {
        setMessage(
          "Your account was created, but no active session is available. Please sign in to continue."
        );
        return;
      }

      // Create the company and owner membership in one database transaction.
      const { error: companyError } = await supabase.rpc(
        "create_company_for_current_user",
        {
          p_display_name: fullName.trim(),
          p_company_name: organisationName.trim(),
          p_country: country,
          p_currency: currency,
          p_phone: phone.trim() || null,
          p_legal_name: legalName.trim() || null,
          p_request_key: requestKey,
        }
      );

      if (companyError) throw companyError;

      setMessage(
        "Your account and organisation were created successfully. Your workspace is ready."
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Fabricle Flow</h1>

        <p className="auth-subtitle">
          Knitting job-work management, made simple.
        </p>

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => changeMode("login")}
          >
            Sign in
          </button>

          <button
            type="button"
            className={mode === "signup" ? "active" : ""}
            onClick={() => changeMode("signup")}
          >
            Create account
          </button>
        </div>

        {mode === "signup" && (
          <p className="auth-step">
            Step {step} of 2 ·{" "}
            {step === 1 ? "Your account" : "Your organisation"}
          </p>
        )}

        <form onSubmit={handleSubmit}>
          {mode === "signup" && step === 1 && (
            <>
              <label htmlFor="fullName">Full name</label>
              <input
                id="fullName"
                autoComplete="name"
                maxLength={150}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                required
              />
            </>
          )}

          {(mode === "login" || step === 1) && (
            <>
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />

              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={mode === "signup" ? 8 : undefined}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />

              {mode === "signup" && (
                <>
                  <label htmlFor="confirmPassword">
                    Re-enter password
                  </label>
                  <input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={confirmPassword}
                    onChange={(event) =>
                      setConfirmPassword(event.target.value)
                    }
                    required
                  />
                </>
              )}
            </>
          )}

          {mode === "signup" && step === 2 && (
            <>
              <label htmlFor="organisationName">Organisation name</label>
              <input
                id="organisationName"
                autoComplete="organization"
                maxLength={150}
                value={organisationName}
                onChange={(event) =>
                  setOrganisationName(event.target.value)
                }
                required
              />

              <label htmlFor="legalName">Legal name (optional)</label>
              <input
                id="legalName"
                autoComplete="organization"
                value={legalName}
                onChange={(event) => setLegalName(event.target.value)}
              />

              <label htmlFor="phone">Business phone (optional)</label>
              <input
                id="phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />

              <label htmlFor="country">Country</label>
              <select
                id="country"
                value={country}
                onChange={(event) => {
                  const nextCountry = event.target.value;
                  setCountry(nextCountry);

                  if (nextCountry === "India") setCurrency("INR");
                  else if (nextCountry === "United Kingdom") setCurrency("GBP");
                  else if (nextCountry === "Bangladesh") setCurrency("BDT");
                  else if (nextCountry === "United States") setCurrency("USD");
                }}
              >
                <option>India</option>
                <option>United States</option>
                <option>United Kingdom</option>
                <option>Bangladesh</option>
                <option>Other</option>
              </select>

              <label htmlFor="currency">Default currency</label>
              <select
                id="currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              >
                <option value="INR">INR — Indian Rupee</option>
                <option value="USD">USD — US Dollar</option>
                <option value="GBP">GBP — British Pound</option>
                <option value="BDT">BDT — Bangladeshi Taka</option>
              </select>
            </>
          )}

          {message && (
            <p className="auth-message" role="status">
              {message}
            </p>
          )}

          {mode === "signup" && step === 2 && (
            <button
              type="button"
              className="auth-back"
              disabled={loading}
              onClick={() => {
                setStep(1);
                setMessage("");
              }}
            >
              Back
            </button>
          )}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading
              ? "Please wait..."
              : mode === "login"
                ? "Sign in"
                : step === 1
                  ? "Continue"
                  : "Create account"}
          </button>
        </form>
      </section>
    </main>
  );
}
