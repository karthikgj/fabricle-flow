import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Download, Factory, Printer, RefreshCw } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";
import { formatDate } from "../lib/dateUtils";
import Pagination from "../components/Pagination";

type ProductionRow = {
  id: string; order_no: string; bom_id: string; output_item_id: string;
  planned_quantity: number | string; produced_quantity: number | string;
  status: string; production_date: string; shift: string | null;
  stock_location_id: string | null; notes: string | null; created_at: string;
};
type Item = { id: string; sku: string; name: string; unit_id: string };
type Bom = { id: string; code: string; name: string };
type Unit = { id: string; code: string; name: string };
type ReportRow = ProductionRow & { itemName: string; sku: string; bomName: string; unit: string; variance: number };

const qty = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(n);
const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export default function ProductionReport() {
  const { company, loading: companyLoading, error: companyError } = useCompany();
  const [records, setRecords] = useState<ProductionRow[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  const load = useCallback(async () => {
    if (!company?.id) return;
    setLoading(true); setError("");
    try {
      const [productionRes, itemRes, bomRes, unitRes] = await Promise.all([
        supabase.from("production_orders")
          .select("id, order_no, bom_id, output_item_id, planned_quantity, produced_quantity, status, production_date, shift, stock_location_id, notes, created_at")
          .eq("company_id", company.id).order("production_date", { ascending: false }),
        supabase.from("items").select("id, sku, name, unit_id").eq("company_id", company.id),
        supabase.from("boms").select("id, code, name").eq("company_id", company.id),
        supabase.from("units").select("id, code, name").eq("company_id", company.id),
      ]);
      for (const result of [productionRes, itemRes, bomRes, unitRes]) if (result.error) throw result.error;
      setRecords((productionRes.data ?? []) as ProductionRow[]);
      setItems((itemRes.data ?? []) as Item[]);
      setBoms((bomRes.data ?? []) as Bom[]);
      setUnits((unitRes.data ?? []) as Unit[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load production report.");
    } finally {
      setLoading(false);
    }
  }, [company?.id]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo<ReportRow[]>(() => {
    const itemMap = new Map(items.map(x => [x.id, x]));
    const bomMap = new Map(boms.map(x => [x.id, x]));
    const unitMap = new Map(units.map(x => [x.id, x]));
    return records.map(r => {
      const item = itemMap.get(r.output_item_id);
      const planned = Number(r.planned_quantity) || 0;
      const produced = Number(r.produced_quantity) || 0;
      return {
        ...r, itemName: item?.name ?? "Unknown item", sku: item?.sku ?? "—",
        bomName: bomMap.get(r.bom_id)?.name ?? bomMap.get(r.bom_id)?.code ?? "—",
        unit: item ? (unitMap.get(item.unit_id)?.code ?? "") : "",
        variance: produced - planned,
      };
    });
  }, [records, items, boms, units]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r =>
      (!q || [r.order_no, r.itemName, r.sku, r.bomName, r.shift ?? ""].some(v => v.toLowerCase().includes(q))) &&
      (status === "all" || r.status === status) &&
      (!fromDate || r.production_date >= fromDate) &&
      (!toDate || r.production_date <= toDate)
    );
  }, [rows, search, status, fromDate, toDate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = useMemo(() => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), [filtered, currentPage]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);

  useEffect(() => { setCurrentPage(1); }, [search, status, fromDate, toDate]);

  const totals = useMemo(() => filtered.reduce((a, r) => {
    a.planned += Number(r.planned_quantity) || 0;
    a.produced += Number(r.produced_quantity) || 0;
    if (r.status === "posted") a.posted += 1;
    if (r.status === "draft") a.drafts += 1;
    return a;
  }, { planned: 0, produced: 0, posted: 0, drafts: 0 }), [filtered]);

  function exportCsv() {
    const header = ["Production no.", "Date", "Output item", "SKU", "BOM", "Planned quantity", "Produced quantity", "Variance", "Unit", "Shift", "Status"];
    const data = filtered.map(r => [r.order_no, r.production_date, r.itemName, r.sku, r.bomName, r.planned_quantity, r.produced_quantity, r.variance, r.unit, r.shift, r.status]);
    const blob = new Blob(["\uFEFF", [header, ...data].map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `production-report-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return <section className="report-print-root">
    <header className="report-inner-heading">
      <div><h2><Factory size={21}/> Production Report</h2><p>Production orders, output quantities, planned-versus-produced variance, and status.</p></div>
      <div className="report-inner-actions">
        <button type="button" className="button button-outline" onClick={() => void load()} disabled={loading || companyLoading || !company}><RefreshCw size={16} className={loading ? "spin" : ""}/> Refresh</button>
        <button type="button" className="button button-outline no-print" onClick={() => window.print()}><Printer size={16}/> Print / PDF</button>
        <button type="button" className="button button-primary" onClick={exportCsv} disabled={!filtered.length}><Download size={16}/> Export CSV</button>
      </div>
    </header>
    {(companyError || error) && <div className="reports-alert"><AlertCircle size={17}/>{companyError || error}</div>}
    <div className="outstanding-summary">
      <article><span>Production orders</span><strong>{loading ? "…" : filtered.length}</strong><small>Matching selected filters</small></article>
      <article><span>Planned output</span><strong>{qty(totals.planned)}</strong><small>Across filtered orders</small></article>
      <article><span>Produced output</span><strong>{qty(totals.produced)}</strong><small>Recorded output quantity</small></article>
      <article><span>Posted / Draft</span><strong>{totals.posted} / {totals.drafts}</strong><small>Order status counts</small></article>
    </div>
    <div className="report-filters panel">
      <label className="report-search"><span>Search</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Production no., item, SKU or BOM"/></label>
      <label><span>From date</span><input type="date" value={fromDate} max={toDate || undefined} onChange={e => setFromDate(e.target.value)}/></label>
      <label><span>To date</span><input type="date" value={toDate} min={fromDate || undefined} onChange={e => setToDate(e.target.value)}/></label>
      <label><span>Status</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="posted">Posted</option><option value="cancelled">Cancelled</option></select></label>
      <button type="button" className="button button-outline" onClick={() => { setFromDate(""); setToDate(""); setSearch(""); setStatus("all"); }}>Clear filters</button>
    </div>
    <section className="report-table-panel panel">
      <div className="report-table-title"><h3>Production activity</h3><p>{filtered.length} records · dates shown as DD-MM-YYYY</p></div>
      <div className="report-table-scroll"><table className="report-table"><thead><tr><th>Production no.</th><th>Date</th><th>Output item</th><th>BOM</th><th>Planned</th><th>Produced</th><th>Variance</th><th>Shift</th><th>Status</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={9} className="report-empty">Loading production records…</td></tr> : filtered.length ? pageRows.map(r => <tr key={r.id}>
          <td><strong>{r.order_no}</strong></td><td>{formatDate(r.production_date)}</td><td>{r.itemName}<small style={{display:"block",color:"#8291a7"}}>{r.sku}</small></td><td>{r.bomName}</td>
          <td>{qty(Number(r.planned_quantity) || 0)} {r.unit}</td><td>{qty(Number(r.produced_quantity) || 0)} {r.unit}</td><td className={r.variance < 0 ? "report-due" : "report-settled"}>{r.variance > 0 ? "+" : ""}{qty(r.variance)} {r.unit}</td><td>{r.shift || "—"}</td><td><span className="ageing-pill">{r.status}</span></td>
        </tr>) : <tr><td colSpan={9} className="report-empty">No production records match these filters.</td></tr>}</tbody>
      </table></div>
    </section>
    <Pagination totalItems={filtered.length} currentPage={currentPage} pageSize={PAGE_SIZE} onPageChange={setCurrentPage} loading={loading} itemLabel="items" />
  </section>;
}
