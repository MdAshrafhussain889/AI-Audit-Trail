# AI Audit Trail — Shadow AI Detection & Immutable Audit System

A proof-of-concept system for logging, monitoring, and auditing AI system usage with cryptographic integrity verification, cost tracking, and human review workflow.

Detects **shadow AI usage** (unauthorized ChatGPT/Copilot/Gemini usage) via a Chrome extension, records every interaction into an append-only, tamper-evident hash chain, tracks estimated cost per response, and exposes an exportable audit trail for compliance review.

---

⚡ **IMPORTANT: First-Time Setup?**

If you just cloned this project and are struggling to get it running, **read [SETUP.md](SETUP.md) first**. It includes:
- ✅ Step-by-step instructions to fix common "works locally but not when cloned" issues
- ✅ How to configure environment variables
- ✅ Why Travel Planner Agent UI might show errors
- ✅ Troubleshooting guide for frontend/backend connection issues

---

##  POC Disclaimer

This is a **proof-of-concept implementation**, not production-ready software:

- Uses mock authentication (no real password storage, demo users)
- OpenAI API key stored in plaintext `.env` (do not use with real secrets)
- In-memory token storage (lost on server restart)
- SQLite database (not suitable for high concurrency or large scale)
- Chrome extension is an unpacked development/debugger build
- Intended for demonstration and evaluation purposes only

---

## Architecture

```
LegalBot/
├── backend/               # FastAPI server (Python)
├── frontend/              # React + TypeScript + Vite web app
├── extension-debugger/    # Chrome Manifest V3 shadow AI detector (debugger build)
├── travel_planner_agent/  # Streamlit App + CrewAI Agent with Audit Integration
└── README.md
```

## Key Features

### 1. Immutable Hash Chain
- Every entry stores a SHA-256 hash of its content plus the previous entry's hash
- `GET /api/audit-logs/verify` walks the entire chain and reports any tampering
- Reviews are logged as new chained entries — originals are never edited

### 2. Append-Only Design
- No UPDATE or DELETE operations on audit entries
- Reviews create new entries that reference parents via `parent_response_id`
- Original chat responses are never modified (chain integrity preserved)

### 3. Shadow AI Detection (Chrome Extension)
- Detects usage of **ChatGPT, Microsoft Copilot, GitHub Copilot, and Gemini** via tab monitoring
- Two capture modes:
  - **Presence-only** (default policy): logs site visits only — prompts, responses, and page content are never captured
  - **Content capture** (debugger build): records the prompt and AI response via the Chrome DevTools Protocol; markdown is stripped to plain text and truncated to the first 100 words before logging
- Reads only tab URL/title for presence mode; no keystroke logging
- Debounced — does not spam duplicate logs for the same page load

### 4. Cost Tracking Dashboard
- Per-model pricing table (`pricing.py`): gpt-4o-mini, gpt-4o, gpt-4, gpt-3.5-turbo
- Estimated cost per response computed from token usage (USD per 1M tokens)
- Dashboard KPIs: total entries, total est. cost, cost trend chart (Recharts)
- `cost_per_response` column in the Database Viewer

### 5. Database Viewer
- Browse raw audit-log entries directly with pagination, search, and sorting
- Sortable columns including estimated cost per response
- CSV export of query results

### 6. Human Review Workflow
- Any user can approve or flag an entry with a comment
- Reviews create new chained entries linked to the originals
- Green checkmark (approved) or red flag badge shown in the UI
- All reviews are queryable and exportable

### 7. Export & Certificates
- Export audit trail as JSON or CSV with filters (source type, date range)
- Printable Audit Certificate for any entry — shows all fields and hashes for legal/counsel review
- Browser print or PDF export (File → Print → Save as PDF)

### 8. AI Agent Audit Integration (CrewAI)
The system includes a fully integrated autonomous "Travel Planner Agent" built with CrewAI and LangChain. 
- **Multi-Agent Crew**: Utilizes a 3-agent crew (Destination Researcher, Activity Planner, Budget Analyst) powered by `gpt-4o-mini`.
- **Immutable Traceability (`AuditCollector`)**: Automatically intercepts every interaction during an agent's run:
  - **Agent Events**: Logs agent goals and task completions via CrewAI `step_callback`.
  - **Tool Events**: Captures tool inputs (e.g., Real-Time Weather Lookup) and outputs.
  - **LLM Events**: Intercepts raw prompts and generated responses natively via a LangChain `BaseCallbackHandler`.
- **Batch Processing**: Groups all traces into a single `run_id` and flushes them to the LegalBot backend upon completion.
- **Agent Audit Dashboard**: A dedicated frontend UI (`AgentAudit.tsx`) that visualizes agent execution traces, KPIs, and color-coded event badges (Agent, Tool, LLM) grouped by run.

---

## Quick Start

### ⚠️ Before You Start

1. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` and add your OpenAI API key:**
   ```ini
   OPENAI_API_KEY=sk-your-actual-openai-api-key-here
   ```

3. **Complete setup guide**: See [SETUP.md](SETUP.md) for detailed instructions

---

### 1. Backend Setup

```bash
cd backend

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start backend server
python -m uvicorn main:app --reload
```

✅ Backend runs at: `http://localhost:8000` (API docs: `/docs`)

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

✅ Frontend runs at: `http://localhost:5173`

### 3. Travel Planner Agent (Optional)

```bash
cd "Travel Planner Agent"

# Install dependencies (reuse backend venv or create new one)
pip install -r requirements.txt

# Start Streamlit app
streamlit run app.py
```

✅ App runs at: `http://localhost:8501`

### 4. Chrome Extension Setup (Optional)

1. Open `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `extension-debugger` folder
5. Extension icon appears in the Chrome toolbar
6. If the backend runs on a non-default port (e.g. 8001), update the host permissions in `extension-debugger/manifest.json`

### 4. Travel Planner Agent (Streamlit)

```bash
cd "Travel Planner Agent"

# (Optional) Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
pip install streamlit

# Create .env from example
cp .env.example .env
# Edit .env to add OPENAI_API_KEY

# Run the Streamlit app
streamlit run app.py
```
App runs at `http://localhost:8501`.

---

## Usage

### Web Application

1. **Sign In / Register:**
   - Click the "Sign In" tab, then the "User" dropdown on the login screen
   - Select a demo user (Alice Chen, Bob Iyer, or Priya Reviewer)
   - Or use the "Register" tab to create a new demo user
   - Token stored in sessionStorage (cleared on browser close)

2. **Chat Console:**
   - Type a message and press Enter or click "Send"
   - AI response is logged to the audit trail with a `response_id`
   - Each response shows its `response_id` for reference

3. **Audit Trail (Dashboard):**
   - Overview KPIs: total entries, total estimated cost, cost trend chart
   - Browse all audit entries newest-first; search by text, filter by source type and date range
   - Click an entry to expand and see all fields
   - View human reviews (approvals/flags) nested under entries; add your own review
   - "Verify Chain Integrity" button checks tamper-evidence
   - Export as JSON or CSV

4. **Database Viewer:**
   - Raw table of audit-log entries with pagination, search, and sorting
   - Includes `cost_per_response` column and CSV export

5. **Audit Certificate:**
   - View a printable certificate for any entry
   - Shows all fields including hashes for legal/counsel review

### Chrome Extension

1. Click the extension icon in the toolbar
2. Sign in with a demo user (same flow as the web app)
3. Shows "Detector: Active" status
4. Automatically logs when you visit:
   - ChatGPT (chatgpt.com, chat.openai.com)
   - Microsoft Copilot (copilot.microsoft.com)
   - GitHub Copilot (github.com/*copilot*)
   - Gemini (gemini.google.com, bard.google.com)
5. In **presence mode**, logs appear with `source_type="shadow_detector"` and a privacy note that prompts/responses were not captured
6. In **content capture mode**, the prompt and response are recorded (markdown stripped, truncated to 100 words)

---

## Field Mapping

All audit log entries contain these 17 fields:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | integer | Internal auto-increment row ID | 1 |
| `response_id` | UUID string | Unique identifier for this entry | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` |
| `timestamp_utc` | ISO 8601 string | Entry creation time in UTC | `2026-07-21T13:25:00.123456+00:00` |
| `source_type` | string enum | Where this entry originated | `"chat_console"`, `"shadow_detector"`, `"review_event"` |
| `user_id` | string | User/session identifier | `"u1"`, `"unknown"` |
| `user_display_name` | string | Human-readable user name | `"Alice Chen"`, `"Unidentified browser session"` |
| `ai_system` | string | AI system name | `"OpenAI ChatGPT API"`, `"ChatGPT (OpenAI)"` |
| `model_version` | string | Model used or N/A | `"gpt-4o-mini"`, `"External SaaS — model version not visible to org"` |
| `input_text` | text | User input (if available) | `"What is 2+2?"` |
| `input_source` | string | Where input came from | `"chat_console_ui"`, `"browser_extension"` |
| `policy_invoked` | string | Audit policy that applied | `"general_assistant_v1"`, `"Shadow AI Usage Policy v0.1"` |
| `reasoning_summary` | text | AI reasoning or review comment | `"Simple arithmetic"`, `"Potential bias detected"` |
| `output_text` | text | AI response or review comment | `"4"`, `"This looks good."` |
| `downstream_action` | string | What happened to this entry | `"Response displayed to user in chat UI"`, `"Shadow AI interaction logged"` |
| `parent_response_id` | UUID string or null | Links review_event to original entry | UUID, `null` |
| `prev_hash` | SHA-256 hex string | Hash of previous entry in chain | hex string, `"GENESIS"` |
| `entry_hash` | SHA-256 hex string | This entry's hash for tamper-evidence | hex string |

Cost estimation (`cost_per_response`) is computed separately from token usage per model in `pricing.py` and displayed in the dashboard/database viewer.

---

## API Endpoints

### Health & Auth
- `GET /health` — Health check
- `POST /api/auth/register` — Register a new demo user
- `POST /api/auth/login` — Login and get Bearer token

### Audit Log (all require Bearer token)
- `GET /api/audit-logs?limit=10&offset=0` — List entries paginated
- `GET /api/audit-logs/{response_id}` — Get single entry by ID
- `GET /api/audit-logs/verify` — Verify hash chain integrity
- `GET /api/audit-logs/cost` — Cost dashboard aggregates (KPIs, daily cost series)
- `GET /api/audit-logs/export?format=json|csv` — Export with filters
- `POST /api/audit-logs` — Create entry (testing only)

### Database Viewer (requires Bearer token)
- `GET /api/db/audit-log-entries?search=&sort=&order=&page=&per_page=` — Raw paginated table data

### Chat (requires Bearer token)
- `POST /api/chat` — Send message, get AI response, log to audit trail

### Reviews (requires Bearer token)
- `GET /api/audit-logs/{response_id}/reviews` — Get reviews for entry
- `POST /api/audit-logs/{response_id}/review` — Add approval/flag review

### Shadow Detector (auth optional)
- `POST /api/detector/event` — Log browser extension event (visit or captured prompt/response)

---

## Deployment

### Backend — Render
- `backend/Procfile`: `web: gunicorn -w 2 -k uvicorn.workers.UvicornWorker main:app`
- `backend/runtime.txt`: `python-3.12.10`
- Set `OPENAI_API_KEY` (and `ALLOWED_ORIGINS` if used) as environment variables

### Frontend — Vercel
- `frontend/vercel.json` rewrites all routes to `index.html` for SPA routing
- Set `VITE_API_BASE_URL` to your deployed backend URL at build time

---

## Tech Stack

**Backend:**
- FastAPI (Python web framework)
- SQLAlchemy (ORM)
- SQLite (embedded database)
- OpenAI API (chat completions)
- gunicorn + uvicorn workers (production serve)
- Python 3.12

**Frontend:**
- React 19
- TypeScript
- Vite (build tool)
- Tailwind CSS v4
- Recharts (cost dashboard charts)
- React Router (certificate routes)
- Session storage for auth

**Extension:**
- Chrome Manifest V3
- Chrome DevTools Protocol (debugger) for content capture
- Service Workers
- chrome.storage.local

---

## Demo Users

| ID | Name | Role |
|----|------|------|
| u1 | Alice Chen | compliance_officer |
| u2 | Bob Iyer | analyst |
| u3 | Priya Reviewer | reviewer |

No passwords required (POC only).

---

## Directory Layout

```
backend/
├── main.py                 # FastAPI app + endpoints
├── models.py               # SQLAlchemy + database setup
├── auth.py                 # Auth logic (demo users, tokens)
├── audit_service.py        # Create/query audit entries
├── chat_service.py         # OpenAI integration
├── review_service.py       # Review workflow
├── export_service.py       # Export (JSON/CSV)
├── pricing.py              # Per-model token cost estimation
├── hashing.py              # Hash chain computation
├── tests/                  # Backend tests
├── Procfile                # Render deployment (gunicorn/uvicorn)
├── runtime.txt             # Python version pin
├── requirements.txt        # Python dependencies
├── .env.example            # Example env vars
└── audit.db                # SQLite database (created on first run)

frontend/
├── src/
│   ├── App.tsx             # Main app + tab navigation
│   ├── AuthContext.tsx     # Auth state management
│   ├── LoginPage.tsx       # Login/register UI
│   ├── NavBar.tsx          # Top navigation
│   ├── ChatConsole.tsx     # Chat UI
│   ├── AuditTrail.tsx      # Audit trail browser + cost dashboard + reviews
│   ├── DatabaseViewer.tsx  # Raw audit entries table
│   ├── AgentAudit.tsx      # Dashboard visualizing agent execution traces
│   ├── Certificate.tsx     # Printable audit certificate
│   ├── config.ts           # API base URL (VITE_API_BASE_URL)
│   ├── main.tsx            # React entry point
│   └── index.css           # Tailwind CSS
├── vercel.json             # SPA rewrites for Vercel
├── package.json
├── vite.config.ts
└── tsconfig.json

extension-debugger/
├── manifest.json           # Chrome Manifest V3 (debugger build)
├── background.js           # Service worker (detector + CDP content capture)
├── popup.html              # Popup UI
├── popup.js                # Popup logic
├── styles.css              # Popup styling
└── icon16/48/128.png       # Extension icons

travel_planner_agent/
├── agent.py                # Core CrewAI logic (Agents, Tasks, Tools, AuditCollector)
├── app.py                  # Streamlit web UI
├── metadata.yaml           # Agent metadata configuration
├── requirements.txt        # Python dependencies (crewai, langchain, streamlit)
└── .env.example            # Environment variables template
```

---

## Security Notes

- This POC stores the OpenAI API key in plaintext `.env` — never do this in production
- Auth tokens are in-memory (backend) and sessionStorage (frontend) — lost on restart
- Content-capture mode in the extension sends prompt/response text to the backend — use presence-only mode for strict privacy policies
- No rate limiting, input validation, or CSRF protection
- Extension has broad host permissions and debugger access — only for POC demo

For production, implement:
- Environment-based secrets (Vault, AWS Secrets Manager, etc.)
- Proper database (PostgreSQL, etc.)
- Real authentication (OAuth, SAML, etc.)
- Encryption at rest and in transit
- Rate limiting and DDoS protection
- Input validation and SQL injection prevention
- Audit logging for the audit system itself

---

## Troubleshooting

### Backend won't start
```bash
# Ensure port 8000 is free
netstat -ano | findstr :8000
# Activate venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
```

### Frontend compilation errors
```bash
cd frontend
npm install
npm run build   # Check for TypeScript errors
```

### Extension not detecting sites
- Ensure background service worker is active (check `chrome://extensions`)
- Check browser console for errors (chrome://extensions > Details > Errors)
- Verify the backend is running and the URL is in `host_permissions` in `manifest.json`

### Chat not logging
- Check OpenAI API key in `.env`
- Check network tab for failed POST to `/api/chat`
- Ensure you're signed in (Bearer token present)

### Verify chain fails
- Check if entries were manually deleted from the database (shouldn't happen)
- Rebuild the database: delete `audit.db` and restart the backend

---

## Next Steps (Not Included)

- Role-based access control (RBAC): gate review to "reviewer" role only
- Persistent browser sessions: token refresh, long-lived sessions
- Real authentication: OAuth 2.0, SAML, LDAP
- Database encryption and key rotation
- Elasticsearch integration for full-text search on the audit trail
- Webhooks for alerts (e.g., flag event → Slack notification)
- Compliance reporting: automated PDF export for SOC2, GDPR, etc.
- Multi-tenancy: separate audit trails per customer/org
- Rate limiting and quota management per user
- Anomaly detection: flag unusual patterns in AI usage
- Integration with security tools: SIEM, threat intelligence, etc.

## License

POC — not for production use.
