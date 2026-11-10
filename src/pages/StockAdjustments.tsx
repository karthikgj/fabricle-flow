import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Search, Send, X, ClipboardList, AlertCircle } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";
import { formatDate } from "../lib/dateUtils";
import Pagination from "../components/Pagination";

type Item = { id: string; sku: string; name: string; item_type: string; unit_id: string };
type Location = { id: string; code: string; name: string };
type Lot = { id: string; lot_code: string; item_id?: string | null };
type AdjustmentLine = { item_id: string; location_id: string; lot_id: string; direction: "increase" | "decrease"; quantity: string };
type Adjustment = {
  id: string; adjustment_no: string; adjustment_date: string; status: string;
  reason: string; notes: string | null; created_at: string;
};

const blankLine = (): AdjustmentLine => ({
  item_id: "", location_id: "", lot_id: "", direction: "increase", quantity: "",
});

export default function StockAdjustments() {
  const { company, error: companyError } = useCompany();
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const PAGE_SIZE = 10;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("Physical stock correction");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<AdjustmentLine[]>([blankLine()]);

  const loadData = useCallback(async () => {
    if (!company?.id) return;
    setLoading(true);
    setError("");
    try {
      const [itemsRes, locationsRes, lotsRes] = await Promise.all([
        supabase.from("items").select("id, sku, name, item_type, unit_id").eq("company_id", company.id).order("name"),
        supabase.from("locations").select("id, code, name").eq("company_id", company.id).order("name"),
        supabase.from("lots").select("id, lot_code, item_id").eq("company_id", company.id).order("lot_code"),
      ]);
      for (const result of [itemsRes, locationsRes, lotsRes]) {
        if (result.error) throw result.error;
      }
      setItems((itemsRes.data ?? []) as Item[]);
      setLocations((locationsRes.data ?? []) as Location[]);
      setLots((lotsRes.data ?? []) as Lot[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load stock adjustments. Apply the stock adjustment SQL migration first.");
    } finally {
      setLoading(false);
    }
  }, [company?.id]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadAdjustmentPage = useCallback(async () => {
    if (!company?.id) return;
    setLoading(true);
    let query = supabase.from("stock_adjustments")
      .select("id, adjustment_no, adjustment_date, status, reason, notes, created_at", { count: "exact" })
      .eq("company_id", company.id)
      .order("created_at", { ascending: false });
    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    const safeSearch = debouncedSearch.replace(/[,%()]/g, " ").trim();
    if (safeSearch) query = query.or(`adjustment_no.ilike.%${safeSearch}%,reason.ilike.%${safeSearch}%,notes.ilike.%${safeSearch}%`);
    const from = (currentPage - 1) * PAGE_SIZE;
    const { data, count, error: pageError } = await query.range(from, from + PAGE_SIZE - 1);
    if (pageError) setError(pageError.message);
    else { setAdjustments((data ?? []) as Adjustment[]); setTotalCount(count ?? 0); }
    setLoading(false);
  }, [company?.id, currentPage, debouncedSearch, statusFilter]);

  useEffect(() => { void loadAdjustmentPage(); }, [loadAdjustmentPage]);

  const filtered = adjustments;

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const pageRows = filtered;
  useEffect(() => { setCurrentPage(1); }, [debouncedSearch, statusFilter]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);

  function openNew() {
    setEditingId(null);
    setDate(new Date().toISOString().slice(0, 10));
    setReason("Physical stock correction");
    setNotes("");
    setLines([blankLine()]);
    setError("");
    setNotice("");
    setModalOpen(true);
  }

  async function editAdjustment(adjustment: Adjustment) {
    setError("");
    setNotice("");
    const { data, error: linesError } = await supabase.from("stock_adjustment_lines")
      .select("item_id, location_id, lot_id, quantity_delta")
      .eq("company_id", company!.id).eq("adjustment_id", adjustment.id);
    if (linesError) { setError(linesError.message); return; }
    setEditingId(adjustment.id);
    setDate(adjustment.adjustment_date);
    setReason(adjustment.reason);
    setNotes(adjustment.notes ?? "");
    setLines((data ?? []).map((line: any) => ({
      item_id: line.item_id,
      location_id: line.location_id,
      lot_id: line.lot_id ?? "",
      direction: Number(line.quantity_delta) < 0 ? "decrease" : "increase",
      quantity: String(Math.abs(Number(line.quantity_delta))),
    })));
    if (!data?.length) setLines([blankLine()]);
    setModalOpen(true);
  }

  function updateLine(index: number, patch: Partial<AdjustmentLine>) {
    setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  }

  function validateForm() {
    if (!reason.trim()) return "Enter a reason for the adjustment.";
    if (!lines.length) return "Add at least one adjustment line.";
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.item_id || !line.location_id || !line.quantity || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) {
        return `Complete item, location and a positive quantity on line ${i + 1}.`;
      }
    }
    return "";
  }

  async function saveDraft(): Promise<string | null> {
    const validation = validateForm();
    if (validation) { setError(validation); return null; }
    const p_lines = lines.map((line) => ({
      item_id: line.item_id,
      location_id: line.location_id,
      lot_id: line.lot_id || null,
      quantity_delta: (line.direction === "decrease" ? -1 : 1) * Number(line.quantity),
    }));
    const { data, error: rpcError } = await supabase.rpc("save_stock_adjustment_draft", {
      p_company_id: company!.id,
      p_adjustment_id: editingId,
      p_adjustment_date: date,
      p_reason: reason.trim(),
      p_notes: notes.trim() || null,
      p_lines,
    });
    if (rpcError) { setError(rpcError.message); return null; }
    return data as string;
  }

  async function handleSave(postNow: boolean) {
    if (!company?.id) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const adjustmentId = await saveDraft();
      if (!adjustmentId) return;
      if (postNow) {
        const { error: postError } = await supabase.rpc("post_stock_adjustment", {
          p_company_id: company.id,
          p_adjustment_id: adjustmentId,
        });
        if (postError) throw postError;
      }
      setModalOpen(false);
      setNotice(postNow ? "Stock adjustment posted successfully." : "Stock adjustment saved as draft.");
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save stock adjustment.");
    } finally {
      setSaving(false);
    }
  }

  async function postExisting(adjustment: Adjustment) {
    if (!company?.id || !window.confirm(`Post ${adjustment.adjustment_no}? This will change stock balances.`)) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const { error: postError } = await supabase.rpc("post_stock_adjustment", {
        p_company_id: company.id, p_adjustment_id: adjustment.id,
      });
      if (postError) throw postError;
      setNotice(`${adjustment.adjustment_no} posted successfully.`);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to post adjustment.");
    } finally {
      setSaving(false);
    }
  }

  const itemById = new Map(items.map((item) => [item.id, item]));

  return (
    <main className="adjustments-page">
      <header className="page-header">
        <div className="page-heading">
          <h1>Stock Adjustments</h1>
            
        </div>
        <div className="page-actions">
          <button className="button button-outline" type="button" onClick={() => void loadData()} disabled={loading}>
            <RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh
          </button>
          <button className="button button-primary" type="button" onClick={openNew}>
            <Plus size={16} /> New Adjustment
          </button>
        </div>
      </header>

      {companyError && <div className="adj-alert"><AlertCircle size={16} />{companyError}</div>}
      {error && !modalOpen && <div className="adj-alert"><AlertCircle size={16} />{error}</div>}
      {notice && <div className="adj-notice">{notice}</div>}

      <section className="panel adj-register">
        <div className="adj-filters">
          <label className="adj-search"><Search size={17} /><input placeholder="Search adjustment, reason or status" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            <option value="all">All statuses</option><option value="draft">Draft</option><option value="posted">Posted</option><option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="adj-table-heading"><div><h2>Adjustment register</h2><p>{loading ? "Loading adjustments…" : `${totalCount} adjustments`}</p></div></div>
        <div className="adj-table-wrap">
          <table className="adj-table">
            <thead><tr><th>Adjustment No.</th><th>Date</th><th>Reason</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {!loading && pageRows.map((a) => (
                <tr key={a.id}>
                  <td className="adj-code">{a.adjustment_no}</td><td>{formatDate(a.adjustment_date)}</td><td>{a.reason}</td>
                  <td><span className={`adj-status ${a.status}`}>{a.status}</span></td>
                  <td className="adj-actions">
                    {a.status === "draft" && <>
                      <button type="button" className="button button-outline button-small" onClick={() => void editAdjustment(a)}>Edit</button>
                      <button type="button" className="button button-primary button-small" disabled={saving} onClick={() => void postExisting(a)}><Send size={13} /> Post</button>
                    </>}
                  </td>
                </tr>
              ))}
              {!loading && !filtered.length && <tr><td colSpan={5} className="adj-empty"><ClipboardList size={24} /><strong>No stock adjustments yet</strong><span>Create a draft adjustment, review it, then post it to update Current Stock.</span></td></tr>}
              {loading && <tr><td colSpan={5} className="adj-empty">Loading…</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <Pagination totalItems={totalCount} currentPage={currentPage} pageSize={PAGE_SIZE} onPageChange={setCurrentPage} loading={loading} itemLabel="adjustments" />

      {modalOpen && (
        <div className="adj-modal-backdrop" role="presentation">
          <section className="adj-modal" role="dialog" aria-modal="true" aria-labelledby="adj-modal-title">
            <header className="adj-modal-header"><div><h2 id="adj-modal-title">{editingId ? "Edit Stock Adjustment" : "New Stock Adjustment"}</h2><p>Draft changes do not affect stock until posted.</p></div><button type="button" className="button button-outline" aria-label="Close" onClick={() => setModalOpen(false)}><X size={17} /></button></header>
            <div className="adj-modal-body">
              {error && <div className="adj-alert"><AlertCircle size={16} />{error}</div>}
              <div className="adj-form-grid">
                <label>Adjustment date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
                <label>Reason<select value={reason} onChange={(e) => setReason(e.target.value)}><option>Physical stock correction</option><option>Damage</option><option>Shortage</option><option>Excess found</option><option>Opening balance correction</option><option>Other</option></select></label>
                <label className="adj-notes-field">Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Reference, explanation or physical count details" /></label>
              </div>
              <div className="adj-lines-heading"><h3>Adjustment lines</h3><button type="button" className="button button-outline button-small" onClick={() => setLines((current) => [...current, blankLine()])}><Plus size={14} /> Add line</button></div>
              <div className="adj-lines">
                {lines.map((line, index) => (
                  <div className="adj-line" key={index}>
                    <label>Item<select value={line.item_id} onChange={(e) => updateLine(index, { item_id: e.target.value, lot_id: "" })}><option value="">Select item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.sku} — {item.name}</option>)}</select></label>
                    <label>Location<select value={line.location_id} onChange={(e) => updateLine(index, { location_id: e.target.value })}><option value="">Select location</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                    <label>Lot (optional)<select value={line.lot_id} onChange={(e) => updateLine(index, { lot_id: e.target.value })}><option value="">No lot</option>{lots.map((lot) => <option key={lot.id} value={lot.id}>{lot.lot_code}</option>)}</select></label>
                    <label>Adjustment<select value={line.direction} onChange={(e) => updateLine(index, { direction: e.target.value as AdjustmentLine["direction"] })}><option value="increase">Increase (+)</option><option value="decrease">Decrease (−)</option></select></label>
                    <label>Quantity<input type="number" min="0.000001" step="any" value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} placeholder="0.000" /></label>
                    <button type="button" className="adj-remove-line" aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}><X size={16} /></button>
                    {line.item_id && <small className="adj-selected-item">{itemById.get(line.item_id)?.item_type ?? ""}</small>}
                  </div>
                ))}
              </div>
            </div>
            <footer className="adj-modal-footer"><button type="button" className="button button-outline" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</button><button type="button" className="button button-outline" onClick={() => void handleSave(false)} disabled={saving}>{saving ? "Saving…" : "Save Draft"}</button><button type="button" className="button button-primary" onClick={() => void handleSave(true)} disabled={saving}>{saving ? "Processing…" : "Save & Post"}</button></footer>
          </section>
        </div>
      )}

      <style>{`
        .adjustments-page { color:var(--text-primary,#172033); }
        .adj-register { padding:22px 24px; }
        .adj-filters { display:flex; gap:10px; margin-bottom:23px; flex-wrap:wrap; }
        .adj-search { display:flex; gap:9px; align-items:center; border:1px solid var(--border-color,#dfe3e8); border-radius:8px; padding:0 12px; height:42px; flex:1 1 280px; color:#8190a5; }
        .adj-search input { border:0; outline:0; width:100%; background:transparent; font:inherit; }
        .adj-filters select { height:42px; border:1px solid var(--border-color,#dfe3e8); border-radius:8px; padding:0 12px; background:white; }
        .adj-table-heading h2 { margin:0 0 5px; font-size:17px; }.adj-table-heading p { margin:0 0 14px; color:#8490a3; font-size:13px; }
        .adj-table-wrap { overflow:auto; border:1px solid var(--border-color,#dfe3e8); border-radius:9px; }
        .adj-table { width:100%; border-collapse:collapse; min-width:740px; font-size:13px; }
        .adj-table th { background:#f7f9fc; color:#66758b; text-transform:uppercase; letter-spacing:.035em; font-size:10px; text-align:left; padding:14px 15px; }
        .adj-table td { padding:14px 15px; border-top:1px solid #edf0f4; color:#475569; }
        .adj-code { color:#1d4ed8!important; font-weight:650; }.adj-status { border-radius:12px; padding:4px 8px; background:#f1f5f9; text-transform:lowercase; font-size:11px; }.adj-status.posted { background:#dcfce7; color:#166534; }.adj-status.draft { background:#f1f5f9; color:#475569; }
        .adj-actions { display:flex; gap:7px; }.button-small { min-height:30px!important; padding:5px 9px!important; font-size:12px!important; }
        .adj-empty { text-align:center!important; padding:40px 20px!important; color:#8490a3!important; }.adj-empty svg { display:block; margin:0 auto 10px; }.adj-empty strong,.adj-empty span { display:block; }.adj-empty strong { color:#334155; margin-bottom:5px; }.adj-empty span { max-width:430px; margin:auto; line-height:1.5; }
        .adj-alert,.adj-notice { display:flex; align-items:center; gap:8px; padding:12px 14px; margin:12px 0; border-radius:8px; font-size:13px; }.adj-alert { background:#fff1f2; border:1px solid #fecdd3; color:#9f1239; }.adj-notice { background:#ecfdf5; border:1px solid #a7f3d0; color:#065f46; }
        .adj-modal-backdrop { position:fixed; inset:0; z-index:1000; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:20px; }
        .adj-modal { width:min(1120px,100%); max-height:92vh; background:#fff; border-radius:14px; box-shadow:0 25px 80px rgba(15,23,42,.22); display:flex; flex-direction:column; overflow:hidden; }
        .adj-modal-header,.adj-modal-footer { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:18px 22px; border-bottom:1px solid #edf0f4; }.adj-modal-header h2 { margin:0 0 5px; font-size:19px; }.adj-modal-header p { margin:0; color:#8290a4; font-size:13px; }.adj-modal-footer { justify-content:flex-end; border-bottom:0; border-top:1px solid #edf0f4; }
        .adj-modal-body { padding:20px 22px; overflow:auto; }.adj-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }.adj-form-grid label,.adj-line label { display:flex; flex-direction:column; gap:6px; color:#475569; font-size:12px; font-weight:600; }.adj-form-grid input,.adj-form-grid select,.adj-form-grid textarea,.adj-line input,.adj-line select { width:100%; box-sizing:border-box; min-height:38px; border:1px solid #dfe3e8; border-radius:7px; padding:8px 10px; font:inherit; color:#334155; background:#fff; }.adj-notes-field { grid-column:1/-1; }
        .adj-lines-heading { display:flex; justify-content:space-between; align-items:center; margin:22px 0 12px; }.adj-lines-heading h3 { margin:0; font-size:15px; }.adj-lines { display:flex; flex-direction:column; gap:10px; }.adj-line { display:grid; grid-template-columns:1.25fr 1fr .9fr .9fr .65fr 28px; gap:10px; align-items:end; padding:13px; border:1px solid #e2e8f0; border-radius:9px; background:#fbfcfe; }.adj-remove-line { height:36px; border:1px solid #e2e8f0; border-radius:7px; background:white; color:#64748b; cursor:pointer; }.adj-remove-line:disabled { opacity:.35; cursor:not-allowed; }.adj-selected-item { grid-column:1/-1; color:#8490a3; font-weight:400; text-transform:capitalize; }
        @media(max-width:850px) { .adj-line { grid-template-columns:1fr 1fr; }.adj-remove-line { width:36px; }.adj-form-grid { grid-template-columns:1fr; }.adj-notes-field { grid-column:auto; }.adj-modal-footer { flex-wrap:wrap; } }
      `}</style>
    </main>
  );
}
