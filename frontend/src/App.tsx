import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom'
import { ShieldCheck, Activity, Database, Bot } from 'lucide-react'
import { useAuth } from './AuthContext'
import { LoginPage } from './LoginPage'
import { NavBar } from './NavBar'
import { ChatConsole } from './ChatConsole'
import { AuditTrail } from './AuditTrail'
import { DatabaseViewer } from './DatabaseViewer'
import { Certificate } from './Certificate'
import { AgentAudit } from './AgentAudit'

const AUDIT_ROLES = new Set(['compliance_officer', 'reviewer'])

const TABS = [
  { path: '/chat', label: 'Chat Console', icon: Activity, requiresAudit: false },
  { path: '/audit', label: 'Audit Trail', icon: ShieldCheck, requiresAudit: true },
  { path: '/database', label: 'Database', icon: Database, requiresAudit: true },
  { path: '/agent-audit', label: 'Agent Audit', icon: Bot, requiresAudit: true },
] as const

function AppContent() {
  const { user } = useAuth()
  const location = useLocation()
  const canViewAudit = !!user && AUDIT_ROLES.has(user.role)

  const activePath = '/' + (location.pathname.split('/')[1] || 'chat')

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#F4F7FB] font-body selection:bg-blue-200 selection:text-blue-900">
      <div className="shrink-0">
        <NavBar />
      </div>

      <div className="shrink-0 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl z-40">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col px-4 lg:px-8">
          <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 lg:text-2xl">
                AI Governance Workspace
              </h1>
              <p className="mt-1 text-xs font-medium text-slate-500 lg:text-sm">
                Every AI conversation is securely verified and audit-ready.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm lg:text-sm">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              Live Protection Active
            </div>
          </div>

          <div className="flex items-center gap-6">
            {TABS.map((tab) => {
              if (tab.requiresAudit && !canViewAudit) return null
              const isActive = activePath === tab.path
              return (
                <Link
                  key={tab.path}
                  to={tab.path}
                  className={`relative pb-3 text-sm font-semibold transition-colors ${
                    isActive ? 'text-blue-600' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <tab.icon className="h-4 w-4" />
                    {tab.label}
                  </div>
                  {isActive && (
                    <span className="absolute bottom-0 left-0 h-0.5 w-full rounded-t-full bg-blue-600" />
                  )}
                </Link>
              )
            })}
            {!canViewAudit && (
              <p className="ml-auto pb-3 text-xs font-medium text-slate-400">
                Audit Trail restricted to Compliance Officers
              </p>
            )}
          </div>
        </div>
      </div>

      <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col p-3 md:p-4 lg:p-6">
        <Routes>
          <Route path="/chat" element={<ChatConsole />} />
          <Route
            path="/audit"
            element={canViewAudit ? <AuditTrail /> : <Navigate to="/chat" replace />}
          />
          <Route
            path="/database"
            element={canViewAudit ? <DatabaseViewer /> : <Navigate to="/chat" replace />}
          />
          <Route
            path="/agent-audit"
            element={canViewAudit ? <AgentAudit /> : <Navigate to="/chat" replace />}
          />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function App() {
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) {
    return <LoginPage />
  }

  return (
    <Routes>
      <Route path="/certificate/:response_id" element={<Certificate />} />
      <Route path="*" element={<AppContent />} />
    </Routes>
  )
}

export default App
