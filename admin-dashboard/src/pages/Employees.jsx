import { useState } from 'react'
import { useApiData } from '../hooks/useApiData'
import { employeesApi, clientsApi } from '../services/api'
import PageHeader from '../components/ui/PageHeader'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import CalendarConnectModal from '../components/auth/CalendarConnectModal'

export default function Employees() {
  const { data, loading }         = useApiData(employeesApi.getAll)
  const { data: clientsData }     = useApiData(clientsApi.getAll)
  const [calOpen, setCalOpen]     = useState(false)

  const employees = data?.employees || []
  const clients   = clientsData?.clients || []

  return (
    <div>
      <PageHeader
        title="👥 Employees / Calendars"
        subtitle={`${employees.length} connected Google account${employees.length !== 1 ? 's' : ''}`}
      />

      {/* Calendar connect banner */}
      <div className="flex items-start gap-4 bg-gradient-to-br from-blue-50 to-orange-50 border border-blue-200 rounded-xl p-4 mb-6">
        <span className="text-3xl flex-shrink-0">📅</span>
        <div className="flex-1 min-w-0">
          <strong className="text-gray-900 block mb-1">Connect a Google Calendar</strong>
          <p className="text-sm text-gray-600 leading-relaxed">
            Each client needs their Google Calendar connected so the bot can read free slots and offer
            appointment booking. Use the button on each client row in the Clients tab, or connect
            directly below.
          </p>
        </div>
        <Button variant="primary" size="sm" className="flex-shrink-0" onClick={() => setCalOpen(true)}>
          Connect Calendar
        </Button>
      </div>

      {loading
        ? <div className="flex justify-center py-16"><Spinner /></div>
        : employees.length === 0
          ? <EmptyState icon="👥" message='No calendars connected yet. Use the "📅 Calendar" button on a client row to connect their Google Calendar.' />
          : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <tr>
                      {['Name', 'Email', 'Calendar', 'Connected'].map(h => (
                        <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {employees.map(e => {
                      const email = e.email
                        ? e.email.slice(0, 7) + '****' + e.email.slice(-4)
                        : 'N/A'
                      return (
                        <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                {(e.name || e.email || '?')[0].toUpperCase()}
                              </div>
                              <span className="font-medium text-gray-900">{e.name || '—'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{email}</td>
                          <td className="px-4 py-3"><Badge variant="green">Connected</Badge></td>
                          <td className="px-4 py-3 text-gray-400 text-xs">
                            {new Date(e.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
      }

      <CalendarConnectModal
        open={calOpen}
        onClose={() => setCalOpen(false)}
        clients={clients}
      />
    </div>
  )
}
