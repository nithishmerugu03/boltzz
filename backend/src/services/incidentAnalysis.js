import { createModuleResponse, incidentIdOf } from "../utils/agentResponse.js";
import { runRcaSecurityAnalysis } from "../agents/rcaAgent.js";

const STOP_WORDS = new Set([
  "about", "after", "before", "during", "from", "incident", "service",
  "that", "there", "this", "with", "were", "when", "where"
]);

export function incidentSearchQuery(incident) {
  const evidenceText = ["logs", "events", "parsedEvents", "correlatedEvents", "metrics", "timeline"]
    .flatMap((key) => Array.isArray(incident[key]) ? incident[key] : [])
    .map((item) => typeof item === "string"
      ? item
      : item?.message ?? item?.description ?? item?.error ?? item?.name ?? "")
    .filter((value) => typeof value === "string")
    .join(" ");
  const source = [
    incident.service,
    incident.serviceName,
    incident.description,
    incident.title,
    evidenceText
  ].filter((value) => typeof value === "string").join(" ");
  const words = source.toLowerCase().match(/[a-z0-9][a-z0-9._:-]*/g) ?? [];
  const query = [...new Set(words.filter((word) => word.length > 2 && !STOP_WORDS.has(word)))]
    .slice(0, 8)
    .join(" ");
  return query || "incident failure";
}

export function createIncidentAnalysis({ getRetriever, analyze = runRcaSecurityAnalysis } = {}) {
  if (typeof getRetriever !== "function") throw new TypeError("getRetriever must be a function");
  if (typeof analyze !== "function") throw new TypeError("analyze must be a function");

  return async function analyzeIncident(incident) {
    const incidentId = incidentIdOf(incident);
    if (!incident || typeof incident !== "object" || Array.isArray(incident)) {
      return createModuleResponse({
        incident,
        status: "failed",
        summary: "Incident analysis requires a JSON object.",
        error: {
          code: "VALIDATION_ERROR",
          message: "Incident analysis requires a JSON object.",
          details: null
        }
      });
    }
    if (typeof incidentId !== "string" || !incidentId.trim()) {
      return createModuleResponse({
        incident,
        status: "failed",
        summary: "A non-empty incident_id is required.",
        error: {
          code: "VALIDATION_ERROR",
          message: "A non-empty incident_id is required.",
          details: null
        }
      });
    }

    let similarIncidents = [];
    let retrievalNote = "";
    const query = incidentSearchQuery(incident);
    try {
      const retriever = await getRetriever();
      const result = await retriever.retrieveKnowledgeWithScores(query, { limit: 5 });
      similarIncidents = result.results.map((document) => ({
        incidentId: document.incidentId,
        service: document.affectedService,
        symptoms: document.symptoms,
        validatedRootCause: document.rootCause,
        resolution: document.recommendedResolution?.join(" ") ?? null,
        similarityScore: result.similarityScores?.[document.incidentId] ?? null,
        reference: document.incidentId
      }));
      if (result.searchMode === "keyword") {
        retrievalNote = "Historical context came from keyword retrieval; no semantic similarity score was available.";
      }
    } catch {
      retrievalNote = "Historical knowledge retrieval was unavailable; RCA and Security analysis proceeded without historical context.";
    }

    const response = await analyze(incident, similarIncidents);
    if (retrievalNote) {
      response.summary = `${response.summary} ${retrievalNote}`.trim();
      response.data.reasoning = `${response.data.reasoning} ${retrievalNote}`.trim();
    }
    return response;
  };
}
