import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, PieChart, RefreshCw } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";

type MonthRow = {
  month: string;
  receipts: number;
  production: number;
  deliveries: number;
  invoices: number;
};
type StatusRow = { status: string; count: number };
type ChartSummary = { months: MonthRow[]; statuses: StatusRow[] };

const SERIES = [
  { key: "receipts" as const, label: "Yarn receipts", color: "#4477cf" },
  { key: "production" as const, label: "Production", color: "#268c85" },
  { key: "deliveries" as const, label: "Deliveries", color: "#e2a24a" },
  { key: "invoices" as const, label: "Invoices", color: "#8868b7" },
];
const STATUS_COLORS = ["#4477cf", "#28a189", "#e2a24a", "#a77adc", "#ef7676", "#94a3b8"];
const asNumber = (n: unknown) => Number.isFinite(Number(n)) ? Number(n) : 0;
const niceStatus = (status: string) => status.replace(/_/g, " ").replace(/\b\w/g, x => x.toUpperCase());

export default function DashboardCharts({ refreshKey = 0 }: { refreshKey?: number }) {
  const { company } = useCompany();
  const [data, setData] = useState<ChartSummary>({ months: [], statuses: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(async () => {
    if (!company?.id) {
      setData({ months: [], statuses: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const { data: response, error: requestError } = await supabase.rpc("dashboard_chart_summary", {
      p_company_id: company.id,
    });
    if (requestError) {
      setError(requestError.message);
      setLoading(false);
      return;
    }
    const result = response as Partial<ChartSummary> | null;
    setData({
      months: Array.isArray(result?.months) ? result.months.map(row => ({
        month: String(row.month), receipts: asNumber(row.receipts), production: asNumber(row.production),
        deliveries: asNumber(row.deliveries), invoices: asNumber(row.invoices),
      })) : [],
      statuses: Array.isArray(result?.statuses) ? result.statuses.map(row => ({
        status: String(row.status), count: asNumber(row.count),
      })) : [],
    });
    setLoading(false);
  }, [company?.id]);

  useEffect(() => { void refresh(); }, [refresh, refreshKey, reloadKey]);
  const maxBar = useMemo(() => Math.max(1, ...data.months.flatMap(month => SERIES.map(series => month[series.key]))), [data.months]);
  const totalOrders = data.statuses.reduce((sum, row) => sum + row.count, 0);
  const circumference = 2 * Math.PI * 72;
  let running = 0;

  return (
    <section className="ff-dashboard-charts" aria-label="Business analytics">
      <div className="ff-charts-heading">
        <div><h2>Business Analytics</h2><p>Live business activity for the last six calendar months.</p></div>
        <button type="button" className="ff-charts-refresh" disabled={loading} onClick={() => setReloadKey(k => k + 1)} title="Refresh analytics" aria-label="Refresh analytics"><RefreshCw size={16}/></button>
      </div>
      {error && <p className="ff-chart-error" role="alert">Charts could not load: {error}. Run the supplied SQL function in Supabase, then refresh.</p>}
      <div className="ff-charts-grid">
        <article className="ff-chart-card">
          <div className="ff-chart-card-heading"><div className="ff-chart-icon"><BarChart3 size={18}/></div><div><h3>Monthly Transactions</h3><p>Record counts by month</p></div></div>
          {loading ? <div className="ff-chart-empty">Loading monthly activity…</div> : error ? <div className="ff-chart-empty">Data unavailable</div> : (
            <>
              <div className="ff-chart-legend">{SERIES.map(series => <span key={series.key}><i style={{ backgroundColor: series.color }}/>{series.label}</span>)}</div>
              <div className="ff-bar-chart" role="img" aria-label="Monthly number of yarn receipts, production orders, deliveries, and invoices">
                {data.months.map(month => <div className="ff-bar-group" key={month.month}>
                  <div className="ff-bar-columns">
                    {SERIES.map(series => <div key={series.key} className="ff-bar" style={{ height: `${Math.max(0, (month[series.key] / maxBar) * 100)}%`, backgroundColor: series.color }} title={`${month.month} — ${series.label}: ${month[series.key]}`} aria-label={`${series.label}: ${month[series.key]}`} />)}
                  </div>
                  <span className="ff-bar-month">{month.month}</span>
                </div>)}
              </div>
              <p className="ff-chart-caption">Counts include saved draft and posted records. Zero means no records for that month.</p>
            </>
          )}
        </article>

        <article className="ff-chart-card">
          <div className="ff-chart-card-heading"><div className="ff-chart-icon"><PieChart size={18}/></div><div><h3>Production Order Status</h3><p>All visible production orders</p></div></div>
          {loading ? <div className="ff-chart-empty">Loading production statuses…</div> : error ? <div className="ff-chart-empty">Data unavailable</div> : (
            <div className="ff-donut-area">
              <svg className="ff-donut" viewBox="0 0 210 210" role="img" aria-label={`Production orders by status. Total ${totalOrders}`}>
                <circle cx="105" cy="105" r="72" stroke="#edf1f6" strokeWidth="26" fill="none" />
                {totalOrders > 0 && data.statuses.map((row, index) => {
                  const length = (row.count / totalOrders) * circumference;
                  const offset = running;
                  running += length;
                  return <circle key={row.status} cx="105" cy="105" r="72" fill="none" strokeWidth="26" stroke={STATUS_COLORS[index % STATUS_COLORS.length]} strokeDasharray={`${length} ${Math.max(0, circumference - length)}`} strokeDashoffset={-offset} transform="rotate(-90 105 105)"><title>{`${niceStatus(row.status)}: ${row.count}`}</title></circle>;
                })}
                <text x="105" y="103" textAnchor="middle" className="ff-donut-total">{totalOrders.toLocaleString("en-IN")}</text>
                <text x="105" y="125" textAnchor="middle" className="ff-donut-label">Orders</text>
              </svg>
              <div className="ff-donut-legend">
                {data.statuses.length ? data.statuses.map((row, index) => <div key={row.status} className="ff-donut-legend-row"><span><i style={{ backgroundColor: STATUS_COLORS[index % STATUS_COLORS.length] }}/>{niceStatus(row.status)}</span><strong>{row.count.toLocaleString("en-IN")}</strong></div>) : <p className="ff-chart-caption">No production orders recorded yet.</p>}
              </div>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
