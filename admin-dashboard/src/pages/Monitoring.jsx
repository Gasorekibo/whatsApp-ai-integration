import { useState, useEffect, useRef, useCallback } from 'react'
import { monitoringApi } from '../services/api'
import PageHeader from '../components/ui/PageHeader'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'

const LOG_CATS = [
  { id: 'combined', label: '📋 All' },
  { id: 'whatsapp', label: '💬 WhatsApp' },
  { id: 'payment',  label: '💳 Payments' },
  { id: 'error',    label: '🚨 Errors' },
  { id: 'api-calls',label: '🤖 AI Calls' },
]

const LEVEL_COLORS = {
  error: 'text-red-400',
  warn:  'text-yellow-400',
  info:  'text-blue-300',
  debug: 'text-gray-400',
}

function fmtUptime(seconds) {
  if (!seconds && seconds !== 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function HealthCard({ icon, label, value, sub, status }) {
  const border = status === 'ok' ? 'border-green-400' : status === 'warn' ? 'border-orange-400' : status === 'error' ? 'border-red-400' : 'border-gray-200'
  return (
    <div className={`bg-white rounded-xl border-2 ${border} p-5 shadow-sm flex flex-col gap-1`}>
      <div className="text-2xl">{icon}</div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</div>
      <div className="text-2xl font-bold text-gray-800 leading-tight">{value ?? '—'}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  )
}

function StatMini({ label, value, color }) {
  const c = color === 'purple' ? 'text-purple-600' : color === 'green' ? 'text-green-600' : color === 'orange' ? 'text-orange-500' : 'text-gray-800'
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <div className="text-xs text-gray-500 font-medium mb-1">{label}</div>
      <div className={`text-xl font-bold ${c}`}>{value ?? '—'}</div>
    </div>
  )
}

function LogEntry({ entry }) {
  const [expanded, setExpanded] = useState(false)
  const level = entry.level || 'info'
  const msg   = entry.message || ''
  const ts    = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''
  const hasMeta = entry.metadata && Object.keys(entry.metadata).length > 0

  return (
    <div
      className={`border-b border-gray-800 cursor-pointer transition-colors ${expanded ? 'bg-gray-800' : 'hover:bg-gray-800'}`}
      onClick={() => hasMeta && setExpanded(x => !x)}
    >
      <div className="grid gap-0 px-3 py-1.5 leading-relaxed" style={{ gridTemplateColumns: '140px 56px 1fr' }}>
        <span className="text-gray-500 text-xs whitespace-nowrap pt-px">{ts}</span>
        <span className={`text-[10px] font-bold uppercase whitespace-nowrap pt-px ${LEVEL_COLORS[level] || 'text-gray-400'}`}>[{level}]</span>
        <span className="text-gray-300 text-xs break-all">{msg}</span>
      </div>
      {expanded && hasMeta && (
        <div className="px-3 pb-2 border-t border-gray-700">
          <pre className="text-[10px] text-gray-400 whitespace-pre-wrap overflow-auto max-h-40 mt-2">
            {JSON.stringify(entry.metadata, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

export default function Monitoring() {
  const [health,      setHealth]      = useState(null)
  const [hLoading,    setHLoading]    = useState(true)
  const [lastRefresh, setLastRefresh] = useState('')
  const [logs,        setLogs]        = useState([])
  const [lLoading,    setLLoading]    = useState(false)
  const [category,    setCategory]    = useState('combined')
  const [level,       setLevel]       = useState('')
  const [search,      setSearch]      = useState('')
  const [limit,       setLimit]       = useState(200)
  const [levelCounts, setLevelCounts] = useState(null)
  const logRef       = useRef(null)
  const searchTimer  = useRef(null)

  const fetchHealth = useCallback(async () => {
    setHLoading(true)
    try {
      const { data } = await monitoringApi.getHealth()
      setHealth(data)
      setLastRefresh(`Last refreshed at ${new Date().toLocaleTimeString()} · response ${data.responseTime || ''}`)
    } catch (e) {
      setHealth(null)
      setLastRefresh(`⚠️ Failed to load health data: ${e.message}`)
    } finally { setHLoading(false) }
  }, [])

  const fetchLogs = useCallback(async () => {
    setLLoading(true)
    try {
      const { data } = await monitoringApi.getLogs({ category, level, search, limit })
      const entries = Array.isArray(data) ? data : (data.logs || [])
      setLogs(entries)
      setLevelCounts(data.levelCounts || null)
    } catch { setLogs([]) }
    finally { setLLoading(false) }
  }, [category, level, search, limit])

  // Initial load
  useEffect(() => { fetchHealth() }, [fetchHealth])
  useEffect(() => { fetchLogs()  }, [fetchLogs])

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(() => { fetchHealth(); fetchLogs() }, 30_000)
    return () => clearInterval(id)
  }, [fetchHealth, fetchLogs])

  // Debounced search
  const handleSearch = v => {
    setSearch(v)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => fetchLogs(), 400)
  }

  const dbStatus  = health?.database?.status === 'connected'
  const errCount  = health?.logs?.errorsToday ?? 0
  const s         = health?.stats || {}
  const uptimeSec = typeof health?.uptime === 'number' ? health.uptime : null
  const uptimeStr = uptimeSec !== null ? fmtUptime(uptimeSec) : (health?.uptime || '—')

  return (
    <div className="space-y-6">
      <PageHeader
        title="🖥️ System Monitoring"
        actions={
          <div className="flex items-center gap-2">
            {health && (
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                health.status === 'healthy' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                <span className={`w-2 h-2 rounded-full ${health.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
                {health.status === 'healthy' ? '✅ Healthy' : '⚠️ Degraded'}
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={() => { fetchHealth(); fetchLogs() }}>↺ Refresh</Button>
          </div>
        }
      />

      {/* Refresh bar */}
      <div className="flex items-center gap-2 text-xs text-gray-500 -mt-4">
        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <span>{lastRefresh || 'Loading…'}</span>
        <span className="ml-auto text-gray-400">Auto-refreshes every 30s while this tab is open</span>
      </div>

      {/* Health cards */}
      {hLoading
        ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
          </div>
        )
        : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <HealthCard icon="⏱️" label="Uptime"       value={uptimeStr}    status="ok" />
            <HealthCard icon="🗄️" label="Database"     value={dbStatus ? '✅ Connected' : '❌ Down'}
              sub={health?.database?.responseTime || health?.database?.error || ''}
              status={dbStatus ? 'ok' : 'error'} />
            <HealthCard icon="🚨" label="Errors Today"  value={errCount}     status={errCount > 0 ? 'warn' : 'ok'} />
          </div>
        )
      }

      {/* Stats mini grid */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Last 24 Hours</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatMini label="Clients"          value={s.totalClients}     />
          <StatMini label="Active Sessions"  value={s.activeSessions}   color="purple" />
          <StatMini label="Messages"         value={s.totalMessages}    color="green" />
          <StatMini label="Pending Bookings" value={s.pendingBookings}   color="orange" />
          <StatMini label="Confirmed Today"  value={s.confirmedToday}   color="green" />
          <StatMini label="Node.js"          value={health?.process?.nodeVersion} />
        </div>
      </div>

      {/* Log viewer */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Log Viewer</h3>

        {/* Category tabs */}
        <div className="flex gap-1 flex-wrap mb-3">
          {LOG_CATS.map(cat => (
            <button key={cat.id} onClick={() => setCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                category === cat.id ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {cat.label}
            </button>
          ))}
        </div>

        {/* Log toolbar */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select value={level} onChange={e => setLevel(e.target.value)}
            className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 outline-none bg-white focus:ring-2 focus:ring-brand-400">
            <option value="">All Levels</option>
            <option value="error">Error</option>
            <option value="warn">Warn</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>
          <input type="text" value={search} onChange={e => handleSearch(e.target.value)}
            placeholder="Search logs…"
            className="flex-1 min-w-40 max-w-60 text-xs border border-gray-300 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-brand-400" />
          <select value={limit} onChange={e => setLimit(Number(e.target.value))}
            className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 outline-none bg-white focus:ring-2 focus:ring-brand-400">
            <option value={100}>Last 100</option>
            <option value={200}>Last 200</option>
            <option value={500}>Last 500</option>
            <option value={1000}>Last 1000</option>
          </select>
          <Button variant="secondary" size="sm" onClick={fetchLogs}>↺ Reload</Button>
          <Button variant="secondary" size="sm" onClick={() => { setSearch(''); setLevel('') }}>✕ Clear</Button>
        </div>

        {/* Level summary chips */}
        {levelCounts && (
          <div className="flex gap-2 flex-wrap mb-3">
            {Object.entries(levelCounts).map(([lvl, cnt]) => cnt > 0 && (
              <span key={lvl} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                lvl === 'error' ? 'bg-red-100 text-red-700' :
                lvl === 'warn'  ? 'bg-yellow-100 text-yellow-700' :
                lvl === 'info'  ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
              }`}>{lvl.toUpperCase()}: {cnt}</span>
            ))}
          </div>
        )}

        {/* Log list */}
        <div ref={logRef} className="rounded-xl overflow-hidden border border-gray-700 bg-gray-950 h-[520px] overflow-y-auto font-mono text-xs scrollbar-thin">
          {lLoading
            ? <div className="flex items-center justify-center h-full"><Spinner /></div>
            : logs.length === 0
              ? <p className="text-gray-500 text-center p-10">No log entries found. Select a category and click Reload.</p>
              : logs.map((entry, i) => <LogEntry key={i} entry={entry} />)
          }
        </div>
      </div>
    </div>
  )
}
