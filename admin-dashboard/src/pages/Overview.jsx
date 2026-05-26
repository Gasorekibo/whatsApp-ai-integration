import { useAuth } from '../context/AuthContext'
import { useApiData } from '../hooks/useApiData'
import { clientsApi, appointmentsApi, servicesApi } from '../services/api'
import StatCard from '../components/ui/StatCard'
import Spinner from '../components/ui/Spinner'
import Badge from '../components/ui/Badge'
import PageHeader from '../components/ui/PageHeader'

const PLAN_LABELS = {
  message_only:      'Message Only',
  message_and_voice: 'Voice + Message',
}

const STATUS_VARIANT = {
  active:   'green',
  trial:    'yellow',
  expired:  'red',
  inactive: 'red',
}

function AdminOverview() {
  const { data: clientsData, loading: lC } = useApiData(clientsApi.getAll)
  const { data: aptsData,    loading: lA } = useApiData(appointmentsApi.getAll)
  const { data: svcData,     loading: lS } = useApiData(servicesApi.getAll)

  const clients      = clientsData?.clients || []
  const appointments = aptsData?.appointments || []
  const services     = svcData || []

  const loading = lC || lA || lS

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>

  const active  = clients.filter(c => c.subscriptionStatus === 'active').length
  const trial   = clients.filter(c => c.subscriptionStatus === 'trial').length
  const expired = clients.filter(c => ['expired', 'inactive'].includes(c.subscriptionStatus)).length
  const voice   = clients.filter(c => c.subscriptionPlan === 'message_and_voice').length

  const recentApts = [...appointments].slice(0, 5)

  return (
    <div className="space-y-8">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon="🏢" label="Total Clients"  value={clients.length}      iconBg="bg-blue-50" />
        <StatCard icon="📅" label="Appointments"   value={appointments.length} iconBg="bg-purple-50" />
        <StatCard icon="⚙️" label="Services"       value={services.length}     iconBg="bg-green-50" />
        <StatCard icon="🎙️" label="Voice Clients"  value={voice}               iconBg="bg-orange-50" />
      </div>

      {/* Subscription Breakdown */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Subscription Breakdown</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Active',   value: active,               color: 'text-green-600'  },
            { label: 'Trial',    value: trial,                color: 'text-yellow-600' },
            { label: 'Expired',  value: expired,              color: 'text-red-500'    },
            { label: 'Voice',    value: voice,                color: 'text-brand-600'  },
          ].map(item => (
            <div key={item.label} className="text-center p-3 bg-gray-50 rounded-lg">
              <p className={`text-3xl font-bold ${item.color}`}>{item.value}</p>
              <p className="text-xs text-gray-500 mt-1">{item.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Appointments */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Recent Appointments</h3>
        </div>
        {recentApts.length === 0
          ? <p className="text-sm text-gray-400 text-center py-10">No appointments yet</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    {['Service', 'Customer', 'Payment', 'Amount', 'Date'].map(h => (
                      <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recentApts.map(a => (
                    <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{a.service || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{a.name || '—'}</td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANT[a.paymentStatus] || 'gray'}>{a.paymentStatus || '—'}</Badge>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{a.amount ? `${Number(a.amount).toLocaleString()} RWF` : '—'}</td>
                      <td className="px-4 py-3 text-gray-400">{new Date(a.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </div>
    </div>
  )
}

function ClientOverview() {
  const { user } = useAuth()
  const { data: clientsData, loading: lC } = useApiData(clientsApi.getAll)
  const { data: aptsData,    loading: lA } = useApiData(appointmentsApi.getAll)
  const { data: svcData,     loading: lS } = useApiData(() => servicesApi.getAll())

  const me           = clientsData?.clients?.[0]
  const appointments = aptsData?.appointments || []
  const services     = svcData || []
  const loading      = lC || lA || lS

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>

  const planLabel   = PLAN_LABELS[me?.subscriptionPlan] || me?.subscriptionPlan || '—'
  const statusLabel = me?.subscriptionStatus || '—'
  const initials    = (me?.name || user?.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="space-y-6">
      {/* Profile Banner */}
      <div className="bg-gradient-to-r from-brand-500 to-brand-700 rounded-2xl p-6 text-white flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-white/20 border-2 border-white/30 flex items-center justify-center text-2xl font-bold flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold leading-tight">{me?.name || user?.name}</h2>
          <p className="text-brand-100 text-sm mt-0.5">{me?.email || user?.email}</p>
        </div>
        <span className="bg-white/20 border border-white/30 rounded-full px-4 py-1.5 text-sm font-semibold whitespace-nowrap">
          {planLabel}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon="📋" label="Plan"         value={planLabel}           iconBg="bg-orange-50" />
        <StatCard icon={me?.subscriptionStatus === 'active' ? '✅' : '⏳'} label="Status" value={statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)} iconBg="bg-green-50" />
        <StatCard icon="⚙️" label="Services"     value={services.length}     iconBg="bg-blue-50" />
        <StatCard icon="📅" label="Appointments" value={appointments.length} iconBg="bg-purple-50" />
      </div>

      {/* Recent Appointments */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Recent Appointments</h3>
        </div>
        {appointments.length === 0
          ? <p className="text-sm text-gray-400 text-center py-10">No appointments yet</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    {['Service', 'Customer', 'Payment', 'Amount', 'Date'].map(h => (
                      <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {appointments.slice(0, 5).map(a => (
                    <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{a.service || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{a.name || '—'}</td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANT[a.paymentStatus] || 'gray'}>{a.paymentStatus}</Badge>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{a.amount ? `${Number(a.amount).toLocaleString()} RWF` : '—'}</td>
                      <td className="px-4 py-3 text-gray-400">{new Date(a.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </div>
    </div>
  )
}

export default function Overview() {
  const { isAdmin } = useAuth()
  return (
    <div>
      <PageHeader title={isAdmin ? '📊 Overview' : '👋 Dashboard'} />
      {isAdmin ? <AdminOverview /> : <ClientOverview />}
    </div>
  )
}
