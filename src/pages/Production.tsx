import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Search, Send, Pencil, X, ClipboardList, AlertTriangle, Paperclip, Trash2, Settings2, Eye } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";
import { formatDate } from "../lib/dateUtils";
import { compressImage, validateAttachment } from "../lib/imageCompression";

type Item = { id: string; sku: string; name: string; item_type: string; unit_id: string; is_active: boolean };
type Unit = { id: string; code: string; name: string };
type Location = { id: string; code: string; name: string };
type Bom = { id: string; code: string; name: string; output_item_id: string; output_quantity: number; is_active: boolean };
type Production = {
  id: string; order_no: string; bom_id: string; output_item_id: string; planned_quantity: number;
  produced_quantity: number; status: string; production_date: string; shift: string | null;
  stock_location_id: string | null; notes: string | null; created_at: string;
};
type Component = { item_id: string; composition_percent: string };
type BomConsumptionComponent = {
  id: string;
  bom_id: string;
  item_id: string;
  composition_percent: number;
};
type NumberingSettings = { mode: "manual" | "automatic"; prefix: string; nextNumber: number; digits: number };
type ProductionAttachment = { id: string; production_id: string; file_name: string; storage_path: string; mime_type: string; size_bytes: number; created_at: string };
const today = () => new Date().toISOString().slice(0, 10);

export default function Production() {
  const { company, loading: companyLoading, error: companyError } = useCompany();
  const [items, setItems] = useState<Item[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
  const [rows, setRows] = useState<Production[]>([]);
  const [loading, setLoading] = useState(false);
  const PAGE_SIZE = 10;
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [allCount, setAllCount] = useState(0);
  const [draftCount, setDraftCount] = useState(0);
  const [postedCount, setPostedCount] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPosted, setEditingPosted] = useState(false);
  const [productionNo, setProductionNo] = useState("");
  const [numberMode, setNumberMode] = useState<"automatic" | "manual">("automatic");
  const [numbering, setNumbering] = useState<NumberingSettings>({ mode: "automatic", prefix: "PRD-", nextNumber: 1, digits: 3 });
  const [numberingDraft, setNumberingDraft] = useState<NumberingSettings>({ mode: "automatic", prefix: "PRD-", nextNumber: 1, digits: 3 });
  const [numberingOpen, setNumberingOpen] = useState(false);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [savedAttachments, setSavedAttachments] = useState<ProductionAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [productionDate, setProductionDate] = useState(today());
  const [outputItemId, setOutputItemId] = useState("");
  const [bomId, setBomId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [consumptionComponents, setConsumptionComponents] = useState<BomConsumptionComponent[]>([]);
  const [consumptionLoading, setConsumptionLoading] = useState(false);
  const [consumptionError, setConsumptionError] = useState("");
  const [shift, setShift] = useState("");
  const [locationId, setLocationId] = useState("");
  const [notes, setNotes] = useState("");

  const [itemModal, setItemModal] = useState(false);
  const [itemSku, setItemSku] = useState("");
  const [itemName, setItemName] = useState("");
  const [itemType, setItemType] = useState("finished_good");
  const [itemUnit, setItemUnit] = useState("");
  const [itemNotes, setItemNotes] = useState("");

  const [bomModal, setBomModal] = useState(false);
  const [bomCode, setBomCode] = useState("");
  const [bomName, setBomName] = useState("");
  const [bomOutputQuantity, setBomOutputQuantity] = useState("1");
  const [bomOutputItemId, setBomOutputItemId] = useState("");
  const [bomIsActive, setBomIsActive] = useState(true);
  const [bomComponents, setBomComponents] = useState<Component[]>([{ item_id: "", composition_percent: "100" }]);

  const loadProductionRows = useCallback(async () => {
    if (!company?.id) return;
    setLoading(true);
    setError("");
    try {
      const from = (currentPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let query = supabase
        .from("production_orders")
        .select("id, order_no, bom_id, output_item_id, planned_quantity, produced_quantity, status, production_date, shift, stock_location_id, notes, created_at", { count: "exact" })
        .eq("company_id", company.id);

      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      if (debouncedSearch.trim()) {
        const term = debouncedSearch.trim().replace(/[,%()]/g, " ").replace(/\s+/g, " ");
        const pattern = `%${term}%`;
        const matchingItemIds = items
          .filter(item => `${item.name} ${item.sku}`.toLowerCase().includes(term.toLowerCase()))
          .map(item => item.id);
        const clauses = [`order_no.ilike.${pattern}`, `notes.ilike.${pattern}`];
        if (matchingItemIds.length) clauses.push(`output_item_id.in.(${matchingItemIds.join(",")})`);
        query = query.or(clauses.join(","));
      }

      const { data, error: rowsError, count } = await query
        .order("production_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (rowsError) throw rowsError;
      setRows((data ?? []) as Production[]);
      setTotalRows(count ?? 0);

    } catch (e: any) {
      setError(e?.message ?? "Could not load production records.");
    } finally {
      setLoading(false);
    }
  }, [company?.id, currentPage, statusFilter, debouncedSearch, items]);

  const loadSummaryCounts = useCallback(async () => {
    if (!company?.id) return;
    const [allRes, draftsRes, postedRes] = await Promise.all([
      supabase.from("production_orders").select("id", { count: "exact", head: true }).eq("company_id", company.id),
      supabase.from("production_orders").select("id", { count: "exact", head: true }).eq("company_id", company.id).eq("status", "draft"),
      supabase.from("production_orders").select("id", { count: "exact", head: true }).eq("company_id", company.id).eq("status", "posted"),
    ]);
    if (allRes.error || draftsRes.error || postedRes.error) {
      setError(allRes.error?.message ?? draftsRes.error?.message ?? postedRes.error?.message ?? "Could not load production totals.");
      return;
    }
    setAllCount(allRes.count ?? 0);
    setDraftCount(draftsRes.count ?? 0);
    setPostedCount(postedRes.count ?? 0);
  }, [company?.id]);

  const loadData = useCallback(async () => {
    if (!company?.id) return;
    setError("");
    try {
      const [itemsRes, unitsRes, locationsRes, bomsRes, seqRes] = await Promise.all([
        supabase.from("items").select("id, sku, name, item_type, unit_id, is_active").eq("company_id", company.id).eq("is_active", true).order("name"),
        supabase.from("units").select("id, code, name").eq("company_id", company.id).order("name"),
        supabase.from("locations").select("id, code, name").eq("company_id", company.id).eq("is_active", true).order("name"),
        supabase.from("boms").select("id, code, name, output_item_id, output_quantity, is_active").eq("company_id", company.id).eq("is_active", true).order("name"),
        supabase.from("document_sequences").select("mode, prefix, next_number, digits").eq("company_id", company.id).eq("document_type", "production").maybeSingle(),
      ]);
      for (const r of [itemsRes, unitsRes, locationsRes, bomsRes]) if (r.error) throw r.error;
      setItems((itemsRes.data ?? []) as Item[]);
      setUnits((unitsRes.data ?? []) as Unit[]);
      setLocations((locationsRes.data ?? []) as Location[]);
      setBoms((bomsRes.data ?? []) as Bom[]);
      if (seqRes.data) {
        const settings: NumberingSettings = {
          mode: seqRes.data.mode === "manual" ? "manual" : "automatic",
          prefix: seqRes.data.prefix ?? "PRD-",
          nextNumber: Number(seqRes.data.next_number ?? 1),
          digits: Number(seqRes.data.digits ?? 3),
        };
        setNumberMode(settings.mode);
        setNumbering(settings);
        setNumberingDraft(settings);
      }
    } catch (e: any) {
      setError(e?.message ?? "Could not load production supporting data.");
    }
  }, [company?.id]);

  useEffect(() => { void loadData(); void loadSummaryCounts(); }, [loadData, loadSummaryCounts]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 350);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => { setCurrentPage(1); }, [debouncedSearch, statusFilter]);
  useEffect(() => { void loadProductionRows(); }, [loadProductionRows]);


  const fabricItems = useMemo(
    () => items.filter(i => ["fabric", "finished_good", "finished goods", "work_in_progress"].includes(i.item_type.toLowerCase())),
    [items]
  );
  const yarnItems = useMemo(
    () => items.filter(i => ["yarn", "material", "other", "raw_material", "raw material"].includes(i.item_type.toLowerCase())),
    [items]
  );
  const matchingBoms = useMemo(() => boms.filter(b => b.output_item_id === outputItemId), [boms, outputItemId]);
  const selectedBom = boms.find(b => b.id === bomId);

  // Load the selected BOM recipe so the production form can show the
  // estimated quantity of each yarn before the record is posted.
  useEffect(() => {
    let cancelled = false;

    const loadConsumptionComponents = async () => {
      if (!company?.id || !bomId) {
        setConsumptionComponents([]);
        setConsumptionError("");
        setConsumptionLoading(false);
        return;
      }

      setConsumptionLoading(true);
      setConsumptionError("");

      const { data, error: componentError } = await supabase
        .from("bom_components")
        .select("id, bom_id, item_id, composition_percent")
        .eq("company_id", company.id)
        .eq("bom_id", bomId);

      if (cancelled) return;

      if (componentError) {
        setConsumptionComponents([]);
        setConsumptionError(componentError.message);
      } else {
        setConsumptionComponents((data ?? []) as BomConsumptionComponent[]);
      }

      setConsumptionLoading(false);
    };

    void loadConsumptionComponents();
    return () => { cancelled = true; };
  }, [company?.id, bomId]);

  const productionQuantity = Number(quantity);
  const bomBasisQuantity = Number(selectedBom?.output_quantity ?? 0);
  const consumptionScale = productionQuantity > 0 && bomBasisQuantity > 0
    ? productionQuantity / bomBasisQuantity
    : 0;
  const formatConsumption = (value: number) => value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });

  const unitLabel = (itemId: string) => {
    const item = items.find(i => i.id === itemId);
    const unit = units.find(u => u.id === item?.unit_id);
    return unit?.code ?? unit?.name ?? "";
  };
  const calculatedConsumption = consumptionComponents.map(component => {
    const item = items.find(i => i.id === component.item_id);
    return {
      ...component,
      item,
      amount: consumptionScale * (Number(component.composition_percent) / 100),
      unit: item ? unitLabel(item.id) : "",
    };
  });

  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const pageStart = totalRows === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(currentPage * PAGE_SIZE, totalRows);

  const resetForm = () => {
    setEditingId(null); setEditingPosted(false); setProductionNo(""); setProductionDate(today());
    setOutputItemId(""); setBomId(""); setQuantity(""); setShift(""); setLocationId(""); setNotes("");
    setAttachmentFiles([]); setSavedAttachments([]); setNumberingOpen(false);
  };

  const openNew = async () => {
    if (!company?.id) return;
    resetForm();
    setError(""); setNotice("");
    const { data: seq, error: seqError } = await supabase.from("document_sequences")
      .select("mode, prefix, next_number, digits")
      .eq("company_id", company.id)
      .eq("document_type", "production")
      .maybeSingle();

    if (seqError) { setError(seqError.message); return; }

    const mode = seq?.mode === "manual" ? "manual" : "automatic";
    const settings: NumberingSettings = {
      mode,
      prefix: seq?.prefix || "PRD-",
      nextNumber: Math.max(1, Number(seq?.next_number) || 1),
      digits: Math.max(2, Number(seq?.digits) || 3),
    };

    setNumbering(settings);
    setNumberingDraft(settings);
    setNumberMode(mode);

    // Display a preview only. Do NOT call next_document_code here:
    // that RPC advances the sequence even if the form is later cancelled.
    if (mode === "automatic") {
      setProductionNo(`${settings.prefix}${String(settings.nextNumber).padStart(settings.digits, "0")}`);
    } else {
      setProductionNo("");
    }

    setFormOpen(true);
  };

  const openEdit = async (row: Production) => {
    setEditingId(row.id);
    setEditingPosted(row.status === "posted");
    setProductionNo(row.order_no);
    setProductionDate(row.production_date || today());
    setOutputItemId(row.output_item_id);
    setBomId(row.bom_id);
    setQuantity(String(row.planned_quantity));
    setShift(row.shift ?? "");
    setLocationId(row.stock_location_id ?? "");
    setNotes(row.notes ?? "");
    setAttachmentFiles([]);
    setSavedAttachments([]);
    setError(""); setNotice(""); setFormOpen(true);
    if (company?.id) {
      const { data, error: attachmentError } = await supabase.from("production_attachments")
        .select("id, production_id, file_name, storage_path, mime_type, size_bytes, created_at")
        .eq("company_id", company.id).eq("production_id", row.id).order("created_at");
      if (attachmentError) setError(`Unable to load production attachments: ${attachmentError.message}`);
      else setSavedAttachments((data ?? []) as ProductionAttachment[]);
    }
  };

  const saveDraft = async (postAfterSave = false) => {
    if (!company?.id) return;
    if (!productionNo.trim() || !productionDate || !outputItemId || !bomId || !quantity || Number(quantity) <= 0) {
      setError("Enter the production number, date, output item, BOM, and a quantity greater than zero."); return;
    }
    if (numberMode === "automatic" && !editingId && !productionNo.startsWith(numbering.prefix)) {
      setError("Automatic production number is not ready. Refresh and try again."); return;
    }
    if (editingPosted) {
      const confirmed = window.confirm("This production is already posted. Editing it will reverse its existing stock movements and post the revised yarn consumption and fabric output. Continue?");
      if (!confirmed) return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      let productionId = editingId;
      let numberToSave = productionNo.trim();
      if (editingPosted && editingId) {
        const { error: editError } = await supabase.rpc("edit_posted_production", {
          p_company_id: company.id, p_production_id: editingId, p_production_no: productionNo.trim(),
          p_production_date: productionDate, p_output_item_id: outputItemId, p_bom_id: bomId,
          p_production_quantity: Number(quantity), p_shift: shift.trim() || null,
          p_stock_location_id: locationId || null, p_notes: notes.trim() || null, p_confirm: true,
        });
        if (editError) throw editError;
        setNotice("Posted production updated and stock movements recalculated.");
      } else {
        // Allocate the next automatic number only when the user actually saves.
        // Opening and cancelling the form now leaves the sequence untouched.
        if (numberMode === "automatic" && !editingId) {
          const { data: generatedCode, error: codeError } = await supabase.rpc(
            "next_document_code",
            { p_company_id: company.id, p_document_type: "production" }
          );
          if (codeError) throw codeError;
          if (typeof generatedCode !== "string" || !generatedCode) {
            throw new Error("Could not generate the production number.");
          }
          numberToSave = generatedCode;
          setProductionNo(generatedCode);
        }

        const { data, error: saveError } = await supabase.rpc("save_production_draft", {
          p_company_id: company.id, p_production_id: editingId,
          p_production_no: numberToSave, p_production_date: productionDate,
          p_output_item_id: outputItemId, p_bom_id: bomId, p_production_quantity: Number(quantity),
          p_shift: shift.trim() || null, p_stock_location_id: locationId || null, p_notes: notes.trim() || null,
        });
        if (saveError) throw saveError;
        productionId = data as string;
        if (productionId) setEditingId(productionId);
        if (productionId && attachmentFiles.length > 0) {
          await uploadProductionAttachments(productionId);
        }
        if (postAfterSave && productionId) {
          const { error: postError } = await supabase.rpc("post_production", { p_company_id: company.id, p_production_id: productionId });
          if (postError) throw postError;
          setNotice("Production posted. Yarn stock decreased and fabric stock increased.");
        } else setNotice("Production draft saved.");
      }
      setFormOpen(false); resetForm(); await Promise.all([loadProductionRows(), loadSummaryCounts()]);
    } catch (e: any) {
      setError(e?.message ?? "Could not save production.");
    } finally { setSaving(false); }
  };

  const postExisting = async (row: Production) => {
    if (!company?.id) return;
    if (!window.confirm(`Post ${row.order_no}? This will deduct yarn according to the BOM and add the produced fabric to stock.`)) return;
    setSaving(true); setError(""); setNotice("");
    const { error: postError } = await supabase.rpc("post_production", { p_company_id: company.id, p_production_id: row.id });
    setSaving(false);
    if (postError) setError(postError.message);
    else { setNotice(`${row.order_no} posted successfully.`); await Promise.all([loadProductionRows(), loadSummaryCounts()]); }
  };

  const openAddItem = async () => {
    setItemName(""); setItemType("finished_good"); setItemUnit(units[0]?.id ?? ""); setItemNotes("");
    setItemSku("");
    if (company?.id) {
      const { data, error: e } = await supabase.rpc("next_document_code", { p_company_id: company.id, p_document_type: "item" });
      if (e) { setError(e.message); return; }
      setItemSku(String(data ?? ""));
    }
    setItemModal(true);
  };

  const saveItem = async () => {
    if (!company?.id || !itemName.trim() || !itemSku.trim() || !itemUnit) { setError("Enter item name, code, and unit."); return; }
    setSaving(true); setError("");
    const { data, error: insertError } = await supabase.from("items").insert({
      company_id: company.id, sku: itemSku.trim(), name: itemName.trim(),
      item_type: itemType, unit_id: itemUnit, is_active: true, notes: itemNotes.trim() || null,
    }).select("id, sku, name, item_type, unit_id, is_active").single();
    setSaving(false);
    if (insertError) { setError(insertError.message); return; }
    setItems(prev => [...prev, data as Item]);
    if (["finished_good", "work_in_progress"].includes(itemType)) setOutputItemId(data.id);
    setItemModal(false);
    setNotice("Item created.");
  };

  const openAddBom = () => {
    setError("");
    setBomCode("");
    setBomName("");
    setBomOutputQuantity("1");
    setBomOutputItemId(outputItemId || "");
    setBomIsActive(true);
    setBomComponents([{ item_id: yarnItems[0]?.id ?? "", composition_percent: "100" }]);
    setBomModal(true);
  };

  const saveBom = async () => {
    if (!company?.id || !bomOutputItemId || !bomCode.trim() || !bomName.trim() || Number(bomOutputQuantity) <= 0) {
      setError("Enter BOM code, name, output item, and a valid output quantity."); return;
    }
    if (!bomComponents.length || bomComponents.some(c => !c.item_id || Number(c.composition_percent) <= 0)) {
      setError("Add valid yarn components and composition percentages."); return;
    }
    const total = bomComponents.reduce((sum, c) => sum + Number(c.composition_percent || 0), 0);
    if (Math.abs(total - 100) > 0.0001) { setError(`BOM composition must total 100%. Current total: ${total}%.`); return; }
    const uniqueComponents = new Set(bomComponents.map(c => c.item_id));
    if (uniqueComponents.size !== bomComponents.length) { setError("Each yarn component can only be added once."); return; }
    setSaving(true); setError("");
    const { error: bomError } = await supabase.rpc("save_bom_with_components", {
      p_company_id: company.id, p_bom_id: null, p_code: bomCode.trim(), p_name: bomName.trim(),
      p_output_item_id: bomOutputItemId, p_output_quantity: Number(bomOutputQuantity),
      p_is_active: bomIsActive,
      p_components: bomComponents.map(c => ({ item_id: c.item_id, composition_percent: Number(c.composition_percent) })),
    });
    if (bomError) { setSaving(false); setError(`Unable to save BOM: ${bomError.message}`); return; }
    // The existing BOM RPC may return void rather than a UUID. Reload the authoritative row.
    const { data: refreshedBoms, error: reloadError } = await supabase.from("boms")
      .select("id, code, name, output_item_id, output_quantity, is_active")
      .eq("company_id", company.id).eq("is_active", true).order("name");
    setSaving(false);
    if (reloadError) { setError(`BOM was saved, but the list could not be refreshed: ${reloadError.message}`); return; }
    const list = (refreshedBoms ?? []) as Bom[];
    setBoms(list);
    const newBom = list.find(b => b.code === bomCode.trim() && b.output_item_id === bomOutputItemId);
    if (!newBom) { setError("BOM save completed, but the new BOM was not returned in the active BOM list. Check that it is active and belongs to the selected fabric item."); return; }
    setOutputItemId(newBom.output_item_id);
    setBomId(newBom.id);
    setBomModal(false);
    setNotice("BOM created and loaded into the production form.");
  };

  const saveNumberingSettings = async () => {
    if (!company?.id) return;
    if (numberingDraft.mode === "automatic" && !numberingDraft.prefix.trim()) {
      setError("Enter a production number prefix.");
      return;
    }
    const { error: saveError } = await supabase.from("document_sequences").upsert({
      company_id: company.id,
      document_type: "production",
      mode: numberingDraft.mode,
      prefix: numberingDraft.prefix.trim(),
      next_number: numberingDraft.nextNumber,
      digits: numberingDraft.digits,
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_id,document_type" });
    if (saveError) { setError(saveError.message); return; }
    setNumbering({ ...numberingDraft });
    setNumberMode(numberingDraft.mode);
    setNumberingOpen(false);
    setNotice("Production numbering settings saved.");
    if (!editingId && numberingDraft.mode === "automatic") {
      const preview = `${numberingDraft.prefix}${String(numberingDraft.nextNumber).padStart(numberingDraft.digits, "0")}`;
      setProductionNo(preview);
    }
  };

  const addAttachmentFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setError("");
    const validFiles: File[] = [];
    const rejected: string[] = [];
    Array.from(fileList).forEach(file => {
      try {
        validateAttachment(file);
        validFiles.push(file);
      } catch (e: any) {
        rejected.push(`${file.name}: ${e?.message ?? "Unsupported attachment."}`);
      }
    });
    if (rejected.length) setError(rejected.join(" "));
    if (!validFiles.length) return;
    setAttachmentFiles(current => {
      const keys = new Set(current.map(file => `${file.name}:${file.size}:${file.lastModified}`));
      return [...current, ...validFiles.filter(file => !keys.has(`${file.name}:${file.size}:${file.lastModified}`))];
    });
  };

  async function uploadProductionAttachments(productionId: string) {
    if (!company?.id || !attachmentFiles.length) return;
    setAttachmentBusy(true);
    const uploadedPaths: string[] = [];
    try {
      const prepared = await Promise.all(attachmentFiles.map(async originalFile => {
        validateAttachment(originalFile);
        const result = await compressImage(originalFile);
        return { originalFile, file: result.file };
      }));
      for (const { originalFile, file } of prepared) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${company.id}/${productionId}/${crypto.randomUUID()}-${safeName}`;
        const { error: uploadError } = await supabase.storage.from("production-attachments").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
        if (uploadError) throw uploadError;
        uploadedPaths.push(path);
        const { error: metadataError } = await supabase.from("production_attachments").insert({ company_id: company.id, production_id: productionId, file_name: originalFile.name, storage_path: path, mime_type: file.type || originalFile.type, size_bytes: file.size });
        if (metadataError) throw metadataError;
      }
      setAttachmentFiles([]);
      const { data, error: reloadError } = await supabase.from("production_attachments").select("id, production_id, file_name, storage_path, mime_type, size_bytes, created_at").eq("company_id", company.id).eq("production_id", productionId).order("created_at");
      if (reloadError) throw reloadError;
      setSavedAttachments((data ?? []) as ProductionAttachment[]);
    } catch (e) {
      if (uploadedPaths.length) {
        await supabase.from("production_attachments").delete().eq("company_id", company.id).in("storage_path", uploadedPaths);
        await supabase.storage.from("production-attachments").remove(uploadedPaths);
      }
      throw e;
    } finally { setAttachmentBusy(false); }
  }

  async function openProductionAttachment(attachment: ProductionAttachment) {
    const { data, error: urlError } = await supabase.storage.from("production-attachments").createSignedUrl(attachment.storage_path, 60);
    if (urlError || !data?.signedUrl) { setError(`Unable to open attachment: ${urlError?.message ?? "No viewing link returned."}`); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function deleteProductionAttachment(attachment: ProductionAttachment) {
    if (!company?.id || !editingId || editingPosted) return;
    if (!window.confirm(`Delete attachment \"${attachment.file_name}\"?`)) return;
    const { error: storageError } = await supabase.storage.from("production-attachments").remove([attachment.storage_path]);
    if (storageError) { setError(`Unable to delete file: ${storageError.message}`); return; }
    const { error: rowError } = await supabase.from("production_attachments").delete().eq("id", attachment.id).eq("company_id", company.id);
    if (rowError) { setError(`File removed, but metadata could not be deleted: ${rowError.message}`); return; }
    setSavedAttachments(current => current.filter(a => a.id !== attachment.id));
  }

  if (companyLoading) return <div className="p-6 text-sm text-slate-500">Loading company…</div>;
  if (companyError) return <div className="p-6 text-sm text-red-600">{companyError}</div>;

  return (
    <div className="production-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-blue-600" /><h1 className="text-xl font-semibold text-slate-900">Production</h1></div>
          
        </div>
        <div className="flex gap-2">
          <button onClick={() => { void loadData(); void loadProductionRows(); void loadSummaryCounts(); }} className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"><RefreshCw className="h-4 w-4" />Refresh</button>
          <button onClick={() => void openNew()} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"><Plus className="h-4 w-4" />New Production</button>
        </div>
      </div>

      {(error || companyError) && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error || companyError}</div>}
      {notice && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}

      <div className="production-summary-grid grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4"><div className="text-xs text-slate-500">Total records</div><div className="mt-1 text-2xl font-semibold">{allCount.toLocaleString()}</div></div>
        <div className="rounded-lg border border-slate-200 bg-white p-4"><div className="text-xs text-slate-500">Drafts</div><div className="mt-1 text-2xl font-semibold">{draftCount.toLocaleString()}</div></div>
        <div className="rounded-lg border border-slate-200 bg-white p-4"><div className="text-xs text-slate-500">Posted</div><div className="mt-1 text-2xl font-semibold">{postedCount.toLocaleString()}</div></div>
      </div>

      <div className="production-toolbar flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }} placeholder="Search production number, fabric, notes…" className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm" /></div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setCurrentPage(1); }} className="rounded-md border border-slate-300 px-3 py-2 text-sm"><option value="all">All statuses</option><option value="draft">Draft</option><option value="posted">Posted</option><option value="cancelled">Cancelled</option></select>
      </div>

      <div className="production-table-shell overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Production no.</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Fabric / output</th><th className="px-4 py-3">BOM</th><th className="px-4 py-3 text-right">Quantity</th><th className="px-4 py-3">Shift</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">Loading production…</td></tr> :
                rows.length === 0 ? <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No production records match these filters.</td></tr> :
                rows.map(row => {
                  const item = items.find(i => i.id === row.output_item_id);
                  const bom = boms.find(b => b.id === row.bom_id);
                  return <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{row.order_no}</td><td className="px-4 py-3">{formatDate(row.production_date)}</td>
                    <td className="px-4 py-3">{item?.name ?? "Unknown item"}<div className="text-xs text-slate-500">{item?.sku}</div></td>
                    <td className="px-4 py-3">{bom?.name ?? "Unknown BOM"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{Number(row.planned_quantity).toLocaleString()} {unitLabel(row.output_item_id)}</td>
                    <td className="px-4 py-3">{row.shift || "—"}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs ${row.status === "posted" ? "bg-emerald-100 text-emerald-700" : row.status === "draft" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{row.status}</span></td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-2">
                      {row.status !== "cancelled" && <button title="Edit" onClick={() => openEdit(row)} className="rounded border border-slate-300 p-2 hover:bg-slate-50"><Pencil className="h-4 w-4" /></button>}
                      {row.status === "draft" && <button title="Post production" onClick={() => void postExisting(row)} className="rounded bg-blue-600 p-2 text-white hover:bg-blue-700"><Send className="h-4 w-4" /></button>}
                    </div></td>
                  </tr>;
                })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="production-pagination flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="production-pagination-meta text-xs text-slate-500">Showing <span className="font-semibold text-slate-700">{pageStart}–{pageEnd}</span> of <span className="font-semibold text-slate-700">{totalRows.toLocaleString()}</span> records</div>
        <div className="production-pagination-controls flex items-center gap-1">
          <button type="button" disabled={currentPage <= 1 || loading} onClick={() => setCurrentPage(p => Math.max(1, p - 1))} className="rounded-md border px-3 py-2 text-sm disabled:opacity-40">Previous</button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).filter(page => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1).map((page, index, visible) => <span key={page} className="contents">
            {index > 0 && page - visible[index - 1] > 1 && <span className="px-1 text-slate-400">…</span>}
            <button type="button" onClick={() => setCurrentPage(page)} disabled={loading} aria-current={page === currentPage ? "page" : undefined} className={`min-w-9 rounded-md border px-3 py-2 text-sm ${page === currentPage ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{page}</button>
          </span>)}
          <button type="button" disabled={currentPage >= totalPages || loading} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} className="rounded-md border px-3 py-2 text-sm disabled:opacity-40">Next</button>
        </div>
      </div>

      {formOpen && <div className="production-modal-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 md:p-6">
        <div className="production-modal my-4 w-full max-w-4xl rounded-xl bg-white shadow-xl">
          <div className="production-modal-header flex items-start justify-between border-b border-slate-200 px-5 py-4"><div className="production-modal-title"><div><h2 className="text-lg font-semibold">{editingId ? (editingPosted ? "Edit Posted Production" : "Edit Production Draft") : "New Production"}</h2><p className="mt-1 text-sm text-slate-500">Stock location is optional. Leave it blank if you do not track production by location.</p></div></div><button type="button" aria-label="Close production form" onClick={() => setFormOpen(false)} className="production-modal-close rounded p-1 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
          <div className="production-modal-body grid min-w-0 gap-4 overflow-x-hidden p-5 md:grid-cols-2">
            <div className="form-field production-number-field"><label htmlFor="production-number">Production Number</label><div className="code-input-row"><input id="production-number" value={productionNo} onChange={e => setProductionNo(e.target.value)} disabled={numberMode === "automatic" && !editingId} placeholder="PRD-001" /><button type="button" className="icon-button" aria-label="Production numbering settings" title="Production numbering settings" onClick={() => { setNumberingDraft({ ...numbering }); setNumberingOpen(v => !v); }}><Settings2 size={18} /></button></div><small className="muted-text">Numbering mode follows the Production sequence setting.</small>
{numberingOpen && <div className="numbering-popover"><div className="numbering-popover-header"><strong>Production numbering settings</strong><button type="button" className="icon-button" onClick={() => setNumberingOpen(false)} aria-label="Close numbering settings"><X size={16} /></button></div><div className="numbering-mode-row"><label className={numberingDraft.mode === "manual" ? "numbering-mode-option selected" : "numbering-mode-option"}><input type="radio" name="production-number-mode" checked={numberingDraft.mode === "manual"} onChange={() => setNumberingDraft(v => ({ ...v, mode: "manual" }))} /><span>Manual</span><small>Enter production number yourself</small></label><label className={numberingDraft.mode === "automatic" ? "numbering-mode-option selected" : "numbering-mode-option"}><input type="radio" name="production-number-mode" checked={numberingDraft.mode === "automatic"} onChange={() => setNumberingDraft(v => ({ ...v, mode: "automatic" }))} /><span>Automatic</span><small>Generate sequence</small></label></div>{numberingDraft.mode === "automatic" && <><div className="form-field"><label>Prefix</label><input value={numberingDraft.prefix} maxLength={20} onChange={e => setNumberingDraft(v => ({ ...v, prefix: e.target.value }))} /></div><div className="form-field"><label>Next number</label><input type="number" min="1" value={numberingDraft.nextNumber} onChange={e => setNumberingDraft(v => ({ ...v, nextNumber: Math.max(1, Number(e.target.value) || 1) }))} /></div><div className="form-field"><label>Number of digits</label><select value={numberingDraft.digits} onChange={e => setNumberingDraft(v => ({ ...v, digits: Number(e.target.value) }))}><option value={2}>2 digits — 01</option><option value={3}>3 digits — 001</option><option value={4}>4 digits — 0001</option><option value={5}>5 digits — 00001</option><option value={6}>6 digits — 000001</option></select></div><p className="numbering-preview">Preview: <strong>{numberingDraft.prefix}{String(numberingDraft.nextNumber).padStart(numberingDraft.digits, "0")}</strong></p></>}<div className="numbering-actions"><button type="button" className="secondary-button" onClick={() => setNumberingOpen(false)}>Cancel</button><button type="button" className="primary-button" onClick={() => void saveNumberingSettings()}>Apply</button></div></div>}</div>
            <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">Production Date *</span><input type="date" value={productionDate} onChange={e => setProductionDate(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" /></label>
            <label className="block text-sm md:col-span-2"><span className="mb-1 block font-medium text-slate-700">Output Item (Fabric) *</span><div className="flex gap-2"><select value={outputItemId} onChange={e => { setOutputItemId(e.target.value); setBomId(""); }} className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2"><option value="">Select fabric item</option>{fabricItems.map(i => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}</select><button type="button" onClick={() => void openAddItem()} className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"><Plus className="mr-1 inline h-4 w-4" />Add Item</button></div>{fabricItems.length === 0 && <span className="mt-1 block text-xs text-amber-700">No fabric items found. Add one or mark an existing output item as fabric in Items.</span>}</label>
            <label className="block text-sm md:col-span-2"><span className="mb-1 block font-medium text-slate-700">BOM *</span><div className="flex gap-2"><select value={bomId} disabled={!outputItemId} onChange={e => setBomId(e.target.value)} className="min-w-0 w-full flex-1 rounded-md border border-slate-300 px-3 py-2 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"><option value="">{outputItemId ? "Select BOM" : "Select fabric item first"}</option>{matchingBoms.map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select><button type="button" disabled={!outputItemId} onClick={openAddBom} className="shrink-0 whitespace-nowrap rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"><Plus className="mr-1 inline h-4 w-4" />Add BOM</button></div>{outputItemId && matchingBoms.length === 0 && <span className="mt-1 block text-xs text-amber-700">No BOM for this output item. Add a BOM to continue.</span>}</label>
            <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">Production Quantity *</span><input type="number" min="0.001" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" /></label>
            <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">Shift (optional)</span><input value={shift} onChange={e => setShift(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" placeholder="e.g. Day / Night / A / B" /></label>
            <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">Stock Location (optional)</span><select value={locationId} onChange={e => setLocationId(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2"><option value="">No location</option>{locations.map(l => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}</select></label>
            <section className="production-yarn-card">
              <div className="production-yarn-card-header">
                <h3>Yarn required</h3>
                {selectedBom && (
                  <span className="production-yarn-output">
                    {quantity || "0"} {unitLabel(outputItemId)}
                  </span>
                )}
              </div>
              {!selectedBom ? (
                <div className="production-yarn-empty">Select a BOM</div>
              ) : consumptionLoading ? (
                <div className="production-yarn-empty">Calculating…</div>
              ) : consumptionError ? (
                <div className="production-yarn-error">{consumptionError}</div>
              ) : calculatedConsumption.length === 0 ? (
                <div className="production-yarn-empty">No yarn components</div>
              ) : (
                <div className="production-yarn-list">
                  {calculatedConsumption.map(component => (
                    <div key={component.id} className="production-yarn-row">
                      <span className="production-yarn-name">
                        {component.item?.name ?? "Unknown yarn"}
                      </span>
                      <span className="production-yarn-amount">
                        {formatConsumption(component.amount)} <small>{component.unit}</small>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <label className="block text-sm md:col-span-2"><span className="mb-1 block font-medium text-slate-700">Remarks / Notes</span><textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" placeholder="Optional production notes…" /></label>
            <section className="production-attachments md:col-span-2">
              <div className="production-attachments-heading"><h3>Attachments</h3><span className="muted-text">JPG, PNG, WebP or PDF · max 5 MB per file</span></div>
              <label className={`production-file-picker ${editingPosted ? "is-disabled" : ""}`}><Paperclip size={16} /> {editingPosted ? "Attachments are read-only" : "Add files"}<input type="file" accept=".jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" multiple disabled={editingPosted || attachmentBusy} onChange={e => { addAttachmentFiles(e.target.files); e.currentTarget.value = ""; }} /></label>
              <p className="muted-text production-attachment-note">Maximum 5 MB per file. JPG, PNG and WebP images are converted to compressed WebP; PDFs are uploaded unchanged. Files upload when you save the draft.</p>
              {attachmentFiles.length > 0 && <div className="production-pending-files"><strong>New files ({attachmentFiles.length})</strong>{attachmentFiles.map((file, index) => <div className="production-pending-file" key={`${file.name}-${file.size}-${file.lastModified}`}><span>{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</span><button type="button" className="secondary-button" onClick={() => setAttachmentFiles(current => current.filter((_, i) => i !== index))}><Trash2 size={14} /> Remove</button></div>)}</div>}
              {savedAttachments.length > 0 && <div className="production-pending-files"><strong>Saved attachments ({savedAttachments.length})</strong>{savedAttachments.map(a => <div className="production-pending-file" key={a.id}><span><Paperclip size={14} /> {a.file_name} · {(a.size_bytes / 1024 / 1024).toFixed(2)} MB</span><span className="production-attachment-actions"><button type="button" className="secondary-button" onClick={() => void openProductionAttachment(a)}><Eye size={14} /> View</button>{!editingPosted && <button type="button" className="secondary-button" onClick={() => void deleteProductionAttachment(a)}><Trash2 size={14} /> Delete</button>}</span></div>)}</div>}
              {attachmentBusy && <p className="muted-text">Uploading attachments…</p>}
            </section>
          </div>
          <div className="production-modal-footer flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-4"><button onClick={() => setFormOpen(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Cancel</button><button disabled={saving || attachmentBusy} onClick={() => void saveDraft(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm disabled:opacity-50">Save Draft</button>{!editingPosted && <button disabled={saving || attachmentBusy} onClick={() => void saveDraft(true)} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><Send className="h-4 w-4" />Save &amp; Post</button>}{editingPosted && <button disabled={saving || attachmentBusy} onClick={() => void saveDraft(false)} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Confirm Update</button>}</div>
        </div>
      </div>}

      {itemModal && <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-3 md:p-6"><div className="my-8 w-full max-w-xl rounded-xl bg-white shadow-xl">
        <div className="flex justify-between border-b px-5 py-4"><div><h3 className="font-semibold">Add Item</h3><p className="text-xs text-slate-500">Complete item details for this production workflow.</p></div><button onClick={() => setItemModal(false)}><X className="h-5 w-5" /></button></div>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <label className="text-sm"><span className="mb-1 block font-medium">Item Code *</span><input value={itemSku} onChange={e => setItemSku(e.target.value)} className="w-full rounded-md border px-3 py-2" /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Item Type *</span><select value={itemType} onChange={e => setItemType(e.target.value)} className="w-full rounded-md border px-3 py-2"><option value="finished_good">Finished good (fabric)</option><option value="work_in_progress">Work in progress</option><option value="yarn">Yarn</option><option value="material">Material</option><option value="other">Other</option></select></label>
          <label className="text-sm md:col-span-2"><span className="mb-1 block font-medium">Item Name *</span><input value={itemName} onChange={e => setItemName(e.target.value)} className="w-full rounded-md border px-3 py-2" /></label>
          <label className="text-sm md:col-span-2"><span className="mb-1 block font-medium">Unit *</span><select value={itemUnit} onChange={e => setItemUnit(e.target.value)} className="w-full rounded-md border px-3 py-2"><option value="">Select unit</option>{units.map(u => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}</select></label>
          <label className="text-sm md:col-span-2"><span className="mb-1 block font-medium">Notes</span><textarea rows={2} value={itemNotes} onChange={e => setItemNotes(e.target.value)} className="w-full rounded-md border px-3 py-2" /></label>
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-4"><button onClick={() => setItemModal(false)} className="rounded-md border px-4 py-2 text-sm">Cancel</button><button disabled={saving} onClick={() => void saveItem()} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">Save Item</button></div>
      </div></div>}

      {bomModal && <div className="production-bom-backdrop" style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "16px", background: "rgba(15, 23, 42, 0.48)" }} onMouseDown={e => { if (e.target === e.currentTarget && !saving) setBomModal(false); }}>
        <section className="production-bom-dialog" style={{ width: "100%", maxWidth: 760, minWidth: 0, boxSizing: "border-box", margin: "24px auto", background: "#fff", borderRadius: 12, boxShadow: "0 24px 70px rgba(15, 23, 42, 0.28)" }} role="dialog" aria-modal="true" aria-labelledby="production-bom-title">
          <header className="production-bom-header">
            <div>
              <h2 id="production-bom-title">Create BOM</h2>
              <p>Define output and yarn composition.</p>
            </div>
            <button type="button" className="production-bom-close" aria-label="Close Add BOM" onClick={() => setBomModal(false)} disabled={saving}><X size={18} /></button>
          </header>

          <div className="production-bom-body" style={{ minWidth: 0, overflowX: "hidden" }}>
            {error && <div className="production-bom-error">{error}</div>}

            <div className="production-bom-form-grid">
              <label className="production-bom-field"><span>BOM Code *</span><input value={bomCode} onChange={e => setBomCode(e.target.value)} placeholder="e.g. BOM-001" required /></label>
              <label className="production-bom-field"><span>BOM Name *</span><input value={bomName} onChange={e => setBomName(e.target.value)} placeholder="e.g. Cotton Polyester Fabric" required /></label>
              <label className="production-bom-field"><span>Output Item *</span><select value={bomOutputItemId} onChange={e => setBomOutputItemId(e.target.value)} required><option value="">Select output item</option>{fabricItems.map(i => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}</select></label>
              <label className="production-bom-field"><span>Reference Quantity *</span><input type="number" min="0.000001" step="any" value={bomOutputQuantity} onChange={e => setBomOutputQuantity(e.target.value)} required /><small>Recipe reference quantity.</small></label>
            </div>

            <div className="production-bom-components-heading">
              <div><h3>Yarn Composition</h3><p>Percentages must total 100%.</p></div>
              <button type="button" onClick={() => setBomComponents(prev => [...prev, { item_id: "", composition_percent: "" }])}><Plus size={15} />Add yarn</button>
            </div>

            <div className="production-bom-composition-summary">
              <div className="production-bom-summary-top"><span>Total composition</span><strong className={Math.abs(bomComponents.reduce((sum, c) => sum + Number(c.composition_percent || 0), 0) - 100) < 0.000001 ? "is-valid" : "is-invalid"}>{bomComponents.reduce((sum, c) => sum + Number(c.composition_percent || 0), 0).toFixed(2)}% / 100%</strong></div>
              <div className="production-bom-progress"><div className={Math.abs(bomComponents.reduce((sum, c) => sum + Number(c.composition_percent || 0), 0) - 100) < 0.000001 ? "is-complete" : ""} style={{ width: `${Math.min(Math.max(bomComponents.reduce((sum, c) => sum + Number(c.composition_percent || 0), 0), 0), 100)}%` }} /></div>
              <p>{Math.abs(bomComponents.reduce((sum, c) => sum + Number(c.composition_percent || 0), 0) - 100) < 0.000001 ? "Composition complete" : bomComponents.reduce((sum, c) => sum + Number(c.composition_percent || 0), 0) < 100 ? `${(100 - bomComponents.reduce((sum, c) => sum + Number(c.composition_percent || 0), 0)).toFixed(2)}% remaining` : `${(bomComponents.reduce((sum, c) => sum + Number(c.composition_percent || 0), 0) - 100).toFixed(2)}% over 100%`}</p>
            </div>

            <div className="production-bom-component-list">
              {bomComponents.map((c, index) => <div key={index} className="production-bom-component-row">
                <label className="production-bom-field"><span>Yarn *</span><select value={c.item_id} onChange={e => setBomComponents(prev => prev.map((x, i) => i === index ? { ...x, item_id: e.target.value } : x))} required><option value="">Select yarn</option>{yarnItems.map(i => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}</select></label>
                <label className="production-bom-field"><span>Composition % *</span><input type="number" min="0.01" max="100" step="0.01" value={c.composition_percent} onChange={e => setBomComponents(prev => prev.map((x, i) => i === index ? { ...x, composition_percent: e.target.value } : x))} placeholder="e.g. 60" required /></label>
                <button type="button" className="production-bom-remove" title="Remove yarn" aria-label={`Remove yarn component ${index + 1}`} onClick={() => setBomComponents(prev => prev.filter((_, i) => i !== index))} disabled={bomComponents.length === 1}><X size={16} /></button>
              </div>)}
            </div>

            <label className="production-bom-active"><input type="checkbox" checked={bomIsActive} onChange={e => setBomIsActive(e.target.checked)} /><span>BOM is active and available for production</span></label>
          </div>

          <footer className="production-bom-footer">
            <button type="button" onClick={() => setBomModal(false)} disabled={saving}>Cancel</button>
            <button type="button" className="primary" disabled={saving || Math.abs(bomComponents.reduce((sum, c) => sum + Number(c.composition_percent || 0), 0) - 100) >= 0.000001} onClick={() => void saveBom()}>{saving ? "Saving…" : "Create BOM"}</button>
          </footer>
        </section>
      </div>}

      {saving && <div className="fixed bottom-4 right-4 z-[70] rounded-md bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">Saving…</div>}
      {!loading && totalRows === 0 && !search && statusFilter === "all" && <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Create your first production record after confirming that your BOM component percentages and units represent the intended consumption basis.</div>}
      <style>{`
        .production-page { color:#172033; padding:24px 28px; display:flex; flex-direction:column; gap:18px; min-width:0; }
        .production-page > div:first-child { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:14px; }
        .production-page h1 { margin:0; color:#172033; font-size:26px; line-height:1.25; font-weight:700; letter-spacing:-.02em; }
        .production-page h2,.production-page h3 { margin:0; color:#172033; font-size:19px; font-weight:650; }
        .production-page p { margin:5px 0 0; color:#758399; font-size:13px; line-height:1.5; }
        .production-page button { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:38px; padding:8px 13px; border:1px solid #dce2ea; border-radius:8px; background:#fff; color:#334155; font-size:13px; font-weight:550; cursor:pointer; }
        .production-page button:hover { background:#f7f9fc; border-color:#c6d0dd; }
        .production-page button:disabled { opacity:.5; cursor:not-allowed; }
        .production-page table { border-collapse:separate; border-spacing:0; }
        .production-page thead th { position:sticky; top:0; z-index:1; background:#f8fafc; color:#64748b; font-size:11px; font-weight:700; letter-spacing:.045em; white-space:nowrap; }
        .production-page tbody tr { transition:background .15s ease; }
        .production-page tbody td { vertical-align:middle; color:#334155; }
        .production-page tbody td:first-child { color:#172033; font-weight:650; }
        .production-page tbody td:last-child button { min-width:34px; min-height:34px; padding:7px; }
        .production-page .production-pagination button[aria-current="page"] { background:#2563eb; color:#fff; border-color:#2563eb; }
        @media (max-width:640px) { .production-page { padding:16px; } }

        .production-page button.bg-blue-600,.production-page button.bg-blue-600:hover { background:#2563eb; border-color:#2563eb; color:#fff; }
        .production-page input,.production-page select,.production-page textarea { box-sizing:border-box; width:100%; min-height:40px; max-width:100%; border:1px solid #dce2ea; border-radius:8px; background:#fff; color:#334155; padding:9px 11px; font:inherit; font-size:13px; outline:none; }
        .production-page input:focus,.production-page select:focus,.production-page textarea:focus { border-color:#93b4f8; box-shadow:0 0 0 3px #dbeafe; }
        .production-page input::placeholder,.production-page textarea::placeholder { color:#9aa6b7; }
        .production-page label { display:block; min-width:0; color:#475569; font-size:13px; }
        .production-page label > span { display:block; }
        .production-page label > div { min-width:0; }
        .production-page .grid { display:grid; min-width:0; }
        /* Summary cards: force a true three-column row, independent of utility CSS setup. */
        .production-page > .grid { grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
        .production-page > .grid > div { display:flex; flex-direction:column; gap:5px; padding:17px 19px; border:1px solid #dfe3e8; border-radius:12px; background:#fff; }
        .production-page > .grid > div > div:first-child { color:#64748b; font-size:13px; }
        .production-page > .grid > div > div:last-child { color:#172033; font-size:27px; line-height:1.2; font-weight:700; }
        /* Search/filter toolbar */
        .production-page > div.flex.flex-wrap.gap-3 { display:flex; gap:12px; align-items:center; flex-wrap:wrap; padding:14px; border:1px solid #dfe3e8; border-radius:12px; background:#fff; }
        .production-page > div.flex.flex-wrap.gap-3 > div:first-child { display:flex; align-items:center; gap:8px; flex:1 1 280px; min-height:42px; min-width:0; border:1px solid #dfe3e8; border-radius:8px; padding:0 10px; color:#8190a5; }
        .production-page > div.flex.flex-wrap.gap-3 > div:first-child input { min-width:0; border:0; box-shadow:none; }
        .production-page > div.flex.flex-wrap.gap-3 > select { width:auto; min-width:135px; }
        .production-page .overflow-hidden.rounded-lg.border.bg-white { overflow:hidden; border:1px solid #dfe3e8; border-radius:12px; background:#fff; }
        .production-page table { width:100%; min-width:900px; border-collapse:collapse; text-align:left; font-size:13px; }
        .production-page thead { background:#f7f9fc; color:#66758b; }
        .production-page th { padding:14px 15px; text-transform:uppercase; letter-spacing:.035em; font-size:10px; font-weight:700; white-space:nowrap; }
        .production-page td { padding:14px 15px; border-top:1px solid #edf0f4; color:#475569; }
        .production-page tbody tr:hover { background:#fafcff; }
        .production-page td:first-child { color:#1d4ed8; font-weight:650; }
        .production-page .rounded-full { display:inline-block; border-radius:999px; padding:4px 9px; font-size:11px; font-weight:650; text-transform:capitalize; }
        .production-page .bg-emerald-100 { background:#dcfce7; color:#166534; }
        .production-page .bg-amber-100 { background:#fef3c7; color:#92400e; }
        .production-page .bg-slate-100 { background:#f1f5f9; color:#64748b; }
        .production-page .text-xs { font-size:12px; }
        .production-page .text-slate-500 { color:#8490a3; }
        .production-page .text-center { text-align:center; }
        .production-page .px-4.py-8 { padding:42px 20px; }
        /* Dialogs */
        .production-page .fixed.inset-0 { position:fixed; inset:0; z-index:50; display:flex; justify-content:center; align-items:flex-start; overflow-y:auto; padding:24px; background:rgba(15,23,42,.42); }
        .production-page .fixed.inset-0 > div { box-sizing:border-box; width:100%; max-width:900px; margin:16px auto; overflow:hidden; border:1px solid #e2e8f0; border-radius:14px; background:#fff; box-shadow:0 24px 70px rgba(15,23,42,.22); }
        .production-page .fixed.inset-0 > div > .grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px; padding:22px; }
        .production-page .fixed.inset-0 label { display:block; min-width:0; line-height:1.45; }
        .production-page .fixed.inset-0 label > span { display:block; margin-bottom:6px; color:#475569; font-weight:500; }
        .production-page .fixed.inset-0 label > div { display:flex; align-items:center; gap:8px; }
        .production-page .fixed.inset-0 label > div input,.production-page .fixed.inset-0 label > div select { width:auto; }
        .production-page .fixed.inset-0 label > div input:first-child { flex:1; min-width:0; }
        .production-page .fixed.inset-0 label > div select { flex:0 0 auto; }
        .production-page .fixed.inset-0 label.md\:col-span-2,.production-page .fixed.inset-0 .md\:col-span-2 { grid-column:1 / -1; }
        .production-page .fixed.inset-0 .border-b { border-bottom:1px solid #e5eaf0; }
        .production-page .fixed.inset-0 .border-t { border-top:1px solid #e5eaf0; }
        .production-page .fixed.inset-0 .px-5.py-4 { padding:18px 22px; }
        .production-page .fixed.inset-0 .p-5 { padding:22px; }
        .production-page .fixed.inset-0 .bg-blue-50 { background:#eff6ff; }
        .production-page .fixed.inset-0 .text-blue-900 { color:#1e3a8a; }
        .production-page .fixed.inset-0 .text-blue-800 { color:#1e40af; }
        .production-page .fixed.inset-0 textarea { width:100%; }
        .production-page .bg-amber-50 { background:#fffbeb; }
        .production-page .border-amber-200 { border-color:#fde68a; }
        .production-page .text-amber-800 { color:#92400e; }
        .production-page .bg-red-50 { background:#fff1f2; }
        .production-page .border-red-200 { border-color:#fecdd3; }
        .production-page .text-red-700 { color:#be123c; }
        .production-page .bg-emerald-50 { background:#ecfdf5; }
        .production-page .border-emerald-200 { border-color:#a7f3d0; }
        .production-page .text-emerald-700 { color:#047857; }
        .production-page .rounded-md.border { border-color:#dce2ea; border-radius:8px; }
        .production-page .fixed.bottom-4.right-4 { position:fixed; right:16px; bottom:16px; z-index:70; background:#172033; color:#fff; padding:10px 15px; border-radius:8px; box-shadow:0 8px 25px #0f172a22; }
        .production-page .production-modal-backdrop { position:fixed; inset:0; z-index:50; display:flex; justify-content:center; align-items:center; overflow:hidden; padding:16px; background:rgba(15,23,42,.42); backdrop-filter:blur(2px); }
        .production-page .production-modal { width:min(920px,calc(100vw - 32px)); max-height:min(90vh,900px); margin:0; display:flex; flex-direction:column; overflow:hidden; border:1px solid #e2e8f0; border-radius:14px; box-shadow:0 24px 70px rgba(15,23,42,.22); }
        .production-page .production-modal-header { flex:0 0 auto; align-items:flex-start; gap:16px; padding:18px 24px; }
        .production-page .production-modal-header h2 { margin:0; font-size:19px; line-height:1.35; font-weight:650; }
        .production-page .production-modal-header p { margin:5px 0 0; color:#8490a3; font-size:12px; line-height:1.5; }
        .production-page .production-modal-body { flex:1 1 auto; min-height:0; overflow-y:auto; align-content:start; gap:18px; padding:22px 24px; }
        .production-page .production-modal-footer { flex:0 0 auto; gap:9px; padding:14px 24px; background:#fff; }
        .production-page .form-field { position:relative; display:flex; flex-direction:column; gap:7px; min-width:0; }
        .production-page .form-field > label { color:#475569; font-size:13px; font-weight:500; }
        .production-page .code-input-row { display:flex; align-items:center; gap:8px; min-width:0; }
        .production-page .code-input-row input { flex:1; min-width:0; }
        .production-page .icon-button { display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; width:40px; min-height:40px; border:1px solid #dce2ea; border-radius:8px; background:#fff; }
        .production-page .numbering-popover { position:absolute; z-index:80; top:calc(100% + 8px); left:0; width:min(340px,calc(100vw - 48px)); display:grid; gap:12px; padding:14px; border:1px solid #dfe5ee; border-radius:12px; background:#fff; box-shadow:0 18px 45px rgba(15,23,42,.18); }
        .production-page .numbering-popover-header,.production-page .numbering-mode-row,.production-page .numbering-actions { display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .production-page .numbering-popover-header strong { font-size:13px; }
        .production-page .numbering-mode-row { align-items:stretch; }
        .production-page .numbering-mode-option { display:grid!important; grid-template-columns:16px 1fr; align-content:start; gap:4px 7px!important; flex:1; padding:10px; border:1px solid #e2e8f0; border-radius:9px; }
        .production-page .numbering-mode-option.selected { border-color:#7aa2fa; background:#f4f8ff; }
        .production-page .numbering-mode-option input { grid-row:span 2; width:14px; min-height:14px; margin:2px 0 0; }
        .production-page .numbering-mode-option span { font-size:12px; font-weight:600; }
        .production-page .numbering-mode-option small { color:#8490a3; font-size:10px; line-height:1.4; }
        .production-page .numbering-preview { padding:10px; margin:0; border:1px solid #e5eaf0; border-radius:8px; background:#f8fafc; font-size:12px; color:#64748b; }
        .production-page .numbering-preview strong { color:#1d4ed8; }
        .production-page .production-attachments { min-width:0; padding:14px; border:1px solid #dfe3e8; border-radius:10px; }
        .production-page .production-attachments-heading { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:12px; }
        .production-page .production-attachments-heading h3 { margin:0; font-size:14px; font-weight:650; }
        .production-page .production-file-picker { display:inline-flex!important; align-items:center; gap:8px; width:max-content; max-width:100%; padding:9px 12px; border:1px dashed #aeb8c5; border-radius:8px; cursor:pointer; font-size:12px!important; }
        .production-page .production-file-picker.is-disabled { opacity:.6; cursor:not-allowed; }
        .production-page .production-file-picker input { width:auto; max-width:210px; min-height:unset; padding:0; border:0; font-size:11px; }
        .production-page .production-pending-files { display:grid; gap:8px; margin-top:12px; font-size:12px; }
        .production-page .production-pending-file { display:flex; align-items:center; justify-content:space-between; gap:10px; padding-top:8px; border-top:1px solid #edf0f4; }
        .production-page .production-pending-file span { min-width:0; overflow-wrap:anywhere; }
        .production-page .production-pending-file button { display:inline-flex; align-items:center; gap:5px; flex:0 0 auto; }
        .production-page .production-attachment-note { margin:10px 0 0; font-size:11px; line-height:1.5; }
        @media(max-width:760px) {
          .production-page { padding:16px; }
          .production-page > .grid { grid-template-columns:1fr; }
          .production-page .fixed.inset-0 { padding:10px; }
          .production-page .fixed.inset-0 > div > .grid { grid-template-columns:1fr; padding:15px; }
          .production-page .fixed.inset-0 .md\:col-span-2 { grid-column:auto; }
          .production-page .fixed.inset-0 > div { margin:4px auto; }
          .production-page .production-modal-backdrop { align-items:flex-start; padding:8px; overflow-y:auto; }
          .production-page .production-modal { width:100%; max-height:calc(100dvh - 16px); margin:0; border-radius:12px; }
          .production-page .production-modal-header { padding:15px 16px; }
          .production-page .production-modal-body { grid-template-columns:1fr; gap:15px; padding:16px; }
          .production-page .production-modal-footer { padding:12px 16px; display:grid; grid-template-columns:1fr 1fr; }
          .production-page .production-modal-footer button:last-child { grid-column:1 / -1; }
          .production-page .production-attachments-heading { align-items:flex-start; flex-direction:column; }
          .production-page .production-pending-file { align-items:flex-start; flex-direction:column; }
          .production-page .numbering-popover { position:relative; top:auto; width:100%; margin-top:8px; }
        }

        .production-modal-header { position:relative !important; display:flex !important; align-items:flex-start !important; justify-content:space-between !important; gap:16px !important; padding:20px 24px !important; flex-wrap:nowrap !important; }
        .production-modal-title { min-width:0; flex:1 1 auto; }
        .production-modal-title > div { display:block !important; }
        .production-modal-close { flex:0 0 auto !important; width:40px !important; height:40px !important; margin:0 !important; padding:0 !important; align-self:flex-start !important; }
        .production-modal-body { overflow-y:auto; align-items:start; }
        .production-modal-body > label, .production-modal-body > .form-field { min-width:0; }
        .production-attachments { min-width:0; }
        .production-attachment-actions { display:flex; flex-wrap:wrap; gap:6px; }
        .production-pending-file { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
        .production-page .production-modal-body input, .production-page .production-modal-body select, .production-page .production-modal-body textarea { width:100%; min-width:0; }
        @media (max-width:640px) { .production-modal-backdrop { padding:8px !important; align-items:flex-start !important; } .production-modal { margin:8px auto !important; max-height:calc(100dvh - 16px); display:flex; flex-direction:column; overflow:hidden; } .production-modal-header { padding:16px !important; } .production-modal-body { display:grid !important; grid-template-columns:minmax(0,1fr) !important; gap:15px !important; padding:16px !important; overflow-y:auto; } .production-modal-body > * { grid-column:1 / -1 !important; } .production-modal-footer { padding:12px 16px !important; } .production-modal-footer button { flex:1 1 auto; } }

        /* Production Add BOM dialog mirrors the main BOM page form */
        .production-page .production-bom-backdrop { position:fixed; inset:0; z-index:80; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(15,23,42,.48); backdrop-filter:blur(2px); }
        .production-page .production-bom-dialog { width:min(820px,calc(100vw - 32px)); max-height:min(88vh,820px); display:flex; flex-direction:column; overflow:hidden; margin:0; border:1px solid #e2e8f0; border-radius:14px; background:#fff; box-shadow:0 24px 70px rgba(15,23,42,.22); }
        .production-page .production-bom-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:16px 22px; border-bottom:1px solid #e5eaf0; flex:0 0 auto; }
        .production-page .production-bom-header h2 { margin:0; font-size:19px; line-height:1.35; font-weight:650; }
        .production-page .production-bom-header p { margin:5px 0 0; color:#8490a3; font-size:12px; }
        .production-page .production-bom-close { width:38px; min-width:38px; height:38px; padding:0; }
        .production-page .production-bom-body { min-height:0; overflow-y:auto; padding:16px 22px; }
        .production-page .production-bom-error { margin-bottom:14px; padding:10px 12px; border:1px solid #fecdd3; border-radius:8px; background:#fff1f2; color:#be123c; font-size:13px; }
        .production-page .production-bom-form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px 16px; }
        .production-page .production-bom-field { display:flex; flex-direction:column; gap:5px; min-width:0; }
        .production-page .production-bom-field > span { color:#475569; font-size:13px; font-weight:600; }
        .production-page .production-bom-field input,.production-page .production-bom-field select { width:100%; min-width:0; min-height:40px; }
        .production-page .production-bom-field small { color:#8490a3; font-size:11px; }
        .production-page .production-bom-components-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:18px 0 10px; }
        .production-page .production-bom-components-heading h3 { margin:0 0 3px; font-size:15px; }
        .production-page .production-bom-components-heading p { margin:0; font-size:12px; }
        .production-page .production-bom-components-heading button { flex:0 0 auto; }
        .production-page .production-bom-composition-summary { margin-bottom:10px; padding:10px 12px; border:1px solid #dbeafe; border-radius:9px; background:#f8fbff; }
        .production-page .production-bom-summary-top { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:12px; color:#475569; }
        .production-page .production-bom-summary-top strong.is-valid { color:#047857; }
        .production-page .production-bom-summary-top strong.is-invalid { color:#b45309; }
        .production-page .production-bom-progress { height:6px; overflow:hidden; margin-top:8px; border-radius:999px; background:#e2e8f0; }
        .production-page .production-bom-progress > div { height:100%; border-radius:999px; background:#f59e0b; transition:width .15s ease; }
        .production-page .production-bom-progress > div.is-complete { background:#10b981; }
        .production-page .production-bom-composition-summary p { margin:6px 0 0; font-size:12px; }
        .production-page .production-bom-component-list { display:grid; gap:8px; }
        .production-page .production-bom-component-row { display:grid; grid-template-columns:minmax(0,1fr) 150px 36px; align-items:end; gap:10px; padding:10px 12px; border:1px solid #e2e8f0; border-radius:9px; background:#fff; }
        .production-page .production-bom-remove { width:36px; height:40px; padding:0; align-self:end; }
        .production-page .production-bom-remove:disabled { opacity:.4; }
        .production-page .production-bom-active { display:flex !important; align-items:center; gap:8px; margin-top:12px; font-size:12px; }
        .production-page .production-bom-active input { width:16px; min-height:16px; height:16px; margin:0; }
        .production-page .production-bom-footer { display:flex; justify-content:flex-end; gap:8px; padding:12px 22px; border-top:1px solid #e2e8f0; background:#fff; flex:0 0 auto; }
        .production-page .production-bom-footer .primary { background:#2563eb; border-color:#2563eb; color:white; }
        @media(max-width:640px) { .production-page .production-bom-backdrop { align-items:flex-start; padding:8px; overflow-y:auto; } .production-page .production-bom-dialog { width:100%; max-height:calc(100dvh - 16px); border-radius:12px; } .production-page .production-bom-header,.production-page .production-bom-body { padding:12px 14px; } .production-page .production-bom-form-grid { grid-template-columns:minmax(0,1fr); gap:12px; } .production-page .production-bom-component-row { grid-template-columns:minmax(0,1fr) 96px 34px; gap:7px; padding:8px; } .production-page .production-bom-footer { padding:10px 14px; } }
        /* Compact yarn-consumption panel in the production form */
        .production-page .production-yarn-card {
          grid-column: span 1 / span 1;
          align-self: start;
          min-width: 0;
          padding: 16px;
          border: 1px solid #dbe5f2;
          border-radius: 12px;
          background: linear-gradient(145deg, #f7faff 0%, #ffffff 78%);
          box-shadow: 0 2px 8px rgba(26, 55, 100, .045);
        }
        .production-page .production-yarn-card-header {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
          margin-bottom:12px;
        }
        .production-page .production-yarn-card-header h3 {
          margin:0;
          color:#1e3150;
          font-size:15px;
          line-height:1.3;
          font-weight:700;
        }
        .production-page .production-yarn-output {
          flex:0 0 auto;
          padding:5px 9px;
          border:1px solid #d7e4f7;
          border-radius:999px;
          background:#fff;
          color:#60728e;
          font-size:11px;
          font-weight:600;
          white-space:nowrap;
        }
        .production-page .production-yarn-list {
          overflow:hidden;
          border:1px solid #e2eaf4;
          border-radius:9px;
          background:#fff;
        }
        .production-page .production-yarn-row {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          min-height:48px;
          padding:10px 12px;
        }
        .production-page .production-yarn-row + .production-yarn-row {
          border-top:1px solid #edf1f6;
        }
        .production-page .production-yarn-name {
          min-width:0;
          overflow:hidden;
          color:#34445e;
          font-size:13px;
          font-weight:500;
          text-overflow:ellipsis;
          white-space:nowrap;
        }
        .production-page .production-yarn-amount {
          flex:0 0 auto;
          padding:6px 10px;
          border-radius:7px;
          background:#edf4ff;
          color:#1e55ad;
          font-size:13px;
          font-weight:700;
          font-variant-numeric:tabular-nums;
          white-space:nowrap;
        }
        .production-page .production-yarn-amount small {
          color:#5474a7;
          font-size:10px;
          font-weight:600;
        }
        .production-page .production-yarn-empty,
        .production-page .production-yarn-error {
          padding:13px;
          border:1px dashed #d8e2ef;
          border-radius:9px;
          background:#fff;
          color:#8794a8;
          font-size:12px;
        }
        .production-page .production-yarn-error { color:#b42318; }
        @media (max-width:760px) {
          .production-page .production-yarn-card { grid-column:1 / -1; }
        }

        /* Production list: refined dashboard layout */
        .production-page .production-summary-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; }
        .production-page .production-summary-grid > div { min-height:104px; padding:19px 21px; border:1px solid #e5eaf2; border-radius:14px; background:linear-gradient(145deg,#fff 0%,#fbfdff 100%); box-shadow:0 2px 8px rgba(15,23,42,.025); }
        .production-page .production-summary-grid > div > div:first-child { color:#77849a; font-size:12px; font-weight:600; letter-spacing:.015em; }
        .production-page .production-summary-grid > div > div:last-child { margin-top:7px; color:#172b4d; font-size:29px; font-weight:700; line-height:1.1; }
        .production-page .production-toolbar { display:flex; align-items:center; gap:12px; padding:13px; border:1px solid #e5eaf2; border-radius:13px; background:#fff; box-shadow:0 2px 8px rgba(15,23,42,.025); }
        .production-page .production-toolbar > div:first-child { display:flex; align-items:center; flex:1 1 360px; min-width:220px; min-height:46px; padding:0 13px; border:1px solid #dce4ef; border-radius:9px; background:#fbfcfe; }
        .production-page .production-toolbar > div:first-child input { width:100%; min-height:42px; padding:8px 10px; border:0; background:transparent; box-shadow:none; }
        .production-page .production-toolbar > div:first-child input:focus { outline:none; box-shadow:none; }
        .production-page .production-toolbar > select { width:auto; min-width:155px; min-height:46px; border:1px solid #dce4ef; border-radius:9px; background:#fff; }
        .production-page .production-table-shell { border:1px solid #e3e9f1; border-radius:14px; background:#fff; box-shadow:0 3px 12px rgba(15,23,42,.035); }
        .production-page .production-table-shell > div { overflow-x:auto; }
        .production-page .production-table-shell table { width:100%; min-width:980px; border-collapse:separate; border-spacing:0; }
        .production-page .production-table-shell thead th { padding:15px 17px; border-bottom:1px solid #e6ebf2; background:#f8fafd; color:#738198; font-size:10px; font-weight:750; letter-spacing:.07em; }
        .production-page .production-table-shell tbody td { padding:17px; border-top:0; border-bottom:1px solid #eef1f5; color:#3d4b61; font-size:13px; line-height:1.45; }
        .production-page .production-table-shell tbody tr:last-child td { border-bottom:0; }
        .production-page .production-table-shell tbody tr:hover td { background:#f9fbff; }
        .production-page .production-table-shell tbody td:first-child { color:#1d355b; font-weight:700; }
        .production-page .production-table-shell tbody td:nth-child(3) { min-width:170px; color:#243b5a; font-weight:550; }
        .production-page .production-table-shell tbody td:nth-child(3) .text-xs { display:block; margin-top:3px; color:#8a97aa; font-weight:400; }
        .production-page .production-table-shell tbody td:last-child { white-space:nowrap; }
        .production-page .production-table-shell tbody td:last-child > div { justify-content:flex-end; }
        .production-page .production-table-shell tbody td:last-child button { width:36px; height:36px; border:1px solid #dfe6f0; border-radius:9px; background:#fff; color:#52647e; }
        .production-page .production-table-shell tbody td:last-child button:hover { border-color:#b9cdf5; background:#f2f6ff; color:#2459b7; }
        .production-page .production-pagination { display:flex; align-items:center; justify-content:space-between; gap:18px; min-height:68px; padding:13px 17px; border:1px solid #e5eaf2; border-radius:13px; background:#fff; }
        .production-page .production-pagination-meta { display:block; flex:0 0 auto; width:auto; min-width:180px; white-space:nowrap; color:#78869b; font-size:12px; line-height:1.5; }
        .production-page .production-pagination-meta span { display:inline; white-space:nowrap; }
        .production-page .production-pagination-controls { display:flex; flex:0 0 auto; align-items:center; gap:6px; white-space:nowrap; }
        .production-page .production-pagination-controls button { min-width:38px; min-height:38px; padding:8px 12px; border:1px solid #e0e6ef; border-radius:9px; background:#fff; color:#53637a; font-size:12px; font-weight:600; }
        .production-page .production-pagination-controls button[aria-current="page"] { background:#2563eb; color:#fff; border-color:#2563eb; box-shadow:0 3px 8px rgba(37,99,235,.18); }
        .production-page .production-pagination-controls button:disabled { color:#a8b1bf; background:#fafbfd; }
        @media (max-width:760px) {
          .production-page .production-summary-grid { grid-template-columns:1fr; }
          .production-page .production-summary-grid > div { min-height:82px; }
          .production-page .production-toolbar { align-items:stretch; }
          .production-page .production-toolbar > div:first-child { flex-basis:100%; }
          .production-page .production-toolbar > select { width:100%; }
          .production-page .production-pagination { align-items:flex-start; flex-direction:column; }
          .production-page .production-pagination-meta { min-width:0; }
          .production-page .production-pagination-controls { max-width:100%; flex-wrap:wrap; }
        }

      `}</style>
    </div>
  );
}