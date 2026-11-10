
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  CheckCircle2,
  Landmark,
  LoaderCircle,
  MapPin,
  Save,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";
import "./Settings.css";

type ProfileForm = {
  name: string;
  legal_name: string;
  business_type: string;
  country: string;
  registered_address: string;
  factory_address: string;
  billing_address: string;
  phone: string;
  alternate_phone: string;
  email: string;
  website: string;
  contact_person: string;
  contact_designation: string;
  gst_registered: boolean;
  gstin: string;
  state: string;
  state_code: string;
  pan: string;
  udyam_number: string;
  cin_llpin: string;
  bank_account_name: string;
  bank_name: string;
  bank_branch: string;
  bank_account_number: string;
  bank_ifsc: string;
  bank_account_type: string;
  upi_id: string;
  payment_terms: string;
  show_bank_details_on_invoice: boolean;
  authorised_signatory: string;
  signatory_designation: string;
  document_footer: string;
  logo_url: string;
};

const emptyForm: ProfileForm = {
  name: "",
  legal_name: "",
  business_type: "",
  country: "India",
  registered_address: "",
  factory_address: "",
  billing_address: "",
  phone: "",
  alternate_phone: "",
  email: "",
  website: "",
  contact_person: "",
  contact_designation: "",
  gst_registered: false,
  gstin: "",
  state: "",
  state_code: "",
  pan: "",
  udyam_number: "",
  cin_llpin: "",
  bank_account_name: "",
  bank_name: "",
  bank_branch: "",
  bank_account_number: "",
  bank_ifsc: "",
  bank_account_type: "",
  upi_id: "",
  payment_terms: "",
  show_bank_details_on_invoice: true,
  authorised_signatory: "",
  signatory_designation: "",
  document_footer: "",
  logo_url: "",
};

const textFields: (keyof ProfileForm)[] = [
  "name",
  "legal_name",
  "business_type",
  "country",
  "registered_address",
  "factory_address",
  "billing_address",
  "phone",
  "alternate_phone",
  "email",
  "website",
  "contact_person",
  "contact_designation",
  "gstin",
  "state",
  "state_code",
  "pan",
  "udyam_number",
  "cin_llpin",
  "bank_account_name",
  "bank_name",
  "bank_branch",
  "bank_account_number",
  "bank_ifsc",
  "bank_account_type",
  "upi_id",
  "payment_terms",
  "authorised_signatory",
  "signatory_designation",
  "document_footer",
  "logo_url",
];

function SectionHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="org-section-heading">
      <span className="org-section-icon">
        <Icon size={19} />
      </span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  placeholder,
  required,
  wide,
  type = "text",
  help,
}: {
  label: string;
  name: keyof ProfileForm;
  value: string;
  onChange: (name: keyof ProfileForm, value: string) => void;
  placeholder?: string;
  required?: boolean;
  wide?: boolean;
  type?: string;
  help?: string;
}) {
  return (
    <label className={`org-field ${wide ? "org-field-wide" : ""}`}>
      <span>
        {label}
        {required && <b className="org-required"> *</b>}
      </span>
      <input
        type={type}
        name={name}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(event) => onChange(name, event.target.value)}
      />
      {help && <small>{help}</small>}
    </label>
  );
}

function TextAreaField({
  label,
  name,
  value,
  onChange,
  placeholder,
  help,
}: {
  label: string;
  name: keyof ProfileForm;
  value: string;
  onChange: (name: keyof ProfileForm, value: string) => void;
  placeholder?: string;
  help?: string;
}) {
  return (
    <label className="org-field org-field-wide">
      <span>{label}</span>
      <textarea
        name={name}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(name, event.target.value)}
        rows={3}
      />
      {help && <small>{help}</small>}
    </label>
  );
}

export default function Settings() {
  const { company, loading: companyLoading, refreshCompany } = useCompany();

  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      if (!company?.id) {
        if (active) setLoading(companyLoading);
        return;
      }

      setLoading(true);
      setError("");

      const { data: authData, error: authError } =
        await supabase.auth.getUser();

      if (authError || !authData.user) {
        if (active) {
          setError(
            "Unable to verify your signed-in account. Please sign in again."
          );
          setLoading(false);
        }
        return;
      }

      const [companyResult, membershipResult] = await Promise.all([
        supabase
          .from("companies")
          .select("*")
          .eq("id", company.id)
          .maybeSingle(),

        supabase
          .from("company_members")
          .select("role")
          .eq("company_id", company.id)
          .eq("user_id", authData.user.id)
          .eq("is_active", true)
          .limit(2),
      ]);

      if (!active) return;

      if (companyResult.error || !companyResult.data) {
        setError(
          companyResult.error?.message ??
            "Unable to load organisation profile."
        );
      } else {
        const row = companyResult.data as Record<string, unknown>;
        const next = { ...emptyForm };

        for (const key of textFields) {
          const value = row[key];
          if (typeof value === "string") {
            next[key] = value as never;
          }
        }

        next.gst_registered = row.gst_registered === true;
        next.show_bank_details_on_invoice =
          row.show_bank_details_on_invoice !== false;

        setForm(next);
      }

      if (membershipResult.error) {
        setError(
          (current) =>
            current || "Unable to verify your organisation permissions."
        );
      } else {
        setCanEdit(
          (membershipResult.data ?? []).some(
            (m) => m.role === "owner" || m.role === "admin"
          )
        );
      }

      setLoading(false);
    }

    void loadProfile();

    return () => {
      active = false;
    };
  }, [company?.id, companyLoading]);

  function updateField(name: keyof ProfileForm, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
    setMessage("");
  }

  async function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !company?.id) return;

    setError("");
    setMessage("");

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPEG or WebP logo image.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError("Logo must be 2 MB or smaller.");
      return;
    }

    setUploading(true);

    try {
      const extension =
        file.type === "image/png"
          ? "png"
          : file.type === "image/webp"
            ? "webp"
            : "jpg";

      const path = `${company.id}/logo.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("company-logos")
        .upload(path, file, {
          upsert: true,
          contentType: file.type,
          cacheControl: "3600",
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from("company-logos")
        .getPublicUrl(path);

      setForm((current) => ({
        ...current,
        logo_url: data.publicUrl,
      }));

      setMessage(
        "Logo uploaded. Save organisation details to apply it to the profile."
      );
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Logo upload failed."
      );
    } finally {
      setUploading(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!company?.id || !canEdit) return;

    setSaving(true);
    setError("");
    setMessage("");

    const payload = {
      name: form.name.trim(),
      legal_name: form.legal_name.trim() || null,
      business_type: form.business_type || null,
      country: form.country.trim() || "India",
      registered_address: form.registered_address.trim() || null,
      factory_address: form.factory_address.trim() || null,
      billing_address: form.billing_address.trim() || null,
      phone: form.phone.trim() || null,
      alternate_phone: form.alternate_phone.trim() || null,
      email: form.email.trim() || null,
      website: form.website.trim() || null,
      contact_person: form.contact_person.trim() || null,
      contact_designation: form.contact_designation.trim() || null,
      gst_registered: form.gst_registered,
      gstin: form.gst_registered
        ? form.gstin.trim().toUpperCase() || null
        : null,
      state: form.state.trim() || null,
      state_code: form.state_code.trim() || null,
      pan: form.pan.trim().toUpperCase() || null,
      udyam_number: form.udyam_number.trim() || null,
      cin_llpin: form.cin_llpin.trim().toUpperCase() || null,
      bank_account_name: form.bank_account_name.trim() || null,
      bank_name: form.bank_name.trim() || null,
      bank_branch: form.bank_branch.trim() || null,
      bank_account_number: form.bank_account_number.trim() || null,
      bank_ifsc: form.bank_ifsc.trim().toUpperCase() || null,
      bank_account_type: form.bank_account_type || null,
      upi_id: form.upi_id.trim() || null,
      payment_terms: form.payment_terms.trim() || null,
      show_bank_details_on_invoice: form.show_bank_details_on_invoice,
      authorised_signatory: form.authorised_signatory.trim() || null,
      signatory_designation: form.signatory_designation.trim() || null,
      document_footer: form.document_footer.trim() || null,
      logo_url: form.logo_url || null,
      updated_at: new Date().toISOString(),
    };

    try {
      const { data: updatedRows, error: updateError } = await supabase
        .from("companies")
        .update(payload)
        .eq("id", company.id)
        .select("id");

      if (updateError) throw updateError;

      if (!updatedRows || updatedRows.length !== 1) {
        throw new Error(
          "No company row was updated. Check that you are signed in as an active owner/admin of this organisation and that the companies UPDATE policy allows this row."
        );
      }

      await refreshCompany();
      setMessage("Organisation profile saved successfully.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save organisation profile."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading || companyLoading) {
    return (
      <div className="org-loading">
        <LoaderCircle className="org-spin" size={22} />
        Loading organisation settings…
      </div>
    );
  }

  if (!company) {
    return (
      <section className="panel org-message">
        <h2>Organisation unavailable</h2>
        <p>
          Select or connect an organisation before editing its profile.
        </p>
      </section>
    );
  }

  return (
    <div className="org-settings">
      <header className="org-page-header">
        <div>
          <h1>Organisation Settings</h1>
        </div>
        <div className="org-header-mark">
          <Building2 size={24} />
        </div>
      </header>

      {!canEdit && (
        <div className="org-notice">
          <ShieldCheck size={18} />
          You have read-only access. An organisation owner or admin can
          update these details.
        </div>
      )}

      {error && (
        <div className="org-alert" role="alert">
          {error}
        </div>
      )}

      {message && (
        <div className="org-success" role="status">
          <CheckCircle2 size={17} />
          {message}
        </div>
      )}

      <form onSubmit={saveProfile}>
        <section className="panel org-card">
          <SectionHeading
            icon={Building2}
            title="Company profile"
            description="Manage your organisation's identity and registered business details."
          />

          <div className="org-logo-row">
            <div className="org-logo-preview">
              {form.logo_url ? (
                <img
                  src={form.logo_url}
                  alt="Organisation logo preview"
                />
              ) : (
                <Building2 size={30} />
              )}
            </div>

            <div className="org-logo-copy">
              <strong>Organisation logo</strong>
              <p>
                Use your own company logo, not the Fabricle Flow product
                logo. PNG, JPEG or WebP, up to 2 MB.
              </p>

              <label
                className={`button button-outline org-upload-button ${
                  !canEdit || uploading ? "is-disabled" : ""
                }`}
              >
                {uploading ? (
                  <LoaderCircle size={15} className="org-spin" />
                ) : (
                  <Upload size={15} />
                )}

                {uploading ? "Uploading…" : "Upload logo"}

                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={!canEdit || uploading}
                  onChange={uploadLogo}
                  hidden
                />
              </label>
            </div>
          </div>

          <div className="org-form-grid">
            <Field
              label="Display / organisation name"
              name="name"
              value={form.name}
              onChange={updateField}
              required
              placeholder="e.g. ABC Knitting Works"
            />

            <Field
              label="Legal name"
              name="legal_name"
              value={form.legal_name}
              onChange={updateField}
              placeholder="Registered legal name"
            />

            <label className="org-field">
              <span>Business type</span>
              <select
                value={form.business_type}
                onChange={(e) =>
                  updateField("business_type", e.target.value)
                }
              >
                <option value="">Select business type</option>
                <option>Proprietorship</option>
                <option>Partnership</option>
                <option>LLP</option>
                <option>Private Limited Company</option>
                <option>Public Limited Company</option>
                <option>Other</option>
              </select>
            </label>

            <Field
              label="Country"
              name="country"
              value={form.country}
              onChange={updateField}
              required
            />

            <Field
              label="PAN"
              name="pan"
              value={form.pan}
              onChange={updateField}
              placeholder="Optional where applicable"
            />

            <Field
              label="Udyam / MSME number"
              name="udyam_number"
              value={form.udyam_number}
              onChange={updateField}
            />

            <Field
              label="CIN / LLPIN"
              name="cin_llpin"
              value={form.cin_llpin}
              onChange={updateField}
            />
          </div>
        </section>

        <section className="panel org-card">
          <SectionHeading
            icon={MapPin}
            title="Addresses & contact"
            description="Keep registered, factory and billing addresses distinct."
          />

          <div className="org-form-grid">
            <TextAreaField
              label="Registered address"
              name="registered_address"
              value={form.registered_address}
              onChange={updateField}
              placeholder="Address, city, district, state, PIN code"
            />

            <TextAreaField
              label="Factory / works address"
              name="factory_address"
              value={form.factory_address}
              onChange={updateField}
              placeholder="Manufacturing / knitting unit address"
            />

            <TextAreaField
              label="Billing address (if different)"
              name="billing_address"
              value={form.billing_address}
              onChange={updateField}
              placeholder="Leave blank if same as registered address"
            />

            <Field
              label="Primary contact number"
              name="phone"
              value={form.phone}
              onChange={updateField}
              required
              placeholder="+91…"
              type="tel"
            />

            <Field
              label="Alternate contact number"
              name="alternate_phone"
              value={form.alternate_phone}
              onChange={updateField}
              type="tel"
            />

            <Field
              label="Business email"
              name="email"
              value={form.email}
              onChange={updateField}
              type="email"
            />

            <Field
              label="Website"
              name="website"
              value={form.website}
              onChange={updateField}
              type="url"
            />

            <Field
              label="Primary contact person"
              name="contact_person"
              value={form.contact_person}
              onChange={updateField}
            />

            <Field
              label="Contact designation"
              name="contact_designation"
              value={form.contact_designation}
              onChange={updateField}
            />
          </div>
        </section>

        <section className="panel org-card">
          <SectionHeading
            icon={ShieldCheck}
            title="Tax & registrations"
            description="Only configured registration details will be shown on relevant documents."
          />

          <label className="org-check-row">
            <input
              type="checkbox"
              checked={form.gst_registered}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  gst_registered: e.target.checked,
                }))
              }
            />
            Organisation is GST registered
          </label>

          <div className="org-form-grid">
            <Field
              label="GSTIN"
              name="gstin"
              value={form.gstin}
              onChange={updateField}
              required={form.gst_registered}
              placeholder="15-character GSTIN"
            />

            <Field
              label="Registered state"
              name="state"
              value={form.state}
              onChange={updateField}
            />

            <Field
              label="State code"
              name="state_code"
              value={form.state_code}
              onChange={updateField}
              placeholder="GST state code"
            />
          </div>
        </section>

        <section className="panel org-card">
          <SectionHeading
            icon={Landmark}
            title="Bank & payment details"
            description="Used for invoice payment instructions when enabled."
          />

          <div className="org-form-grid">
            <Field
              label="Beneficiary / account holder name"
              name="bank_account_name"
              value={form.bank_account_name}
              onChange={updateField}
            />

            <Field
              label="Bank name"
              name="bank_name"
              value={form.bank_name}
              onChange={updateField}
            />

            <Field
              label="Branch"
              name="bank_branch"
              value={form.bank_branch}
              onChange={updateField}
            />

            <Field
              label="Account number"
              name="bank_account_number"
              value={form.bank_account_number}
              onChange={updateField}
            />

            <Field
              label="IFSC code"
              name="bank_ifsc"
              value={form.bank_ifsc}
              onChange={updateField}
            />

            <label className="org-field">
              <span>Account type</span>
              <select
                value={form.bank_account_type}
                onChange={(e) =>
                  updateField("bank_account_type", e.target.value)
                }
              >
                <option value="">Select type</option>
                <option>Savings</option>
                <option>Current</option>
                <option>Cash Credit</option>
                <option>Other</option>
              </select>
            </label>

            <Field
              label="UPI ID (optional)"
              name="upi_id"
              value={form.upi_id}
              onChange={updateField}
            />

            <TextAreaField
              label="Payment terms / instructions"
              name="payment_terms"
              value={form.payment_terms}
              onChange={updateField}
              placeholder="e.g. Payment due within 15 days"
            />
          </div>

          <label className="org-check-row">
            <input
              type="checkbox"
              checked={form.show_bank_details_on_invoice}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  show_bank_details_on_invoice: e.target.checked,
                }))
              }
            />
            Show bank/payment details on invoices
          </label>
        </section>

        <section className="panel org-card">
          <SectionHeading
            icon={CheckCircle2}
            title="Authorisation & document footer"
            description="Optional defaults for printable documents."
          />

          <div className="org-form-grid">
            <Field
              label="Authorised signatory name"
              name="authorised_signatory"
              value={form.authorised_signatory}
              onChange={updateField}
            />

            <Field
              label="Signatory designation"
              name="signatory_designation"
              value={form.signatory_designation}
              onChange={updateField}
            />

            <TextAreaField
              label="Default document footer / notes"
              name="document_footer"
              value={form.document_footer}
              onChange={updateField}
              placeholder="Optional standard footer text"
            />
          </div>
        </section>

        <div className="org-save-bar">
          <p>
            Changes apply to future printable documents after they are
            saved.
          </p>

          <button
            type="submit"
            className="button button-dark"
            disabled={!canEdit || saving || uploading}
          >
            {saving ? (
              <LoaderCircle size={16} className="org-spin" />
            ) : (
              <Save size={16} />
            )}

            {saving ? "Saving…" : "Save organisation profile"}
          </button>
        </div>
      </form>
    </div>
  );
}
