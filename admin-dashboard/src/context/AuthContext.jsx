import { createContext, useContext, useState, useEffect } from 'react'
import { authApi } from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('authToken')
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        if (payload.exp > Date.now() / 1000) {
          setUser({ token, role: payload.role, tenantId: payload.tenantId, name: payload.name, email: payload.email })
        } else {
          localStorage.removeItem('authToken')
        }
      } catch {
        localStorage.removeItem('authToken')
      }
    }
    setLoading(false)
  }, [])

  const login = async (email, password) => {
    const { data } = await authApi.login(email, password)
    localStorage.setItem('authToken', data.token)
    const payload = JSON.parse(atob(data.token.split('.')[1]))
    const u = { token: data.token, role: payload.role, tenantId: payload.tenantId, name: payload.name, email: payload.email }
    setUser(u)
    return u
  }

  const logout = () => {
    localStorage.removeItem('authToken')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{
      user,
      login,
      logout,
      loading,
      isAdmin:  user?.role === 'admin',
      isClient: user?.role === 'client',
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
