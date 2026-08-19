import { useEffect, useState, useCallback } from 'react'
import { useAuth } from './AuthContext'
import { API_BASE_URL } from './config'
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Database, Search, RefreshCw, ShieldAlert, Download } from 'lucide-react'

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
  prev_hash: string
  entry_hash: string
  cost_per_response: number // Added cost field[cite: 1]
}

type DbQueryResponse = {
  entries: AuditEntry[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

const SORTABLE_COLS: { key: string; label: string }[] = [
  { key: 'id', label: 'ID' },
  { key: 'timestamp_utc', label: 'Timestamp' },
  { key: 'source_type', label: 'Source' },
  { key: 'user_display_name', label: 'User' },
  { key: 'ai_system', label: 'AI System' },
  { key: 'model_version', label: 'Model' },
  { key: 'policy_invoked', label: 'Policy' },
  { key: 'response_id', label: 'Response ID' },
  { key: 'cost_per_response', label: 'Cost per Response' }, // Added to sortable columns[cite: 1]
  { key: 'downstream_action', label: 'Action' },
]

export function DatabaseViewer() {
  const { token } = useAuth()
  const [data, setData] = useState<DbQueryResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [perPage] = useState(10)
  const [sortBy, setSortBy] = useState('id')
  const [sortDir, setSortDir] = useState('desc')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [expandedRow, setExpandedRow] = useState<number | null>(null)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        sort_by: sortBy,
        sort_dir: sortDir,
      })
      if (search) params.append('search', search)
      const response = await fetch(`${API_BASE_URL}/api/db/audit-log-entries?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('Failed to load data')
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }, [page, perPage, sortBy, sortDir, search, token])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(key)
      setSortDir('desc')
    }
    setPage(1)
  }

  const handleSearch = () => {
    setSearch(searchInput)
    setPage(1)
  }

  const handleExportCsv = () => {
    if (!data || data.entries.length === 0) return
    const cols = [
      'id', 'response_id', 'timestamp_utc', 'source_type', 'user_id',
      'user_display_name', 'ai_system', 'model_version', 'input_text',
      'input_source', 'policy_invoked', 'reasoning_summary', 'output_text',
      'downstream_action', 'parent_response_id', 'prev_hash', 'entry_hash',
      'cost_per_response', // Added to CSV columns[cite: 1]
    ]
    const escape = (v: unknown) => {
      const s = String(v ?? '')
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s
    }
    const header = cols.join(',')
    const rows = data.entries.map((e) => cols.map((c) => escape((e as Record<string, unknown>)[c])).join(','))
    const csv = [header, ...rows].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-entries-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const formatTimestamp = (ts: string) =>
    new Date(ts).toLocaleString().replace(/\b(am|pm)\b/g, (m) => m.toUpperCase())

  const truncate = (text: string, max = 50) =>
    text.length > max ? text.slice(0, max) + '…' : text

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 overflow-y-auto pb-8 scrollbar-thin scrollbar-thumb-slate-300">
      {/* Header */}
      <div className="shrink-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-blue-600" />
            <h2 className="text-sm font-bold text-slate-900">Database Viewer</h2>
            {data && (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-mono font-medium text-slate-500">
                {data.total} rows
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search records..."
                className="w-48 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
              />
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            </div>
            <button onClick={handleSearch} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
              Search
            </button>
            <button onClick={handleExportCsv} disabled={!data || data.entries.length === 0} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            <button onClick={fetchData} disabled={isLoading} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="shrink-0 rounded-xl border border-red-200 bg-red-50 p-3 flex items-center gap-2 text-xs font-medium text-red-700">
          <ShieldAlert className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        {isLoading && !data ? (
          <div className="flex items-center justify-center py-16 text-sm text-slate-500 font-medium">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading...
          </div>
        ) : data && data.entries.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-sm text-slate-500 font-medium">
            No records found.
          </div>
        ) : data ? (
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 sticky top-0 z-10">
                {SORTABLE_COLS.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="cursor-pointer select-none px-3 py-2.5 font-semibold text-slate-600 hover:text-slate-900 whitespace-nowrap"
                  >
                    <div className="flex items-center gap-1">
                      {col.label}
                      {sortBy === col.key &&
                        (sortDir === 'asc' ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        ))}
                    </div>
                  </th>
                ))}
                <th className="px-3 py-2.5 font-semibold text-slate-600 whitespace-nowrap">Hash</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => {
                const isExpanded = expandedRow === entry.id
                return (
                  <tr
                    key={entry.id}
                    onClick={() => setExpandedRow(isExpanded ? null : entry.id)}
                    className={`border-b border-slate-100 cursor-pointer transition-colors hover:bg-blue-50/40 ${isExpanded ? 'bg-blue-50/60' : ''}`}
                  >
                    <td className="px-3 py-2 font-mono text-slate-400">#{entry.id}</td>
                    <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{formatTimestamp(entry.timestamp_utc)}</td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{entry.source_type}</span>
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-900">{entry.user_display_name}</td>
                    <td className="px-3 py-2 text-slate-700">{entry.ai_system}</td>
                    <td className="px-3 py-2 text-slate-600">{entry.model_version}</td>
                    <td className="px-3 py-2 text-slate-600 max-w-[120px] truncate">{entry.policy_invoked}</td>
                    <td className="px-3 py-2 font-mono text-blue-600 max-w-[100px] truncate">{entry.response_id.slice(0, 12)}</td>
                    <td className="px-3 py-2 font-mono text-slate-800 whitespace-nowrap">
                      {entry.cost_per_response ? `$${Number(entry.cost_per_response).toFixed(6)}` : '$0.000000'}
                    </td>
                    <td className="px-3 py-2 text-slate-600 max-w-[120px] truncate">{truncate(entry.downstream_action, 30)}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-400 max-w-[80px] truncate">{entry.entry_hash.slice(0, 10)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : null}
      </div>

      {/* Pagination */}
      {data && data.total_pages > 1 && (
        <div className="shrink-0 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
          <span className="text-xs text-slate-500 font-medium">
            Page {data.page} of {data.total_pages} ({data.total} total records)
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Previous
            </button>
            <span className="px-2 text-xs font-mono text-slate-500">
              {data.page} / {data.total_pages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))}
              disabled={page >= data.total_pages}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Expanded Row Detail */}
      {data && expandedRow !== null && (
        <div className="shrink-0 rounded-xl border border-blue-200 bg-blue-50/30 p-4 shadow-sm">
          {data.entries
            .filter((e) => e.id === expandedRow)
            .map((entry) => (
              <div key={entry.id} className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3 text-xs">
                <DetailField label="ID" value={`#${entry.id}`} mono />
                <DetailField label="Response ID" value={entry.response_id} mono />
                <DetailField label="Timestamp (UTC)" value={entry.timestamp_utc} mono />
                <DetailField label="Source Type" value={entry.source_type} />
                <DetailField label="User ID" value={entry.user_id} mono />
                <DetailField label="Display Name" value={entry.user_display_name} />
                <DetailField label="AI System" value={entry.ai_system} />
                <DetailField label="Model Version" value={entry.model_version} />
                <DetailField label="Input Source" value={entry.input_source} />
                <DetailField label="Policy Invoked" value={entry.policy_invoked} />
                <DetailField label="Cost per Response" value={entry.cost_per_response ? `$${Number(entry.cost_per_response).toFixed(6)}` : '$0.000000'} mono />
                <DetailField label="Downstream Action" value={entry.downstream_action} />
                <DetailField label="Parent Response ID" value={entry.parent_response_id || '—'} mono />
                <div className="col-span-full flex flex-col gap-1 mt-2">
                  <span className="font-semibold text-slate-500 uppercase tracking-wider">Input Text</span>
                  <div className="rounded-lg bg-white border border-slate-200 p-3 text-slate-800 whitespace-pre-wrap font-medium">{entry.input_text || 'N/A'}</div>
                </div>
                <div className="col-span-full flex flex-col gap-1">
                  <span className="font-semibold text-slate-500 uppercase tracking-wider">Reasoning Summary</span>
                  <div className="rounded-lg bg-white border border-slate-200 p-3 text-slate-800 whitespace-pre-wrap font-medium">{entry.reasoning_summary || 'N/A'}</div>
                </div>
                <div className="col-span-full flex flex-col gap-1">
                  <span className="font-semibold text-slate-500 uppercase tracking-wider">Output Text</span>
                  <div className="rounded-lg bg-white border border-slate-200 p-3 text-slate-800 whitespace-pre-wrap font-medium">{entry.output_text || 'N/A'}</div>
                </div>
                <div className="col-span-full flex flex-col gap-1 mt-2">
                  <span className="font-semibold text-slate-500 uppercase tracking-wider">Previous Hash</span>
                  <span className="font-mono text-[11px] text-slate-500 break-all bg-white p-2 rounded border border-slate-200">{entry.prev_hash}</span>
                </div>
                <div className="col-span-full flex flex-col gap-1">
                  <span className="font-semibold text-slate-500 uppercase tracking-wider">Entry Hash (SHA-256)</span>
                  <span className="font-mono text-[11px] text-slate-500 break-all bg-white p-2 rounded border border-slate-200">{entry.entry_hash}</span>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
      <span className={`text-slate-900 font-medium ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</span>
    </div>
  )
}
