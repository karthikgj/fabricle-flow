
import { formatDate } from "../lib/dateUtils";

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
  Layers,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";

type Lot = {
  id: string;
  company_id: string;
  item_id: string;
  lot_code: string;
  supplier_lot_code: string | null;
  received_at: string | null;
  notes: string | null;
  created_at: string;
};

type Item = {
  id: string;
  sku: string;
  name: string;
  item_type: string;
};

type LotForm = {
  item_id: string;
  lot_code: string;
  supplier_lot_code: string;
  received_at: string;
  notes: string;
};

const PAGE_SIZE = 10;

const emptyForm: LotForm = {
  item_id: "",
  lot_code: "",
  supplier_lot_code: "",
  received_at: "",
  notes: "",
};

function dateForInput(value: string | null) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function displayDate(value: string | null) {
  return formatDate(value);
}

export default function Lots() {
  const { company } = useCompany();

  const [lots, setLots] = useState<Lot[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Lot | null>(null);
  const [form, setForm] = useState<LotForm>(emptyForm);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Debounce search to avoid a database request on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setCurrentPage(1);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [search]);

  // Load item options separately.
  // This prevents the item dropdown data from being fetched on every page change.
  const loadItems = useCallback(async () => {
    if (!company?.id) {
      setItems([]);
      setItemsLoading(false);
      return;
    }

    setItemsLoading(true);

    try {
      const { data, error: fetchError } = await supabase
        .from("items")
        .select("id, sku, name, item_type")
        .eq("company_id", company.id)
        .order("name", { ascending: true });

      if (fetchError) throw fetchError;

      setItems((data ?? []) as Item[]);
    } catch (err) {
      setItems([]);

      setError(
        err instanceof Error
          ? `Unable to load items: ${err.message}`
          : "Unable to load items."
      );
    } finally {
      setItemsLoading(false);
    }
  }, [company?.id]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  // Load only the requested page of lots.
  const loadLots = useCallback(
    async (page: number = currentPage) => {
      if (!company?.id) {
        setLots([]);
        setTotalCount(0);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const from = (page - 1) * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        let query = supabase
          .from("lots")
          .select(
            "id, company_id, item_id, lot_code, supplier_lot_code, received_at, notes, created_at",
            { count: "exact" }
          )
          .eq("company_id", company.id);

        if (debouncedSearch) {
          // Remove characters that could interfere with PostgREST filter syntax.
          const term = debouncedSearch
            .replace(/[,%()]/g, " ")
            .trim();

          if (term) {
            // Search linked item names and SKUs first.
            const { data: matchingItems, error: itemSearchError } =
              await supabase
                .from("items")
                .select("id")
                .eq("company_id", company.id)
                .or(
                  `name.ilike.%${term}%,sku.ilike.%${term}%`
                );

            if (itemSearchError) throw itemSearchError;

            const matchingItemIds = (matchingItems ?? []).map(
              (item) => item.id
            );

            // Search lot fields directly in the database.
            const searchConditions = [
              `lot_code.ilike.%${term}%`,
              `supplier_lot_code.ilike.%${term}%`,
              `notes.ilike.%${term}%`,
            ];

            // Include lots belonging to matching items.
            if (matchingItemIds.length > 0) {
              searchConditions.push(
                `item_id.in.(${matchingItemIds.join(",")})`
              );
            }

            query = query.or(searchConditions.join(","));
          }
        }

        const { data, count, error: fetchError } = await query
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to);

        if (fetchError) throw fetchError;

        setLots((data ?? []) as Lot[]);
        setTotalCount(count ?? 0);
      } catch (err) {
        setLots([]);
        setTotalCount(0);

        setError(
          err instanceof Error
            ? `Unable to load lots: ${err.message}`
            : "Unable to load lots."
        );
      } finally {
        setLoading(false);
      }
    },
    [company?.id, currentPage, debouncedSearch]
  );

  useEffect(() => {
    void loadLots();
  }, [loadLots]);

  // Correct the current page if the number of available records decreases.
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

  function openEdit(lot: Lot) {
    setEditing(lot);

    setForm({
      item_id: lot.item_id,
      lot_code: lot.lot_code,
      supplier_lot_code: lot.supplier_lot_code ?? "",
      received_at: dateForInput(lot.received_at),
      notes: lot.notes ?? "",
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

    const lotCode = form.lot_code.trim();
    const item = items.find((entry) => entry.id === form.item_id);

    if (!item) {
      setError("Select a valid item.");
      return;
    }

    if (!lotCode) {
      setError("Enter an internal lot code.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    const payload = {
      item_id: item.id,
      lot_code: lotCode,
      supplier_lot_code: form.supplier_lot_code.trim() || null,
      received_at: form.received_at
        ? new Date(`${form.received_at}T12:00:00`).toISOString()
        : null,
      notes: form.notes.trim() || null,
    };

    try {
      if (editing) {
        const { error: updateError } = await supabase
          .from("lots")
          .update(payload)
          .eq("id", editing.id)
          .eq("company_id", company.id);

        if (updateError) throw updateError;

        setNotice("Lot updated successfully.");
        setModalOpen(false);

        await loadLots(currentPage);
      } else {
        const { error: insertError } = await supabase
          .from("lots")
          .insert({
            ...payload,
            company_id: company.id,
          });

        if (insertError) throw insertError;

        setNotice("Lot created successfully.");
        setModalOpen(false);

        setCurrentPage(1);
        await loadLots(1);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save lot. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  function goToPage(page: number) {
    if (page < 1 || page > totalPages || page === currentPage) return;
    setCurrentPage(page);
  }

  const firstRecord =
    totalCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;

  const lastRecord = Math.min(
    currentPage * PAGE_SIZE,
    totalCount
  );

  return (
    <main className="page-content">
      <header className="page-heading">
        <div>
          <h1>Lots</h1>
        </div>

        <button
          className="primary-button"
          onClick={openAdd}
          disabled={itemsLoading || items.length === 0}
          title={items.length === 0 ? "Create an item first" : undefined}
        >
          <Plus size={17} />
          Add lot
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
              aria-label="Search lots"
              placeholder="Search lot, item or supplier batch..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <button
            className="secondary-button"
            onClick={() => void loadLots(currentPage)}
            disabled={loading}
          >
            <RefreshCw size={16} />
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <h2>Lot directory</h2>

        <p className="muted-text">
          {totalCount} {totalCount === 1 ? "lot" : "lots"}
          {debouncedSearch ? " found" : " in total"}
        </p>

        {loading || itemsLoading ? (
          <p className="empty-state">Loading lots...</p>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <Layers size={28} color="#8490a2" />

            <h3>Create an item first</h3>

            <p>
              Add yarn or fabric in Masters → Items before creating a lot.
            </p>
          </div>
        ) : lots.length === 0 ? (
          <div className="empty-state">
            <Layers size={28} color="#8490a2" />

            <h3>
              {debouncedSearch ? "No matching lots" : "No lots yet"}
            </h3>

            <p>
              {debouncedSearch
                ? "Try a different search term."
                : "Create a lot to identify a particular material batch."}
            </p>

            {!debouncedSearch && (
              <button className="primary-button" onClick={openAdd}>
                <Plus size={16} />
                Add first lot
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>LOT CODE</th>
                    <th>ITEM</th>
                    <th>SUPPLIER LOT</th>
                    <th>RECEIVED DATE</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>

                <tbody>
                  {lots.map((lot) => {
                    const item = items.find(
                      (entry) => entry.id === lot.item_id
                    );

                    return (
                      <tr key={lot.id}>
                        <td>
                          <strong>{lot.lot_code}</strong>
                        </td>

                        <td>
                          <strong>
                            {item?.name ?? "Unknown item"}
                          </strong>

                          {item?.sku && (
                            <small className="table-subtext">
                              {item.sku}
                            </small>
                          )}
                        </td>

                        <td>{lot.supplier_lot_code || "—"}</td>

                        <td>{displayDate(lot.received_at)}</td>

                        <td>
                          <div className="table-actions">
                            <button
                              className="secondary-button"
                              onClick={() => openEdit(lot)}
                            >
                              <Pencil size={14} />
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: "8px",
                marginTop: "20px",
                flexWrap: "wrap",
              }}
            >
              <span
                className="muted-text"
                style={{ marginRight: "8px" }}
              >
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
                .reduce<(number | "dots")[]>(
                  (pages, page, index, array) => {
                    if (
                      index > 0 &&
                      page - array[index - 1] > 1
                    ) {
                      pages.push("dots");
                    }

                    pages.push(page);
                    return pages;
                  },
                  []
                )
                .map((page, index) =>
                  page === "dots" ? (
                    <span
                      key={`dots-${index}`}
                      className="muted-text"
                    >
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
            aria-labelledby="lot-modal-title"
          >
            <header className="modal-header">
              <div>
                <h2 id="lot-modal-title">
                  {editing ? "Edit lot" : "Add lot"}
                </h2>

                <p>
                  {editing
                    ? "Update batch identification details."
                    : "Create a batch record linked to an item."}
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
                  <div className="form-field full-width">
                    <label htmlFor="lot-item">Item *</label>

                    <select
                      id="lot-item"
                      value={form.item_id}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          item_id: event.target.value,
                        })
                      }
                      required
                    >
                      <option value="">Select an item</option>

                      {items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.sku} — {item.name} (
                          {item.item_type.replaceAll("_", " ")})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-field">
                    <label htmlFor="lot-code">
                      Internal lot code *
                    </label>

                    <input
                      id="lot-code"
                      value={form.lot_code}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          lot_code: event.target.value,
                        })
                      }
                      placeholder="Example: LOT-001"
                      maxLength={100}
                      required
                    />
                  </div>

                  <div className="form-field">
                    <label htmlFor="supplier-lot-code">
                      Supplier lot code
                    </label>

                    <input
                      id="supplier-lot-code"
                      value={form.supplier_lot_code}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          supplier_lot_code: event.target.value,
                        })
                      }
                      placeholder="Supplier's batch reference"
                      maxLength={100}
                    />
                  </div>

                  <div className="form-field full-width">
                    <label htmlFor="lot-received-date">
                      Received date
                    </label>

                    <input
                      id="lot-received-date"
                      type="date"
                      value={form.received_at}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          received_at: event.target.value,
                        })
                      }
                    />
                  </div>

                  <div className="form-field full-width">
                    <label htmlFor="lot-notes">
                      Notes (optional)
                    </label>

                    <textarea
                      id="lot-notes"
                      rows={3}
                      value={form.notes}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          notes: event.target.value,
                        })
                      }
                      placeholder="Batch details, colour, yarn count or other notes"
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
                    ? "Saving..."
                    : editing
                      ? "Save changes"
                      : "Save lot"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
