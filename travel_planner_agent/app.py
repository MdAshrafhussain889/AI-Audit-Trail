import os

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

st.title("Travel Planner")
st.caption("Tell us where you want to go and we will plan everything for you — places to visit, day-by-day schedule, and how much it will cost.")

with st.sidebar:
    st.header("Plan Your Trip")

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
        st.warning("Please fill in both your departure city and destination before continuing.")
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
                st.success("Your trip plan is ready!")
                st.markdown(itinerary)
                if collector.events:
                    st.info(f"Agent audit: {len(collector.events)} events logged (run {collector.run_id[:8]}...)")
            except Exception as e:
                st.error(f"Something went wrong. Please try again. Details: {e}")
else:
    st.info("Fill in your trip details on the left and click **Plan My Trip** to get started.")