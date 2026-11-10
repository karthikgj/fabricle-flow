import { Link, useLocation } from "react-router-dom";
import {
  Boxes,
  Factory,
  Truck,
  WalletCards,
  Package,
  Wallet,
} from "lucide-react";

import StockReport from "./StockReport";
import OutstandingReport from "./OutstandingReport";
import FabricStock from "./FabricStock";
import ProductionReport from "./ProductionReport";
import DeliveryReport from "./DeliveryReport";
import PaymentsReport from "./PaymentsReport";
import "./Reports.css";

const reportTabs = [
  { label: "Stock", path: "/reports/stock", icon: Boxes },
  { label: "Fabric Stock", path: "/reports/fabric-stock", icon: Package },
  { label: "Outstanding", path: "/reports/outstanding", icon: WalletCards },
  { label: "Production", path: "/reports/production", icon: Factory },
  { label: "Delivery", path: "/reports/delivery", icon: Truck },
  { label: "Payments", path: "/reports/payments", icon: Wallet },
];

export default function Reports() {
  const location = useLocation();
  const path = location.pathname;

  const activePath =
    path === "/reports" || path === "/reports/"
      ? "/reports/stock"
      : reportTabs.find((tab) => tab.path === path)?.path ?? "/reports/stock";

  let content;
  switch (activePath) {
    case "/reports/stock":
      content = <StockReport />;
      break;
    case "/reports/fabric-stock":
      content = <FabricStock />;
      break;
    case "/reports/outstanding":
      content = <OutstandingReport />;
      break;
    case "/reports/production":
      content = <ProductionReport />;
      break;
    case "/reports/delivery":
      content = <DeliveryReport />;
      break;
    case "/reports/payments":
      content = <PaymentsReport />;
      break;
    default:
      content = <StockReport />;
  }

  return (
    <div className="reports-workspace">
      <header className="reports-page-heading">
        <div><h1>Reports</h1></div>
      </header>
      <nav className="reports-tabs" aria-label="Reports">
        {reportTabs.map(({ label, path: tabPath, icon: Icon }) => (
          <Link
            key={tabPath}
            to={tabPath}
            className={`reports-tab ${activePath === tabPath ? "active" : ""}`}
            aria-current={activePath === tabPath ? "page" : undefined}
          >
            <Icon size={17} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      <div className="reports-content">{content}</div>
    </div>
  );
}
