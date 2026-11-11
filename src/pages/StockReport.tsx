
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  RefreshCw,
  Search,
  BarChart3,
  AlertCircle,
  Printer,
} from "lucide-react";

import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";
import Pagination from "../components/Pagination";

type Item = {
  id: string;
  sku: string;
  name: string;
  item_type: string;
  unit_id: string;
};

type Unit = {
  id: string;
  code: string;
  name: string;
  precision_digits: number;
};

type Location = {
  id: string;
  code: string;
  name: string;
};

type Ledger = {
  id: string;
  item_id: string;
  location_id: string | null;
  lot_id: string | null;
  quantity_delta: number | string;
  source_type: string;
  source_id: string;
  occurred_at: string;
};

type ReportRow = {
  itemId: string;
  sku: string;
  itemName: string;
  itemType: string;
  unit: string;
  precisionDigits: number;
  opening: number;
  received: number;
  production: number;
  delivery: number;
  adjustment: number;
  closing: number;
};

type ItemTotals = {
  opening: number;
  received: number;
  production: number;
  delivery: number;
  adjustment: number;
  closing: number;
};

const PAGE_SIZE = 1000;

function fmt(value: number, digits = 3) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: Math.min(6, Math.max(0, digits)),
  }).format(value);
}

// Explicitly display the sign for positive and negative movements.
function fmtSigned(value: number, digits = 3) {
  if (value > 0) return `+${fmt(value, digits)}`;
  if (value < 0) return `-${fmt(Math.abs(value), digits)}`;
  return "0";
}

function csv(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function emptyTotals(): ItemTotals {
  return {
    opening: 0,
    received: 0,
    production: 0,
    delivery: 0,
    adjustment: 0,
    closing: 0,
  };
}

export default function StockReport() {
  const {
    company,
    loading: companyLoading,
    error: companyError,
  } = useCompany();

  const [items, setItems] = useState<Item[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [ledger, setLedger] = useState<Ledger[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [itemType, setItemType] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const DISPLAY_PAGE_SIZE = 10;

  // --------------------------------------------------
  // LOAD REPORT DATA
  // --------------------------------------------------

  const loadReport = useCallback(async () => {
    if (!company?.id) return;

    setLoading(true);
    setError("");

    try {
      const [
        itemsRes,
        unitsRes,
        locationsRes,
      ] = await Promise.all([
        supabase
          .from("items")
          .select("id, sku, name, item_type, unit_id")
          .eq("company_id", company.id)
          .order("name"),

        supabase
          .from("units")
          .select("id, code, name, precision_digits")
          .eq("company_id", company.id)
          .order("name"),

        supabase
          .from("locations")
          .select("id, code, name")
          .eq("company_id", company.id)
          .order("name"),
      ]);

      for (const result of [
        itemsRes,
        unitsRes,
        locationsRes,
      ]) {
        if (result.error) throw result.error;
      }

      // Fetch all ledger pages.
      const allLedger: Ledger[] = [];

      for (let from = 0; ; from += PAGE_SIZE) {
        const {
          data,
          error: ledgerError,
        } = await supabase
          .from("stock_ledger")
          .select(
            "id, item_id, location_id, lot_id, quantity_delta, source_type, source_id, occurred_at"
          )
          .eq("company_id", company.id)
          .order("occurred_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (ledgerError) throw ledgerError;

        const batch = (data ?? []) as Ledger[];

        allLedger.push(...batch);

        if (batch.length < PAGE_SIZE) break;
      }

      setItems((itemsRes.data ?? []) as Item[]);
      setUnits((unitsRes.data ?? []) as Unit[]);
      setLocations((locationsRes.data ?? []) as Location[]);
      setLedger(allLedger);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to load stock report."
      );
    } finally {
      setLoading(false);
    }
  }, [company?.id]);

  useEffect(() => {
    void loadReport();

    const refreshWhenFocused = () => {
      void loadReport();
    };

    window.addEventListener("focus", refreshWhenFocused);

    return () => {
      window.removeEventListener("focus", refreshWhenFocused);
    };
  }, [loadReport]);

  // --------------------------------------------------
  // CALCULATE ONE ROW PER ITEM
  // --------------------------------------------------

  const reportRows = useMemo<ReportRow[]>(() => {
    const itemMap = new Map(
      items.map((item) => [item.id, item])
    );

    const unitMap = new Map(
      units.map((unit) => [unit.id, unit])
    );

    // Aggregate by item only.
    // Location and lot are deliberately not part of the key.
    const totals = new Map<string, ItemTotals>();

    for (const movement of ledger) {
      // Apply the selected location filter before aggregation.
      const movementLocation =
        movement.location_id ?? "__unassigned__";

      if (
        locationFilter !== "all" &&
        movementLocation !== locationFilter
      ) {
        continue;
      }

      const item = itemMap.get(movement.item_id);

      if (!item) continue;

      let bucket = totals.get(movement.item_id);

      if (!bucket) {
        bucket = emptyTotals();
        totals.set(movement.item_id, bucket);
      }

      const delta = Number(movement.quantity_delta);

      if (!Number.isFinite(delta)) continue;

      const date = movement.occurred_at.slice(0, 10);

      // Movements before the selected period become opening stock.
      if (fromDate && date < fromDate) {
        bucket.opening += delta;
        bucket.closing += delta;
        continue;
      }

      // Movements after the selected period are excluded.
      if (toDate && date > toDate) {
        continue;
      }

      // Classify movements by their actual ledger source.
      switch (movement.source_type) {
        case "goods_receipt":
          bucket.received += delta;
          break;

        case "production":
          // Yarn consumption is negative.
          // Fabric production is positive.
          bucket.production += delta;
          break;

        case "delivery":
          // Customer deliveries retain their ledger sign.
          bucket.delivery += delta;
          break;

        case "stock_adjustment":
          bucket.adjustment += delta;
          break;

        default:
          // Keep other movement types visible and preserve
          // reconciliation with the actual stock ledger.
          bucket.adjustment += delta;
          break;
      }

      // Closing includes all movements up to the end date.
      bucket.closing += delta;
    }

    const rows: ReportRow[] = [];

    for (const [itemId, bucket] of totals) {
      const item = itemMap.get(itemId);

      if (!item) continue;

      const unit = unitMap.get(item.unit_id);

      rows.push({
        itemId,
        sku: item.sku,
        itemName: item.name,
        itemType: item.item_type,
        unit: unit?.code ?? "—",
        precisionDigits: unit?.precision_digits ?? 3,

        opening: bucket.opening,
        received: bucket.received,
        production: bucket.production,
        delivery: bucket.delivery,
        adjustment: bucket.adjustment,
        closing: bucket.closing,
      });
    }

    return rows.sort((a, b) =>
      a.itemName.localeCompare(b.itemName)
    );
  }, [
    ledger,
    items,
    units,
    locationFilter,
    fromDate,
    toDate,
  ]);

  // --------------------------------------------------
  // SEARCH AND ITEM TYPE FILTER
  // --------------------------------------------------

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();

    return reportRows.filter((row) => {
      const matchesSearch =
        !q ||
        [
          row.sku,
          row.itemName,
          row.itemType,
        ].some((value) =>
          value.toLowerCase().includes(q)
        );

      const matchesType =
        itemType === "all" ||
        row.itemType === itemType;

      return matchesSearch && matchesType;
    });
  }, [reportRows, search, itemType]);

  // --------------------------------------------------
  // SUMMARY TOTALS
  // --------------------------------------------------

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / DISPLAY_PAGE_SIZE));
  const pageRows = useMemo(
    () => filteredRows.slice((currentPage - 1) * DISPLAY_PAGE_SIZE, currentPage * DISPLAY_PAGE_SIZE),
    [filteredRows, currentPage]
  );
  useEffect(() => { setCurrentPage(1); }, [search, itemType, locationFilter, fromDate, toDate]);
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const summary = useMemo(() => {
    return filteredRows.reduce(
      (total, row) => {
        total.opening += row.opening;
        total.received += row.received;
        total.production += row.production;
        total.delivery += row.delivery;
        total.adjustment += row.adjustment;
        total.closing += row.closing;

        return total;
      },
      emptyTotals()
    );
  }, [filteredRows]);

  // --------------------------------------------------
  // CSV EXPORT
  // --------------------------------------------------

  function exportCsv() {
    const header = [
      "Item",
      "Opening",
      "Received",
      "Production",
      "Delivery",
      "Adjustment",
      "Closing",
    ];

    const rows = filteredRows.map((row) => [
      row.itemName,
      row.opening,
      fmtSigned(row.received, row.precisionDigits),
      fmtSigned(row.production, row.precisionDigits),
      fmtSigned(row.delivery, row.precisionDigits),
      fmtSigned(row.adjustment, row.precisionDigits),
      row.closing,
    ]);

    const content = [
      header,
      ...rows,
    ]
      .map((row) => row.map(csv).join(","))
      .join("\r\n");

    const blob = new Blob(
      ["\uFEFF", content],
      { type: "text/csv;charset=utf-8;" }
    );

    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `stock-report-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;

    anchor.click();

    URL.revokeObjectURL(url);
  }

  const itemTypes = [
    ...new Set(items.map((item) => item.item_type)),
  ].sort();

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <main className="stock-report-page report-print-root">
      <header className="page-header">
        <div className="page-heading">
          <h1>Stock Report</h1>
        </div>

        <div className="page-actions no-print">
          <button
            type="button"
            className="button button-outline"
            onClick={() => void loadReport()}
            disabled={
              loading ||
              companyLoading ||
              !company
            }
          >
            <RefreshCw
              size={16}
              className={loading ? "spin" : ""}
            />
            Refresh
          </button>

          <button
            type="button"
            className="button button-outline"
            onClick={() => window.print()}
          >
            <Printer size={16} />
            Print / PDF
          </button>

          <button
            type="button"
            className="button button-primary"
            onClick={exportCsv}
            disabled={!filteredRows.length}
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </header>

      {companyError && (
        <div className="sr-alert">
          <AlertCircle size={16} />
          {companyError}
        </div>
      )}

      {error && (
        <div className="sr-alert">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* DATE FILTERS */}

      <section className="sr-date-panel panel no-print">
        <label>
          From date
          <input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>

        <label>
          To date
          <input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>

        <button
          type="button"
          className="button button-outline"
          onClick={() => {
            setFromDate("");
            setToDate("");
          }}
        >
          All dates
        </button>
      </section>

      {/* SUMMARY CARDS */}

      <section className="sr-summary">
        <article>
          <span>Opening</span>
          <strong>
            {loading ? "…" : fmt(summary.opening)}
          </strong>
        </article>

        <article>
          <span>Received</span>
          <strong className="sr-positive">
            {loading ? "…" : fmtSigned(summary.received)}
          </strong>
        </article>

        <article>
          <span>Production</span>
          <strong className="sr-production">
            {loading ? "…" : fmtSigned(summary.production)}
          </strong>
        </article>

        <article>
          <span>Delivery</span>
          <strong className="sr-negative">
            {loading ? "…" : fmtSigned(summary.delivery)}
          </strong>
        </article>

        <article>
          <span>Adjustment</span>
          <strong>
            {loading ? "…" : fmtSigned(summary.adjustment)}
          </strong>
        </article>

        <article>
          <span>Closing</span>
          <strong>
            {loading ? "…" : fmt(summary.closing)}
          </strong>
        </article>
      </section>

      {/* STOCK REGISTER */}

      <section className="panel sr-register">
        <div className="sr-filters no-print">
          <label className="sr-search">
            <Search size={17} />

            <input
              placeholder="Search SKU or item"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>

          <select
            value={itemType}
            onChange={(e) => setItemType(e.target.value)}
            aria-label="Filter item type"
          >
            <option value="all">All item types</option>

            {itemTypes.map((type) => (
              <option key={type} value={type}>
                {type.replaceAll("_", " ")}
              </option>
            ))}
          </select>

          <select
            value={locationFilter}
            onChange={(e) =>
              setLocationFilter(e.target.value)
            }
            aria-label="Filter location"
          >
            <option value="all">All locations</option>

            <option value="__unassigned__">
              Unassigned Location
            </option>

            {locations.map((location) => (
              <option
                key={location.id}
                value={location.id}
              >
                {location.name}
              </option>
            ))}
          </select>
        </div>

        <div className="sr-table-heading">
          <div>
            <h2>Stock summary</h2>

            <p>
              {loading
                ? "Loading stock report…"
                : `${filteredRows.length} item balances`}
            </p>
          </div>

          <span>
            <BarChart3 size={15} />
            Source: posted stock ledger
          </span>
        </div>

        <div className="sr-table-wrap">
          <table className="sr-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Opening</th>
                <th className="num">Received</th>
                <th className="num">Production</th>
                <th className="num">Delivery</th>
                <th className="num">Adjustment</th>
                <th className="num">Closing</th>
              </tr>
            </thead>

            <tbody>
              {!loading &&
                pageRows.map((row) => {
                  const digits = row.precisionDigits;

                  return (
                    <tr key={row.itemId}>
                      <td>
                        <div className="sr-item">
                          <strong>{row.itemName}</strong>
                          <small>
                            {row.sku} · {row.itemType.replaceAll("_", " ")}
                          </small>
                        </div>
                      </td>

                      <td className="num">
                        {fmt(row.opening, digits)}
                      </td>

                      <td className="num sr-positive">
                        {fmtSigned(row.received, digits)}
                      </td>

                      <td className="num sr-production">
                        {fmtSigned(row.production, digits)}
                      </td>

                      <td className="num sr-negative">
                        {fmtSigned(row.delivery, digits)}
                      </td>

                      <td className="num">
                        {fmtSigned(row.adjustment, digits)}
                      </td>

                      <td className="num sr-closing">
                        {fmt(row.closing, digits)}
                      </td>
                    </tr>
                  );
                })}

              {!loading &&
                !error &&
                filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="sr-empty">
                      <BarChart3 size={25} />
                      <strong>No stock report rows</strong>
                      <span>
                        Post stock movements or adjust the
                        filters to see quantities.
                      </span>
                    </td>
                  </tr>
                )}

              {loading && (
                <tr>
                  <td colSpan={7} className="sr-empty">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          totalItems={filteredRows.length}
          currentPage={currentPage}
          pageSize={DISPLAY_PAGE_SIZE}
          onPageChange={setCurrentPage}
          loading={loading}
          itemLabel="items"
        />
      </section>

      {/* STYLES */}

      <style>{`
        .stock-report-page {
          color: var(--text-primary, #172033);
        }

        .sr-date-panel {
          display: flex;
          gap: 14px;
          align-items: end;
          flex-wrap: wrap;
          padding: 16px 20px;
          margin: 18px 0;
        }

        .sr-date-panel label {
          display: flex;
          flex-direction: column;
          gap: 6px;
          color: #64748b;
          font-size: 12px;
          font-weight: 600;
        }

        .sr-date-panel input {
          min-height: 39px;
          border: 1px solid #dfe3e8;
          border-radius: 8px;
          padding: 0 10px;
          color: #334155;
          background: white;
        }

        .sr-summary {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 13px;
          margin: 18px 0;
        }

        .sr-summary article {
          display: flex;
          flex-direction: column;
          gap: 5px;
          padding: 16px 18px;
          border: 1px solid #dfe3e8;
          border-radius: 11px;
          background: #fff;
        }

        .sr-summary span {
          color: #64748b;
          font-size: 12px;
        }

        .sr-summary strong {
          font-size: 24px;
          line-height: 1.25;
          font-variant-numeric: tabular-nums;
        }

        .sr-positive {
          color: #047857 !important;
        }

        .sr-negative {
          color: #b91c1c !important;
        }

        .sr-production {
          color: #2563eb !important;
        }

        .sr-register {
          padding: 22px 24px;
        }

        .sr-filters {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 22px;
        }

        .sr-search {
          display: flex;
          align-items: center;
          gap: 9px;
          height: 41px;
          border: 1px solid #dfe3e8;
          border-radius: 8px;
          padding: 0 12px;
          flex: 1 1 280px;
          color: #8190a5;
        }

        .sr-search input {
          width: 100%;
          min-width: 0;
          border: 0;
          outline: 0;
          font: inherit;
          background: transparent;
        }

        .sr-filters select {
          height: 41px;
          border: 1px solid #dfe3e8;
          border-radius: 8px;
          padding: 0 10px;
          background: #fff;
          color: #334155;
        }

        .sr-table-heading {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 14px;
        }

        .sr-table-heading h2 {
          margin: 0 0 5px;
          font-size: 17px;
        }

        .sr-table-heading p {
          margin: 0;
          color: #8490a3;
          font-size: 13px;
        }

        .sr-table-heading > span {
          display: flex;
          align-items: center;
          gap: 7px;
          color: #64748b;
          font-size: 12px;
        }

        .sr-table-wrap {
          overflow-x: auto;
          border: 1px solid #dfe3e8;
          border-radius: 9px;
        }

        .sr-table {
          width: 100%;
          min-width: 760px;
          border-collapse: collapse;
          font-size: 12px;
        }

        .sr-table th {
          text-align: left;
          padding: 13px 14px;
          background: #f7f9fc;
          color: #66758b;
          text-transform: uppercase;
          letter-spacing: .03em;
          font-size: 10px;
          white-space: nowrap;
        }

        .sr-table td {
          padding: 14px;
          border-top: 1px solid #edf0f4;
          color: #475569;
          white-space: nowrap;
        }

        .sr-table tbody tr:hover {
          background: #fafcff;
        }

        .sr-table .num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .sr-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .sr-item strong {
          color: #172033;
          font-size: 13px;
        }

        .sr-item small {
          color: #8490a3;
          font-size: 11px;
          text-transform: uppercase;
        }

        .sr-closing {
          color: #172033 !important;
          font-weight: 700;
        }

        .sr-empty {
          text-align: center !important;
          padding: 40px 20px !important;
          white-space: normal !important;
          color: #8490a3 !important;
        }

        .sr-empty svg {
          display: block;
          margin: 0 auto 10px;
        }

        .sr-empty strong,
        .sr-empty span {
          display: block;
        }

        .sr-empty strong {
          color: #334155;
          margin-bottom: 5px;
        }

        .sr-empty span {
          max-width: 420px;
          margin: auto;
          line-height: 1.5;
        }

        .sr-alert {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 14px;
          margin: 12px 0;
          border-radius: 8px;
          background: #fff1f2;
          border: 1px solid #fecdd3;
          color: #9f1239;
          font-size: 13px;
        }

        @media(max-width: 950px) {
          .sr-summary {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media(max-width: 600px) {
          .sr-summary {
            grid-template-columns: 1fr;
          }

          .sr-register {
            padding: 15px;
          }

          .sr-table-heading {
            align-items: flex-start;
            flex-direction: column;
          }
        }

        @media print {
          .stock-report-page .no-print {
            display: none !important;
          }

          .sr-summary {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .sr-register {
            padding: 0 !important;
            border: 0 !important;
            box-shadow: none !important;
          }

          .sr-table-wrap {
            overflow: visible !important;
          }

          .sr-table {
            min-width: 0 !important;
            width: 100% !important;
            font-size: 9pt !important;
          }

          .sr-table th,
          .sr-table td {
            padding: 7px 8px !important;
          }
        }
      `}</style>
    </main>
  );
}
