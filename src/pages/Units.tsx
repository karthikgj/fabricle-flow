
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import {
  Plus,
  Search,
  RefreshCw,
  Pencil,
  X,
  Ruler,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";

type Unit = {
  id: string;
  company_id: string;
  code: string;
  name: string;
  precision_digits: number;
  created_at: string;
};

type UnitForm = {
  code: string;
  name: string;
  precision_digits: number;
};

const emptyForm: UnitForm = {
  code: "",
  name: "",
  precision_digits: 3,
};

const PAGE_SIZE = 10;

export default function Units() {
  const { company } = useCompany();

  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [form, setForm] = useState<UnitForm>(emptyForm);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const loadUnits = useCallback(async () => {
    if (!company?.id) {
      setUnits([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const from = (currentPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from("units")
        .select(
          "id, company_id, code, name, precision_digits, created_at",
          { count: "exact" }
        )
        .eq("company_id", company.id);

      const term = search.trim();

      if (term) {
        const safeTerm = term.replace(/[,%()]/g, " ").trim();

        if (safeTerm) {
          query = query.or(
            `name.ilike.%${safeTerm}%,code.ilike.%${safeTerm}%`
          );
        }
      }

      const { data, error: fetchError, count } = await query
        .order("name")
        .range(from, to);

      if (fetchError) throw fetchError;

      setUnits((data ?? []) as Unit[]);
      setTotalCount(count ?? 0);
    } catch (err) {
      setUnits([]);
      setTotalCount(0);
      setError(
        err instanceof Error
          ? `Unable to load units: ${err.message}`
          : "Unable to load units."
      );
    } finally {
      setLoading(false);
    }
  }, [company?.id, currentPage, search]);

  useEffect(() => {
    void loadUnits();
  }, [loadUnits]);

  // If the current page becomes invalid after searching,
  // return to the first page.
  useEffect(() => {
    if (!loading && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages, loading]);

  function handleSearch(value: string) {
    setSearch(value);
    setCurrentPage(1);
  }

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setNotice("");
    setModalOpen(true);
  }

  function openEdit(unit: Unit) {
    setEditing(unit);
    setForm({
      code: unit.code,
      name: unit.name,
      precision_digits: unit.precision_digits,
    });
    setError("");
    setNotice("");
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setError("");
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!company?.id) {
      setError("Your organisation is not available. Please try again.");
      return;
    }

    const code = form.code.trim().toUpperCase();
    const name = form.name.trim();
    const precision = Number(form.precision_digits);

    if (!code || !name) {
      setError("Enter both a unit code and unit name.");
      return;
    }

    if (!Number.isInteger(precision) || precision < 0 || precision > 6) {
      setError("Decimal precision must be between 0 and 6.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      if (editing) {
        const { error: updateError } = await supabase
          .from("units")
          .update({
            code,
            name,
            precision_digits: precision,
          })
          .eq("id", editing.id)
          .eq("company_id", company.id);

        if (updateError) throw updateError;

        setNotice("Unit updated successfully.");
      } else {
        const { error: insertError } = await supabase
          .from("units")
          .insert({
            company_id: company.id,
            code,
            name,
            precision_digits: precision,
          });

        if (insertError) throw insertError;

        setNotice("Unit created successfully.");
        setCurrentPage(1);
      }

      setModalOpen(false);

      // Reload only the current page.
      await loadUnits();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save unit. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  const startRecord =
    totalCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;

  const endRecord = Math.min(currentPage * PAGE_SIZE, totalCount);

  return (
    <main className="page-content">
      <header className="page-heading">
        <div>
          <h1>Units</h1>
        </div>

        <button className="primary-button" onClick={openAdd}>
          <Plus size={17} />
          Add unit
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
              aria-label="Search units"
              placeholder="Search unit name or code..."
              value={search}
              onChange={(event) => handleSearch(event.target.value)}
            />
          </div>

          <button
            className="secondary-button"
            onClick={() => void loadUnits()}
            disabled={loading}
          >
            <RefreshCw size={16} />
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <h2>Unit directory</h2>

        <p className="muted-text">
          {totalCount} {totalCount === 1 ? "unit" : "units"}
        </p>

        {loading ? (
          <p className="empty-state">Loading units...</p>
        ) : units.length === 0 ? (
          <div className="empty-state">
            <Ruler size={28} color="#8490a2" />

            <h3>{search ? "No matching units" : "No units yet"}</h3>

            <p>
              {search
                ? "Try a different name or unit code."
                : "Create units such as KG, G, M or PCS before adding items."}
            </p>

            {!search && (
              <button className="primary-button" onClick={openAdd}>
                <Plus size={16} />
                Add first unit
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>UNIT NAME</th>
                    <th>CODE</th>
                    <th>DECIMAL PRECISION</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>

                <tbody>
                  {units.map((unit) => (
                    <tr key={unit.id}>
                      <td>
                        <strong>{unit.name}</strong>
                      </td>

                      <td>
                        <span className="unit-code">{unit.code}</span>
                      </td>

                      <td>
                        {unit.precision_digits}{" "}
                        {unit.precision_digits === 1
                          ? "decimal place"
                          : "decimal places"}
                      </td>

                      <td>
                        <div className="table-actions">
                          <button
                            className="secondary-button"
                            onClick={() => openEdit(unit)}
                          >
                            <Pencil size={14} />
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div
              className="units-pagination"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                marginTop: "22px",
                paddingTop: "18px",
                borderTop: "1px solid #e5e7eb",
              }}
            >
              <span className="muted-text">
                Showing {startRecord}–{endRecord} of {totalCount} records
              </span>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <button
                  type="button"
                  className="secondary-button"
                  aria-label="Previous page"
                  title="Previous page"
                  disabled={currentPage <= 1 || loading}
                  onClick={() =>
                    setCurrentPage((page) => Math.max(1, page - 1))
                  }
                  style={{
                    minWidth: "38px",
                    justifyContent: "center",
                    padding: "8px",
                  }}
                >
                  <ChevronLeft size={17} />
                </button>

                {Array.from(
                  { length: totalPages },
                  (_, index) => index + 1
                ).map((page) => (
                  <button
                    key={page}
                    type="button"
                    className={
                      currentPage === page
                        ? "primary-button"
                        : "secondary-button"
                    }
                    aria-label={`Page ${page}`}
                    aria-current={
                      currentPage === page ? "page" : undefined
                    }
                    disabled={loading}
                    onClick={() => setCurrentPage(page)}
                    style={{
                      minWidth: "38px",
                      justifyContent: "center",
                      padding: "8px 12px",
                    }}
                  >
                    {page}
                  </button>
                ))}

                <button
                  type="button"
                  className="secondary-button"
                  aria-label="Next page"
                  title="Next page"
                  disabled={currentPage >= totalPages || loading}
                  onClick={() =>
                    setCurrentPage((page) =>
                      Math.min(totalPages, page + 1)
                    )
                  }
                  style={{
                    minWidth: "38px",
                    justifyContent: "center",
                    padding: "8px",
                  }}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>
          </>
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
            className="modal-card unit-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unit-modal-title"
          >
            <header className="modal-header">
              <div>
                <h2 id="unit-modal-title">
                  {editing ? "Edit unit" : "Add unit"}
                </h2>
                <p>
                  {editing
                    ? "Update the unit details."
                    : "Create a unit of measurement for your organisation."}
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
                    <label htmlFor="unit-name">Unit name *</label>
                    <input
                      id="unit-name"
                      value={form.name}
                      onChange={(event) =>
                        setForm({ ...form, name: event.target.value })
                      }
                      placeholder="Example: Kilogram"
                      maxLength={100}
                      required
                    />
                  </div>

                  <div className="form-field">
                    <label htmlFor="unit-code">Unit code *</label>
                    <input
                      id="unit-code"
                      value={form.code}
                      onChange={(event) =>
                        setForm({ ...form, code: event.target.value })
                      }
                      placeholder="Example: KG"
                      maxLength={30}
                      required
                    />
                    <small className="muted-text">
                      Short code displayed in inventory records.
                    </small>
                  </div>

                  <div className="form-field full-width">
                    <label htmlFor="unit-precision">
                      Decimal precision *
                    </label>

                    <select
                      id="unit-precision"
                      value={form.precision_digits}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          precision_digits: Number(event.target.value),
                        })
                      }
                    >
                      <option value={0}>0 — Whole numbers (5)</option>
                      <option value={1}>1 — Tenths (5.1)</option>
                      <option value={2}>2 — Hundredths (5.12)</option>
                      <option value={3}>3 — Thousandths (5.123)</option>
                      <option value={4}>4 decimal places</option>
                      <option value={5}>5 decimal places</option>
                      <option value={6}>6 decimal places</option>
                    </select>

                    <small className="muted-text">
                      Choose how many decimal places quantities should display.
                    </small>
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
                    ? "Saving..."
                    : editing
                      ? "Save changes"
                      : "Save unit"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
