import { Activity, Shield } from "lucide-react";
import RCAAnalysis from "./pages/RCAAnalysis.jsx";
import RemediationGuide from "./pages/RemediationGuide.jsx";
import SecurityFindings from "./pages/SecurityFindings.jsx";

export default function App({
  incident = null,
  result = null,
  rcaResult = null,
  securityResult = null,
  loading = false,
  error = null
}) {
  const moduleResult = result ?? rcaResult;
  const securityModuleResult = result ?? securityResult ?? rcaResult;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">A</div>
        <div>
          <p className="eyebrow">AUTONOMOUS INCIDENT WAR ROOM</p>
          <h1>Investigation and Recovery</h1>
        </div>
        <span className="header-status"><span /> Evidence-led analysis</span>
      </header>

      <div className="page-intro">
        <div>
          <p className="eyebrow">RCA, SECURITY &amp; REMEDIATION</p>
          <h2>Understand the incident before you act.</h2>
          <p className="intro-copy">
            Review probable causes and security signals, then assess runbook-aware recovery recommendations. Proposed changes stay under engineer review.
          </p>
        </div>
        <div className="intro-badges">
          <span><Activity size={15} /> Investigation</span>
          <span><Shield size={15} /> Human review</span>
        </div>
      </div>

      <div className="analysis-grid">
        <RCAAnalysis incident={incident} result={moduleResult} loading={loading} error={error} />
        <SecurityFindings incident={incident} result={securityModuleResult} loading={loading} error={error} />
      </div>

      <RemediationGuide incident={incident} result={moduleResult} />

      <footer className="app-footer">
        Agent findings are decision support. Verify evidence and follow incident-response procedures. This application does not execute production changes.
      </footer>
    </main>
  );
}
