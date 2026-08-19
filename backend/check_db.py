from models import SessionLocal, AgentAuditEvent

db = SessionLocal()
count = db.query(AgentAuditEvent).count()
print(f'Total events in DB: {count}')

events = db.query(AgentAuditEvent).all()
for e in events:
    print(f'  - run_id: {e.run_id}, agent: {e.agent_name}, type: {e.event_type}')

db.close()
