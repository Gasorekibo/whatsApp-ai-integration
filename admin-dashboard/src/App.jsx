import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './context/AuthContext'
import DashboardLayout from './components/layout/DashboardLayout'
import Spinner from './components/ui/Spinner'
import Login from './pages/Login'
import Overview from './pages/Overview'
import Clients from './pages/Clients'
import Users from './pages/Users'
import Appointments from './pages/Appointments'
import Services from './pages/Services'
import Employees from './pages/Employees'
import Monitoring from './pages/Monitoring'
import GeneralInfo from './pages/GeneralInfo'
import Onboarding from './pages/Onboarding'

function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading, isAdmin } = useAuth()
  if (loading) return <div className="flex items-center justify-center min-h-screen"><Spinner size="lg" /></div>
  if (!user)   return <Navigate to="/login" replace />
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />
  return children
}

function AppRoutes() {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center min-h-screen"><Spinner size="lg" /></div>

  return (
    <Routes>
      <Route path="/login" element={!user ? <Login /> : <Navigate to="/" replace />} />

      <Route path="/" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
        <Route index element={<Overview />} />
        <Route path="clients"      element={<ProtectedRoute adminOnly><Clients /></ProtectedRoute>} />
        <Route path="users"        element={<ProtectedRoute adminOnly><Users /></ProtectedRoute>} />
        <Route path="appointments" element={<Appointments />} />
        <Route path="services"      element={<Services />} />
        <Route path="general-info"  element={<GeneralInfo />} />
        <Route path="employees"    element={<ProtectedRoute adminOnly><Employees /></ProtectedRoute>} />
        <Route path="monitoring"   element={<ProtectedRoute adminOnly><Monitoring /></ProtectedRoute>} />
      </Route>

      {/* Public — no auth required, access gated by token */}
      <Route path="/onboarding/:token" element={<Onboarding />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/ai/admin">
        <AppRoutes />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: { borderRadius: '10px', fontSize: '14px' },
            success: { iconTheme: { primary: '#f97316', secondary: '#fff' } },
          }}
        />
      </BrowserRouter>
    </AuthProvider>
  )
}
