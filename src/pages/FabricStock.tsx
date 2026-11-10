import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Search, Boxes, AlertCircle, Printer } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";
import Pagination from "../components/Pagination";
import "./Reports.css";

type Item = { id: string; sku: string; name: string; item_type: string; unit_id: string };
type Unit = { id: string; code: string; name: string; precision_digits: number };
type Location = { id: string; code: string; name: string };
type Lot = { id: string; lot_code: string; supplier_lot_code: string | null };
type LedgerRow = {
  id: string;
  item_id: string;
  location_id: string;
  lot_id: string | null;
  quantity_delta: number | string;
  occurred_at: string;
};
type StockRow = {
  key: string;
  itemId: string;
  sku: string;
  itemName: string;
  itemType: string;
  unit: string;
  locationId: string;
  location: string;
  lotId: string | null;
  lot: string;
  quantity: number;
};

const PAGE_SIZE = 1000;

function numberText(value: number, digits = 3) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: Math.max(0, Math.min(6, digits)),
  }).format(value);
}

function escapeCsv(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export default function FabricStock() {
  const { company, loading: companyLoading, error: companyError } = useCompany();
  const [items, setItems] = useState<Item[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const DISPLAY_PAGE_SIZE = 10;
  const [units, setUnits] = useState<Unit[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [itemType, setItemType] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [showZero, setShowZero] = useState(false);

  const loadStock = useCallback(async () => {
    if (!company?.id) return;
    setLoading(true);
    setError("");

    try {
      const [itemsResult, unitsResult, locationsResult, lotsResult] = await Promise.all([
        supabase.from("items").select("id, sku, name, item_type, unit_id")
          .eq("company_id", company.id).order("name"),
        supabase.from("units").select("id, code, name, precision_digits")
          .eq("company_id", company.id).order("name"),
        supabase.from("locations").select("id, code, name")
          .eq("company_id", company.id).order("name"),
        supabase.from("lots").select("id, lot_code, supplier_lot_code")
          .eq("company_id", company.id).order("lot_code"),
      ]);

      if (itemsResult.error) throw itemsResult.error;
      if (unitsResult.error) throw unitsResult.error;
      if (locationsResult.error) throw locationsResult.error;
      if (lotsResult.error) throw lotsResult.error;

      // Page through the full ledger so the Supabase 1,000-row default does not
      // silently produce incorrect balances for companies with more movements.
      const allLedger: LedgerRow[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error: ledgerError } = await supabase
          .from("stock_ledger")
          .select("id, item_id, location_id, lot_id, quantity_delta, occurred_at")
          .eq("company_id", company.id)
          .order("occurred_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (ledgerError) throw ledgerError;
        const batch = (data ?? []) as LedgerRow[];
        allLedger.push(...batch);
        if (batch.length < PAGE_SIZE) break;
      }

      setItems(((itemsResult.data ?? []) as Item[]).filter((item) => ["fabric", "finished_good", "finished goods"].includes(item.item_type.toLowerCase())));
      setUnits((unitsResult.data ?? []) as Unit[]);
      setLocations((locationsResult.data ?? []) as Location[]);
      setLots((lotsResult.data ?? []) as Lot[]);
      setLedger(allLedger);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load stock data.");
    } finally {
      setLoading(false);
    }
  }, [company?.id]);

  useEffect(() => {
    void loadStock();
  }, [loadStock]);

  const stockRows = useMemo<StockRow[]>(() => {
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const unitMap = new Map(units.map((unit) => [unit.id, unit]));
    const locationMap = new Map(locations.map((location) => [location.id, location]));
    const lotMap = new Map(lots.map((lot) => [lot.id, lot]));
    const balances = new Map<string, number>();

    for (const movement of ledger) {
      const key = `${movement.item_id}|${movement.location_id}|${movement.lot_id ?? "no-lot"}`;
      balances.set(key, (balances.get(key) ?? 0) + Number(movement.quantity_delta));
    }

    const rows: StockRow[] = [];
    for (const [key, quantity] of balances) {
      const [itemId, locationId, lotKey] = key.split("|");
      const item = itemMap.get(itemId);
      const location = locationMap.get(locationId);
      const lotId = lotKey === "no-lot" ? null : lotKey;
      const lot = lotId ? lotMap.get(lotId) : undefined;
      if (!item) continue;
      const unit = unitMap.get(item.unit_id);

      rows.push({
        key,
        itemId,
        sku: item.sku,
        itemName: item.name,
        itemType: item.item_type,
        unit: unit ? `${unit.code}` : "—",
        locationId,
        location: location?.name ?? "No location",
        lotId,
        lot: lot?.lot_code ?? (lotId ? "Lot unavailable" : "—"),
        quantity,
      });
    }

    return rows.sort((a, b) =>
      a.itemName.localeCompare(b.itemName) ||
      a.location.localeCompare(b.location) ||
      a.lot.localeCompare(b.lot)
    );
  }, [items, units, locations, lots, ledger]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return stockRows.filter((row) => {
      const matchesSearch = !query ||
        [row.sku, row.itemName, row.itemType, row.location, row.lot, row.unit]
          .some((value) => value.toLowerCase().includes(query));
      const matchesType = itemType === "all" || row.itemType === itemType;
      const matchesLocation = locationFilter === "all" || row.locationId === locationFilter;
      const matchesZero = showZero || Math.abs(row.quantity) > 0.0000005;
      return matchesSearch && matchesType && matchesLocation && matchesZero;
    });
  }, [stockRows, search, itemType, locationFilter, showZero]);

  const pageRows = filteredRows.slice((currentPage - 1) * DISPLAY_PAGE_SIZE, currentPage * DISPLAY_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / DISPLAY_PAGE_SIZE));
  useEffect(() => { setCurrentPage(1); }, [search]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);

  const totalSkuCount = useMemo(
    () => new Set(filteredRows.map((row) => row.itemId)).size,
    [filteredRows]
  );
  const negativeCount = filteredRows.filter((row) => row.quantity < -0.0000005).length;

  function exportCsv() {
    const headers = ["SKU", "Item", "Type", "Location", "Lot", "Quantity", "Unit"];
    const body = filteredRows.map((row) => [
      row.sku, row.itemName, row.itemType, row.location, row.lot,
      numberText(row.quantity, 6), row.unit,
    ]);
    const csv = [headers, ...body].map((line) => line.map(escapeCsv).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fabric-stock-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const itemTypes = [...new Set(items.map((item) => item.item_type))].sort();

  return (
    <div className="stock-page report-print-root">
      <header className="page-header">
        <div className="page-heading">
          <h1>Fabric Stock</h1>
          
        </div>
        <div className="page-actions">
          <button type="button" className="button button-outline" onClick={() => void loadStock()} disabled={loading || companyLoading || !company}>
            <RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh
          </button>
          <button type="button" className="button button-outline no-print" onClick={() => window.print()}><Printer size={16} /> Print / PDF</button>
          <button type="button" className="button button-primary" onClick={exportCsv} disabled={!filteredRows.length}>
            <Download size={16} /> Export CSV
          </button>
        </div>
      </header>

      {companyError && <div className="stock-alert error"><AlertCircle size={17} />{companyError}</div>}
      {error && <div className="stock-alert error"><AlertCircle size={17} />{error}</div>}

      <div className="stock-summary-grid">
        <section className="stock-summary-card">
          <span>Items in stock view</span>
          <strong>{loading ? "…" : totalSkuCount}</strong>
          <small>Distinct items matching filters</small>
        </section>
        <section className="stock-summary-card">
          <span>Stock balances</span>
          <strong>{loading ? "…" : filteredRows.length}</strong>
          <small>Item + location + lot combinations</small>
        </section>
        <section className={`stock-summary-card ${negativeCount ? "warning" : ""}`}>
          <span>Negative balances</span>
          <strong>{loading ? "…" : negativeCount}</strong>
          <small>Require reconciliation</small>
        </section>
      </div>

      <section className="panel stock-register">
        <div className="stock-filters">
          <label className="stock-search">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search SKU, item, lot or location"
              aria-label="Search stock"
            />
          </label>
          <select value={itemType} onChange={(event) => setItemType(event.target.value)} aria-label="Filter by item type">
            <option value="all">All item types</option>
            {itemTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
          </select>
          <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} aria-label="Filter by location">
            <option value="all">All locations</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
          <label className="stock-zero-toggle">
            <input type="checkbox" checked={showZero} onChange={(event) => setShowZero(event.target.checked)} />
            Show zero balances
          </label>
        </div>

        <div className="stock-table-heading">
          <div>
            <h2>Stock register</h2>
            <p>{loading ? "Loading stock movements…" : `${filteredRows.length} stock balances`}</p>
          </div>
          <span className="stock-source-note"><Boxes size={15} /> Source: stock ledger</span>
        </div>

        <div className="stock-table-wrap">
          <table className="stock-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Item</th>
                <th>Type</th>
                <th>Location</th>
                <th>Lot</th>
                <th className="numeric">On hand</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {!loading && pageRows.map((row) => {
                const unitRow = units.find((unit) => unit.code === row.unit);
                const digits = unitRow?.precision_digits ?? 3;
                return (
                  <tr key={row.key}>
                    <td className="stock-code">{row.sku}</td>
                    <td className="stock-item-name">{row.itemName}</td>
                    <td><span className="stock-type">{row.itemType.replaceAll("_", " ")}</span></td>
                    <td>{row.location}</td>
                    <td>{row.lot}</td>
                    <td className={`numeric stock-quantity ${row.quantity < -0.0000005 ? "negative" : ""}`}>
                      {numberText(row.quantity, digits)}
                    </td>
                    <td>{row.unit}</td>
                  </tr>
                );
              })}
              {!loading && !error && filteredRows.length === 0 && (
                <tr><td colSpan={7} className="stock-empty">
                  <Boxes size={24} />
                  <strong>No stock balances found</strong>
                  <span>Post a GRN or record a stock movement to see balances here. Draft receipts do not increase stock.</span>
                </td></tr>
              )}
              {loading && <tr><td colSpan={7} className="stock-empty">Loading current stock…</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination totalItems={filteredRows.length} currentPage={currentPage} pageSize={DISPLAY_PAGE_SIZE} onPageChange={setCurrentPage} loading={loading} itemLabel="items" />
      </section>

      <style>{`
        .stock-page { color: var(--text-primary, #172033); }
        .stock-summary-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin:20px 0; }
        .stock-summary-card { background:#fff; border:1px solid var(--border-color,#dfe3e8); border-radius:12px; padding:17px 19px; display:flex; flex-direction:column; gap:5px; }
        .stock-summary-card span { color:#64748b; font-size:13px; }
        .stock-summary-card strong { font-size:27px; line-height:1.2; font-weight:700; }
        .stock-summary-card small { color:#8490a3; font-size:12px; }
        .stock-summary-card.warning strong { color:#b45309; }
        .stock-register { padding:22px 24px; }
        .stock-filters { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:24px; }
        .stock-search { display:flex; align-items:center; gap:9px; border:1px solid var(--border-color,#dfe3e8); border-radius:8px; padding:0 12px; height:42px; flex:1 1 280px; color:#8190a5; }
        .stock-search input { border:0; outline:0; width:100%; min-width:0; color:inherit; background:transparent; font:inherit; }
        .stock-filters select { height:42px; border:1px solid var(--border-color,#dfe3e8); border-radius:8px; background:#fff; padding:0 12px; color:#334155; }
        .stock-zero-toggle { display:flex; align-items:center; gap:7px; font-size:13px; color:#64748b; white-space:nowrap; }
        .stock-table-heading { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:14px; }
        .stock-table-heading h2 { margin:0 0 5px; font-size:17px; }
        .stock-table-heading p { margin:0; font-size:13px; color:#8290a4; }
        .stock-source-note { display:flex; gap:7px; align-items:center; color:#64748b; font-size:12px; }
        .stock-table-wrap { width:100%; overflow:auto; border:1px solid var(--border-color,#dfe3e8); border-radius:9px; }
        .stock-table { width:100%; border-collapse:collapse; min-width:800px; font-size:13px; }
        .stock-table th { background:#f7f9fc; color:#66758b; text-transform:uppercase; letter-spacing:.035em; font-size:10px; font-weight:700; text-align:left; padding:14px 15px; white-space:nowrap; }
        .stock-table td { padding:15px; border-top:1px solid #edf0f4; color:#475569; }
        .stock-table tbody tr:hover { background:#fafcff; }
        .stock-table .numeric { text-align:right; font-variant-numeric:tabular-nums; }
        .stock-code { color:#1d4ed8 !important; font-weight:650; white-space:nowrap; }
        .stock-item-name { color:#172033 !important; font-weight:600; }
        .stock-type { display:inline-block; padding:4px 7px; border-radius:5px; background:#f1f5f9; color:#64748b; text-transform:capitalize; font-size:11px; }
        .stock-quantity { font-weight:700; color:#172033 !important; }
        .stock-quantity.negative { color:#b91c1c !important; }
        .stock-empty { text-align:center !important; padding:42px 20px !important; color:#8490a3 !important; }
        .stock-empty svg { display:block; margin:0 auto 10px; }
        .stock-empty strong,.stock-empty span { display:block; }
        .stock-empty strong { color:#334155; margin-bottom:5px; }
        .stock-empty span { max-width:440px; margin:auto; line-height:1.5; }
        .stock-footnote { margin-top:14px; color:#8490a3; font-size:12px; line-height:1.5; }
        .stock-alert { display:flex; gap:9px; align-items:center; padding:12px 14px; border-radius:8px; margin:14px 0; font-size:13px; }
        .stock-alert.error { background:#fff1f2; border:1px solid #fecdd3; color:#9f1239; }
        @media(max-width:760px) { .stock-summary-grid { grid-template-columns:1fr; } .stock-register { padding:15px; } .stock-table-heading { align-items:flex-start; flex-direction:column; } }
      `}</style>
    </div>
  );
}
