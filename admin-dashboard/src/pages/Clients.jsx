import { useState } from 'react'
import { useApiData } from '../hooks/useApiData'
import { clientsApi } from '../services/api'
import PageHeader from '../components/ui/PageHeader'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import ClientModal from '../components/clients/ClientModal'
import SyncModal from '../components/services/SyncModal'
import CalendarConnectModal from '../components/auth/CalendarConnectModal'

const PLAN_BADGE = {
  message_only:       { label: 'Msg Only',  v: 'orange' },
  message_and_voice:  { label: 'Voice+Msg', v: 'purple' },
}
const STATUS_BADGE = { active: 'green', trial: 'yellow', expired: 'red', inactive: 'gray' }

export default function Clients() {
  const { data, loading, refetch } = useApiData(clientsApi.getAll)
  const [search, setSearch]   = useState('')
  const [planF,  setPlanF]    = useState('')
  const [statF,  setStatF]    = useState('')
  const [modal,     setModal]     = useState(null) // null | 'create' | client-obj
  const [syncFor,   setSyncFor]   = useState(null) // null | client-obj
  const [calFor,    setCalFor]    = useState(null) // null | clientId string

  const clients = data?.clients || []

  const filtered = clients.filter(c => {
    const q = search.toLowerCase()
    const matchQ = !q || [c.name, c.email, c.phone].some(v => v?.toLowerCase().includes(q))
    const matchP = !planF || c.subscriptionPlan === planF
    const matchS = !statF || c.subscriptionStatus === statF
    return matchQ && matchP && matchS
  })

  return (
    <div>
      <PageHeader
        title="🏢 Clients"
        subtitle={`${clients.length} registered client${clients.length !== 1 ? 's' : ''}`}
        actions={<Button onClick={() => setModal('create')}>+ Register Client</Button>}
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, email, phone, company…"
          className="flex-1 min-w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none"
        />
        <select value={planF} onChange={e => setPlanF(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-brand-400 outline-none">
          <option value="">All Plans</option>
          <option value="message_only">Message Only</option>
          <option value="message_and_voice">Voice + Message</option>
        </select>
        <select value={statF} onChange={e => setStatF(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-brand-400 outline-none">
          <option value="">All Statuses</option>
          <option value="trial">Trial</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {loading
        ? <div className="flex justify-center py-16"><Spinner /></div>
        : filtered.length === 0
          ? <EmptyState icon="🏢" message="No clients found" />
          : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <tr>
                      {['Client','Contact','WA Phone ID','Plan','Status','Ends','Messages','Active','Actions'].map(h => (
                        <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map(c => {
                      const plan   = PLAN_BADGE[c.subscriptionPlan] || { label: c.subscriptionPlan || '—', v: 'gray' }
                      const status = STATUS_BADGE[c.subscriptionStatus] || 'gray'
                      const endDate = c.subscriptionEndDate
                        ? new Date(c.subscriptionEndDate).toLocaleDateString() : '—'
                      const msgDisplay = c.maxMonthlyMessages != null
                        ? `${c.messageCount ?? 0} / ${c.maxMonthlyMessages}`
                        : `${c.messageCount ?? 0} / ∞`
                      const waId = c.whatsappBusinessId
                        ? c.whatsappBusinessId.slice(0, 6) + '****' : '—'

                      return (
                        <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">{c.name}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-gray-700">{c.email}</div>
                            <div className="text-xs text-gray-400">{c.phone}</div>
                          </td>
                          <td className="px-4 py-3">
                            <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{waId}</code>
                          </td>
                          <td className="px-4 py-3"><Badge variant={plan.v}>{plan.label}</Badge></td>
                          <td className="px-4 py-3"><Badge variant={status}>{c.subscriptionStatus || '—'}</Badge></td>
                          <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{endDate}</td>
                          <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{msgDisplay}</td>
                          <td className="px-4 py-3">
                            <Badge variant={c.isActive ? 'green' : 'gray'}>{c.isActive ? 'Yes' : 'No'}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <Button variant="ghost" size="sm" onClick={() => setModal(c)}>Edit</Button>
                              <Button variant="success" size="sm" onClick={() => setSyncFor(c)}>Sync KB</Button>
                              <Button variant="secondary" size="sm" onClick={() => setCalFor(c.id)}>📅 Calendar</Button>
                            </div>
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

      <ClientModal
        open={!!modal}
        client={modal === 'create' ? null : modal}
        onClose={() => setModal(null)}
        onSaved={refetch}
      />

      <SyncModal
        open={!!syncFor}
        onClose={() => setSyncFor(null)}
      />

      <CalendarConnectModal
        open={!!calFor}
        onClose={() => setCalFor(null)}
      />
    </div>
  )
}
