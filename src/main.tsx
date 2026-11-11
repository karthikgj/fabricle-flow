import DashboardStockSummary from "./components/DashboardStockSummary";
import DashboardCharts from "./components/DashboardCharts";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowRight,
  BarChart3,
  Boxes,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Factory,
  FileCheck,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  Settings,
  Truck,
  Users,
  Wallet,
  X,
} from "lucide-react";

import { supabase } from "./lib/supabase";
import "./styles.css";
import "./dashboard-ui.css";
import { AuthProvider, useAuthContext } from "./hooks/AuthContext";
import AuthGate from "./components/layout/AuthGate";
import { useCompany } from "./hooks/useCompany";
import Parties from "./pages/Parties";
import Items from "./pages/Items";
import Units from "./pages/Units";
import Locations from "./pages/Locations";
import Lots from "./pages/Lots";
import BOMs from "./pages/BOMs";
import GRNs from "./pages/GoodsReceipts";
import CurrentStock from "./pages/CurrentStock";
import StockAdjustments from "./pages/StockAdjustments";
import StockLedger from "./pages/StockLedger";
import Production from "./pages/Production";
import FabricStock from "./pages/FabricStock";
import Delivery from "./pages/Delivery";
import Invoices from "./pages/Invoices";
import Payments from "./pages/Payments";
import Reports from "./pages/Reports";
import OrganisationSettings from "./pages/Settings";

type NavChild = {
  name: string;
  path: string;
};

type NavItem = {
  name: string;
  path: string;
  icon: React.ElementType;
  description: string;
  children?: NavChild[];
};

const navigation: NavItem[] = [
  {
    name: "Dashboard",
    path: "/",
    icon: LayoutDashboard,
    description: "Stock, activity and production overview",
  },
  {
    name: "Masters",
    path: "/masters",
    icon: Users,
    description: "Manage the basic records used throughout your business",
    children: [
      { name: "Parties", path: "/masters/parties" },
      { name: "Items", path: "/masters/items" },
      { name: "Units", path: "/masters/units" },
      { name: "Locations", path: "/masters/locations" },
      { name: "Lots", path: "/masters/lots" },
      { name: "Bill of Materials", path: "/masters/boms" },
    ],
  },
  {
    name: "Inventory",
    path: "/inventory",
    icon: Boxes,
    description: "Track customer-supplied yarn and produced fabric",
    children: [
      { name: "Yarn Receipts / GRN", path: "/inventory/receipts" },
      { name: "Current Stock", path: "/inventory/stock" },
      { name: "Stock Adjustments", path: "/inventory/adjustments" },
      { name: "Stock Ledger", path: "/inventory/ledger" },
      { name: "Fabric Stock", path: "/inventory/fabric-stock" },
    ],
  },
  {
    name: "Production",
    path: "/production",
    icon: Factory,
    description: "Record production, calculate yarn consumption and update fabric stock",
  },
  {
    name: "Delivery",
    path: "/delivery",
    icon: Truck,
    description: "Manage yarn deliveries, fabric deliveries and challans",
    children: [
      { name: "Delivery", path: "/delivery" },
    ],
  },
  {
    name: "Invoices",
    path: "/invoices",
    icon: FileText,
    description: "Manage job-work bills and processing-charge invoices",
  },
  {
    name: "Payments",
    path: "/payments",
    icon: Wallet,
    description: "Manage receipts, advances, allocations and payments",
  },
  {
    name: "Reports",
    path: "/reports",
    icon: BarChart3,
    description: "Review stock, production, deliveries and outstanding balances", 
  },
  {
    name: "Settings",
    path: "/settings",
    icon: Settings,
    description: "Company profile, document numbering, users and permissions",
  },
];

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-heading">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && <div className="page-actions">{action}</div>}
    </header>
  );
}

function Dashboard() {
  const today = formatDate(new Date());
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [stockRefreshKey, setStockRefreshKey] = useState(0);
  const { company } = useCompany();
  const [activityCounts, setActivityCounts] = useState<Record<string, number>>({});
  const [activityErrors, setActivityErrors] = useState<Record<string, boolean>>({});
  const [activityLoading, setActivityLoading] = useState(false);

  useEffect(() => {
    if (!company?.id) {
      setActivityCounts({});
      setActivityErrors({});
      return;
    }
    let active = true;
    setActivityLoading(true);
    const metrics = [
      { key: "receipts", table: "goods_receipts", date: "receipt_date" },
      { key: "production", table: "production_orders", date: "production_date" },
      { key: "deliveries", table: "deliveries", date: "delivery_date" },
      { key: "invoices", table: "sales_invoices", date: "invoice_date" },
    ];

    const load = async () => {
      const nextCounts: Record<string, number> = {};
      const nextErrors: Record<string, boolean> = {};
      await Promise.all(metrics.map(async ({ key, table, date }) => {
        try {
          // Supabase-js allows dynamically named public tables; the existing
          // app's company RLS policies still apply to these requests.
          const { count, error } = await supabase
            .from(table)
            .select("id", { count: "exact", head: true })
            .eq("company_id", company.id)
            .gte(date, fromDate)
            .lte(date, toDate);
          if (error) throw error;
          nextCounts[key] = count ?? 0;
        } catch {
          nextErrors[key] = true;
        }
      }));
      if (active) {
        setActivityCounts(nextCounts);
        setActivityErrors(nextErrors);
        setActivityLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [company?.id, fromDate, toDate, stockRefreshKey]);

  function setToday() {
    const date = formatDate(new Date());
    setFromDate(date);
    setToDate(date);
  }

  function setThisMonth() {
    const now = new Date();
    setFromDate(formatDate(new Date(now.getFullYear(), now.getMonth(), 1)));
    setToDate(formatDate(now));
  }

  function refreshDashboard() {
    setStockRefreshKey((value) => value + 1);
  }

  return (
    <>
      <div className="ff-dashboard-tools" aria-label="Dashboard filters">
        <div className="ff-dashboard-tools-label">Overview</div>
        <div className="ff-dashboard-filter-group">
          <label htmlFor="ff-from-date">From</label>
          <input
            id="ff-from-date"
            type="date"
            value={fromDate}
            max={toDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
          <label htmlFor="ff-to-date">To</label>
          <input
            id="ff-to-date"
            type="date"
            value={toDate}
            min={fromDate}
            onChange={(event) => setToDate(event.target.value)}
          />
          <button type="button" onClick={setToday}>Today</button>
          <button type="button" onClick={setThisMonth}>This month</button>
          <button type="button" className="ff-dashboard-refresh" onClick={refreshDashboard} aria-label="Refresh dashboard stock" title="Refresh dashboard stock">
            <RefreshCw size={17} />
          </button>
        </div>
      </div>

      <DashboardStockSummary key={stockRefreshKey} />

      <section className="dashboard-section">
        <div className="section-title-row">
          <div>
            <h2>Activity</h2>
            <p>Transactions for the selected date range.</p>
          </div>
          <span className="date-range-label">
            {fromDate} — {toDate}
          </span>
        </div>

        <div className="activity-grid">
          <ActivityCard
            count={activityCounts.receipts}
            loading={activityLoading}
            error={activityErrors.receipts}
            title="Yarn Receipts"
            description="Customer-supplied yarn received"
            icon={ArrowDownToLine}
            path="/inventory/receipts"
          />
          <ActivityCard
            count={activityCounts.production}
            loading={activityLoading}
            error={activityErrors.production}
            title="Production"
            description="Record yarn consumption and fabric output"
            icon={Factory}
            path="/production"
          />
          <ActivityCard
            count={activityCounts.deliveries}
            loading={activityLoading}
            error={activityErrors.deliveries}
            title="Deliveries"
            description="Customer deliveries in selected period"
            icon={Truck}
            path="/delivery"
          />
          <ActivityCard
            count={activityCounts.invoices}
            loading={activityLoading}
            error={activityErrors.invoices}
            title="Invoices"
            description="Sales invoices in selected period"
            icon={CreditCard}
            path="/invoices"
          />
        </div>
      </section>

      <DashboardCharts refreshKey={stockRefreshKey} />

    </>
  );
}

function ActivityCard({
  title,
  count,
  loading = false,
  error = false,
  description,
  icon: Icon,
  path,
}: {
  title: string;
  count?: number;
  loading?: boolean;
  error?: boolean;
  description: string;
  icon: React.ElementType;
  path: string;
}) {
  return (
    <Link to={path} className="activity-card">
      <div className="activity-card-top">
        <div className="activity-icon">
          <Icon size={19} />
        </div>
        <ArrowRight size={16} className="activity-arrow" />
      </div>
      <strong>{title}</strong>
      <span>{description}</span>
      <div className="activity-empty">
        {loading ? "Loading…" : error ? "Count unavailable" : `${count ?? 0} records in period`}
      </div>
    </Link>
  );
}

function ModulePage({ module }: { module: NavItem }) {
  const [search, setSearch] = useState("");
  const Icon = module.icon;

  const children = module.children?.filter((child) =>
    child.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <PageHeader title={module.name} subtitle={module.description} />

      <section className="module-intro panel">
        <div className="module-intro-icon">
          <Icon size={25} />
        </div>
        <div>
          <span className="eyebrow">FABRICLE FLOW WORKSPACE</span>
          <h2>{module.name}</h2>
          <p>{module.description}.</p>
        </div>
      </section>

      {module.children && (
        <section className="dashboard-section">
          <div className="section-title-row">
            <div>
              <h2>{module.name} workspace</h2>
              <p>Choose a page to continue.</p>
            </div>

            <div className="search-box">
              <input
                aria-label={`Search ${module.name} pages`}
                placeholder="Find a page..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>

          <div className="page-links-grid">
            {children?.map((child) => (
              <Link
                to={child.path}
                className="page-link-card"
                key={child.path}
              >
                <div className="page-link-icon">
                  <FileCheck size={19} />
                </div>
                <div>
                  <strong>{child.name}</strong>
                  <span>Open {child.name.toLowerCase()}</span>
                </div>
                <ChevronRight size={18} />
              </Link>
            ))}

            {children?.length === 0 && (
              <div className="empty-state">No pages match your search.</div>
            )}
          </div>
        </section>
      )}

      <section className="empty-workspace panel">
        <div className="empty-state-icon">
          <ClipboardList size={25} />
        </div>
        <h3>{module.name} screens will be connected here</h3>
        <p>
          The navigation is ready, but the business forms, validations,
          permissions and database operations still need to be implemented.
        </p>
        <Link to="/" className="button button-outline">
          Back to Dashboard <ArrowRight size={15} />
        </Link>
      </section>
    </>
  );
}

function Sidebar({
  mobileOpen,
  closeMobile,
}: {
  mobileOpen: boolean;
  closeMobile: () => void;
}) {
  const location = useLocation();
  const [expanded, setExpanded] = useState<string[]>(["Masters", "Inventory"]);

  function toggleSection(name: string) {
    setExpanded((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name]
    );
  }

  return (
    <>
      {mobileOpen && (
        <button
          className="mobile-overlay"
          aria-label="Close menu"
          onClick={closeMobile}
        />
      )}

      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand-area">
          <Link to="/" className="brand-link" onClick={closeMobile}>
            <img
              className="brand-logo"
              src="/logo.svg"
              alt="Fabricle Flow logo"
            />
            <span className="brand-text">
              <strong>Fabricle Flow</strong>
              <small>Inventory &amp; Production</small>
            </span>
          </Link>

          <button
            className="mobile-close"
            aria-label="Close navigation"
            onClick={closeMobile}
          >
            <X size={19} />
          </button>
        </div>

        <div className="sidebar-label">WORKSPACE</div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active =
              item.path === "/"
                ? location.pathname === "/"
                : location.pathname === item.path ||
                  location.pathname.startsWith(`${item.path}/`);

            const isExpanded = expanded.includes(item.name);

            return (
              <div className="nav-group" key={item.path}>
                {item.children ? (
                  <button
                    type="button"
                    className={`nav-item ${active ? "active" : ""}`}
                    onClick={() => toggleSection(item.name)}
                    aria-expanded={isExpanded}
                  >
                    <Icon size={18} />
                    <span>{item.name}</span>
                    {isExpanded ? (
                      <ChevronDown className="nav-chevron" size={15} />
                    ) : (
                      <ChevronRight className="nav-chevron" size={15} />
                    )}
                  </button>
                ) : (
                  <Link
                    to={item.path}
                    onClick={closeMobile}
                    className={`nav-item ${active ? "active" : ""}`}
                  >
                    <Icon size={18} />
                    <span>{item.name}</span>
                  </Link>
                )}

                {item.children && isExpanded && (
                  <div className="nav-children">
                    {item.children.map((child) => (
                      <Link
                        to={child.path}
                        key={child.path}
                        onClick={closeMobile}
                        className={`nav-child ${
                          location.pathname === child.path ? "active" : ""
                        }`}
                      >
                        <span className="nav-child-dot" />
                        {child.name}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-footer-icon">
            <Settings size={17} />
          </div>
          <div>
            <strong>Fabricle Flow</strong>
            <small>Knitting job-work ERP</small>
          </div>
        </div>
      </aside>
    </>
  );
}

function titleForPath(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  const exact: Record<string, string> = {
    "/masters/parties": "Parties",
    "/masters/items": "Items",
    "/masters/units": "Units",
    "/masters/locations": "Locations",
    "/masters/lots": "Lots",
    "/masters/boms": "Bill of Materials",
    "/inventory/receipts": "Yarn Receipts / GRN",
    "/inventory/stock": "Current Stock",
    "/inventory/adjustments": "Stock Adjustments",
    "/inventory/ledger": "Stock Ledger",
    "/inventory/fabric-stock": "Fabric Stock",
    "/production": "Production",
    "/delivery": "Delivery",
    "/delivery/yarn": "Delivery",
    "/delivery/fabric": "Delivery",
    "/delivery/challans": "Delivery",
    "/invoices": "Invoices",
    "/payments": "Payments",
    "/reports": "Reports",
    "/settings": "Settings",
  };
  if (exact[pathname]) return exact[pathname];
  if (pathname.startsWith("/reports/")) {
    const leaf = pathname.split("/").filter(Boolean).pop() ?? "Reports";
    return leaf.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  return navigation.find((item) => pathname.startsWith(item.path + "/"))?.name ?? "Workspace";
}

function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  const location = useLocation();
  const { company, loading: companyLoading } = useCompany();
  const { user, signOut } = useAuthContext();

  const activeModule = navigation.find((item) =>
    item.path === "/"
      ? location.pathname === "/"
      : location.pathname === item.path ||
        location.pathname.startsWith(`${item.path}/`)
  );

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError("");

    try {
      await signOut();
      setUserMenuOpen(false);
    } catch (error) {
      setSignOutError(
        error instanceof Error
          ? error.message
          : "Unable to sign out. Please try again."
      );
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="app-shell">
      <Sidebar
        mobileOpen={mobileOpen}
        closeMobile={() => setMobileOpen(false)}
      />

      <div className="main-area">
        <header className="topbar">
          <button
            type="button"
            className="mobile-menu-button"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={21} />
          </button>

          <div className="topbar-context ff-topbar-heading">
            <span className="topbar-context-icon" aria-hidden="true">
              {activeModule ? React.createElement(activeModule.icon, { size: 18 }) : <LayoutDashboard size={18} />}
            </span>
            <div className="ff-topbar-title-group">
              <strong className="ff-topbar-title">{titleForPath(location.pathname)}</strong>
              {!companyLoading && company?.name && (
                <span className="ff-topbar-company">{company.name}</span>
              )}
            </div>
          </div>

          <div className="topbar-right">
            <div className="user-menu">
              <button
                type="button"
                className="user-avatar"
                title={user?.email ?? "Account"}
                aria-label="Open account menu"
                aria-expanded={userMenuOpen}
                onClick={() => setUserMenuOpen((open) => !open)}
              >
                {(user?.email?.charAt(0) || "U").toUpperCase()}
              </button>

              {userMenuOpen && (
                <div className="user-menu-panel">
                  <strong>
                    {user?.user_metadata?.full_name || "Your account"}
                  </strong>
                  <span>{user?.email}</span>

                  {signOutError && (
                    <p className="auth-message" role="alert">
                      {signOutError}
                    </p>
                  )}

                  <button
                    type="button"
                    className="user-menu-signout"
                    disabled={signingOut}
                    onClick={() => void handleSignOut()}
                  >
                    <LogOut size={16} />
                    {signingOut ? "Signing out..." : "Sign out"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="page-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />

            {/* Implemented master and inventory pages */}
            <Route path="/masters/parties" element={<Parties />} />
            <Route path="/masters/items" element={<Items />} />
            <Route path="/masters/units" element={<Units />} />
            <Route path="/masters/locations" element={<Locations />} />
            <Route path="/masters/lots" element={<Lots />} />
            <Route path="/masters/boms" element={<BOMs />} />
            <Route path="/inventory/receipts" element={<GRNs />} />
            <Route path="/inventory/stock" element={<CurrentStock />} />
            <Route path="/inventory/adjustments" element={<StockAdjustments />} />
            <Route path="/inventory/ledger" element={<StockLedger />} />
            <Route path="/inventory/fabric-stock" element={<FabricStock />} />
            <Route path="/production" element={<Production />} />
            <Route path="/delivery" element={<Delivery />} />
            <Route path="/delivery/yarn" element={<Delivery />} />
            <Route path="/delivery" element={<Delivery />} />
            <Route path="/delivery/challans" element={<Delivery />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/reports/*" element={<Reports />} />
            <Route path="/settings" element={<OrganisationSettings />} />

            
{navigation
  .filter(
    (item) => item.path !== "/" && item.path !== "/reports" && item.path !== "/settings" && item.path !== "/delivery"
  )
  .map((item) => (
    <Route
      key={item.path}
      path={item.path}
      element={<ModulePage module={item} />}
    />
  ))}


            {navigation.flatMap((item) =>
              (item.children ?? [])
                .filter((child) => child.path !== "/inventory/receipts")
                .map((child) => (
                  <Route
                    key={child.path}
                    path={child.path}
                    element={
                      <ModulePage
                        module={{
                          name: child.name,
                          path: child.path,
                          icon: item.icon,
                          description: `${child.name} for knitting job-work operations`,
                        }}
                      />
                    }
                  />
                ))
            )}

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>

          <footer className="app-footer">
          </footer>
        </main>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  return (
    <AuthGate>
      <AppLayout />
    </AuthGate>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AuthenticatedApp />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
