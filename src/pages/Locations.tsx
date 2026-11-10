
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
  Power,
  X,
  MapPin,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";

type Location = {
  id: string;
  company_id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

type LocationForm = {
  code: string;
  name: string;
};

const PAGE_SIZE = 10;

const emptyForm: LocationForm = {
  code: "",
  name: "",
};

export default function Locations() {
  const { company } = useCompany();

  const [locations, setLocations] = useState<Location[]>([]);
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
  const [editing, setEditing] = useState<Location | null>(null);
  const [form, setForm] = useState<LocationForm>(emptyForm);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Debounce search so we don't send a request for every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setCurrentPage(1);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [search]);

  const loadLocations = useCallback(async () => {
    if (!company?.id) {
      setLocations([]);
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
        .from("locations")
        .select(
          "id, company_id, code, name, is_active, created_at",
          { count: "exact" }
        )
        .eq("company_id", company.id);

      if (debouncedSearch) {
        const term = debouncedSearch.replace(/[,%()]/g, " ").trim();

        if (term) {
          query = query.or(
            `name.ilike.%${term}%,code.ilike.%${term}%`
          );
        }
      }

      const { data, count, error: fetchError } = await query
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);

      if (fetchError) throw fetchError;

      setLocations((data ?? []) as Location[]);
      setTotalCount(count ?? 0);
    } catch (err) {
      setLocations([]);
      setTotalCount(0);

      setError(
        err instanceof Error
          ? `Unable to load locations: ${err.message}`
          : "Unable to load locations."
      );
    } finally {
      setLoading(false);
    }
  }, [company?.id, currentPage, debouncedSearch]);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  // If records are removed and the current page becomes invalid,
  // move back to the last available page.
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setNotice("");
    setModalOpen(true);
  }

  function openEdit(location: Location) {
    setEditing(location);
    setForm({
      code: location.code,
      name: location.name,
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

    if (!code || !name) {
      setError("Enter both a location code and location name.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      if (editing) {
        const { error: updateError } = await supabase
          .from("locations")
          .update({ code, name })
          .eq("id", editing.id)
          .eq("company_id", company.id);

        if (updateError) throw updateError;

        setNotice("Location updated successfully.");
      } else {
        const { error: insertError } = await supabase
          .from("locations")
          .insert({
            company_id: company.id,
            code,
            name,
            is_active: true,
          });

        if (insertError) throw insertError;

        setNotice("Location created successfully.");
        setCurrentPage(1);
      }

      setModalOpen(false);
      await loadLocations();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save location. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(location: Location) {
    if (!company?.id || changingStatus) return;

    const action = location.is_active ? "deactivate" : "activate";

    if (!window.confirm(`${action} "${location.name}"?`)) return;

    setError("");
    setNotice("");
    setChangingStatus(location.id);

    try {
      const { error: updateError } = await supabase
        .from("locations")
        .update({ is_active: !location.is_active })
        .eq("id", location.id)
        .eq("company_id", company.id);

      if (updateError) throw updateError;

      setNotice(`Location ${action}d successfully.`);
      await loadLocations();
    } catch (err) {
      setError(
        err instanceof Error
          ? `Unable to ${action} location: ${err.message}`
          : `Unable to ${action} location.`
      );
    } finally {
      setChangingStatus(null);
    }
  }

  function goToPage(page: number) {
    if (page < 1 || page > totalPages || page === currentPage) return;
    setCurrentPage(page);
  }

  const firstRecord =
    totalCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;

  const lastRecord = Math.min(currentPage * PAGE_SIZE, totalCount);

  return (
    <main className="page-content">
      <header className="page-heading">
        <div>
          <h1>Locations</h1>
        </div>

        <button className="primary-button" onClick={openAdd}>
          <Plus size={17} />
          Add location
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
              aria-label="Search locations"
              placeholder="Search location name or code..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <button
            className="secondary-button"
            onClick={() => void loadLocations()}
            disabled={loading}
          >
            <RefreshCw size={16} />
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <h2>Location directory</h2>

        <p className="muted-text">
          {totalCount}{" "}
          {totalCount === 1 ? "location" : "locations"}
          {debouncedSearch ? " found" : " in total"}
        </p>

        {loading ? (
          <p className="empty-state">Loading locations...</p>
        ) : locations.length === 0 ? (
          <div className="empty-state">
            <MapPin size={28} color="#8490a2" />

            <h3>
              {debouncedSearch
                ? "No matching locations"
                : "No locations yet"}
            </h3>

            <p>
              {debouncedSearch
                ? "Try a different location name or code."
                : "Add a warehouse or storage location to get started."}
            </p>

            {!debouncedSearch && (
              <button className="primary-button" onClick={openAdd}>
                <Plus size={16} />
                Add first location
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>LOCATION NAME</th>
                    <th>CODE</th>
                    <th>STATUS</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>

                <tbody>
                  {locations.map((location) => (
                    <tr key={location.id}>
                      <td>
                        <strong>{location.name}</strong>
                      </td>

                      <td>
                        <span className="unit-code">
                          {location.code}
                        </span>
                      </td>

                      <td>
                        <span
                          className={
                            location.is_active
                              ? "status-active"
                              : "status-inactive"
                          }
                        >
                          {location.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>

                      <td>
                        <div className="table-actions">
                          <button
                            className="secondary-button"
                            onClick={() => openEdit(location)}
                          >
                            <Pencil size={14} />
                            Edit
                          </button>

                          <button
                            className="secondary-button"
                            onClick={() => void toggleActive(location)}
                            disabled={changingStatus !== null}
                          >
                            <Power size={14} />
                            {changingStatus === location.id
                              ? "Updating..."
                              : location.is_active
                                ? "Deactivate"
                                : "Activate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div
              className="locations-pagination"
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: "8px",
                marginTop: "20px",
                flexWrap: "wrap",
              }}
            >
              <span className="muted-text" style={{ marginRight: "8px" }}>
                Showing {firstRecord}-{lastRecord} of {totalCount}
              </span>

              <button
                type="button"
                className="secondary-button"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1 || loading}
                aria-label="Previous page"
                title="Previous page"
              >
                <ChevronLeft size={16} />
              </button>

              {Array.from({ length: totalPages }, (_, index) => index + 1)
                .filter(
                  (page) =>
                    page === 1 ||
                    page === totalPages ||
                    Math.abs(page - currentPage) <= 1
                )
                .reduce<(number | "dots")[]>((pages, page, index, array) => {
                  if (index > 0 && page - array[index - 1] > 1) {
                    pages.push("dots");
                  }

                  pages.push(page);
                  return pages;
                }, [])
                .map((page, index) =>
                  page === "dots" ? (
                    <span key={`dots-${index}`} className="muted-text">
                      ...
                    </span>
                  ) : (
                    <button
                      key={page}
                      type="button"
                      className={
                        currentPage === page
                          ? "primary-button"
                          : "secondary-button"
                      }
                      onClick={() => goToPage(page)}
                      disabled={loading}
                      aria-label={`Page ${page}`}
                      aria-current={
                        currentPage === page ? "page" : undefined
                      }
                      style={{
                        minWidth: "36px",
                        justifyContent: "center",
                      }}
                    >
                      {page}
                    </button>
                  )
                )}

              <button
                type="button"
                className="secondary-button"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === totalPages || loading}
                aria-label="Next page"
                title="Next page"
              >
                <ChevronRight size={16} />
              </button>
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
            aria-labelledby="location-modal-title"
          >
            <header className="modal-header">
              <div>
                <h2 id="location-modal-title">
                  {editing ? "Edit location" : "Add location"}
                </h2>

                <p>
                  {editing
                    ? "Update location details."
                    : "Create a warehouse or storage location."}
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
                    <label htmlFor="location-name">
                      Location name *
                    </label>

                    <input
                      id="location-name"
                      value={form.name}
                      onChange={(event) =>
                        setForm({ ...form, name: event.target.value })
                      }
                      placeholder="Example: Main Warehouse"
                      maxLength={150}
                      required
                    />
                  </div>

                  <div className="form-field">
                    <label htmlFor="location-code">
                      Location code *
                    </label>

                    <input
                      id="location-code"
                      value={form.code}
                      onChange={(event) =>
                        setForm({ ...form, code: event.target.value })
                      }
                      placeholder="Example: WH-01"
                      maxLength={30}
                      required
                    />

                    <small className="muted-text">
                      A short, unique identifier for this location.
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
                      : "Save location"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
