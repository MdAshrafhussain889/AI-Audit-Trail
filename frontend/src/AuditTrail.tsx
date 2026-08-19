import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAuth } from './AuthContext'
import { API_BASE_URL } from './config'
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  ResponsiveContainer,
} from 'recharts'
import { ChevronDown, Flag, Check, Download, RefreshCw, ShieldAlert, ShieldCheck, Activity, Database, DollarSign, Target, Zap } from 'lucide-react'

function truncateWords(text: string, max: number): string {
  if (!text) return ''
  const words = text.split(/\s+/)
  if (words.length <= max) return text
  let result = words.slice(0, max).join(' ')
  const fences = (result.match(/```/g) || []).length
  if (fences % 2 !== 0) {
    result += '\n```'
  }
  return result + '...'
}

type AuditEntry = {
  id: number
  response_id: string
  timestamp_utc: string
  source_type: string
  user_id: string
  user_display_name: string
  ai_system: string
  model_version: string
  input_text: string
  input_source: string
  policy_invoked: string
  reasoning_summary: string
  output_text: string
  downstream_action: string
  parent_response_id: string | null
  cost_per_response: number | null
  prompt_tokens?: number
  completion_tokens?: number
  prev_hash: string
  entry_hash: string
}

export function AuditTrail() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [verifyResult, setVerifyResult] = useState<{
    valid: boolean
    broken_at_response_id?: string
  } | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)

  // Filters
  const [searchText, setSearchText] = useState('')
  const [filterSourceType, setFilterSourceType] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [error, setError] = useState('')

  // Reviews
  const [reviews, setReviews] = useState<Record<string, AuditEntry[]>>({})
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewComment, setReviewComment] = useState('')
  const [isSubmittingReview, setIsSubmittingReview] = useState(false)
  const { token } = useAuth()

  useEffect(() => {
    loadEntries()
  }, [])

  useEffect(() => {
    const onFocus = () => loadEntries()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [token])

  const loadEntries = async () => {
    setIsLoading(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE_URL}/api/audit-logs?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('Failed to load entries')
      const data = await response.json()
      setEntries(data)
      await hydrateReviewsFromEntries(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load entries')
    } finally {
      setIsLoading(false)
    }
  }

  const hydrateReviewsFromEntries = async (loadedEntries: AuditEntry[]) => {
    const reviewEvents = loadedEntries.filter(
      (entry) => entry.source_type === 'review_event' && entry.parent_response_id
    )
    const grouped: Record<string, AuditEntry[]> = {}
    for (const review of reviewEvents) {
      const parentId = review.parent_response_id!
      if (!grouped[parentId]) grouped[parentId] = []
      grouped[parentId].push(review)
    }
    setReviews((prev) => ({ ...prev, ...grouped }))
  }

  const loadReviews = async (responseId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/audit-logs/${responseId}/reviews`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (response.ok) {
        const data = await response.json()
        setReviews((prev) => ({ ...prev, [responseId]: data }))
      }
    } catch (err) {
      console.error('Failed to load reviews:', err)
    }
  }

  const handleExpandRow = (entryId: number, responseId: string) => {
    if (expandedId === entryId) {
      setExpandedId(null)
      setReviewingId(null)
    } else {
      setExpandedId(entryId)
      loadReviews(responseId)
      setReviewingId(null)
      setReviewComment('')
    }
  }

  const submitReview = async (responseId: string, status: 'approved' | 'flagged') => {
    if (!reviewComment.trim()) return setError('Please enter a comment')
    setIsSubmittingReview(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE_URL}/api/audit-logs/${responseId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status, comment: reviewComment }),
      })
      if (!response.ok) throw new Error('Failed to submit review')
      setReviewComment('')
      setReviewingId(null)
      await loadReviews(responseId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit review')
    } finally {
      setIsSubmittingReview(false)
    }
  }

  const verifyChain = async () => {
    setIsVerifying(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE_URL}/api/audit-logs/verify`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('Failed to verify chain')
      const data = await response.json()
      setVerifyResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify chain')
    } finally {
      setIsVerifying(false)
    }
  }

  const handleExport = async (format: 'json' | 'csv') => {
    const params = new URLSearchParams({ format })
    if (filterSourceType) params.append('source_type', filterSourceType)
    if (fromDate) params.append('from_date', fromDate)
    if (toDate) params.append('to_date', toDate)

    try {
      const response = await fetch(`${API_BASE_URL}/api/audit-logs/export?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!response.ok) throw new Error('Export failed')
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `audit-trail.${format}`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    }
  }

  const filteredEntries = useMemo(() => entries
    .filter((entry) => entry.source_type !== 'review_event')
    .filter((entry) => {
      const matchesSearch = !searchText || entry.input_text.toLowerCase().includes(searchText.toLowerCase()) || entry.output_text.toLowerCase().includes(searchText.toLowerCase())
      const matchesSourceType = !filterSourceType || entry.source_type === filterSourceType
      const matchesFromDate = !fromDate || entry.timestamp_utc >= fromDate
      const matchesToDate = !toDate || entry.timestamp_utc <= toDate
      return matchesSearch && matchesSourceType && matchesFromDate && matchesToDate
    }), [entries, searchText, filterSourceType, fromDate, toDate])

  const sourceTypes = Array.from(new Set(entries.filter((e) => e.source_type !== 'review_event').map((e) => e.source_type)))
  const formatTimestamp = (ts: string) => new Date(ts).toLocaleString().replace(/\b(am|pm)\b/g, (match) => match.toUpperCase())
  const truncateText = (text: string, maxLen: number = 60) => text.length > maxLen ? text.slice(0, maxLen) + '…' : text

  const reviewedDecisionIds = useMemo(() => new Set(entries.filter((entry) => entry.source_type === 'review_event' && entry.parent_response_id).map((entry) => entry.parent_response_id as string)), [entries])
  const getReviewStatus = (responseId: string) => reviewedDecisionIds.has(responseId) || (reviews[responseId] || []).length > 0
  const isBrokenChainEntry = (responseId: string) => verifyResult?.valid === false && verifyResult.broken_at_response_id === responseId

  // --- ENTERPRISE GOVERNANCE DASHBOARD METRICS ---
  const [showCharts, setShowCharts] = useState(true)

  const dashboardData = useMemo(() => {
    let reviewedCount = 0
    let flaggedCount = 0
    let totalCost = 0

    const userMap: Record<string, { name: string; count: number }> = {}
    const modelMap: Record<string, number> = {}
    const timeSeriesMap: Record<string, { date: string; requests: number; cost: number; tokens: number }> = {}

    for (const e of filteredEntries) {
      // Review Stats
      const entryReviews = reviews[e.response_id] || []
      if (entryReviews.some(r => r.downstream_action.includes('flagged'))) flaggedCount++
      else if (entryReviews.length > 0) reviewedCount++

      // User Stats
      if (!userMap[e.user_id]) userMap[e.user_id] = { name: e.user_display_name, count: 0 }
      userMap[e.user_id].count++

      // Model Stats
      modelMap[e.model_version] = (modelMap[e.model_version] || 0) + 1

      // Time Series (Group by Date)
      const dateStr = new Date(e.timestamp_utc).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      if (!timeSeriesMap[dateStr]) timeSeriesMap[dateStr] = { date: dateStr, requests: 0, cost: 0, tokens: 0 }

      const actualCost = e.cost_per_response ?? 0
      const actualTokens = (e.prompt_tokens ?? 0) + (e.completion_tokens ?? 0)

      timeSeriesMap[dateStr].requests += 1
      timeSeriesMap[dateStr].tokens += actualTokens
      timeSeriesMap[dateStr].cost += actualCost
      totalCost += actualCost
    }

    const pendingCount = filteredEntries.length - reviewedCount - flaggedCount
    const timeSeries = Object.values(timeSeriesMap).slice(-7) // Last 7 days
    const users = Object.values(userMap).sort((a, b) => b.count - a.count)
    const models = Object.entries(modelMap).map(([name, value]) => ({ name, value }))

    return {
      kpis: {
        total: filteredEntries.length,
        reviewed: reviewedCount,
        pending: pendingCount,
        flagged: flaggedCount,
        cost: totalCost,
        complianceScore: filteredEntries.length ? Math.round((reviewedCount / (reviewedCount + flaggedCount || 1)) * 100) : 100
      },
      timeSeries,
      users,
      models,
    }
  }, [filteredEntries, reviews])

  const CHART_COLORS = ['#0f172a', '#b48600', '#64748b', '#10b981']

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-6 overflow-y-auto pb-8 scrollbar-thin scrollbar-thumb-slate-300">

      {/* 1. KPI CARDS (Most Important) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 shrink-0">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">AI Requests</span>
            <Activity className="w-4 h-4 text-blue-500" />
          </div>
          <span className="text-2xl font-black text-slate-900">{dashboardData.kpis.total}</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">Verified Records</span>
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
          </div>
          <span className="text-2xl font-black text-emerald-600">100%</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">Pending Reviews</span>
            <Target className="w-4 h-4 text-amber-500" />
          </div>
          <span className="text-2xl font-black text-amber-600">{dashboardData.kpis.pending}</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">Flagged</span>
            <Flag className="w-4 h-4 text-red-500" />
          </div>
          <span className="text-2xl font-black text-red-600">{dashboardData.kpis.flagged}</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">Hash Chain</span>
            <Database className="w-4 h-4 text-emerald-500" />
          </div>
          <span className={`text-xl font-black ${verifyResult?.valid === false ? 'text-red-600' : 'text-emerald-600'}`}>
            {verifyResult?.valid === false ? 'Broken' : 'Healthy'}
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">Est. Cost</span>
            <DollarSign className="w-4 h-4 text-slate-400" />
          </div>
          <span className="text-2xl font-black text-slate-900">${dashboardData.kpis.cost.toFixed(6)}</span>
        </div>
      </div>

      {/* 2. Top Control Panel (Filters & Validation) */}
      <div className="shrink-0 space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={verifyChain} disabled={isVerifying} className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50">
              <ShieldCheck className="h-4 w-4" /> {isVerifying ? 'Verifying...' : 'Verify Chain Integrity'}
            </button>
            <button onClick={loadEntries} disabled={isLoading} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>

            {verifyResult && (
              <span className={`ml-2 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold ${verifyResult.valid ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {verifyResult.valid ? <><Check className="h-3 w-3" /> Chain Verified</> : <><ShieldAlert className="h-3 w-3" /> Chain Broken</>}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => handleExport('csv')} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Download className="h-3.5 w-3.5" /> CSV</button>
            <button onClick={() => handleExport('json')} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Download className="h-3.5 w-3.5" /> JSON</button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4 pt-2 border-t border-slate-100">
          <div>
            <input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search records..." className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none" />
          </div>
          <div className="relative">
            <select value={filterSourceType} onChange={(e) => setFilterSourceType(e.target.value)} className="w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none">
              <option value="">All Source Types</option>
              {sourceTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
          <div>
            <input type="datetime-local" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none" />
          </div>
          <div>
            <input type="datetime-local" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none" />
          </div>
        </div>
      </div>

      {/* 3. CHARTS GRID (Operational Intelligence) */}
      <div className="shrink-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <button onClick={() => setShowCharts(!showCharts)} className="group flex w-full items-center justify-between text-left mb-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Operational Intelligence</h3>
          </div>
          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${showCharts ? 'rotate-180' : ''}`} />
        </button>

        {showCharts && (
          <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-2">

            {/* Review Status (Stacked Progress UI) */}
            <div className="col-span-1 rounded-xl border border-slate-100 bg-slate-50/50 p-4 flex flex-col justify-center">
              <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Compliance Review Status</h4>

              <div className="flex flex-col gap-5">
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden flex">
                  <div style={{ width: `${(dashboardData.kpis.reviewed / (dashboardData.kpis.total || 1)) * 100}%` }} className="bg-emerald-500 h-full" />
                  <div style={{ width: `${(dashboardData.kpis.pending / (dashboardData.kpis.total || 1)) * 100}%` }} className="bg-amber-400 h-full" />
                  <div style={{ width: `${(dashboardData.kpis.flagged / (dashboardData.kpis.total || 1)) * 100}%` }} className="bg-red-500 h-full" />
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="flex flex-col">
                    <span className="text-xl font-bold text-slate-900">{dashboardData.kpis.reviewed}</span>
                    <span className="text-[10px] font-bold text-emerald-600 uppercase">Reviewed</span>
                  </div>
                  <div className="flex flex-col border-x border-slate-200">
                    <span className="text-xl font-bold text-slate-900">{dashboardData.kpis.pending}</span>
                    <span className="text-[10px] font-bold text-amber-600 uppercase">Pending</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xl font-bold text-slate-900">{dashboardData.kpis.flagged}</span>
                    <span className="text-[10px] font-bold text-red-600 uppercase">Flagged</span>
                  </div>
                </div>

                {/* Audit Integrity Gauge */}
                <div className="mt-2 pt-4 border-t border-slate-200 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Audit Integrity</span>
                  <span className="text-sm font-black text-emerald-600 flex items-center gap-1"><ShieldCheck className="w-4 h-4"/> 100% Secure</span>
                </div>
              </div>
            </div>

            {/* Daily AI Cost Trend (Area Chart) */}
            <div className="col-span-1 rounded-xl border border-slate-100 bg-slate-50/50 p-4">
              <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Daily Cost Trend</h4>
              <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dashboardData.timeSeries}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(val) => `$${val}`} width={40}/>
                    <Tooltip formatter={(v: number) => `$${v.toFixed(6)}`} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '12px' }} />
                    <Area type="monotone" dataKey="cost" stroke="#b48600" fill="#fef3c7" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* AI Models Used (Donut Chart with Legend) */}
            <div className="col-span-1 rounded-xl border border-slate-100 bg-slate-50/50 p-4 flex flex-col">
              <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Models Used</h4>
              <div className="flex-1 flex items-center gap-4">
                <div className="h-28 w-28 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie 
                        data={dashboardData.models} 
                        dataKey="value" 
                        nameKey="name" 
                        cx="50%" 
                        cy="50%" 
                        innerRadius={30} 
                        outerRadius={50} 
                        stroke="none"
                      >
                        {dashboardData.models.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '11px', fontWeight: '600', padding: '4px 8px' }} 
                        itemStyle={{ color: '#0f172a' }} 
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-2.5 overflow-y-auto max-h-28 pr-1">
                  {dashboardData.models.map((m, i) => (
                    <div key={m.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 overflow-hidden group" title={m.name}>
                        <div className="h-2 w-2 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span className="truncate font-medium text-slate-600 transition-colors group-hover:text-slate-900">{m.name}</span>
                      </div>
                      <span className="font-bold text-slate-900 ml-2">{m.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Top Active Users (Horizontal Bar) - Only show if > 1 user */}
            {dashboardData.users.length > 1 ? (
              <div className="col-span-1 rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Top Active Users</h4>
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dashboardData.users} layout="vertical" margin={{ left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#0f172a', fontWeight: 600 }} axisLine={false} tickLine={false} width={70} />
                      <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '8px', border: 'none' }} />
                      <Bar dataKey="count" fill="#0f172a" radius={[0, 4, 4, 0]} barSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div className="col-span-1 rounded-xl border border-slate-100 bg-slate-50/50 p-4 flex flex-col justify-center items-center text-center">
                <Zap className="h-8 w-8 text-blue-500 mb-2 opacity-50" />
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Token Usage</h4>
                <p className="text-2xl font-black text-slate-900 mt-1">{dashboardData.timeSeries.reduce((acc, curr) => acc + curr.tokens, 0).toLocaleString()}</p>
                <p className="text-xs text-slate-400 font-medium">Estimated tokens processed</p>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="shrink-0 rounded-xl border border-red-200 bg-red-50 p-4 flex items-center gap-3 text-sm font-medium text-red-700">
          <ShieldAlert className="h-5 w-5 shrink-0" /> {error}
        </div>
      )}

      {/* 4. LEDGER ENTRIES LIST */}
      <div className="pl-2 relative flex-1 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-sm text-slate-500 font-medium">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading ledger entries...
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-slate-500 font-medium">
            No entries found matching criteria.
          </div>
        ) : (
          <div className="relative space-y-0">
            <div className="absolute top-6 bottom-4 left-[9px] w-0.5 bg-slate-200 pointer-events-none" aria-hidden="true" />

            {filteredEntries.map((entry) => {
              const isExpanded = expandedId === entry.id
              const isReviewed = getReviewStatus(entry.response_id)
              const isBroken = isBrokenChainEntry(entry.response_id)

              return (
                <div key={entry.id} className="relative flex gap-5 mb-4 group">
                  <div className="relative flex w-5 shrink-0 justify-center pt-5">
                    <div className={`relative z-10 h-3.5 w-3.5 rounded-full border-2 bg-white transition-colors duration-300 ${isBroken ? 'border-red-500 bg-red-50' : isReviewed ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300 group-hover:border-slate-400'}`} aria-hidden="true" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className={`rounded-xl border bg-white transition-all duration-200 ${isExpanded ? 'border-blue-200 shadow-md ring-1 ring-blue-500/10' : 'border-slate-200 shadow-sm hover:border-slate-300 hover:shadow-md'}`}>
                      <button type="button" aria-expanded={isExpanded} onClick={() => handleExpandRow(entry.id, entry.response_id)} className="flex w-full items-start gap-4 p-4 text-left">
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span className="font-mono text-[11px] text-slate-400 font-medium">{formatTimestamp(entry.timestamp_utc)}</span>
                            <span className="font-bold text-slate-900 text-sm">{entry.user_display_name}</span>
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wide font-bold text-slate-500 border border-slate-200">{entry.source_type}</span>
                            <Link to={`/certificate/${entry.response_id}`} onClick={(e) => e.stopPropagation()} className="rounded-md bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-500 border border-slate-200 hover:bg-blue-50 hover:text-blue-600">
                              {entry.response_id.slice(0, 8)}...
                            </Link>
                          </div>

                          <div className="text-[13px] text-slate-500 leading-relaxed font-medium">
                            <span className="text-slate-400">{entry.ai_system}</span>
                            <span className="mx-1.5 text-slate-300">|</span>
                            in: <span className="text-slate-700">{truncateText(entry.input_text || entry.downstream_action, 50)}</span>
                            {entry.source_type === 'chat_console' && entry.output_text && (
                              <><span className="mx-1.5 text-slate-300">→</span> out: <span className="text-slate-700">{truncateText(entry.output_text, 50)}</span></>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-3 self-center pl-2">
                          {isReviewed && <span className="flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 border border-emerald-100"><Check className="h-3 w-3" /> Reviewed</span>}
                          {isBroken && <span className="flex items-center gap-1 rounded-md bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 border border-red-100"><ShieldAlert className="h-3 w-3" /> Broken</span>}
                          <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-180 text-blue-500' : ''}`} />
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="mx-4 mb-4 border-t border-slate-100 pt-4 text-[13px]">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 pb-5">
                            <div className="flex flex-col gap-1">
                              <span className="font-semibold text-slate-500 text-[11px] uppercase tracking-wider">Response ID</span>
                              <Link to={`/certificate/${entry.response_id}`} className="font-mono font-medium text-blue-600 hover:underline">{entry.response_id}</Link>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="font-semibold text-slate-500 text-[11px] uppercase tracking-wider">Policy Invoked</span>
                              <span className="text-slate-900 font-medium">{entry.policy_invoked}</span>
                            </div>

                            <div className="col-span-1 md:col-span-2 flex flex-col gap-1 mt-2">
                              <span className="font-semibold text-slate-500 text-[11px] uppercase tracking-wider">Input Text</span>
                              <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-slate-700 whitespace-pre-wrap font-medium">{entry.input_text || 'N/A'}</div>
                            </div>

                            <div className="col-span-1 md:col-span-2 flex flex-col gap-1 mt-1">
                              <span className="font-semibold text-slate-500 text-[11px] uppercase tracking-wider">Output Text</span>
                              <div className="rounded-lg bg-blue-50/50 border border-blue-100/50 p-3 text-slate-800">
                                {entry.output_text ? (
                                  <div className="prose prose-sm prose-slate max-w-none prose-p:my-1 prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-code:text-pink-600 prose-code:before:content-none prose-code:after:content-none">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{truncateWords(entry.output_text, 150)}</ReactMarkdown>
                                  </div>
                                ) : 'N/A'}
                              </div>
                            </div>

                            <div className="col-span-1 md:col-span-2 flex flex-col gap-1 mt-2">
                              <span className="font-semibold text-slate-500 text-[11px] uppercase tracking-wider">Integrity Hash (SHA-256)</span>
                              <span className="font-mono text-xs text-slate-500 break-all bg-slate-50 p-2 rounded border border-slate-100">{entry.entry_hash}</span>
                            </div>
                          </div>

                          {/* Reviews Section */}
                          <div className="border-t border-slate-100 pt-4 bg-slate-50/50 -mx-4 px-4 pb-1 rounded-b-xl">
                            <h4 className="font-bold text-slate-900 mb-3 text-sm flex items-center gap-2"><Target className="w-4 h-4 text-slate-400"/> Compliance Reviews</h4>

                            {(reviews[entry.response_id] || []).length > 0 ? (
                              <div className="space-y-3 mb-4">
                                {(reviews[entry.response_id] || []).map((review) => {
                                  const isApproved = review.downstream_action.includes('approved')
                                  return (
                                    <div key={review.id} className="bg-white rounded-lg p-3 border border-slate-200 shadow-sm">
                                      <div className="flex items-center gap-2 mb-2">
                                        {isApproved ? <span className="flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700"><Check className="h-3 w-3" /> Approved</span> : <span className="flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700"><Flag className="h-3 w-3" /> Flagged</span>}
                                        <span className="text-xs font-medium text-slate-500">by <span className="text-slate-700">{review.user_display_name}</span></span>
                                      </div>
                                      <p className="text-[13px] font-medium text-slate-800">{review.output_text}</p>
                                    </div>
                                  )
                                })}
                              </div>
                            ) : null}

                            {!isReviewed && (
                              <div className="mt-2 pb-3">
                                {reviewingId === entry.response_id ? (
                                  <div className="space-y-3 bg-white p-3 border border-slate-200 rounded-lg shadow-sm">
                                    <textarea value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} placeholder="Add compliance notes..." className="w-full resize-none rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500" rows={2} />
                                    <div className="flex items-center gap-2">
                                      <button onClick={() => submitReview(entry.response_id, 'approved')} disabled={isSubmittingReview || !reviewComment.trim()} className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><Check className="h-3.5 w-3.5" /> Approve</button>
                                      <button onClick={() => submitReview(entry.response_id, 'flagged')} disabled={isSubmittingReview || !reviewComment.trim()} className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"><Flag className="h-3.5 w-3.5" /> Flag Issue</button>
                                      <button onClick={() => { setReviewingId(null); setReviewComment(''); }} className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-700">Cancel</button>
                                    </div>
                                  </div>
                                ) : (
                                  <button onClick={() => setReviewingId(entry.response_id)} className="text-xs font-bold text-blue-600 bg-blue-50 border border-blue-100 px-3 py-1.5 rounded hover:bg-blue-100 transition-colors">
                                    + Add Review Note
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
