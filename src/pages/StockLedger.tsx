import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Search, History, AlertCircle } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";
import { formatDateTime } from "../lib/dateUtils";
import Pagination from "../components/Pagination";

type Item = { id: string; sku: string; name: string; item_type: string; unit_id: string };
type Unit = { id: string; code: string; name: string; precision_digits: number };
type Location = { id: string; code: string; name: string };
type Lot = { id: string; lot_code: string; supplier_lot_code: string | null };
type Ledger = {
  id: string;
  item_id: string;
  location_id: string | null;
  lot_id: string | null;
  quantity_delta: number | string;
  source_type: string;
  source_id: string;
  idempotency_key: string;
  occurred_at: string;
  created_by: string | null;
};
type LedgerView = Ledger & {
  sku: string;
  itemName: string;
  itemType: string;
  unit: string;
  locationName: string;
  lotName: string;
  runningBalance: number;
};
const PAGE_SIZE = 1000;

function fmt(value: number, digits = 3) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: Math.min(6, Math.max(0, digits)) }).format(value);
}
function csv(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}
function sourceLabel(source: string) {
  if (source === "goods_receipt") return "Yarn receipt / GRN";
  if (source === "stock_adjustment") return "Stock adjustment";
  if (source === "production") return "Production";
  if (source === "delivery") return "Fabric delivery";
  return source.replaceAll("_", " ");
}

export default function StockLedger() {
  const { company, loading: companyLoading, error: companyError } = useCompany();
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const DISPLAY_PAGE_SIZE = 10;
  const [items, setItems] = useState<Item[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [itemFilter, setItemFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [lotFilter, setLotFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const loadLedger = useCallback(async () => {
    if (!company?.id) return;
    setLoading(true);
    setError("");
    try {
      const [itemsRes, unitsRes, locationsRes, lotsRes] = await Promise.all([
        supabase.from("items").select("id, sku, name, item_type, unit_id").eq("company_id", company.id).order("name"),
        supabase.from("units").select("id, code, name, precision_digits").eq("company_id", company.id).order("name"),
        supabase.from("locations").select("id, code, name").eq("company_id", company.id).order("name"),
        supabase.from("lots").select("id, lot_code, supplier_lot_code").eq("company_id", company.id).order("lot_code"),
      ]);
      for (const result of [itemsRes, unitsRes, locationsRes, lotsRes]) if (result.error) throw result.error;

      const rows: Ledger[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error: ledgerError } = await supabase.from("stock_ledger")
          .select("id, item_id, location_id, lot_id, quantity_delta, source_type, source_id, idempotency_key, occurred_at, created_by")
          .eq("company_id", company.id)
          .order("occurred_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (ledgerError) throw ledgerError;
        const batch = (data ?? []) as Ledger[];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) break;
      }
      setItems((itemsRes.data ?? []) as Item[]);
      setUnits((unitsRes.data ?? []) as Unit[]);
      setLocations((locationsRes.data ?? []) as Location[]);
      setLots((lotsRes.data ?? []) as Lot[]);
      setLedger(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load stock ledger.");
    } finally {
      setLoading(false);
    }
  }, [company?.id]);

  useEffect(() => { void loadLedger(); }, [loadLedger]);

  const allViews = useMemo<LedgerView[]>(() => {
    const itemMap = new Map(items.map((x) => [x.id, x]));
    const unitMap = new Map(units.map((x) => [x.id, x]));
    const locationMap = new Map(locations.map((x) => [x.id, x]));
    const lotMap = new Map(lots.map((x) => [x.id, x]));
    const balance = new Map<string, number>();
    return ledger.map((row) => {
      const item = itemMap.get(row.item_id);
      const unit = item ? unitMap.get(item.unit_id) : undefined;
      const location = row.location_id
  ? locationMap.get(row.location_id)
  : undefined;
      const lot = row.lot_id ? lotMap.get(row.lot_id) : undefined;
      const key = `${row.item_id}|${row.location_id ?? "__unassigned__"}|${row.lot_id ?? "no-lot"}`;
      const next = (balance.get(key) ?? 0) + Number(row.quantity_delta);
      balance.set(key, next);
      return {
        ...row,
        sku: item?.sku ?? "Unknown SKU",
        itemName: item?.name ?? "Unknown item",
        itemType: item?.item_type ?? "unknown",
        unit: unit?.code ?? "—",
        locationName: location?.name ?? (row.location_id ? "Unknown location" : "Unassigned Location"),
        lotName: lot?.lot_code ?? (row.lot_id ? "Unknown lot" : "—"),
        runningBalance: next,
      };
    }).reverse();
  }, [ledger, items, units, locations, lots]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allViews.filter((row) => {
      const matchesSearch = !q || [
        row.sku, row.itemName, row.itemType, row.locationName, row.lotName,
        row.source_type, row.source_id, row.idempotency_key,
      ].some((v) => v.toLowerCase().includes(q));
      const matchesSource = sourceFilter === "all" || row.source_type === sourceFilter;
      const matchesItem = itemFilter === "all" || row.item_id === itemFilter;
      const matchesLocation = locationFilter === "all" || (locationFilter === "__unassigned__" ? !row.location_id : row.location_id === locationFilter);
      const matchesLot = lotFilter === "all" || (lotFilter === "none" ? !row.lot_id : row.lot_id === lotFilter);
      const date = row.occurred_at.slice(0, 10);
      return matchesSearch && matchesSource && matchesItem && matchesLocation && matchesLot
        && (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
    });
  }, [allViews, search, sourceFilter, itemFilter, locationFilter, lotFilter, fromDate, toDate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / DISPLAY_PAGE_SIZE));
  const pageRows = useMemo(() => filtered.slice((currentPage - 1) * DISPLAY_PAGE_SIZE, currentPage * DISPLAY_PAGE_SIZE), [filtered, currentPage]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);
  useEffect(() => { setCurrentPage(1); }, [search, sourceFilter, itemFilter, locationFilter, lotFilter, fromDate, toDate]);

  const totals = useMemo(() => filtered.reduce((acc, row) => {
    const delta = Number(row.quantity_delta);
    if (delta > 0) acc.in += delta;
    if (delta < 0) acc.out += Math.abs(delta);
    return acc;
  }, { in: 0, out: 0 }), [filtered]);

  function exportCsv() {
    const rows = [
      ["Date/time", "Source type", "Source ID", "SKU", "Item", "Type", "Location", "Lot", "Quantity in", "Quantity out", "Running balance", "Unit", "Ledger ID", "Idempotency key"],
      ...filtered.map((row) => {
        const delta = Number(row.quantity_delta);
        return [
          formatDateTime(row.occurred_at), sourceLabel(row.source_type), row.source_id,
          row.sku, row.itemName, row.itemType, row.locationName, row.lotName,
          delta > 0 ? delta : "", delta < 0 ? Math.abs(delta) : "",
          row.runningBalance, row.unit, row.id, row.idempotency_key,
        ];
      }),
    ];
    const blob = new Blob(["\uFEFF", rows.map((r) => r.map(csv).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="ledger-page">
      <header className="page-header">
        <div className="page-heading">
          <h1>Stock Ledger</h1>
         
        </div>
        <div className="page-actions">
          <button type="button" className="button button-outline" onClick={() => void loadLedger()} disabled={loading || companyLoading || !company}>
            <RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh
          </button>
          <button type="button" className="button button-primary" onClick={exportCsv} disabled={!filtered.length}>
            <Download size={16} /> Export CSV
          </button>
        </div>
      </header>

      {companyError && <div className="ledger-alert"><AlertCircle size={16} />{companyError}</div>}
      {error && <div className="ledger-alert"><AlertCircle size={16} />{error}</div>}

      <section className="ledger-summary">
        <article><span>Movements</span><strong>{loading ? "…" : filtered.length}</strong><small>Matching current filters</small></article>
        <article><span>Quantity in</span><strong>{loading ? "…" : fmt(totals.in, 3)}</strong><small>Positive ledger movements</small></article>
        <article><span>Quantity out</span><strong>{loading ? "…" : fmt(totals.out, 3)}</strong><small>Absolute value of negative movements</small></article>
      </section>

      <section className="panel ledger-register">
        <div className="ledger-filters">
          <label className="ledger-search"><Search size={17}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item, SKU, location or reference"/></label>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} aria-label="Filter source type">
            <option value="all">All movement types</option><option value="goods_receipt">Yarn receipt / GRN</option><option value="production">Production</option><option value="delivery">Fabric delivery</option><option value="stock_adjustment">Stock adjustment</option>
          </select>
          <select value={itemFilter} onChange={(e) => setItemFilter(e.target.value)} aria-label="Filter item">
            <option value="all">All items</option>{items.map((x) => <option key={x.id} value={x.id}>{x.sku} — {x.name}</option>)}
          </select>
          <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} aria-label="Filter location">
            <option value="all">All locations</option><option value="__unassigned__">Unassigned Location</option>{locations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <select value={lotFilter} onChange={(e) => setLotFilter(e.target.value)} aria-label="Filter lot">
            <option value="all">All lots</option><option value="none">No lot</option>{lots.map((x) => <option key={x.id} value={x.id}>{x.lot_code}</option>)}
          </select>
          <label className="ledger-date">From<input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)}/></label>
          <label className="ledger-date">To<input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)}/></label>
        </div>

        <div className="ledger-table-heading">
          <div><h2>Movement history</h2><p>{loading ? "Loading ledger…" : `${filtered.length} movements`}</p></div>
          <span><History size={15}/> Oldest-first running balance, newest movements shown first</span>
        </div>

        <div className="ledger-table-wrap">
          <table className="ledger-table">
            <thead><tr><th>Date / time</th><th>Movement</th><th>Reference</th><th>Item</th><th>Location</th><th>Lot</th><th className="num">In</th><th className="num">Out</th><th className="num">Running balance</th><th>Unit</th></tr></thead>
            <tbody>
              {!loading && pageRows.map((row) => {
                const delta = Number(row.quantity_delta);
                const unit = units.find((u) => u.code === row.unit);
                return <tr key={row.id}>
                  <td className="ledger-date-cell">{formatDateTime(row.occurred_at)}</td>
                  <td><span className={`ledger-source ${row.source_type}`}>{sourceLabel(row.source_type)}</span></td>
                  <td className="ledger-reference" title={row.source_id}>{row.source_id.slice(0, 8).toUpperCase()}</td>
                  <td><strong>{row.sku}</strong><small className="ledger-item-sub">{row.itemName}</small></td>
                  <td>{row.locationName}</td><td>{row.lotName}</td>
                  <td className="num positive">{delta > 0 ? fmt(delta, unit?.precision_digits ?? 3) : "—"}</td>
                  <td className="num negative">{delta < 0 ? fmt(Math.abs(delta), unit?.precision_digits ?? 3) : "—"}</td>
                  <td className="num ledger-balance">{fmt(row.runningBalance, unit?.precision_digits ?? 3)}</td><td>{row.unit}</td>
                </tr>;
              })}
              {!loading && !error && filtered.length === 0 && <tr><td colSpan={10} className="ledger-empty"><History size={25}/><strong>No stock movements found</strong><span>Posted receipts, production, deliveries, and stock adjustments appear here. Draft transactions are excluded.</span></td></tr>}
              {loading && <tr><td colSpan={10} className="ledger-empty">Loading movements…</td></tr>}
            </tbody>
          </table>
        </div>
        
      </section>
      <Pagination totalItems={filtered.length} currentPage={currentPage} pageSize={DISPLAY_PAGE_SIZE} onPageChange={setCurrentPage} loading={loading} itemLabel="movements" />

      <style>{`
        .ledger-page { color:var(--text-primary,#172033); }
        .ledger-summary { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin:20px 0; }
        .ledger-summary article { display:flex; flex-direction:column; gap:5px; background:#fff; border:1px solid var(--border-color,#dfe3e8); border-radius:12px; padding:17px 19px; }
        .ledger-summary span { color:#64748b; font-size:13px; }.ledger-summary strong { font-size:26px; line-height:1.2; }.ledger-summary small { color:#8490a3; font-size:12px; }
        .ledger-register { padding:22px 24px; }
        .ledger-filters { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:23px; }
        .ledger-search { display:flex; align-items:center; gap:9px; border:1px solid var(--border-color,#dfe3e8); border-radius:8px; padding:0 12px; height:41px; flex:1 1 270px; color:#8190a5; }.ledger-search input { border:0; outline:0; width:100%; min-width:0; font:inherit; background:transparent; }
        .ledger-filters select,.ledger-date input { height:41px; border:1px solid var(--border-color,#dfe3e8); border-radius:8px; padding:0 10px; color:#334155; background:#fff; max-width:220px; }
        .ledger-date { display:flex; align-items:center; gap:7px; color:#64748b; font-size:12px; }.ledger-date input { max-width:150px; }
        .ledger-table-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }.ledger-table-heading h2 { margin:0 0 5px; font-size:17px; }.ledger-table-heading p { margin:0; color:#8490a3; font-size:13px; }.ledger-table-heading>span { display:flex; gap:7px; align-items:center; color:#64748b; font-size:12px; }
        .ledger-table-wrap { overflow:auto; border:1px solid var(--border-color,#dfe3e8); border-radius:9px; }.ledger-table { width:100%; min-width:1200px; border-collapse:collapse; font-size:12px; }
        .ledger-table th { text-align:left; padding:13px 12px; background:#f7f9fc; color:#66758b; text-transform:uppercase; letter-spacing:.035em; font-size:10px; white-space:nowrap; }.ledger-table td { padding:13px 12px; border-top:1px solid #edf0f4; color:#475569; white-space:nowrap; }.ledger-table tbody tr:hover { background:#fafcff; }
        .ledger-table .num { text-align:right; font-variant-numeric:tabular-nums; }.ledger-date-cell { color:#64748b!important; }.ledger-source { display:inline-block; padding:4px 7px; border-radius:5px; background:#eff6ff; color:#1d4ed8; font-size:11px; }.ledger-source.stock_adjustment { background:#fff7ed; color:#9a3412; }
        .ledger-reference { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; color:#64748b!important; }.ledger-table td strong { color:#172033; }.ledger-item-sub { display:block; margin-top:3px; color:#8490a3; font-size:11px; }.ledger-table .positive { color:#047857!important; }.ledger-table .negative { color:#b91c1c!important; }.ledger-balance { color:#172033!important; font-weight:700; }
        .ledger-empty { text-align:center!important; padding:42px 20px!important; color:#8490a3!important; white-space:normal!important; }.ledger-empty svg { display:block; margin:0 auto 10px; }.ledger-empty strong,.ledger-empty span { display:block; }.ledger-empty strong { color:#334155; margin-bottom:5px; }.ledger-empty span { max-width:450px; margin:auto; line-height:1.5; }
        .ledger-footnote { color:#8490a3; font-size:12px; line-height:1.5; margin:14px 0 0; }.ledger-alert { display:flex; gap:8px; align-items:center; padding:12px 14px; margin:12px 0; border-radius:8px; background:#fff1f2; border:1px solid #fecdd3; color:#9f1239; font-size:13px; }
        @media(max-width:760px) { .ledger-summary { grid-template-columns:1fr; }.ledger-register { padding:15px; }.ledger-table-heading { align-items:flex-start; flex-direction:column; } }
      `}</style>
    </main>
  );
}
