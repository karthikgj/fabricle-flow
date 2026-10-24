import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const modules = [
  { name: 'Inventory', description: 'Items, lots, locations and stock ledger', icon: '▦' },
  { name: 'Purchases', description: 'Goods receipts and supplier records', icon: '↓' },
  { name: 'Production', description: 'BOMs, work orders and consumption', icon: '⌘' },
  { name: 'Deliveries', description: 'Dispatches and customer transactions', icon: '↑' },
  { name: 'Payments', description: 'Receipts, supplier payments and balances', icon: '₹' },
  { name: 'Reports', description: 'Stock, production and outstanding summaries', icon: '▤' },
];

function App() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand-mark">F</div>
        <div className="brand-name">Fabricle<span>Flow</span></div>
        <div className="side-label">WORKSPACE</div>
        <div className="nav-item active">◫ <span>Overview</span></div>
        {modules.map((module) => <div className="nav-item" key={module.name}>{module.icon} <span>{module.name}</span></div>)}
        <div className="sidebar-bottom"><div className="avatar">FF</div><div><strong>Workspace</strong><small>Company setup pending</small></div></div>
      </aside>
      <section className="content">
        <header className="topbar"><div><div className="eyebrow">KNITTING OPERATIONS</div><h1>Good morning</h1><p>Your operations workspace, ready to be configured.</p></div><button className="primary" disabled>Set up company <span>↗</span></button></header>
        <section className="welcome-card"><div className="welcome-copy"><div className="pill">NEW WORKSPACE</div><h2>One clear view of your<br/>knitting business.</h2><p>Manage materials, stock, production, deliveries and payments in one connected workspace.</p><div className="progress-row"><div className="progress-track"><div className="progress-fill" /></div><span>Setup not started</span></div></div><div className="orb orb-one"/><div className="orb orb-two"/><div className="thread-art">↗<br/>↘<br/>↗</div></section>
        <div className="section-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h2>Operations</h2></div><span className="muted">6 modules planned</span></div>
        <div className="module-grid">{modules.map((module, i) => <article className="module-card" key={module.name}><div className={`module-icon tone-${i}`}>{module.icon}</div><div className="module-title-row"><h3>{module.name}</h3><span className="arrow">↗</span></div><p>{module.description}</p><span className="status">Planned</span></article>)}</div>
        <footer>FABRICLE FLOW <span>•</span> INITIAL PROJECT SCAFFOLD</footer>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
