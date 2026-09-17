import re
import json
import uuid
from datetime import datetime, timezone
from typing import Optional
from collections import defaultdict

from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
import io
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session
from sqlalchemy import func

from models import init_db, get_db, AuditLogEntry, AgentAuditEvent, Conversation, ConversationMessage
from audit_service import create_audit_log_entry, verify_chain
from chat_service import process_chat_message, process_chat_message_streaming
from export_service import filter_entries, export_as_json, export_as_csv
from review_service import create_review, get_reviews_for_entry
from auth import (
    register_user,
    login_user,
    get_current_user,
    require_audit_access,
    resolve_user_from_authorization,
    RegisterRequest,
    LoginRequest,
    UserResponse,
)
from pricing import MODEL_PRICING

load_dotenv(override=True)

app = FastAPI(title="AI Audit Trail POC")

import os

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))


@app.get("/privacy", response_class=HTMLResponse)
def privacy_policy():
    """Serve the hosted privacy policy required by the Chrome Web Store."""
    path = os.path.join(_BASE_DIR, "privacy_policy.html")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    except FileNotFoundError:
        return HTMLResponse(
            content="<h1>Privacy Policy</h1><p>Policy not yet published.</p>",
            status_code=404,
        )

allowed_origins_env = os.getenv("ALLOWED_ORIGINS")
if allowed_origins_env:
    origins = [origin.strip() for origin in allowed_origins_env.split(",") if origin.strip()]
else:
    origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

try:
    init_db()
except Exception as e:
    print(f"[WARNING] Database initialization failed on startup: {e}")


class CreateAuditLogRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    source_type: str
    user_id: str
    user_display_name: str
    ai_system: str
    model_version: str
    input_text: str
    input_source: str
    policy_invoked: str
    reasoning_summary: str
    output_text: str
    downstream_action: str
    parent_response_id: Optional[str] = None


class AuditLogResponse(BaseModel):
    id: int
    response_id: str
    timestamp_utc: str
    source_type: str
    user_id: str
    user_display_name: str
    ai_system: str
    model_version: str
    input_text: str
    input_source: str
    policy_invoked: str
    reasoning_summary: str
    output_text: str
    downstream_action: str
    parent_response_id: Optional[str]
    session_id: Optional[str] = None
    session_type: Optional[str] = None
    duration_ms: Optional[int] = None
    exit_code: Optional[int] = None
    hostname: Optional[str] = None
    cost_per_response: Optional[float] = None
    prev_hash: str
    entry_hash: str

    class Config:
        from_attributes = True
        protected_namespaces = ()


class ChatRequest(BaseModel):
    message: str
    policy_id: str = "general_assistant_v1"
    conversation_id: Optional[str] = None


class ChatResponse(BaseModel):
    reply: str
    response_id: str
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    cost: Optional[float] = None


class ConversationCreate(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    title: Optional[str] = None


class ConversationResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    id: str
    title: Optional[str]
    created_at: Optional[str]
    updated_at: Optional[str]
    message_count: int = 0


class SaveMessageRequest(BaseModel):
    role: str
    content: str
    response_id: Optional[str] = None


class ConversationMessageResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    id: int
    role: str
    content: str
    response_id: Optional[str]
    created_at: Optional[str]


class ReviewRequest(BaseModel):
    status: str  # "approved" or "flagged"
    comment: str


class DbQueryResponse(BaseModel):
    entries: list[AuditLogResponse]
    total: int
    page: int
    per_page: int
    total_pages: int


class DetectorEventRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    domain: str
    matched_ai_system: str
    timestamp_client: str
    tab_title: Optional[str] = None
    user_id: Optional[str] = None
    user_display_name: Optional[str] = None
    user_note: Optional[str] = None
    model_version: Optional[str] = None
    input_text: Optional[str] = None
    output_text: Optional[str] = None


class CliEventRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    source_type: str = "claude_code_cli"
    user_id: Optional[str] = None
    user_display_name: Optional[str] = None
    question: str
    answer: str = ""
    session_id: Optional[str] = None
    session_type: str = "command"  # "command" | "interactive"
    duration_ms: Optional[int] = None
    hostname: Optional[str] = None


class AgentAuditEventItem(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    agent_name: str
    event_type: str
    task_name: Optional[str] = None
    input_text: str
    output_text: str
    timestamp_utc: str
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    cost: Optional[float] = None


class AgentAuditBatchRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    run_id: str
    source_app: str = "travel_planner_agent"
    events: list[AgentAuditEventItem]


class AgentAuditEventResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    id: int
    run_id: str
    agent_name: str
    event_type: str
    task_name: Optional[str]
    input_text: str
    output_text: str
    timestamp_utc: str
    source_app: str
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    cost: Optional[float] = None


@app.get("/health")
def health():
    return {
        "status": "ok",
        "time_utc": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/auth/register", response_model=dict)
def register(request: RegisterRequest, db: Session = Depends(get_db)):
    result = register_user(request, db)
    return {"token": result.token, "user": result.user}


@app.post("/api/auth/login")
def login(request: LoginRequest, db: Session = Depends(get_db)):
    result = login_user(request, db)
    return {"token": result.token, "user": result.user}


@app.post("/api/chat", response_model=ChatResponse)
def chat(
    request: ChatRequest,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(get_current_user),
):
    try:
        result = process_chat_message(
            message=request.message,
            policy_id=request.policy_id,
            current_user=current_user,
            db=db,
            conversation_id=request.conversation_id,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to process chat message: {str(e)}")


@app.post("/api/chat/stream")
def chat_stream(
    request: ChatRequest,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(get_current_user),
):
    def event_generator():
        for token in process_chat_message_streaming(
            message=request.message,
            policy_id=request.policy_id,
            current_user=current_user,
            db=db,
            conversation_id=request.conversation_id,
        ):
            if token.startswith("data: "):
                yield token
            else:
                yield f"data: {json.dumps({'token': token})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/conversations", response_model=ConversationResponse)
def create_conversation(
    request: ConversationCreate,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(get_current_user),
):
    conv = Conversation(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        title=request.title or "New Chat",
    )
    db.add(conv)
    db.commit()
    return ConversationResponse(
        id=conv.id,
        title=conv.title,
        created_at=conv.created_at.isoformat() if conv.created_at else None,
        updated_at=conv.updated_at.isoformat() if conv.updated_at else None,
        message_count=0,
    )


@app.get("/api/conversations", response_model=list[ConversationResponse])
def list_conversations(
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(get_current_user),
):
    convs = (
        db.query(Conversation)
        .filter(Conversation.user_id == current_user.id)
        .order_by(Conversation.updated_at.desc())
        .all()
    )
    result = []
    for c in convs:
        msg_count = db.query(ConversationMessage).filter(ConversationMessage.conversation_id == c.id).count()
        result.append(ConversationResponse(
            id=c.id,
            title=c.title,
            created_at=c.created_at.isoformat() if c.created_at else None,
            updated_at=c.updated_at.isoformat() if c.updated_at else None,
            message_count=msg_count,
        ))
    return result


@app.get("/api/conversations/{conversation_id}", response_model=list[ConversationMessageResponse])
def get_conversation_messages(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(get_current_user),
):
    conv = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id,
    ).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = (
        db.query(ConversationMessage)
        .filter(ConversationMessage.conversation_id == conversation_id)
        .order_by(ConversationMessage.id.asc())
        .all()
    )
    return [
        ConversationMessageResponse(
            id=m.id,
            role=m.role,
            content=m.content,
            response_id=m.response_id,
            created_at=m.created_at.isoformat() if m.created_at else None,
        )
        for m in messages
    ]


@app.put("/api/conversations/{conversation_id}")
def update_conversation(
    conversation_id: str,
    request: ConversationCreate,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(get_current_user),
):
    conv = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id,
    ).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if request.title is not None:
        conv.title = request.title
    conv.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}


@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(get_current_user),
):
    conv = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id,
    ).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    db.query(ConversationMessage).filter(ConversationMessage.conversation_id == conversation_id).delete()
    db.delete(conv)
    db.commit()
    return {"ok": True}


@app.post("/api/conversations/{conversation_id}/messages")
def save_message(
    conversation_id: str,
    request: SaveMessageRequest,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(get_current_user),
):
    conv = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id,
    ).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    msg = ConversationMessage(
        conversation_id=conversation_id,
        role=request.role,
        content=request.content,
        response_id=request.response_id,
    )
    db.add(msg)
    conv.updated_at = datetime.now(timezone.utc)
    if conv.title == "New Chat" and request.role == "user":
        conv.title = request.content[:60] + ("..." if len(request.content) > 60 else "")
    db.commit()
    return {"ok": True, "id": msg.id}


@app.post("/api/audit-logs", response_model=AuditLogResponse)
def create_audit_log(
    request: CreateAuditLogRequest,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(require_audit_access),
):
    entry = create_audit_log_entry(
        source_type=request.source_type,
        user_id=request.user_id,
        user_display_name=request.user_display_name,
        ai_system=request.ai_system,
        model_version=request.model_version,
        input_text=request.input_text,
        input_source=request.input_source,
        policy_invoked=request.policy_invoked,
        reasoning_summary=request.reasoning_summary,
        output_text=request.output_text,
        downstream_action=request.downstream_action,
        parent_response_id=request.parent_response_id,
        db=db,
    )
    return entry


@app.get("/api/audit-logs", response_model=list[AuditLogResponse])
def list_audit_logs(
    limit: int = 10,
    offset: int = 0,
    source_type: Optional[str] = None,
    exclude_source_types: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(require_audit_access),
):
    query = db.query(AuditLogEntry)
    if source_type:
        query = query.filter(AuditLogEntry.source_type == source_type)
    if exclude_source_types:
        excluded = [t.strip() for t in exclude_source_types.split(",") if t.strip()]
        if excluded:
            query = query.filter(~AuditLogEntry.source_type.in_(excluded))
    if search:
        like = f"%{search}%"
        query = query.filter(
            AuditLogEntry.input_text.ilike(like)
            | AuditLogEntry.output_text.ilike(like)
            | AuditLogEntry.user_display_name.ilike(like)
            | AuditLogEntry.hostname.ilike(like)
            | AuditLogEntry.session_id.ilike(like)
        )
    entries = (
        query.order_by(AuditLogEntry.id.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    return entries


@app.get("/api/audit-logs/verify")
def verify_audit_chain(
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(require_audit_access),
):
    result = verify_chain(db=db)
    return result


@app.get("/api/db/audit-log-entries", response_model=DbQueryResponse)
def db_view_audit_logs(
    page: int = 1,
    per_page: int = 50,
    sort_by: str = "id",
    sort_dir: str = "desc",
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(require_audit_access),
):
    allowed_sort_cols = {
        "id", "response_id", "timestamp_utc", "source_type",
        "user_display_name", "ai_system", "model_version",
        "policy_invoked", "downstream_action", "cost_per_response",
    }
    if sort_by not in allowed_sort_cols:
        sort_by = "id"
    sort_col = getattr(AuditLogEntry, sort_by)
    order = sort_col.desc() if sort_dir == "desc" else sort_col.asc()

    query = db.query(AuditLogEntry)
    if search:
        like = f"%{search}%"
        query = query.filter(
            AuditLogEntry.user_display_name.ilike(like)
            | AuditLogEntry.ai_system.ilike(like)
            | AuditLogEntry.source_type.ilike(like)
            | AuditLogEntry.response_id.ilike(like)
            | AuditLogEntry.policy_invoked.ilike(like)
        )
    total = query.count()
    entries = query.order_by(order).offset((page - 1) * per_page).limit(per_page).all()
    return DbQueryResponse(
        entries=entries,
        total=total,
        page=page,
        per_page=per_page,
        total_pages=max(1, (total + per_page - 1) // per_page),
    )


@app.get("/api/audit-logs/cost")
def get_audit_cost(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(require_audit_access),
):
    query = db.query(AuditLogEntry).filter(
        AuditLogEntry.prompt_tokens.isnot(None),
        AuditLogEntry.completion_tokens.isnot(None),
        AuditLogEntry.source_type != "review_event",
    )
    if from_date:
        query = query.filter(AuditLogEntry.timestamp_utc >= from_date)
    if to_date:
        query = query.filter(AuditLogEntry.timestamp_utc <= to_date)

    entries = query.all()

    model_totals: dict[str, dict] = {}
    total_cost = 0.0
    total_prompt = 0
    total_completion = 0

    for e in entries:
        pricing = MODEL_PRICING.get(e.model_version, {"input": 0.50, "output": 1.50})
        cost = (e.prompt_tokens / 1_000_000 * pricing["input"] +
                e.completion_tokens / 1_000_000 * pricing["output"])
        total_cost += cost
        total_prompt += e.prompt_tokens or 0
        total_completion += e.completion_tokens or 0

        if e.model_version not in model_totals:
            model_totals[e.model_version] = {"model": e.model_version, "cost": 0.0, "prompt_tokens": 0, "completion_tokens": 0}
        model_totals[e.model_version]["cost"] += cost
        model_totals[e.model_version]["prompt_tokens"] += e.prompt_tokens or 0
        model_totals[e.model_version]["completion_tokens"] += e.completion_tokens or 0

    return {
        "total_cost": round(total_cost, 4),
        "total_prompt_tokens": total_prompt,
        "total_completion_tokens": total_completion,
        "by_model": [v for v in sorted(model_totals.values(), key=lambda x: x["cost"], reverse=True)],
    }


@app.get("/api/audit-logs/export")
def export_audit_logs(
    format: str = "json",
    source_type: Optional[str] = None,
    exclude_source_types: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(require_audit_access),
):
    if format not in ["json", "csv"]:
        raise HTTPException(status_code=400, detail="Format must be 'json' or 'csv'")

    entries = filter_entries(
        db=db,
        source_type=source_type,
        exclude_source_types=exclude_source_types,
        from_date=from_date,
        to_date=to_date,
    )

    if format == "json":
        content = export_as_json(entries)
        media_type = "application/json"
        filename = "audit-trail.json"
    else:
        content = export_as_csv(entries)
        media_type = "text/csv"
        filename = "audit-trail.csv"

    output = io.BytesIO(content.encode())
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.get("/api/audit-logs/{response_id}", response_model=AuditLogResponse)
def get_audit_log(
    response_id: str,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(require_audit_access),
):
    entry = db.query(AuditLogEntry).filter(AuditLogEntry.response_id == response_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


@app.get("/api/audit-logs/{response_id}/reviews", response_model=list[AuditLogResponse])
def get_entry_reviews(
    response_id: str,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(require_audit_access),
):
    return get_reviews_for_entry(response_id, db)


@app.post("/api/audit-logs/{response_id}/review", response_model=AuditLogResponse)
def submit_review(
    response_id: str,
    request: ReviewRequest,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(require_audit_access),
):
    if request.status not in ["approved", "flagged"]:
        raise HTTPException(status_code=400, detail="Status must be 'approved' or 'flagged'")

    try:
        review_entry = create_review(
            response_id=response_id,
            status=request.status,
            comment=request.comment,
            reviewer=current_user,
            db=db,
        )
        return review_entry
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_MD_ESCAPE_RE = re.compile(r"\\([`*_~\[\]()#+\-.!>])")
_MD_LIST_RE = re.compile(r"^\s*(?:[-*+]|\d+\.)\s+", re.M)
_MD_SEP_LINE_RE = re.compile(r"^\s*:?-{2,}(?:\s*\|?\s*:?-{2,})*\s*$", re.M)
_MD_LEAD_SPACE_RE = re.compile(r"(?m)^\s+")


def clean_capture_text(text, max_words=100):
    """Strip markdown into plain readable text, then keep only the first `max_words` words."""
    if not text:
        return ""
    t = text
    t = _MD_LINK_RE.sub(r"\1", t)
    t = _MD_ESCAPE_RE.sub(r"\1", t)
    t = re.sub(r"```.*?```", " ", t, flags=re.S)
    t = _MD_LIST_RE.sub("", t)
    t = t.replace("**", "").replace("__", "")
    t = t.replace("_", "")
    t = t.replace("`", "")
    t = t.replace("#", "")
    t = re.sub(r"^\s*>\s?", "", t, flags=re.M)
    t = t.replace("|", " ")
    t = _MD_SEP_LINE_RE.sub("", t)
    t = _MD_LEAD_SPACE_RE.sub("", t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    t = t.strip()
    words = t.split()
    if len(words) > max_words:
        return " ".join(words[:max_words]) + " …"
    return t


@app.post("/api/detector/event", response_model=AuditLogResponse)
def log_detector_event(
    request: DetectorEventRequest,
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
):
    user = resolve_user_from_authorization(authorization, db)
    if user:
        user_id = user.id
        user_display_name = user.display_name
    elif request.user_id and request.user_display_name:
        user_id = request.user_id
        user_display_name = request.user_display_name
    else:
        user_id = "unknown"
        user_display_name = "Unidentified (extension not signed in)"

    tab_title = (request.tab_title or "").strip() or "(untitled tab)"
    user_note = (request.user_note or "").strip()
    note_prefix = f"User note: {user_note} — " if user_note else ""
    model_version = (request.model_version or "").strip() or "External SaaS — model version not visible to org"

    captured_input = clean_capture_text(request.input_text or "")
    captured_output = clean_capture_text(request.output_text or "")
    if captured_input and captured_output:
        input_text = f"{note_prefix}Prompt on {request.matched_ai_system}: \"{captured_input}\""
        reasoning_summary = (
            f"Page content capture on {request.matched_ai_system} ({request.domain}). "
            "Prompt and response recorded via browser extension. "
            "Model version may not be visible to the org."
        )
        output_text = captured_output
        downstream_action = f"Shadow AI interaction logged — {tab_title}"
    else:
        input_text = (
            f"{note_prefix}Opened {request.matched_ai_system} at {request.domain} — "
            f"Tab: \"{tab_title}\""
        )
        reasoning_summary = (
            f"Browser visit detected to {request.matched_ai_system} ({request.domain}). "
            f"Tab: \"{tab_title}\". "
            "Enterprise governance scan — only site presence is recorded; "
            "prompts, responses, and page content are never captured."
        )
        output_text = (
            "External site presence monitored; prompts and responses "
            "remain private and out of capture scope per security policy."
        )
        downstream_action = f"Shadow AI visit logged — {tab_title}"

    entry = create_audit_log_entry(
        source_type="shadow_detector",
        user_id=user_id,
        user_display_name=user_display_name,
        ai_system=request.matched_ai_system,
        model_version=model_version,
        input_text=input_text,
        input_source="browser_extension",
        policy_invoked="Shadow AI Usage Policy v0.1",
        reasoning_summary=reasoning_summary,
        output_text=output_text,
        downstream_action=f"Shadow AI visit logged — {tab_title}",
        db=db,
    )

    return entry


@app.post("/api/cli/events", response_model=AuditLogResponse)
def log_cli_event(
    request: CliEventRequest,
    db: Session = Depends(get_db),
):
    """Log a terminal Claude Code interaction (one-shot or interactive session).

    Identity comes from the payload (the wrapper resolves it from ~/.claude.json).
    Entries ride the same immutable hash chain as every other audit record.
    """
    user_id = (request.user_id or "").strip() or "unknown"
    user_display_name = (
        (request.user_display_name or "").strip()
        or (request.user_id or "").strip()
        or "Unidentified CLI session"
    )
    question = (request.question or "").strip() or "(no question captured)"
    answer = (request.answer or "").strip()
    session_type = request.session_type or "command"
    hostname = (request.hostname or "").strip() or "unknown-host"

    entry = create_audit_log_entry(
        source_type=request.source_type or "claude_code_cli",
        user_id=user_id,
        user_display_name=user_display_name,
        ai_system=f"Claude Code ({session_type})",
        model_version="claude (from wrapper)",
        input_text=question,
        input_source="terminal_cli",
        policy_invoked="claude_code_usage_policy_v1",
        reasoning_summary=(answer[:2000] if answer else "(no capture)"),
        output_text=answer,
        downstream_action=f"Claude Code session record ({session_type})",
        session_id=request.session_id,
        session_type=session_type,
        duration_ms=request.duration_ms,
        hostname=hostname,
        db=db,
    )
    return entry


@app.post("/api/agent-audit/events")
def ingest_agent_audit_events(
    request: AgentAuditBatchRequest,
    db: Session = Depends(get_db),
):
    """
    Ingest agent audit events (no authentication required for autonomous agents).
    Agents (like Travel Planner) can POST their events here without a user token.
    Reading these events via GET still requires authentication.
    """
    ALLOWED_EVENT_TYPES = {"agent", "tool", "llm"}
    created = []
    errors = []
    for i, event in enumerate(request.events):
        if event.event_type not in ALLOWED_EVENT_TYPES:
            errors.append(f"Event {i}: invalid event_type '{event.event_type}' (must be one of {ALLOWED_EVENT_TYPES})")
            continue
        row = AgentAuditEvent(
            run_id=request.run_id,
            agent_name=event.agent_name,
            event_type=event.event_type,
            task_name=event.task_name,
            input_text=event.input_text,
            output_text=event.output_text,
            timestamp_utc=event.timestamp_utc,
            source_app=request.source_app,
            prompt_tokens=event.prompt_tokens,
            completion_tokens=event.completion_tokens,
            cost=event.cost,
        )
        db.add(row)
        created.append(row)
    if created:
        db.commit()
    return {"accepted": len(created), "rejected": len(errors), "errors": errors, "run_id": request.run_id}


@app.get("/api/agent-audit/events", response_model=list[AgentAuditEventResponse])
def list_agent_audit_events(
    limit: int = 200,
    offset: int = 0,
    event_type: Optional[str] = None,
    run_id: Optional[str] = None,
    agent_name: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(require_audit_access),
):
    query = db.query(AgentAuditEvent)
    if event_type:
        query = query.filter(AgentAuditEvent.event_type == event_type)
    if run_id:
        query = query.filter(AgentAuditEvent.run_id == run_id)
    if agent_name:
        query = query.filter(AgentAuditEvent.agent_name == agent_name)
    if search:
        like = f"%{search}%"
        query = query.filter(
            AgentAuditEvent.input_text.ilike(like)
            | AgentAuditEvent.output_text.ilike(like)
            | AgentAuditEvent.agent_name.ilike(like)
            | AgentAuditEvent.task_name.ilike(like)
        )
    entries = (
        query
        .order_by(AgentAuditEvent.id.asc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    return entries
