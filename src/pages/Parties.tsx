import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import {
  Plus,
  Search,
  Pencil,
  X,
  Users,
  RefreshCw,
  Settings2,
  Check,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";

type Party = {
  id: string;
  company_id: string;
  party_code: string;
  name: string;
  party_type: string;
  phone: string | null;
  email: string | null;
  tax_id: string | null;
  address: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
};

type PartyForm = {
  party_code: string;
  name: string;
  party_type: string;
  phone: string;
  email: string;
  tax_id: string;
  address_line: string;
  city: string;
  state: string;
  postal_code: string;
};

type NumberingSettings = {
  mode: "manual" | "automatic";
  prefix: string;
  nextNumber: number;
  digits: number;
};

const PAGE_SIZE = 10;

const emptyForm: PartyForm = {
  party_code: "",
  name: "",
  party_type: "customer",
  phone: "",
  email: "",
  tax_id: "",
  address_line: "",
  city: "",
  state: "",
  postal_code: "",
};

const partyTypes = [
  { value: "customer", label: "Customer" },
  { value: "supplier", label: "Supplier / Service Provider" },
  { value: "both", label: "Customer & Supplier" },
  { value: "job_worker", label: "Job Worker" },
  { value: "transporter", label: "Transporter" },
  { value: "other", label: "Other" },
];

const initialNumbering: NumberingSettings = {
  mode: "automatic",
  prefix: "P-",
  nextNumber: 2,
  digits: 3,
};

function formatCode(settings: NumberingSettings) {
  return (
    settings.prefix +
    String(settings.nextNumber).padStart(settings.digits, "0")
  );
}

export default function Parties() {
  const { company, loading: companyLoading } = useCompany();

  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);

  // Search and pagination
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [showNumbering, setShowNumbering] = useState(false);
  const [editingParty, setEditingParty] = useState<Party | null>(null);

  // Form states
  const [form, setForm] = useState<PartyForm>(emptyForm);

  const [numbering, setNumbering] =
    useState<NumberingSettings>(initialNumbering);

  const [draftNumbering, setDraftNumbering] =
    useState<NumberingSettings>(initialNumbering);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // --------------------------------------------------
  // LOAD PARTIES - SERVER SIDE PAGINATION
  // --------------------------------------------------

  const loadParties = useCallback(async () => {
    if (!company?.id) {
      setParties([]);
      setTotalRecords(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const from = (currentPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("parties")
      .select(
        "id, company_id, party_code, name, party_type, phone, email, tax_id, address, is_active, created_at",
        { count: "exact" }
      )
      .eq("company_id", company.id);

    // Search across all records in the company
    if (debouncedSearch) {
      const term = debouncedSearch
        .replace(/[,%()]/g, "")
        .trim();

      if (term) {
        query = query.or(
          `name.ilike.%${term}%,party_code.ilike.%${term}%,party_type.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`
        );
      }
    }

    const {
      data,
      error: queryError,
      count,
    } = await query
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (queryError) {
      setError(`Couldn't load parties: ${queryError.message}`);
      setParties([]);
      setTotalRecords(0);
    } else {
      setParties((data ?? []) as Party[]);
      setTotalRecords(count ?? 0);
    }

    setLoading(false);
  }, [company?.id, currentPage, debouncedSearch]);

  // --------------------------------------------------
  // LOAD NUMBERING SETTINGS SEPARATELY
  // --------------------------------------------------

  const loadNumberingSettings = useCallback(async () => {
    if (!company?.id) return;

    const { data: sequenceData, error: sequenceError } = await supabase
      .from("document_sequences")
      .select("mode, prefix, next_number, digits")
      .eq("company_id", company.id)
      .eq("document_type", "party")
      .maybeSingle();

    if (sequenceError) {
      setError(
        `Couldn't load party numbering: ${sequenceError.message}`
      );
      return;
    }

    if (sequenceData) {
      const loadedSettings: NumberingSettings = {
        mode: sequenceData.mode as "manual" | "automatic",
        prefix: sequenceData.prefix,
        nextNumber: Number(sequenceData.next_number),
        digits: Number(sequenceData.digits),
      };

      setNumbering(loadedSettings);
      setDraftNumbering(loadedSettings);
    }
  }, [company?.id]);

  // --------------------------------------------------
  // DEBOUNCED SEARCH
  // --------------------------------------------------

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setCurrentPage(1);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [search]);

  // --------------------------------------------------
  // INITIAL AND PAGINATION LOADS
  // --------------------------------------------------

  useEffect(() => {
    void loadParties();
  }, [loadParties]);

  useEffect(() => {
    void loadNumberingSettings();
  }, [loadNumberingSettings]);

  // --------------------------------------------------
  // FORM HELPERS
  // --------------------------------------------------

  function updateField(field: keyof PartyForm, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function closeModal() {
    if (saving) return;

    setShowModal(false);
    setShowNumbering(false);
  }

  function startCreate() {
    setEditingParty(null);

    setForm({
      ...emptyForm,
      party_code:
        numbering.mode === "automatic"
          ? formatCode(numbering)
          : "",
    });

    setError("");
    setNotice("");
    setShowNumbering(false);
    setShowModal(true);
  }

  function startEdit(party: Party) {
    const address = party.address ?? {};

    setEditingParty(party);

    setForm({
      party_code: party.party_code,
      name: party.name,
      party_type: party.party_type,
      phone: party.phone ?? "",
      email: party.email ?? "",
      tax_id: party.tax_id ?? "",
      address_line: String(address.address_line ?? ""),
      city: String(address.city ?? ""),
      state: String(address.state ?? ""),
      postal_code: String(address.postal_code ?? ""),
    });

    setError("");
    setNotice("");
    setShowNumbering(false);
    setShowModal(true);
  }

  // --------------------------------------------------
  // PARTY NUMBERING SETTINGS
  // --------------------------------------------------

  function openNumberingSettings() {
    setDraftNumbering({ ...numbering });
    setShowNumbering((current) => !current);
  }

  async function applyNumberingSettings() {
    if (!company?.id) {
      setError(
        "Your organisation could not be identified. Refresh and retry."
      );
      return;
    }

    if (
      draftNumbering.mode === "automatic" &&
      !draftNumbering.prefix.trim()
    ) {
      setError("Enter a prefix for automatic party codes.");
      return;
    }

    setError("");

    const { error: saveError } = await supabase
      .from("document_sequences")
      .upsert(
        {
          company_id: company.id,
          document_type: "party",
          mode: draftNumbering.mode,
          prefix: draftNumbering.prefix,
          next_number: draftNumbering.nextNumber,
          digits: draftNumbering.digits,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "company_id,document_type",
        }
      );

    if (saveError) {
      setError(
        `Couldn't save party numbering: ${saveError.message}`
      );
      return;
    }

    setNumbering({ ...draftNumbering });

    if (
      draftNumbering.mode === "automatic" &&
      !editingParty
    ) {
      setForm((current) => ({
        ...current,
        party_code: formatCode(draftNumbering),
      }));
    } else if (
      draftNumbering.mode === "manual" &&
      !editingParty
    ) {
      setForm((current) => ({
        ...current,
        party_code: "",
      }));
    }

    setNotice("Party numbering settings saved.");
    setShowNumbering(false);
  }

  // --------------------------------------------------
  // CREATE / UPDATE PARTY
  // --------------------------------------------------

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!company?.id) {
      setError(
        "Your organisation could not be identified. Refresh and retry."
      );
      return;
    }

    const typedPartyCode = form.party_code.trim();
    const partyName = form.name.trim();

    if (
      (!typedPartyCode &&
        (editingParty || numbering.mode === "manual")) ||
      !partyName
    ) {
      setError("Party code and party name are required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    const payload = {
      name: partyName,
      party_type: form.party_type,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      tax_id: form.tax_id.trim() || null,
      address: {
        address_line: form.address_line.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        postal_code: form.postal_code.trim(),
      },
    };

    try {
      if (editingParty) {
        const partyCode = typedPartyCode;

        const {
          data: existing,
          error: duplicateCheckError,
        } = await supabase
          .from("parties")
          .select("id")
          .eq("company_id", company.id)
          .eq("party_code", partyCode)
          .limit(1);

        if (duplicateCheckError) {
          throw duplicateCheckError;
        }

        if (
          existing?.some(
            (record) => record.id !== editingParty.id
          )
        ) {
          throw new Error(
            "This party code already exists in your organisation. Please use another code."
          );
        }

        const { error: updateError } = await supabase
          .from("parties")
          .update({
            ...payload,
            party_code: partyCode,
          })
          .eq("id", editingParty.id)
          .eq("company_id", company.id);

        if (updateError) {
          throw updateError;
        }

        setNotice("Party updated successfully.");
      } else {
        let finalPartyCode = typedPartyCode;

        if (numbering.mode === "automatic") {
          const {
            data: generated,
            error: codeError,
          } = await supabase.rpc("next_document_code", {
            p_company_id: company.id,
            p_document_type: "party",
          });

          if (codeError) {
            throw codeError;
          }

          if (
            typeof generated !== "string" ||
            !generated
          ) {
            throw new Error(
              "The database did not return a party code."
            );
          }

          finalPartyCode = generated;
        }

        const {
          data: existing,
          error: duplicateCheckError,
        } = await supabase
          .from("parties")
          .select("id")
          .eq("company_id", company.id)
          .eq("party_code", finalPartyCode)
          .limit(1);

        if (duplicateCheckError) {
          throw duplicateCheckError;
        }

        if (existing && existing.length > 0) {
          throw new Error(
            `Party code ${finalPartyCode} already exists. Please retry or review numbering settings.`
          );
        }

        const { error: insertError } = await supabase
          .from("parties")
          .insert({
            ...payload,
            party_code: finalPartyCode,
            company_id: company.id,
            is_active: true,
          });

        if (insertError) {
          throw insertError;
        }

        setNotice(
          `Party ${finalPartyCode} added successfully.`
        );
      }

      setShowModal(false);
      setShowNumbering(false);
      setEditingParty(null);
      setForm(emptyForm);

      // Return to page 1 after saving.
      if (currentPage === 1) {
        await loadParties();
      } else {
        setCurrentPage(1);
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save this party."
      );
    } finally {
      setSaving(false);
    }
  }

  // --------------------------------------------------
  // ACTIVATE / DEACTIVATE PARTY
  // --------------------------------------------------

  async function toggleActive(party: Party) {
    const nextStatus = !party.is_active;

    const confirmed = window.confirm(
      nextStatus
        ? `Reactivate ${party.name}?`
        : `Deactivate ${party.name}? They will remain in existing records.`
    );

    if (!confirmed || !company?.id) return;

    setError("");
    setNotice("");

    const { error: updateError } = await supabase
      .from("parties")
      .update({
        is_active: nextStatus,
      })
      .eq("id", party.id)
      .eq("company_id", company.id);

    if (updateError) {
      setError(
        `Couldn't update status: ${updateError.message}`
      );
      return;
    }

    setNotice(
      nextStatus
        ? "Party reactivated."
        : "Party deactivated."
    );

    await loadParties();
  }

  // --------------------------------------------------
  // PAGINATION VALUES
  // --------------------------------------------------

  const filteredParties = parties;

  const totalPages = Math.ceil(
    totalRecords / PAGE_SIZE
  );

  const startRecord =
    totalRecords === 0
      ? 0
      : (currentPage - 1) * PAGE_SIZE + 1;

  const endRecord = Math.min(
    currentPage * PAGE_SIZE,
    totalRecords
  );

  // Show first, last and nearby page numbers.
  const visiblePageNumbers = Array.from(
    { length: totalPages },
    (_, index) => index + 1
  ).filter(
    (page) =>
      page === 1 ||
      page === totalPages ||
      Math.abs(page - currentPage) <= 1
  );

  // --------------------------------------------------
  // LOADING STATES
  // --------------------------------------------------

  if (companyLoading) {
    return (
      <div className="parties-page">
        <p>Loading organisation...</p>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="parties-page">
        <p role="alert">
          Your organisation could not be loaded.
        </p>
      </div>
    );
  }

  // --------------------------------------------------
  // PAGE UI
  // --------------------------------------------------

  return (
    <section className="parties-page">
      <header className="parties-header">
        <div>
          <h1>Parties</h1>
        </div>

        <button
          type="button"
          className="parties-primary-button"
          onClick={startCreate}
        >
          <Plus size={17} />
          Add party
        </button>
      </header>

      {/* Search and refresh */}
      <div className="parties-toolbar">
        <div className="parties-search">
          <Search size={17} />

          <input
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder="Search name, code, phone or email"
            aria-label="Search parties"
          />

          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setSearch("");
                setCurrentPage(1);
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>

        <button
          type="button"
          className="parties-secondary-button"
          onClick={() => void loadParties()}
          disabled={loading}
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>

      {/* Messages */}
      {error && !showModal && (
        <p className="parties-alert" role="alert">
          {error}
        </p>
      )}

      {notice && (
        <p className="parties-success" role="status">
          {notice}
        </p>
      )}

      {/* List heading */}
      <div className="parties-list-heading">
        <div>
          <h2>Party directory</h2>
          <p>
            {totalRecords}{" "}
            {totalRecords === 1 ? "record" : "records"}
          </p>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="parties-empty">
          Loading parties...
        </div>
      ) : filteredParties.length === 0 ? (
        <div className="parties-empty">
          <Users size={27} />

          <strong>
            {debouncedSearch
              ? "No matching parties"
              : "No parties yet"}
          </strong>

          <p>
            {debouncedSearch
              ? "Try a different search term."
              : "Add your first customer or business partner to get started."}
          </p>

          {!debouncedSearch && (
            <button
              type="button"
              className="parties-primary-button"
              onClick={startCreate}
            >
              <Plus size={17} />
              Add first party
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="parties-table-wrap">
            <table className="parties-table">
              <thead>
                <tr>
                  <th>Party</th>
                  <th>Type</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredParties.map((party) => (
                  <tr key={party.id}>
                    <td>
                      <strong>{party.name}</strong>
                      <span className="parties-code">
                        {party.party_code}
                      </span>
                    </td>

                    <td>
                      {partyTypes.find(
                        (type) =>
                          type.value === party.party_type
                      )?.label ?? party.party_type}
                    </td>

                    <td>
                      <span>{party.phone || "—"}</span>

                      {party.email && (
                        <span className="parties-contact-email">
                          {party.email}
                        </span>
                      )}
                    </td>

                    <td>
                      <span
                        className={`parties-status ${
                          party.is_active
                            ? "active"
                            : "inactive"
                        }`}
                      >
                        {party.is_active
                          ? "Active"
                          : "Inactive"}
                      </span>
                    </td>

                    <td>
                      <div className="parties-row-actions">
                        <button
                          type="button"
                          className="parties-secondary-button"
                          onClick={() => startEdit(party)}
                        >
                          <Pencil size={14} />
                          Edit
                        </button>

                        <button
                          type="button"
                          className="parties-secondary-button"
                          onClick={() =>
                            void toggleActive(party)
                          }
                        >
                          {party.is_active
                            ? "Deactivate"
                            : "Reactivate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile list */}
            <div className="parties-mobile-list">
              {filteredParties.map((party) => (
                <article
                  className="parties-mobile-card"
                  key={party.id}
                >
                  <div className="parties-mobile-card-top">
                    <div>
                      <strong>{party.name}</strong>

                      <span className="parties-code">
                        {party.party_code}
                      </span>
                    </div>

                    <span
                      className={`parties-status ${
                        party.is_active
                          ? "active"
                          : "inactive"
                      }`}
                    >
                      {party.is_active
                        ? "Active"
                        : "Inactive"}
                    </span>
                  </div>

                  <span>
                    {partyTypes.find(
                      (type) =>
                        type.value === party.party_type
                    )?.label ?? party.party_type}
                  </span>

                  {party.phone && (
                    <span>{party.phone}</span>
                  )}

                  {party.email && (
                    <span>{party.email}</span>
                  )}

                  <div className="parties-row-actions">
                    <button
                      type="button"
                      className="parties-secondary-button"
                      onClick={() => startEdit(party)}
                    >
                      <Pencil size={14} />
                      Edit
                    </button>

                    <button
                      type="button"
                      className="parties-secondary-button"
                      onClick={() =>
                        void toggleActive(party)
                      }
                    >
                      {party.is_active
                        ? "Deactivate"
                        : "Reactivate"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>

          {/* Pagination */}
          {totalRecords > 0 && (
            <div className="parties-pagination">
              <span className="parties-pagination-info">
                Showing {startRecord}–{endRecord} of{" "}
                {totalRecords} records
              </span>

              <div className="parties-pagination-controls">
                <button
                  type="button"
                  disabled={currentPage === 1 || loading}
                  onClick={() =>
                    setCurrentPage((page) =>
                      Math.max(1, page - 1)
                    )
                  }
                  aria-label="Previous page"
                >
                  &lt;
                </button>

                {visiblePageNumbers.map((page, index) => {
                  const previousPage =
                    visiblePageNumbers[index - 1];

                  const showEllipsis =
                    previousPage !== undefined &&
                    page - previousPage > 1;

                  return (
                    <span
                      className="parties-pagination-page"
                      key={page}
                    >
                      {showEllipsis && (
                        <span className="parties-pagination-ellipsis">
                          …
                        </span>
                      )}

                      <button
                        type="button"
                        className={
                          currentPage === page
                            ? "active"
                            : ""
                        }
                        disabled={loading}
                        onClick={() =>
                          setCurrentPage(page)
                        }
                        aria-current={
                          currentPage === page
                            ? "page"
                            : undefined
                        }
                      >
                        {page}
                      </button>
                    </span>
                  );
                })}

                <button
                  type="button"
                  disabled={
                    currentPage >= totalPages || loading
                  }
                  onClick={() =>
                    setCurrentPage((page) =>
                      Math.min(totalPages, page + 1)
                    )
                  }
                  aria-label="Next page"
                >
                  &gt;
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Add / Edit modal */}
      {showModal && (
        <div
          className="party-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeModal();
            }
          }}
        >
          <section
            className="party-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="party-modal-title"
          >
            <header className="party-modal-header">
              <div>
                <h2 id="party-modal-title">
                  {editingParty
                    ? "Edit Party"
                    : "Add Party"}
                </h2>

                <p>
                  {editingParty
                    ? "Update this business party's details."
                    : "Create a new business party."}
                </p>
              </div>

              <button
                type="button"
                className="party-modal-close"
                onClick={closeModal}
                aria-label="Close dialog"
                disabled={saving}
              >
                <X size={21} />
              </button>
            </header>

            <form
              className="party-modal-form"
              onSubmit={handleSubmit}
            >
              <div className="party-modal-body">
                {error && (
                  <p className="parties-alert" role="alert">
                    {error}
                  </p>
                )}

                <h3>Basic Details</h3>

                <div className="party-modal-grid">
                  <label className="party-code-field">
                    Party Code

                    <div className="party-code-input-row">
                      <input
                        required
                        maxLength={50}
                        value={form.party_code}
                        onChange={(event) =>
                          updateField(
                            "party_code",
                            event.target.value
                          )
                        }
                        placeholder="Example: P-001"
                        readOnly={
                          numbering.mode === "automatic" &&
                          !editingParty
                        }
                      />

                      <button
                        type="button"
                        className="party-number-settings-button"
                        onClick={openNumberingSettings}
                        aria-label="Party code numbering settings"
                        title="Party code settings"
                      >
                        <Settings2 size={18} />
                      </button>
                    </div>

                    {showNumbering && (
                      <div className="party-numbering-popover">
                        <div className="party-numbering-header">
                          <div>
                            <strong>
                              Party Code Settings
                            </strong>
                            <p>
                              Choose how codes are generated.
                            </p>
                          </div>

                          <button
                            type="button"
                            className="party-popover-close"
                            onClick={() =>
                              setShowNumbering(false)
                            }
                            aria-label="Close numbering settings"
                          >
                            <X size={17} />
                          </button>
                        </div>

                        <div className="party-numbering-modes">
                          <label className="party-radio-option">
                            <input
                              type="radio"
                              name="party-code-mode"
                              checked={
                                draftNumbering.mode === "manual"
                              }
                              onChange={() =>
                                setDraftNumbering(
                                  (current) => ({
                                    ...current,
                                    mode: "manual",
                                  })
                                )
                              }
                            />

                            <span>
                              <strong>Manual</strong>
                              <small>
                                Enter each code yourself
                              </small>
                            </span>
                          </label>

                          <label className="party-radio-option">
                            <input
                              type="radio"
                              name="party-code-mode"
                              checked={
                                draftNumbering.mode ===
                                "automatic"
                              }
                              onChange={() =>
                                setDraftNumbering(
                                  (current) => ({
                                    ...current,
                                    mode: "automatic",
                                  })
                                )
                              }
                            />

                            <span>
                              <strong>Automatic</strong>
                              <small>
                                Generate codes using a sequence
                              </small>
                            </span>
                          </label>
                        </div>

                        {draftNumbering.mode ===
                          "automatic" && (
                          <div className="party-numbering-options">
                            <label>
                              Prefix

                              <input
                                value={draftNumbering.prefix}
                                maxLength={20}
                                onChange={(event) =>
                                  setDraftNumbering(
                                    (current) => ({
                                      ...current,
                                      prefix:
                                        event.target.value,
                                    })
                                  )
                                }
                                placeholder="P-"
                              />
                            </label>

                            <label>
                              Next number

                              <input
                                type="number"
                                min={1}
                                step={1}
                                value={
                                  draftNumbering.nextNumber
                                }
                                onChange={(event) =>
                                  setDraftNumbering(
                                    (current) => ({
                                      ...current,
                                      nextNumber: Math.max(
                                        1,
                                        Number(
                                          event.target.value
                                        ) || 1
                                      ),
                                    })
                                  )
                                }
                              />
                            </label>

                            <label>
                              Number of digits

                              <select
                                value={draftNumbering.digits}
                                onChange={(event) =>
                                  setDraftNumbering(
                                    (current) => ({
                                      ...current,
                                      digits: Number(
                                        event.target.value
                                      ),
                                    })
                                  )
                                }
                              >
                                <option value={3}>
                                  3 digits — 001
                                </option>
                                <option value={4}>
                                  4 digits — 0001
                                </option>
                                <option value={5}>
                                  5 digits — 00001
                                </option>
                                <option value={6}>
                                  6 digits — 000001
                                </option>
                              </select>
                            </label>

                            <div className="party-code-preview">
                              <span>Next code preview</span>
                              <strong>
                                {formatCode(draftNumbering)}
                              </strong>
                            </div>
                          </div>
                        )}

                        <div className="party-numbering-actions">
                          <button
                            type="button"
                            className="parties-secondary-button"
                            onClick={() =>
                              setShowNumbering(false)
                            }
                          >
                            Cancel
                          </button>

                          <button
                            type="button"
                            className="parties-primary-button"
                            onClick={() =>
                              void applyNumberingSettings()
                            }
                          >
                            <Check size={15} />
                            Apply
                          </button>
                        </div>
                      </div>
                    )}
                  </label>

                  <label>
                    Party Name

                    <input
                      required
                      maxLength={150}
                      value={form.name}
                      onChange={(event) =>
                        updateField("name", event.target.value)
                      }
                      placeholder="Example: ABC Mills"
                    />
                  </label>

                  <label>
                    Party Type

                    <select
                      value={form.party_type}
                      onChange={(event) =>
                        updateField(
                          "party_type",
                          event.target.value
                        )
                      }
                    >
                      {partyTypes.map((type) => (
                        <option
                          key={type.value}
                          value={type.value}
                        >
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    GSTIN / Tax ID

                    <input
                      maxLength={30}
                      value={form.tax_id}
                      onChange={(event) =>
                        updateField(
                          "tax_id",
                          event.target.value
                        )
                      }
                      placeholder="Tax identification number"
                    />
                  </label>
                </div>

                <h3>Contact Details</h3>

                <div className="party-modal-grid">
                  <label>
                    Phone

                    <input
                      type="tel"
                      autoComplete="tel"
                      value={form.phone}
                      onChange={(event) =>
                        updateField("phone", event.target.value)
                      }
                      placeholder="Business phone number"
                    />
                  </label>

                  <label>
                    Email

                    <input
                      type="email"
                      autoComplete="email"
                      value={form.email}
                      onChange={(event) =>
                        updateField("email", event.target.value)
                      }
                      placeholder="accounts@example.com"
                    />
                  </label>
                </div>

                <h3>Address</h3>

                <div className="party-modal-grid">
                  <label className="party-field-full">
                    Address

                    <textarea
                      rows={3}
                      value={form.address_line}
                      onChange={(event) =>
                        updateField(
                          "address_line",
                          event.target.value
                        )
                      }
                      placeholder="Full business address"
                    />
                  </label>

                  <label>
                    City

                    <input
                      value={form.city}
                      onChange={(event) =>
                        updateField("city", event.target.value)
                      }
                    />
                  </label>

                  <label>
                    State

                    <input
                      value={form.state}
                      onChange={(event) =>
                        updateField("state", event.target.value)
                      }
                    />
                  </label>

                  <label>
                    Postal Code

                    <input
                      value={form.postal_code}
                      onChange={(event) =>
                        updateField(
                          "postal_code",
                          event.target.value
                        )
                      }
                    />
                  </label>
                </div>
              </div>

              <footer className="party-modal-footer">
                <button
                  type="button"
                  className="parties-secondary-button"
                  onClick={closeModal}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="parties-primary-button"
                  disabled={saving}
                >
                  {saving
                    ? "Saving..."
                    : editingParty
                      ? "Save Changes"
                      : "Save Party"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}