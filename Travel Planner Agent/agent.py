"""
Travel Planner Agent using CrewAI.

Multi-agent crew that creates personalized travel itineraries:
  - Destination Researcher : gathers destination info + real-time weather
  - Activity Planner       : creates a concise day-by-day itinerary
  - Budget Analyst         : estimates costs and flags over-budget

Usage (CLI):
    python agent.py --from-city "Mumbai" --destination "Tokyo, Japan" --days 5 --budget 50000
"""

from __future__ import annotations

import argparse
import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Optional

import requests
from crewai import Agent, Crew, Process, Task
from crewai.events.event_bus import crewai_event_bus
from crewai.events.types.agent_events import (
    AgentExecutionCompletedEvent,
    AgentExecutionErrorEvent,
)
from crewai.events.types.llm_events import LLMCallCompletedEvent, LLMCallFailedEvent
from crewai.events.types.tool_usage_events import ToolUsageFinishedEvent
from crewai.tools import tool
from dotenv import load_dotenv

load_dotenv()

# ── Constants ──────────────────────────────────────────────────────────────────
AUDIT_API_URL      = os.getenv("AGENT_AUDIT_API_URL", "http://localhost:8000/api/agent-audit/events")
AGENT_AUDIT_TOKEN  = os.getenv("AGENT_AUDIT_TOKEN", "")
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")
OPENWEATHER_URL    = "https://api.openweathermap.org/data/2.5/weather"
MAX_TEXT_LEN       = 10_000   # max chars stored per event field
AUDIT_FLUSH_TIMEOUT = 30      # seconds

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

# ── Mock weather fallback ──────────────────────────────────────────────────────
_MOCK_WEATHER: dict[str, str] = {
    "tokyo":     "28°C, partly cloudy, humidity 70%, wind 12 km/h",
    "paris":     "22°C, sunny, humidity 45%, wind 8 km/h",
    "new york":  "25°C, clear skies, humidity 55%, wind 15 km/h",
    "london":    "18°C, overcast with light rain, humidity 75%, wind 20 km/h",
    "dubai":     "38°C, hot and dry, humidity 20%, wind 10 km/h",
    "singapore": "31°C, humid with thunderstorms, humidity 85%, wind 5 km/h",
    "bali":      "29°C, tropical with brief showers, humidity 80%, wind 7 km/h",
    "rome":      "30°C, sunny, humidity 40%, wind 9 km/h",
    "sydney":    "19°C, mild and breezy, humidity 60%, wind 18 km/h",
    "bangkok":   "33°C, hot and humid, humidity 75%, wind 6 km/h",
    "bengaluru": "26°C, pleasant, humidity 60%, wind 10 km/h",
    "mumbai":    "30°C, humid, humidity 80%, wind 15 km/h",
    "delhi":     "34°C, hazy, humidity 50%, wind 12 km/h",
    "hyderabad": "27°C, partly cloudy, humidity 55%, wind 11 km/h",
    "chennai":   "32°C, hot and humid, humidity 78%, wind 14 km/h",
    "kolkata":   "31°C, humid, humidity 82%, wind 10 km/h",
    "goa":       "28°C, sunny with sea breeze, humidity 75%, wind 16 km/h",
    "jaipur":    "33°C, clear and dry, humidity 30%, wind 9 km/h",
}


def _mock_weather(city: str) -> str:
    """Return mock weather string for a city, with [Mock] prefix."""
    key = city.lower().strip()
    for name, info in _MOCK_WEATHER.items():
        if name in key or key in name:
            return f"[Mock] {city.title()}: {info}"
    return f"[Mock] {city.title()}: 25°C, partly cloudy, humidity 55%, wind 10 km/h"


# ── Real-Time Weather Tool ─────────────────────────────────────────────────────
@tool("Real-Time Weather Lookup")
def weather_lookup(city: str) -> str:
    """Get current real-time weather for a city: temperature, feels-like, conditions,
    humidity, and wind speed. Call this for BOTH the origin city and the destination."""
    if not OPENWEATHER_API_KEY:
        return _mock_weather(city)

    try:
        resp = requests.get(
            OPENWEATHER_URL,
            params={"q": city, "appid": OPENWEATHER_API_KEY, "units": "metric"},
            timeout=10,
        )
        resp.raise_for_status()
        data       = resp.json()
        name       = data.get("name", city)
        country    = data.get("sys", {}).get("country", "")
        temp       = data["main"]["temp"]
        feels_like = data["main"]["feels_like"]
        humidity   = data["main"]["humidity"]
        wind_kmh   = round(data["wind"]["speed"] * 3.6, 1)   # m/s → km/h
        description = data["weather"][0]["description"].capitalize()
        return (
            f"{name}, {country}: {temp}°C (feels like {feels_like}°C), "
            f"{description}, humidity {humidity}%, wind {wind_kmh} km/h"
        )
    except requests.exceptions.HTTPError as exc:
        code = exc.response.status_code if exc.response is not None else 0
        if code == 404:
            return f"City '{city}' not found. Please check the spelling."
        # 401 (key not yet active), 429 (rate limit), etc. → fall back silently
    except Exception:
        pass   # network error / timeout → fall back silently

    return _mock_weather(city)


# ── Audit Collector ────────────────────────────────────────────────────────────
class AuditCollector:
    """
    Thread-safe buffer that records every agent/tool/llm event during a
    CrewAI run and POSTs them as a single batch to the LegalBot backend.
    """

    def __init__(self) -> None:
        self.run_id = str(uuid.uuid4())
        self._events: list[dict] = []
        self._lock = threading.Lock()

    def record(
        self,
        event_type: str,
        agent_name: str,
        input_text: str,
        output_text: str,
        task_name: Optional[str] = None,
        prompt_tokens: Optional[int] = None,
        completion_tokens: Optional[int] = None,
        cost: Optional[float] = None,
    ) -> None:
        event = {
            "agent_name":       agent_name,
            "event_type":       event_type,
            "task_name":        task_name,
            "input_text":       str(input_text)[:MAX_TEXT_LEN],
            "output_text":      str(output_text)[:MAX_TEXT_LEN],
            "timestamp_utc":    datetime.now(timezone.utc).isoformat(),
            "prompt_tokens":    prompt_tokens,
            "completion_tokens": completion_tokens,
            "cost":             cost,
        }
        with self._lock:
            self._events.append(event)

    @property
    def events(self) -> list[dict]:
        with self._lock:
            return list(self._events)

    def flush(self) -> None:
        """POST all buffered events to the LegalBot backend in one request.
        Retries up to 2 times on transient errors."""
        events = self.events
        if not events:
            return
        last_exc = None
        for attempt in range(3):
            try:
                resp = requests.post(
                    AUDIT_API_URL,
                    json={
                        "run_id":     self.run_id,
                        "source_app": "travel_planner_agent",
                        "events":     events,
                    },
                    headers={"Authorization": f"Bearer {AGENT_AUDIT_TOKEN}"},
                    timeout=AUDIT_FLUSH_TIMEOUT,
                )
                resp.raise_for_status()
                log.info("Agent Audit: sent %d events (run %s…)", len(events), self.run_id[:8])
                return
            except Exception as exc:
                last_exc = exc
                if attempt < 2:
                    import time
                    time.sleep(1 * (attempt + 1))
        log.warning("Agent Audit: failed to send events after 3 attempts — %s", last_exc)

    def __repr__(self) -> str:
        return f"<AuditCollector run_id={self.run_id[:8]}… events={len(self._events)}>"


# ── LLM Audit Event Handler ────────────────────────────────────────────────────
def _make_llm_event_handler(collector: AuditCollector):
    """Return a CrewAI event-bus handler that records every LLM call
    (completed or failed) as an event_type='llm' entry in the AuditCollector.
    Deduplicates consecutive identical (agent, input) pairs from parser retries."""
    _last_key: list[tuple[str, str] | None] = [None]

    def _response_text(response) -> str:
        choices = getattr(response, "choices", None)
        if choices:
            first = choices[0]
            message = getattr(first, "message", None)
            if isinstance(message, dict):
                text = message.get("content")
            else:
                text = getattr(message, "content", None)
            if text:
                return str(text)
        return str(response)

    def on_llm_event(source, event) -> None:
        messages = getattr(event, "messages", None)
        if isinstance(messages, (list, tuple)):
            parts = []
            for msg in messages:
                if isinstance(msg, dict):
                    parts.append(f"[{msg.get('role', 'user')}]: {msg.get('content', '')}")
                else:
                    parts.append(str(msg))
            input_text = "\n".join(parts)
        else:
            input_text = str(messages or "")

        error = getattr(event, "error", None)
        response = getattr(event, "response", None)
        if error:
            output_text = str(error)
        elif response is not None:
            output_text = _response_text(response)
        else:
            output_text = ""

        agent_name = getattr(event, "agent_role", None) or "LLM"
        task_name = getattr(event, "task_name", None)
        dedup_key = (agent_name, input_text)

        if _last_key[0] == dedup_key:
            return
        _last_key[0] = dedup_key

        usage = getattr(event, "usage", None) or {}
        prompt_tokens = usage.get("prompt_tokens")
        completion_tokens = usage.get("completion_tokens")
        cost = None
        if prompt_tokens is not None and completion_tokens is not None:
            try:
                model = getattr(event, "model", None) or "gpt-4o-mini"
                # Hardcoded fallback pricing instead of importing from missing pricing.py
                MODEL_PRICING = {
                    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
                    "gpt-4o": {"input": 5.0, "output": 15.0},
                    "gpt-4": {"input": 30.0, "output": 60.0},
                    "gpt-3.5-turbo": {"input": 0.50, "output": 1.50},
                }
                pricing = MODEL_PRICING.get(model, {"input": 0.50, "output": 1.50})
                cost = round(
                    prompt_tokens / 1_000_000 * pricing["input"]
                    + completion_tokens / 1_000_000 * pricing["output"],
                    6,
                )
            except Exception:
                pass

        collector.record(
            event_type       = "llm",
            agent_name       = agent_name,
            input_text       = input_text,
            output_text      = output_text,
            task_name        = task_name,
            prompt_tokens    = prompt_tokens,
            completion_tokens = completion_tokens,
            cost             = cost,
        )
    return on_llm_event


# ── Agent Execution Event Handler ─────────────────────────────────────────────
def _make_agent_event_handler(collector: AuditCollector):
    """Return a CrewAI event-bus handler that records agent execution
    completed/error as event_type='agent' entries."""
    def on_agent_event(source, event) -> None:
        agent = getattr(event, "agent", None)
        task  = getattr(event, "task", None)
        agent_name = getattr(agent, "role", None) or "Agent"
        task_name  = getattr(task, "description", None) or None

        if hasattr(event, "output"):
            output_text = str(event.output or "")
            event_type  = "agent"
        elif hasattr(event, "error"):
            output_text = str(event.error or "")
            event_type  = "agent"
        else:
            return

        input_text = ""
        if task:
            input_text = getattr(task, "description", "") or ""

        collector.record(
            event_type  = event_type,
            agent_name  = agent_name,
            input_text  = input_text,
            output_text = output_text,
            task_name   = (task_name[:200] if task_name else None),
        )
    return on_agent_event


# ── Tool Usage Event Handler ──────────────────────────────────────────────────
def _make_tool_event_handler(collector: AuditCollector):
    """Return a CrewAI event-bus handler that records tool usage
    as event_type='tool' entries."""
    def on_tool_event(source, event) -> None:
        agent = getattr(event, "agent", None)
        tool_name = getattr(event, "tool_name", None) or getattr(event, "name", None) or "Tool"
        tool_input = getattr(event, "input", None) or ""
        tool_output = getattr(event, "output", None) or getattr(event, "result", None) or ""
        agent_name = getattr(agent, "role", None) or "Agent"

        collector.record(
            event_type  = "tool",
            agent_name  = agent_name,
            input_text  = f"Tool: {tool_name}\nInput: {tool_input}",
            output_text = str(tool_output)[:MAX_TEXT_LEN],
            task_name   = f"Tool Call: {tool_name}",
        )
    return on_tool_event


# ── Main Crew Builder ──────────────────────────────────────────────────────────
def build_travel_crew(
    destination: str,
    days: int,
    budget: float,
    interests: str,
    from_city: str = "your city",
    audit_collector: Optional[AuditCollector] = None,
) -> str:
    """
    Build and run the 3-agent travel planning crew.
    Returns a combined markdown report (Research + Itinerary + Budget).
    """
    model_name = os.getenv("MODEL_NAME", "gpt-4o-mini")
    llm        = model_name

    # ── Pre-fetch weather (always exactly 2 calls, one per city) ─────────────
    origin_weather = weather_lookup.func(from_city)
    dest_weather   = weather_lookup.func(destination)

    if audit_collector:
        audit_collector.record(
            event_type  = "tool",
            agent_name  = "Research Agent",
            input_text  = f"Tool: Real-Time Weather Lookup\nInput: {{\"city\": \"{from_city}\"}}",
            output_text = origin_weather,
            task_name   = "Weather Fetch — Origin City",
        )
        audit_collector.record(
            event_type  = "tool",
            agent_name  = "Research Agent",
            input_text  = f"Tool: Real-Time Weather Lookup\nInput: {{\"city\": \"{destination}\"}}",
            output_text = dest_weather,
            task_name   = "Weather Fetch — Destination",
        )

    # ── Agents ────────────────────────────────────────────────────────────────
    researcher = Agent(
        role      = "Research Agent",
        goal      = f"Research {destination} and provide concise travel insights",
        backstory = "Expert travel journalist who has visited 100+ countries. Known for clear, actionable tips.",
        llm       = llm,
        verbose   = False,
    )

    planner = Agent(
        role      = "Planner Agent",
        goal      = f"Create a short, clear {days}-day itinerary for {destination}",
        backstory = "Experienced travel consultant. Writes crisp, easy-to-follow day plans.",
        llm       = llm,
        verbose   = False,
    )

    budget_analyst = Agent(
        role      = "Budget Agent",
        goal      = f"Give a simple cost breakdown for the trip within {budget}",
        backstory = "Financial travel advisor. Always gives clear, honest budget summaries.",
        llm       = llm,
        verbose   = False,
    )

    # ── Tasks ─────────────────────────────────────────────────────────────────
    research_task = Task(
        description = f"""Research {destination} for a {days}-day trip from {from_city}.

Weather has already been fetched for you — do NOT call any weather tool:
- {from_city} weather  : {origin_weather}
- {destination} weather: {dest_weather}

Respond in SHORT bullet points only. No paragraphs. Include:
- Weather summary for both cities (use the data above)
- Top 3 must-see places (one line each)
- Top 3 local foods
- 2 transport tips
- 1 cultural tip

Traveller interests: {interests}""",
        agent           = researcher,
        expected_output = "Bullet-point summary under 20 lines: weather both cities, top 3 places, top 3 foods, 2 transport tips, 1 cultural tip.",
    )

    planning_task = Task(
        description = f"""Create a {days}-day itinerary for {destination}.
Budget: ₹{budget}. Interests: {interests}.

Rules:
- Each day: exactly 3 bullet points (Morning / Afternoon / Evening)
- One short line per bullet. No long descriptions.
- Mention one meal per day.""",
        agent           = planner,
        expected_output = f"Exactly {days} days. Each day = 3 bullet points (Morning, Afternoon, Evening). Under {days * 4} lines.",
        context         = [research_task],
    )

    budget_task = Task(
        description = f"""Simple budget breakdown for {days}-day {destination} trip from {from_city}.
Total budget: ₹{budget}.

Format as a short markdown table with 5 rows:
Flights | Accommodation | Food | Transport | Activities

Then:
- One money-saving tip per row (inline, keep short)
- Total row at the bottom
- One sentence: is the budget enough or not?""",
        agent           = budget_analyst,
        expected_output = "Markdown table (5 rows + total) + 1 sentence verdict. Under 20 lines.",
        context         = [research_task, planning_task],
    )

    # ── Run ───────────────────────────────────────────────────────────────────
    crew = Crew(
        agents  = [researcher, planner, budget_analyst],
        tasks   = [research_task, planning_task, budget_task],
        process = Process.sequential,
        verbose = False,
    )

    event_handlers: list[tuple[type, object]] = []
    if audit_collector:
        llm_handler = _make_llm_event_handler(audit_collector)
        agent_handler = _make_agent_event_handler(audit_collector)
        tool_handler = _make_tool_event_handler(audit_collector)
        event_handlers = [
            (LLMCallCompletedEvent, llm_handler),
            (LLMCallFailedEvent, llm_handler),
            (AgentExecutionCompletedEvent, agent_handler),
            (AgentExecutionErrorEvent, agent_handler),
            (ToolUsageFinishedEvent, tool_handler),
        ]
        for event_type, handler in event_handlers:
            crewai_event_bus.register_handler(event_type, handler)

    try:
        crew.kickoff()
    finally:
        if audit_collector:
            for event_type, handler in event_handlers:
                crewai_event_bus.off(event_type, handler)
            crewai_event_bus.flush()
            audit_collector.flush()

    # ── Combine all three outputs ─────────────────────────────────────────────
    sections = []
    if research_task.output:
        sections.append(f"## Destination Research & Weather\n\n{research_task.output.raw}")
    if planning_task.output:
        sections.append(f"## Day-by-Day Itinerary\n\n{planning_task.output.raw}")
    if budget_task.output:
        sections.append(f"## Budget Breakdown\n\n{budget_task.output.raw}")

    return "\n\n---\n\n".join(sections)


# ── CLI Entry Point ────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description="Travel Planner Agent")
    parser.add_argument("--from-city",   default="Mumbai",       help="Departure city")
    parser.add_argument("--destination", default="Tokyo, Japan", help="Travel destination")
    parser.add_argument("--days",        type=int,   default=7,      help="Number of days")
    parser.add_argument("--budget",      type=float, default=50000,  help="Total budget in INR")
    parser.add_argument("--interests",   default="food, culture, history", help="Traveller interests")
    args = parser.parse_args()

    print(f"\nPlanning {args.days}-day trip from {args.from_city} to {args.destination} (Budget: INR {args.budget:,.0f})\n")

    collector = AuditCollector()
    itinerary = build_travel_crew(
        destination     = args.destination,
        days            = args.days,
        budget          = args.budget,
        interests       = args.interests,
        from_city       = args.from_city,
        audit_collector = collector,
    )

    print("=" * 60)
    print("TRAVEL PLAN")
    print("=" * 60)
    print(itinerary)


if __name__ == "__main__":
    main()
