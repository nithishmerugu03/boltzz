import { Activity, Shield } from "lucide-react";
import RCAAnalysis from "./pages/RCAAnalysis.jsx";
import SecurityFindings from "./pages/SecurityFindings.jsx";

export default function App({ incident = null, rcaResult = null, securityResult = null, loading = false, error = null }) {
  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">A</div>
        <div>
          <p className="eyebrow">AUTONOMOUS INCIDENT WAR ROOM</p>
          <h1>Investigation</h1>
        </div>
        <span className="header-status"><span /> Evidence-led analysis</span>
      </header>

      <div className="page-intro">
        <div>
          <p className="eyebrow">RCA &amp; SECURITY</p>
          <h2>Understand the incident before you act.</h2>
          <p className="intro-copy">
            Review probable causes, security signals, and source evidence. Findings are hypotheses until validated.
          </p>
        </div>
        <div className="intro-badges">
          <span><Activity size={15} /> Investigation</span>
          <span><Shield size={15} /> Human review</span>
        </div>
      </div>

      <div className="analysis-grid">
        <RCAAnalysis incident={incident} result={rcaResult} loading={loading} error={error} />
        <SecurityFindings incident={incident} result={securityResult} loading={loading} error={error} />
      </div>
      <footer className="app-footer">
        Agent findings are decision support. Verify evidence and follow your incident-response procedures.
      </footer>
    </main>
  );
}