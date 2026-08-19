import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles, Send, Loader2, CheckCircle2, FileText,
  Plus, MessageSquare, Trash2, Copy, RefreshCw,
  ChevronDown, ArrowDown, StopCircle, AlertTriangle,
  RotateCcw, User, Bot, PanelLeftClose, PanelLeft,
} from 'lucide-react'
import { useAuth } from './AuthContext'
import { API_BASE_URL } from './config'

type Message = {
  id: string
  type: 'user' | 'ai'
  text: string
  responseId?: string
}

type Conversation = {
  id: string
  title: string | null
  created_at: string | null
  updated_at: string | null
  message_count: number
}

const SUGGESTED_PROMPTS = [
  'Explain quantum computing in simple terms',
  'Write a Python function to sort a list',
  'What are the best practices for API security?',
  'Help me draft a professional email',
]

function storageKey(userId: string) {
  return `chat_console_messages_${userId}`
}

function loadMessages(userId: string): Message[] {
  try {
    const raw = sessionStorage.getItem(storageKey(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function formatTime(ts: string | null | undefined) {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function ChatConsole() {
  const { token, user } = useAuth()
  const userId = user?.id ?? 'anonymous'

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>(() => loadMessages(userId))
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  // --- Conversation management ---
  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setConversations(await res.json())
    } catch {}
  }, [token])

  const loadConversationMessages = useCallback(async (convId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/conversations/${convId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data: { role: string; content: string; response_id?: string; created_at?: string }[] = await res.json()
        const msgs: Message[] = data.map((m, i) => ({
          id: `conv-${m.created_at || i}-${m.role}`,
          type: m.role === 'user' ? 'user' : 'ai',
          text: m.content,
          responseId: m.response_id,
        }))
        setMessages(msgs)
      }
    } catch {}
  }, [token])

  const createConversation = useCallback(async (title?: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title }),
      })
      if (res.ok) {
        const conv: Conversation = await res.json()
        setConversations((prev) => [conv, ...prev])
        setActiveConvId(conv.id)
        setMessages([])
        return conv.id
      }
    } catch {}
    return null
  }, [token])

  const deleteConversation = useCallback(async (convId: string) => {
    try {
      await fetch(`${API_BASE_URL}/api/conversations/${convId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      setConversations((prev) => prev.filter((c) => c.id !== convId))
      if (activeConvId === convId) {
        setActiveConvId(null)
        setMessages([])
      }
    } catch {}
  }, [token, activeConvId])

  const saveMessage = useCallback(async (convId: string, role: string, content: string, responseId?: string) => {
    try {
      await fetch(`${API_BASE_URL}/api/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role, content, response_id: responseId }),
      })
    } catch {}
  }, [token])

  useEffect(() => { loadConversations() }, [loadConversations])

  useEffect(() => {
    if (activeConvId && !isLoading) loadConversationMessages(activeConvId)
  }, [activeConvId, loadConversationMessages, isLoading])

  // Persist non-conversation messages
  useEffect(() => {
    if (!activeConvId) sessionStorage.setItem(storageKey(userId), JSON.stringify(messages))
  }, [messages, userId, activeConvId])

  // Scroll management
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const handleScroll = () => {
    const el = messagesContainerRef.current
    if (!el) return
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60)
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // --- Send message with streaming ---
  const handleSendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText || input).trim()
    if (!text || isLoading) return

    setInput('')
    setError('')
    setIsLoading(true)

    let convId = activeConvId
    if (!convId) {
      convId = await createConversation()
      if (!convId) {
        setError('Failed to create conversation')
        setIsLoading(false)
        return
      }
    }

    const userMsg: Message = { id: `msg-${Date.now()}`, type: 'user', text }
    setMessages((prev) => [...prev, userMsg])
    await saveMessage(convId, 'user', text)

    const aiMsgId = `msg-${Date.now()}-ai`
    setMessages((prev) => [...prev, { id: aiMsgId, type: 'ai', text: '' }])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`${API_BASE_URL}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: text, conversation_id: convId }),
        signal: controller.signal,
      })

      if (!res.ok) throw new Error('Failed to get response')

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let fullText = ''
      let responseId = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            if (parsed.token) {
              fullText += parsed.token
              setMessages((prev) =>
                prev.map((m) => m.id === aiMsgId ? { ...m, text: fullText } : m)
              )
            } else if (parsed.response_id) {
              responseId = parsed.response_id
            }
          } catch {}
        }
      }

      setMessages((prev) =>
        prev.map((m) => m.id === aiMsgId ? { ...m, text: fullText, responseId } : m)
      )
      await saveMessage(convId, 'assistant', fullText, responseId)
      loadConversations()
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setMessages((prev) => prev.filter((m) => m.id !== aiMsgId))
      } else {
        // Fallback to non-streaming endpoint
        try {
          const fallback = await fetch(`${API_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ message: text, conversation_id: convId }),
          })
          if (fallback.ok) {
            const data = await fallback.json()
            setMessages((prev) =>
              prev.map((m) => m.id === aiMsgId ? { ...m, text: data.reply, responseId: data.response_id } : m)
            )
            await saveMessage(convId, 'assistant', data.reply, data.response_id)
            loadConversations()
          } else {
            throw new Error('Both streaming and fallback failed')
          }
        } catch {
          setError(err instanceof Error ? err.message : 'Failed to send message')
          setMessages((prev) => prev.filter((m) => m.id !== aiMsgId))
        }
      }
    } finally {
      abortRef.current = null
      setIsLoading(false)
    }
  }, [input, isLoading, activeConvId, token, createConversation, saveMessage, loadConversations])

  const handleStop = () => { abortRef.current?.abort() }

  const handleRegenerate = useCallback(async () => {
    const lastUserMsg = [...messages].reverse().find((m) => m.type === 'user')
    if (!lastUserMsg || isLoading) return
    setMessages((prev) => {
      const lastAiIdx = prev.findLastIndex((m) => m.type === 'ai')
      return lastAiIdx >= 0 ? prev.slice(0, lastAiIdx) : prev
    })
    await handleSendMessage(lastUserMsg.text)
  }, [messages, isLoading, handleSendMessage])

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleNewChat = () => {
    setActiveConvId(null)
    setMessages([])
    setError('')
    sessionStorage.removeItem(storageKey(userId))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  return (
    <div className="flex h-full w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/40">

      {/* Sidebar */}
      <div className={`${showSidebar ? 'w-64' : 'w-0'} shrink-0 transition-all duration-200 overflow-hidden border-r border-slate-200 bg-slate-50 flex flex-col`}>
        <div className="p-3 border-b border-slate-200">
          <button
            onClick={handleNewChat}
            className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Plus className="h-4 w-4" />
            New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`group flex items-center gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors ${
                activeConvId === conv.id
                  ? 'bg-white border border-slate-200 shadow-sm font-semibold text-slate-900'
                  : 'text-slate-600 hover:bg-white/60'
              }`}
              onClick={() => setActiveConvId(conv.id)}
            >
              <MessageSquare className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="truncate flex-1">{conv.title || 'New Chat'}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id) }}
                className="hidden group-hover:block p-0.5 rounded hover:bg-red-50 hover:text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {conversations.length === 0 && (
            <p className="px-3 py-4 text-xs text-slate-400 text-center">No conversations yet</p>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex w-full shrink-0 items-center justify-between border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            >
              {showSidebar ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
            </button>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                {activeConvId ? conversations.find((c) => c.id === activeConvId)?.title || 'Chat' : 'New Chat'}
              </h2>
              <p className="text-[10px] text-slate-500">AI Assistant with audit logging</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              <span className="hidden sm:inline">Audited</span>
            </span>
          </div>
        </header>

        {/* Messages */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto bg-slate-50/50 p-4 sm:p-6"
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col space-y-5">

            {messages.length === 0 && !error && !isLoading && (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex w-full flex-col items-center justify-center text-center py-16"
              >
                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg">
                  <Sparkles className="h-7 w-7" />
                </div>
                <h3 className="text-xl font-semibold text-slate-900">How can I help you today?</h3>
                <p className="mt-2 max-w-md text-sm text-slate-500">
                  Every conversation is audited with cryptographic integrity for compliance.
                </p>
                <div className="mt-6 grid grid-cols-2 gap-2 max-w-lg">
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => { setInput(prompt); textareaRef.current?.focus() }}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-xs text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-700 shadow-sm"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            <AnimatePresence initial={false}>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex w-full gap-3 ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {message.type === 'ai' && (
                    <div className="shrink-0 h-7 w-7 mt-1 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm">
                      <Bot className="h-4 w-4 text-white" />
                    </div>
                  )}

                  <div className={`group relative flex flex-col ${message.type === 'user' ? 'max-w-[80%]' : 'max-w-[85%]'}`}>
                    {message.type === 'user' ? (
                      <div className="rounded-2xl rounded-tr-sm bg-blue-600 px-4 py-2.5 text-white shadow-sm">
                        <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{message.text}</p>
                        {message.id.startsWith('msg-') && (
                          <span className="mt-1 block text-right text-[10px] text-blue-200">
                            {formatTime(message.id.replace('msg-', ''))}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3 shadow-sm">
                        {message.text ? (
                          <div className="prose prose-sm prose-slate max-w-none prose-headings:mt-3 prose-headings:mb-2 prose-p:my-1.5 prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-code:text-pink-600 prose-code:before:content-none prose-code:after:content-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-sm text-slate-400">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Thinking...
                          </div>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    {message.type === 'ai' && message.text && (
                      <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleCopy(message.text, message.id)}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        >
                          {copiedId === message.id ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                          {copiedId === message.id ? 'Copied' : 'Copy'}
                        </button>
                        {message.responseId && (
                          <Link
                            to={`/certificate/${message.responseId}`}
                            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          >
                            <FileText className="h-3 w-3" />
                            Audit
                          </Link>
                        )}
                      </div>
                    )}
                  </div>

                  {message.type === 'user' && (
                    <div className="shrink-0 h-7 w-7 mt-1 rounded-lg bg-slate-200 flex items-center justify-center">
                      <User className="h-4 w-4 text-slate-600" />
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {isLoading && messages.length > 0 && messages[messages.length - 1].type === 'user' && (
              <div className="flex gap-3">
                <div className="shrink-0 h-7 w-7 mt-1 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm">
                  <Bot className="h-4 w-4 text-white" />
                </div>
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                  <span className="text-sm text-slate-500">Thinking...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} className="h-1" />
          </div>
        </div>

        {/* Scroll to bottom */}
        <AnimatePresence>
          {!isAtBottom && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              onClick={scrollToBottom}
              className="absolute bottom-28 left-1/2 -translate-x-1/2 z-20 flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-md hover:bg-slate-50"
            >
              <ArrowDown className="h-3.5 w-3.5" />
              Scroll to bottom
            </motion.button>
          )}
        </AnimatePresence>

        {/* Error */}
        {error && (
          <div className="flex w-full shrink-0 items-center gap-2 border-t border-red-200 bg-red-50 px-4 py-2 text-xs font-medium text-red-600">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="truncate flex-1">{error}</span>
            <button onClick={() => handleSendMessage()} className="shrink-0 flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold text-red-700 hover:bg-red-100">
              <RotateCcw className="h-3 w-3" />
              Retry
            </button>
            <button onClick={() => setError('')} className="shrink-0 text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {/* Input Area */}
        <div className="w-full shrink-0 border-t border-slate-200 bg-white p-3 sm:p-4">
          <div className="mx-auto max-w-3xl relative">
            <div className="relative flex w-full items-end gap-2 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm transition-colors focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-500/10">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                placeholder="Message the AI assistant..."
                className="max-h-40 min-h-[44px] w-full resize-none bg-transparent py-2.5 pl-3 pr-12 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed"
                rows={1}
              />
              <div className="absolute right-1.5 bottom-1.5 flex items-center gap-1">
                {isLoading ? (
                  <button
                    onClick={handleStop}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500 text-white transition-colors hover:bg-red-600"
                    title="Stop generating"
                  >
                    <StopCircle className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => handleSendMessage()}
                    disabled={!input.trim()}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white transition-all hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between px-1">
              <span className="text-[10px] text-slate-400">Audited with SHA-256 integrity</span>
              <span className="hidden sm:inline text-[10px] text-slate-400">
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-slate-500">Shift</kbd> + <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-slate-500">Enter</kbd> for new line
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
