import { useState } from "react";
import { AlertCircle, LoaderCircle, Search } from "lucide-react";

const exampleIncident = {
  incident_id: "INC-DEMO-001",
  service: "payment-service",
  severity: "critical",
  description: "Payment requests are failing after the latest release.",
  logs: [
    {
      id: "PAY-LOG-001",
      message: "Database connection acquisition timeout",
      severity: "ERROR",
      timestamp: "2026-10-31T10:02:00Z"
    },
    {
      id: "PAY-LOG-002",
      message: "Payment request failed while waiting for a database connection",
      severity: "ERROR",
      timestamp: "2026-10-31T10:03:00Z"
    }
  ],
  events: [
    {
      id: "PAY-EVENT-001",
      type: "deployment",
      message: "Payment service release completed",
      timestamp: "2026-10-31T10:00:00Z"
    }
  ]
};

export default function IncidentAnalysisForm({
  loading = false,
  onAnalysisStart,
  onAnalysisComplete,
  onAnalysisError
}) {
  const [incidentJson, setIncidentJson] = useState(JSON.stringify(exampleIncident, null, 2));
  const [inputError, setInputError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setInputError("");
    let incident;
    try {
      incident = JSON.parse(incidentJson);
      if (!incident || typeof incident !== "object" || Array.isArray(incident)) {
        throw new Error("The incident must be a JSON object.");
      }
    } catch (error) {
      setInputError(error instanceof Error ? error.message : "The incident JSON is invalid.");
      return;
    }

    onAnalysisStart?.();
    try {
      const response = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(incident)
      });
      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error(`The analysis API returned an unreadable response (${response.status}).`);
      }
      if (result?.component !== "rca_security_analysis" ||
          !["completed", "in_progress", "failed"].includes(result.status)) {
        throw new Error(`The analysis API returned an invalid response (${response.status}).`);
      }
      if (!response.ok || result.status === "failed") {
        throw new Error(result.error?.message ?? `Analysis failed (${response.status}).`);
      }
      onAnalysisComplete?.(incident, result);
    } catch (error) {
      onAnalysisError?.(error instanceof Error ? error.message : "Analysis request failed.");
    }
  }

  return (
    <form className="analysis-card incident-workbench" onSubmit={submit}>
      <div className="card-header">
        <div className="card-title-wrap">
          <span className="icon-tile rca-tile"><Search size={18} aria-hidden="true" /></span>
          <div><p className="eyebrow">LIVE ANALYSIS</p><h2>Submit incident evidence</h2></div>
        </div>
        <span className="agent-status status-complete">RAG + RCA + SECURITY</span>
      </div>
      <p className="incident-workbench-copy">
        The API searches connected historical knowledge, then runs the RCA and Security analysis. Groq is used when configured; rule-based analysis remains available as a fallback.
      </p>
      <label className="incident-json-label" htmlFor="incident-json">Incident JSON</label>
      <textarea
        id="incident-json"
        className="incident-json"
        value={incidentJson}
        onChange={(event) => setIncidentJson(event.target.value)}
        spellCheck="false"
        rows={12}
        aria-describedby="incident-json-hint"
      />
      <div className="incident-workbench-footer">
        <span id="incident-json-hint">Include an incident ID and evidence with source IDs for traceable findings.</span>
        <button type="submit" className="analysis-submit" disabled={loading}>
          {loading ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}
          {loading ? "Analyzing..." : "Analyze incident"}
        </button>
      </div>
      {(inputError) && (
        <p className="incident-form-error" role="alert"><AlertCircle size={15} />{inputError}</p>
      )}
    </form>
  );
}
