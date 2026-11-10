
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
  X,
  Layers,
  Trash2,
  PackagePlus,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";

type BOM = {
  id: string;
  company_id: string;
  code: string;
  name: string;
  output_item_id: string;
  output_quantity: number;
  is_active: boolean;
  created_at: string;
};

type ComponentRow = {
  id: string;
  bom_id: string;
  item_id: string;
  composition_percent: number;
};

type Item = {
  id: string;
  sku: string;
  name: string;
  item_type: string;
};

type Unit = {
  id: string;
  code: string;
  name: string;
};

type FormComponent = {
  item_id: string;
  composition_percent: string;
};

type BOMForm = {
  code: string;
  name: string;
  output_item_id: string;
  output_quantity: string;
  is_active: boolean;
  components: FormComponent[];
};

const PAGE_SIZE = 10;

const emptyForm: BOMForm = {
  code: "",
  name: "",
  output_item_id: "",
  output_quantity: "1",
  is_active: true,
  components: [{ item_id: "", composition_percent: "" }],
};

const itemLabel = (item: Item) => `${item.sku} — ${item.name}`;

const formatPercent = (value: number) =>
  `${Number(value.toFixed(2))}%`;

export default function BOMs() {
  const { company, loading: companyLoading } = useCompany();

  const [boms, setBoms] = useState<BOM[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);

  const [showQuickAddItem, setShowQuickAddItem] = useState(false);
  const [quickItemSaving, setQuickItemSaving] = useState(false);
  const [quickItemError, setQuickItemError] = useState("");

  const [quickItemForm, setQuickItemForm] = useState({
    sku: "",
    name: "",
    unit_id: "",
    notes: "",
  });

  const [componentsByBom, setComponentsByBom] = useState<
    Record<string, ComponentRow[]>
  >({});

  const [loading, setLoading] = useState(true);
  const [referenceLoading, setReferenceLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BOMForm>(emptyForm);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Debounce search input.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setCurrentPage(1);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [search]);

  // Load items and units separately.
  // These are reference data and do not need to reload on every page change.
  const loadReferenceData = useCallback(async () => {
    if (!company?.id) {
      setItems([]);
      setUnits([]);
      setReferenceLoading(false);
      return;
    }

    setReferenceLoading(true);

    try {
      const [itemResult, unitResult] = await Promise.all([
        supabase
          .from("items")
          .select("id, sku, name, item_type")
          .eq("company_id", company.id)
          .eq("is_active", true)
          .order("name"),

        supabase
          .from("units")
          .select("id, code, name")
          .eq("company_id", company.id)
          .order("name"),
      ]);

      if (itemResult.error) throw itemResult.error;
      if (unitResult.error) throw unitResult.error;

      setItems((itemResult.data ?? []) as Item[]);
      setUnits((unitResult.data ?? []) as Unit[]);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Unable to load reference data: ${err.message}`
          : "Unable to load items and units."
      );
    } finally {
      setReferenceLoading(false);
    }
  }, [company?.id]);

  useEffect(() => {
    if (companyLoading) return;

    void loadReferenceData();
  }, [companyLoading, loadReferenceData]);

  const itemMap = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items]
  );

  // Load only the current page of BOMs and their components.
  const loadBoms = useCallback(
    async (page: number = currentPage) => {
      if (!company?.id) {
        setBoms([]);
        setComponentsByBom({});
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
          .from("boms")
          .select(
            "id, company_id, code, name, output_item_id, output_quantity, is_active, created_at",
            { count: "exact" }
          )
          .eq("company_id", company.id);

        if (debouncedSearch) {
          const term = debouncedSearch
            .replace(/[,%()]/g, " ")
            .trim();

          if (term) {
            // Find items matching the search term.
            // These can be output items or BOM component items.
            const { data: matchingItems, error: itemSearchError } =
              await supabase
                .from("items")
                .select("id")
                .eq("company_id", company.id)
                .or(`sku.ilike.%${term}%,name.ilike.%${term}%`);

            if (itemSearchError) throw itemSearchError;

            const matchingItemIds = (matchingItems ?? []).map(
              (item) => item.id
            );

            let matchingComponentBomIds: string[] = [];

            if (matchingItemIds.length > 0) {
              // Find BOMs containing any matching component item.
              const { data: matchingComponents, error: componentSearchError } =
                await supabase
                  .from("bom_components")
                  .select("bom_id")
                  .eq("company_id", company.id)
                  .in("item_id", matchingItemIds);

              if (componentSearchError) throw componentSearchError;

              matchingComponentBomIds = [
                ...new Set(
                  (matchingComponents ?? []).map(
                    (component) => component.bom_id
                  )
                ),
              ];
            }

            const searchConditions = [
              `code.ilike.%${term}%`,
              `name.ilike.%${term}%`,
            ];

            if (matchingItemIds.length > 0) {
              searchConditions.push(
                `output_item_id.in.(${matchingItemIds.join(",")})`
              );
            }

            if (matchingComponentBomIds.length > 0) {
              searchConditions.push(
                `id.in.(${matchingComponentBomIds.join(",")})`
              );
            }

            query = query.or(searchConditions.join(","));
          }
        }

        const { data, count, error: bomError } = await query
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to);

        if (bomError) throw bomError;

        const pageBoms = (data ?? []) as BOM[];
        setBoms(pageBoms);
        setTotalCount(count ?? 0);

        // Fetch components only for the BOMs on this page.
        if (pageBoms.length > 0) {
          const pageBomIds = pageBoms.map((bom) => bom.id);

          const { data: componentData, error: componentError } =
            await supabase
              .from("bom_components")
              .select("id, bom_id, item_id, composition_percent")
              .eq("company_id", company.id)
              .in("bom_id", pageBomIds);

          if (componentError) throw componentError;

          const grouped: Record<string, ComponentRow[]> = {};

          for (const row of (componentData ?? []) as ComponentRow[]) {
            if (!grouped[row.bom_id]) {
              grouped[row.bom_id] = [];
            }

            grouped[row.bom_id].push(row);
          }

          setComponentsByBom(grouped);
        } else {
          setComponentsByBom({});
        }
      } catch (err) {
        setBoms([]);
        setComponentsByBom({});
        setTotalCount(0);

        setError(
          err instanceof Error
            ? `Unable to load BOMs: ${err.message}`
            : "Unable to load BOM data."
        );
      } finally {
        setLoading(false);
      }
    },
    [company?.id, currentPage, debouncedSearch]
  );

  useEffect(() => {
    if (companyLoading) return;

    void loadBoms();
  }, [companyLoading, loadBoms]);

  // Move to the last valid page if the result count decreases.
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const outputItems = items.filter(
    (item) =>
      item.item_type === "finished_good" ||
      item.item_type === "work_in_progress"
  );

  const componentItems = items.filter(
    (item) =>
      item.item_type === "yarn" ||
      item.item_type === "material" ||
      item.item_type === "other"
  );

  const compositionTotal = useMemo(
    () =>
      Math.round(
        form.components.reduce(
          (sum, component) =>
            sum + (Number(component.composition_percent) || 0),
          0
        ) * 100
      ) / 100,
    [form.components]
  );

  const totalIsValid = Math.abs(compositionTotal - 100) < 0.000001;

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setNotice("");
    setModalOpen(true);
  };

  const openEdit = (bom: BOM) => {
    const existing = componentsByBom[bom.id] ?? [];

    setEditingId(bom.id);

    setForm({
      code: bom.code,
      name: bom.name,
      output_item_id: bom.output_item_id,
      output_quantity: String(bom.output_quantity),
      is_active: bom.is_active,
      components: existing.length
        ? existing.map((component) => ({
            item_id: component.item_id,
            composition_percent: String(component.composition_percent),
          }))
        : [{ item_id: "", composition_percent: "" }],
    });

    setError("");
    setNotice("");
    setModalOpen(true);
  };

  const updateComponent = (
    index: number,
    field: keyof FormComponent,
    value: string
  ) => {
    setForm((current) => ({
      ...current,
      components: current.components.map((component, i) =>
        i === index ? { ...component, [field]: value } : component
      ),
    }));

    setError("");
  };

  const addComponent = () => {
    setForm((current) => ({
      ...current,
      components: [
        ...current.components,
        { item_id: "", composition_percent: "" },
      ],
    }));

    setError("");
  };

  const removeComponent = (index: number) => {
    setForm((current) => ({
      ...current,
      components: current.components.filter((_, i) => i !== index),
    }));

    setError("");
  };

  const startQuickAddItem = () => {
    setQuickItemError("");
    setQuickItemForm({ sku: "", name: "", unit_id: "", notes: "" });
    setShowQuickAddItem(true);
  };

  const saveQuickItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!company?.id) return;

    const name = quickItemForm.name.trim();

    if (!name) {
      setQuickItemError("Enter an item name.");
      return;
    }

    setQuickItemSaving(true);
    setQuickItemError("");

    try {
      let sku = quickItemForm.sku.trim();

      // Use the company's configured item sequence when automatic numbering is enabled.
      const { data: sequence, error: sequenceError } = await supabase
        .from("document_sequences")
        .select("mode")
        .eq("company_id", company.id)
        .eq("document_type", "item")
        .maybeSingle();

      if (sequenceError) throw sequenceError;

      if (sequence?.mode === "automatic") {
        const { data: generatedCode, error: codeError } =
          await supabase.rpc("next_document_code", {
            p_company_id: company.id,
            p_document_type: "item",
          });

        if (codeError) throw codeError;

        if (typeof generatedCode !== "string" || !generatedCode) {
          throw new Error("The database did not return an item code.");
        }

        sku = generatedCode;
      }

      if (!sku) {
        setQuickItemError("Enter an item code.");
        setQuickItemSaving(false);
        return;
      }

      const { data: createdItem, error: insertError } = await supabase
        .from("items")
        .insert({
          company_id: company.id,
          sku,
          name,
          item_type: "finished_good",
          unit_id: quickItemForm.unit_id || null,
          notes: quickItemForm.notes.trim() || null,
          is_active: true,
        })
        .select("id, sku, name, item_type")
        .single();

      if (insertError) throw insertError;

      const newItem = createdItem as Item;

      setItems((current) =>
        [...current, newItem].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      );

      setForm((current) => ({
        ...current,
        output_item_id: newItem.id,
      }));

      setShowQuickAddItem(false);
      setNotice(`Finished-good item ${newItem.sku} created and selected.`);
    } catch (err) {
      setQuickItemError(
        err instanceof Error ? err.message : "Unable to create item."
      );
    } finally {
      setQuickItemSaving(false);
    }
  };

  const saveBOM = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!company?.id) return;

    setError("");
    setNotice("");

    const code = form.code.trim();
    const name = form.name.trim();
    const outputQuantity = Number(form.output_quantity);

    if (!code || !name || !form.output_item_id) {
      setError("Enter the BOM code, name, and output item.");
      return;
    }

    if (!Number.isFinite(outputQuantity) || outputQuantity <= 0) {
      setError("Output quantity must be greater than zero.");
      return;
    }

    if (form.components.length === 0) {
      setError("Add at least one yarn component.");
      return;
    }

    const payload: {
      item_id: string;
      composition_percent: number;
    }[] = [];

    for (const component of form.components) {
      if (!component.item_id) {
        setError("Select an item for every component.");
        return;
      }

      if (component.composition_percent.trim() === "") {
        setError("Enter a composition percentage for every component.");
        return;
      }

      const percent = Number(component.composition_percent);

      if (
        !Number.isFinite(percent) ||
        percent <= 0 ||
        percent > 100 ||
        !Number.isInteger(percent * 100)
      ) {
        setError(
          "Each percentage must be greater than 0, at most 100, and have no more than two decimal places."
        );
        return;
      }

      if (component.item_id === form.output_item_id) {
        setError("The output item cannot also be a yarn component.");
        return;
      }

      payload.push({
        item_id: component.item_id,
        composition_percent: percent,
      });
    }

    if (
      new Set(payload.map((component) => component.item_id)).size !==
      payload.length
    ) {
      setError("Each component item can only be added once.");
      return;
    }

    const exactTotal =
      Math.round(
        payload.reduce(
          (sum, component) => sum + component.composition_percent,
          0
        ) * 100
      ) / 100;

    if (Math.abs(exactTotal - 100) >= 0.000001) {
      setError(
        `Composition must total exactly 100%. Current total: ${formatPercent(exactTotal)}.`
      );
      return;
    }

    setSaving(true);

    try {
      const { error: saveError } = await supabase.rpc(
        "save_bom_with_components",
        {
          p_company_id: company.id,
          p_bom_id: editingId,
          p_code: code,
          p_name: name,
          p_output_item_id: form.output_item_id,
          p_output_quantity: outputQuantity,
          p_is_active: form.is_active,
          p_components: payload,
        }
      );

      if (saveError) throw saveError;

      setModalOpen(false);

      setNotice(
        editingId
          ? "BOM updated successfully."
          : "BOM created successfully."
      );

      if (editingId) {
        await loadBoms(currentPage);
      } else {
        setCurrentPage(1);
        await loadBoms(1);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to save BOM."
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (bom: BOM) => {
    if (!company?.id) return;

    setError("");
    setNotice("");

    const { error: updateError } = await supabase
      .from("boms")
      .update({ is_active: !bom.is_active })
      .eq("id", bom.id)
      .eq("company_id", company.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setNotice(
      `BOM ${bom.code} ${bom.is_active ? "deactivated" : "activated"}.`
    );

    await loadBoms(currentPage);
  };

  function goToPage(page: number) {
    if (page < 1 || page > totalPages || page === currentPage) return;
    setCurrentPage(page);
  }

  const firstRecord =
    totalCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;

  const lastRecord = Math.min(currentPage * PAGE_SIZE, totalCount);

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <h1>Bill of Materials</h1>
        </div>

        <button
          className="primary-button"
          onClick={openCreate}
          disabled={!company?.id}
        >
          <Plus size={16} />
          Add BOM
        </button>
      </div>

      {error && !modalOpen && (
        <div className="form-message form-message-error">
          {error}
        </div>
      )}

      {notice && (
        <div className="form-message form-message-success">
          {notice}
        </div>
      )}

      <div className="content-panel">
        <div className="toolbar">
          <div className="search-field">
            <Search size={16} />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search BOMs, products, or yarn..."
            />
          </div>

          <button
            className="secondary-button"
            onClick={() => void loadBoms(currentPage)}
            disabled={loading}
          >
            <RefreshCw size={15} />
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <p className="muted-text">
          {totalCount} {totalCount === 1 ? "BOM" : "BOMs"}
          {debouncedSearch ? " found" : " in total"}
        </p>

        {loading || referenceLoading ? (
          <div className="empty-state">Loading BOMs...</div>
        ) : boms.length === 0 ? (
          <div className="empty-state">
            <Layers size={30} />

            <strong>
              {debouncedSearch
                ? "No matching BOMs"
                : "No BOMs created yet"}
            </strong>

            <span>
              {debouncedSearch
                ? "Try a different search."
                : "Create a composition recipe for a fabric product."}
            </span>
          </div>
        ) : (
          <>
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>BOM Code</th>
                    <th>Name</th>
                    <th>Output Item</th>
                    <th>Components</th>
                    <th>Composition</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {boms.map((bom) => {
                    const output = itemMap.get(bom.output_item_id);
                    const components = componentsByBom[bom.id] ?? [];

                    const total = Math.round(
                      components.reduce(
                        (sum, component) =>
                          sum + Number(component.composition_percent),
                        0
                      ) * 100
                    ) / 100;

                    const bomTotalIsValid =
                      Math.abs(total - 100) < 0.000001;

                    return (
                      <tr key={bom.id}>
                        <td>
                          <strong>{bom.code}</strong>
                        </td>

                        <td>{bom.name}</td>

                        <td>
                          {output ? (
                            <>
                              <strong>{output.name}</strong>
                              <small className="table-subtext">
                                {output.sku}
                              </small>
                            </>
                          ) : (
                            "Unknown item"
                          )}
                        </td>

                        <td>{components.length} item(s)</td>

                        <td>
                          <strong>{formatPercent(total)}</strong>
                          <small className="table-subtext">
                            {bomTotalIsValid
                              ? "100% recipe"
                              : "Needs review"}
                          </small>
                        </td>

                        <td>
                          <span
                            className={`status-pill ${
                              bom.is_active
                                ? "status-active"
                                : "status-inactive"
                            }`}
                          >
                            {bom.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>

                        <td>
                          <div className="table-actions">
                            <button
                              className="icon-button"
                              title="Edit BOM"
                              onClick={() => openEdit(bom)}
                            >
                              <Pencil size={15} />
                            </button>

                            <button
                              className="secondary-button"
                              onClick={() => void toggleActive(bom)}
                            >
                              {bom.is_active
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
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </>
        )}
      </div>

      {modalOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) {
              setModalOpen(false);
            }
          }}
        >
          <div className="modal-card bom-modal-card bom-modal-compact">
            <div className="modal-header">
              <div>
                <h2>{editingId ? "Edit BOM" : "Create BOM"}</h2>
                <p>Define output and yarn composition.</p>
              </div>

              <button
                className="icon-button"
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={saving}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={saveBOM}>
              <div className="modal-body">
                {error && (
                  <div className="form-message form-message-error">
                    {error}
                  </div>
                )}

                <div className="form-grid">
                  <label className="form-field">
                    <span>BOM Code *</span>
                    <input
                      value={form.code}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          code: event.target.value,
                        }))
                      }
                      placeholder="e.g. BOM-001"
                      required
                    />
                  </label>

                  <label className="form-field">
                    <span>BOM Name *</span>
                    <input
                      value={form.name}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="e.g. Cotton Polyester Fabric"
                      required
                    />
                  </label>

                  <label className="form-field">
                    <span>Output Item *</span>
                    <select
                      value={form.output_item_id}
                      onChange={(event) => {
                        if (event.target.value === "__add_item__") {
                          startQuickAddItem();
                          return;
                        }

                        setForm((current) => ({
                          ...current,
                          output_item_id: event.target.value,
                        }));
                      }}
                      required
                    >
                      <option value="">Select output item</option>

                      {outputItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {itemLabel(item)}
                        </option>
                      ))}

                      <option value="__add_item__">
                        ＋ Add item…
                      </option>
                    </select>
                  </label>

                  <label className="form-field">
                    <span>Reference Quantity</span>
                    <input
                      type="number"
                      min="0.000001"
                      step="any"
                      value={form.output_quantity}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          output_quantity: event.target.value,
                        }))
                      }
                      required
                    />
                    <small>Recipe reference quantity.</small>
                  </label>
                </div>

                <div className="bom-components-heading">
                  <div>
                    <h3>Yarn Composition</h3>
                    <p>Percentages must total 100%.</p>
                  </div>

                  <button
                    className="secondary-button"
                    type="button"
                    onClick={addComponent}
                  >
                    <Plus size={15} />
                    Add yarn
                  </button>
                </div>

                <div className="bom-composition-summary">
                  <div className="bom-composition-summary-top">
                    <span>Total composition</span>
                    <strong
                      className={
                        totalIsValid
                          ? "bom-total-valid"
                          : "bom-total-invalid"
                      }
                    >
                      {formatPercent(compositionTotal)} / 100%
                    </strong>
                  </div>

                  <div
                    className="bom-progress-track"
                    role="progressbar"
                    aria-label="Yarn composition total"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.min(compositionTotal, 100)}
                  >
                    <div
                      className={`bom-progress-fill ${
                        totalIsValid ? "bom-progress-complete" : ""
                      }`}
                      style={{
                        width: `${Math.min(
                          Math.max(compositionTotal, 0),
                          100
                        )}%`,
                      }}
                    />
                  </div>

                  <p>
                    {totalIsValid
                      ? "Composition complete"
                      : compositionTotal < 100
                        ? `${formatPercent(100 - compositionTotal)} remaining`
                        : `${formatPercent(compositionTotal - 100)} over 100%`}
                  </p>
                </div>

                {form.components.map((component, index) => (
                  <div className="bom-component-row" key={index}>
                    <label className="form-field bom-item-field">
                      <span>Yarn *</span>
                      <select
                        value={component.item_id}
                        onChange={(event) =>
                          updateComponent(
                            index,
                            "item_id",
                            event.target.value
                          )
                        }
                        required
                      >
                        <option value="">Select yarn</option>

                        {componentItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {itemLabel(item)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="form-field bom-percent-field">
                      <span>Composition % *</span>
                      <input
                        type="number"
                        min="0.01"
                        max="100"
                        step="0.01"
                        value={component.composition_percent}
                        onChange={(event) =>
                          updateComponent(
                            index,
                            "composition_percent",
                            event.target.value
                          )
                        }
                        placeholder="e.g. 60"
                        required
                      />
                    </label>

                    <button
                      className="icon-button bom-remove-component"
                      type="button"
                      title="Remove yarn"
                      aria-label={`Remove yarn component ${index + 1}`}
                      onClick={() => removeComponent(index)}
                      disabled={form.components.length === 1}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}

                <label className="bom-active-toggle">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        is_active: event.target.checked,
                      }))
                    }
                  />
                  <span>
                    BOM is active and available for production
                  </span>
                </label>
              </div>

              <div className="modal-footer">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  className="primary-button"
                  type="submit"
                  disabled={saving || !totalIsValid}
                  title={
                    !totalIsValid
                      ? "Yarn composition must total 100%"
                      : undefined
                  }
                >
                  {saving
                    ? "Saving..."
                    : editingId
                      ? "Save Changes"
                      : "Create BOM"}
                </button>
              </div>
            </form>
          </div>

          {showQuickAddItem && (
            <div
              className="bom-quick-item-backdrop"
              onMouseDown={(event) => {
                if (
                  event.target === event.currentTarget &&
                  !quickItemSaving
                ) {
                  setShowQuickAddItem(false);
                }
              }}
            >
              <section
                className="bom-quick-item-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="bom-quick-item-title"
              >
                <header className="bom-quick-item-header">
                  <div>
                    <h3 id="bom-quick-item-title">
                      Add finished-good item
                    </h3>
                    <p>Created as a finished good for this BOM.</p>
                  </div>

                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Close add item"
                    disabled={quickItemSaving}
                    onClick={() => setShowQuickAddItem(false)}
                  >
                    <X size={17} />
                  </button>
                </header>

                <form onSubmit={saveQuickItem}>
                  <div className="bom-quick-item-body">
                    {quickItemError && (
                      <div className="form-message form-message-error">
                        {quickItemError}
                      </div>
                    )}

                    <label className="form-field">
                      <span>Item name *</span>
                      <input
                        autoFocus
                        maxLength={150}
                        value={quickItemForm.name}
                        onChange={(event) =>
                          setQuickItemForm((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        placeholder="e.g. Greige Fabric"
                        required
                      />
                    </label>

                    <label className="form-field">
                      <span>Item code</span>
                      <input
                        value={quickItemForm.sku}
                        onChange={(event) =>
                          setQuickItemForm((current) => ({
                            ...current,
                            sku: event.target.value,
                          }))
                        }
                        placeholder="Generated automatically when enabled"
                        maxLength={100}
                      />
                    </label>

                    <label className="form-field">
                      <span>Unit of measure</span>
                      <select
                        value={quickItemForm.unit_id}
                        onChange={(event) =>
                          setQuickItemForm((current) => ({
                            ...current,
                            unit_id: event.target.value,
                          }))
                        }
                      >
                        <option value="">Select unit</option>

                        {units.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.name} ({unit.code})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="form-field">
                      <span>Notes</span>
                      <textarea
                        rows={2}
                        value={quickItemForm.notes}
                        onChange={(event) =>
                          setQuickItemForm((current) => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                        placeholder="Optional specifications"
                      />
                    </label>

                    <div className="bom-quick-item-type">
                      <PackagePlus size={16} />
                      Item type: <strong>Finished good</strong>
                    </div>
                  </div>

                  <footer className="bom-quick-item-footer">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setShowQuickAddItem(false)}
                      disabled={quickItemSaving}
                    >
                      Cancel
                    </button>

                    <button
                      type="submit"
                      className="primary-button"
                      disabled={quickItemSaving}
                    >
                      {quickItemSaving ? "Saving…" : "Create item"}
                    </button>
                  </footer>
                </form>
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
