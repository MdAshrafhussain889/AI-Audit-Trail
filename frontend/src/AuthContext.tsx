import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'

export type User = {
  id: string
  username?: string
  display_name: string
  role: string
}

type AuthContextType = {
  user: User | null
  token: string | null
  login: (user: User, token: string) => void
  logout: () => void
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    const storedToken = sessionStorage.getItem('auth_token')
    const storedUser = sessionStorage.getItem('auth_user')
    if (storedToken && storedUser) {
      setToken(storedToken)
      setUser(JSON.parse(storedUser))
    }
  }, [])

  const login = (newUser: User, newToken: string) => {
    setUser(newUser)
    setToken(newToken)
    sessionStorage.setItem('auth_token', newToken)
    sessionStorage.setItem('auth_user', JSON.stringify(newUser))
  }

  const logout = () => {
    setUser(null)
    setToken(null)
    sessionStorage.removeItem('auth_token')
    sessionStorage.removeItem('auth_user')
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
