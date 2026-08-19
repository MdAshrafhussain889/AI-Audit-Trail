import uuid
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from models import AuditLogEntry, SessionLocal
from hashing import compute_hash


def create_audit_log_entry(
    source_type: str,
    user_id: str,
    user_display_name: str,
    ai_system: str,
    model_version: str,
    input_text: str,
    input_source: str,
    policy_invoked: str,
    reasoning_summary: str,
    output_text: str,
    downstream_action: str,
    parent_response_id: str = None,
    prompt_tokens: int = None,
    completion_tokens: int = None,
    cost_per_response: float = None,
    db: Session = None,
) -> AuditLogEntry:
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False

    try:
        response_id = str(uuid.uuid4())
        timestamp_utc = datetime.now(timezone.utc).isoformat()

        last_entry = db.query(AuditLogEntry).order_by(AuditLogEntry.id.desc()).first()
        prev_hash = "GENESIS" if last_entry is None else last_entry.entry_hash

        entry_fields = {
            "response_id": response_id,
            "timestamp_utc": timestamp_utc,
            "source_type": source_type,
            "user_id": user_id,
            "user_display_name": user_display_name,
            "ai_system": ai_system,
            "model_version": model_version,
            "input_text": input_text,
            "input_source": input_source,
            "policy_invoked": policy_invoked,
            "reasoning_summary": reasoning_summary,
            "output_text": output_text,
            "downstream_action": downstream_action,
            "parent_response_id": parent_response_id,
            "cost_per_response": cost_per_response,
        }

        entry_hash = compute_hash(entry_fields, prev_hash)

        entry = AuditLogEntry(
            response_id=response_id,
            timestamp_utc=timestamp_utc,
            source_type=source_type,
            user_id=user_id,
            user_display_name=user_display_name,
            ai_system=ai_system,
            model_version=model_version,
            input_text=input_text,
            input_source=input_source,
            policy_invoked=policy_invoked,
            reasoning_summary=reasoning_summary,
            output_text=output_text,
            downstream_action=downstream_action,
            parent_response_id=parent_response_id,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_per_response=cost_per_response,
            prev_hash=prev_hash,
            entry_hash=entry_hash,
        )

        db.add(entry)
        db.commit()
        db.refresh(entry)
        return entry

    finally:
        if close_db:
            db.close()


def verify_chain(db: Session = None) -> dict:
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False

    try:
        entries = db.query(AuditLogEntry).order_by(AuditLogEntry.id.asc()).all()

        if not entries:
            return {"valid": True}

        prev_hash = "GENESIS"

        for entry in entries:
            if entry.prev_hash != prev_hash:
                return {
                    "valid": False,
                    "broken_at_response_id": entry.response_id,
                }

            entry_fields = {
                "response_id": entry.response_id,
                "timestamp_utc": entry.timestamp_utc,
                "source_type": entry.source_type,
                "user_id": entry.user_id,
                "user_display_name": entry.user_display_name,
                "ai_system": entry.ai_system,
                "model_version": entry.model_version,
                "input_text": entry.input_text,
                "input_source": entry.input_source,
                "policy_invoked": entry.policy_invoked,
                "reasoning_summary": entry.reasoning_summary,
                "output_text": entry.output_text,
                "downstream_action": entry.downstream_action,
                "parent_response_id": entry.parent_response_id,
                "cost_per_response": entry.cost_per_response,
            }

            computed_hash = compute_hash(entry_fields, prev_hash)

            if computed_hash != entry.entry_hash:
                return {
                    "valid": False,
                    "broken_at_response_id": entry.response_id,
                }

            prev_hash = entry.entry_hash

        return {"valid": True}

    finally:
        if close_db:
            db.close()
