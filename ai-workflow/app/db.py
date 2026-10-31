"""MongoDB access: Incidents collection and AuditEvents audit service."""
from __future__ import annotations

import hashlib
import uuid
from typing import Any

from pymongo import ASCENDING, MongoClient, ReturnDocument
from pymongo.errors import PyMongoError

from . import config
from .contract import utc_now

AUDIT_EVENT_TYPES = {
    "INCIDENT_CREATED", "WORKFLOW_STARTED", "COMPONENT_STARTED", "COMPONENT_COMPLETED",
    "COMPONENT_FAILED", "RCA_GENERATED", "REMEDIATION_PROPOSED", "APPROVAL_REQUESTED",
    "REMEDIATION_APPROVED", "REMEDIATION_REJECTED", "INCIDENT_RESOLVED", "WORKFLOW_COMPLETED",
}
SECRET_HINTS = ("key", "token", "secret", "password", "authorization", "credential")


class DatabaseUnavailable(Exception):
    pass


def _scrub(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: ("[REDACTED]" if any(h in k.lower() for h in SECRET_HINTS) else _scrub(v))
                for k, v in value.items()}
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    return value


class Database:
    def __init__(self, uri: str | None = None, db_name: str | None = None):
        self.client = MongoClient(uri or config.get("MONGODB_URI", "mongodb://127.0.0.1:27017"),
                                  serverSelectionTimeoutMS=2000, tz_aware=True)
        self.db = self.client[db_name or config.get("MONGODB_DB", "aegisops")]
        self.incidents = self.db["Incidents"]
        self.audit = self.db["AuditEvents"]
        self._indexed = False

    def ensure_indexes(self) -> None:
        if self._indexed:
            return
        try:
            self.incidents.create_index("incident_id", unique=True)
            self.audit.create_index([("incident_id", ASCENDING), ("timestamp", ASCENDING), ("seq", ASCENDING)])
            self.audit.create_index("dedupe_key", unique=True)
        except PyMongoError as exc:
            raise DatabaseUnavailable(f"MongoDB unavailable: {exc.__class__.__name__}") from None
        self._indexed = True

    # ---- incidents --------------------------------------------------------
    def create_incident(self, doc: dict) -> dict:
        self.ensure_indexes()
        try:
            if self.incidents.find_one({"incident_id": doc["incident_id"]}):
                raise ValueError(f"Incident {doc['incident_id']} already exists")
            self.incidents.insert_one(dict(doc))
        except PyMongoError as exc:
            raise DatabaseUnavailable(f"MongoDB unavailable: {exc.__class__.__name__}") from None
        return self.get_incident(doc["incident_id"])

    def get_incident(self, incident_id: str) -> dict | None:
        try:
            return self.incidents.find_one({"incident_id": incident_id}, {"_id": 0})
        except PyMongoError as exc:
            raise DatabaseUnavailable(f"MongoDB unavailable: {exc.__class__.__name__}") from None

    def list_incidents(self) -> list[dict]:
        try:
            return list(self.incidents.find({}, {"_id": 0, "logs": 0}).sort("created_at", -1).limit(100))
        except PyMongoError as exc:
            raise DatabaseUnavailable(f"MongoDB unavailable: {exc.__class__.__name__}") from None

    def update_incident(self, incident_id: str, fields: dict) -> dict | None:
        try:
            return self.incidents.find_one_and_update(
                {"incident_id": incident_id}, {"$set": {**fields, "updated_at": utc_now()}},
                projection={"_id": 0}, return_document=ReturnDocument.AFTER)
        except PyMongoError as exc:
            raise DatabaseUnavailable(f"MongoDB unavailable: {exc.__class__.__name__}") from None

    def push_incident(self, incident_id: str, field: str, value: Any) -> None:
        try:
            self.incidents.update_one({"incident_id": incident_id},
                                      {"$push": {field: value}, "$set": {"updated_at": utc_now()}})
        except PyMongoError as exc:
            raise DatabaseUnavailable(f"MongoDB unavailable: {exc.__class__.__name__}") from None

    # ---- audit ------------------------------------------------------------
    def record_event(self, incident_id: str, event_type: str, message: str, status: str = "success",
                     component: str | None = None, details: dict | None = None,
                     dedupe: str | None = None) -> dict:
        """Insert an audit event. ``dedupe`` (e.g. run id) makes retries idempotent."""
        if event_type not in AUDIT_EVENT_TYPES:
            raise ValueError(f"Unknown audit event type {event_type}")
        self.ensure_indexes()
        basis = f"{incident_id}|{event_type}|{component}|{dedupe or uuid.uuid4().hex}"
        dedupe_key = hashlib.sha256(basis.encode()).hexdigest()
        event = {
            "event_id": f"AUD-{uuid.uuid4().hex[:10].upper()}",
            "incident_id": incident_id,
            "event_type": event_type,
            "component": component,
            "message": message,
            "status": status,
            "timestamp": utc_now(),
            "details": _scrub(details or {}),
        }
        try:
            seq = self.audit.count_documents({"incident_id": incident_id})
            self.audit.update_one({"dedupe_key": dedupe_key},
                                  {"$setOnInsert": {**event, "dedupe_key": dedupe_key, "seq": seq}},
                                  upsert=True)
            stored = self.audit.find_one({"dedupe_key": dedupe_key}, {"_id": 0, "dedupe_key": 0, "seq": 0})
        except PyMongoError as exc:
            raise DatabaseUnavailable(f"MongoDB unavailable: {exc.__class__.__name__}") from None
        return stored

    def get_events(self, incident_id: str) -> list[dict]:
        try:
            return list(self.audit.find({"incident_id": incident_id}, {"_id": 0, "dedupe_key": 0, "seq": 0})
                        .sort([("timestamp", ASCENDING), ("seq", ASCENDING)]))
        except PyMongoError as exc:
            raise DatabaseUnavailable(f"MongoDB unavailable: {exc.__class__.__name__}") from None
