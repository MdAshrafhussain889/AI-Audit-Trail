import os
import tempfile
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import Base, AuditLogEntry
from audit_service import create_audit_log_entry, verify_chain


@pytest.fixture
def test_db():
    db_fd, db_path = tempfile.mkstemp()
    database_url = f"sqlite:///{db_path}"
    engine = create_engine(database_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()

    yield session

    session.close()
    # dispose engine to release file handles on Windows before deleting the temp file
    try:
        engine.dispose()
    except Exception:
        pass
    os.close(db_fd)
    os.unlink(db_path)


def test_audit_log_chain_creation_and_verification(test_db):
    entry1 = create_audit_log_entry(
        source_type="chat_console",
        user_id="user123",
        user_display_name="Alice",
        ai_system="claude",
        model_version="1.0",
        input_text="What is 2+2?",
        input_source="console",
        policy_invoked="general",
        reasoning_summary="Simple math",
        output_text="4",
        downstream_action="log",
        db=test_db,
    )

    entry2 = create_audit_log_entry(
        source_type="shadow_detector",
        user_id="user456",
        user_display_name="Bob",
        ai_system="claude",
        model_version="1.0",
        input_text="What is 3+3?",
        input_source="detector",
        policy_invoked="content_filter",
        reasoning_summary="Math question",
        output_text="6",
        downstream_action="flag",
        db=test_db,
    )

    assert entry1.response_id is not None
    assert entry2.response_id is not None
    assert entry1.entry_hash is not None
    assert entry2.entry_hash is not None
    assert entry1.prev_hash == "GENESIS"
    assert entry2.prev_hash == entry1.entry_hash

    result = verify_chain(db=test_db)
    assert result["valid"] is True


def test_audit_log_chain_corruption_detection(test_db):
    entry1 = create_audit_log_entry(
        source_type="chat_console",
        user_id="user123",
        user_display_name="Alice",
        ai_system="claude",
        model_version="1.0",
        input_text="What is 2+2?",
        input_source="console",
        policy_invoked="general",
        reasoning_summary="Simple math",
        output_text="4",
        downstream_action="log",
        db=test_db,
    )

    entry2 = create_audit_log_entry(
        source_type="shadow_detector",
        user_id="user456",
        user_display_name="Bob",
        ai_system="claude",
        model_version="1.0",
        input_text="What is 3+3?",
        input_source="detector",
        policy_invoked="content_filter",
        reasoning_summary="Math question",
        output_text="6",
        downstream_action="flag",
        db=test_db,
    )

    result = verify_chain(db=test_db)
    assert result["valid"] is True

    corrupted_entry = test_db.query(AuditLogEntry).filter(AuditLogEntry.id == entry1.id).first()
    corrupted_entry.output_text = "wrong answer"
    test_db.commit()

    result = verify_chain(db=test_db)
    assert result["valid"] is False
    assert result["broken_at_response_id"] == entry1.response_id


def test_cost_aggregation(test_db):
    entry1 = create_audit_log_entry(
        source_type="chat_console",
        user_id="user123", user_display_name="Alice",
        ai_system="openai", model_version="gpt-4o-mini",
        input_text="Hello", input_source="console",
        policy_invoked="general", reasoning_summary="Test",
        output_text="Hi there", downstream_action="log",
        prompt_tokens=100, completion_tokens=50,
        db=test_db,
    )
    entry2 = create_audit_log_entry(
        source_type="chat_console",
        user_id="user456", user_display_name="Bob",
        ai_system="openai", model_version="gpt-4o",
        input_text="What is AI?", input_source="console",
        policy_invoked="general", reasoning_summary="Test",
        output_text="AI is...", downstream_action="log",
        prompt_tokens=200, completion_tokens=100,
        db=test_db,
    )

    from pricing import MODEL_PRICING
    entries = test_db.query(AuditLogEntry).filter(
        AuditLogEntry.prompt_tokens.isnot(None)
    ).all()

    assert len(entries) == 2

    pricing_mini = MODEL_PRICING["gpt-4o-mini"]
    cost_mini = (100 / 1_000_000 * pricing_mini["input"] +
                 50 / 1_000_000 * pricing_mini["output"])

    pricing_4o = MODEL_PRICING["gpt-4o"]
    cost_4o = (200 / 1_000_000 * pricing_4o["input"] +
               100 / 1_000_000 * pricing_4o["output"])

    assert cost_mini > 0
    assert cost_4o > cost_mini
