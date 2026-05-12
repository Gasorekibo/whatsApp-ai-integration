import { useApiData } from '../hooks/useApiData'
import { usersApi } from '../services/api'
import PageHeader from '../components/ui/PageHeader'
import Badge from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'

export default function Users() {
  const { data, loading } = useApiData(usersApi.getAll)
  const users = data?.users || []
  console.log('Fetched users:', users)

  return (
    <div>
      <PageHeader
        title="💬 Users"
        subtitle={`${users.length} WhatsApp session${users.length !== 1 ? 's' : ''}`}
      />

      {loading
        ? <div className="flex justify-center py-16"><Spinner /></div>
        : users.length === 0
          ? <EmptyState icon="💬" message="No user sessions found" />
          : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <tr>
                      {['Name', 'Phone', 'Conversations', 'Client', 'Last Active'].map(h => (
                        <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {users.map(u => (
                      <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900">{u.name || 'N/A'}</td>
                        <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                          {u.phone ? `${u.phone.slice(0, 5)}****${u.phone.slice(-2)}` : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="blue">{u.history?.length || 0} msgs</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {u.client
                            ? <Badge variant="orange">{u.client.company || u.client.name}</Badge>
                            : <span className="text-gray-400 text-xs">—</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {u.lastAccess ? new Date(u.lastAccess).toLocaleString() : '—'}
                        </td>
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
