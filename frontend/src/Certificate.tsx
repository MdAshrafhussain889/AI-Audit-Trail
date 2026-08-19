import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, Loader2, ShieldAlert } from 'lucide-react'
import { useAuth } from './AuthContext'
import { API_BASE_URL } from './config'

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
  prev_hash: string
  entry_hash: string
}

export function Certificate() {
  const { response_id } = useParams()
  const navigate = useNavigate()
  const [entry, setEntry] = useState<AuditEntry | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string>('')
  const { token, isAuthenticated } = useAuth()

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/')
      return
    }

    const loadEntry = async () => {
      setIsLoading(true)
      setError('')
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/audit-logs/${response_id}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!response.ok) throw new Error('Entry not found')
        const data = await response.json()
        setEntry(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load entry')
      } finally {
        setIsLoading(false)
      }
    }

    loadEntry()
  }, [response_id, token, isAuthenticated, navigate])

  if (isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#F4F7FB] p-8">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm font-medium">Loading official audit record...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#F4F7FB] p-8">
        <div className="flex max-w-md flex-col items-center gap-4 rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <div className="rounded-full bg-red-50 p-3">
            <ShieldAlert className="h-8 w-8 text-red-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Unable to load certificate</h2>
            <p className="mt-1 text-sm text-slate-500">{error}</p>
          </div>
          <button
            onClick={() => navigate('/')}
            className="mt-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
          >
            Back to Audit Trail
          </button>
        </div>
      </div>
    )
  }

  if (!entry) return null

  return (
    <div className="min-h-[100dvh] bg-[#F4F7FB] p-4 py-8 md:p-8 lg:py-12">
      <div className="certificate-document mx-auto w-full max-w-4xl bg-white border border-slate-200 shadow-sm p-6 md:p-12">

        {/* Header */}
        <div className="mb-8 border-b border-slate-100 pb-6">
          <div className="flex items-start gap-4">
            {/* Gold Seal Icon */}
            <svg
              aria-hidden="true"
              className="certificate-seal h-12 w-12 shrink-0 text-[#C8A96A]"
              viewBox="0 0 48 48"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="24" cy="24" r="21" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="24" cy="24" r="16" stroke="currentColor" strokeWidth="1" strokeOpacity="0.4" />
              <path
                d="M17 25l4.5 4.5 10-11"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
                Certificate of Record
              </h1>
              <p className="mt-1 text-sm font-medium text-slate-500">
                Official Record of AI System Activity
              </p>
            </div>
          </div>
          <Link
            to="/"
            className="no-print mt-6 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Audit Trail
          </Link>
        </div>

        {/* Certificate Content */}
        <div className="space-y-6">

          {/* Entry Identity */}
          <div className="rounded-xl border border-slate-200 p-5 md:p-6">
            <h2 className="mb-4 text-sm font-bold text-slate-900">Entry Identity</h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-slate-500">response_id</p>
                <p className="mt-1 break-all font-mono text-sm font-medium text-slate-900">
                  {entry.response_id}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500">Timestamp (UTC)</p>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  {new Date(entry.timestamp_utc).toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          {/* User & System Section */}
          <div className="rounded-xl border border-slate-200 p-5 md:p-6">
            <h2 className="mb-4 text-sm font-bold text-slate-900">User & System</h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-slate-500">User ID</p>
                <p className="mt-1 break-all text-sm font-medium text-slate-900">{entry.user_id}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500">User Display Name</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{entry.user_display_name}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500">AI System</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{entry.ai_system}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500">Model Version</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{entry.model_version}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500">Source Type</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{entry.source_type}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500">Input Source</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{entry.input_source}</p>
              </div>
            </div>
          </div>

          {/* Policy Section */}
          <div className="rounded-xl border border-slate-200 p-5 md:p-6">
            <h2 className="mb-4 text-sm font-bold text-slate-900">
              Policy & Governance
            </h2>
            <div>
              <p className="text-xs font-semibold text-slate-500">Policy Invoked</p>
              <p className="mt-1 text-sm font-medium text-slate-900">{entry.policy_invoked}</p>
            </div>
          </div>

          {/* Content Section */}
          <div className="space-y-4 rounded-xl border border-slate-200 p-5 md:p-6">
            <h2 className="text-sm font-bold text-slate-900">Content</h2>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-500">Input Text</p>
              <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-700">
                {entry.input_text || 'N/A'}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-500">Output Text</p>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-700">
                {entry.output_text ? (
                  <div className="prose prose-sm prose-slate max-w-none prose-p:my-1 prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-code:text-pink-600 prose-code:before:content-none prose-code:after:content-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{truncateWords(entry.output_text, 150)}</ReactMarkdown>
                  </div>
                ) : 'N/A'}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-500">Reasoning Summary</p>
              <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-700">
                {entry.reasoning_summary || 'N/A'}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-500">Downstream Action</p>
              <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-700">
                {entry.downstream_action}
              </div>
            </div>
          </div>

          {/* Integrity Section (Gold Theme) */}
          <div className="space-y-4 rounded-xl border border-[#e8d5aa] border-l-4 border-l-[#C8A96A] bg-[#fdfaf3] p-5 md:p-6">
            <h2 className="text-sm font-bold text-slate-900">
              Integrity Verification
            </h2>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-600">Entry Hash (SHA-256)</p>
              <div className="break-all rounded-lg border border-[#e8d5aa] bg-white p-3 font-mono text-xs text-slate-600">
                {entry.entry_hash}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-600">Previous Hash (SHA-256)</p>
              <div className="break-all rounded-lg border border-[#e8d5aa] bg-white p-3 font-mono text-xs text-slate-600">
                {entry.prev_hash}
              </div>
            </div>

            {entry.parent_response_id && (
              <div>
                <p className="mb-1.5 text-xs font-semibold text-slate-600">Parent response_id</p>
                <div className="break-all font-mono text-xs text-slate-700">
                  {entry.parent_response_id}
                </div>
              </div>
            )}

            <p className="pt-1 text-xs text-slate-500 font-medium">
              This entry is part of an immutable hash chain. Each entry's hash incorporates the
              previous entry's hash, creating a tamper-evident audit trail.
            </p>
          </div>

          {/* Footer */}
          <div className="mt-8 border-t border-slate-200 pt-8 text-center text-slate-500">
            <p className="text-xs font-medium">Generated: {new Date().toLocaleString()} UTC</p>
            <p className="mt-1.5 text-[10px] sm:text-xs">
              This certificate is generated from immutable audit records. Suitable for sharing with
              outside counsel and regulatory bodies.
            </p>
            <button
              onClick={() => window.print()}
              className="no-print mx-auto mt-6 block rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
            >
              Print / Export as PDF
            </button>
          </div>
        </div>
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          body {
            background: white !important;
          }
          .certificate-document {
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
            max-width: 100% !important;
          }
          .no-print {
            display: none !important;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          /* Ensure breaks don't happen inside cards */
          .rounded-xl {
            break-inside: avoid;
          }
        }
      `}</style>
    </div>
  )
}