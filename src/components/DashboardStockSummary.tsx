import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ClipboardList, Package, RefreshCw, Wheat } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";

type StockSummary = {
  yarn_stock: number;
  fabric_stock: number;
  open_job_orders: number;
};

const EMPTY: StockSummary = { yarn_stock: 0, fabric_stock: 0, open_job_orders: 0 };

const fmt = (value: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);

export default function DashboardStockSummary() {
  const { company } = useCompany();
  const [summary, setSummary] = useState<StockSummary>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!company?.id) {
      setSummary(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      // SQL function must be created in Supabase before this query will work.
      const { data, error: queryError } = await supabase.rpc("dashboard_inventory_summary", {
        p_company_id: company.id,
      });
      if (queryError) throw queryError;
      const row = Array.isArray(data) ? data[0] : data;
      setSummary({
        yarn_stock: Number(row?.yarn_stock ?? 0),
        fabric_stock: Number(row?.fabric_stock ?? 0),
        open_job_orders: Number(row?.open_job_orders ?? 0),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load current stock.");
    } finally {
      setLoading(false);
    }
  }, [company?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const cards = [
    { title: "Yarn Stock", value: summary.yarn_stock, Icon: Wheat, tone: "green" },
    { title: "Fabric Stock", value: summary.fabric_stock, Icon: Package, tone: "blue" },
    { title: "Open Job Orders", value: summary.open_job_orders, Icon: ClipboardList, tone: "orange" },
  ];

  return (
    <section className="dashboard-section">
      <div className="section-title-row">
        <div>
          <h2>Current Stock</h2>
          <p>Live inventory balances from Supabase.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            className="button button-outline"
            onClick={() => void refresh()}
            disabled={loading || !company?.id}
            title="Refresh stock balances"
            aria-label="Refresh stock balances"
          >
            <RefreshCw size={16} className={loading ? "spin" : ""} />
          </button>
          <Link to="/inventory/stock" className="text-link">
            View stock <ArrowRight size={15} />
          </Link>
        </div>
      </div>
      {error && (
        <p role="alert" style={{ color: "#b42318", margin: "0 0 14px" }}>
          Unable to load stock: {error}
        </p>
      )}
      <div className="stats-grid">
        {cards.map(({ title, value, Icon, tone }) => (
          <article className="stat-card" key={title}>
            <div className={`stat-icon ${tone}`}><Icon size={21} /></div>
            <div className="stat-content">
              <span className="stat-label">{title}</span>
              <strong className="stat-value">{loading ? "…" : error ? "—" : fmt(value)}</strong>
              <span className="stat-footnote">
                {loading ? "Loading…" : error ? "Data unavailable" : "Updated from stock ledger"}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
