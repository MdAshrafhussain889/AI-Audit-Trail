import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, Column, String, Text, Integer, Float, DateTime, ForeignKey, text
from sqlalchemy import inspect
from datetime import datetime, timezone
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    # Fallback to a local SQLite database for fresh clones / developer machines.
    # This prevents startup failures when DATABASE_URL is not provided.
    DATABASE_URL = "sqlite:///./audit.db"

# If a bare postgresql:// URL is provided, try to ensure a compatible driver string
if DATABASE_URL.startswith("postgresql://") and "+pg8000" not in DATABASE_URL and "+psycopg" not in DATABASE_URL:
    try:
        import psycopg2._psycopg
    except (ImportError, Exception):
        DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+pg8000://", 1)

# Create engine; when using SQLite, provide connect args to avoid threading issues
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    username = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    password_salt = Column(String, nullable=False, default="", server_default="")
    display_name = Column(String, nullable=False)
    role = Column(String, nullable=False, default="analyst")


class AuditLogEntry(Base):
    __tablename__ = "audit_log_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    response_id = Column(String, unique=True, nullable=False)
    timestamp_utc = Column(String, nullable=False)
    source_type = Column(String, nullable=False)
    user_id = Column(String, nullable=False)
    user_display_name = Column(String, nullable=False)
    ai_system = Column(String, nullable=False)
    model_version = Column(String, nullable=False)
    input_text = Column(Text, nullable=False)
    input_source = Column(String, nullable=False)
    policy_invoked = Column(String, nullable=False)
    reasoning_summary = Column(Text, nullable=False)
    output_text = Column(Text, nullable=False)
    downstream_action = Column(String, nullable=False)
    parent_response_id = Column(String, nullable=True)
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    cost_per_response = Column(Float, nullable=True)
    prev_hash = Column(String, nullable=False)
    entry_hash = Column(String, nullable=False)


class AgentAuditEvent(Base):
    __tablename__ = "agent_audit_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(String, nullable=False, index=True)
    agent_name = Column(String, nullable=False)
    event_type = Column(String, nullable=False, index=True)
    task_name = Column(String, nullable=True)
    input_text = Column(Text, nullable=False)
    output_text = Column(Text, nullable=False)
    timestamp_utc = Column(String, nullable=False)
    source_app = Column(String, nullable=False, default="travel_planner_agent")
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    cost = Column(Float, nullable=True)


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class ConversationMessage(Base):
    __tablename__ = "conversation_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(String, ForeignKey("conversations.id"), nullable=False, index=True)
    role = Column(String, nullable=False)  # 'user' or 'assistant'
    content = Column(Text, nullable=False)
    response_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    token = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


def _migrate_old_schema():
    """Rename decision_id columns to response_id if they still exist."""
    inspector = inspect(engine)
    columns = {c["name"] for c in inspector.get_columns("audit_log_entries")}
    with engine.connect() as conn:
        if "decision_id" in columns:
            conn.execute(text("ALTER TABLE audit_log_entries RENAME COLUMN decision_id TO response_id"))
        if "parent_decision_id" in columns:
            conn.execute(text("ALTER TABLE audit_log_entries RENAME COLUMN parent_decision_id TO parent_response_id"))
        if "cost_per_response" not in columns:
            conn.execute(text("ALTER TABLE audit_log_entries ADD COLUMN cost_per_response DOUBLE PRECISION"))
        conn.commit()

    # Agent audit event schema migration
    try:
        agent_cols = {c["name"] for c in inspector.get_columns("agent_audit_events")}
        with engine.connect() as conn:
            if "prompt_tokens" not in agent_cols:
                conn.execute(text("ALTER TABLE agent_audit_events ADD COLUMN prompt_tokens INTEGER"))
            if "completion_tokens" not in agent_cols:
                conn.execute(text("ALTER TABLE agent_audit_events ADD COLUMN completion_tokens INTEGER"))
            if "cost" not in agent_cols:
                conn.execute(text("ALTER TABLE agent_audit_events ADD COLUMN cost DOUBLE PRECISION"))
            conn.commit()
    except Exception:
        pass


def init_db():
    _migrate_old_schema()
    Base.metadata.create_all(bind=engine)

    from auth import seed_demo_users

    db = SessionLocal()
    try:
        seed_demo_users(db)
    finally:
        db.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()