import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Download, RefreshCw, Search, WalletCards, Printer } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";
import { formatDate } from "../lib/dateUtils";
import Pagination from "../components/Pagination";

type Invoice = {
  id: string; invoice_no: string; customer_id: string; invoice_date: string;
  status: string; subtotal: number | string; tax_amount: number | string;
  total_amount: number | string; created_at: string;
};
type Party = { id: string; name: string };
type Allocation = { target_id: string; amount: number | string; payment_id: string };
type Payment = { id: string; status: string; direction: string; payment_date: string };
type Row = {
  id: string; invoiceNo: string; customer: string; date: string; total: number;
  paid: number; outstanding: number; ageDays: number; bucket: string;
};
const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
const dateLabel = (value: string) => formatDate(value);
const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export default function OutstandingReport() {
  const { company, loading: companyLoading, error: companyError } = useCompany();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState("outstanding");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const load = useCallback(async () => {
    if (!company?.id) return;
    setLoading(true); setError("");
    try {
      const [invoiceRes, partyRes, allocationRes, paymentRes] = await Promise.all([
        supabase.from("sales_invoices").select("id, invoice_no, customer_id, invoice_date, status, subtotal, tax_amount, total_amount, created_at").eq("company_id", company.id).eq("status", "issued").order("invoice_date", { ascending: false }),
        supabase.from("parties").select("id, name").eq("company_id", company.id),
        supabase.from("payment_allocations").select("target_id, amount, payment_id").eq("company_id", company.id).eq("target_type", "sales_invoice"),
        supabase.from("payments").select("id, status, direction, payment_date").eq("company_id", company.id).eq("status", "posted").eq("direction", "receipt"),
      ]);
      for (const res of [invoiceRes, partyRes, allocationRes, paymentRes]) if (res.error) throw res.error;
      setInvoices((invoiceRes.data ?? []) as Invoice[]);
      setParties((partyRes.data ?? []) as Party[]);
      setAllocations((allocationRes.data ?? []) as Allocation[]);
      setPayments((paymentRes.data ?? []) as Payment[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load outstanding report.");
    } finally {
      setLoading(false);
    }
  }, [company?.id]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo<Row[]>(() => {
    const partyMap = new Map(parties.map((p) => [p.id, p.name]));
    const validPayments = new Set(payments.map((p) => p.id));
    const paidMap = new Map<string, number>();
    for (const a of allocations) {
      if (!validPayments.has(a.payment_id)) continue;
      paidMap.set(a.target_id, (paidMap.get(a.target_id) ?? 0) + Number(a.amount));
    }
    const today = new Date(); today.setHours(0,0,0,0);
    return invoices.map((inv) => {
      const total = Number(inv.total_amount);
      const paid = Math.min(total, paidMap.get(inv.id) ?? 0);
      const outstanding = Math.max(0, Math.round((total - paid) * 100) / 100);
      const d = new Date(`${inv.invoice_date}T00:00:00`);
      const ageDays = Math.max(0, Math.floor((today.getTime() - d.getTime()) / 86400000));
      const bucket = ageDays <= 0 ? "Current" : ageDays <= 30 ? "1–30 days" : ageDays <= 60 ? "31–60 days" : ageDays <= 90 ? "61–90 days" : "90+ days";
      return { id: inv.id, invoiceNo: inv.invoice_no, customer: partyMap.get(inv.customer_id) ?? "Unknown customer", date: inv.invoice_date, total, paid, outstanding, ageDays, bucket };
    });
  }, [invoices, parties, allocations, payments]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesText = !q || r.invoiceNo.toLowerCase().includes(q) || r.customer.toLowerCase().includes(q);
      const matchesView = view === "all" || (view === "outstanding" ? r.outstanding > 0 : r.outstanding === 0);
      return matchesText && matchesView && (!fromDate || r.date >= fromDate) && (!toDate || r.date <= toDate);
    });
  }, [rows, search, view, fromDate, toDate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = useMemo(() => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), [filtered, currentPage]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);
  useEffect(() => { setCurrentPage(1); }, [search, fromDate, toDate, view]);

  const totals = useMemo(() => filtered.reduce((a, r) => {
    a.invoiceTotal += r.total; a.paid += r.paid; a.outstanding += r.outstanding;
    if (r.outstanding > 0) a.openInvoices += 1;
    return a;
  }, { invoiceTotal: 0, paid: 0, outstanding: 0, openInvoices: 0 }), [filtered]);

  function exportCsv() {
    const header = ["Invoice", "Invoice date", "Customer", "Invoice total", "Paid", "Outstanding", "Age (days)", "Ageing bucket"];
    const data = filtered.map((r) => [r.invoiceNo, r.date, r.customer, r.total, r.paid, r.outstanding, r.ageDays, r.bucket]);
    const blob = new Blob(["\uFEFF", [header, ...data].map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `outstanding-report-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <section className="outstanding-report report-print-root">
      <header className="report-inner-heading">
        <div><h2><WalletCards size={21}/> Outstanding &amp; Receivables</h2><p>Issued invoices, collections, pending balances, and ageing by invoice date.</p></div>
        <div className="report-inner-actions">
          <button type="button" className="button button-outline" onClick={() => void load()} disabled={loading || companyLoading || !company}><RefreshCw size={16} className={loading ? "spin" : ""}/> Refresh</button>
          <button type="button" className="button button-outline no-print" onClick={() => window.print()}><Printer size={16}/> Print / PDF</button>
          <button type="button" className="button button-primary" onClick={exportCsv} disabled={!filtered.length}><Download size={16}/> Export CSV</button>
        </div>
      </header>
      {(companyError || error) && <div className="reports-alert"><AlertCircle size={17}/>{companyError || error}</div>}
      <div className="outstanding-summary">
        <article><span>Outstanding invoices</span><strong>{loading ? "…" : totals.openInvoices}</strong><small>Invoices with a balance due</small></article>
        <article><span>Invoice total</span><strong>{loading ? "…" : money(totals.invoiceTotal)}</strong><small>Filtered issued invoices</small></article>
        <article><span>Paid / collected</span><strong>{loading ? "…" : money(totals.paid)}</strong><small>Allocated posted receipts</small></article>
        <article><span>Outstanding balance</span><strong>{loading ? "…" : money(totals.outstanding)}</strong><small>Remaining amount due</small></article>
      </div>
      <section className="report-filters panel">
        <label className="report-search"><span>Search</span><div><Search size={16}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Invoice number or customer"/></div></label>
        <label><span>Invoice date from</span><input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)}/></label>
        <label><span>Invoice date to</span><input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)}/></label>
        <label><span>Show</span><select value={view} onChange={(e) => setView(e.target.value)}><option value="outstanding">Outstanding only</option><option value="paid">Paid only</option><option value="all">All issued invoices</option></select></label>
        <button type="button" className="button button-outline" onClick={() => { setSearch(""); setFromDate(""); setToDate(""); setView("outstanding"); }}>Reset</button>
      </section>
      <section className="report-table-panel panel">
        <div className="report-table-title"><div><h3>Invoice balances</h3><p>{filtered.length} invoices in this view</p></div></div>
        <div className="report-table-scroll"><table className="report-table">
          <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Invoice total</th><th>Paid</th><th>Outstanding</th><th>Age</th><th>Ageing</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className="report-empty">Loading invoice balances…</td></tr>
            : filtered.length === 0 ? <tr><td colSpan={8} className="report-empty">No invoices match these filters.</td></tr>
            : pageRows.map((r) => <tr key={r.id}><td><strong>{r.invoiceNo}</strong></td><td>{dateLabel(r.date)}</td><td>{r.customer}</td><td>{money(r.total)}</td><td>{money(r.paid)}</td><td><strong className={r.outstanding > 0 ? "report-due" : "report-settled"}>{money(r.outstanding)}</strong></td><td>{r.ageDays} days</td><td><span className={`ageing-pill ${r.outstanding === 0 ? "settled" : r.ageDays > 90 ? "overdue" : r.ageDays > 30 ? "warning" : "current"}`}>{r.outstanding === 0 ? "Settled" : r.bucket}</span></td></tr>)}
          </tbody>
          {filtered.length > 0 && <tfoot><tr><td colSpan={3}>Total</td><td>{money(totals.invoiceTotal)}</td><td>{money(totals.paid)}</td><td>{money(totals.outstanding)}</td><td colSpan={2}></td></tr></tfoot>}
        </table></div>
      </section>
      <Pagination totalItems={filtered.length} currentPage={currentPage} pageSize={PAGE_SIZE} onPageChange={setCurrentPage} loading={loading} itemLabel="items" />
      <p className="report-footnote">Balances use posted customer receipts allocated to issued invoices. Ageing is calculated from invoice date, not contractual due date.</p>
    </section>
  );
}
