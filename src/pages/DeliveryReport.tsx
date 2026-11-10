import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Download, Printer, RefreshCw, Truck } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";
import { formatDate } from "../lib/dateUtils";
import Pagination from "../components/Pagination";

type DeliveryRow = {
  id: string; document_no: string; customer_id: string; status: string;
  delivery_date: string; movement_type: string; destination: string | null;
  transporter_name: string | null; vehicle_number: string | null;
  customer_reference: string | null;
};
type DeliveryLine = { delivery_id: string; quantity: number | string; unit_price: number | string };
type Party = { id: string; name: string };
type ReportRow = DeliveryRow & { customerName: string; lineCount: number; quantity: number; value: number };
const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
const qty = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(n);
const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export default function DeliveryReport() {
  const { company, loading: companyLoading, error: companyError } = useCompany();
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [lines, setLines] = useState<DeliveryLine[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  const load = useCallback(async () => {
    if (!company?.id) return;
    setLoading(true); setError("");
    try {
      const [deliveryRes, lineRes, partyRes] = await Promise.all([
        supabase.from("deliveries")
          .select("id, document_no, customer_id, status, delivery_date, movement_type, destination, transporter_name, vehicle_number, customer_reference")
          .eq("company_id", company.id).order("delivery_date", { ascending: false }),
        supabase.from("delivery_lines").select("delivery_id, quantity, unit_price").eq("company_id", company.id),
        supabase.from("parties").select("id, name").eq("company_id", company.id),
      ]);
      for (const result of [deliveryRes, lineRes, partyRes]) if (result.error) throw result.error;
      setDeliveries((deliveryRes.data ?? []) as DeliveryRow[]);
      setLines((lineRes.data ?? []) as DeliveryLine[]);
      setParties((partyRes.data ?? []) as Party[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load delivery report.");
    } finally {
      setLoading(false);
    }
  }, [company?.id]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo<ReportRow[]>(() => {
    const partyMap = new Map(parties.map(p => [p.id, p.name]));
    const lineMap = new Map<string, { count: number; quantity: number; value: number }>();
    for (const line of lines) {
      const current = lineMap.get(line.delivery_id) ?? { count: 0, quantity: 0, value: 0 };
      const q = Number(line.quantity) || 0;
      current.count += 1; current.quantity += q; current.value += q * (Number(line.unit_price) || 0);
      lineMap.set(line.delivery_id, current);
    }
    return deliveries.map(d => {
      const totals = lineMap.get(d.id) ?? { count: 0, quantity: 0, value: 0 };
      return { ...d, customerName: partyMap.get(d.customer_id) ?? "Unknown customer", lineCount: totals.count, quantity: totals.quantity, value: totals.value };
    });
  }, [deliveries, lines, parties]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r =>
      (!q || [r.document_no, r.customerName, r.destination ?? "", r.vehicle_number ?? "", r.transporter_name ?? "", r.customer_reference ?? ""].some(v => v.toLowerCase().includes(q))) &&
      (kind === "all" || r.movement_type === kind) &&
      (status === "all" || r.status === status) &&
      (!fromDate || r.delivery_date >= fromDate) && (!toDate || r.delivery_date <= toDate)
    );
  }, [rows, search, kind, status, fromDate, toDate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = useMemo(() => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), [filtered, currentPage]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);

  useEffect(() => { setCurrentPage(1); }, [search, kind, status, fromDate, toDate]);

  const totals = useMemo(() => filtered.reduce((a, r) => {
    a.documents += 1; a.quantity += r.quantity; a.value += r.value;
    if (r.movement_type === "yarn") a.yarn += 1; else a.fabric += 1;
    if (r.status === "posted") a.posted += 1;
    return a;
  }, { documents: 0, quantity: 0, value: 0, yarn: 0, fabric: 0, posted: 0 }), [filtered]);

  function exportCsv() {
    const header = ["Document", "Date", "Customer", "Type", "Status", "Line count", "Quantity", "Estimated line value", "Destination", "Transporter", "Vehicle", "Customer reference"];
    const data = filtered.map(r => [r.document_no, r.delivery_date, r.customerName, r.movement_type, r.status, r.lineCount, r.quantity, r.value, r.destination, r.transporter_name, r.vehicle_number, r.customer_reference]);
    const blob = new Blob(["\uFEFF", [header, ...data].map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `delivery-report-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return <section className="report-print-root">
    <header className="report-inner-heading">
      <div><h2><Truck size={21}/> Delivery Report</h2><p>Yarn and fabric delivery challans, customer-wise quantities, statuses, and transport details.</p></div>
      <div className="report-inner-actions">
        <button type="button" className="button button-outline" onClick={() => void load()} disabled={loading || companyLoading || !company}><RefreshCw size={16} className={loading ? "spin" : ""}/> Refresh</button>
        <button type="button" className="button button-outline no-print" onClick={() => window.print()}><Printer size={16}/> Print / PDF</button>
        <button type="button" className="button button-primary" onClick={exportCsv} disabled={!filtered.length}><Download size={16}/> Export CSV</button>
      </div>
    </header>
    {(companyError || error) && <div className="reports-alert"><AlertCircle size={17}/>{companyError || error}</div>}
    <div className="outstanding-summary">
      <article><span>Delivery documents</span><strong>{loading ? "…" : totals.documents}</strong><small>Matching selected filters</small></article>
      <article><span>Yarn / Fabric</span><strong>{totals.yarn} / {totals.fabric}</strong><small>By movement type</small></article>
      <article><span>Total quantity</span><strong>{qty(totals.quantity)}</strong><small>Sum of delivery line quantities</small></article>
      <article><span>Posted documents</span><strong>{totals.posted}</strong><small>Stock-posted deliveries</small></article>
    </div>
    <div className="report-filters panel">
      <label className="report-search"><span>Search</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Challan, customer, vehicle or destination"/></label>
      <label><span>From date</span><input type="date" value={fromDate} max={toDate || undefined} onChange={e => setFromDate(e.target.value)}/></label>
      <label><span>To date</span><input type="date" value={toDate} min={fromDate || undefined} onChange={e => setToDate(e.target.value)}/></label>
      <label><span>Delivery type</span><select value={kind} onChange={e => setKind(e.target.value)}><option value="all">All types</option><option value="yarn">Yarn</option><option value="fabric">Fabric</option></select></label>
      <label><span>Status</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="posted">Posted</option><option value="cancelled">Cancelled</option></select></label>
      <button type="button" className="button button-outline" onClick={() => { setFromDate(""); setToDate(""); setSearch(""); setKind("all"); setStatus("all"); }}>Clear filters</button>
    </div>
    <section className="report-table-panel panel">
      <div className="report-table-title"><h3>Delivery activity</h3><p>{filtered.length} records · line value is quantity × unit price where entered</p></div>
      <div className="report-table-scroll"><table className="report-table"><thead><tr><th>Challan no.</th><th>Date</th><th>Customer</th><th>Type</th><th>Lines</th><th>Quantity</th><th>Estimated value</th><th>Destination / Vehicle</th><th>Status</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={9} className="report-empty">Loading delivery records…</td></tr> : filtered.length ? pageRows.map(r => <tr key={r.id}>
          <td><strong>{r.document_no}</strong></td><td>{formatDate(r.delivery_date)}</td><td>{r.customerName}</td><td>{r.movement_type === "yarn" ? "Yarn" : "Fabric"}</td><td>{r.lineCount}</td><td>{qty(r.quantity)}</td><td>{money(r.value)}</td><td>{[r.destination, r.vehicle_number].filter(Boolean).join(" · ") || "—"}</td><td><span className="ageing-pill">{r.status}</span></td>
        </tr>) : <tr><td colSpan={9} className="report-empty">No delivery records match these filters.</td></tr>}</tbody>
      </table></div>
    </section>
    <Pagination totalItems={filtered.length} currentPage={currentPage} pageSize={PAGE_SIZE} onPageChange={setCurrentPage} loading={loading} itemLabel="items" />
    <p className="report-footnote">Delivery quantities include all matching delivery records. Estimated value is calculated from delivery line quantities and unit prices; it is not an invoice or accounting total.</p>
  </section>;
}
