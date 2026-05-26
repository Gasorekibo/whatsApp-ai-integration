import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useApiData } from '../hooks/useApiData'
import { servicesApi, clientsApi } from '../services/api'
import PageHeader from '../components/ui/PageHeader'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import SyncModal from '../components/services/SyncModal'

export default function Services() {
  const { user, isClient, isAdmin } = useAuth()
  const [selectedClient, setSelectedClient] = useState(isClient ? user.tenantId : '')
  const [syncOpen, setSyncOpen] = useState(false)

  const { data: clientsData } = useApiData(clientsApi.getAll)
  const { data, loading, refetch } = useApiData(() => servicesApi.getAll())

  const clients  = clientsData?.clients || []
  const services = data || []

  const allServices = services.flatMap(doc =>
    (doc.services || []).map(s => ({ ...s, _doc: doc }))
  )

  return (
    <div>
      <PageHeader
        title="⚙️ Services"
        subtitle={`${allServices.length} service${allServices.length !== 1 ? 's' : ''}`}
        actions={
          <Button variant="success" onClick={() => { setSyncOpen(true) }}>🔄 Sync</Button>
        }
      />

      {isAdmin && clients.length > 0 && (
        <div className="mb-4">
          <select
            value={selectedClient}
            onChange={e => setSelectedClient(e.target.value)}
            className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none bg-white"
          >
            <option value="">— All Clients —</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {loading
        ? <div className="flex justify-center py-16"><Spinner /></div>
        : allServices.length === 0
          ? (
            <EmptyState
              icon="⚙️"
              message="No services synced yet. Use the Sync button to import from your knowledge base."
            />
          )
          : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {allServices.map((s, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-semibold text-gray-900 text-sm leading-snug">{s.name || s.title || `Service ${i + 1}`}</h3>
                    <Badge variant={s.active ? 'green' : 'gray'}>{s.active ? 'Active' : 'Inactive'}</Badge>
                  </div>
                  {s.description && <p className="text-xs text-gray-500 line-clamp-2">{s.description}</p>}
                  {s.price && <p className="text-sm font-medium text-brand-600 mt-2">{s.price}</p>}
                </div>
              ))}
            </div>
          )
      }

      <SyncModal
        open={syncOpen}
        onClose={() => { setSyncOpen(false); refetch() }}
      />
    </div>
  )
}
