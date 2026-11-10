import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import {

  Plus, RefreshCw, X, Eye, Pencil, Trash2, Printer, Send, Ban, Download, Settings2, FileCheck, MapPin

} from "lucide-react";

import { supabase } from "../lib/supabase";

import { useCompany } from "../hooks/useCompany";
import { formatDate } from "../lib/dateUtils";
import Pagination from "../components/Pagination"

import "./Delivery.css";

type Delivery = {

  id: string; company_id: string; document_no: string; customer_id: string;

  status: "draft" | "posted" | "cancelled"; delivery_date: string; notes: string | null;

  created_at: string; posted_at: string | null; movement_type: "yarn" | "fabric";

  customer_reference: string | null; destination: string | null; transporter_name: string | null;

  vehicle_number: string | null; delivery_address_line1?: string | null; delivery_address_line2?: string | null;
  delivery_city?: string | null; delivery_district?: string | null; delivery_state?: string | null; delivery_pincode?: string | null;
  delivery_gstin?: string | null; delivery_state_code?: string | null;

};

type Party = { id: string; name: string; party_type: string; is_active: boolean; tax_id?: string | null; address?: Record<string, unknown> };

type Item = { id: string; sku: string; name: string; item_type: string; unit_id: string; unit?: { code: string; name: string } | { code: string; name: string }[] | null };

type Location = { id: string; code: string; name: string; is_active: boolean };

type Lot = { id: string; item_id: string; lot_code: string };

type DeliveryLine = { id?: string; item_id: string; location_id: string; lot_id: string; quantity: string; unit_price: string; po_number: string; fo_number: string; rolls: string; dia: string; boxes: string; gg: string; yarn_count: string };

type PendingAttachment = { file: File; preview: string; name: string; size: number };

type DeliveryAttachment = { id: string; object_path: string; file_name: string; size_bytes: number };

type DeliveryCodeSettings = {

  mode: "manual" | "automatic";

  prefix: string;

  nextNumber: number;

  digits: number;

};

type FullDelivery = Delivery & { lines: DeliveryLine[] };

const today = () => new Date().toISOString().slice(0, 10);

const emptyLine = (): DeliveryLine => ({ item_id: "", location_id: "", lot_id: "", quantity: "", unit_price: "", po_number: "", fo_number: "", rolls: "", dia: "", boxes: "", gg: "", yarn_count: "" });

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value);

const getItemUnitLabel = (item: Item | undefined) => {
  const relatedUnit = Array.isArray(item?.unit) ? item.unit[0] : item?.unit;
  return relatedUnit?.code || relatedUnit?.name || "";
};

export default function DeliveryPage({ mode = "all" }: { mode?: "all" | "yarn" | "fabric" | "challans" }) {

  const { company } = useCompany();

  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  const [parties, setParties] = useState<Party[]>([]);

  const [items, setItems] = useState<Item[]>([]);

  const [locations, setLocations] = useState<Location[]>([]);

  const [lots, setLots] = useState<Lot[]>([]);

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");

  const [statusFilter, setStatusFilter] = useState("all");

  const [modalOpen, setModalOpen] = useState(false);

  const [viewing, setViewing] = useState<FullDelivery | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);

  const [documentNo, setDocumentNo] = useState("");

  const [customerId, setCustomerId] = useState("");

  const [movementType, setMovementType] = useState<"yarn" | "fabric">(mode === "yarn" ? "yarn" : "fabric");

  const [date, setDate] = useState(today());

  const [customerReference, setCustomerReference] = useState("");

  const [destination, setDestination] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [deliveryCity, setDeliveryCity] = useState("");
  const [deliveryDistrict, setDeliveryDistrict] = useState("");
  const [deliveryState, setDeliveryState] = useState("");
  const [deliveryPincode, setDeliveryPincode] = useState("");
  const [deliveryGstin, setDeliveryGstin] = useState("");
  const [deliveryStateCode, setDeliveryStateCode] = useState("");
  const [ewayBillPanelOpen, setEwayBillPanelOpen] = useState(false);

  const [transporterName, setTransporterName] = useState("");

  const [vehicleNumber, setVehicleNumber] = useState("");

  const [notes, setNotes] = useState("");

  const [numberingMode, setNumberingMode] = useState<"automatic" | "manual">("automatic");

  const [codeSettings, setCodeSettings] = useState<DeliveryCodeSettings>({

    mode: "automatic",

    prefix: mode === "yarn" ? "YDC-" : "FDC-",

    nextNumber: 1,

    digits: 5,

  });

  const [numberingPopoverOpen, setNumberingPopoverOpen] = useState(false);

  const generatedDcNumber = useMemo(

    () => codeSettings.prefix + String(codeSettings.nextNumber).padStart(codeSettings.digits, "0"),

    [codeSettings]

  );

  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);

  const [savedAttachments, setSavedAttachments] = useState<DeliveryAttachment[]>([]);

  const [lines, setLines] = useState<DeliveryLine[]>([emptyLine()]);

  const [error, setError] = useState("");

  const [notice, setNotice] = useState("");

  const loadData = useCallback(async () => {

    if (!company?.id) { setLoading(false); return; }

    setLoading(true); setError("");

    const [d, p, i, l, lot] = await Promise.all([

      supabase.from("deliveries").select("id, company_id, document_no, customer_id, status, delivery_date, notes, created_at, posted_at, movement_type, customer_reference, destination, transporter_name, vehicle_number, delivery_address_line1, delivery_address_line2, delivery_city, delivery_district, delivery_state, delivery_pincode, delivery_gstin, delivery_state_code").eq("company_id", company.id).order("created_at", { ascending: false }),

      supabase.from("parties").select("id, name, party_type, is_active, tax_id, address").eq("company_id", company.id).eq("is_active", true).order("name"),

      supabase.from("items").select("id, sku, name, item_type, unit_id, unit:units(code,name)").eq("company_id", company.id).eq("is_active", true).order("name"),

      supabase.from("locations").select("id, code, name, is_active").eq("company_id", company.id).eq("is_active", true).order("name"),

      supabase.from("lots").select("id, item_id, lot_code").eq("company_id", company.id).order("lot_code"),

    ]);

    const failed = [d, p, i, l, lot].find((r) => r.error);

    if (failed?.error) {

      setError(`Unable to load delivery data: ${failed.error.message}. If the delivery migration has not been applied, run it first.`);

    } else {

      setDeliveries((d.data ?? []) as Delivery[]);

      setParties((p.data ?? []) as Party[]);

      setItems((i.data ?? []) as unknown as Item[]);

      setLocations((l.data ?? []) as Location[]);

      setLots((lot.data ?? []) as Lot[]);

    }

    const sequenceType = movementType === "yarn" ? "delivery_yarn" : "delivery_fabric";

    const { data: sequenceData, error: sequenceError } = await supabase

      .from("document_sequences")

      .select("mode, prefix, next_number, digits")

      .eq("company_id", company.id)

      .eq("document_type", sequenceType)

      .maybeSingle();

    if (sequenceError) {

      setError((current) => current || `Unable to load DC numbering settings: ${sequenceError.message}`);

    } else if (sequenceData) {

      const loaded: DeliveryCodeSettings = {

        mode: sequenceData.mode as "manual" | "automatic",

        prefix: sequenceData.prefix,

        nextNumber: Number(sequenceData.next_number),

        digits: Number(sequenceData.digits),

      };

      setCodeSettings(loaded);

      setNumberingMode(loaded.mode);

    } else {

      setCodeSettings({ mode: "automatic", prefix: movementType === "yarn" ? "YDC-" : "FDC-", nextNumber: 1, digits: 5 });

    }

    setLoading(false);

  }, [company?.id, movementType]);

  useEffect(() => { void loadData(); }, [loadData]);

  const title = mode === "yarn" ? "Yarn Delivery" : mode === "fabric" ? "Fabric Delivery" : mode === "challans" ? "Delivery Challans" : "Delivery & Dispatch";

  const filtered = useMemo(() => {

    const q = search.trim().toLowerCase();

    return deliveries.filter((d) =>

      (mode === "all" || mode === "challans" || d.movement_type === mode) &&

      (statusFilter === "all" || d.status === statusFilter) &&

      (!q || [d.document_no, parties.find(p => p.id === d.customer_id)?.name ?? "", d.status, d.destination ?? "", d.customer_reference ?? ""].some(v => v.toLowerCase().includes(q)))

    );

  }, [deliveries, search, statusFilter, mode, parties]);

  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  useEffect(() => { setCurrentPage(1); }, [search, statusFilter, mode]);

  function resetForm(type: "yarn" | "fabric") {

    setEditingId(null); setDocumentNo(""); setNumberingMode(codeSettings.mode); setNumberingPopoverOpen(false); setCustomerId(""); setMovementType(type); setDate(today());

    setCodeSettings(current => ({ ...current, prefix: type === "yarn" ? "YDC-" : "FDC-" }));

    setCustomerReference(""); setDestination(""); setAddressLine1(""); setAddressLine2(""); setDeliveryCity(""); setDeliveryDistrict(""); setDeliveryState(""); setDeliveryPincode(""); setDeliveryGstin(""); setDeliveryStateCode(""); setEwayBillPanelOpen(false); setTransporterName(""); setVehicleNumber("");

    setNotes(""); setPendingAttachments([]); setSavedAttachments([]); setLines([emptyLine()]); setError(""); setNotice(""); setModalOpen(true);

  }

  async function editDelivery(delivery: Delivery) {

    if (delivery.status !== "draft") return;

    setError(""); setNotice("");

    const { data, error: lineError } = await supabase.from("delivery_lines")

      .select("id,item_id,location_id,lot_id,quantity,unit_price,po_number,fo_number,rolls,dia,boxes,gg,yarn_count")

      .eq("company_id", company!.id).eq("delivery_id", delivery.id);

    if (lineError) { setError(lineError.message); return; }

    setEditingId(delivery.id); setDocumentNo(delivery.document_no); setNumberingMode("manual"); setNumberingPopoverOpen(false); setPendingAttachments([]); setCustomerId(delivery.customer_id);

    setMovementType(delivery.movement_type ?? "fabric"); setDate(delivery.delivery_date);

    setCustomerReference(delivery.customer_reference ?? ""); setDestination(delivery.destination ?? "");
    setAddressLine1(delivery.delivery_address_line1 ?? ""); setAddressLine2(delivery.delivery_address_line2 ?? "");
    setDeliveryCity(delivery.delivery_city ?? ""); setDeliveryDistrict(delivery.delivery_district ?? "");
    setDeliveryState(delivery.delivery_state ?? ""); setDeliveryPincode(delivery.delivery_pincode ?? "");
    setDeliveryGstin(delivery.delivery_gstin ?? ""); setDeliveryStateCode(delivery.delivery_state_code ?? ""); setEwayBillPanelOpen(false);

    setTransporterName(delivery.transporter_name ?? ""); setVehicleNumber(delivery.vehicle_number ?? "");

    setNotes(delivery.notes ?? "");

    setLines((data ?? []).map((line: any) => ({ item_id: line.item_id, location_id: line.location_id ?? "", lot_id: line.lot_id ?? "", quantity: String(line.quantity), unit_price: line.unit_price == null ? "" : String(line.unit_price), po_number: line.po_number ?? "", fo_number: line.fo_number ?? "", rolls: line.rolls == null ? "" : String(line.rolls), dia: line.dia ?? "", boxes: line.boxes == null ? "" : String(line.boxes), gg: line.gg ?? "", yarn_count: line.yarn_count ?? "" })));

    if (!data?.length) setLines([emptyLine()]);

    const { data: attachments } = await supabase.from("delivery_attachments").select("id,object_path,file_name,size_bytes").eq("company_id", company!.id).eq("delivery_id", delivery.id);

    setSavedAttachments((attachments ?? []) as DeliveryAttachment[]);

    setModalOpen(true);

  }

  async function viewDelivery(delivery: Delivery) {

    setError("");

    const { data, error: lineError } = await supabase.from("delivery_lines")

      .select("id,item_id,location_id,lot_id,quantity,unit_price,po_number,fo_number,rolls,dia,boxes,gg,yarn_count")

      .eq("company_id", company!.id).eq("delivery_id", delivery.id);

    if (lineError) { setError(lineError.message); return; }

    setViewing({ ...delivery, lines: (data ?? []).map((line: any) => ({ ...line, quantity: String(line.quantity), unit_price: line.unit_price == null ? "" : String(line.unit_price), location_id: line.location_id ?? "", lot_id: line.lot_id ?? "", po_number: line.po_number ?? "", fo_number: line.fo_number ?? "", rolls: line.rolls == null ? "" : String(line.rolls), dia: line.dia ?? "", boxes: line.boxes == null ? "" : String(line.boxes), gg: line.gg ?? "", yarn_count: line.yarn_count ?? "" })) });

  }

  function updateLine(index: number, patch: Partial<DeliveryLine>) {

    setLines(current => current.map((line, i) => i === index ? { ...line, ...patch, ...(patch.item_id !== undefined ? { lot_id: "" } : {}) } : line));

  }

  async function applyDeliveryNumberingSettings() {

    if (!company?.id) { setError("Your organisation is not available. Please try again."); return; }

    if (codeSettings.mode === "automatic" && !codeSettings.prefix.trim()) { setError("Enter a prefix for automatic DC numbers."); return; }

    if (!Number.isInteger(codeSettings.nextNumber) || codeSettings.nextNumber < 1) { setError("Next number must be a whole number greater than zero."); return; }

    setSaving(true);

    setError("");

    const documentType = movementType === "yarn" ? "delivery_yarn" : "delivery_fabric";

    const { error: settingsError } = await supabase.from("document_sequences").upsert({

      company_id: company.id, document_type: documentType, mode: codeSettings.mode,

      prefix: codeSettings.prefix.trim(), next_number: codeSettings.nextNumber,

      digits: codeSettings.digits, updated_at: new Date().toISOString(),

    }, { onConflict: "company_id,document_type" });

    setSaving(false);

    if (settingsError) { setError(`Unable to save DC numbering settings: ${settingsError.message}`); return; }

    setNumberingMode(codeSettings.mode);

    if (!editingId && codeSettings.mode === "manual") setDocumentNo("");

    setNotice("DC numbering settings saved.");

    setNumberingPopoverOpen(false);

  }

  async function saveDraft(event: FormEvent) {

    event.preventDefault();

    if (!company?.id) return;

    if (!customerId) { setError("Select a customer or receiving party."); return; }

    if (lines.some(l => !l.item_id || !l.quantity || Number(l.quantity) <= 0)) { setError("Choose an item and a quantity greater than zero for every line."); return; }

    if (numberingMode === "manual" && !documentNo.trim()) { setError("Enter a DC number or choose automatic numbering."); return; }

    if (pendingAttachments.length + savedAttachments.length > 5) { setError("Maximum 5 attachments per delivery."); return; }

    setSaving(true); setError(""); setNotice("");

    const { data, error: saveError } = await supabase.rpc("save_delivery_draft", {

      p_company_id: company.id,

      p_delivery_id: editingId,

      p_document_no: numberingMode === "manual" ? documentNo.trim() : null,

      p_customer_id: customerId,

      p_movement_type: movementType,

      p_delivery_date: date,

      p_customer_reference: customerReference.trim() || null,

      p_destination: destination.trim() || null,

      p_transporter_name: transporterName.trim() || null,

      p_vehicle_number: vehicleNumber.trim() || null,

      p_notes: notes.trim() || null,

      p_lines: lines.map(l => ({ item_id: l.item_id, location_id: l.location_id || null, lot_id: l.lot_id || null, quantity: Number(l.quantity), unit_price: l.unit_price === "" ? null : Number(l.unit_price), po_number: l.po_number.trim() || null, fo_number: l.fo_number.trim() || null, rolls: l.rolls === "" ? null : Number(l.rolls), dia: l.dia.trim() || null, boxes: l.boxes === "" ? null : Number(l.boxes), gg: l.gg.trim() || null, yarn_count: l.yarn_count.trim() || null })),

    });

    setSaving(false);

    if (saveError) { setError(saveError.message); return; }

    const deliveryId = data as string;
    const structuredAddress = {
      p_company_id: company.id,
      p_delivery_id: deliveryId,
      p_address_line1: addressLine1.trim() || null,
      p_address_line2: addressLine2.trim() || null,
      p_city: deliveryCity.trim() || null,
      p_district: deliveryDistrict.trim() || null,
      p_state: deliveryState.trim() || null,
      p_pincode: deliveryPincode.trim() || null,
      p_gstin: deliveryGstin.trim().toUpperCase() || null,
      p_state_code: deliveryStateCode.trim() || null,
      p_destination: [addressLine1, addressLine2, deliveryCity, deliveryDistrict, deliveryState, deliveryPincode].map(v => v.trim()).filter(Boolean).join(", ") || destination.trim() || null,
    };
    const { error: addressError } = await supabase.rpc("update_delivery_address_draft", structuredAddress);
    if (addressError) {
      setError(`Delivery draft was saved, but the structured address could not be saved: ${addressError.message}. Apply the delivery address migration and try again.`);
      setSaving(false);
      await loadData();
      return;
    }

    for (const attachment of pendingAttachments) {

      const path = `${company.id}/${deliveryId}/${crypto.randomUUID()}.webp`;

      const { error: uploadError } = await supabase.storage.from("delivery-attachments").upload(path, attachment.file, { contentType: "image/webp", upsert: false });

      if (uploadError) { setError(`Delivery saved, but attachment upload failed: ${uploadError.message}`); setSaving(false); await loadData(); return; }

      const { error: metaError } = await supabase.from("delivery_attachments").insert({ company_id: company.id, delivery_id: deliveryId, object_path: path, file_name: attachment.name.replace(/\.[^.]+$/, "") + ".webp", size_bytes: attachment.file.size });

      if (metaError) { setError(`Delivery saved, but attachment metadata failed: ${metaError.message}`); setSaving(false); await loadData(); return; }

    }

    setPendingAttachments([]); setModalOpen(false); setNotice(editingId ? "Draft delivery updated." : "Draft delivery saved.");

    await loadData();

    if (!data) setNotice("Draft saved.");

  }

  async function runAction(name: "post_delivery" | "cancel_delivery" | "delete_delivery_draft", d: Delivery) {

    if (!company?.id) return;

    const prompts = {

      post_delivery: `Post ${d.document_no}? Stock will be deducted once.`,

      cancel_delivery: `Cancel ${d.document_no}? If posted, a stock reversal will be recorded.`,

      delete_delivery_draft: `Permanently delete draft ${d.document_no}? This cannot be undone.`,

    };

    if (!window.confirm(prompts[name])) return;

    setError(""); setNotice("");

    const { error: actionError } = await supabase.rpc(name, { p_company_id: company.id, p_delivery_id: d.id });

    if (actionError) { setError(actionError.message); return; }

    setNotice(name === "post_delivery" ? `${d.document_no} posted.` : name === "cancel_delivery" ? `${d.document_no} cancelled.` : `${d.document_no} deleted.`);

    await loadData();

  }

  async function printDelivery(d: FullDelivery, existingPopup?: Window | null) {
    if (!company?.id) return;
    const popup = existingPopup ?? window.open("", "_blank", "width=950,height=750");
    if (!popup) { setError("Please allow pop-ups to print or save this document as PDF."); return; }
    popup.document.open();
    popup.document.write('<!doctype html><html><head><title>Preparing delivery challan…</title></head><body style="font:14px Arial;padding:24px">Preparing delivery challan…</body></html>');
    const [profileResult] = await Promise.all([
      supabase.from("companies").select("*").eq("id", company.id).maybeSingle(),
    ]);
    if (profileResult.error) { popup.close(); setError(`Unable to load company details for printing: ${profileResult.error.message}`); return; }
    const profile = profileResult.data as Record<string, any> | null;
    const customer = parties.find(p => p.id === d.customer_id);
    const addressValue = (value: unknown) => {
      if (!value) return "";
      if (typeof value === "string") return value;
      if (typeof value === "object") return Object.values(value as Record<string, unknown>).filter(Boolean).join(", ");
      return String(value);
    };
    const address = addressValue(customer?.address);
    const deliveryAddress = [d.delivery_address_line1, d.delivery_address_line2, d.delivery_city, d.delivery_district, d.delivery_state, d.delivery_pincode].filter(Boolean).join(", ") || d.destination || "";
    const companyAddress = addressValue(profile?.registered_address || profile?.factory_address || profile?.address);
    const logo = String(profile?.logo_url ?? "");
    const lineRows = d.lines.map((line, index) => {
      const item = items.find(i => i.id === line.item_id);
      const location = locations.find(l => l.id === line.location_id);
      const lot = lots.find(l => l.id === line.lot_id);
      const qty = Number(line.quantity);
      const rate = Number(line.unit_price || 0);
      return `<tr><td>${index + 1}</td><td><strong>${esc(item?.name || "Item")}</strong><div class="muted">${esc(item?.sku || "")}</div><div class="muted">Rolls: ${esc(line.rolls || "—")} · Dia: ${esc(line.dia || "—")} · Boxes: ${esc(line.boxes || "—")} · GG: ${esc(line.gg || "—")} · Yarn count: ${esc(line.yarn_count || "—")}</div></td><td>${esc(lot?.lot_code || "—")}</td><td>${esc(location?.name || "Unallocated")}</td><td>${esc(line.po_number || "—")}</td><td>${esc(line.fo_number || "—")}</td><td class="num">${qty.toLocaleString("en-IN")}</td><td class="num">${rate ? money(rate) : "—"}</td><td class="num">${rate ? money(qty * rate) : "—"}</td></tr>`;
    }).join("");
    const total = d.lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unit_price || 0), 0);
    const companyName = profile?.name || company.name || "Company";
    const contact = [profile?.phone, profile?.alternate_phone, profile?.email, profile?.website].filter(Boolean).map(esc).join(" · ");
    const gstin = profile?.gstin ? `<div><strong>GSTIN:</strong> ${esc(profile.gstin)}</div>` : "";
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.document_no)} — Delivery Challan</title><style>
      @page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font:11px/1.45 Arial,Helvetica,sans-serif;color:#172033;margin:0}.topline{height:5px;background:#193c55;margin-bottom:18px;print-color-adjust:exact;-webkit-print-color-adjust:exact}header{display:flex;gap:16px;align-items:flex-start;border-bottom:2px solid #193c55;padding-bottom:14px;margin-bottom:18px}.logo{max-width:92px;max-height:76px;object-fit:contain}.company{flex:1}.company h1{font-size:19px;margin:0 0 4px}.muted{color:#64748b;font-size:9px}.doc-title{text-align:right;min-width:145px}.doc-title h2{font-size:17px;margin:0 0 5px;letter-spacing:.4px}.doc-no{font-size:12px;font-weight:700}.status{display:inline-block;margin-top:4px;border:1px solid #cbd5e1;padding:2px 7px;border-radius:3px;font-size:9px;text-transform:uppercase}.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}.panel{border:1px solid #dbe2ea;border-radius:4px;padding:10px}.panel h3{font-size:9px;letter-spacing:.5px;text-transform:uppercase;color:#64748b;margin:0 0 7px}.party-name{font-size:13px;font-weight:700;margin-bottom:4px}.details div{margin:2px 0}table{width:100%;border-collapse:collapse;margin-top:14px}th{background:#eef3f7;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.2px;color:#334155;print-color-adjust:exact;-webkit-print-color-adjust:exact}th,td{padding:7px 5px;border:1px solid #dbe2ea;vertical-align:top}td{font-size:9px}.num{text-align:right;white-space:nowrap}.total{text-align:right;font-size:12px;font-weight:bold;margin-top:12px}.declaration{margin-top:18px;padding:10px;border:1px solid #64748b;text-align:center;font-size:11px;font-weight:700}.disclaimer{font-size:9px;color:#475569;margin-top:8px}.notes{white-space:pre-wrap;margin-top:12px}.signatures{display:flex;flex-direction:column;align-items:stretch;width:230px;margin:48px 0 0 auto;gap:28px}.sign{border-top:1px solid #64748b;padding-top:6px;color:#475569;font-size:9px}.footer{margin-top:22px;padding-top:8px;border-top:1px solid #dbe2ea;text-align:center;color:#64748b;font-size:8px}.actions{display:flex;justify-content:flex-end;margin-bottom:10px}button{padding:8px 14px;background:#193c55;color:white;border:0;border-radius:4px;cursor:pointer}@media print{.actions{display:none}tr{break-inside:avoid}thead{display:table-header-group}}
      </style></head><body><div class="actions"><button onclick="window.print()">Print / Save PDF</button></div><div class="topline"></div>
      <header>${logo ? `<img class="logo" src="${esc(logo)}" alt="Company logo">` : ""}<div class="company"><h1>${esc(companyName)}</h1>${profile?.legal_name && profile.legal_name !== companyName ? `<div>${esc(profile.legal_name)}</div>` : ""}<div class="muted">${esc(companyAddress)}</div><div>${contact}</div>${gstin}</div><div class="doc-title"><h2>DELIVERY CHALLAN</h2><div class="doc-no">${esc(d.document_no)}</div><span class="status">${esc(d.status)}</span></div></header>
      <section class="meta"><div class="panel"><h3>Customer / Recipient</h3><div class="party-name">${esc(customer?.name || "—")}</div><div class="details">${address ? `<div>${esc(address)}</div>` : ""}${customer?.tax_id ? `<div>GSTIN: ${esc(customer.tax_id)}</div>` : ""}</div></div><div class="panel"><h3>Delivery / Dispatch Details</h3><div class="details"><div><strong>Date:</strong> ${esc(formatDate(d.delivery_date))}</div><div><strong>Material:</strong> ${esc(d.movement_type)}</div><div><strong>Reference:</strong> ${esc(d.customer_reference || "—")}</div><div><strong>Delivery address:</strong> ${esc(deliveryAddress || "—")}</div>${d.delivery_gstin ? `<div><strong>Recipient GSTIN:</strong> ${esc(d.delivery_gstin)}</div>` : ""}<div><strong>Transporter:</strong> ${esc(d.transporter_name || "—")}</div><div><strong>Vehicle:</strong> ${esc(d.vehicle_number || "—")}</div></div></div></section>
      <table><thead><tr><th style="width:24px">#</th><th>Item / Description</th><th>Lot</th><th>Location</th><th>PO</th><th>FO</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>${lineRows}</tbody></table>
      <div class="total">Indicative line total (not the estimated value of goods): ${money(total)}</div>
      <div class="declaration">Goods sent back after job work — No Commercial Sale</div>
      <p class="disclaimer">This delivery challan records a goods movement for job-work purposes. The indicative line total is based only on quantities and rates entered in this delivery; it is not a tax invoice value or the estimated value of goods sent for job work. Issue a tax invoice and complete applicable statutory details separately.</p>
      ${d.notes ? `<div class="notes"><strong>Notes:</strong><br>${esc(d.notes)}</div>` : ""}
      <div class="signatures"><div class="sign">Recipient signature / name</div><div class="sign" style="text-align:right">${esc(profile?.authorised_signatory || "Authorised Signatory")}${profile?.signatory_designation ? `<br>${esc(profile.signatory_designation)}` : ""}</div></div><footer class="footer">${esc(profile?.document_footer || "Computer-generated delivery challan")}</footer><script>window.onload=()=>{const imgs=[...document.images];Promise.all(imgs.map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=r;i.onerror=r}))).then(()=>window.print());};</script></body></html>`;
    popup.document.open(); popup.document.write(html); popup.document.close();
  }

  function downloadDeliveryPdf(d: FullDelivery) {
    // Use the exact same HTML document for printing and PDF export.
    // In Chrome's print dialog, choose "Save as PDF" to produce the same layout.
    printDelivery(d);
  }

  async function printFromList(delivery: Delivery) {
    if (!company?.id) return;
    const popup = window.open("", "_blank", "width=950,height=750");
    if (!popup) { setError("Please allow pop-ups to print or save this document as PDF."); return; }
    popup.document.write('<!doctype html><html><body style="font:14px Arial;padding:24px">Preparing delivery challan…</body></html>');
    const { data, error: lineError } = await supabase.from("delivery_lines")
      .select("id,item_id,location_id,lot_id,quantity,unit_price,po_number,fo_number,rolls,dia,boxes,gg,yarn_count")
      .eq("company_id", company.id).eq("delivery_id", delivery.id);
    if (lineError) { popup.close(); setError(`Unable to load delivery lines for printing: ${lineError.message}`); return; }
    const full = { ...delivery, lines: (data ?? []).map((line: any) => ({ ...line, quantity: String(line.quantity), unit_price: line.unit_price == null ? "" : String(line.unit_price), location_id: line.location_id ?? "", lot_id: line.lot_id ?? "", po_number: line.po_number ?? "", fo_number: line.fo_number ?? "", rolls: line.rolls == null ? "" : String(line.rolls), dia: line.dia ?? "", boxes: line.boxes == null ? "" : String(line.boxes), gg: line.gg ?? "", yarn_count: line.yarn_count ?? "" })) } as FullDelivery;
    await printDelivery(full, popup);
  }

  function prepareEwayBill() {
    setEwayBillPanelOpen(true);
    setNotice("E-Way Bill preparation opened. Official API generation is not connected yet.");
  }


  async function prepareAttachments(fileList: FileList | null) {

    if (!fileList) return;

    const incoming = Array.from(fileList);

    if (pendingAttachments.length + savedAttachments.length + incoming.length > 5) { setError("Maximum 5 attachments per delivery."); return; }

    const prepared: PendingAttachment[] = [];

    for (const file of incoming) {

      if (!file.type.startsWith("image/")) { setError("Only image attachments are supported. Images are converted to compressed WebP."); continue; }

      if (file.size > 10 * 1024 * 1024) { setError(`${file.name} exceeds the 10 MB source-file limit.`); continue; }

      try {

        const image = await createImageBitmap(file);

        const scale = Math.min(1, 1800 / Math.max(image.width, image.height));

        const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));

        const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Image processing is unavailable");

        ctx.drawImage(image, 0, 0, canvas.width, canvas.height); image.close();

        let blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.78));

        if (!blob) throw new Error("WebP conversion failed");

        if (blob.size > 1 * 1024 * 1024) blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.55));

        if (!blob || blob.size > 1 * 1024 * 1024) { setError(`${file.name} remains larger than 1 MB after compression.`); continue; }

        const webp = new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });

        prepared.push({ file: webp, preview: URL.createObjectURL(webp), name: webp.name, size: webp.size });

      } catch (e) { setError(e instanceof Error ? e.message : `Could not process ${file.name}`); }

    }

    setPendingAttachments(current => [...current, ...prepared].slice(0, Math.max(0, 5 - savedAttachments.length)));

  }

  const displayLines = viewing?.lines ?? [];

  const viewTotal = displayLines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unit_price || 0), 0);

  const modalItems = (type: "yarn" | "fabric") => items.filter(i => type === "yarn" ? i.item_type === "yarn" : i.item_type !== "yarn");

  return <>

    <header className="page-header">

      <div className="page-heading"><h1>{title}</h1></div>

      <div className="page-actions">

        <button type="button" className="button button-outline" onClick={() => void loadData()}><RefreshCw size={16}/> Refresh</button>

        <button type="button" className="button button-primary" onClick={() => resetForm(mode === "yarn" ? "yarn" : "fabric")}><Plus size={16}/> New {mode === "yarn" ? "Yarn Delivery" : mode === "fabric" ? "Fabric Delivery" : "Dispatch"}</button>

      </div>

    </header>

    {error && !modalOpen && <div className="notice-panel" role="alert"><div><strong>Delivery action needs attention</strong><p>{error}</p></div><button className="icon-button" onClick={() => setError("")} aria-label="Dismiss"><X size={16}/></button></div>}

    {notice && <div className="notice-panel"><div><strong>{notice}</strong></div><button className="icon-button" onClick={() => setNotice("")} aria-label="Dismiss"><X size={16}/></button></div>}

<section className="panel delivery-list-toolbar">

  <div className="delivery-search-field">

    

    <div className="search-box">


      <input

        id="delivery-search"

        placeholder="Document, customer or destination..."

        value={search}

        onChange={e => setSearch(e.target.value)}

      />

    </div>

  </div>

  <div className="delivery-status-filter">


    <select

      id="delivery-status"

      value={statusFilter}

      onChange={e => setStatusFilter(e.target.value)}

    >

      <option value="all">All statuses</option>

      <option value="draft">Draft</option>

      <option value="posted">Posted</option>

      <option value="cancelled">Cancelled</option>

    </select>

  </div>

  <div className="delivery-result-count" aria-live="polite">

    {filtered.length} document(s)

  </div>

</section>

    <section className="panel">

      {loading ? <div className="empty-state">Loading deliveries...</div> : <div className="table-wrapper"><table className="data-table">

        <thead><tr><th>Document</th><th>Party</th><th>Type</th><th>Date</th><th>Status</th><th>Destination / Vehicle</th><th>Actions</th></tr></thead>

        <tbody>{pageRows.map(d => <tr key={d.id}>

          <td><strong>{d.document_no}</strong><span className="table-subtext">{d.customer_reference || "No external reference"}</span></td>

          <td>{parties.find(p => p.id === d.customer_id)?.name || "Unknown party"}</td>

          <td>{d.movement_type === "yarn" ? "Yarn" : "Fabric"}</td>

          <td>{formatDate(d.delivery_date)}</td>

          <td><span className={`status-badge status-${d.status}`}>{d.status}</span></td>

          <td>{d.destination || "—"}<span className="table-subtext">{d.vehicle_number || "Vehicle not set"}</span></td>

          <td><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>

            <button className="button button-outline" title="View" onClick={() => void viewDelivery(d)}><Eye size={14}/></button>
            <button className="button button-outline" title="Print" onClick={() => void printFromList(d)}><Printer size={14}/></button>
            <button className="button button-outline" title="Download PDF (Save as PDF in print dialog)" onClick={() => void printFromList(d)}><Download size={14}/></button>

            {d.status === "draft" && <button className="button button-outline" title="Edit" onClick={() => void editDelivery(d)}><Pencil size={14}/></button>}

            {d.status === "draft" && <button className="button button-outline" title="Post and deduct stock" onClick={() => void runAction("post_delivery", d)}><Send size={14}/></button>}

            {d.status === "draft" && <button className="button button-outline" title="Delete draft" onClick={() => void runAction("delete_delivery_draft", d)}><Trash2 size={14}/></button>}

            {d.status !== "cancelled" && <button className="button button-outline" title="Cancel" onClick={() => void runAction("cancel_delivery", d)}><Ban size={14}/></button>}

          </div></td>

        </tr>)}

        {!filtered.length && <tr><td colSpan={7}><div className="empty-state">{error ? "Delivery data could not be loaded." : "No delivery documents yet. Create a draft to get started."}</div></td></tr>}

        </tbody></table></div>}

    </section>
    <Pagination totalItems={filtered.length} currentPage={currentPage} pageSize={PAGE_SIZE} onPageChange={setCurrentPage} loading={loading} itemLabel="documents" />

    {modalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !saving) setModalOpen(false); }}>

      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="delivery-modal-title" style={{ width: "min(100%, 980px)", overflow: "auto" }}>

        <header className="modal-header"><div><h2 id="delivery-modal-title">{editingId ? "Edit Draft Delivery" : "Create Dispatch"}</h2><p>Save as draft first. Stock changes only when you post the delivery.</p></div><button className="icon-button" onClick={() => setModalOpen(false)} aria-label="Close"><X size={19}/></button></header>

        <form onSubmit={saveDraft}>

          <div className="modal-body">

            {error && <div className="auth-message" role="alert">{error}</div>}

            <div className="form-grid">

              <div className="form-field"><label>Movement type *</label><select value={movementType} disabled={!!editingId} onChange={e => { setMovementType(e.target.value as "yarn" | "fabric"); setLines([emptyLine()]); }}><option value="yarn">Yarn delivery / return</option><option value="fabric">Fabric delivery / return</option></select></div>

              <div className="form-field delivery-number-field"><label htmlFor="delivery-document-number">Delivery Challan (DC) number</label><div className="delivery-number-input-row"><input
  id="delivery-document-number"
  value={
    numberingMode === "manual"
      ? documentNo
      : editingId
        ? documentNo
        : generatedDcNumber
  }
  onChange={e => setDocumentNo(e.target.value)}
  placeholder="DC number"
  readOnly={numberingMode === "automatic" && !editingId}
  required={numberingMode === "manual"}
/><button type="button" className="icon-button delivery-number-settings-button" aria-label="DC numbering settings" title="DC numbering settings" onClick={() => setNumberingPopoverOpen(v => !v)}><Settings2 size={18}/></button></div>{numberingPopoverOpen && <div className="delivery-numbering-popover">

  <div className="delivery-numbering-header">

    <div><strong>DC number settings</strong><p>Configure how this challan number is generated.</p></div>

    <button type="button" className="icon-button" aria-label="Close numbering settings" onClick={() => setNumberingPopoverOpen(false)}><X size={16}/></button>

  </div>

  <div className="delivery-numbering-modes">

    <label className={codeSettings.mode === "manual" ? "selected" : ""}>

      <input type="radio" name="delivery-numbering-mode" checked={codeSettings.mode === "manual"} onChange={() => { setCodeSettings(current => ({ ...current, mode: "manual" })); setNumberingMode("manual"); }} />

      <span><strong>Manual</strong><small>Enter the DC number yourself.</small></span>

    </label>

    <label className={codeSettings.mode === "automatic" ? "selected" : ""}>

      <input type="radio" name="delivery-numbering-mode" checked={codeSettings.mode === "automatic"} onChange={() => { setCodeSettings(current => ({ ...current, mode: "automatic" })); setNumberingMode("automatic"); }} />

      <span><strong>Automatic</strong><small>Generate a sequence on save.</small></span>

    </label>

  </div>

  {codeSettings.mode === "automatic" && <>

    <div className="form-field"><label htmlFor="delivery-code-prefix">Prefix</label>

      <input id="delivery-code-prefix" value={codeSettings.prefix} maxLength={20} onChange={e => setCodeSettings(current => ({ ...current, prefix: e.target.value }))}/>

    </div>

    <div className="form-field"><label htmlFor="delivery-code-next">Next number</label>

      <input id="delivery-code-next" type="number" min={1} step={1} value={codeSettings.nextNumber} onChange={e => setCodeSettings(current => ({ ...current, nextNumber: Math.max(1, Math.floor(Number(e.target.value) || 1)) }))}/>

    </div>

    <div className="form-field"><label htmlFor="delivery-code-digits">Number of digits</label>

      <select id="delivery-code-digits" value={codeSettings.digits} onChange={e => setCodeSettings(current => ({ ...current, digits: Number(e.target.value) }))}>

        <option value={2}>2 digits — 01</option><option value={3}>3 digits — 001</option>

        <option value={4}>4 digits — 0001</option><option value={5}>5 digits — 00001</option><option value={6}>6 digits — 000001</option>

      </select>

    </div>

    <p className="delivery-numbering-note">Preview: <strong>{generatedDcNumber}</strong><br/>The preview does not reserve a number.</p>

  </>}

  <div className="delivery-numbering-actions">

    <button type="button" className="button button-outline" onClick={() => setNumberingPopoverOpen(false)}>Close</button>

    <button type="button" className="button button-primary" disabled={saving} onClick={() => void applyDeliveryNumberingSettings()}>{saving ? "Saving…" : "Apply"}</button>

  </div>

</div>}</div>

              <div className="form-field"><label>Customer / recipient *</label><select value={customerId} onChange={e => setCustomerId(e.target.value)} required><option value="">Select party</option>{parties.filter(p => ["customer","both","job_worker","supplier","other"].includes(p.party_type)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>

              <div className="form-field"><label>Delivery date *</label><input type="date" value={date} onChange={e => setDate(e.target.value)} required/></div>

              <div className="form-field"><label>Customer reference <span>(optional)</span></label><input value={customerReference} onChange={e => setCustomerReference(e.target.value)} placeholder="Order / reference no."/></div>

            </div>

            <details className="delivery-additional-details" open style={{ marginTop: 12 }}>
              <summary>Delivery address <span className="text-muted">(structured fields for print and future E-Way Bill API)</span></summary>
              <div className="form-grid" style={{ marginTop: 12 }}>
                <div className="form-field"><label>Address line 1 *</label><input value={addressLine1} onChange={e => setAddressLine1(e.target.value)} placeholder="Building, door number, street" required/></div>
                <div className="form-field"><label>Address line 2</label><input value={addressLine2} onChange={e => setAddressLine2(e.target.value)} placeholder="Area, locality, landmark"/></div>
                <div className="form-field"><label>City / town *</label><input value={deliveryCity} onChange={e => setDeliveryCity(e.target.value)} placeholder="City / town" required/></div>
                <div className="form-field"><label>District</label><input value={deliveryDistrict} onChange={e => setDeliveryDistrict(e.target.value)} placeholder="District"/></div>
                <div className="form-field"><label>State *</label><input value={deliveryState} onChange={e => setDeliveryState(e.target.value)} placeholder="State" required/></div>
                <div className="form-field"><label>PIN code *</label><input value={deliveryPincode} onChange={e => setDeliveryPincode(e.target.value)} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="6-digit PIN" required/></div>
                <div className="form-field"><label>Recipient GSTIN</label><input value={deliveryGstin} onChange={e => setDeliveryGstin(e.target.value.toUpperCase())} maxLength={15} placeholder="Optional GSTIN"/></div>
                <div className="form-field"><label>State code</label><input value={deliveryStateCode} onChange={e => setDeliveryStateCode(e.target.value)} inputMode="numeric" maxLength={2} placeholder="2-digit code"/></div>
              </div>
            </details>
            <details className="delivery-additional-details" style={{ marginTop: 12 }}>
              <summary>Transport details</summary>
              <div className="form-grid" style={{ marginTop: 12 }}>
                <div className="form-field"><label>Transporter</label><input value={transporterName} onChange={e => setTransporterName(e.target.value)} placeholder="Transporter name"/></div>
                <div className="form-field"><label>Vehicle number</label><input value={vehicleNumber} onChange={e => setVehicleNumber(e.target.value)} placeholder="TN 00 AB 1234"/></div>
              </div>
            </details>
            <div style={{ marginTop: 12 }}>
              <button type="button" className="button button-outline" onClick={prepareEwayBill}><FileCheck size={15}/> Prepare E-Way Bill</button>
            </div>
            {ewayBillPanelOpen && <section className="panel" style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}><h3 style={{ margin: 0 }}><MapPin size={16} style={{ verticalAlign: "middle" }}/> E-Way Bill preparation</h3><button type="button" className="icon-button" onClick={() => setEwayBillPanelOpen(false)} aria-label="Close E-Way Bill preparation"><X size={15}/></button></div>
              <p className="text-muted" style={{ fontSize: 12 }}>API integration will be added later. This section prepares delivery data only; it does not generate an official E-Way Bill.</p>
              <ul style={{ fontSize: 12, marginBottom: 0 }}><li>Recipient: {parties.find(p => p.id === customerId)?.name || "Select a recipient"}</li><li>Delivery address: {[addressLine1, addressLine2, deliveryCity, deliveryDistrict, deliveryState, deliveryPincode].filter(Boolean).join(", ") || "Enter the structured address"}</li><li>Transporter / vehicle: {[transporterName, vehicleNumber].filter(Boolean).join(" · ") || "Not entered"}</li><li>GSTIN: {deliveryGstin || "Not entered"}</li></ul>
            </section>}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "24px 0 12px" }}><h3 style={{ margin: 0 }}>Items and quantities</h3><button type="button" className="button button-outline" onClick={() => setLines(current => [...current, emptyLine()])}><Plus size={15}/> Add line</button></div>

            <div className="delivery-lines-list">

              {lines.map((line, index) => {

                const selectedItem = items.find(i => i.id === line.item_id);

                const lineLots = lots.filter(l => l.item_id === line.item_id);

                return <article className="delivery-line-card" key={index}>

                  <div className="delivery-line-card-header"><div><span className="delivery-line-index">LINE {String(index + 1).padStart(2, "0")}</span><strong>{selectedItem ? `${selectedItem.sku} — ${selectedItem.name}` : "New item line"}</strong></div><button type="button" className="icon-button delivery-remove-line" aria-label={`Remove line ${index + 1}`} title="Remove line" disabled={lines.length === 1} onClick={() => setLines(current => current.filter((_, i) => i !== index))}><Trash2 size={16}/></button></div>

                  <div className="delivery-line-grid">

                    <div className="form-field delivery-line-item"><label>Item *</label><select value={line.item_id} onChange={e => updateLine(index, { item_id: e.target.value })} required><option value="">Select item</option>{modalItems(movementType).map(i => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}</select></div>

                    <div className="form-field"><label>UOM</label><div className="delivery-uom-value">{getItemUnitLabel(selectedItem) || (selectedItem ? "UOM missing on item" : "Select item first")}</div></div>

                    <div className="form-field"><label>Quantity *</label><input type="number" min="0.000001" step="any" value={line.quantity} onChange={e => updateLine(index, { quantity: e.target.value })} placeholder="Enter quantity" required/></div>

                    {/* Location is assigned automatically for the usual single-location workflow. */}

                    <div className="form-field"><label>Lot <span>(optional)</span></label><select value={line.lot_id} onChange={e => updateLine(index, { lot_id: e.target.value })} disabled={!line.item_id}><option value="">No lot</option>{lineLots.map(l => <option key={l.id} value={l.id}>{l.lot_code}</option>)}</select></div>

                    <div className="form-field"><label>Unit rate <span>(optional)</span></label><input type="number" min="0" step="any" value={line.unit_price} onChange={e => updateLine(index, { unit_price: e.target.value })} placeholder="Rate"/></div>

                    <div className="delivery-line-advanced-fields" style={{ gridColumn: "1 / -1" }}>
                      <details>
                        <summary>Manufacturing and reference details <span className="text-muted">(optional)</span></summary>
                        <div className="delivery-line-grid" style={{ marginTop: 12 }}>
                          <div className="form-field"><label>PO number</label><input value={line.po_number} onChange={e => updateLine(index, { po_number: e.target.value })} placeholder="PO number" maxLength={100}/></div>
                          <div className="form-field"><label>FO number</label><input value={line.fo_number} onChange={e => updateLine(index, { fo_number: e.target.value })} placeholder="FO number" maxLength={100}/></div>
                          <div className="form-field"><label>Rolls <span>(optional)</span></label><input type="number" min="0" step="1" value={line.rolls} onChange={e => updateLine(index, { rolls: e.target.value })} placeholder="Roll count"/></div>
                          <div className="form-field"><label>Dia <span>(optional)</span></label><input value={line.dia} onChange={e => updateLine(index, { dia: e.target.value })} placeholder="Diameter" maxLength={50}/></div>
                          <div className="form-field"><label>Boxes <span>(optional)</span></label><input type="number" min="0" step="1" value={line.boxes} onChange={e => updateLine(index, { boxes: e.target.value })} placeholder="Box count"/></div>
                          <div className="form-field"><label>GG <span>(optional)</span></label><input value={line.gg} onChange={e => updateLine(index, { gg: e.target.value })} placeholder="GG" maxLength={50}/></div>
                          <div className="form-field"><label>Yarn count <span>(optional)</span></label><input value={line.yarn_count} onChange={e => updateLine(index, { yarn_count: e.target.value })} placeholder="Yarn count" maxLength={100}/></div>
                        </div>
                      </details>
                    </div>

                  </div>

                </article>;

              })}

            </div>

            <div className="form-field" style={{ marginTop: 18 }}><label>Attachments (optional)</label><input type="file" accept="image/*" multiple onChange={e => { void prepareAttachments(e.target.files); e.currentTarget.value = ""; }} /><small className="text-muted">Up to 5 images per DC. Source image max 10 MB each; converted to WebP, resized to max 1800 px and compressed to max 1 MB each. Files are stored in Supabase Storage, not in database rows.</small>

              {savedAttachments.map(a => <div key={a.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>{a.file_name} ({Math.round(a.size_bytes / 1024)} KB)</span><span>Saved</span></div>)}

              {pendingAttachments.map((a, idx) => <div key={a.preview} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}><img src={a.preview} alt="" style={{ width: 40, height: 40, objectFit: "cover" }} /><span>{a.name} ({Math.round(a.size / 1024)} KB)</span><button type="button" className="icon-button" onClick={() => { URL.revokeObjectURL(a.preview); setPendingAttachments(cur => cur.filter((_, i) => i !== idx)); }} aria-label="Remove attachment"><X size={14}/></button></div>)}

            </div>

            <div className="form-field" style={{ marginTop: 18 }}><label>Notes</label><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Internal notes or movement details"/></div>

          </div>

          <footer className="modal-footer"><button type="button" className="button button-outline" disabled={saving} onClick={() => setModalOpen(false)}>Close</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? "Saving..." : "Save Draft"}</button></footer>

        </form>

      </section>

    </div>}

    {viewing && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setViewing(null); }}>

      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="delivery-view-title" style={{ width: "min(100%, 900px)", overflow: "auto" }}>

        <header className="modal-header"><div><h2 id="delivery-view-title">{viewing.document_no}</h2><p>{viewing.movement_type.toUpperCase()} · {viewing.status.toUpperCase()} · {formatDate(viewing.delivery_date)}</p></div><button className="icon-button" onClick={() => setViewing(null)} aria-label="Close"><X size={19}/></button></header>

        <div className="modal-body">

          <div className="form-grid"><div><span className="eyebrow">CUSTOMER / RECIPIENT</span><p><strong>{parties.find(p => p.id === viewing.customer_id)?.name || "—"}</strong></p></div><div><span className="eyebrow">TRANSPORT</span><p>{viewing.transporter_name || "—"} · {viewing.vehicle_number || "No vehicle"}<br/>{[viewing.delivery_address_line1, viewing.delivery_address_line2, viewing.delivery_city, viewing.delivery_district, viewing.delivery_state, viewing.delivery_pincode].filter(Boolean).join(", ") || viewing.destination || "No destination entered"}{viewing.delivery_gstin ? <><br/>GSTIN: {viewing.delivery_gstin}</> : null}</p></div><div><span className="eyebrow">CUSTOMER REFERENCE</span><p>{viewing.customer_reference || "—"}</p></div><div><span className="eyebrow">NOTES</span><p>{viewing.notes || "—"}</p></div></div>

          <div className="table-wrapper"><table className="data-table"><thead><tr><th>Item</th><th>PO No.</th><th>FO No.</th><th>Rolls</th><th>Dia</th><th>Boxes</th><th>GG</th><th>Yarn count</th><th>Location</th><th>Lot</th><th>Quantity</th><th>Rate</th><th>Amount</th></tr></thead><tbody>{displayLines.map((line, idx) => { const item = items.find(i => i.id === line.item_id); const amount = Number(line.quantity) * Number(line.unit_price || 0); return <tr key={line.id ?? idx}><td><strong>{item?.name || "Unknown item"}</strong><span className="table-subtext">{item?.sku}</span></td><td>{line.po_number || "—"}</td><td>{line.fo_number || "—"}</td><td>{line.rolls || "—"}</td><td>{line.dia || "—"}</td><td>{line.boxes || "—"}</td><td>{line.gg || "—"}</td><td>{line.yarn_count || "—"}</td><td>{locations.find(l => l.id === line.location_id)?.name || "Unallocated"}</td><td>{lots.find(l => l.id === line.lot_id)?.lot_code || "—"}</td><td>{Number(line.quantity).toLocaleString("en-IN")}</td><td>{line.unit_price ? money(Number(line.unit_price)) : "—"}</td><td>{line.unit_price ? money(amount) : "—"}</td></tr>; })}</tbody></table></div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16, fontWeight: 700 }}>Line total: {money(viewTotal)}</div>

          <p className="text-muted" style={{ fontSize: 12 }}>Print and Download PDF use the same document layout. For PDF, choose “Save as PDF” in the browser print dialog. No PDF is stored in the database.</p>

        </div>

        <footer className="modal-footer"><button className="button button-outline" onClick={() => printDelivery(viewing)}><Printer size={15}/> Print</button><button className="button button-outline" onClick={() => downloadDeliveryPdf(viewing)}><Download size={15}/> Download PDF</button><button className="button button-primary" onClick={() => setViewing(null)}>Close</button></footer>

      </section>

    </div>}

  </>;

}
