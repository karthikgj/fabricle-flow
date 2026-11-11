import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ClipboardList,
  IndianRupee,
  Package,
  RefreshCw,
  Truck,
  Wheat,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCompany } from "../hooks/useCompany";

type InventorySummary = {
  yarn_stock: number;
  fabric_stock: number;
  open_job_orders: number;
};

type OperationalSummary = {
  pending_deliveries: number;
  outstanding_receivables: number;
};

const EMPTY_INVENTORY: InventorySummary = {
  yarn_stock: 0,
  fabric_stock: 0,
  open_job_orders: 0,
};
const EMPTY_OPERATIONS: OperationalSummary = {
  pending_deliveries: 0,
  outstanding_receivables: 0,
};

const quantity = (value: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);
const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);

export default function DashboardStockSummary() {
  const { company } = useCompany();
  const [inventory, setInventory] = useState<InventorySummary>(EMPTY_INVENTORY);
  const [operations, setOperations] = useState<OperationalSummary>(EMPTY_OPERATIONS);
  const [loading, setLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState("");
  const [operationsError, setOperationsError] = useState("");

  const refresh = useCallback(async () => {
    if (!company?.id) {
      setInventory(EMPTY_INVENTORY);
      setOperations(EMPTY_OPERATIONS);
      setLoading(false);
      return;
    }
    setLoading(true);
    setInventoryError("");
    setOperationsError("");

    const [inventoryResult, operationsResult] = await Promise.all([
      supabase.rpc("dashboard_inventory_summary", { p_company_id: company.id }),
      supabase.rpc("dashboard_operational_kpis", { p_company_id: company.id }),
    ]);

    if (inventoryResult.error) {
      setInventoryError(inventoryResult.error.message);
    } else {
      const row = Array.isArray(inventoryResult.data)
        ? inventoryResult.data[0]
        : inventoryResult.data;
      setInventory({
        yarn_stock: Number(row?.yarn_stock ?? 0),
        fabric_stock: Number(row?.fabric_stock ?? 0),
        open_job_orders: Number(row?.open_job_orders ?? 0),
      });
    }

    if (operationsResult.error) {
      setOperationsError(operationsResult.error.message);
    } else {
      const row = Array.isArray(operationsResult.data)
        ? operationsResult.data[0]
        : operationsResult.data;
      setOperations({
        pending_deliveries: Number(row?.pending_deliveries ?? 0),
        outstanding_receivables: Number(row?.outstanding_receivables ?? 0),
      });
    }
    setLoading(false);
  }, [company?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const cards = [
    {
      title: "Available Yarn Stock",
      value: quantity(inventory.yarn_stock),
      Icon: Wheat,
      tone: "green",
      href: "/inventory/stock",
      note: "Net posted ledger quantity",
      unavailable: !!inventoryError,
    },
    {
      title: "Available Fabric Stock",
      value: quantity(inventory.fabric_stock),
      Icon: Package,
      tone: "blue",
      href: "/inventory/fabric-stock",
      note: "Net posted ledger quantity",
      unavailable: !!inventoryError,
    },
    {
      title: "Open Production Orders",
      value: quantity(inventory.open_job_orders),
      Icon: ClipboardList,
      tone: "orange",
      href: "/production",
      note: "Draft production orders",
      unavailable: !!inventoryError,
    },
    {
      title: "Pending Deliveries",
      value: quantity(operations.pending_deliveries),
      Icon: Truck,
      tone: "purple",
      href: "/delivery",
      note: "Draft delivery documents",
      unavailable: !!operationsError,
    },
    {
      title: "Outstanding Receivables",
      value: money(operations.outstanding_receivables),
      Icon: IndianRupee,
      tone: "teal",
      href: "/reports/outstanding",
      note: "Issued invoices less posted receipts",
      unavailable: !!operationsError,
    },
  ];

  return (
    <section className="dashboard-section ff-overview-section" aria-label="Business overview">
      <div className="section-title-row ff-overview-heading">
        <div>
          <h2>Business Overview</h2>
          <p>Live stock, production, delivery and customer balances.</p>
        </div>
        <button
          type="button"
          className="button button-outline ff-overview-refresh"
          onClick={() => void refresh()}
          disabled={loading || !company?.id}
          aria-label="Refresh business overview"
          title="Refresh business overview"
        >
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </div>

      {inventoryError && (
        <p role="alert" className="ff-overview-error">
          Stock and production KPIs could not load: {inventoryError}
        </p>
      )}
      {operationsError && (
        <p role="alert" className="ff-overview-error">
          Delivery and receivables KPIs could not load: {operationsError}
        </p>
      )}

      <div className="ff-overview-grid">
        {cards.map(({ title, value, Icon, tone, href, note, unavailable }) => (
          <Link className="ff-overview-card" to={href} key={title}>
            <span className={`ff-overview-icon ff-overview-icon--${tone}`}>
              <Icon size={21} />
            </span>
            <span className="ff-overview-card-body">
              <span className="ff-overview-card-title">{title}</span>
              <strong className="ff-overview-value">
                {loading ? "…" : unavailable ? "—" : value}
              </strong>
              <span className="ff-overview-note">
                {loading ? "Loading…" : unavailable ? "Data unavailable" : note}
              </span>
            </span>
            <ArrowRight className="ff-overview-card-arrow" size={16} />
          </Link>
        ))}
      </div>
      <p className="ff-overview-disclaimer">
        Stock values are net quantities from the stock ledger; verify units before combining differently measured items. Monetary amounts are in INR.
      </p>
    </section>
  );
}
