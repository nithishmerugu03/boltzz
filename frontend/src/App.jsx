import { useState } from "react";
import { Activity, Shield } from "lucide-react";
import IncidentAnalysisForm from "./components/IncidentAnalysisForm.jsx";
import RCAAnalysis from "./pages/RCAAnalysis.jsx";
import RemediationGuide from "./pages/RemediationGuide.jsx";
import SecurityFindings from "./pages/SecurityFindings.jsx";

export default function App() {
  const [incident, setIncident] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const moduleResult = result;
  const securityModuleResult = result;

  function startAnalysis() {
    setError("");
    setIncident(null);
    setResult(null);
    setLoading(true);
  }

  function completeAnalysis(submittedIncident, analysisResult) {
    setIncident(submittedIncident);
    setResult(analysisResult);
    setLoading(false);
    setError("");
  }

  function failAnalysis(message) {
    setLoading(false);
    setError(message);
  }

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

      <IncidentAnalysisForm
        loading={loading}
        onAnalysisStart={startAnalysis}
        onAnalysisComplete={completeAnalysis}
        onAnalysisError={failAnalysis}
      />
      {error && <div className="incident-api-error" role="alert"><Shield size={16} />{error}</div>}

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
