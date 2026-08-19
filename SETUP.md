# 🚀 Complete Setup Guide - AI Audit Trail

This guide will help you set up the entire AI Audit Trail project locally or on a fresh machine after cloning from GitHub.

## ⚠️ Common Issues (Why it fails when cloned)

When you clone the project to a new machine, you may face these issues:
1. ❌ **Missing `.env` file** - Environment variables like `OPENAI_API_KEY` are not set
2. ❌ **Hardcoded localhost URLs** - Components use `http://localhost:8000` by default
3. ❌ **Missing dependencies** - Python packages and Node.js modules not installed
4. ❌ **Backend not running** - Travel Planner Agent and frontend depend on backend

**Solution:** Follow this step-by-step guide to set up everything correctly.

---

## 📋 Prerequisites

Make sure you have installed:
- **Python 3.8+** - [Download Python](https://www.python.org/downloads/)
- **Node.js 16+** - [Download Node.js](https://nodejs.org/)
- **Git** - [Download Git](https://git-scm.com/)
- **OpenAI API Key** - [Get from OpenAI](https://platform.openai.com/api-keys)

---

## 🔧 Step 1: Backend Setup (FastAPI Server)

### 1.1 Create Environment File

In the project root, copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` and add your **OpenAI API Key**:

```ini
# ✅ REQUIRED
OPENAI_API_KEY=sk-your-actual-openai-api-key-here

# Optional (defaults to localhost)
BACKEND_URL=http://localhost:8000
# Local DB (optional) - if unset, the backend will default to a local SQLite DB
DATABASE_URL=sqlite:///./audit.db
ALLOWED_ORIGINS=*
VITE_API_BASE_URL=http://localhost:8000
AGENT_AUDIT_API_URL=http://localhost:8000/api/agent-audit/events
```

### 1.2 Install Python Dependencies

```bash
cd backend

# Create virtual environment
python3 -m venv .venv

# Activate virtual environment
# On Windows:
.venv\Scripts\activate
# On macOS/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 1.3 Start the Backend Server

```bash
# Make sure you're in the backend folder with venv activated
python -m uvicorn main:app --reload --port 8000
```

✅ **Backend is ready** when you see:
```
Uvicorn running on http://127.0.0.1:8000
```

- API Documentation: http://localhost:8000/docs
- Database is auto-initialized on startup

---

## ⚛️ Step 2: Frontend Setup (React + Vite)

### 2.1 Install Dependencies

```bash
cd frontend

# Install Node.js packages
npm install
```

### 2.2 Create Frontend Environment File (Optional)

For development, the frontend reads `VITE_API_BASE_URL` from `.env` during build:

```bash
# Create .env.local in frontend folder (optional)
echo "VITE_API_BASE_URL=http://localhost:8000" > .env.local
```

### 2.3 Start Development Server

```bash
# Make sure backend is running (see Step 1.3)
npm run dev
```

✅ **Frontend is ready** at: http://localhost:5173

**Test it:** Click "Dashboard" and you should see the Audit Trail page.

---

## 🎯 Step 3: Travel Planner Agent Setup

The Travel Planner Agent is a **Streamlit app** with CrewAI that depends on the backend.

### 3.1 Install Dependencies

```bash
cd "Travel Planner Agent"

# Use the same Python virtual environment or create a new one
# If using shared venv:
source ../.venv/bin/activate  # or .venv\Scripts\activate on Windows

# Install dependencies
pip install -r requirements.txt
```

### 3.2 Configure Environment Variables

Make sure your `.env` file in the root is set up (see Step 1.1):

```ini
OPENAI_API_KEY=sk-your-key-here
AGENT_AUDIT_API_URL=http://localhost:8000/api/agent-audit/events
OPENWEATHER_API_KEY=  # Optional (uses mock data if not set)
```

**Important:** The Travel Planner Agent POSTs events to the backend WITHOUT authentication. This is intentional:
- ✅ **Autonomous agents can freely log their activities** (no token needed to POST)
- ✅ **Only authenticated users can VIEW the events** (authentication required for GET)
- This allows agents to audit themselves without managing complex credentials

### 3.3 Start the Streamlit App

```bash
# Make sure backend is running (Step 1.3)
# Must be run from the Travel Planner Agent directory
streamlit run app.py
```

✅ **Travel Planner is ready** at: http://localhost:8501

**Test it:** Fill in the form and click "Plan My Trip" - should work instantly.

---

## 🔌 Step 4: Chrome Extension Setup (Optional)

The Chrome extension captures shadow AI usage (Copilot, Claude, etc.).

### 4.1 Load Unpacked Extension

1. Open **Chrome** → Go to `chrome://extensions`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `extension-debugger` folder from your project

### 4.2 Configure Backend URL

1. Click the extension icon in Chrome toolbar
2. In the popup, scroll down to **"Backend Configuration"**
3. Enter your backend URL (e.g., `http://localhost:8000`)
4. Click **Save**

Now the extension will:
- ✅ Let you sign in with the same credentials as the web app
- ✅ Capture ChatGPT, Copilot, and Claude usage
- ✅ Log it to the backend

---

## 🧪 Testing the Full System

### Checklist

Before assuming everything works:

1. ✅ **Backend running?**
   - http://localhost:8000/docs should show API docs

2. ✅ **Frontend running?**
   - http://localhost:5173 should load the dashboard

3. ✅ **Travel Planner running?**
   - http://localhost:8501 should load the Streamlit app

4. ✅ **Can you plan a trip?**
   - Click "Plan My Trip" in the Streamlit app
   - Should return an itinerary in ~30 seconds
   - Agent should log "X events logged (run ...)"

5. ✅ **See agent audit events?**
   - Go to frontend http://localhost:5173/agent-audit
   - **Important:** You must be logged in as:
     - ✅ **alice / demo123** (Compliance Officer)
     - ✅ **priya / demo123** (Reviewer)
   - **Cannot use:** bob / demo123 (Analyst role - no audit access)
   - Should see the events from your trip plan

6. ✅ **See audit logs?**
   - Go to frontend http://localhost:5173
   - Click **Database Viewer** to see all audit trails

---

## 🐛 Troubleshooting

### Error: `OPENAI_API_KEY not set`
- **Solution:** Add `OPENAI_API_KEY=sk-...` to `.env` file
- Restart backend and Travel Planner app

### Error: `Connection refused http://localhost:8000`
- **Solution:** Start backend first (Step 1.3)
- Make sure you see "Uvicorn running on http://127.0.0.1:8000"

### Error: `Cannot find module 'agent'` in Streamlit
- **Solution:** Make sure you're in `Travel Planner Agent` folder and Python environment has CrewAI installed
- Run: `pip install -r requirements.txt`

### Travel Planner page shows blank/error
- **Solution:**
  1. Check backend is running: `Uvicorn running...`
  2. Check `.env` has `AGENT_AUDIT_API_URL=http://localhost:8000/api/agent-audit/events`
  3. Refresh Streamlit page
  4. Check browser console (F12) for errors

### Agent events not showing on Agent Audit page
- **Solution:**
  1. Make sure you generated a trip plan (events were logged with "run ...") 
  2. Verify you're logged in as **alice** or **priya** (compliance officer or reviewer role)
  3. **NOT bob** - he's an analyst and cannot view audit trails
  4. Refresh the Agent Audit page
  5. Check backend logs for any errors
  6. To verify events were saved:
     ```bash
     cd backend
     python -c "from models import SessionLocal, AgentAuditEvent; db = SessionLocal(); print('Events:', db.query(AgentAuditEvent).count()); db.close()"
     ```

### Extension not capturing events
- **Solution:**
  1. Go to `chrome://extensions`
  2. Find "AI Audit Trail - Shadow Detector"
  3. Click **Details**
  4. Check **"Allow access to file URLs"** (if needed)
  5. Configure backend URL in extension popup
  6. Reload extension (refresh button)

### Frontend won't connect to backend
- **Solution:** Set `VITE_API_BASE_URL` in frontend `.env.local`
  ```bash
  echo "VITE_API_BASE_URL=http://localhost:8000" > frontend/.env.local
  npm run build  # Rebuild
  npm run dev    # Restart dev server
  ```

---

## 📦 Deploying to Production

### Backend Deployment

1. Set environment variables on your server:
   ```bash
   export OPENAI_API_KEY=sk-your-key
   export ALLOWED_ORIGINS=https://yourdomain.com
   ```

2. Run with Gunicorn:
   ```bash
   pip install gunicorn
   gunicorn -w 4 -b 0.0.0.0:8000 main:app
   ```

3. Or use the Procfile for Heroku deployment:
   ```bash
   git push heroku main
   ```

### Frontend Deployment

1. Build for production:
   ```bash
   cd frontend
   VITE_API_BASE_URL=https://your-backend-url npm run build
   ```

2. Deploy `frontend/dist` folder to:
   - Vercel, Netlify, GitHub Pages, or your server

### Travel Planner Agent Deployment

The Streamlit app can be deployed to:
- [Streamlit Cloud](https://share.streamlit.io/) - Easiest
- Docker container
- Your own server

---

## 📚 Useful Commands

```bash
# Activate Python environment
source .venv/bin/activate  # macOS/Linux
.venv\Scripts\activate     # Windows

# Start backend
cd backend
python -m uvicorn main:app --reload

# Start frontend
cd frontend
npm run dev

# Start Travel Planner
cd "Travel Planner Agent"
streamlit run app.py

# Check if ports are in use
netstat -an | grep 8000  # macOS/Linux
netstat -an | findstr 8000  # Windows
```

---

## 📖 API Documentation

Once backend is running, see live API docs:
- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc

---

## ❓ FAQ

**Q: Do I need all three apps running?**
- A: For a fresh clone to work properly:
  - ✅ Backend is **REQUIRED** (always start first)
  - ✅ Frontend is **REQUIRED** (for UI)
  - ❌ Travel Planner is **optional** (separate Streamlit app)
  - ❌ Chrome Extension is **optional** (for shadow AI detection)

**Q: Can I change the backend URL?**
- A: Yes! 
  - Backend: Change `BACKEND_URL` in `.env`
  - Frontend: Change `VITE_API_BASE_URL` before building
  - Travel Planner: Change `AGENT_AUDIT_API_URL` in `.env`
  - Extension: Click extension popup, change URL in settings

**Q: Do I need OpenWeather API key?**
- A: No, it's optional. Without it, Travel Planner uses mock weather data.

**Q: The Travel Planner takes 30 seconds to respond. Is that normal?**
- A: Yes! It's calling multiple AI agents (GPT-4o-mini) in sequence. First run may take longer.

---

## 🎓 Project Structure

```
legalbot-Agent-Audit/
├── backend/                 # FastAPI server
│   ├── main.py             # Entry point
│   ├── models.py           # Database models
│   ├── requirements.txt     # Python dependencies
│   └── ...
├── frontend/               # React + TypeScript
│   ├── src/
│   │   ├── App.tsx
│   │   ├── config.ts       # API base URL config
│   │   └── ...
│   ├── package.json
│   └── vite.config.ts
├── Travel Planner Agent/   # Streamlit + CrewAI
│   ├── app.py              # Streamlit UI
│   ├── agent.py            # CrewAI agents
│   └── requirements.txt
├── extension-debugger/     # Chrome extension
│   ├── manifest.json
│   ├── popup.html
│   ├── background.js
│   └── ...
├── .env.example            # Environment variables template
└── README.md               # Project overview
```

---

## 🚨 Still Having Issues?

1. **Check logs:**
   - Backend: Look for error messages in terminal
   - Frontend: Open browser DevTools (F12) → Console tab
   - Travel Planner: Streamlit shows errors in terminal

2. **Verify ports are free:**
   ```bash
   # Check if port 8000 is in use
   lsof -i :8000  # macOS/Linux
   # If in use, either stop that process or start backend on different port:
   python -m uvicorn main:app --reload --port 8001
   ```

3. **Clear cache:**
   ```bash
   # Frontend
   cd frontend && rm -rf node_modules .venv dist && npm install
   
   # Backend
   cd backend && rm -rf .venv && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
   ```

---

**🎉 You should now have a working AI Audit Trail system!**

For more details, see [README.md](README.md)
