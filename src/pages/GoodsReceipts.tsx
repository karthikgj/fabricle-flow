
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Plus, Search, RefreshCw, X, PackageCheck, Send, Paperclip, Eye, Trash2, Settings2, Printer } from "lucide-react";

import { supabase } from "../lib/supabase";

import { useCompany } from "../hooks/useCompany";

import { formatDate, formatDateTime } from "../lib/dateUtils";

import {
  compressImage,
  validateAttachment,
} from "../lib/imageCompression";


type Receipt = {
  id: string;
  company_id: string;
  document_no: string;
  vendor_document_no: string | null;
  supplier_id: string;
  status: string;
  receipt_date: string;
  notes: string | null;
  posted_at: string | null;
  created_at: string;
};


type Party = { id: string; name: string; party_code: string; party_type: string; is_active: boolean };
type Item = { id: string; sku: string; name: string; item_type: string; unit_id: string };
type Location = { id: string; code: string; name: string; is_active: boolean };
type Lot = { id: string; item_id: string; lot_code: string; supplier_lot_code: string | null };
type Unit = { id: string; code: string; name: string };

type ReceiptLine = {
  id?: string;
  item_id: string;
  lot_id: string;
  location_id: string;
  quantity: string;
  unit_id: string;
  notes: string;
};

type NumberingSettings = {
  mode: "manual" | "automatic";
  prefix: string;
  nextNumber: number;
  digits: number;
};

type ReceiptAttachment = {
  id: string;
  company_id: string;
  goods_receipt_id: string;
  file_name: string;
  file_path: string;
  mime_type: string;
  file_size: number;
  created_at: string;
};


const PAGE_SIZE = 10;


function today() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}


function emptyLine(): ReceiptLine {
  return {
    item_id: "",
    lot_id: "",
    location_id: "",
    quantity: "",
    unit_id: "",
    notes: "",
  };
}


function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


export default function GoodsReceipts() {
  const { company } = useCompany();

  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const [totalReceipts, setTotalReceipts] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<Receipt | null>(null);

  const [supplierId, setSupplierId] = useState("");
  const [receiptDate, setReceiptDate] = useState(today());
  const [vendorDocumentNo, setVendorDocumentNo] = useState("");
  const [notes, setNotes] = useState("");

  const [lines, setLines] = useState<ReceiptLine[]>([emptyLine()]);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [vendorName, setVendorName] = useState("");
  const [vendorCode, setVendorCode] = useState("");
  const [vendorSaving, setVendorSaving] = useState(false);

  const [lotModalLine, setLotModalLine] = useState<number | null>(null);
  const [newLotCode, setNewLotCode] = useState("");
  const [newSupplierLotCode, setNewSupplierLotCode] = useState("");
  const [lotSaving, setLotSaving] = useState(false);

  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemTargetLine, setItemTargetLine] = useState<number | null>(null);
  const [locationTargetLine, setLocationTargetLine] = useState<number | null>(null);
  const [itemSaving, setItemSaving] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemCode, setNewItemCode] = useState("");
  const [newItemUnitId, setNewItemUnitId] = useState("");
  const [newItemNotes, setNewItemNotes] = useState("");

  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [locationSaving, setLocationSaving] = useState(false);
  const [newLocationCode, setNewLocationCode] = useState("");
  const [newLocationName, setNewLocationName] = useState("");

  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [attachments, setAttachments] = useState<ReceiptAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentProgress, setAttachmentProgress] = useState("");
  const [attachmentViewerReceipt, setAttachmentViewerReceipt] = useState<Receipt | null>(null);

  const [numbering, setNumbering] = useState<NumberingSettings>({
    mode: "automatic",
    prefix: "GRN-",
    nextNumber: 1,
    digits: 3,
  });

  const [numberingDraft, setNumberingDraft] = useState<NumberingSettings>({
    mode: "automatic",
    prefix: "GRN-",
    nextNumber: 1,
    digits: 3,
  });

  const [numberingOpen, setNumberingOpen] = useState(false);
  const [manualDocumentNo, setManualDocumentNo] = useState("");


  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setCurrentPage(1);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [search]);


  const loadData = useCallback(async () => {
    if (!company?.id) {
      setReceipts([]);
      setTotalReceipts(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [
        partiesResult,
        itemsResult,
        locationsResult,
        lotsResult,
        unitsResult,
        sequenceResult,
      ] = await Promise.all([
        supabase.from("parties")
          .select("id, name, party_code, party_type, is_active")
          .eq("company_id", company.id)
          .eq("is_active", true)
          .in("party_type", ["supplier", "both"])
          .order("name"),

        supabase.from("items")
          .select("id, sku, name, item_type, unit_id")
          .eq("company_id", company.id)
          .eq("is_active", true)
          .eq("item_type", "yarn")
          .order("name"),

        supabase.from("locations")
          .select("id, code, name, is_active")
          .eq("company_id", company.id)
          .eq("is_active", true)
          .order("name"),

        supabase.from("lots")
          .select("id, item_id, lot_code, supplier_lot_code")
          .eq("company_id", company.id)
          .order("lot_code"),

        supabase.from("units")
          .select("id, code, name")
          .eq("company_id", company.id)
          .order("name"),

        supabase.from("document_sequences")
          .select("mode, prefix, next_number, digits")
          .eq("company_id", company.id)
          .eq("document_type", "goods_receipt")
          .maybeSingle(),
      ]);

      let receiptQuery = supabase.from("goods_receipts")
        .select(
          "id, company_id, document_no, vendor_document_no, supplier_id, status, receipt_date, notes, posted_at, created_at",
          { count: "exact" },
        )
        .eq("company_id", company.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      const q = debouncedSearch.trim();

      if (q) {
        const safeQ = q.replace(/[,%()]/g, " ").replace(/\s+/g, " ").trim();

        const clauses = [
          `document_no.ilike.%${safeQ}%`,
          `vendor_document_no.ilike.%${safeQ}%`,
          `status.ilike.%${safeQ}%`,
        ];

        const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : null;

        const displayDateMatch = q.match(/^(\d{2})-(\d{2})-(\d{4})$/);

        const displayDate = displayDateMatch
          ? `${displayDateMatch[3]}-${displayDateMatch[2]}-${displayDateMatch[1]}`
          : null;

        const dateValue = isoDate ?? displayDate;

        if (dateValue) {
          clauses.push(`receipt_date.eq.${dateValue}`);
        }

        const matchingSupplierIds = (partiesResult.data ?? [])
          .filter((party) => party.name.toLowerCase().includes(q.toLowerCase()))
          .map((party) => party.id);

        if (matchingSupplierIds.length) {
          clauses.push(`supplier_id.in.(${matchingSupplierIds.join(",")})`);
        }

        receiptQuery = receiptQuery.or(clauses.join(","));
      }

      const from = (currentPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const receiptsResult = await receiptQuery.range(from, to);

      const sequenceData = sequenceResult.data;

      if (sequenceData) {
        const loaded: NumberingSettings = {
          mode: sequenceData.mode as "manual" | "automatic",
          prefix: sequenceData.prefix,
          nextNumber: Number(sequenceData.next_number),
          digits: Number(sequenceData.digits),
        };

        setNumbering(loaded);
        setNumberingDraft(loaded);
      }

      const firstError = [
        receiptsResult.error,
        partiesResult.error,
        itemsResult.error,
        locationsResult.error,
        lotsResult.error,
        unitsResult.error,
        sequenceResult.error,
      ].find(Boolean);

      if (firstError) {
        throw new Error(`Unable to load GRN data: ${firstError.message}`);
      }

      setReceipts((receiptsResult.data ?? []) as Receipt[]);
      setTotalReceipts(receiptsResult.count ?? 0);

      setParties((partiesResult.data ?? []) as Party[]);
      setItems((itemsResult.data ?? []) as Item[]);
      setLocations((locationsResult.data ?? []) as Location[]);
      setLots((lotsResult.data ?? []) as Lot[]);
      setUnits((unitsResult.data ?? []) as Unit[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load GRN data.");
      setReceipts([]);
      setTotalReceipts(0);
    } finally {
      setLoading(false);
    }
  }, [company?.id, currentPage, debouncedSearch]);


  useEffect(() => {
    void loadData();
  }, [loadData]);


  const totalPages = Math.max(1, Math.ceil(totalReceipts / PAGE_SIZE));


  function resetForm() {
    setSelected(null);
    setSupplierId("");
    setReceiptDate(today());
    setManualDocumentNo("");
    setVendorDocumentNo("");
    setNotes("");
    setLines([emptyLine()]);
    setAttachmentFiles([]);
    setAttachments([]);
    setError("");
  }


  function openAdd() {
    resetForm();
    setNotice("");
    setModalOpen(true);
  }


  async function openEdit(receipt: Receipt) {
    if (receipt.status !== "draft") {
      setError("Only draft receipts can be edited.");
      return;
    }

    setError("");

    const { data: lineData, error: lineError } = await supabase
      .from("goods_receipt_lines")
      .select("id, item_id, lot_id, location_id, quantity, unit_id, notes")
      .eq("company_id", company?.id)
      .eq("goods_receipt_id", receipt.id)
      .order("created_at");

    if (lineError) {
      setError(`Unable to load receipt lines: ${lineError.message}`);
      return;
    }

    setSelected(receipt);
    setSupplierId(receipt.supplier_id);
    setReceiptDate(receipt.receipt_date);
    setManualDocumentNo(receipt.document_no);
    setVendorDocumentNo(receipt.vendor_document_no ?? "");
    setNotes(receipt.notes ?? "");

    setLines((lineData ?? []).map((line) => ({
      id: line.id,
      item_id: line.item_id,
      lot_id: line.lot_id ?? "",
      location_id: line.location_id ?? "",
      quantity: String(line.quantity),
      unit_id: line.unit_id,
      notes: line.notes ?? "",
    })));

    setAttachmentFiles([]);

    const { data: attachmentData, error: attachmentError } = await supabase
      .from("goods_receipt_attachments")
      .select("*")
      .eq("company_id", company?.id)
      .eq("goods_receipt_id", receipt.id)
      .order("created_at");

    if (attachmentError) {
      setError(`Unable to load attachments: ${attachmentError.message}`);
      return;
    }

    setAttachments((attachmentData ?? []) as ReceiptAttachment[]);
    setModalOpen(true);
  }


  function closeModal() {
    if (saving || attachmentBusy) return;
    setModalOpen(false);
    resetForm();
  }


  function updateLine(index: number, field: keyof ReceiptLine, value: string) {
    setLines((current) => current.map((line, i) => {
      if (i !== index) return line;

      const updated = { ...line, [field]: value };

      if (field === "item_id") {
        updated.lot_id = "";
        updated.unit_id = items.find((item) => item.id === value)?.unit_id ?? "";
      }

      return updated;
    }));
  }


  function addLine() {
    setLines((current) => [...current, emptyLine()]);
  }


  function removeLine(index: number) {
    setLines((current) => current.filter((_, i) => i !== index));
  }


  function getDocumentNo() {
    if (numbering.mode === "manual") {
      return manualDocumentNo.trim();
    }

    return `${numbering.prefix}${String(numbering.nextNumber).padStart(numbering.digits, "0")}`;
  }


  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!company?.id) return;

    setError("");
    setNotice("");

    if (!supplierId) {
      setError("Please select a supplier.");
      return;
    }

    if (!receiptDate) {
      setError("Please select a receipt date.");
      return;
    }

    if (numbering.mode === "manual" && !manualDocumentNo.trim()) {
      setError("Please enter the GRN number.");
      return;
    }

    if (lines.length === 0) {
      setError("Add at least one receipt line.");
      return;
    }

    for (const [index, line] of lines.entries()) {
      if (!line.item_id) {
        setError(`Select an item for line ${index + 1}.`);
        return;
      }

      if (!line.location_id) {
        setError(`Select a storage location for line ${index + 1}.`);
        return;
      }

      if (!line.quantity || Number(line.quantity) <= 0) {
        setError(`Enter a valid quantity for line ${index + 1}.`);
        return;
      }

      if (!line.unit_id) {
        setError(`Select a unit for line ${index + 1}.`);
        return;
      }
    }

    setSaving(true);

    try {
      const documentNo = getDocumentNo();

      const payload = {
        p_company_id: company.id,
        p_goods_receipt_id: selected?.id ?? null,
        p_document_no: documentNo,
        p_vendor_document_no: vendorDocumentNo.trim() || null,
        p_supplier_id: supplierId,
        p_receipt_date: receiptDate,
        p_notes: notes.trim() || null,
        p_lines: lines.map((line) => ({
          item_id: line.item_id,
          lot_id: line.lot_id || null,
          location_id: line.location_id,
          quantity: Number(line.quantity),
          unit_id: line.unit_id,
          notes: line.notes.trim() || null,
        })),
      };

      const { data, error: saveError } = await supabase.rpc(
        "save_goods_receipt_draft",
        payload,
      );

      if (saveError) throw saveError;

      const receiptId = typeof data === "string"
        ? data
        : data?.id ?? selected?.id;

      if (!receiptId) {
        throw new Error("The receipt was saved, but its ID was not returned.");
      }

      if (attachmentFiles.length) {
        await uploadAttachments(receiptId);
      }

      setNotice(selected ? "Goods receipt draft updated." : "Goods receipt draft created.");
      setModalOpen(false);
      resetForm();

      setCurrentPage(1);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save goods receipt.");
    } finally {
      setSaving(false);
    }
  }


  async function postReceipt(receipt: Receipt) {
    if (!company?.id) return;

    const confirmed = window.confirm(
      `Post ${receipt.document_no}? Posting this receipt will update stock.`,
    );

    if (!confirmed) return;

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const { error: postError } = await supabase.rpc("post_goods_receipt", {
        p_company_id: company.id,
        p_goods_receipt_id: receipt.id,
      });

      if (postError) throw postError;

      setNotice(`${receipt.document_no} posted successfully. Stock has been updated.`);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to post goods receipt.");
    } finally {
      setSaving(false);
    }
  }


  async function printReceipt(receipt: Receipt) {
    if (!company?.id) return;

    const { data: lineData, error: lineError } = await supabase
      .from("goods_receipt_lines")
      .select("id, item_id, lot_id, location_id, quantity, unit_id, notes")
      .eq("company_id", company.id)
      .eq("goods_receipt_id", receipt.id)
      .order("created_at");

    if (lineError) {
      setError(`Unable to load receipt for printing: ${lineError.message}`);
      return;
    }

    const supplier = parties.find((party) => party.id === receipt.supplier_id);

    const rows = (lineData ?? []).map((line, index) => {
      const item = items.find((entry) => entry.id === line.item_id);
      const lot = lots.find((entry) => entry.id === line.lot_id);
      const location = locations.find((entry) => entry.id === line.location_id);
      const unit = units.find((entry) => entry.id === line.unit_id);

      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(item?.sku ?? "")} — ${escapeHtml(item?.name ?? "Unknown item")}</td>
          <td>${escapeHtml(lot?.lot_code ?? "—")}</td>
          <td>${escapeHtml(location?.name ?? "—")}</td>
          <td style="text-align:right">${escapeHtml(String(line.quantity))}</td>
          <td>${escapeHtml(unit?.code ?? unit?.name ?? "—")}</td>
        </tr>
      `;
    }).join("");

    const html = `
      <!doctype html>
      <html>
      <head>
        <title>${escapeHtml(receipt.document_no)}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #222; padding: 28px; }
          h1 { margin: 0 0 6px; font-size: 22px; }
          .muted { color: #666; font-size: 12px; }
          .details { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 24px 0; }
          .detail { border: 1px solid #ddd; padding: 12px; }
          .label { color: #666; font-size: 11px; margin-bottom: 5px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 9px; text-align: left; font-size: 12px; }
          th { background: #f4f4f4; }
          .notes { margin-top: 22px; border: 1px solid #ddd; padding: 12px; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <h1>Goods Receipt Note</h1>
        <div class="muted">Goods received from supplier</div>

        <div class="details">
          <div class="detail">
            <div class="label">GRN Number</div>
            <strong>${escapeHtml(receipt.document_no)}</strong>
          </div>
          <div class="detail">
            <div class="label">Receipt Date</div>
            <strong>${escapeHtml(formatDate(receipt.receipt_date))}</strong>
          </div>
          <div class="detail">
            <div class="label">Supplier</div>
            <strong>${escapeHtml(supplier?.name ?? "Unknown supplier")}</strong>
          </div>
          <div class="detail">
            <div class="label">Vendor Document Number</div>
            <strong>${escapeHtml(receipt.vendor_document_no ?? "—")}</strong>
          </div>
          <div class="detail">
            <div class="label">Status</div>
            <strong>${escapeHtml(receipt.status)}</strong>
          </div>
          <div class="detail">
            <div class="label">Posted At</div>
            <strong>${escapeHtml(receipt.posted_at ? formatDateTime(receipt.posted_at) : "Not posted")}</strong>
          </div>
        </div>

        <h3>Received Items</h3>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Yarn / Item</th>
              <th>Lot</th>
              <th>Storage Location</th>
              <th>Quantity</th>
              <th>Unit</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        ${receipt.notes ? `<section class="notes"><strong>Notes</strong><p>${escapeHtml(receipt.notes)}</p></section>` : ""}

        <script>
          window.onload = () => window.print();
        </script>
      </body>
      </html>
    `;

    const printWindow = window.open("", "_blank", "width=900,height=700");

    if (!printWindow) {
      setError("Please allow pop-ups to print the receipt.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }


  async function viewReceiptAttachments(receipt: Receipt) {
    if (!company?.id) return;

    setError("");

    const { data, error: attachmentError } = await supabase
      .from("goods_receipt_attachments")
      .select("*")
      .eq("company_id", company.id)
      .eq("goods_receipt_id", receipt.id)
      .order("created_at");

    if (attachmentError) {
      setError(`Unable to load attachments: ${attachmentError.message}`);
      return;
    }

    setAttachments((data ?? []) as ReceiptAttachment[]);
    setAttachmentViewerReceipt(receipt);
  }


  async function uploadAttachments(receiptId: string) {
    if (!company?.id || !attachmentFiles.length) return;

    setAttachmentBusy(true);
    setAttachmentProgress("Uploading attachments…");

    try {
      for (const file of attachmentFiles) {
        setAttachmentProgress(`Compressing / uploading ${file.name}…`);
        const result = await compressImage(file);
        const preparedFile = result.file;

        const filePath = `${company.id}/${receiptId}/${Date.now()}-${preparedFile.name}`;

        const { error: uploadError } = await supabase.storage
          .from("grn-attachments")
          .upload(filePath, preparedFile, {
            contentType: preparedFile.type,
            upsert: false,
          });

        if (uploadError) throw uploadError;

        const { error: insertError } = await supabase
          .from("goods_receipt_attachments")
          .insert({
            company_id: company.id,
            goods_receipt_id: receiptId,
            file_name: preparedFile.name,
            file_path: filePath,
            mime_type: preparedFile.type,
            file_size: preparedFile.size,
          });

        if (insertError) {
          await supabase.storage.from("grn-attachments").remove([filePath]);
          throw insertError;
        }
      }

      setAttachmentFiles([]);
      setAttachmentProgress("");
    } finally {
      setAttachmentBusy(false);
    }
  }


  function addAttachmentFiles(files: FileList | null) {
    if (!files) return;

    setError("");

    const incoming = Array.from(files);
    const validFiles: File[] = [];
    const rejected: string[] = [];

    for (const file of incoming) {
      try {
        validateAttachment(file);
        validFiles.push(file);
      } catch (e) {
        rejected.push(
          `${file.name}: ${e instanceof Error ? e.message : "Unsupported attachment."}`,
        );
      }
    }

    if (rejected.length) {
      setError(rejected.join(" "));
    }

    if (validFiles.length) {
      setAttachmentFiles((current) => {
        const existingKeys = new Set(
          current.map((file) => `${file.name}:${file.size}:${file.lastModified}`),
        );

        const additions = validFiles.filter(
          (file) => !existingKeys.has(`${file.name}:${file.size}:${file.lastModified}`),
        );

        return [...current, ...additions];
      });
    }
  }


  function removeAttachmentFile(index: number) {
    setAttachmentFiles((current) => current.filter((_, i) => i !== index));
  }


  async function openAttachment(attachment: ReceiptAttachment) {
    const { data, error: urlError } = await supabase.storage
      .from("grn-attachments")
      .createSignedUrl(attachment.file_path, 60);

    if (urlError || !data?.signedUrl) {
      setError(urlError?.message ?? "Unable to open attachment.");
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }


  async function deleteAttachment(attachment: ReceiptAttachment) {
    if (!company?.id) return;

    const confirmed = window.confirm(`Delete ${attachment.file_name}?`);

    if (!confirmed) return;

    const { error: storageError } = await supabase.storage
      .from("grn-attachments")
      .remove([attachment.file_path]);

    if (storageError) {
      setError(storageError.message);
      return;
    }

    const { error: deleteError } = await supabase
      .from("goods_receipt_attachments")
      .delete()
      .eq("company_id", company.id)
      .eq("id", attachment.id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setAttachments((current) => current.filter((entry) => entry.id !== attachment.id));
  }


  async function saveNumbering(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!company?.id) return;

    setSaving(true);
    setError("");

    try {
      const { error: saveError } = await supabase
        .from("document_sequences")
        .upsert({
          company_id: company.id,
          document_type: "goods_receipt",
          mode: numberingDraft.mode,
          prefix: numberingDraft.prefix,
          next_number: numberingDraft.nextNumber,
          digits: numberingDraft.digits,
        }, {
          onConflict: "company_id,document_type",
        });

      if (saveError) throw saveError;

      setNumbering(numberingDraft);
      setNumberingOpen(false);
      setNotice("GRN numbering settings saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save numbering settings.");
    } finally {
      setSaving(false);
    }
  }


  async function createVendor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!company?.id) return;

    setVendorSaving(true);
    setError("");

    try {
      const { data, error: insertError } = await supabase
        .from("parties")
        .insert({
          company_id: company.id,
          name: vendorName.trim(),
          party_code: vendorCode.trim(),
          party_type: "supplier",
          is_active: true,
        })
        .select("id, name, party_code, party_type, is_active")
        .single();

      if (insertError) throw insertError;

      setParties((current) => [...current, data as Party].sort((a, b) => a.name.localeCompare(b.name)));
      setSupplierId(data.id);
      setVendorModalOpen(false);
      setVendorName("");
      setVendorCode("");
      setNotice("Supplier created.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create supplier.");
    } finally {
      setVendorSaving(false);
    }
  }


  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!company?.id) return;

    setItemSaving(true);
    setError("");

    try {
      const { data, error: insertError } = await supabase
        .from("items")
        .insert({
          company_id: company.id,
          sku: newItemCode.trim(),
          name: newItemName.trim(),
          item_type: "yarn",
          unit_id: newItemUnitId,
          notes: newItemNotes.trim() || null,
          is_active: true,
        })
        .select("id, sku, name, item_type, unit_id")
        .single();

      if (insertError) throw insertError;

      setItems((current) => [...current, data as Item].sort((a, b) => a.name.localeCompare(b.name)));

      if (itemTargetLine !== null) {
        updateLine(itemTargetLine, "item_id", data.id);
      }

      setItemModalOpen(false);
      setNewItemName("");
      setNewItemCode("");
      setNewItemUnitId("");
      setNewItemNotes("");
      setItemTargetLine(null);
      setNotice("Yarn item created.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create item.");
    } finally {
      setItemSaving(false);
    }
  }


  async function createLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!company?.id) return;

    setLocationSaving(true);
    setError("");

    try {
      const { data, error: insertError } = await supabase
        .from("locations")
        .insert({
          company_id: company.id,
          code: newLocationCode.trim(),
          name: newLocationName.trim(),
          is_active: true,
        })
        .select("id, code, name, is_active")
        .single();

      if (insertError) throw insertError;

      setLocations((current) => [...current, data as Location].sort((a, b) => a.name.localeCompare(b.name)));

      if (locationTargetLine !== null) {
        updateLine(locationTargetLine, "location_id", data.id);
      }

      setLocationModalOpen(false);
      setNewLocationCode("");
      setNewLocationName("");
      setLocationTargetLine(null);
      setNotice("Storage location created.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create location.");
    } finally {
      setLocationSaving(false);
    }
  }


  async function createLot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!company?.id || lotModalLine === null) return;

    const lineIndex = lotModalLine;
    const line = lines[lineIndex];

    if (!line?.item_id) {
      setError("Select an item before creating a lot.");
      return;
    }

    setLotSaving(true);
    setError("");

    try {
      const { data, error: insertError } = await supabase
        .from("lots")
        .insert({
          company_id: company.id,
          item_id: line.item_id,
          lot_code: newLotCode.trim(),
          supplier_lot_code: newSupplierLotCode.trim() || null,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      const { error: linkError } = await supabase
        .from("goods_receipt_lines")
        .update({ lot_id: data.id })
        .eq("company_id", company.id)
        .eq("id", line.id ?? "");

      if (linkError && line.id) throw linkError;

      setLots((current) => [...current, {
        id: data.id,
        item_id: line.item_id,
        lot_code: newLotCode.trim(),
        supplier_lot_code: newSupplierLotCode.trim() || null,
      }]);

      updateLine(lineIndex, "lot_id", data.id);

      setLotModalLine(null);
      setNewLotCode("");
      setNewSupplierLotCode("");

      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create lot.");
    } finally {
      setLotSaving(false);
    }
  }


  if (!company?.id) {
    return <main className="page-content"><p>Your organisation could not be loaded.</p></main>;
  }


  return (
    <main className="page-content grn-page">
      <header className="page-heading">
        <div>
          <h1>Goods Receipt Notes</h1>
        </div>

        <button className="primary-button" onClick={openAdd}>
          <Plus size={17} /> Add GRN
        </button>
      </header>

      {notice && <p className="success-message" role="status">{notice}</p>}
      {error && !modalOpen && <p className="error-message" role="alert">{error}</p>}

      <section className="content-panel">
        <div className="toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search GRNs"
              placeholder="Search GRN, vendor or status"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <button
            className="secondary-button"
            onClick={() => void loadData()}
            disabled={loading}
          >
            <RefreshCw size={16} />
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2>Receipt register</h2>
            <p className="muted-text">
              {totalReceipts} {totalReceipts === 1 ? "receipt" : "receipts"}
            </p>
          </div>

          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setNumberingDraft(numbering);
              setNumberingOpen(true);
            }}
          >
            <Settings2 size={16} /> Numbering settings
          </button>
        </div>

        {loading ? (
          <p className="empty-state">Loading receipts…</p>
        ) : receipts.length === 0 ? (
          <div className="empty-state">
            <PackageCheck size={28} />
            <h3>{search ? "No matching receipts" : "No GRNs yet"}</h3>
            <p>
              {search
                ? "Try another search."
                : "Create a receipt when a vendor sends yarn to your unit."}
            </p>
            {!search && (
              <button className="primary-button" onClick={openAdd}>
                <Plus size={16} /> Add first GRN
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>GRN NO.</th>
                    <th>SUPPLIER</th>
                    <th>DATE</th>
                    <th>STATUS</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>

                <tbody>
                  {receipts.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{r.document_no}</strong></td>
                      <td>{parties.find((p) => p.id === r.supplier_id)?.name ?? "—"}</td>
                      <td>{formatDate(r.receipt_date)}</td>
                      <td>
                        <span className={r.status === "posted" ? "status-active" : "status-inactive"}>
                          {r.status}
                        </span>
                      </td>
                      <td>
                        <div className="table-actions">
                          <button className="secondary-button" onClick={() => void printReceipt(r)}>
                            <Printer size={14} /> Print
                          </button>

                          <button className="secondary-button" onClick={() => void viewReceiptAttachments(r)}>
                            <Paperclip size={14} /> Attachments
                          </button>

                          {r.status === "draft" && (
                            <>
                              <button className="secondary-button" onClick={() => void openEdit(r)}>
                                <X size={14} /> Edit
                              </button>

                              <button
                                className="primary-button"
                                onClick={() => void postReceipt(r)}
                                disabled={saving}
                              >
                                <Send size={14} /> Post
                              </button>
                            </>
                          )}

                          {r.status === "posted" && (
                            <span className="muted-text">
                              Posted {r.posted_at ? formatDateTime(r.posted_at) : ""}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalReceipts > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  marginTop: 16,
                  paddingTop: 12,
                  borderTop: "1px solid var(--border-color, #e5e7eb)",
                }}
              >
                <span className="muted-text">
                  Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                  {Math.min(currentPage * PAGE_SIZE, totalReceipts)} of {totalReceipts}
                </span>

                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={currentPage === 1 || loading}
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    aria-label="Previous page"
                  >
                    ‹
                  </button>

                  {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                    <button
                      key={page}
                      type="button"
                      className={currentPage === page ? "primary-button" : "secondary-button"}
                      disabled={loading}
                      onClick={() => setCurrentPage(page)}
                      aria-current={currentPage === page ? "page" : undefined}
                    >
                      {page}
                    </button>
                  ))}

                  <button
                    type="button"
                    className="secondary-button"
                    disabled={currentPage >= totalPages || loading}
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    aria-label="Next page"
                  >
                    ›
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>


      {modalOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <section className="modal-card grn-modal" role="dialog" aria-modal="true" aria-labelledby="grn-modal-title">
            <header className="modal-header">
              <div>
                <h2 id="grn-modal-title">
                  {selected ? `Edit ${selected.document_no}` : "Add Goods Receipt"}
                </h2>
                <p>Vendor-supplied yarn · stock increases only when posted</p>
              </div>

              <button
                className="icon-button"
                type="button"
                onClick={closeModal}
                aria-label="Close"
                disabled={saving}
              >
                <X size={20} />
              </button>
            </header>

            <form onSubmit={saveDraft}>
              <div className="modal-body">
                {error && <p className="error-message" role="alert">{error}</p>}

                <div className="form-grid">
                  <div className="form-field">
                    <label htmlFor="grn-vendor">Vendor / yarn supplier</label>
                    <select
                      id="grn-vendor"
                      required
                      value={supplierId}
                      onChange={(e) => {
                        if (e.target.value === "__add_vendor__") {
                          setVendorModalOpen(true);
                          setSupplierId("");
                        } else {
                          setSupplierId(e.target.value);
                        }
                      }}
                    >
                      <option value="">Select vendor</option>
                      {parties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.party_code} — {p.name}
                        </option>
                      ))}
                      <option value="__add_vendor__">＋ Add vendor…</option>
                    </select>
                  </div>

                  <div className="form-field">
                    <label htmlFor="grn-date">Receipt date</label>
                    <input
                      id="grn-date"
                      type="date"
                      required
                      value={receiptDate}
                      onChange={(e) => setReceiptDate(e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label htmlFor="grn-document-no">GRN number</label>
                    <input
                      id="grn-document-no"
                      value={numbering.mode === "automatic" && !selected ? getDocumentNo() : manualDocumentNo}
                      onChange={(e) => setManualDocumentNo(e.target.value)}
                      readOnly={numbering.mode === "automatic" && !selected}
                      placeholder="Enter GRN number"
                    />
                    {numbering.mode === "automatic" && !selected && (
                      <small className="muted-text">Generated automatically when saved.</small>
                    )}
                  </div>

                  <div className="form-field">
                    <label htmlFor="grn-vendor-document">Vendor document number</label>
                    <input
                      id="grn-vendor-document"
                      value={vendorDocumentNo}
                      onChange={(e) => setVendorDocumentNo(e.target.value)}
                      placeholder="Vendor invoice / delivery reference"
                    />
                  </div>
                </div>

                <div className="form-field">
                  <label htmlFor="grn-notes">Notes</label>
                  <textarea
                    id="grn-notes"
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional notes"
                  />
                </div>

                <div className="section-heading">
                  <h3>Received items</h3>
                  <button type="button" className="secondary-button" onClick={addLine}>
                    <Plus size={15} /> Add line
                  </button>
                </div>

                {lines.map((line, index) => (
                  <div className="grn-line-card" key={line.id ?? index}>
                    <div className="grn-line-heading">
                      <strong>Line {index + 1}</strong>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => removeLine(index)}
                          aria-label={`Remove line ${index + 1}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>

                    <div className="form-grid">
                      <div className="form-field">
                        <label>Yarn / item</label>
                        <select
                          required
                          value={line.item_id}
                          onChange={(e) => {
                            if (e.target.value === "__add_item__") {
                              setItemTargetLine(index);
                              setItemModalOpen(true);
                            } else {
                              updateLine(index, "item_id", e.target.value);
                            }
                          }}
                        >
                          <option value="">Select yarn</option>
                          {items.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.sku} — {item.name}
                            </option>
                          ))}
                          <option value="__add_item__">＋ Add yarn item…</option>
                        </select>
                      </div>

                      <div className="form-field">
                        <label>Lot</label>
                        <select
                          value={line.lot_id}
                          onChange={(e) => {
                            if (e.target.value === "__add_lot__") {
                              setLotModalLine(index);
                            } else {
                              updateLine(index, "lot_id", e.target.value);
                            }
                          }}
                          disabled={!line.item_id}
                        >
                          <option value="">Select lot (optional)</option>
                          {lots
                            .filter((lot) => lot.item_id === line.item_id)
                            .map((lot) => (
                              <option key={lot.id} value={lot.id}>
                                {lot.lot_code}
                                {lot.supplier_lot_code ? ` — ${lot.supplier_lot_code}` : ""}
                              </option>
                            ))}
                          <option value="__add_lot__">＋ Add lot…</option>
                        </select>
                      </div>

                      <div className="form-field">
                        <label>Storage location</label>
                        <select
                          required
                          value={line.location_id}
                          onChange={(e) => {
                            if (e.target.value === "__add_location__") {
                              setLocationTargetLine(index);
                              setLocationModalOpen(true);
                            } else {
                              updateLine(index, "location_id", e.target.value);
                            }
                          }}
                        >
                          <option value="">Select location</option>
                          {locations.map((location) => (
                            <option key={location.id} value={location.id}>
                              {location.code} — {location.name}
                            </option>
                          ))}
                          <option value="__add_location__">＋ Add location…</option>
                        </select>
                      </div>

                      <div className="form-field">
                        <label>Quantity</label>
                        <input
                          type="number"
                          min="0.001"
                          step="any"
                          required
                          value={line.quantity}
                          onChange={(e) => updateLine(index, "quantity", e.target.value)}
                          placeholder="0.000"
                        />
                      </div>

                      <div className="form-field">
                        <label>Unit</label>
                        <select
                          required
                          value={line.unit_id}
                          onChange={(e) => updateLine(index, "unit_id", e.target.value)}
                        >
                          <option value="">Select unit</option>
                          {units.map((unit) => (
                            <option key={unit.id} value={unit.id}>
                              {unit.code} — {unit.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="form-field">
                        <label>Line notes</label>
                        <input
                          value={line.notes}
                          onChange={(e) => updateLine(index, "notes", e.target.value)}
                          placeholder="Optional"
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <div className="form-field">
                  <label htmlFor="grn-attachments">Attachments</label>
                  <input
                    id="grn-attachments"
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) => addAttachmentFiles(e.target.files)}
                  />
                  <small className="muted-text">Maximum 5 MB per file. JPG, PNG and WebP images are converted to compressed WebP before upload. PDFs are uploaded unchanged.</small>
                </div>

                {attachmentFiles.length > 0 && (
                  <div className="attachment-list">
                    {attachmentFiles.map((file, index) => (
                      <div className="attachment-row" key={`${file.name}-${file.lastModified}`}>
                        <span>{file.name}</span>
                        <button type="button" className="icon-button" onClick={() => removeAttachmentFile(index)}>
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {attachments.length > 0 && (
                  <div className="attachment-list">
                    <h4>Existing attachments</h4>
                    {attachments.map((attachment) => (
                      <div className="attachment-row" key={attachment.id}>
                        <span>{attachment.file_name}</span>
                        <div className="table-actions">
                          <button type="button" className="secondary-button" onClick={() => void openAttachment(attachment)}>
                            <Eye size={14} /> View
                          </button>
                          {selected?.status === "draft" && (
                            <button type="button" className="secondary-button" onClick={() => void deleteAttachment(attachment)}>
                              <Trash2 size={14} /> Delete
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {attachmentProgress && <p className="muted-text">{attachmentProgress}</p>}
              </div>

              <footer className="modal-footer">
                <button type="button" className="secondary-button" onClick={closeModal} disabled={saving || attachmentBusy}>
                  Cancel
                </button>

                <button type="submit" className="primary-button" disabled={saving || attachmentBusy}>
                  {saving ? "Saving…" : selected ? "Update draft" : "Save draft"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}


      {vendorModalOpen && (
        <div className="modal-backdrop">
          <section className="modal-card" role="dialog" aria-modal="true">
            <header className="modal-header">
              <h2>Add supplier</h2>
              <button type="button" className="icon-button" onClick={() => setVendorModalOpen(false)}>
                <X size={18} />
              </button>
            </header>

            <form onSubmit={createVendor}>
              <div className="modal-body">
                <div className="form-field">
                  <label>Supplier code</label>
                  <input required value={vendorCode} onChange={(e) => setVendorCode(e.target.value)} />
                </div>

                <div className="form-field">
                  <label>Supplier name</label>
                  <input required value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
                </div>
              </div>

              <footer className="modal-footer">
                <button type="button" className="secondary-button" onClick={() => setVendorModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={vendorSaving}>
                  {vendorSaving ? "Saving…" : "Create supplier"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}


      {itemModalOpen && (
        <div className="modal-backdrop">
          <section className="modal-card" role="dialog" aria-modal="true">
            <header className="modal-header">
              <h2>Add yarn item</h2>
              <button type="button" className="icon-button" onClick={() => setItemModalOpen(false)}>
                <X size={18} />
              </button>
            </header>

            <form onSubmit={createItem}>
              <div className="modal-body">
                <div className="form-field">
                  <label>Item code</label>
                  <input required value={newItemCode} onChange={(e) => setNewItemCode(e.target.value)} />
                </div>

                <div className="form-field">
                  <label>Item name</label>
                  <input required value={newItemName} onChange={(e) => setNewItemName(e.target.value)} />
                </div>

                <div className="form-field">
                  <label>Unit</label>
                  <select required value={newItemUnitId} onChange={(e) => setNewItemUnitId(e.target.value)}>
                    <option value="">Select unit</option>
                    {units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.code} — {unit.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-field">
                  <label>Notes</label>
                  <textarea rows={2} value={newItemNotes} onChange={(e) => setNewItemNotes(e.target.value)} />
                </div>
              </div>

              <footer className="modal-footer">
                <button type="button" className="secondary-button" onClick={() => setItemModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={itemSaving}>
                  {itemSaving ? "Saving…" : "Create item"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}


      {locationModalOpen && (
        <div className="modal-backdrop">
          <section className="modal-card" role="dialog" aria-modal="true">
            <header className="modal-header">
              <h2>Add storage location</h2>
              <button type="button" className="icon-button" onClick={() => setLocationModalOpen(false)}>
                <X size={18} />
              </button>
            </header>

            <form onSubmit={createLocation}>
              <div className="modal-body">
                <div className="form-field">
                  <label>Location code</label>
                  <input required value={newLocationCode} onChange={(e) => setNewLocationCode(e.target.value)} />
                </div>

                <div className="form-field">
                  <label>Location name</label>
                  <input required value={newLocationName} onChange={(e) => setNewLocationName(e.target.value)} />
                </div>
              </div>

              <footer className="modal-footer">
                <button type="button" className="secondary-button" onClick={() => setLocationModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={locationSaving}>
                  {locationSaving ? "Saving…" : "Create location"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}


      {lotModalLine !== null && (
        <div className="modal-backdrop">
          <section className="modal-card" role="dialog" aria-modal="true">
            <header className="modal-header">
              <h2>Add lot</h2>
              <button type="button" className="icon-button" onClick={() => setLotModalLine(null)}>
                <X size={18} />
              </button>
            </header>

            <form onSubmit={createLot}>
              <div className="modal-body">
                <div className="form-field">
                  <label>Lot code</label>
                  <input required value={newLotCode} onChange={(e) => setNewLotCode(e.target.value)} />
                </div>

                <div className="form-field">
                  <label>Supplier lot code</label>
                  <input value={newSupplierLotCode} onChange={(e) => setNewSupplierLotCode(e.target.value)} />
                </div>
              </div>

              <footer className="modal-footer">
                <button type="button" className="secondary-button" onClick={() => setLotModalLine(null)}>
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={lotSaving}>
                  {lotSaving ? "Saving…" : "Create lot"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}


      {numberingOpen && (
        <div className="modal-backdrop">
          <section className="modal-card" role="dialog" aria-modal="true">
            <header className="modal-header">
              <h2>GRN numbering settings</h2>
              <button type="button" className="icon-button" onClick={() => setNumberingOpen(false)}>
                <X size={18} />
              </button>
            </header>

            <form onSubmit={saveNumbering}>
              <div className="modal-body">
                <div className="form-field">
                  <label>Numbering mode</label>
                  <select
                    value={numberingDraft.mode}
                    onChange={(e) => setNumberingDraft((current) => ({
                      ...current,
                      mode: e.target.value as NumberingSettings["mode"],
                    }))}
                  >
                    <option value="automatic">Automatic</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>

                <div className="form-field">
                  <label>Prefix</label>
                  <input
                    value={numberingDraft.prefix}
                    onChange={(e) => setNumberingDraft((current) => ({ ...current, prefix: e.target.value }))}
                  />
                </div>

                <div className="form-field">
                  <label>Next number</label>
                  <input
                    type="number"
                    min="1"
                    value={numberingDraft.nextNumber}
                    onChange={(e) => setNumberingDraft((current) => ({
                      ...current,
                      nextNumber: Number(e.target.value),
                    }))}
                  />
                </div>

                <div className="form-field">
                  <label>Number of digits</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={numberingDraft.digits}
                    onChange={(e) => setNumberingDraft((current) => ({
                      ...current,
                      digits: Number(e.target.value),
                    }))}
                  />
                </div>

                <p className="muted-text">
                  Preview: {numberingDraft.prefix}{String(numberingDraft.nextNumber).padStart(numberingDraft.digits, "0")}
                </p>
              </div>

              <footer className="modal-footer">
                <button type="button" className="secondary-button" onClick={() => setNumberingOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={saving}>
                  {saving ? "Saving…" : "Save settings"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}


      {attachmentViewerReceipt && (
        <div className="modal-backdrop">
          <section className="modal-card" role="dialog" aria-modal="true">
            <header className="modal-header">
              <div>
                <h2>Attachments</h2>
                <p>{attachmentViewerReceipt.document_no}</p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setAttachmentViewerReceipt(null)}
              >
                <X size={18} />
              </button>
            </header>

            <div className="modal-body">
              {attachments.length === 0 ? (
                <p className="empty-state">No attachments found.</p>
              ) : (
                <div className="attachment-list">
                  {attachments.map((attachment) => (
                    <div className="attachment-row" key={attachment.id}>
                      <div>
                        <strong>{attachment.file_name}</strong>
                        <p className="muted-text">
                          {(attachment.file_size / 1024).toFixed(1)} KB
                        </p>
                      </div>

                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void openAttachment(attachment)}
                      >
                        <Eye size={14} /> View
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <footer className="modal-footer">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setAttachmentViewerReceipt(null)}
              >
                Close
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
