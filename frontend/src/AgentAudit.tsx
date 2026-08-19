import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAuth } from './AuthContext'
import { API_BASE_URL } from './config'
import {
  Bot, Wrench, Brain, ChevronDown, RefreshCw, Layers,
  Search, Download, AlertTriangle, ChevronRight,
} from 'lucide-react'

type AgentAuditEvent = {
  id: number
  run_id: string
  agent_name: string
  event_type: 'agent' | 'tool' | 'llm'
  task_name: string | null
  input_text: string
  output_text: string
  timestamp_utc: string
  source_app: string
  prompt_tokens: number | null
  completion_tokens: number | null
  cost: number | null
}

type AgentSummary = {
  agentName: string
  runId: string
  inputText: string
  outputText: string
  llmCalls: number
  totalTokens: number
  totalCost: number
}

type ToolSummary = {
  toolName: string
  agentName: string
  runId: string
  inputText: string
  outputText: string
}

const PAGE_SIZE = 200
const POLL_INTERVAL = 15_000

function truncateWords(text: string, max: number): string {
  if (!text) return ''
  const words = text.split(/\s+/)
  if (words.length <= max) return text
  let result = words.slice(0, max).join(' ')
  const fences = (result.match(/```/g) || []).length
  if (fences % 2 !== 0) result += '\n```'
  return result + '...'
}

export function AgentAudit() {
  const { token } = useAuth()
  const [events, setEvents] = useState<AgentAuditEvent[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [filterType, setFilterType] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set())
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const toggleRunExpanded = (runId: string) => {
    const newSet = new Set(expandedRuns)
    if (newSet.has(runId)) {
      newSet.delete(runId)
    } else {
      newSet.add(runId)
    }
    setExpandedRuns(newSet)
  }

  const loadEvents = useCallback(async (reset = false) => {
    setIsLoading(true)
    setError('')
    try {
      const currentOffset = reset ? 0 : offset
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(currentOffset),
      })
      if (filterType) params.set('event_type', filterType)
      if (searchQuery.trim()) params.set('search', searchQuery.trim())

      const response = await fetch(`${API_BASE_URL}/api/agent-audit/events?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('Failed to load agent audit events')
      const data: AgentAuditEvent[] = await response.json()

      if (reset) {
        setEvents(data)
        setOffset(data.length)
      } else {
        setEvents((prev) => [...prev, ...data])
        setOffset((prev) => prev + data.length)
      }
      setHasMore(data.length === PAGE_SIZE)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events')
    } finally {
      setIsLoading(false)
    }
  }, [token, offset, filterType, searchQuery])

  useEffect(() => { loadEvents(true) }, [filterType, searchQuery])

  useEffect(() => {
    pollRef.current = setInterval(() => loadEvents(true), POLL_INTERVAL)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [loadEvents])

  useEffect(() => {
    const onFocus = () => loadEvents(true)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadEvents])

  const filteredEvents = useMemo(() => events, [events])

  const runs = useMemo(() => {
    const grouped: Record<string, AgentAuditEvent[]> = {}
    for (const event of filteredEvents) {
      if (!grouped[event.run_id]) grouped[event.run_id] = []
      grouped[event.run_id].push(event)
    }
    return Object.entries(grouped)
      .sort((a, b) => {
        const aTime = a[1][0]?.timestamp_utc || ''
        const bTime = b[1][0]?.timestamp_utc || ''
        return aTime.localeCompare(bTime)
      })
  }, [filteredEvents])

  const agentSummaries = useMemo(() => {
    const agentEvents = events.filter((e) => e.event_type === 'agent')
    const llmEvents = events.filter((e) => e.event_type === 'llm')
    const grouped: Record<string, AgentSummary> = {}
    for (const e of agentEvents) {
      const key = `${e.run_id}::${e.agent_name}`
      grouped[key] = {
        agentName: e.agent_name,
        runId: e.run_id,
        inputText: e.input_text,
        outputText: e.output_text,
        llmCalls: 0,
        totalTokens: 0,
        totalCost: 0,
      }
    }
    for (const e of llmEvents) {
      const key = `${e.run_id}::${e.agent_name}`
      if (grouped[key]) {
        grouped[key].llmCalls++
        grouped[key].totalTokens += (e.prompt_tokens || 0) + (e.completion_tokens || 0)
        grouped[key].totalCost += (e.cost || 0)
      }
    }
    return Object.values(grouped)
  }, [events])

  const toolSummaries = useMemo(() => {
    const toolEvents = events.filter((e) => e.event_type === 'tool')
    const grouped: Record<string, ToolSummary> = {}
    for (const e of toolEvents) {
      const toolName = (e.input_text.split('\n')[0] || '').replace('Tool: ', '').trim() || e.task_name || 'Unknown Tool'
      const key = `${e.run_id}::${toolName}`
      grouped[key] = {
        toolName,
        agentName: e.agent_name,
        runId: e.run_id,
        inputText: e.input_text,
        outputText: e.output_text,
      }
    }
    return Object.values(grouped)
  }, [events])

  const kpis = useMemo(() => {
    const uniqueRuns = new Set(events.map((e) => e.run_id))
    const uniqueAgents = new Set(events.filter((e) => e.event_type === 'agent').map((e) => e.agent_name))
    const uniqueTools = new Set(
      events.filter((e) => e.event_type === 'tool').map((e) => {
        const line = e.input_text.split('\n')[0] || ''
        return line.replace('Tool: ', '').trim() || e.task_name || 'Unknown'
      })
    )
    const totalTokens = events.reduce(
      (sum, e) => sum + (e.prompt_tokens || 0) + (e.completion_tokens || 0), 0,
    )
    const totalCost = events.reduce((sum, e) => sum + (e.cost || 0), 0)
    return {
      totalRuns: uniqueRuns.size,
      agentsUsed: uniqueAgents.size,
      toolsUsed: uniqueTools.size,
      llmCalls: events.filter((e) => e.event_type === 'llm').length,
      totalTokens,
      totalCost,
    }
  }, [events])

  const formatTime = (ts: string) => {
    try { return new Date(ts).toLocaleString() } catch { return ts }
  }

  const handleExport = () => {
    const rows = filteredEvents.map((e) => ({
      run_id: e.run_id,
      event_type: e.event_type,
      agent_name: e.agent_name,
      task_name: e.task_name || '',
      input_text: e.input_text,
      output_text: e.output_text,
      timestamp_utc: e.timestamp_utc,
      prompt_tokens: e.prompt_tokens || '',
      completion_tokens: e.completion_tokens || '',
      cost: e.cost || '',
    }))
    const headers = Object.keys(rows[0] || {})
    const csv = [
      headers.join(','),
      ...rows.map((r) => headers.map((h) => `"${String(r[h as keyof typeof r] ?? '').replace(/"/g, '""')}"`).join(',')),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `agent-audit-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-6 overflow-y-auto pb-8 scrollbar-thin scrollbar-thumb-slate-300">
      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4 shrink-0">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">Total Runs</span>
            <Layers className="w-4 h-4 text-slate-400" />
          </div>
          <span className="text-2xl font-black text-slate-900">{kpis.totalRuns}</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">Agents Used</span>
            <Bot className="w-4 h-4 text-blue-500" />
          </div>
          <span className="text-2xl font-black text-blue-600">{kpis.agentsUsed}</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">Tools Used</span>
            <Wrench className="w-4 h-4 text-amber-500" />
          </div>
          <span className="text-2xl font-black text-amber-600">{kpis.toolsUsed}</span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="shrink-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <select
                value={filterType}
                onChange={(e) => { setFilterType(e.target.value); setOffset(0) }}
                className="appearance-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
              >
                <option value="">All Event Types</option>
                <option value="agent">Agent</option>
                <option value="tool">Tool</option>
                <option value="llm">LLM</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setOffset(0) }}
                placeholder="Search events..."
                className="rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none w-48"
              />
            </div>
            <button
              onClick={() => loadEvents(true)}
              disabled={isLoading}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button
              onClick={handleExport}
              disabled={filteredEvents.length === 0}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> Export CSV
            </button>
          </div>
          <span className="text-xs font-medium text-slate-400">
            {filteredEvents.length} events across {runs.length} runs
          </span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">{error}</div>
      )}

      {/* Run Groups */}
      <div className="flex flex-col gap-6">
        {runs.length === 0 && !isLoading && (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <Brain className="mx-auto mb-3 h-8 w-8 text-slate-300" />
            <p className="text-sm font-medium text-slate-500">
              No agent audit events yet. Run the Travel Planner Agent to see data here.
            </p>
          </div>
        )}

        {runs.map(([runId, runEvents], idx) => {
          const runAgentSummaries = agentSummaries.filter((s) => s.runId === runId)
          const runToolSummaries = toolSummaries.filter((s) => s.runId === runId)
          const lastTs = runEvents[runEvents.length - 1]?.timestamp_utc || runEvents[0]?.timestamp_utc || ''
          const isExpanded = expandedRuns.has(runId)
          const sessionNumber = idx + 1

          return (
            <div key={runId} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              {/* Run Header */}
              <div className="bg-slate-50/50 px-5 py-4 flex items-center justify-between border-b border-slate-100 hover:bg-slate-100/50 transition-colors cursor-pointer"
                onClick={() => toggleRunExpanded(runId)}
              >
                <div className="flex items-center gap-4 flex-wrap flex-1">
                  {/* Expand Arrow */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleRunExpanded(runId)
                    }}
                    className="flex-shrink-0 hover:bg-slate-200 rounded-lg p-1 transition-colors"
                  >
                    <ChevronRight
                      className={`h-5 w-5 text-slate-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    />
                  </button>

                  {/* Session Info */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-bold text-slate-900">
                      Session {sessionNumber}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      ({runId.slice(0, 8).toUpperCase()})
                    </span>
                    <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-bold text-blue-700 flex items-center gap-1">
                      <Bot className="h-3 w-3" />
                      {runAgentSummaries.length} agent{runAgentSummaries.length !== 1 ? 's' : ''}
                    </span>
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-700 flex items-center gap-1">
                      <Wrench className="h-3 w-3" />
                      {runToolSummaries.length} tool{runToolSummaries.length !== 1 ? 's' : ''}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium text-slate-600">
                      {runEvents[0]?.source_app}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-slate-400 ml-4 flex-shrink-0 whitespace-nowrap">{formatTime(lastTs)}</span>
              </div>

              {/* Expanded Content */}
              {isExpanded && (
                <>
                  {/* Agent Summary Cards */}
                  {runAgentSummaries.length > 0 && (
                    <div className="p-5 border-b border-slate-100 bg-white">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                        <Bot className="h-4 w-4" />
                        Agents ({runAgentSummaries.length})
                      </h3>
                      <div className="grid grid-cols-1 gap-4">
                        {runAgentSummaries.map((agent) => (
                          <div key={`${agent.runId}::${agent.agentName}`} className="rounded-lg border border-blue-100 bg-blue-50/30 p-4">
                            <div className="flex items-center gap-2 mb-3">
                              <Bot className="h-4 w-4 text-blue-500" />
                              <span className="text-sm font-bold text-slate-900">{agent.agentName}</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Input</span>
                                <div className="mt-1 rounded-lg bg-white border border-slate-200 p-3 text-sm text-slate-700 max-h-40 overflow-y-auto prose prose-sm prose-slate max-w-none">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{truncateWords(agent.inputText, 150)}</ReactMarkdown>
                                </div>
                              </div>
                              <div>
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Output</span>
                                <div className="mt-1 rounded-lg bg-white border border-slate-200 p-3 text-sm text-slate-700 max-h-40 overflow-y-auto prose prose-sm prose-slate max-w-none">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{truncateWords(agent.outputText, 150)}</ReactMarkdown>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tool Summary Cards */}
                  {runToolSummaries.length > 0 && (
                    <div className="p-5 border-b border-slate-100 bg-white">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                        <Wrench className="h-4 w-4" />
                        Tools ({runToolSummaries.length})
                      </h3>
                      <div className="grid grid-cols-1 gap-4">
                        {runToolSummaries.map((tool) => (
                          <div key={`${tool.runId}::${tool.toolName}`} className="rounded-lg border border-amber-100 bg-amber-50/30 p-4">
                            <div className="flex items-center gap-2 mb-1">
                              <Wrench className="h-4 w-4 text-amber-500" />
                              <span className="text-sm font-bold text-slate-900">{tool.toolName}</span>
                            </div>
                            <span className="text-[10px] text-slate-400 ml-6">Used by {tool.agentName}</span>
                            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Input</span>
                                <div className="mt-1 rounded-lg bg-white border border-slate-200 p-3 text-sm text-slate-700 max-h-40 overflow-y-auto prose prose-sm prose-slate max-w-none">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{truncateWords(tool.inputText, 150)}</ReactMarkdown>
                                </div>
                              </div>
                              <div>
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Output</span>
                                <div className="mt-1 rounded-lg bg-white border border-slate-200 p-3 text-sm text-slate-700 max-h-40 overflow-y-auto prose prose-sm prose-slate max-w-none">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{truncateWords(tool.outputText, 150)}</ReactMarkdown>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* Load More */}
      {hasMore && events.length > 0 && (
        <div className="flex justify-center">
          <button
            onClick={() => loadEvents(false)}
            disabled={isLoading}
            className="rounded-lg border border-slate-200 bg-white px-6 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            {isLoading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}
    </div>
  )
}
