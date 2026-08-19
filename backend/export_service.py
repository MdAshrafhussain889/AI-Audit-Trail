import csv
import io
import json
from datetime import datetime
from typing import Optional, List
from sqlalchemy.orm import Session
from models import AuditLogEntry


def filter_entries(
    db: Session,
    source_type: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> List[AuditLogEntry]:
    query = db.query(AuditLogEntry).order_by(AuditLogEntry.id.desc())

    if source_type:
        query = query.filter(AuditLogEntry.source_type == source_type)

    if from_date:
        query = query.filter(AuditLogEntry.timestamp_utc >= from_date)

    if to_date:
        query = query.filter(AuditLogEntry.timestamp_utc <= to_date)

    return query.all()


def export_as_json(entries: List[AuditLogEntry]) -> str:
    data = [
        {
            "id": e.id,
            "response_id": e.response_id,
            "timestamp_utc": e.timestamp_utc,
            "source_type": e.source_type,
            "user_id": e.user_id,
            "user_display_name": e.user_display_name,
            "ai_system": e.ai_system,
            "model_version": e.model_version,
            "input_text": e.input_text,
            "input_source": e.input_source,
            "policy_invoked": e.policy_invoked,
            "reasoning_summary": e.reasoning_summary,
            "output_text": e.output_text,
            "downstream_action": e.downstream_action,
            "parent_response_id": e.parent_response_id,
            "cost_per_response": e.cost_per_response,
            "prev_hash": e.prev_hash,
            "entry_hash": e.entry_hash,
        }
        for e in entries
    ]
    return json.dumps(data, indent=2)


def export_as_csv(entries: List[AuditLogEntry]) -> str:
    output = io.StringIO()
    fieldnames = [
        "id",
        "response_id",
        "timestamp_utc",
        "source_type",
        "user_id",
        "user_display_name",
        "ai_system",
        "model_version",
        "input_text",
        "input_source",
        "policy_invoked",
        "reasoning_summary",
        "output_text",
        "downstream_action",
        "parent_response_id",
        "cost_per_response",
        "prev_hash",
        "entry_hash",
    ]

    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()

    for e in entries:
        writer.writerow(
            {
                "id": e.id,
                "response_id": e.response_id,
                "timestamp_utc": e.timestamp_utc,
                "source_type": e.source_type,
                "user_id": e.user_id,
                "user_display_name": e.user_display_name,
                "ai_system": e.ai_system,
                "model_version": e.model_version,
                "input_text": e.input_text,
                "input_source": e.input_source,
                "policy_invoked": e.policy_invoked,
                "reasoning_summary": e.reasoning_summary,
                "output_text": e.output_text,
                "downstream_action": e.downstream_action,
                "parent_response_id": e.parent_response_id,
                "cost_per_response": e.cost_per_response,
                "prev_hash": e.prev_hash,
                "entry_hash": e.entry_hash,
            }
        )

    return output.getvalue()
