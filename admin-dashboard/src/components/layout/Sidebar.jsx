import { NavLink } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

const NAV = [
  { section: 'Main' },
  { to: '/',            label: 'Overview',     icon: '📊', end: true },
  { to: '/clients',     label: 'Clients',      icon: '🏢', adminOnly: true },
  { section: 'Management' },
  { to: '/users',       label: 'Users',        icon: '💬', adminOnly: true },
  { to: '/services',    label: 'Services',     icon: '⚙️' },
  { to: '/appointments',label: 'Appointments', icon: '📅', adminOnly: true },
  { section: 'Team', adminOnly: true },
  { to: '/employees',   label: 'Employees',    icon: '👥', adminOnly: true },
  { section: 'System', adminOnly: true },
  { to: '/monitoring',  label: 'Monitoring',   icon: '🖥️', adminOnly: true },
]

export default function Sidebar({ open, onClose }) {
  const { isAdmin } = useAuth()

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={onClose} />
      )}

      <aside className={`
        fixed inset-y-0 left-0 z-30 w-64 bg-[#0f172a] flex flex-col
        transition-transform duration-300 ease-in-out
        ${open ? 'translate-x-0' : '-translate-x-full'}
        lg:relative lg:translate-x-0 lg:z-auto
      `}>
        {/* Logo */}
        <div className="px-5 py-7 border-b border-white/10 flex-shrink-0">
          <h2 className="text-white font-bold text-lg leading-tight">Yayah</h2>
          <p className="text-white/60 text-xs mt-0.5">Admin Dashboard</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto scrollbar-thin">
          {NAV.map((item, i) => {
            if (item.section) {
              if (item.adminOnly && !isAdmin) return null
              return (
                <p key={i} className="px-5 pt-5 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40">
                  {item.section}
                </p>
              )
            }
            if (item.adminOnly && !isAdmin) return null
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-5 py-3 text-sm font-medium border-l-[3px] transition-colors
                  ${isActive
                    ? 'border-brand-500 bg-white/5 text-brand-400'
                    : 'border-transparent text-white/70 hover:bg-white/5 hover:text-white'
                  }`
                }
              >
                <span className="text-base w-5 text-center">{item.icon}</span>
                {item.label}
              </NavLink>
            )
          })}
        </nav>

        <div className="px-5 py-3 border-t border-white/10 text-[11px] text-white/30 flex-shrink-0">
          Yayah Admin Dashboard v1.0
        </div>
      </aside>
    </>
  )
}
