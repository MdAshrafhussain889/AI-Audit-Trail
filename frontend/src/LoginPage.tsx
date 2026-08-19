import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowRight,
  Award,
  ChevronDown,
  CircleCheck,
  Database,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  MessageSquare,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  User,
  UserCheck,
  UsersRound
} from 'lucide-react'
import { useAuth } from './AuthContext'
import { API_BASE_URL } from './config'

type Mode = 'login' | 'register'

const fadeUp = { hidden: { opacity: 0, y: 15 }, visible: { opacity: 1, y: 0 } }
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.1 }
  }
}

// Enterprise Timeline - Compact Fit Version
function LifecycleGraphic() {
  const [activeStep, setActiveStep] = useState(0)

  const steps = [
    { id: 'request', title: 'AI Request', desc: 'Employee submits a prompt', icon: MessageSquare },
    { id: 'response', title: 'AI Response', desc: 'Enterprise AI generates a response', icon: Sparkles },
    { id: 'policy', title: 'Policy Validation', desc: 'Security and compliance policies are checked', icon: ShieldAlert },
    { id: 'crypto', title: 'Cryptographic Verification', desc: 'SHA-256 hash is generated and verified', icon: LockKeyhole },
    { id: 'audit', title: 'Immutable Audit Record', desc: 'Decision is permanently recorded', icon: Database },
    { id: 'review', title: 'Human Approval', desc: 'Reviewer approves or flags the decision', icon: UserCheck },
    { id: 'cert', title: 'Compliance Certificate', desc: 'Evidence is available for audit and export', icon: Award },
  ]

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % steps.length)
    }, 600)
    return () => clearInterval(timer)
  }, [steps.length])

  return (
    <div className="relative flex flex-col gap-3 w-full max-w-md">
      {/* Background track line */}
      <div className="absolute left-[19px] top-4 bottom-4 w-0.5 bg-slate-800 rounded-full" aria-hidden="true" />

      {/* Animated active progress line */}
      <div className="absolute left-[19px] top-4 bottom-4 w-0.5 rounded-full" aria-hidden="true">
        <motion.div
          className="w-full bg-gradient-to-b from-blue-500 to-emerald-400 rounded-full"
          animate={{ height: `${(activeStep / (steps.length - 1)) * 100}%` }}
          transition={{ ease: 'easeOut', duration: 0.45 }}
        />
      </div>

      {steps.map((step, i) => {
        const isActive = i === activeStep
        const isPast = i <= activeStep
        const Icon = step.icon

        return (
          <div key={step.id} className="relative flex items-center gap-4 z-10">
            {/* Circular Icon (Scaled down to 40px) */}
            <motion.div
              className={`flex items-center justify-center w-10 h-10 rounded-full border-2 bg-slate-950 shrink-0 ${
                isActive
                  ? 'border-emerald-400 text-emerald-400 shadow-[0_0_16px_rgba(16,185,129,0.3)]'
                  : isPast
                  ? 'border-blue-500 text-blue-500'
                  : 'border-slate-700 text-slate-500'
              }`}
              animate={{ scale: isActive ? 1.05 : 1 }}
              transition={{ ease: [0.22, 0.61, 0.36, 1], duration: 0.3 }}
            >
              <Icon size={16} strokeWidth={isActive ? 2.5 : 2} />
            </motion.div>

            {/* Text Content */}
            <div className={`flex flex-col transition-opacity duration-300 ${isPast ? 'opacity-100' : 'opacity-40'}`}>
              <h3 className={`text-[14px] font-semibold tracking-wide flex items-center gap-2 ${
                isActive ? 'text-emerald-400' : isPast ? 'text-slate-100' : 'text-slate-400'
              }`}>
                <span className={`text-[9px] font-bold border rounded-full w-3.5 h-3.5 inline-flex items-center justify-center shrink-0 ${
                  isActive ? 'border-emerald-400/50' : isPast ? 'border-blue-500/50' : 'border-slate-600'
                }`}>
                  {i + 1}
                </span>
                {step.title}
              </h3>
              <p className="text-[11px] text-slate-400 leading-snug mt-0.5">
                {step.desc}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FloatingLabelField({ id, label, icon: Icon, children }: { id: string; label: string; icon: typeof Mail; children: React.ReactNode }) {
  return (
    <div className="field-shell group relative">
      <Icon className="field-icon absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500" size={18} strokeWidth={1.8} aria-hidden="true" />
      {children}
      <label htmlFor={id} className="absolute left-11 transition-all text-slate-400 text-sm">{label}</label>
    </div>
  )
}

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState('analyst')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const { login } = useAuth()

  const switchMode = (next: Mode) => {
    setMode(next)
    setError('')
    setShowPassword(false)
    if (next === 'register') setSuccess('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setSuccess('')
    try {
      if (mode === 'register') {
        const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: email.trim().toLowerCase(), password, display_name: displayName, role }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.detail || 'Registration failed')
        switchMode('login')
        setSuccess('Workspace initialized. Please authenticate.')
        return
      }
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: email.trim().toLowerCase(), password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Authentication failed')
      login(data.user, data.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="auth-page flex flex-col lg:flex-row w-full max-w-[1700px] mx-auto">
      <div className="aurora aurora-one" aria-hidden="true" />
      <div className="aurora aurora-two" aria-hidden="true" />
      <div className="noise-layer pointer-events-none" aria-hidden="true" />
      <div className="spotlight" aria-hidden="true" />

      {/* Hero Section */}
      <aside className="auth-hero flex-1 relative hidden lg:flex flex-col justify-center p-8 xl:p-12" aria-labelledby="hero-title">
        <motion.article className="hero-content z-10 w-full max-w-2xl" initial="hidden" animate="visible" variants={containerVariants}>
          <motion.header variants={fadeUp} transition={{ duration: 0.45, ease: 'easeOut' }} className="mb-6">
            <div className="hero-brand inline-flex items-center gap-2 mb-4">
              <span className="brand-symbol p-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-400"><Shield size={18} /></span>
              <span className="font-semibold tracking-widest text-[10px] uppercase text-slate-300">AI AUDIT TRAIL</span>
            </div>

            <h1 id="hero-title" className="hero-title text-white font-bold mb-2">
              Trust Every <br />AI Decision.
            </h1>
            <p className="hero-subtitle text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-emerald-400 to-emerald-200">
              From AI Response to Trusted Evidence.
            </p>
          </motion.header>

          <motion.div variants={fadeUp}>
            <LifecycleGraphic />
          </motion.div>
        </motion.article>
      </aside>

      {/* Auth Section */}
      <section className="auth-stage flex-1 flex flex-col items-center justify-center p-4 lg:p-8 w-full z-10">
        <motion.article
          className="auth-card w-full max-w-[460px] p-6 md:p-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
        >
          <header className="text-center mb-6">
            <div className="inline-flex p-3 bg-blue-500/10 text-blue-400 rounded-2xl mb-4 ring-1 ring-blue-500/20">
              <ShieldCheck size={28} />
            </div>
            <p className="text-[10px] font-bold tracking-widest text-emerald-400 mb-2 uppercase">ENTERPRISE ACCESS</p>
            <h2 className="text-2xl font-semibold text-white mb-2">
              {mode === 'login' ? 'Sign in to Workspace' : 'Create Your AI Audit Account'}
            </h2>
            <p className="text-sm text-slate-400">
              {mode === 'login' ? 'Review, verify, and audit AI decisions securely.' : 'Register to manage, review, and audit enterprise AI activity.'}
            </p>
          </header>

          <nav className="auth-tabs flex relative bg-slate-950/50 p-1 rounded-xl mb-6" role="tablist">
            <motion.div
              className="absolute inset-y-1 bg-slate-800 rounded-lg shadow-md border border-slate-700"
              initial={false}
              animate={{ x: mode === 'login' ? 0 : '100%', width: 'calc(50% - 4px)' }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
            <button className="flex-1 py-2.5 text-sm font-medium z-10" role="tab" aria-selected={mode === 'login'} onClick={() => switchMode('login')}>Sign In</button>
            <button className="flex-1 py-2.5 text-sm font-medium z-10" role="tab" aria-selected={mode === 'register'} onClick={() => switchMode('register')}>Register</button>
          </nav>

          <motion.form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <AnimatePresence mode="popLayout">
              {mode === 'register' && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex flex-col gap-4">
                  <FloatingLabelField id="display-name" label="Display Name" icon={User}>
                    <input className="w-full bg-transparent border border-slate-700 rounded-xl pl-11 pr-4 py-3 text-base text-white peer" id="display-name" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required placeholder=" " autoComplete="name" />
                  </FloatingLabelField>
                  <div className="relative">
                    <label className="sr-only" htmlFor="role">Role</label>
                    <div className="relative field-shell rounded-xl">
                      <UsersRound className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <select className="w-full bg-transparent border border-slate-700 rounded-xl pl-11 pr-10 py-3 text-base text-white appearance-none" id="role" value={role} onChange={(e) => setRole(e.target.value)}>
                        <option className="bg-slate-900" value="analyst">Data Analyst</option>
                        <option className="bg-slate-900" value="compliance_officer">Compliance Officer</option>
                        <option className="bg-slate-900" value="reviewer">Human Reviewer</option>
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <FloatingLabelField id="email" label="Company Email" icon={Mail}>
              <input className="w-full bg-transparent border border-slate-700 rounded-xl pl-11 pr-4 py-3 text-base text-white peer" id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" placeholder=" " />
            </FloatingLabelField>

            <div>
              <div className="flex justify-between items-center mb-1.5 text-xs px-1">
                <span className="sr-only">Password</span>
                {mode === 'login' && <button type="button" className="text-blue-400 hover:text-blue-300 font-medium transition-colors duration-200">Forgot Password?</button>}
              </div>
              <div className="field-shell group relative">
                <LockKeyhole className="field-icon absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} strokeWidth={1.8} />
                <input className="w-full bg-transparent border border-slate-700 rounded-xl pl-11 pr-11 py-3 text-base text-white peer" id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} placeholder=" " />
                <label className="absolute left-11 text-slate-400 transition-all pointer-events-none peer-focus:-top-2.5 peer-focus:text-[11px] peer-focus:bg-slate-900 peer-focus:px-1.5" htmlFor="password">Password</label>
                <button type="button" className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors duration-200" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {success && (
                <motion.p className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <CircleCheck size={16} />{success}
                </motion.p>
              )}
              {error && (
                <motion.p className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 p-3 rounded-xl border border-red-500/20" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <Shield size={16} />{error}
                </motion.p>
              )}
            </AnimatePresence>

            <motion.button
              type="submit" disabled={isLoading}
              className="auth-submit w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3 rounded-xl text-base font-semibold mt-2 disabled:opacity-50"
            >
              {isLoading ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Verifying...</>
              ) : (
                <>{mode === 'login' ? 'Access Workspace' : 'Create Account'} <ArrowRight size={18} /></>
              )}
            </motion.button>
          </motion.form>
        </motion.article>
      </section>
    </main>
  )
}