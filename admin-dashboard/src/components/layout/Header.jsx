import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import Button from '../ui/Button'
import ChangePasswordModal from '../auth/ChangePasswordModal'

export default function Header({ onMenuClick }) {
  const { user, logout, isClient } = useAuth()
  const [showCP, setShowCP] = useState(false)

  return (
    <>
      <header className="h-16 bg-white border-b border-gray-200 px-4 flex items-center gap-3 flex-shrink-0">
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

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex flex-col items-end mr-1">
            <span className="text-sm font-medium text-gray-700 leading-none">{user?.name || 'User'}</span>
            <span className="text-xs text-gray-400 capitalize">{user?.role}</span>
          </div>

          <div className="w-8 h-8 rounded-full bg-brand-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
            {(user?.name || user?.email || '?')[0].toUpperCase()}
          </div>

          {isClient && (
            <Button variant="ghost" size="sm" onClick={() => setShowCP(true)}>
              🔑
            </Button>
          )}

          <Button variant="secondary" size="sm" onClick={logout}>
            Logout
          </Button>
        </div>
      </header>

      <ChangePasswordModal open={showCP} onClose={() => setShowCP(false)} />
    </>
  )
}
