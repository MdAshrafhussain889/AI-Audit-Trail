import html
import os
import re

import streamlit as st

# Streamlit Cloud exposes secrets only via st.secrets, not as environment variables.
# Sync them into os.environ BEFORE importing agent, which reads config at module load
# (and CrewAI/LangChain also read OPENAI_API_KEY from the process environment).
try:
    for _key, _value in st.secrets.items():
        os.environ.setdefault(_key, str(_value))
except Exception:
    pass  # Local development uses backend-style .env loaded inside agent.py

from agent import build_travel_crew, AuditCollector

st.set_page_config(page_title="Travel Planner", page_icon=None, layout="wide")

# ────────────────────────────────────────────────────────────────────────────────
# Design system (visual layer only — no behavioral impact)
# ────────────────────────────────────────────────────────────────────────────────
CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600&display=swap');

:root {
  --bg1: #0A1628;
  --bg2: #0F2137;
  --cyan: #22D3EE;
  --amber: #F59E0B;
  --red: #F87171;
  --green: #34D399;
  --text: #E6EDF7;
  --muted: #94A3B8;
  --glass: rgba(255, 255, 255, 0.045);
  --glass-strong: rgba(255, 255, 255, 0.07);
  --line: rgba(255, 255, 255, 0.10);
}

/* App shell */
.stApp {
  background:
    radial-gradient(1100px 520px at 85% -10%, rgba(34, 211, 238, 0.09), transparent 60%),
    radial-gradient(900px 480px at -10% 110%, rgba(245, 158, 11, 0.06), transparent 60%),
    linear-gradient(180deg, var(--bg1) 0%, var(--bg2) 100%);
  color: var(--text);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}
.block-container { padding-top: 1.6rem; max-width: 1180px; }

/* Hide Streamlit chrome */
#MainMenu { visibility: hidden; }
footer { visibility: hidden; }
header { visibility: hidden; }

/* Typography */
h1, h2, h3, .hero-title { font-family: 'Sora', 'Inter', sans-serif; letter-spacing: -0.01em; }

/* Hero banner */
.hero {
  position: relative;
  overflow: hidden;
  border-radius: 20px;
  border: 1px solid var(--line);
  padding: 30px 36px;
  margin-bottom: 22px;
  background: linear-gradient(120deg, #10243d 0%, #0c3050 40%, #123b46 75%, #143a52 100%);
  background-size: 220% 220%;
  animation: heroShift 16s ease-in-out infinite;
  box-shadow: 0 18px 48px rgba(2, 8, 20, 0.45);
}
.hero-inner { display: flex; align-items: center; gap: 22px; }
.hero-icon {
  width: 62px; height: 62px; flex: 0 0 62px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(34,211,238,0.18), rgba(245,158,11,0.14));
  border: 1px solid var(--line);
  animation: floatY 5s ease-in-out infinite;
}
.hero-icon svg { width: 34px; height: 34px; stroke: var(--cyan); fill: none; stroke-width: 1.8; }
.hero-title {
  margin: 0; font-size: 2rem; font-weight: 800; color: var(--text); line-height: 1.15;
}
.hero-title .grad {
  background: linear-gradient(90deg, var(--cyan), #7DD3FC, var(--amber));
  -webkit-background-clip: text; background-clip: text; color: transparent;
  background-size: 200% auto; animation: gradSlide 6s linear infinite;
}
.hero-sub { margin: 6px 0 0; color: var(--muted); font-size: 0.98rem; max-width: 720px; }
.hero-line {
  height: 3px; border-radius: 3px; margin-top: 18px;
  background: linear-gradient(90deg, var(--cyan), rgba(34,211,238,0.05));
}

@keyframes heroShift { 0% {background-position: 0% 50%;} 50% {background-position: 100% 50%;} 100% {background-position: 0% 50%;} }
@keyframes floatY { 0%,100% { transform: translateY(0);} 50% { transform: translateY(-6px);} }
@keyframes gradSlide { to { background-position: 200% center; } }
@keyframes fadeUp { from { opacity: 0; transform: translateY(14px);} to { opacity: 1; transform: translateY(0);} }
@keyframes pulseGlow { 0%,100% { box-shadow: 0 0 0 0 rgba(34,211,238,0.28);} 50% { box-shadow: 0 0 0 9px rgba(34,211,238,0);} }

/* Buttons */
.stButton > button {
  width: 100%;
  border: none;
  border-radius: 12px;
  padding: 0.72rem 1.05rem;
  font-family: 'Sora', sans-serif;
  font-weight: 700;
  font-size: 0.98rem;
  color: #04121F;
  background: linear-gradient(135deg, #22D3EE 0%, #38BDF8 55%, #60A5FA 100%);
  transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
  animation: pulseGlow 3.2s ease-in-out infinite;
}
.stButton > button:hover {
  transform: translateY(-2px);
  filter: brightness(1.06);
  box-shadow: 0 12px 32px rgba(34, 211, 238, 0.32);
  color: #04121F;
}
.stButton > button:focus:not(:active) { color: #04121F; box-shadow: 0 12px 32px rgba(34,211,238,0.25); }
.stButton > button:active { transform: translateY(0); }

/* Inputs */
.stTextInput input, .stNumberInput input {
  background: var(--glass) !important;
  border: 1px solid var(--line) !important;
  border-radius: 10px !important;
  color: var(--text) !important;
}
.stTextInput input::placeholder { color: rgba(148, 163, 184, 0.65) !important; }
.stTextInput input:focus, .stNumberInput input:focus {
  border-color: rgba(34, 211, 238, 0.65) !important;
  box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.15) !important;
}
.stTextInput label, .stNumberInput label, .stMarkdown small, .stCaption, .sidebar-note {
  color: var(--muted) !important;
}

/* Sidebar */
section[data-testid="stSidebar"] {
  background: linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015));
  border-right: 1px solid var(--line);
}
section[data-testid="stSidebar"] .block-container { padding-top: 1.4rem; }
section[data-testid="stSidebar"] hr { border-color: var(--line); opacity: 0.6; }
.sidebar-heading {
  font-family: 'Sora', sans-serif; font-weight: 700; font-size: 1.02rem;
  color: var(--text); margin-bottom: 2px;
}

/* Metric cards */
.metric-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 14px;
  margin: 18px 0 8px;
}
.metric {
  background: var(--glass);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px 18px;
  animation: fadeUp 0.5s ease both;
}
.metric:nth-child(1) { animation-delay: 0.02s; }
.metric:nth-child(2) { animation-delay: 0.08s; }
.metric:nth-child(3) { animation-delay: 0.14s; }
.metric:nth-child(4) { animation-delay: 0.20s; }
.metric-label {
  display: block; font-size: 0.72rem; letter-spacing: 0.09em;
  text-transform: uppercase; color: var(--muted); margin-bottom: 7px;
  font-weight: 600;
}
.metric-value {
  font-family: 'Sora', sans-serif; font-size: 1.12rem; font-weight: 700;
  color: var(--text); line-height: 1.25; word-break: break-word;
}

/* Section + day cards */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  margin-top: 10px;
}
.card {
  background: var(--glass);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 20px 22px;
  animation: fadeUp 0.55s ease both;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}
.card:hover {
  transform: translateY(-3px);
  border-color: rgba(34, 211, 238, 0.45);
  background: var(--glass-strong);
}
.card:nth-child(1)  { animation-delay: 0.03s; }
.card:nth-child(2)  { animation-delay: 0.07s; }
.card:nth-child(3)  { animation-delay: 0.11s; }
.card:nth-child(4)  { animation-delay: 0.15s; }
.card:nth-child(5)  { animation-delay: 0.19s; }
.card:nth-child(6)  { animation-delay: 0.23s; }
.card:nth-child(7)  { animation-delay: 0.27s; }
.card:nth-child(8)  { animation-delay: 0.31s; }
.card:nth-child(9)  { animation-delay: 0.35s; }
.card:nth-child(n+10) { animation-delay: 0.39s; }
.card-title {
  display: flex; align-items: center; gap: 10px;
  font-family: 'Sora', sans-serif; font-weight: 700; font-size: 1.02rem;
  color: var(--text); margin-bottom: 12px; padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.card-title .tick {
  width: 26px; height: 26px; flex: 0 0 26px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 0.78rem; font-weight: 800; color: #04121F;
  background: linear-gradient(135deg, var(--cyan), #7DD3FC);
  font-family: 'Inter', sans-serif;
}
.card.accent { border-color: rgba(245, 158, 11, 0.4); }
.card.accent .card-title .tick { background: linear-gradient(135deg, var(--amber), #FBBF24); }
.card-body { color: #CBD5E1; font-size: 0.93rem; line-height: 1.55; }
.card-body ul { margin: 0 0 8px; padding-left: 18px; }
.card-body li { margin: 5px 0; }
.card-body p { margin: 7px 0; }
.card-body .sub-h {
  font-weight: 700; color: var(--text); margin: 12px 0 6px; font-size: 0.95rem;
}
.card-body code {
  background: rgba(34, 211, 238, 0.12); color: #A5F3FC;
  border-radius: 6px; padding: 1px 6px; font-size: 0.86em;
}

/* Status pills */
.pill-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
.pill {
  display: inline-flex; align-items: center; gap: 8px;
  border-radius: 999px; padding: 7px 15px;
  background: var(--glass); border: 1px solid var(--line);
  font-size: 0.82rem; font-weight: 600; color: var(--muted);
}
.pill b { color: var(--text); font-weight: 700; }
.pill.cyan { border-color: rgba(34,211,238,0.4); }
.pill.cyan b { color: var(--cyan); }
.pill.amber { border-color: rgba(245,158,11,0.4); }
.pill.amber b { color: var(--amber); }
.pill .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); }

/* Alert panels */
.panel {
  border-radius: 16px; padding: 22px 24px; margin: 14px 0;
  border: 1px solid var(--line); background: var(--glass);
  animation: fadeUp 0.4s ease both;
}
.panel-warn { border-color: rgba(245, 158, 11, 0.45); background: rgba(245, 158, 11, 0.08); }
.panel-error { border-color: rgba(248, 113, 113, 0.45); background: rgba(248, 113, 113, 0.07); }
.panel-ok { border-color: rgba(52, 211, 153, 0.45); background: rgba(52, 211, 153, 0.07); }
.panel-empty {
  border-style: dashed; text-align: center; padding: 56px 28px;
}
.panel-title {
  font-family: 'Sora', sans-serif; font-weight: 700; font-size: 1.06rem;
  margin-bottom: 6px; color: var(--text);
}
.panel-warn .panel-title { color: var(--amber); }
.panel-error .panel-title { color: var(--red); }
.panel-ok .panel-title { color: var(--green); }
.panel p { margin: 0; color: var(--muted); line-height: 1.55; }

/* Spinner polish */
.stSpinner > div { color: var(--muted) !important; }

/* Native markdown inside results keeps theme colors */
.stMarkdown, .stMarkdown p, .stMarkdown li { color: #CBD5E1; }
.stMarkdown h2, .stMarkdown h3, .stMarkdown h4 { color: var(--text); }

/* Scrollbar */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.25); border-radius: 8px; }
::-webkit-scrollbar-track { background: transparent; }

@media (max-width: 640px) {
  .hero { padding: 22px; }
  .hero-title { font-size: 1.5rem; }
  .cards-grid { grid-template-columns: 1fr; }
}
</style>
"""

HERO_SVG = (
    '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">'
    '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2'
    ' c-.44-.1-.8.1-1.1.4l-.3.3c-.5.5-.4 1.3.2 1.7L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 '
    ' 3.5 5.3c.4.6 1.2.7 1.7.2l.3-.3c.4-.3.5-.7.4-1.1z"/></svg>'
)


def _inr(value: float) -> str:
    """Format a number with Indian digit grouping (display only)."""
    s = str(int(round(value)))
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ",".join(parts) + "," + tail


def _md_fragment_to_html(md_body: str) -> str:
    """Minimal markdown-to-HTML for card bodies (bold, italic, code, bullets)."""
    out = []
    in_ul = False
    for raw_line in md_body.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()

        if not in_ul and stripped.startswith(("- ", "* ")):
            out.append("<ul>")
            in_ul = True
        elif in_ul and not stripped.startswith(("- ", "* ")):
            out.append("</ul>")
            in_ul = False

        if not stripped:
            continue

        safe = html.escape(stripped)
        safe = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", safe)
        safe = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", safe)
        safe = re.sub(r"`([^`]+)`", r"<code>\1</code>", safe)

        heading_m = re.match(r"^#{1,6}\s+(.*)$", stripped)
        if heading_m:
            out.append(f"<div class='sub-h'>{heading_m.group(1)}</div>")
        elif stripped.startswith(("- ", "* ")):
            out.append(f"<li>{safe[2:]}</li>")
        else:
            out.append(f"<p>{safe}</p>")

    if in_ul:
        out.append("</ul>")
    return "".join(out)


def _render_itinerary_cards(itinerary_md: str) -> None:
    """Presentation-only: split the existing itinerary markdown into themed cards."""
    heading_re = re.compile(r"^(#{2,3})\s+(.+?)\s*$", re.MULTILINE)
    matches = list(heading_re.finditer(itinerary_md))

    if not matches:
        st.markdown(itinerary_md)
        return

    intro = itinerary_md[: matches[0].start()].strip()
    if intro:
        st.markdown(intro)

    sections = []
    for idx, match in enumerate(matches):
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(itinerary_md)
        sections.append((match.group(2).strip(), itinerary_md[match.end(): end].strip()))

    cards_html = []
    day_no = 0
    fallback_sections = []

    for title, body in sections:
        is_day = re.match(r"^day\s*\d+$", title, re.IGNORECASE) is not None
        lowered = title.lower()
        is_cost = any(k in lowered for k in ("cost", "budget", "expense"))
        card_class = "card"
        tick = ""

        if is_day:
            day_no += 1
            tick = f"<span class='tick'>{day_no}</span>"
        elif is_cost:
            card_class += " accent"
            tick = "<span class='tick'>&#8377;</span>"

        if "|" in body:
            # Markdown tables cannot be safely mini-rendered; keep native output.
            fallback_sections.append((title, body))
            continue

        cards_html.append(
            "<div class='{}'><div class='card-title'>{}<span>{}</span></div>"
            "<div class='card-body'>{}</div></div>".format(
                card_class, tick, html.escape(title), _md_fragment_to_html(body)
            )
        )

    if cards_html:
        st.markdown(
            "<div class='cards-grid'>" + "".join(cards_html) + "</div>",
            unsafe_allow_html=True,
        )
    elif not fallback_sections:
        st.markdown(itinerary_md)
        return

    for title, body in fallback_sections:
        st.markdown(f"#### {title}")
        st.markdown(body)


st.markdown(CSS, unsafe_allow_html=True)

st.markdown(
    """
<div class="hero">
  <div class="hero-inner">
    <div class="hero-icon">{icon}</div>
    <div>
      <h1 class="hero-title">Travel <span class="grad">Planner</span></h1>
      <p class="hero-sub">Tell us where you want to go and we will plan everything for you
      &mdash; places to visit, day-by-day schedule, and how much it will cost.</p>
      <div class="hero-line"></div>
    </div>
  </div>
</div>
""".format(icon=HERO_SVG),
    unsafe_allow_html=True,
)

with st.sidebar:
    st.markdown('<div class="sidebar-heading">Plan Your Trip</div>', unsafe_allow_html=True)

    from_city    = st.text_input("Where are you travelling from?", "Mumbai",
                                  placeholder="e.g. Delhi, Chennai, Pune")
    destination  = st.text_input("Where do you want to go?", "Tokyo, Japan",
                                  placeholder="e.g. Goa, Paris, Dubai")

    st.divider()

    days    = st.number_input("How many days is your trip?", min_value=1, max_value=30, value=7)
    budget  = st.number_input("What is your total budget? (₹)", min_value=1000.0,
                               max_value=10_000_000.0, value=50000.0, step=1000.0)
    interests = st.text_input("What do you enjoy?", "food, sightseeing, history",
                               placeholder="e.g. beaches, shopping, adventure")

    st.divider()

    generate = st.button("Plan My Trip", type="primary", use_container_width=True)

    st.caption("Our AI will research your destination, create a day-by-day plan, and give you a full cost breakdown — all in one click.")

if generate:
    if not from_city.strip() or not destination.strip():
        st.markdown(
            """
<div class="panel panel-warn">
  <div class="panel-title">Missing trip details</div>
  <p>Please fill in both your departure city and destination before continuing.</p>
</div>
""",
            unsafe_allow_html=True,
        )
    else:
        with st.spinner(f"Planning your {int(days)}-day trip from {from_city} to {destination}... This may take a minute."):
            try:
                collector = AuditCollector()
                itinerary = build_travel_crew(
                    destination=destination,
                    days=int(days),
                    budget=float(budget),
                    interests=interests,
                    from_city=from_city,
                    audit_collector=collector,
                )

                st.markdown(
                    """
<div class="panel panel-ok">
  <div class="panel-title">Your trip plan is ready!</div>
  <p>Scroll down for the day-by-day breakdown and cost summary.</p>
</div>
""",
                    unsafe_allow_html=True,
                )

                st.markdown(
                    "<div class='metric-row'>"
                    "<div class='metric'><span class='metric-label'>From</span>"
                    "<span class='metric-value'>{}</span></div>"
                    "<div class='metric'><span class='metric-label'>Destination</span>"
                    "<span class='metric-value'>{}</span></div>"
                    "<div class='metric'><span class='metric-label'>Duration</span>"
                    "<span class='metric-value'>{} days</span></div>"
                    "<div class='metric'><span class='metric-label'>Budget</span>"
                    "<span class='metric-value'>&#8377; {}</span></div>"
                    "</div>".format(
                        html.escape(from_city.strip()),
                        html.escape(destination.strip()),
                        int(days),
                        _inr(float(budget)),
                    ),
                    unsafe_allow_html=True,
                )

                _render_itinerary_cards(itinerary)

                if collector.events:
                    st.markdown(
                        "<div class='pill-row'>"
                        "<span class='pill'><span class='dot'></span>Audit trail active</span>"
                        "<span class='pill cyan'>Events logged&nbsp;<b>{}</b></span>"
                        "<span class='pill amber'>Run ID&nbsp;<b>{}</b></span>"
                        "</div>".format(
                            len(collector.events),
                            html.escape(collector.run_id[:8]),
                        ),
                        unsafe_allow_html=True,
                    )
            except Exception as e:
                st.markdown(
                    """
<div class="panel panel-error">
  <div class="panel-title">Something went wrong</div>
  <p>Please try again in a moment. If the issue persists, expand the technical
  details below and share them with your administrator.</p>
</div>
""",
                    unsafe_allow_html=True,
                )
                with st.expander("Technical details"):
                    st.code(str(e))
else:
    st.markdown(
        """
<div class="panel panel-empty">
  <div class="panel-title">Ready when you are</div>
  <p>Fill in your trip details on the left and click <b>Plan My Trip</b> to get started.</p>
</div>
""",
        unsafe_allow_html=True,
    )
