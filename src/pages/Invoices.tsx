import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Printer, X, Settings2, Send, Pencil, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";
import Pagination from "../components/Pagination"
import { formatDate } from "../lib/dateUtils";

type Delivery = { id: string; document_no: string; customer_id: string; delivery_date: string; status: string; movement_type: string; delivery_state?: string | null; delivery_state_code?: string | null; };
type Party = { id: string; name: string; party_type?: string; tax_id?: string | null; phone?: string | null; email?: string | null; address?: Record<string, unknown> | null; };
type CompanyProfile = {
  name?: string | null; legal_name?: string | null; logo_url?: string | null; registered_address?: string | null;
  billing_address?: string | null; factory_address?: string | null; phone?: string | null; alternate_phone?: string | null;
  email?: string | null; website?: string | null; gst_registered?: boolean | null; gstin?: string | null;
  state?: string | null; state_code?: string | null; pan?: string | null; bank_account_name?: string | null;
  bank_name?: string | null; bank_branch?: string | null; bank_account_number?: string | null; bank_ifsc?: string | null;
  upi_id?: string | null; show_bank_details_on_invoice?: boolean | null; payment_terms?: string | null;
  authorised_signatory?: string | null; signatory_designation?: string | null; document_footer?: string | null;
};
type Invoice = { id: string; invoice_no: string; customer_id: string; invoice_date: string; status: string; subtotal: number; tax_rate: number; tax_amount: number; total_amount: number; notes: string | null; created_at: string; cgst_amount?: number | null; sgst_amount?: number | null; igst_amount?: number | null; place_of_supply_state?: string | null; place_of_supply_state_code?: string | null; };
type Item = { id: string; sku: string; name: string; notes?: string | null; unit_id?: string | null; hsn_sac_code?: string | null; default_gst_rate?: number | null; };
type Unit = { id: string; code: string; name: string; precision_digits?: number; };
type InvoiceLineDraft = {
  key: string; item_id: string | null; delivery_id: string | null; description: string; hsn_sac_code: string;
  quantity: string; unit_id: string; unit_name: string; unit_rate: string; gst_rate: string; line_type: "delivery" | "manual";
};
type InvoiceLineSaved = {
  description: string; item_description?: string | null; hsn_sac_code?: string | null; quantity: number;
  unit_rate: number; amount: number; taxable_amount?: number | null; gst_rate?: number | null;
  cgst_amount?: number | null; sgst_amount?: number | null; igst_amount?: number | null; unit_name_snapshot?: string | null;
};
type InvoiceNumberSettings = { mode: "manual" | "automatic"; prefix: string; nextNumber: number; digits: number; };
const defaultNumberSettings: InvoiceNumberSettings = { mode: "automatic", prefix: "JWI-", nextNumber: 1, digits: 5 };
const today = () => new Date().toISOString().slice(0, 10);
const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number.isFinite(n) ? n : 0);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const field = (obj: Record<string, unknown> | null | undefined, ...keys: string[]) => {
  for (const key of keys) { const value = obj?.[key]; if (typeof value === "string" && value.trim()) return value.trim(); }
  return "";
};
const amountInWords = (value: number) => {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const under = (n: number): string => { const a: string[] = []; if (n >= 100) { a.push(`${ones[Math.floor(n / 100)]} Hundred`); n %= 100; } if (n >= 20) { a.push(tens[Math.floor(n / 10)]); n %= 10; } if (n > 0) a.push(ones[n]); return a.join(" "); };
  let n = Math.floor(Math.abs(value)); if (!Number.isFinite(n)) return "Amount not available"; if (!n) return "Rupees Zero Only";
  const parts: string[] = []; for (const [size, label] of [[10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"]] as [number, string][]) { if (n >= size) { const q = Math.floor(n / size); parts.push(`${under(q)} ${label}`); n %= size; } }
  if (n) parts.push(under(n)); return `Rupees ${parts.join(" ")} Only`;
};
const blankLine = (lineType: "manual" | "delivery" = "manual"): InvoiceLineDraft => ({
  key: crypto.randomUUID(), item_id: null, delivery_id: null, description: "", hsn_sac_code: "",
  quantity: "1", unit_id: "", unit_name: "", unit_rate: "", gst_rate: "0", line_type: lineType,
});

export default function Invoices() {
  const { company } = useCompany();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalInvoiceCount, setTotalInvoiceCount] = useState(0);
  const PAGE_SIZE = 10;
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>({});
  const [billedDeliveryIds, setBilledDeliveryIds] = useState<string[]>([]);
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<string[]>([]);
  const [lines, setLines] = useState<InvoiceLineDraft[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [placeState, setPlaceState] = useState("");
  const [placeStateCode, setPlaceStateCode] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [manualInvoiceNo, setManualInvoiceNo] = useState("");
  const [numberSettings, setNumberSettings] = useState<InvoiceNumberSettings>(defaultNumberSettings);
  const [numberSettingsOpen, setNumberSettingsOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [issuingId, setIssuingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!company?.id) { setLoading(false); return; }
    setLoading(true); setError("");
    const [del, par, profile, links, sequence, itemResult, unitResult] = await Promise.all([
      supabase.from("deliveries").select("id,document_no,customer_id,delivery_date,status,movement_type,delivery_state,delivery_state_code").eq("company_id", company.id).eq("status", "posted").eq("movement_type", "fabric").order("delivery_date"),
      supabase.from("parties").select("id,name,party_type,tax_id,phone,email,address").eq("company_id", company.id).order("name"),
      supabase.from("companies").select("*").eq("id", company.id).maybeSingle(),
      supabase.from("sales_invoice_deliveries").select("delivery_id").eq("company_id", company.id),
      supabase.from("document_sequences").select("mode,prefix,next_number,digits").eq("company_id", company.id).eq("document_type", "job_work_invoice").maybeSingle(),
      supabase.from("items").select("id,sku,name,notes,unit_id,hsn_sac_code,default_gst_rate").eq("company_id", company.id).eq("is_active", true).order("name"),
      supabase.from("units").select("id,code,name,precision_digits").eq("company_id", company.id).order("name"),
    ]);
    const failed = [del, par, links, sequence, itemResult, unitResult].find(r => r.error);
    if (failed?.error) setError(`Unable to load invoice data: ${failed.error.message}. Apply the hybrid GST invoice migration before using the updated invoice form.`);
    else {
      setParties((par.data ?? []) as Party[]);
      setCompanyProfile((profile.data ?? {}) as CompanyProfile); setBilledDeliveryIds((links.data ?? []).map((r: { delivery_id: string }) => r.delivery_id));
      setDeliveries((del.data ?? []) as Delivery[]); setItems((itemResult.data ?? []) as Item[]); setUnits((unitResult.data ?? []) as Unit[]);
      if (sequence.data) setNumberSettings({ mode: sequence.data.mode as InvoiceNumberSettings["mode"], prefix: sequence.data.prefix, nextNumber: Number(sequence.data.next_number), digits: Number(sequence.data.digits) });
      else setNumberSettings(defaultNumberSettings);
    }
    setLoading(false);
  }, [company?.id]);
  const loadInvoicePage = useCallback(async () => {
    if (!company?.id) return;
    setLoading(true);
    const from = (currentPage - 1) * PAGE_SIZE;
    const { data, count, error: invoiceError } = await supabase
      .from("sales_invoices")
      .select("*", { count: "exact" })
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (invoiceError) setError(`Unable to load invoices: ${invoiceError.message}`);
    else { setInvoices((data ?? []) as Invoice[]); setTotalInvoiceCount(count ?? 0); }
    setLoading(false);
  }, [company?.id, currentPage]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadInvoicePage(); }, [loadInvoicePage]);

  const pageRows = invoices;
  useEffect(() => { if (currentPage > Math.max(1, Math.ceil(totalInvoiceCount / PAGE_SIZE))) setCurrentPage(1); }, [totalInvoiceCount, currentPage]);

  const selectedDeliveries = useMemo(() => deliveries.filter(d => selectedDeliveryIds.includes(d.id)), [deliveries, selectedDeliveryIds]);
  const partyName = (id: string) => parties.find(p => p.id === id)?.name ?? "Unknown customer";
  const totals = useMemo(() => lines.reduce((acc, line) => {
    const taxable = round2(Math.max(0, Number(line.quantity) || 0) * Math.max(0, Number(line.unit_rate) || 0));
    const rate = Math.max(0, Number(line.gst_rate) || 0);
    const tax = round2(taxable * rate / 100);
    const intra = !!companyProfile.state_code && !!placeStateCode && companyProfile.state_code.trim() === placeStateCode.trim();
    const cgst = intra ? round2(tax / 2) : 0;
    const sgst = intra ? round2(tax - cgst) : 0;
    const igst = intra ? 0 : tax;
    acc.taxable += taxable; acc.cgst += cgst; acc.sgst += sgst; acc.igst += igst; acc.total += taxable + tax;
    return acc;
  }, { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 }), [lines, companyProfile.state_code, placeStateCode]);
  const taxTotal = round2(totals.cgst + totals.sgst + totals.igst);
  const intraState = !!companyProfile.state_code && !!placeStateCode && companyProfile.state_code.trim() === placeStateCode.trim();

  function resetCreate() {
    setSelectedDeliveryIds([]); setLines([]); setCustomerId(""); setPlaceState(""); setPlaceStateCode("");
    setInvoiceDate(today()); setNotes(""); setManualInvoiceNo(""); setNumberSettingsOpen(false);
  }
  function openCreate() { resetCreate(); setError(""); setNotice(""); setShowCreate(true); }

  async function toggleDelivery(delivery: Delivery) {
    const removing = selectedDeliveryIds.includes(delivery.id);
    if (removing) {
      setSelectedDeliveryIds(cur => cur.filter(id => id !== delivery.id));
      setLines(cur => cur.filter(line => line.delivery_id !== delivery.id));
      if (selectedDeliveryIds.length === 1 && !lines.some(line => line.delivery_id === null)) {
        setCustomerId(""); setPlaceState(""); setPlaceStateCode("");
      }
      return;
    }
    if (customerId && customerId !== delivery.customer_id) { setError("An invoice can contain deliveries for only one customer."); return; }
    const selectedCodes = selectedDeliveries.map(d => d.delivery_state_code).filter((code): code is string => !!code);
    if (delivery.delivery_state_code && selectedCodes.some(code => code !== delivery.delivery_state_code)) {
      setError("Selected DCs have different shipping state codes. Create separate invoices for different places of supply.");
      return;
    }
    setError("");
    setCustomerId(delivery.customer_id);
    setSelectedDeliveryIds(cur => [...cur, delivery.id]);
    const { data: deliveryLines, error: lineError } = await supabase.from("delivery_lines")
      .select("id,item_id,quantity,unit_price").eq("company_id", company?.id).eq("delivery_id", delivery.id);
    if (lineError) {
      setSelectedDeliveryIds(cur => cur.filter(id => id !== delivery.id));
      if (!selectedDeliveryIds.length) setCustomerId("");
      setError(`Unable to load ${delivery.document_no} items: ${lineError.message}`);
      return;
    }
    const source = deliveryLines ?? [];
    if (!source.length) {
      setSelectedDeliveryIds(cur => cur.filter(id => id !== delivery.id));
      if (!selectedDeliveryIds.length) setCustomerId("");
      setError(`${delivery.document_no} has no delivery lines to invoice.`);
      return;
    }
    const itemIds = [...new Set(source.map((l: any) => l.item_id).filter(Boolean))];
    const itemMap = new Map<string, Item>();
    if (itemIds.length) {
      const { data: itemData, error: itemError } = await supabase.from("items")
        .select("id,sku,name,notes,unit_id,hsn_sac_code,default_gst_rate").eq("company_id", company?.id).in("id", itemIds);
      if (itemError) {
        setSelectedDeliveryIds(cur => cur.filter(id => id !== delivery.id));
        if (!selectedDeliveryIds.length) setCustomerId("");
        setError(`Unable to load item descriptions: ${itemError.message}`);
        return;
      }
      (itemData ?? []).forEach((it: Item) => itemMap.set(it.id, it));
    }
    const added: InvoiceLineDraft[] = source.map((sourceLine: any) => {
      const item = itemMap.get(sourceLine.item_id);
      const unit = units.find(u => u.id === item?.unit_id);
      return {
        key: crypto.randomUUID(), item_id: item?.id ?? null, delivery_id: delivery.id,
        description: item ? `${item.name}${item.notes ? ` — ${item.notes}` : ""}` : "Item",
        hsn_sac_code: item?.hsn_sac_code ?? "", quantity: String(sourceLine.quantity ?? 0),
        unit_id: item?.unit_id ?? "", unit_name: unit?.name ?? unit?.code ?? "",
        unit_rate: String(sourceLine.unit_price ?? ""), gst_rate: String(item?.default_gst_rate ?? 0), line_type: "delivery",
      };
    });
    setLines(cur => [...cur, ...added]);
    const party = parties.find(p => p.id === delivery.customer_id);
    const address = party?.address ?? {};
    const state = field(address, "state", "shipping_state", "billing_state");
    const stateCode = field(address, "state_code", "stateCode", "shipping_state_code");
    setPlaceState(current => current || state || delivery.document_no);
    setPlaceStateCode(current => current || stateCode);
  }

  function chooseCustomer(id: string) {
    if (selectedDeliveryIds.length && selectedDeliveries.some(d => d.customer_id !== id)) { setError("Selected deliveries belong to a different customer."); return; }
    setCustomerId(id); const party = parties.find(p => p.id === id); const address = party?.address ?? {};
    const linkedDelivery = selectedDeliveries[0];
    setPlaceState(linkedDelivery?.delivery_state || field(address, "state", "shipping_state", "billing_state"));
    setPlaceStateCode(linkedDelivery?.delivery_state_code || field(address, "state_code", "stateCode", "shipping_state_code"));
  }
  function updateLine(key: string, patch: Partial<InvoiceLineDraft>) { setLines(cur => cur.map(line => line.key === key ? { ...line, ...patch } : line)); }
  function selectItem(line: InvoiceLineDraft, itemId: string) {
    if (!itemId) { updateLine(line.key, { item_id: null, description: "", hsn_sac_code: "", unit_id: "", unit_name: "", gst_rate: "0" }); return; }
    const item = items.find(i => i.id === itemId); if (!item) return;
    const unit = units.find(u => u.id === item.unit_id);
    updateLine(line.key, { item_id: item.id, description: `${item.name}${item.notes ? ` — ${item.notes}` : ""}`, hsn_sac_code: item.hsn_sac_code ?? "", unit_id: item.unit_id ?? "", unit_name: unit?.name ?? unit?.code ?? "", gst_rate: String(item.default_gst_rate ?? 0) });
  }

  async function createInvoice() {
    if (!company?.id) return;
    if (!customerId) { setError("Select a customer for this invoice."); return; }
    if (!lines.length) { setError("Add at least one invoice line."); return; }
    if (lines.some(l => !l.description.trim() || !(Number(l.quantity) > 0) || l.unit_rate.trim() === "" || !(Number(l.unit_rate) >= 0) || l.gst_rate.trim() === "" || !(Number(l.gst_rate) >= 0) || Number(l.gst_rate) > 100)) { setError("Every line needs a description, positive quantity, non-negative rate and GST between 0% and 100%."); return; }
    if (lines.some(l => Number(l.gst_rate) > 0) && (!/^\d{2}$/.test(companyProfile.state_code || "") || !/^\d{2}$/.test(placeStateCode))) { setError("Enter valid two-digit supplier and place-of-supply state codes before applying GST."); return; }
    if (selectedDeliveries.some(d => d.customer_id !== customerId)) { setError("All selected deliveries must belong to the selected customer."); return; }
    if (numberSettings.mode === "manual" && !manualInvoiceNo.trim()) { setError("Enter an invoice number because manual numbering is enabled."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      const invoiceNo = numberSettings.mode === "manual" ? manualInvoiceNo.trim() : `DRAFT-${crypto.randomUUID()}`;
      const { data: invoice, error: invError } = await supabase.from("sales_invoices").insert({
        company_id: company.id, invoice_no: invoiceNo, customer_id: customerId, invoice_date: invoiceDate,
        status: "draft", subtotal: round2(totals.taxable), tax_rate: 0, tax_amount: taxTotal,
        cgst_amount: round2(totals.cgst), sgst_amount: round2(totals.sgst), igst_amount: round2(totals.igst),
        total_amount: round2(totals.total), place_of_supply_state: placeState || null,
        place_of_supply_state_code: placeStateCode || null, notes: notes.trim() || null,
      }).select("*").single();
      if (invError) throw invError;
      const payload = lines.map(line => {
        const taxable = round2(Number(line.quantity) * Number(line.unit_rate));
        const rate = Number(line.gst_rate);
        const tax = round2(taxable * rate / 100);
        const cgst = intraState ? round2(tax / 2) : 0;
        const sgst = intraState ? round2(tax - cgst) : 0;
        const igst = intraState ? 0 : tax;
        return {
          company_id: company.id, invoice_id: invoice.id, delivery_id: line.delivery_id,
          description: line.description.trim(), item_description: line.description.trim(),
          item_id: line.item_id, unit_id: line.unit_id || null, unit_name_snapshot: line.unit_name || null,
          hsn_sac_code: line.hsn_sac_code.trim() || null, quantity: Number(line.quantity), unit_rate: Number(line.unit_rate),
          taxable_amount: taxable, gst_rate: rate, cgst_amount: cgst, sgst_amount: sgst, igst_amount: igst,
          amount: round2(taxable + cgst + sgst + igst), line_type: line.line_type,
        };
      });
      const { error: lineError } = await supabase.from("sales_invoice_lines").insert(payload);
      if (lineError) throw new Error(`Draft ${invoiceNo} was created but its lines failed to save: ${lineError.message}. Refresh and inspect the draft before retrying.`);
      if (selectedDeliveryIds.length) {
        const { error: linkError } = await supabase.from("sales_invoice_deliveries").insert(selectedDeliveryIds.map(delivery_id => ({ company_id: company.id, invoice_id: invoice.id, delivery_id })));
        if (linkError) throw new Error(`Draft ${invoiceNo} and lines were saved but DC links failed: ${linkError.message}. Refresh and inspect before retrying.`);
      }
      setNotice(`Draft invoice ${invoiceNo} created successfully.`); setShowCreate(false); resetCreate(); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create invoice."); }
    finally { setSaving(false); }
  }

  async function saveNumberSettings() {
    if (!company?.id) return;
    if (numberSettings.mode === "automatic" && !numberSettings.prefix.trim()) { setError("Enter a prefix for automatic invoice numbers."); return; }
    if (!Number.isInteger(numberSettings.nextNumber) || numberSettings.nextNumber < 1) { setError("Next invoice number must be positive."); return; }
    setSaving(true); setError("");
    const { error: saveError } = await supabase.from("document_sequences").upsert({
      company_id: company.id, document_type: "job_work_invoice", mode: numberSettings.mode,
      prefix: numberSettings.prefix.trim(), next_number: numberSettings.nextNumber, digits: numberSettings.digits,
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_id,document_type" });
    setSaving(false); if (saveError) { setError(`Unable to save numbering settings: ${saveError.message}`); return; }
    setNumberSettingsOpen(false); setNotice("Invoice numbering settings saved."); await load();
  }

  async function editDraftInvoiceNumber(invoice: Invoice) {
    if (!company?.id || invoice.status !== "draft") return;
    const entered = window.prompt("Enter the invoice number for this draft:", invoice.invoice_no); if (entered === null) return;
    const invoiceNo = entered.trim(); if (!invoiceNo) { setError("Invoice number cannot be empty."); return; }
    const { error: updateError } = await supabase.from("sales_invoices").update({ invoice_no: invoiceNo, updated_at: new Date().toISOString() }).eq("company_id", company.id).eq("id", invoice.id).eq("status", "draft");
    if (updateError) { setError(`Unable to update draft invoice number: ${updateError.message}`); return; }
    setNotice(`Draft invoice number set to ${invoiceNo}.`); await load();
  }

  async function issueInvoice(invoice: Invoice) {
    if (!company?.id || invoice.status !== "draft") return;
    if (!window.confirm(`Issue invoice ${invoice.invoice_no}? Once issued, its number and tax snapshots should not be changed casually.`)) return;
    setIssuingId(invoice.id); setError(""); setNotice("");
    const { data, error: issueError } = await supabase.rpc("issue_sales_invoice", { p_company_id: company.id, p_invoice_id: invoice.id });
    setIssuingId(null); if (issueError) { setError(`Unable to issue invoice: ${issueError.message}`); return; }
    const issued = Array.isArray(data) ? data[0] : data; setNotice(`Invoice ${issued?.issued_invoice_no ?? invoice.invoice_no} issued successfully.`); await load();
  }

  async function printInvoice(invoice: Invoice) {
    if (!company?.id) return;
    setError("");
    const [linesResult, partyResult, profileResult, linksResult] = await Promise.all([
      supabase.from("sales_invoice_lines").select("description,item_description,hsn_sac_code,quantity,unit_rate,amount,taxable_amount,gst_rate,cgst_amount,sgst_amount,igst_amount,unit_name_snapshot").eq("company_id", company.id).eq("invoice_id", invoice.id),
      supabase.from("parties").select("id,name,party_type,tax_id,phone,email,address").eq("company_id", company.id).eq("id", invoice.customer_id).maybeSingle(),
      supabase.from("companies").select("*").eq("id", company.id).maybeSingle(),
      supabase.from("sales_invoice_deliveries").select("delivery_id").eq("company_id", company.id).eq("invoice_id", invoice.id),
    ]);
    if (linesResult.error) { setError(`Unable to load invoice lines: ${linesResult.error.message}`); return; }
    if (partyResult.error) { setError(`Unable to load customer: ${partyResult.error.message}`); return; }
    const profile = (profileResult.data ?? companyProfile) as CompanyProfile;
    const party = partyResult.data as Party | null;
    const printLines = (linesResult.data ?? []) as InvoiceLineSaved[];
    const escapeHtml = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch));
    const address = party?.address ?? {};
    const addressValues = [field(address, "address_line", "address", "line1", "address_line1"), field(address, "address_line2", "line2"), field(address, "city"), field(address, "district"), field(address, "state"), field(address, "postal_code", "pincode", "pin_code")].filter(Boolean);
    const linkedIds = (linksResult.data ?? []).map((x: { delivery_id: string }) => x.delivery_id);
    let shipToValues = addressValues;
    if (linkedIds.length) {
      const { data: shipRows } = await supabase.from("deliveries")
        .select("delivery_address_line1,delivery_address_line2,delivery_city,delivery_district,delivery_state,delivery_pincode,delivery_gstin")
        .eq("company_id", company.id).in("id", linkedIds);
      const distinctAddresses: string[] = (shipRows ?? []).map((d: any) => [
        d.delivery_address_line1, d.delivery_address_line2, d.delivery_city, d.delivery_district,
        d.delivery_state, d.delivery_pincode, d.delivery_gstin ? `GSTIN: ${d.delivery_gstin}` : "",
      ].filter(Boolean).join(", ")).filter((value: string) => Boolean(value));
      if (distinctAddresses.length) shipToValues = Array.from(new Set<string>(distinctAddresses));
    }
    const companyAddress = profile.billing_address || profile.registered_address || profile.factory_address || "";
    const bankVisible = profile.show_bank_details_on_invoice !== false && [profile.bank_name, profile.bank_account_number, profile.bank_ifsc, profile.upi_id].some(Boolean);
    const lineRows = printLines.map((line, i) => {
      const taxable = Number(line.taxable_amount ?? line.amount ?? 0);
      const gst = Number(line.gst_rate ?? invoice.tax_rate ?? 0);
      const storedTax = Number(line.cgst_amount ?? 0) + Number(line.sgst_amount ?? 0) + Number(line.igst_amount ?? 0);
      const tax = line.gst_rate == null ? round2(taxable * gst / 100) : storedTax;
      const lineTotal = line.gst_rate == null ? round2(taxable + tax) : Number(line.amount);
      return `<tr><td class="num">${i + 1}</td><td>${escapeHtml(line.description || line.item_description || "Item")}${line.unit_name_snapshot ? `<div class="muted">${escapeHtml(line.unit_name_snapshot)}</div>` : ""}</td><td>${escapeHtml(line.hsn_sac_code || "—")}</td><td class="num">${escapeHtml(line.quantity)}</td><td class="num">${escapeHtml(money(Number(line.unit_rate)))}</td><td class="num">${escapeHtml(`${gst}%`)}</td><td class="num">${escapeHtml(money(tax))}</td><td class="num">${escapeHtml(money(taxable))}</td><td class="num">${escapeHtml(money(lineTotal))}</td></tr>`;
    }).join("");
    const cgst = invoice.cgst_amount == null ? 0 : Number(invoice.cgst_amount);
    const sgst = invoice.sgst_amount == null ? 0 : Number(invoice.sgst_amount);
    const igst = invoice.igst_amount == null ? 0 : Number(invoice.igst_amount);
    const legacyTax = invoice.cgst_amount == null && invoice.sgst_amount == null && invoice.igst_amount == null;
    const taxableTotal = Number(invoice.subtotal);
    const taxDisplay = legacyTax ? `<div class="total-row"><span>Tax (${escapeHtml(invoice.tax_rate)}%)</span><span>${escapeHtml(money(Number(invoice.tax_amount)))}</span></div>` :
      `<div class="total-row"><span>CGST</span><span>${escapeHtml(money(cgst))}</span></div><div class="total-row"><span>SGST</span><span>${escapeHtml(money(sgst))}</span></div><div class="total-row"><span>IGST</span><span>${escapeHtml(money(igst))}</span></div>`;
    const pos = invoice.place_of_supply_state || field(address, "state") || profile.state || "Not specified";
    const posCode = invoice.place_of_supply_state_code || field(address, "state_code", "stateCode");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(invoice.invoice_no)}</title><style>
      @page{size:A4;margin:9mm}*{box-sizing:border-box}body{font:9px/1.32 Arial,sans-serif;color:#172033;margin:0}
      .top{display:grid;grid-template-columns:1.25fr .75fr;gap:7px;margin-bottom:6px}.brand,.meta,.box,.strip-cell,.bank,.payment,.totals,.words{border:1px solid #cbd3df;padding:7px;min-width:0}
      .brand{display:flex;gap:9px;align-items:flex-start}.logo{max-width:65px;max-height:55px;object-fit:contain}.company-name{font-size:14px;font-weight:700;margin-bottom:3px}
      .meta{text-align:center;display:flex;flex-direction:column;justify-content:center}.meta h1{font-size:17px;margin:5px 0}.parties{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px}
      .label{text-transform:uppercase;font-size:7px;font-weight:700;text-align:center;margin-bottom:4px;letter-spacing:.3px}.box h2{font-size:10px;margin:0 0 3px}
      .strip{display:grid;grid-template-columns:1fr 1fr 1fr;margin-bottom:6px}.strip-cell+.strip-cell{border-left:0}
      table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#e9edf2;font-size:7px;padding:5px 3px;border:1px solid #aeb8c6}td{padding:5px 3px;border:1px solid #c4ccd7;vertical-align:top;overflow-wrap:anywhere}
      .num{text-align:right;white-space:nowrap}.lower{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:7px;align-items:start}.bank,.payment,.totals{font-size:8px}
      .total-row,.bank-row{display:flex;justify-content:space-between;gap:7px;padding:2px 0}.total-row span:last-child,.bank-row span:last-child{font-weight:600;text-align:right}
      .grand{border-top:1.5px solid #243b63;margin-top:4px;padding-top:5px;font-size:11px;font-weight:700}.payment{margin-top:6px;min-height:38px}.words{margin-top:7px;font-size:8px}
      .bottom{display:flex;justify-content:space-between;gap:18px;margin-top:20px;align-items:flex-end}.sign{width:180px;text-align:right;padding-top:20px}.sign-line{border-top:1px solid #667085;padding-top:5px;margin-top:20px}
      .footer{border-top:1px solid #d7deea;margin-top:10px;padding-top:5px;text-align:center;color:#667085;font-size:7px}.muted{color:#667085;font-size:7px}
      @media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}tr,.box,.strip-cell{break-inside:avoid}}
    </style></head><body>
      <div class="top"><div class="brand">${profile.logo_url ? `<img class="logo" src="${escapeHtml(profile.logo_url)}" alt="Company logo">` : ""}<div><div class="company-name">${escapeHtml(profile.name || company.name || "Company")}</div>${profile.legal_name ? `<strong>${escapeHtml(profile.legal_name)}</strong><br>` : ""}${escapeHtml(companyAddress)}<br>${escapeHtml([profile.phone, profile.alternate_phone].filter(Boolean).join(" · "))}<br>${escapeHtml(profile.email)} ${profile.website ? `· ${escapeHtml(profile.website)}` : ""}${profile.gstin ? `<br><strong>GSTIN:</strong> ${escapeHtml(profile.gstin)}` : ""}</div></div>
      <div class="meta"><div style="text-align:right;font-size:7px">ORIGINAL FOR RECIPIENT</div><h1>INVOICE</h1><div><strong>No.:</strong> ${escapeHtml(invoice.invoice_no)}</div><div><strong>Date:</strong> ${escapeHtml(formatDate(invoice.invoice_date))}</div></div></div>
      <section class="parties"><div class="box"><div class="label">Bill To</div><h2>${escapeHtml(party?.name || partyName(invoice.customer_id))}</h2>${addressValues.map(escapeHtml).join("<br>")}${party?.phone ? `<br>Phone: ${escapeHtml(party.phone)}` : ""}${party?.tax_id ? `<br><strong>GSTIN:</strong> ${escapeHtml(party.tax_id)}` : ""}</div>
      <div class="box"><div class="label">Ship To</div><h2>${escapeHtml(party?.name || partyName(invoice.customer_id))}</h2>${shipToValues.map(escapeHtml).join("<br>") || "Shipping address not provided"}${party?.tax_id && !linkedIds.length ? `<br><strong>GSTIN:</strong> ${escapeHtml(party.tax_id)}` : ""}</div></section>
      <section class="strip"><div class="strip-cell"><div class="label">Place of Supply</div>${escapeHtml(pos)} ${posCode ? `(${escapeHtml(posCode)})` : ""}</div><div class="strip-cell"><div class="label">Reverse Charge</div>No</div><div class="strip-cell"><div class="label">Document</div>GST Tax Invoice</div></section>
      <div style="font-weight:700;margin:5px 0">Invoice Items / Description of Goods or Services</div>
      <table><thead><tr><th style="width:4%">#</th><th style="width:23%">Item / Description</th><th style="width:9%">HSN/SAC</th><th style="width:7%">Qty</th><th style="width:11%">Rate</th><th style="width:7%">GST %</th><th style="width:11%">GST Amt.</th><th style="width:13%">Taxable</th><th style="width:15%">Total</th></tr></thead><tbody>${lineRows || `<tr><td colspan="9">No invoice lines found.</td></tr>`}</tbody></table>
      <section class="lower"><div><div class="bank"><div class="label">Bank Details</div>${bankVisible ? `${profile.bank_account_name ? `<div class="bank-row"><span>Account holder</span><span>${escapeHtml(profile.bank_account_name)}</span></div>` : ""}${profile.bank_name ? `<div class="bank-row"><span>Bank</span><span>${escapeHtml(profile.bank_name)}</span></div>` : ""}${profile.bank_account_number ? `<div class="bank-row"><span>Account</span><span>${escapeHtml(profile.bank_account_number)}</span></div>` : ""}${profile.bank_ifsc ? `<div class="bank-row"><span>IFSC</span><span>${escapeHtml(profile.bank_ifsc)}</span></div>` : ""}${profile.upi_id ? `<div class="bank-row"><span>UPI</span><span>${escapeHtml(profile.upi_id)}</span></div>` : ""}` : "Bank details not configured"}</div>
      <div class="payment"><div class="label">Payment Details</div>Status: ${escapeHtml(invoice.status.toUpperCase())}<br>Payment entries are maintained in the Payments module.</div></div>
      <div class="totals"><div class="label">Invoice Totals</div><div class="total-row"><span>Taxable subtotal</span><span>${escapeHtml(money(taxableTotal))}</span></div>${taxDisplay}<div class="total-row grand"><span>Grand Total</span><span>${escapeHtml(money(Number(invoice.total_amount)))}</span></div></div></section>
      <div class="words"><div class="label" style="text-align:left">Amount in Words</div>${escapeHtml(amountInWords(Number(invoice.total_amount)))}</div>
      ${invoice.notes ? `<div class="words"><strong>Notes:</strong> ${escapeHtml(invoice.notes)}</div>` : ""}
      <div class="bottom"><div>${profile.payment_terms ? `<strong>Payment terms:</strong> ${escapeHtml(profile.payment_terms)}` : ""}</div><div class="sign">For <strong>${escapeHtml(profile.name || company.name || "Company")}</strong><div class="sign-line">${escapeHtml(profile.authorised_signatory || "Authorised Signatory")}${profile.signatory_designation ? `<br>${escapeHtml(profile.signatory_designation)}` : ""}</div></div></div>
      <div class="footer">${escapeHtml(profile.document_footer || "Computer-generated invoice")}</div>
      <script>window.onload=()=>{const imgs=[...document.images];Promise.all(imgs.map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=r;i.onerror=r}))).then(()=>window.print())}</script>
    </body></html>`;
    const w = window.open("", "_blank", "width=1000,height=850"); if (!w) { setError("Allow pop-ups to print the invoice."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  const availableDeliveries = deliveries.filter(d => !billedDeliveryIds.includes(d.id));

  return <main>
    <header className="page-header"><div className="page-heading"><h1>Invoices</h1></div><div className="page-actions">
      <button className="button button-outline" onClick={() => void load()}><RefreshCw size={16}/> Refresh</button>
      <button className="button button-primary" onClick={openCreate}><Plus size={16}/> New invoice</button>
    </div></header>
    {error && <div className="notice-panel" role="alert"><div><strong>Invoice action needs attention</strong><p>{error}</p></div><button className="icon-button" onClick={() => setError("")} aria-label="Dismiss"><X size={16}/></button></div>}
    {notice && <div className="notice-panel"><div><strong>{notice}</strong></div><button className="icon-button" onClick={() => setNotice("")} aria-label="Dismiss"><X size={16}/></button></div>}
    <section className="panel"><div className="table-wrapper"><table className="data-table"><thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Status</th><th>Taxable</th><th>GST</th><th>Total</th><th>Actions</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={8}>Loading invoices…</td></tr> : pageRows.map(inv => <tr key={inv.id}><td><strong>{inv.invoice_no}</strong></td><td>{partyName(inv.customer_id)}</td><td>{formatDate(inv.invoice_date)}</td><td><span className={`status-badge status-${inv.status}`}>{inv.status}</span></td><td>{money(Number(inv.subtotal))}</td><td>{money(Number(inv.tax_amount))}</td><td><strong>{money(Number(inv.total_amount))}</strong></td><td style={{whiteSpace:"nowrap"}}>{inv.status === "draft" && numberSettings.mode === "manual" && <button className="button button-outline" onClick={() => void editDraftInvoiceNumber(inv)}><Pencil size={14}/> Number</button>} {inv.status === "draft" && <button className="button button-primary" disabled={issuingId === inv.id} onClick={() => void issueInvoice(inv)}><Send size={14}/>{issuingId === inv.id ? " Issuing…" : " Issue"}</button>} <button className="button button-outline" onClick={() => void printInvoice(inv)}><Printer size={14}/> Print / PDF</button></td></tr>)}
      {!loading && !totalInvoiceCount && <tr><td colSpan={8}><div className="empty-state">No invoices yet. Create an invoice using delivery challans, manual lines, or both.</div></td></tr>}
    </tbody></table></div></section>
    <Pagination totalItems={totalInvoiceCount} currentPage={currentPage} pageSize={PAGE_SIZE} onPageChange={setCurrentPage} loading={loading} itemLabel="invoices" />

    {showCreate && <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-modal="true" style={{width:"min(100%,1120px)",maxHeight:"92vh",overflow:"auto"}}>
      <header className="modal-header"><div><h2>Create GST invoice</h2><p>Select DCs if needed, then review or add invoice lines.</p></div><button className="icon-button" onClick={() => setShowCreate(false)} aria-label="Close"><X size={18}/></button></header>
      <div className="modal-body">
        <div className="form-grid">
          <div className="form-field"><label>Customer</label><select value={customerId} onChange={e => chooseCustomer(e.target.value)}><option value="">Select customer</option>{parties.filter(p => !p.party_type || ["customer", "both"].includes(p.party_type)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div className="form-field"><label>Invoice date</label><input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)}/></div>
          <div className="form-field"><label>Place of supply — State</label><input value={placeState} onChange={e => setPlaceState(e.target.value)} placeholder="e.g. Tamil Nadu"/></div>
          <div className="form-field"><label>Place of supply — State code</label><input value={placeStateCode} onChange={e => setPlaceStateCode(e.target.value)} placeholder="e.g. 33" maxLength={2}/></div>
        </div>
        <div className="form-field" style={{marginTop:12}}><label>Link delivery challans (optional)</label>
          {availableDeliveries.length ? <div className="table-wrapper"><table className="data-table"><thead><tr><th>Select</th><th>DC No.</th><th>Date</th><th>Customer</th><th>State / PIN</th></tr></thead><tbody>{availableDeliveries.map(d => <tr key={d.id}><td><input type="checkbox" checked={selectedDeliveryIds.includes(d.id)} disabled={!!customerId && d.customer_id !== customerId} onChange={() => void toggleDelivery(d)}/></td><td>{d.document_no}</td><td>{formatDate(d.delivery_date)}</td><td>{partyName(d.customer_id)}</td><td>—</td></tr>)}</tbody></table></div> : <p className="muted-text">No unbilled posted fabric DCs available. You can still create a manual invoice.</p>}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginTop:18,marginBottom:8}}><div><h3 style={{margin:0}}>Invoice lines</h3><small className="muted-text">DC items are copied as snapshots. Removing a line never changes its source DC.</small></div><button className="button button-outline" type="button" onClick={() => setLines(cur => [...cur, blankLine("manual")])}><Plus size={15}/> Add manual line</button></div>
        {lines.length ? <div className="table-wrapper"><table className="data-table"><thead><tr><th style={{minWidth:170}}>Item / Description</th><th>HSN/SAC</th><th>Qty</th><th>Unit</th><th>Rate (₹)</th><th>GST %</th><th>Taxable (₹)</th><th>GST (₹)</th><th>Total (₹)</th><th></th></tr></thead><tbody>{lines.map(line => {
          const taxable = round2((Number(line.quantity) || 0) * (Number(line.unit_rate) || 0));
          const gst = round2(taxable * (Number(line.gst_rate) || 0) / 100);
          return <tr key={line.key}><td style={{minWidth:170}}>{line.line_type === "manual" && <select value={line.item_id ?? ""} onChange={e => selectItem(line,e.target.value)} style={{width:"100%",marginBottom:5}}><option value="">Custom item / service</option>{items.map(it => <option key={it.id} value={it.id}>{it.name} ({it.sku})</option>)}</select>}<input value={line.description} onChange={e => updateLine(line.key,{description:e.target.value})} placeholder="Item / service description" style={{width:"100%",minWidth:150}}/><small className="muted-text">{line.line_type === "delivery" ? deliveries.find(d => d.id === line.delivery_id)?.document_no : "Manual line"}</small></td>
            <td><input value={line.hsn_sac_code} onChange={e => updateLine(line.key,{hsn_sac_code:e.target.value})} style={{width:85}}/></td>
            <td><input type="number" min="0.000001" step="any" value={line.quantity} onChange={e => updateLine(line.key,{quantity:e.target.value})} style={{width:78}}/></td>
            <td><select value={line.unit_id} onChange={e => { const u=units.find(x=>x.id===e.target.value); updateLine(line.key,{unit_id:e.target.value,unit_name:u?.name ?? u?.code ?? ""}); }} style={{width:90}}><option value="">—</option>{units.map(u=><option key={u.id} value={u.id}>{u.code}</option>)}</select></td>
            <td><input type="number" min="0" step="any" value={line.unit_rate} onChange={e => updateLine(line.key,{unit_rate:e.target.value})} style={{width:90}}/></td>
            <td><input type="number" min="0" max="100" step="0.01" value={line.gst_rate} onChange={e => updateLine(line.key,{gst_rate:e.target.value})} style={{width:70}}/></td>
            <td>{money(taxable)}</td><td>{money(gst)}</td><td><strong>{money(taxable+gst)}</strong></td>
            <td><button className="icon-button" type="button" title="Remove invoice line" aria-label="Remove invoice line" onClick={()=>setLines(cur=>cur.filter(x=>x.key!==line.key))}><Trash2 size={16}/></button></td></tr>;
        })}</tbody></table></div> : <p className="empty-state">No invoice lines yet. Select a DC or add a manual line.</p>}
        <div className="form-grid" style={{marginTop:14}}>
          <div className="form-field"><label>Invoice number</label><div style={{display:"flex",gap:6}}><input style={{flex:1}} value={numberSettings.mode === "automatic" ? `${numberSettings.prefix}${String(numberSettings.nextNumber).padStart(numberSettings.digits,"0")}` : manualInvoiceNo} onChange={e=>setManualInvoiceNo(e.target.value)} readOnly={numberSettings.mode==="automatic"} placeholder="Invoice number"/><button type="button" className="icon-button" title="Numbering settings" onClick={()=>setNumberSettingsOpen(v=>!v)}><Settings2 size={17}/></button></div>
            {numberSettingsOpen && <div className="numbering-popover" style={{position:"relative",zIndex:10}}><div className="form-field"><label>Numbering mode</label><select value={numberSettings.mode} onChange={e=>setNumberSettings(v=>({...v,mode:e.target.value as "manual"|"automatic"}))}><option value="automatic">Automatic</option><option value="manual">Manual</option></select></div>{numberSettings.mode==="automatic" && <><div className="form-field"><label>Prefix</label><input value={numberSettings.prefix} onChange={e=>setNumberSettings(v=>({...v,prefix:e.target.value}))}/></div><div className="form-field"><label>Next number</label><input type="number" min="1" value={numberSettings.nextNumber} onChange={e=>setNumberSettings(v=>({...v,nextNumber:Number(e.target.value)}))}/></div><div className="form-field"><label>Digits</label><select value={numberSettings.digits} onChange={e=>setNumberSettings(v=>({...v,digits:Number(e.target.value)}))}>{[3,4,5,6].map(n=><option key={n} value={n}>{n}</option>)}</select></div></>}<button className="button button-outline" type="button" onClick={()=>void saveNumberSettings()}>Save numbering settings</button></div>}
          </div>
          <div className="form-field"><label>Notes</label><textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional invoice notes"/></div>
        </div>
        <section className="panel" style={{marginTop:14,padding:12}}><h3 style={{marginTop:0}}>GST summary</h3><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10}}><div>Taxable subtotal<br/><strong>{money(totals.taxable)}</strong></div>{intraState ? <><div>CGST<br/><strong>{money(totals.cgst)}</strong></div><div>SGST<br/><strong>{money(totals.sgst)}</strong></div></> : <div>IGST<br/><strong>{money(totals.igst)}</strong></div>}<div>Grand total<br/><strong>{money(totals.total)}</strong></div></div><small className="muted-text">Supplier state code: {companyProfile.state_code || "Not set"} · Place-of-supply code: {placeStateCode || "Not set"} · {intraState ? "Intra-state" : "Inter-state (or state codes differ / are incomplete)"}</small></section>
        {error && <p className="error-message" role="alert">{error}</p>}
      </div>
      <footer className="modal-footer"><button className="button button-outline" onClick={()=>setShowCreate(false)} disabled={saving}>Cancel</button><button className="button button-primary" onClick={()=>void createInvoice()} disabled={saving}>{saving?"Saving…":"Save draft invoice"}</button></footer>
    </section></div>}
  </main>;
}
