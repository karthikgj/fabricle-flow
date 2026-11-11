import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Download, Printer, RefreshCw, Wallet } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";
import { formatDate } from "../lib/dateUtils";
import Pagination from "../components/Pagination";

type Payment = {
  id: string; payment_no: string; party_id: string;
  payment_date: string; amount: number | string; method: string;
  reference_no: string | null; status: string;
};
type Party = { id: string; name: string };
type ReportRow = Payment & { partyName: string };
const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const methodLabels: Record<string, string> = {
  cash: "Cash", upi: "UPI", bank_transfer: "Bank transfer",
  cheque: "Cheque", card: "Card", other: "Other",
};
const methodName = (s: string) => methodLabels[s] ?? s.replaceAll("_", " ");

export default function PaymentsReport() {
  const { company, loading: companyLoading, error: companyError } = useCompany();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("all");
  const [method, setMethod] = useState("all");
  const [status, setStatus] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  const load = useCallback(async () => {
    if (!company?.id) return;
    setLoading(true); setError("");
    try {
      const [paymentRes, partyRes] = await Promise.all([
        supabase.from("payments")
          .select("id, payment_no, party_id, payment_date, amount, method, reference_no, status")
          .eq("company_id", company.id).eq("direction", "receipt")
          .order("payment_date", { ascending: false }).order("created_at", { ascending: false }),
        supabase.from("parties").select("id, name").eq("company_id", company.id),
      ]);
      for (const result of [paymentRes, partyRes]) if (result.error) throw result.error;
      setPayments((paymentRes.data ?? []) as Payment[]);
      setParties((partyRes.data ?? []) as Party[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load customer receipts.");
    } finally {
      setLoading(false);
    }
  }, [company?.id]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo<ReportRow[]>(() => {
    const partyMap = new Map(parties.map(p => [p.id, p.name]));
    return payments.map(p => ({ ...p, partyName: partyMap.get(p.party_id) ?? "Unknown customer" }));
  }, [payments, parties]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r =>
      (!q || [r.payment_no, r.partyName, r.reference_no ?? "", r.method].some(v => v.toLowerCase().includes(q))) &&
      (customerId === "all" || r.party_id === customerId) &&
      (method === "all" || r.method === method) &&
      (status === "all" || r.status === status) &&
      (!fromDate || r.payment_date >= fromDate) && (!toDate || r.payment_date <= toDate)
    );
  }, [rows, search, customerId, method, status, fromDate, toDate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  );
  useEffect(() => { setCurrentPage(1); }, [search, customerId, method, status, fromDate, toDate]);
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const totals = useMemo(() => {
    const posted = filtered.filter(r => r.status === "posted");
    const month = new Date().toISOString().slice(0, 7);
    return {
      count: filtered.length,
      received: posted.reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
      customers: new Set(posted.map(r => r.party_id)).size,
      monthReceived: posted.filter(r => r.payment_date.startsWith(month)).reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
    };
  }, [filtered]);

  function exportCsv() {
    const header = ["Receipt No.", "Date", "Customer", "Payment Method", "Reference No.", "Amount", "Status"];
    const data = filtered.map(r => [r.payment_no, r.payment_date, r.partyName, methodName(r.method), r.reference_no, r.amount, r.status]);
    const blob = new Blob(["\uFEFF", [header, ...data].map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `customer-receipts-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return <section className="report-print-root">
    <header className="report-inner-heading">
      <div><h2><Wallet size={21}/> Customer Receipts Report</h2><p>Customer payments received by your company.</p></div>
      <div className="report-inner-actions">
        <button type="button" className="button button-outline" onClick={() => void load()} disabled={loading || companyLoading || !company}><RefreshCw size={16} className={loading ? "spin" : ""}/> Refresh</button>
        <button type="button" className="button button-outline no-print" onClick={() => window.print()}><Printer size={16}/> Print / PDF</button>
        <button type="button" className="button button-primary" onClick={exportCsv} disabled={!filtered.length}><Download size={16}/> Export CSV</button>
      </div>
    </header>
    {(companyError || error) && <div className="reports-alert"><AlertCircle size={17}/>{companyError || error}</div>}
    <div className="outstanding-summary">
      <article><span>Total receipts</span><strong>{loading ? "…" : money(totals.received)}</strong><small>Posted customer receipts in this view</small></article>
      <article><span>Number of receipts</span><strong>{totals.count}</strong><small>Matching selected filters</small></article>
      <article><span>Customers paid</span><strong>{totals.customers}</strong><small>Distinct customers with posted receipts</small></article>
      <article><span>Receipts this month</span><strong>{money(totals.monthReceived)}</strong><small>Posted receipts in the current month</small></article>
    </div>
    <div className="report-filters panel">
      <label className="report-search"><span>Search</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Receipt no., customer or reference"/></label>
      <label><span>From date</span><input type="date" value={fromDate} max={toDate || undefined} onChange={e => setFromDate(e.target.value)}/></label>
      <label><span>To date</span><input type="date" value={toDate} min={fromDate || undefined} onChange={e => setToDate(e.target.value)}/></label>
      <label><span>Customer</span><select value={customerId} onChange={e => setCustomerId(e.target.value)}><option value="all">All customers</option>{parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label><span>Payment method</span><select value={method} onChange={e => setMethod(e.target.value)}><option value="all">All methods</option>{Object.entries(methodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Status</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option><option value="posted">Posted</option><option value="draft">Draft</option><option value="cancelled">Cancelled</option></select></label>
      <button type="button" className="button button-outline" onClick={() => { setFromDate(""); setToDate(""); setSearch(""); setCustomerId("all"); setMethod("all"); setStatus("all"); }}>Clear filters</button>
    </div>
    <section className="report-table-panel panel">
      <div className="report-table-title"><h3>Customer receipt activity</h3><p>{filtered.length} records · dates shown as DD-MM-YYYY</p></div>
      <div className="report-table-scroll"><table className="report-table"><thead><tr><th>Receipt No.</th><th>Date</th><th>Customer</th><th>Payment Method</th><th>Reference No.</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={7} className="report-empty">Loading customer receipts…</td></tr> : filtered.length ? pageRows.map(r => <tr key={r.id}>
          <td><strong>{r.payment_no}</strong></td><td>{formatDate(r.payment_date)}</td><td>{r.partyName}</td><td>{methodName(r.method)}</td><td>{r.reference_no || "—"}</td><td>{money(Number(r.amount) || 0)}</td><td><span className="ageing-pill">{r.status}</span></td>
        </tr>) : <tr><td colSpan={7} className="report-empty">No customer receipts match these filters.</td></tr>}</tbody>
      </table></div>
      <Pagination totalItems={filtered.length} currentPage={currentPage} pageSize={PAGE_SIZE} onPageChange={setCurrentPage} loading={loading} itemLabel="receipts" />
    </section>
    <p className="report-footnote">This report includes customer receipts only. It does not display invoice allocations, advances or supplier payments.</p>
  </section>;
}
