
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  Plus,
  Search,
  RefreshCw,
  Pencil,
  Power,
  X,
  Settings2,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";

type Item = {
  id: string;
  company_id: string;
  sku: string;
  name: string;
  item_type: string;
  unit_id: string | null;
  notes: string | null;
  is_active: boolean;
};

type Unit = {
  id: string;
  code: string;
  name: string;
};

type CodeSettings = {
  mode: "manual" | "automatic";
  prefix: string;
  nextNumber: number;
  digits: number;
};

const PAGE_SIZE = 10;

const defaultCodeSettings: CodeSettings = {
  mode: "automatic",
  prefix: "ITM-",
  nextNumber: 1,
  digits: 3,
};

const emptyForm = {
  sku: "",
  name: "",
  item_type: "yarn",
  unit_id: "",
  notes: "",
};

export default function Items() {
  const { company } = useCompany();

  const [items, setItems] = useState<Item[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingStatus, setChangingStatus] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [codeSettingsOpen, setCodeSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(defaultCodeSettings);

  const generatedCode = useMemo(
    () =>
      settings.prefix +
      String(settings.nextNumber).padStart(settings.digits, "0"),
    [settings]
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const firstRecord =
    totalCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastRecord = Math.min(currentPage * PAGE_SIZE, totalCount);

  // Wait until the user pauses typing before searching.
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setCurrentPage(1);
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [search]);

  // Fetch only the 10 records required for the current page.
  const loadData = useCallback(async () => {
    if (!company?.id) {
      setItems([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const from = (currentPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("items")
      .select(
        "id, company_id, sku, name, item_type, unit_id, notes, is_active",
        { count: "exact" }
      )
      .eq("company_id", company.id);

    // Search is performed in the database.
    const term = debouncedSearch.replace(/[,%()]/g, " ").trim();

    if (term) {
      const pattern = `%${term}%`;

      query = query.or(
        `sku.ilike.${pattern},name.ilike.${pattern},item_type.ilike.${pattern},notes.ilike.${pattern}`
      );
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
      setError(`Unable to load items: ${queryError.message}`);
      setItems([]);
      setTotalCount(0);
    } else {
      setItems((data ?? []) as Item[]);
      setTotalCount(count ?? 0);
    }

    setLoading(false);
  }, [company?.id, currentPage, debouncedSearch]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Units and numbering settings are loaded separately.
  // They are not fetched again whenever the user changes pages.
  useEffect(() => {
    let cancelled = false;

    async function loadSupportingData() {
      if (!company?.id) {
        setUnits([]);
        return;
      }

      const [unitsResult, sequenceResult] = await Promise.all([
        supabase
          .from("units")
          .select("id, code, name")
          .eq("company_id", company.id)
          .order("name"),

        supabase
          .from("document_sequences")
          .select("mode, prefix, next_number, digits")
          .eq("company_id", company.id)
          .eq("document_type", "item")
          .maybeSingle(),
      ]);

      if (cancelled) return;

      if (unitsResult.error) {
        setError((current) =>
          current || `Unable to load units: ${unitsResult.error.message}`
        );
        setUnits([]);
      } else {
        setUnits((unitsResult.data ?? []) as Unit[]);
      }

      if (sequenceResult.error) {
        setError((current) =>
          current ||
          `Unable to load item numbering: ${sequenceResult.error.message}`
        );
      } else if (sequenceResult.data) {
        setSettings({
          mode: sequenceResult.data.mode as "manual" | "automatic",
          prefix: sequenceResult.data.prefix,
          nextNumber: Number(sequenceResult.data.next_number),
          digits: Number(sequenceResult.data.digits),
        });
      }
    }

    void loadSupportingData();

    return () => {
      cancelled = true;
    };
  }, [company?.id]);

  function openAdd() {
    setEditing(null);
    setForm({
      ...emptyForm,
      sku: settings.mode === "automatic" ? generatedCode : "",
    });
    setNotice("");
    setError("");
    setCodeSettingsOpen(false);
    setModalOpen(true);
  }

  function openEdit(item: Item) {
    setEditing(item);
    setForm({
      sku: item.sku,
      name: item.name,
      item_type: item.item_type,
      unit_id: item.unit_id ?? "",
      notes: item.notes ?? "",
    });
    setNotice("");
    setError("");
    setCodeSettingsOpen(false);
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;

    setModalOpen(false);
    setCodeSettingsOpen(false);
    setError("");
  }

  async function applyItemNumberingSettings() {
    if (!company?.id) {
      setError("Your organisation is not available. Please try again.");
      return;
    }

    if (!settings.prefix.trim()) {
      setError("Enter a prefix for automatic item codes.");
      return;
    }

    setError("");

    const { error: saveError } = await supabase
      .from("document_sequences")
      .upsert(
        {
          company_id: company.id,
          document_type: "item",
          mode: settings.mode,
          prefix: settings.prefix,
          next_number: settings.nextNumber,
          digits: settings.digits,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,document_type" }
      );

    if (saveError) {
      setError(`Unable to save numbering settings: ${saveError.message}`);
      return;
    }

    if (settings.mode === "automatic" && !editing) {
      setForm((current) => ({ ...current, sku: generatedCode }));
    } else if (settings.mode === "manual" && !editing) {
      setForm((current) => ({ ...current, sku: "" }));
    }

    setNotice("Item numbering settings saved.");
    setCodeSettingsOpen(false);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!company?.id) {
      setError("Your organisation is not available. Please try again.");
      return;
    }

    const sku = form.sku.trim();
    const name = form.name.trim();

    if (!sku || !name) {
      setError("Enter both an item code and item name.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    const payload = {
      company_id: company.id,
      sku,
      name,
      item_type: form.item_type,
      unit_id: form.unit_id || null,
      notes: form.notes.trim() || null,
    };

    try {
      if (editing) {
        const { error: updateError } = await supabase
          .from("items")
          .update({
            sku: payload.sku,
            name: payload.name,
            item_type: payload.item_type,
            unit_id: payload.unit_id,
            notes: payload.notes,
          })
          .eq("id", editing.id)
          .eq("company_id", company.id);

        if (updateError) throw updateError;

        setNotice("Item updated successfully.");
      } else {
        let finalSku = sku;

        if (settings.mode === "automatic") {
          const { data: generated, error: codeError } = await supabase.rpc(
            "next_document_code",
            {
              p_company_id: company.id,
              p_document_type: "item",
            }
          );

          if (codeError) throw codeError;

          if (typeof generated !== "string" || !generated) {
            throw new Error("The database did not return an item code.");
          }

          finalSku = generated;
        }

        const { error: insertError } = await supabase
          .from("items")
          .insert({
            ...payload,
            sku: finalSku,
            is_active: true,
          });

        if (insertError) throw insertError;

        setNotice(`Item ${finalSku} created successfully.`);
      }

      setModalOpen(false);
      setCodeSettingsOpen(false);
      setCurrentPage(1);
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save item. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(item: Item) {
    if (!company?.id || changingStatus) return;

    const action = item.is_active ? "deactivate" : "activate";

    if (!window.confirm(`${action} "${item.name}"?`)) return;

    setError("");
    setNotice("");
    setChangingStatus(item.id);

    try {
      const { error: updateError } = await supabase
        .from("items")
        .update({ is_active: !item.is_active })
        .eq("id", item.id)
        .eq("company_id", company.id);

      if (updateError) throw updateError;

      setNotice(`Item ${action}d successfully.`);
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error
          ? `Unable to ${action} item: ${err.message}`
          : `Unable to ${action} item. Please try again.`
      );
    } finally {
      setChangingStatus(null);
    }
  }

  function updateAutomaticCode(next: CodeSettings) {
    setSettings(next);

    if (next.mode === "automatic" && !editing) {
      const nextCode =
        next.prefix +
        String(next.nextNumber).padStart(next.digits, "0");

      setForm((current) => ({ ...current, sku: nextCode }));
    }
  }

  return (
    <main className="page-content">
      <header className="page-heading">
        <div>
          <h1>Items</h1>
        </div>

        <button className="primary-button" onClick={openAdd}>
          <Plus size={17} />
          Add item
        </button>
      </header>

      {notice && (
        <p className="success-message" role="status">
          {notice}
        </p>
      )}

      {error && !modalOpen && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      <section className="content-panel">
        <div className="toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search items"
              placeholder="Search item name, code or type"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <button
            className="secondary-button"
            onClick={() => void loadData()}
            disabled={loading}
          >
            <RefreshCw size={16} />
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <h2>Item directory</h2>

        <p className="muted-text">
          {totalCount} {totalCount === 1 ? "item" : "items"}
        </p>

        {loading ? (
          <p className="empty-state">Loading items…</p>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <h3>{debouncedSearch ? "No matching items" : "No items yet"}</h3>
            <p>
              {debouncedSearch
                ? "Try another search term."
                : "Add your first yarn or fabric item to get started."}
            </p>

            {!debouncedSearch && (
              <button className="primary-button" onClick={openAdd}>
                <Plus size={16} />
                Add first item
              </button>
            )}
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ITEM</th>
                  <th>CODE</th>
                  <th>TYPE</th>
                  <th>UNIT</th>
                  <th>STATUS</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>

              <tbody>
                {items.map((item) => {
                  const unit = units.find(
                    (entry) => entry.id === item.unit_id
                  );

                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name}</strong>
                        {item.notes && (
                          <small className="table-subtext">
                            {item.notes}
                          </small>
                        )}
                      </td>

                      <td>{item.sku}</td>

                      <td>
                        {{
                          yarn: "Yarn",
                          material: "Material",
                          work_in_progress: "Work in progress",
                          finished_good: "Finished good",
                          other: "Other",
                        }[item.item_type] ?? item.item_type}
                      </td>

                      <td>{unit?.code ?? "—"}</td>

                      <td>
                        <span
                          className={
                            item.is_active
                              ? "status-active"
                              : "status-inactive"
                          }
                        >
                          {item.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>

                      <td>
                        <div className="table-actions">
                          <button
                            className="secondary-button"
                            onClick={() => openEdit(item)}
                          >
                            <Pencil size={14} />
                            Edit
                          </button>

                          <button
                            className="secondary-button"
                            onClick={() => void toggleActive(item)}
                            disabled={changingStatus !== null}
                          >
                            <Power size={14} />
                            {changingStatus === item.id
                              ? "Updating…"
                              : item.is_active
                                ? "Deactivate"
                                : "Activate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && totalCount > 0 && (
          <div className="parties-pagination">
            <span className="parties-pagination-info">
              Showing {firstRecord}–{lastRecord} of {totalCount} items
            </span>

            <div className="parties-pagination-controls">
              <button
                type="button"
                aria-label="Previous page"
                onClick={() =>
                  setCurrentPage((page) => Math.max(1, page - 1))
                }
                disabled={currentPage <= 1}
              >
                ‹
              </button>

              <span className="parties-pagination-page">
                {Array.from(
                  { length: totalPages },
                  (_, index) => index + 1
                )
                  .filter(
                    (page) =>
                      page === 1 ||
                      page === totalPages ||
                      Math.abs(page - currentPage) <= 1
                  )
                  .map((page, index, visiblePages) => {
                    const previous = visiblePages[index - 1];

                    return (
                      <span
                        key={page}
                        className="parties-pagination-page"
                      >
                        {previous && page - previous > 1 && (
                          <span className="parties-pagination-ellipsis">
                            …
                          </span>
                        )}

                        <button
                          type="button"
                          className={
                            currentPage === page ? "active" : ""
                          }
                          aria-current={
                            currentPage === page ? "page" : undefined
                          }
                          onClick={() => setCurrentPage(page)}
                        >
                          {page}
                        </button>
                      </span>
                    );
                  })}
              </span>

              <button
                type="button"
                aria-label="Next page"
                onClick={() =>
                  setCurrentPage((page) =>
                    Math.min(totalPages, page + 1)
                  )
                }
                disabled={currentPage >= totalPages}
              >
                ›
              </button>
            </div>
          </div>
        )}
      </section>

      {modalOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="item-modal-title"
          >
            <header className="modal-header">
              <div>
                <h2 id="item-modal-title">
                  {editing ? "Edit item" : "Add item"}
                </h2>
                <p>
                  {editing
                    ? "Update item details."
                    : "Create a yarn, fabric or material record."}
                </p>
              </div>

              <button
                className="icon-button"
                type="button"
                aria-label="Close"
                onClick={closeModal}
              >
                <X size={20} />
              </button>
            </header>

            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="form-field">
                    <label htmlFor="item-code">Item code</label>

                    <div className="code-input-row">
                      <input
                        id="item-code"
                        value={form.sku}
                        onChange={(event) =>
                          setForm({ ...form, sku: event.target.value })
                        }
                        placeholder="Example: ITM-001"
                        maxLength={100}
                        readOnly={settings.mode === "automatic" && !editing}
                        required
                      />

                      <button
                        type="button"
                        className="icon-button code-settings-button"
                        aria-label="Item code settings"
                        title="Item code settings"
                        onClick={() =>
                          setCodeSettingsOpen((current) => !current)
                        }
                      >
                        <Settings2 size={18} />
                      </button>
                    </div>

                    {codeSettingsOpen && (
                      <div className="numbering-popover item-numbering-popover">
                        <div className="numbering-popover-header">
                          <strong>Item code settings</strong>

                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Close code settings"
                            onClick={() => setCodeSettingsOpen(false)}
                          >
                            <X size={16} />
                          </button>
                        </div>

                        <div className="numbering-mode-row">
                          <label
                            className={`numbering-mode-option ${
                              settings.mode === "manual" ? "selected" : ""
                            }`}
                          >
                            <input
                              type="radio"
                              name="item-code-mode"
                              checked={settings.mode === "manual"}
                              onChange={() =>
                                setSettings((current) => ({
                                  ...current,
                                  mode: "manual",
                                }))
                              }
                            />
                            <span>Manual</span>
                            <small>Enter code yourself</small>
                          </label>

                          <label
                            className={`numbering-mode-option ${
                              settings.mode === "automatic" ? "selected" : ""
                            }`}
                          >
                            <input
                              type="radio"
                              name="item-code-mode"
                              checked={settings.mode === "automatic"}
                              onChange={() =>
                                updateAutomaticCode({
                                  ...settings,
                                  mode: "automatic",
                                })
                              }
                            />
                            <span>Automatic</span>
                            <small>Generate a sequence</small>
                          </label>
                        </div>

                        {settings.mode === "automatic" && (
                          <>
                            <div className="form-field">
                              <label htmlFor="item-code-prefix">
                                Prefix
                              </label>
                              <input
                                id="item-code-prefix"
                                value={settings.prefix}
                                maxLength={20}
                                onChange={(event) =>
                                  updateAutomaticCode({
                                    ...settings,
                                    prefix: event.target.value,
                                  })
                                }
                              />
                            </div>

                            <div className="form-field">
                              <label htmlFor="item-code-next">
                                Next number
                              </label>
                              <input
                                id="item-code-next"
                                type="number"
                                min={1}
                                step={1}
                                value={settings.nextNumber}
                                onChange={(event) =>
                                  updateAutomaticCode({
                                    ...settings,
                                    nextNumber: Math.max(
                                      1,
                                      Math.floor(
                                        Number(event.target.value) || 1
                                      )
                                    ),
                                  })
                                }
                              />
                            </div>

                            <div className="form-field">
                              <label htmlFor="item-code-digits">
                                Number of digits
                              </label>
                              <select
                                id="item-code-digits"
                                value={settings.digits}
                                onChange={(event) =>
                                  updateAutomaticCode({
                                    ...settings,
                                    digits: Number(event.target.value),
                                  })
                                }
                              >
                                <option value={2}>2 digits — 01</option>
                                <option value={3}>3 digits — 001</option>
                                <option value={4}>4 digits — 0001</option>
                                <option value={5}>5 digits — 00001</option>
                                <option value={6}>6 digits — 000001</option>
                              </select>
                            </div>

                            <p className="numbering-preview">
                              Preview: <strong>{generatedCode}</strong>
                            </p>
                          </>
                        )}

                        <div className="numbering-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => setCodeSettingsOpen(false)}
                          >
                            Close
                          </button>

                          <button
                            type="button"
                            className="primary-button"
                            onClick={() =>
                              void applyItemNumberingSettings()
                            }
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="form-field">
                    <label htmlFor="item-name">Item name</label>
                    <input
                      id="item-name"
                      value={form.name}
                      onChange={(event) =>
                        setForm({ ...form, name: event.target.value })
                      }
                      placeholder="Example: Cotton Yarn 30s"
                      maxLength={150}
                      required
                    />
                  </div>

                  <div className="form-field">
                    <label htmlFor="item-type">Item type</label>
                    <select
                      id="item-type"
                      value={form.item_type}
                      onChange={(event) =>
                        setForm({ ...form, item_type: event.target.value })
                      }
                    >
                      <option value="yarn">Yarn</option>
                      <option value="material">Material</option>
                      <option value="work_in_progress">
                        Work in progress
                      </option>
                      <option value="finished_good">Finished good</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <div className="form-field">
                    <label htmlFor="item-unit">Unit of measure</label>
                    <select
                      id="item-unit"
                      value={form.unit_id}
                      onChange={(event) =>
                        setForm({ ...form, unit_id: event.target.value })
                      }
                    >
                      <option value="">Select a unit</option>

                      {units.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.name} ({unit.code})
                        </option>
                      ))}
                    </select>

                    {units.length === 0 && (
                      <small className="muted-text">
                        Create units in Masters → Units first.
                      </small>
                    )}
                  </div>

                  <div className="form-field full-width">
                    <label htmlFor="item-notes">Notes (optional)</label>
                    <textarea
                      id="item-notes"
                      rows={3}
                      value={form.notes}
                      onChange={(event) =>
                        setForm({ ...form, notes: event.target.value })
                      }
                      placeholder="Item specifications, count, colour or other notes"
                    />
                  </div>
                </div>

                {error && (
                  <p className="error-message" role="alert">
                    {error}
                  </p>
                )}
              </div>

              <footer className="modal-footer">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeModal}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={saving}
                >
                  {saving
                    ? "Saving…"
                    : editing
                      ? "Save changes"
                      : "Save item"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
