import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Printer, RefreshCw, Wallet, Settings2, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";
import Pagination from "../components/Pagination"
import { formatDate } from "../lib/dateUtils";
import "./payments.css";

type Party = {
  id: string;
  name: string;
  party_type: string;
  phone?: string | null;
  email?: string | null;
  tax_id?: string | null;
  address?: unknown;
};
type Payment = {
  id: string;
  payment_no: string;
  direction: string;
  party_id: string;
  payment_date: string;
  amount: number;
  method: string;
  reference_no: string | null;
  status: string;
  posted_at: string | null;
  notes: string | null;
  created_by?: string | null;
};
type Invoice = {
  id: string;
  invoice_no: string;
  customer_id: string;
  invoice_date: string;
  total_amount: number;
  status: string;
};
type Allocation = { payment_id: string; target_id: string; amount: number };
type CompanyProfile = Record<string, unknown>;
type NumberingSettings = { mode: "manual" | "automatic"; prefix: string; nextNumber: number; digits: number };

const today = () => new Date().toISOString().slice(0, 10);
const money = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
const fmtDate = (s: string) => formatDate(s);
const escapeHtml = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function addressLines(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.split(/\n|,/).map(x => x.trim()).filter(Boolean);
  if (typeof value !== "object" || Array.isArray(value)) return [];
  const obj = value as Record<string, unknown>;
  return ["line1", "line2", "address_line1", "address_line2", "street", "area", "city", "district", "state", "postal_code", "pincode", "country"]
    .map(k => asText(obj[k])).filter(Boolean);
}
function amountInWordsIndian(value: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const underThousand = (n: number): string => {
    const parts: string[] = [];
    if (n >= 100) parts.push(`${ones[Math.floor(n / 100)]} Hundred`);
    n %= 100;
    if (n >= 20) parts.push(tens[Math.floor(n / 10)] + (n % 10 ? ` ${ones[n % 10]}` : ""));
    else if (n > 0) parts.push(ones[n]);
    return parts.join(" ");
  };
  const integerWords = (n: number): string => {
    if (n === 0) return "Zero";
    const groups: [number, string][] = [
      [10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"], [1, ""],
    ];
    const parts: string[] = [];
    for (const [size, label] of groups) {
      const count = Math.floor(n / size);
      if (count) {
        parts.push(`${underThousand(count)}${label ? ` ${label}` : ""}`);
        n %= size;
      }
    }
    return parts.join(" ");
  };
  const safe = Math.max(0, Math.round((Number(value) + Number.EPSILON) * 100) / 100);
  const rupees = Math.floor(safe);
  const paise = Math.round((safe - rupees) * 100);
  return `Indian Rupees ${integerWords(rupees)}${paise ? ` and ${integerWords(paise)} Paise` : ""} Only`;
}
function displayMethod(method: string): string {
  const labels: Record<string, string> = {
    cash: "Cash", upi: "UPI", bank_transfer: "Bank transfer",
    cheque: "Cheque", card: "Card", other: "Other",
  };
  return labels[method] ?? method.replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
}

export default function Payments() {
  const { company } = useCompany();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [invoicePage, setInvoicePage] = useState(1);
  const [receiptPage, setReceiptPage] = useState(1);
  const PAGE_SIZE = 10;
  const [parties, setParties] = useState<Party[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("upi");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [numbering, setNumbering] = useState<NumberingSettings>({ mode: "automatic", prefix: "RCT-", nextNumber: 1, digits: 5 });
  const [numberingDraft, setNumberingDraft] = useState<NumberingSettings>({ mode: "automatic", prefix: "RCT-", nextNumber: 1, digits: 5 });
  const [numberingOpen, setNumberingOpen] = useState(false);
  const [manualPaymentNo, setManualPaymentNo] = useState("");

  const load = useCallback(async () => {
    if (!company?.id) { setLoading(false); return; }
    setLoading(true); setError("");
    const [pays, pars, inv, alloc, companyResult, sequenceResult] = await Promise.all([
      supabase.from("payments").select("*").eq("company_id", company.id).eq("direction", "receipt").order("payment_date", { ascending: false }),
      supabase.from("parties").select("id,name,party_type,phone,email,tax_id,address").eq("company_id", company.id).order("name"),
      supabase.from("sales_invoices").select("id,invoice_no,customer_id,invoice_date,total_amount,status").eq("company_id", company.id).eq("status", "issued").order("invoice_date"),
      supabase.from("payment_allocations").select("target_id,amount,payment_id").eq("company_id", company.id).eq("target_type", "sales_invoice"),
      supabase.from("companies").select("*").eq("id", company.id).maybeSingle(),
      supabase.from("document_sequences").select("mode, prefix, next_number, digits").eq("company_id", company.id).eq("document_type", "customer_receipt").maybeSingle(),
    ]);
    const failed = [pays, pars, inv, alloc, companyResult, sequenceResult].find(r => r.error);
    if (failed?.error) setError(`Unable to load payment data: ${failed.error.message}`);
    else {
      setPayments((pays.data ?? []) as Payment[]);
      setParties((pars.data ?? []) as Party[]);
      setInvoices((inv.data ?? []) as Invoice[]);
      setAllocations((alloc.data ?? []) as Allocation[]);
      setCompanyProfile((companyResult.data ?? null) as CompanyProfile | null);
      if (sequenceResult.data) {
        const loaded = {
          mode: sequenceResult.data.mode as "manual" | "automatic",
          prefix: sequenceResult.data.prefix || "RCT-",
          nextNumber: Number(sequenceResult.data.next_number),
          digits: Number(sequenceResult.data.digits),
        };
        setNumbering(loaded);
        setNumberingDraft(loaded);
      }
    }
    setLoading(false);
  }, [company?.id]);
  useEffect(() => { void load(); }, [load]);

  const invoicePageRows = invoices.slice((invoicePage - 1) * PAGE_SIZE, invoicePage * PAGE_SIZE);
  const receiptPageRows = payments.slice((receiptPage - 1) * PAGE_SIZE, receiptPage * PAGE_SIZE);
  useEffect(() => { if (invoicePage > Math.max(1, Math.ceil(invoices.length / PAGE_SIZE))) setInvoicePage(1); }, [invoices.length, invoicePage]);
  useEffect(() => { if (receiptPage > Math.max(1, Math.ceil(payments.length / PAGE_SIZE))) setReceiptPage(1); }, [payments.length, receiptPage]);

  const paidByInvoice = useMemo(() => {
    const status = new Map(payments.map(p => [p.id, p.status]));
    const totals: Record<string, number> = {};
    for (const a of allocations) if (status.get(a.payment_id) === "posted") totals[a.target_id] = (totals[a.target_id] ?? 0) + Number(a.amount);
    return totals;
  }, [allocations, payments]);
  const openBalance = (i: Invoice) => Math.max(0, Math.round((Number(i.total_amount) - (paidByInvoice[i.id] ?? 0) + Number.EPSILON) * 100) / 100);
  const selectedInvoice = invoices.find(i => i.id === selectedInvoiceId) ?? null;
  const selectedCustomer = selectedInvoice ? parties.find(p => p.id === selectedInvoice.customer_id) : undefined;
  const selectedBalance = selectedInvoice ? openBalance(selectedInvoice) : 0;
  const enteredAmount = Math.round((Number(amount) || 0) * 100) / 100;

  function startPayment(invoice: Invoice) {
    setSelectedInvoiceId(invoice.id); setDate(today()); setAmount(openBalance(invoice).toFixed(2)); setMethod("upi"); setReference(""); setNotes(""); setManualPaymentNo(""); setNumberingOpen(false); setError(""); setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function cancelPayment() { setSelectedInvoiceId(null); setError(""); setNumberingOpen(false); }

  async function saveNumberingSettings() {
    if (!company?.id) return;
    if (numberingDraft.mode === "automatic" && !numberingDraft.prefix.trim()) {
      setError("Enter a payment number prefix.");
      return;
    }
    const { error: saveError } = await supabase.from("document_sequences").upsert({
      company_id: company.id,
      document_type: "customer_receipt",
      mode: numberingDraft.mode,
      prefix: numberingDraft.prefix.trim(),
      next_number: numberingDraft.nextNumber,
      digits: numberingDraft.digits,
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_id,document_type" });
    if (saveError) {
      setError(`Unable to save payment numbering settings: ${saveError.message}`);
      return;
    }
    setNumbering({ ...numberingDraft, prefix: numberingDraft.prefix.trim() });
    setNumberingOpen(false);
    setManualPaymentNo("");
    setNotice("Payment numbering settings saved.");
  }

  async function savePayment() {
    if (!company?.id || !selectedInvoice) return;
    if (!date || enteredAmount <= 0) { setError("Enter a payment date and an amount greater than zero."); return; }
    if (numbering.mode === "manual" && !manualPaymentNo.trim()) { setError("Enter a payment number or switch numbering to automatic."); return; }
    if (enteredAmount > selectedBalance + 0.005) { setError(`Payment cannot exceed the outstanding balance of ${money(selectedBalance)}.`); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      console.log("Receipt RPC parameters:", {
  companyId: company.id,
  invoiceId: selectedInvoice?.id,
  invoiceCustomerId: selectedInvoice?.customer_id,
  paymentAmount: enteredAmount,
});
      const { data, error: rpcError } = await supabase.rpc("record_customer_receipt", {
        p_company_id: company.id,
        p_party_id: selectedInvoice.customer_id,
        p_payment_date: date,
        p_amount: enteredAmount,
        p_method: method,
        p_reference_no: reference.trim() || null,
        p_notes: notes.trim() || null,
        p_auto_allocate_oldest_first: false,
        p_allocations: [{ target_id: selectedInvoice.id, amount: enteredAmount }],
        p_payment_no: numbering.mode === "manual" ? manualPaymentNo.trim() : null,
      });
      if (rpcError) throw rpcError;
      const result = Array.isArray(data) ? data[0] : data;
      setSelectedInvoiceId(null);
      setNotice(`Payment ${result?.payment_no ?? ""} posted for ${selectedInvoice.invoice_no}. You can generate the receipt below.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to record payment."); }
    finally { setSaving(false); }
  }

  async function printReceipt(payment: Payment) {
    const customer = parties.find(p => p.id === payment.party_id);
    const customerName = customer?.name ?? "Customer";
    const customerAddress = addressLines(customer?.address);
    const paymentAllocations = allocations.filter(a => a.payment_id === payment.id);
    const linkedRows = paymentAllocations.map(a => {
      const invoice = invoices.find(i => i.id === a.target_id);
      const previousPaid = allocations
        .filter(other => other.target_id === a.target_id && other.payment_id !== payment.id)
        .reduce((sum, other) => sum + (payments.find(p => p.id === other.payment_id)?.status === "posted" ? Number(other.amount) : 0), 0);
      const applied = Number(a.amount);
      const invoiceTotal = Number(invoice?.total_amount ?? 0);
      const balance = Math.max(0, invoiceTotal - previousPaid - applied);
      return {
        invoiceNo: invoice?.invoice_no ?? "Invoice",
        invoiceDate: invoice?.invoice_date ? fmtDate(invoice.invoice_date) : "—",
        invoiceTotal, previousPaid, applied, balance,
      };
    });
    const allocatedTotal = paymentAllocations.reduce((sum, a) => sum + Number(a.amount), 0);
    const unallocated = Math.max(0, Number(payment.amount) - allocatedTotal);
    const profile = companyProfile ?? {};
    const companyName = asText(profile.legal_name) || asText(profile.name) || company?.name || "Company";
    const companyAddress = [
      ...addressLines(profile.registered_address),
      asText(profile.state),
      asText(profile.country),
    ].filter((v, i, arr) => v && arr.indexOf(v) === i);
    const companyPhone = asText(profile.phone);
    const companyEmail = asText(profile.email);
    const companyWebsite = asText(profile.website);
    const companyGstin = asText(profile.gstin);
    const companyPan = asText(profile.pan);
    const logoUrl = asText(profile.logo_url);
    const bankName = asText(profile.bank_name);
    const bankBranch = asText(profile.bank_branch);
    const bankAccount = asText(profile.bank_account_number);
    const bankIfsc = asText(profile.bank_ifsc);
    const bankHolder = asText(profile.bank_account_name);
    const showBank = profile.show_bank_details_on_invoice !== false;
    const signatory = asText(profile.authorised_signatory);
    const signatoryRole = asText(profile.signatory_designation);
    const footerNote = asText(profile.document_footer);
    const addressHtml = (items: string[]) => items.map(x => `<span>${escapeHtml(x)}</span>`).join("");
    const allocationsHtml = linkedRows.length
      ? linkedRows.map(row => `<tr>
          <td><strong>${escapeHtml(row.invoiceNo)}</strong><small>${escapeHtml(row.invoiceDate)}</small></td>
          <td class="num">${escapeHtml(money(row.invoiceTotal))}</td>
          <td class="num">${escapeHtml(money(row.previousPaid))}</td>
          <td class="num applied">${escapeHtml(money(row.applied))}</td>
          <td class="num">${escapeHtml(money(row.balance))}</td>
        </tr>`).join("")
      : `<tr><td colspan="5" class="empty-row">No invoice allocation — customer advance / unallocated receipt</td></tr>`;
    const methodLabel = displayMethod(payment.method);
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment Receipt ${escapeHtml(payment.payment_no)}</title>
<style>
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
html,body{margin:0;padding:0;background:#edf3f4;color:#10283d;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.42}
.sheet{width:210mm;min-height:297mm;margin:18px auto;background:#fff;position:relative;overflow:hidden;box-shadow:0 10px 38px rgba(16,40,61,.16)}
.top-accent{height:3mm;background:linear-gradient(90deg,#087f83 0%,#22a5a3 58%,#8c5aa6 100%)}
.inner{padding:7mm 9mm 6mm;position:relative}
.masthead{display:grid;grid-template-columns:minmax(0,54fr) minmax(0,46fr);align-items:center;column-gap:0;padding:3mm 0 4mm;border-bottom:1px solid #c9d9df;min-height:35mm;background:linear-gradient(105deg,#fff 0%,#f2f9fa 68%,#e9f4f6 100%);position:relative}
.brand{display:flex;align-items:center;gap:5mm;min-width:0}
.logo{width:23mm;height:23mm;object-fit:contain;border:0;border-radius:0;padding:0;background:transparent}
.brand-placeholder{width:23mm;height:23mm;border-radius:5mm;background:#e5f4f3;color:#087f83;display:grid;place-items:center;font-size:26px;font-weight:800}
.company{border-left:1px solid #a9c0c8;padding-left:4mm;min-width:0}
.company h1{font-size:17px;line-height:1.2;margin:0 0 4px;color:#10283d;letter-spacing:-.3px;font-weight:800}
.company .sub{font-size:10px;color:#476273;letter-spacing:.5px;font-weight:700;text-transform:none}
.company .details{margin-top:2mm;color:#172d40;font-size:9px;line-height:1.3;display:flex;flex-direction:column;gap:1.2mm}
.company .details span{display:block}\n.company-detail{display:flex;align-items:flex-start;gap:2mm}\n.company-detail svg{width:3.5mm;height:3.5mm;flex:0 0 3.5mm;color:#087f83;margin-top:.2mm}
.receipt-tag{display:none}
.receipt-header{display:flex;justify-content:flex-end;align-items:center;gap:2.5mm;text-align:right;min-width:0;width:100%;overflow:visible}
.receipt-heading{display:flex;align-items:center;justify-content:flex-end;gap:1.8mm;text-align:right;flex:1 1 auto;min-width:0;white-space:nowrap}
.receipt-symbol{width:9mm;height:9mm;flex:0 0 9mm;border:1.4px solid #087f83;border-radius:2.5mm;color:#087f83;display:grid;place-items:center;background:#effafa;padding:1.8mm}
.receipt-heading h2{font-size:17px;line-height:1.1;margin:0;color:#102e48;letter-spacing:-.35px;white-space:nowrap}
.receipt-heading p{font-size:8px;line-height:1.2;color:#314a60;margin:2px 0 0;white-space:normal}
.receipt-number{background:linear-gradient(135deg,#e5f6f4,#d8f0ef);border-radius:3mm;padding:2.2mm 2.5mm;text-align:center;width:31mm;min-width:31mm;max-width:31mm;color:#102e48;flex:0 0 31mm}
.receipt-number span{display:block;font-size:7px;line-height:1.25;white-space:nowrap}.receipt-number strong{display:block;font-size:14px;line-height:1.3;white-space:nowrap;letter-spacing:.1px}
.section{margin-top:4mm}
.section-title{display:flex;align-items:center;gap:3mm;margin:0;padding:2.6mm 4mm;background:linear-gradient(90deg,#e6f2f6,#e0f3f1);border-radius:3mm 3mm 0 0;color:#075367;font-size:14px;font-weight:800;letter-spacing:0;text-transform:none}
.section-title:before{content:"";width:5mm;height:5mm;border:1.5px solid #087f83;border-radius:1.3mm;display:inline-block;flex:none}
.section-title:after{display:none}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:5mm}
.party-card{border:1px solid #c9dfe6;border-radius:0 0 3mm 3mm;padding:4mm 5mm;background:#fff;min-height:35mm}
.party-card .label{font-size:10px;color:#557080;text-transform:uppercase;letter-spacing:.7px;font-weight:800;margin-bottom:2mm}
.party-card .name{font-size:17px;font-weight:800;color:#10283d;margin-bottom:2mm}
.party-card .line{display:block;color:#172d40;font-size:12px;line-height:1.45}
.party-card .tax{margin-top:2mm;color:#173c4d;font-size:11px;font-weight:700}
.payment-band{display:grid;grid-template-columns:repeat(2,1fr);gap:0;border:1px solid #c9e0df;border-radius:0 0 3mm 3mm;overflow:hidden}
.payment-cell{padding:2.5mm 4mm;background:#fff;border-bottom:1px solid #d9e3e6;min-height:12mm}
.payment-cell:nth-child(odd){border-right:1px solid #d9e3e6}
.payment-cell .label{display:inline-block;min-width:42mm;font-size:11px;color:#21394b;font-weight:700;margin:0}
.payment-cell .value{display:inline;font-size:12px;color:#172d40;font-weight:600;overflow-wrap:anywhere}
.allocation{border:1px solid #cbdfe5;border-radius:0 0 3mm 3mm;overflow:hidden}
table{width:100%;border-collapse:collapse}
.allocation th{background:#f1f6f8;color:#31475e;text-align:left;padding:3mm 3mm;font-size:10px;font-weight:800;white-space:nowrap}
.allocation td{padding:3mm 3mm;border-bottom:1px solid #dce5e8;color:#172d40;font-size:12px}
.allocation tr:last-child td{border-bottom:0}.allocation td small{display:block;color:#687f8d;font-size:10px;margin-top:1mm}
.num{text-align:right;white-space:nowrap}.applied{color:#087f83!important;font-weight:800}.empty-row{text-align:center;color:#84969c!important;padding:5mm!important}
.summary-wrap{display:grid;grid-template-columns:1.05fr 1.95fr;gap:5mm;align-items:stretch;background:linear-gradient(100deg,#e6f4ec,#eef8f7);border-radius:5mm;padding:4mm;margin-top:5mm}
.words{background:transparent;border:0;border-right:1px solid #b9d0d0;border-radius:0;padding:2mm 4mm}
.words .label,.totals .label{color:#172d40;font-size:13px;font-weight:700;text-transform:none;letter-spacing:0}
.words p{margin:2mm 0 0;color:#172d40;font-size:15px;font-weight:600;line-height:1.4}
.totals{border:0;border-radius:0;padding:2mm 3mm;background:transparent}
.total-row{display:flex;justify-content:space-between;gap:12px;color:#263f50;font-size:11px;padding:1mm 0}
.total-row strong{color:#172d40}.total-row.grand{border-top:1px solid #b9d0d0;margin-top:2mm;padding-top:2mm;color:#10283d;font-size:13px;font-weight:800}
.total-row.grand strong{font-size:23px;color:#087f83;letter-spacing:-.5px}
.notes{padding:4mm 5mm;border:1px solid #d1dfe4;background:#fff;border-radius:3mm;color:#263f50;font-size:12px;min-height:22mm}
.notes strong{display:block;color:#10283d;margin-bottom:2mm;font-size:12px}
.bank{display:grid;grid-template-columns:1fr 1fr;gap:3mm 5mm;padding:4mm 5mm;border:1px solid #cbdfe5;border-radius:0 0 3mm 3mm;background:#fff}
.bank-item{font-size:10px;color:#627b87}.bank-item strong{display:block;color:#203d4d;margin-top:1mm;font-size:12px}
.sign-row{display:flex;justify-content:space-between;align-items:center;gap:8mm;margin-top:5mm;min-height:26mm}
.thanks{color:#10283d;font-size:15px;font-weight:800}.thanks small{display:block;margin-top:2mm;color:#526a78;font-size:11px;font-weight:400;max-width:95mm}
.signature{text-align:center;min-width:42mm}.signature .sign-name{font-weight:800;color:#203d4d;font-size:12px}.signature .sign-role{color:#657d88;font-size:10px;margin-top:1mm}.signature .sign-line{border-top:1px solid #8da5ad;margin-top:8mm;padding-top:2mm;color:#344e5d;font-size:10px}
.footer{border-top:0;margin-top:4mm;padding:5mm 2mm 1mm;display:flex;justify-content:space-between;align-items:center;gap:5mm;color:#526a78;font-size:10px;background:linear-gradient(180deg,#f4faf9,#eaf5f5);border-radius:12mm 12mm 0 0;min-height:20mm}
.footer strong{color:#17394b;font-size:11px}
.no-print{display:block}
@page{size:A4 portrait;margin:0}
@media print{
  @page{size:A4 portrait;margin:0}
  html,body{width:210mm;height:297mm;min-height:297mm;margin:0!important;padding:0!important;background:#fff!important;overflow:hidden}
  body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  .sheet{width:210mm;height:297mm;min-height:297mm;margin:0!important;box-shadow:none;overflow:hidden;zoom:1;position:relative}
  .top-accent{height:3mm}
  .inner{height:294mm;padding:6mm 8mm 5mm;display:flex;flex-direction:column}
  .masthead{grid-template-columns:minmax(0,54fr) minmax(0,46fr);column-gap:0;min-height:28mm;padding:2mm 0 3mm;flex:none}
  .logo,.brand-placeholder{width:18mm;height:18mm;flex:0 0 18mm}
  .brand{gap:4mm}
  .company{padding-left:4mm}
  .company h1{font-size:16px;margin-bottom:2px}
  .company .sub{font-size:9px}
  .company .details{font-size:8px;line-height:1.25;margin-top:1.5mm;gap:1mm}\n  .company-detail{gap:1.5mm}\n  .company-detail svg{width:3mm;height:3mm;flex-basis:3mm}
  
  .receipt-header{justify-content:flex-end;gap:2.5mm;width:100%;min-width:0}
  .receipt-heading{flex:1 1 auto;min-width:0;white-space:nowrap;gap:1.8mm}
  .receipt-symbol{width:9mm;height:9mm;flex:0 0 9mm;padding:1.8mm}
  .receipt-heading h2{font-size:17px;white-space:nowrap}
  .receipt-heading p{font-size:8px;margin-top:2px}
  .receipt-number{width:31mm;min-width:31mm;max-width:31mm;flex:0 0 31mm;padding:2.2mm 2.5mm}
  .receipt-number span{font-size:7px}
  .receipt-number strong{font-size:14px;white-space:nowrap}
  .section{margin-top:3mm;break-inside:avoid;page-break-inside:avoid;flex:none}
  .section-title{padding:2.2mm 3.5mm;font-size:12px;gap:2.5mm}
  .section-title:before{width:4.2mm;height:4.2mm}
  .parties{gap:4mm}
  .party-card{min-height:31mm;padding:3mm 4mm}
  .party-card .label{font-size:9px;margin-bottom:1.4mm}
  .party-card .name{font-size:15px;margin-bottom:1.4mm}
  .party-card .line{font-size:10px;line-height:1.35}
  .party-card .tax{font-size:9px;margin-top:1.4mm}
  .payment-cell{padding:2mm 3mm;min-height:10mm}
  .payment-cell .label{min-width:39mm;font-size:9px}
  .payment-cell .value{font-size:10px}
  .allocation th{padding:2.2mm 2.5mm;font-size:9px}
  .allocation td{padding:2.3mm 2.5mm;font-size:10px}
  .allocation td small{font-size:8.5px;margin-top:.5mm}
  .summary-wrap{gap:4mm;padding:3mm;margin-top:3mm;break-inside:avoid;page-break-inside:avoid}
  .words{padding:1.5mm 3mm}
  .words .label,.totals .label{font-size:11px}
  .words p{font-size:13px;line-height:1.3;margin-top:1.5mm}
  .totals{padding:1.5mm 2.5mm}
  .total-row{font-size:9px;padding:.7mm 0}
  .total-row.grand{font-size:11px;margin-top:1.2mm;padding-top:1.2mm}
  .total-row.grand strong{font-size:20px}
  .notes{padding:3mm 4mm;min-height:16mm;font-size:10px}
  .notes strong{font-size:10px;margin-bottom:1.2mm}
  .bank{gap:2mm 4mm;padding:3mm 4mm}
  .bank-item{font-size:9px}
  .bank-item strong{font-size:10px;margin-top:.7mm}
  .sign-row{margin-top:3mm;min-height:20mm;gap:5mm;break-inside:avoid;page-break-inside:avoid;flex:none}
  .thanks{font-size:13px}
  .thanks small{font-size:9px;margin-top:1.5mm}
  .signature{min-width:38mm}
  .signature .sign-name{font-size:10px}
  .signature .sign-role,.signature .sign-line{font-size:9px}
  .signature .sign-line{margin-top:5mm;padding-top:1.5mm}
  .footer{margin-top:auto;padding:4mm 2mm 1mm;min-height:17mm;font-size:9px;flex:none}
  .footer strong{font-size:10px}
  .no-print{display:none!important}
}

@media screen and (max-width:800px){.sheet{width:100%;min-height:0;margin:0}.inner{padding:20px}.masthead{grid-template-columns:1fr;align-items:start}.receipt-header{justify-content:flex-end}.parties,.summary-wrap{grid-template-columns:1fr}.payment-band{grid-template-columns:1fr}.payment-cell:nth-child(odd){border-right:0}.words{border-right:0;border-bottom:1px solid #b9d0d0}.allocation{overflow-x:auto}.allocation table{min-width:650px}.sign-row{align-items:flex-start;flex-direction:column}.footer{flex-direction:column;align-items:flex-start}}
</style></head><body>
<div class="sheet"><div class="top-accent"></div><main class="inner">
<header class="masthead">
<div class="brand">
${logoUrl ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="Company logo">` : `<div class="brand-placeholder">${escapeHtml(companyName.slice(0,1).toUpperCase())}</div>`}
<div class="company">
<h1>${escapeHtml(companyName)}</h1>
<div class="sub">Payment acknowledgement</div>
<div class="details">
${companyAddress.length ? `<div class="company-detail"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg><span>${companyAddress.map(escapeHtml).join(", ")}</span></div>` : ""}
${companyPhone ? `<div class="company-detail"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.84.58 2.8.7A2 2 0 0 1 22 16.92Z"/></svg><span>${escapeHtml(companyPhone)}</span></div>` : ""}
${companyEmail ? `<div class="company-detail"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg><span>${escapeHtml(companyEmail)}</span></div>` : ""}
${companyWebsite ? `<div class="company-detail"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20"/><path d="M12 2a15 15 0 0 0 0 20"/></svg><span>${escapeHtml(companyWebsite)}</span></div>` : ""}
${companyGstin ? `<div class="company-detail"><span>GSTIN: ${escapeHtml(companyGstin)}</span></div>` : ""}
${companyPan ? `<div class="company-detail"><span>PAN: ${escapeHtml(companyPan)}</span></div>` : ""}
</div>
</div>
</div>
<div class="receipt-header">
<div class="receipt-heading">
  <div class="receipt-symbol" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="5" width="18" height="15" rx="2.5"/>
      <path d="M3 9h18"/>
      <path d="M7 3h10"/>
      <path d="M16 14h2"/>
    </svg>
  </div>
  <div><h2>Payment Receipt</h2><p>Customer payment acknowledgement</p></div>
</div>
<div class="receipt-number"><span>Receipt No.</span><strong>${escapeHtml(payment.payment_no)}</strong><span>${escapeHtml(fmtDate(payment.payment_date))} · ${escapeHtml(payment.status)}</span></div>
</div>
</header>
<section class="section"><h3 class="section-title">Receipt parties</h3><div class="parties">
<div class="party-card"><div class="label">Received from</div><div class="name">${escapeHtml(customerName)}</div>${addressHtml(customerAddress).replaceAll("<span>", '<span class="line">')}${customer?.phone ? `<span class="line">Phone: ${escapeHtml(customer.phone)}</span>` : ""}${customer?.email ? `<span class="line">Email: ${escapeHtml(customer.email)}</span>` : ""}${customer?.tax_id ? `<div class="tax">GSTIN / Tax ID: ${escapeHtml(customer.tax_id)}</div>` : ""}</div>
<div class="party-card"><div class="label">Payment recorded by</div><div class="name">${escapeHtml(signatory || "Accounts department")}</div><span class="line">${escapeHtml(signatoryRole || "Authorised representative")}</span><span class="line">Receipt status: ${escapeHtml(payment.status)}</span><span class="line">Recorded on: ${escapeHtml(payment.posted_at
    ? `${fmtDate(payment.posted_at)} ${new Date(payment.posted_at).toLocaleTimeString("en-IN")}`
    : fmtDate(payment.payment_date))}</span></div>
</div></section>
<section class="section"><h3 class="section-title">Payment information</h3><div class="payment-band">
<div class="payment-cell"><div class="label">Payment mode</div><div class="value">${escapeHtml(methodLabel)}</div></div>
<div class="payment-cell"><div class="label">Transaction / UTR reference</div><div class="value">${escapeHtml(payment.reference_no || "Not provided")}</div></div>
<div class="payment-cell"><div class="label">Receipt date</div><div class="value">${escapeHtml(fmtDate(payment.payment_date))}</div></div>
</div></section>
<section class="section"><h3 class="section-title">Invoice allocation details</h3><div class="allocation"><table><thead><tr><th>Invoice / date</th><th class="num">Invoice value</th><th class="num">Previously paid</th><th class="num">This receipt</th><th class="num">Balance due</th></tr></thead><tbody>${allocationsHtml}</tbody></table></div></section>
<section class="section summary-wrap"><div class="words"><div class="label">Amount in words</div><p>${escapeHtml(amountInWordsIndian(Number(payment.amount)))}</p></div><div class="totals"><div class="label">Receipt summary</div><div class="total-row"><span>Amount received</span><strong>${escapeHtml(money(Number(payment.amount)))}</strong></div><div class="total-row"><span>Allocated to invoices</span><strong>${escapeHtml(money(allocatedTotal))}</strong></div><div class="total-row"><span>Unallocated customer credit</span><strong>${escapeHtml(money(unallocated))}</strong></div><div class="total-row grand"><span>Total receipt</span><strong>${escapeHtml(money(Number(payment.amount)))}</strong></div></div></section>
${payment.notes ? `<section class="section"><div class="notes"><strong>Remarks / payment notes</strong>${escapeHtml(payment.notes)}</div></section>` : ""}
${showBank && (bankName || bankAccount || bankIfsc || bankHolder) ? `<section class="section"><h3 class="section-title">Bank details</h3><div class="bank">${bankHolder ? `<div class="bank-item">Account name<strong>${escapeHtml(bankHolder)}</strong></div>` : ""}${bankName ? `<div class="bank-item">Bank<strong>${escapeHtml(bankName)}${bankBranch ? ` · ${escapeHtml(bankBranch)}` : ""}</strong></div>` : ""}${bankAccount ? `<div class="bank-item">Account number<strong>${escapeHtml(bankAccount)}</strong></div>` : ""}${bankIfsc ? `<div class="bank-item">IFSC<strong>${escapeHtml(bankIfsc)}</strong></div>` : ""}</div></section>` : ""}
<div class="sign-row"><div class="thanks">Thank you for your payment.<small>This receipt is an acknowledgement of the payment recorded against the above account.</small></div><div class="signature">${signatory ? `<div class="sign-name">${escapeHtml(signatory)}</div><div class="sign-role">${escapeHtml(signatoryRole)}</div>` : `<div class="sign-name">${escapeHtml(companyName)}</div>`}<div class="sign-line">Authorised signatory</div></div></div>
<footer class="footer"><span>${footerNote ? escapeHtml(footerNote) : "This is a computer-generated payment receipt."}</span><strong>${escapeHtml(companyName)}</strong></footer>
</main></div><div class="no-print" style="text-align:center;padding:18px"><button onclick="window.print()" style="background:#0b7775;color:white;border:0;border-radius:8px;padding:11px 20px;font-weight:700;cursor:pointer">Print / Save as PDF</button></div>
<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),350));</script></body></html>`;
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) { setError("Your browser blocked the receipt window. Allow pop-ups and try again."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  const postedPayments = payments.filter(p => p.status === "posted");
  const totalReceived = postedPayments.reduce((s, p) => s + Number(p.amount), 0);
  const totalOutstanding = invoices.reduce((s, i) => s + openBalance(i), 0);

  if (selectedInvoice) return <div className="page-container payments-page">
    <div className="page-header"><div><h1>Record payment</h1><p>Record a full or partial payment for invoice {selectedInvoice.invoice_no}.</p></div></div>
    <button className="btn btn-secondary" onClick={cancelPayment}><ArrowLeft size={16}/> Back to invoices</button>
    {error && <div className="alert alert-error">{error}</div>}
    <section className="content-card" style={{ maxWidth: 900, marginTop: 18 }}>
      <div className="content-card-header"><h2>Invoice details</h2><span className={`status-badge ${selectedBalance <= 0.005 ? "status-posted" : "status-draft"}`}>{selectedBalance <= 0.005 ? "Paid" : (paidByInvoice[selectedInvoice.id] ?? 0) > 0 ? "Partially paid" : "Unpaid"}</span></div>
      <div className="stats-grid"><div className="stat-card"><span>Invoice</span><strong>{selectedInvoice.invoice_no}</strong></div><div className="stat-card"><span>Customer</span><strong>{selectedCustomer?.name ?? "Customer"}</strong></div><div className="stat-card"><span>Outstanding</span><strong>{money(selectedBalance)}</strong></div></div>
      <div className="form-grid" style={{ marginTop: 24 }}>
        <div className="payment-number-field">
          <label htmlFor="payment-number">Payment No.</label>
          <div className="payment-number-input">
            <input
              id="payment-number"
              value={numbering.mode === "automatic"
                ? `${numbering.prefix}${String(numbering.nextNumber).padStart(numbering.digits, "0")}`
                : manualPaymentNo}
              onChange={e => setManualPaymentNo(e.target.value)}
              placeholder="Enter payment number"
              readOnly={numbering.mode === "automatic"}
              required={numbering.mode === "manual"}
            />
            <button type="button" className="btn btn-secondary payment-number-settings" title="Payment numbering settings" aria-label="Payment numbering settings"
              onClick={() => { setNumberingDraft({ ...numbering }); setNumberingOpen(v => !v); }}>
              <Settings2 size={18}/>
            </button>
          </div>
          {numberingOpen && <div className="payment-number-popover">
            <div className="payment-number-popover-header"><strong>Payment numbering settings</strong><button type="button" className="payment-number-close" onClick={() => setNumberingOpen(false)} aria-label="Close numbering settings"><X size={16}/></button></div>
            <div className="payment-number-mode-row">
              <label className={numberingDraft.mode === "manual" ? "selected" : ""}>
                <input type="radio" name="payment-number-mode" checked={numberingDraft.mode === "manual"} onChange={() => setNumberingDraft(v => ({ ...v, mode: "manual" }))}/>
                <span>Manual</span><small>Enter payment number yourself</small>
              </label>
              <label className={numberingDraft.mode === "automatic" ? "selected" : ""}>
                <input type="radio" name="payment-number-mode" checked={numberingDraft.mode === "automatic"} onChange={() => setNumberingDraft(v => ({ ...v, mode: "automatic" }))}/>
                <span>Automatic</span><small>Generate sequence</small>
              </label>
            </div>
            {numberingDraft.mode === "automatic" && <>
              <label className="payment-number-setting">Prefix<input value={numberingDraft.prefix} maxLength={20} onChange={e => setNumberingDraft(v => ({ ...v, prefix: e.target.value }))}/></label>
              <label className="payment-number-setting">Next number<input type="number" min="1" value={numberingDraft.nextNumber} onChange={e => setNumberingDraft(v => ({ ...v, nextNumber: Math.max(1, Number(e.target.value) || 1) }))}/></label>
              <label className="payment-number-setting">Number of digits<select value={numberingDraft.digits} onChange={e => setNumberingDraft(v => ({ ...v, digits: Number(e.target.value) }))}>
                <option value={2}>2 digits — 01</option><option value={3}>3 digits — 001</option><option value={4}>4 digits — 0001</option><option value={5}>5 digits — 00001</option><option value={6}>6 digits — 000001</option>
              </select></label>
              <p className="payment-number-preview">Preview: <strong>{numberingDraft.prefix}{String(numberingDraft.nextNumber).padStart(numberingDraft.digits, "0")}</strong></p>
            </>}
            <div className="payment-number-actions"><button type="button" className="btn btn-secondary" onClick={() => setNumberingOpen(false)}>Cancel</button><button type="button" className="btn btn-primary" onClick={() => void saveNumberingSettings()}>Apply</button></div>
          </div>}
        </div>
        <label>Payment date<input type="date" value={date} onChange={e => setDate(e.target.value)} required /></label>
        <label>Payment amount (₹)<input type="number" min="0.01" max={selectedBalance} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required /><small>Maximum payable now: {money(selectedBalance)}</small></label>
        <label>Payment method<select value={method} onChange={e => setMethod(e.target.value)}>{["cash", "upi", "bank_transfer", "cheque", "card", "other"].map(m => <option key={m} value={m}>{displayMethod(m)}</option>)}</select></label>
        <label>Reference number<input value={reference} onChange={e => setReference(e.target.value)} placeholder="UTR / cheque no. / transaction ID" /></label>
        <label style={{ gridColumn: "1 / -1" }}>Notes<input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional payment notes" /></label>
      </div>
      <div className="allocation-panel" style={{ marginTop: 20 }}><strong>Allocation</strong><p>This payment will be applied only to {selectedInvoice.invoice_no}. The receipt will be posted immediately.</p><div className="allocation-total">Invoice outstanding after payment: {money(Math.max(0, selectedBalance - enteredAmount))}</div></div>
      <div className="modal-footer"><button className="btn btn-secondary" onClick={cancelPayment} disabled={saving}>Cancel</button><button className="btn btn-primary" onClick={() => void savePayment()} disabled={saving || enteredAmount <= 0 || enteredAmount > selectedBalance + 0.005}>{saving ? "Posting payment…" : "Post payment"}</button></div>
    </section>
  </div>;

  return <div className="page-container payments-page">
    <div className="page-header"><div><h1>Payments</h1></div><div className="page-actions"><button className="btn btn-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={16}/> Refresh</button></div></div>
    {error && <div className="alert alert-error">{error}</div>}{notice && <div className="alert alert-success">{notice}</div>}
    <div className="stats-grid"><div className="stat-card"><span>Posted receipts</span><strong>{postedPayments.length}</strong></div><div className="stat-card"><span>Total received</span><strong>{money(totalReceived)}</strong></div><div className="stat-card"><span>Invoice outstanding</span><strong>{money(totalOutstanding)}</strong></div></div>
    <section className="content-card"><div className="content-card-header"><h2><Wallet size={18}/> Outstanding invoices</h2><span>Issued invoices only</span></div>
      {loading ? <p className="empty-state">Loading invoices…</p> : invoices.length === 0 ? <p className="empty-state">No issued invoices to collect against.</p> : <div className="table-wrapper"><table className="data-table"><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Invoice total</th><th>Paid</th><th>Pending amount</th><th>Status</th><th>Actions</th></tr></thead><tbody>{invoicePageRows.map(i => { const paid = paidByInvoice[i.id] ?? 0; const outstanding = openBalance(i); const status = outstanding <= 0.005 ? "Paid" : paid > 0 ? "Partially paid" : "Unpaid"; return <tr key={i.id}><td><strong>{i.invoice_no}</strong></td><td>{fmtDate(i.invoice_date)}</td><td>{parties.find(x => x.id === i.customer_id)?.name ?? "Unknown customer"}</td><td>{money(Number(i.total_amount))}</td><td>{money(paid)}</td><td><strong>{money(outstanding)}</strong></td><td><span className={`status-badge ${status === "Paid" ? "status-posted" : status === "Unpaid" ? "status-draft" : "status-issued"}`}>{status}</span></td><td>{outstanding > 0.005 ? <button className="btn btn-primary" onClick={() => startPayment(i)}>Record payment</button> : <span className="muted">No balance due</span>}</td></tr>; })}</tbody></table></div>}
    <Pagination totalItems={invoices.length} currentPage={invoicePage} pageSize={PAGE_SIZE} onPageChange={setInvoicePage} loading={loading} itemLabel="invoices" />
    </section>
    <section className="content-card"><div className="content-card-header"><h2>Payment receipts</h2><span>{payments.length} records</span></div>{payments.length === 0 ? <p className="empty-state">No payment receipts yet. Select “Record payment” on an outstanding invoice to collect the first payment.</p> : <div className="table-wrapper"><table className="data-table"><thead><tr><th>Receipt no.</th><th>Date</th><th>Customer</th><th>Invoice(s)</th><th>Method</th><th>Amount</th><th>Status</th><th>Receipt</th></tr></thead><tbody>{receiptPageRows.map(p => { const invoiceNos = allocations.filter(a => a.payment_id === p.id).map(a => invoices.find(i => i.id === a.target_id)?.invoice_no).filter(Boolean); return <tr key={p.id}><td><strong>{p.payment_no}</strong></td><td>{fmtDate(p.payment_date)}</td><td>{parties.find(x => x.id === p.party_id)?.name ?? "Unknown customer"}</td><td>{invoiceNos.join(", ") || "Customer credit"}</td><td>{displayMethod(p.method)}</td><td>{money(Number(p.amount))}</td><td><span className={`status-badge status-${p.status}`}>{p.status}</span></td><td><button className="btn btn-secondary" onClick={() => void printReceipt(p)} disabled={p.status !== "posted"}><Printer size={15}/> Generate receipt</button></td></tr>; })}</tbody></table></div>}<Pagination totalItems={payments.length} currentPage={receiptPage} pageSize={PAGE_SIZE} onPageChange={setReceiptPage} loading={loading} itemLabel="receipts" /></section>
  </div>;
}
