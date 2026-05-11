import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import ChangePasswordModal from '../auth/ChangePasswordModal'

export default function Header({ onMenuClick }) {
  const { user, logout, isClient } = useAuth()
  const [dropOpen, setDropOpen] = useState(false)
  const [showCP,   setShowCP]   = useState(false)
  const dropRef = useRef(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = e => {
      if (dropRef.current && !dropRef.current.contains(e.target)) setDropOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const initials = (user?.name || user?.email || '?')
    .split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  const handleChangePassword = () => {
    setDropOpen(false)
    setShowCP(true)
  }

  const handleLogout = () => {
    setDropOpen(false)
    logout()
  }

  return (
    <>
      <header className="h-16 bg-white border-b border-gray-200 px-4 flex items-center gap-3 flex-shrink-0">
        {/* Hamburger */}
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          aria-label="Open menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="flex-1" />

        {/* Profile button */}
        <div className="relative" ref={dropRef}>
          <button
            onClick={() => setDropOpen(o => !o)}
            className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-gray-100 transition-colors"
          >
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-sm font-medium text-gray-700 leading-none">{user?.name || 'User'}</span>
              <span className="text-xs text-gray-400 capitalize">{user?.role}</span>
            </div>
            <div className="w-8 h-8 rounded-full bg-brand-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
              {initials}
            </div>
            <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${dropOpen ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Dropdown card */}
          {dropOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl border border-gray-200 shadow-lg z-50 py-1 overflow-hidden">
              {/* User info header */}
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-800 truncate">{user?.name || 'User'}</p>
                <p className="text-xs text-gray-400 truncate mt-0.5">{user?.email}</p>
                <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wider bg-brand-50 text-brand-600 px-2 py-0.5 rounded-full">
                  {user?.role}
                </span>
              </div>

              {/* Actions */}
              <div className="py-1">
                {isClient && (
                  <button
                    onClick={handleChangePassword}
                    className="w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <span className="text-base">🔑</span>
                    Change Password
                  </button>
                )}
                <button
                  onClick={handleLogout}
                  className="w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <span className="text-base">🚪</span>
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      <ChangePasswordModal open={showCP} onClose={() => setShowCP(false)} />
    </>
  )
}
