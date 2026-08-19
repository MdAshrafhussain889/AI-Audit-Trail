import json
import os
from typing import Generator
from openai import OpenAI
from sqlalchemy.orm import Session
from audit_service import create_audit_log_entry
from auth import UserResponse
from pricing import calculate_cost


SYSTEM_PROMPT = (
    "You are a helpful AI assistant with audit logging. "
    "Respond naturally with well-formatted markdown when appropriate. "
    "Use code blocks with language tags for code. "
    "Be concise and clear."
)


def call_chat_api(message: str, model_name: str, history: list[dict] | None = None) -> dict:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY not set in environment")

    client = OpenAI(api_key=api_key)

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": message})

    response = client.chat.completions.create(
        model=model_name,
        messages=messages,
    )

    usage = response.usage or type('Usage', (), {'prompt_tokens': 0, 'completion_tokens': 0})()

    return {
        "content": response.choices[0].message.content,
        "model": response.model,
        "prompt_tokens": usage.prompt_tokens,
        "completion_tokens": usage.completion_tokens,
    }


def call_chat_api_streaming(
    message: str,
    model_name: str,
    history: list[dict] | None = None,
    usage_out: dict | None = None,
) -> Generator[str, None, None]:
    """Yield content tokens as they arrive from the OpenAI streaming API."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY not set in environment")

    client = OpenAI(api_key=api_key)

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": message})

    stream = client.chat.completions.create(
        model=model_name,
        messages=messages,
        stream=True,
        stream_options={"include_usage": True},
    )

    for chunk in stream:
        if chunk.usage:
            if usage_out is not None:
                usage_out["prompt_tokens"] = chunk.usage.prompt_tokens or 0
                usage_out["completion_tokens"] = chunk.usage.completion_tokens or 0
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


def process_chat_message(
    message: str,
    policy_id: str,
    current_user: UserResponse,
    db: Session,
    conversation_id: str | None = None,
) -> dict:
    model_name = os.getenv("MODEL_NAME", "gpt-4o-mini")

    history = []
    if conversation_id:
        from models import ConversationMessage
        prev = (
            db.query(ConversationMessage)
            .filter(ConversationMessage.conversation_id == conversation_id)
            .order_by(ConversationMessage.id.asc())
            .all()
        )
        for m in prev:
            history.append({"role": m.role, "content": m.content})

    api_response = call_chat_api(message, model_name, history=history)

    prompt_tokens = api_response.get("prompt_tokens", 0)
    completion_tokens = api_response.get("completion_tokens", 0)
    cost = calculate_cost(model_name, prompt_tokens, completion_tokens)

    entry = create_audit_log_entry(
        source_type="chat_console",
        user_id=current_user.id,
        user_display_name=current_user.display_name,
        ai_system="OpenAI ChatGPT API",
        model_version=model_name,
        input_text=message,
        input_source="chat_console_ui",
        policy_invoked=policy_id,
        reasoning_summary="",
        output_text=api_response["content"],
        downstream_action="Response displayed to user in chat UI",
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cost_per_response=cost,
        db=db,
    )

    return {
        "reply": api_response["content"],
        "response_id": entry.response_id,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "cost": cost,
    }


def process_chat_message_streaming(
    message: str,
    policy_id: str,
    current_user: UserResponse,
    db: Session,
    conversation_id: str | None = None,
) -> Generator[str, None, None]:
    """Stream the AI response token-by-token, then create the audit entry."""
    model_name = os.getenv("MODEL_NAME", "gpt-4o-mini")

    history = []
    if conversation_id:
        from models import ConversationMessage
        prev = (
            db.query(ConversationMessage)
            .filter(ConversationMessage.conversation_id == conversation_id)
            .order_by(ConversationMessage.id.asc())
            .all()
        )
        for m in prev:
            history.append({"role": m.role, "content": m.content})

    full_reply = []
    usage_info = {"prompt_tokens": 0, "completion_tokens": 0}
    for token in call_chat_api_streaming(message, model_name, history=history, usage_out=usage_info):
        full_reply.append(token)
        yield token

    reply_text = "".join(full_reply)

    prompt_tokens = usage_info.get("prompt_tokens", 0)
    completion_tokens = usage_info.get("completion_tokens", 0)
    cost = calculate_cost(model_name, prompt_tokens, completion_tokens)

    entry = create_audit_log_entry(
        source_type="chat_console",
        user_id=current_user.id,
        user_display_name=current_user.display_name,
        ai_system="OpenAI ChatGPT API",
        model_version=model_name,
        input_text=message,
        input_source="chat_console_ui",
        policy_invoked=policy_id,
        reasoning_summary="",
        output_text=reply_text,
        downstream_action="Response displayed to user in chat UI",
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cost_per_response=cost,
        db=db,
    )

    yield f"data: {json.dumps({'response_id': entry.response_id, 'prompt_tokens': prompt_tokens, 'completion_tokens': completion_tokens, 'cost': cost})}\n\n"
