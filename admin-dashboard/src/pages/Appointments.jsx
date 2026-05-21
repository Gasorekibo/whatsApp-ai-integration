import { useState } from 'react'
import { useApiData } from '../hooks/useApiData'
import { appointmentsApi } from '../services/api'
import PageHeader from '../components/ui/PageHeader'
import Badge from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'

const STATUS_VARIANT = { paid: 'green', pending: 'yellow', refunded: 'blue', new: 'gray' }

export default function Appointments() {
  const { data, loading } = useApiData(appointmentsApi.getAll)
  const [search, setSearch] = useState('')

  const all      = data?.appointments || []
  const filtered = all.filter(a =>
    [a.service, a.name, a.email, a.phone].some(v => v?.toLowerCase().includes(search.toLowerCase()))
  )
console.log(" appointments:", filtered)
  return (
    <div>
      <PageHeader
        title="📅 Appointments"
        subtitle={`${all.length} booking${all.length !== 1 ? 's' : ''} on record`}
      />

      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search service, customer, email…"
          className="w-full sm:w-80 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none"
        />
      </div>

      {loading
        ? <div className="flex justify-center py-16"><Spinner /></div>
        : filtered.length === 0
          ? <EmptyState icon="📅" message="No appointments found" />
          : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <tr>
                      {['Service','Client', 'Customer', 'Contact', 'Payment', 'Amount', 'Status', 'Date'].map(h => (
                        <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map(a => (
                      <tr key={a?.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900">{a?.service || '—'}</td>
                        <td className="px-4 py-3">{a?.Client? <Badge variant="orange">{a?.Client?.name}</Badge>:<span className="text-gray-400 text-xs">—</span>}</td>
                        <td className="px-4 py-3 text-gray-700">{a?.name || '—'}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{a?.email || a?.phone || '—'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={STATUS_VARIANT[a?.paymentStatus] || 'gray'}>{a?.paymentStatus || '—'}</Badge>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{a?.amount ? `${Number(a?.amount).toLocaleString()} RWF` : '—'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={a?.status === 'confirmed' ? 'green' : 'gray'}>{a?.status || '—'}</Badge>
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{new Date(a?.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
      }
    </div>
  )
}
