import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { kbApi } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import FormField, { Select } from '../ui/FormField'

export default function SyncModal({ open, onClose, clients = [], defaultClientId = '' }) {
  const { user, isClient } = useAuth()
  const [clientId, setClientId] = useState(defaultClientId)
  const [syncing, setSyncing]   = useState(null)

  useEffect(() => { setClientId(defaultClientId) }, [defaultClientId, open]) // 'confluence' | 'sheets' | 'microsoft'
  const [results, setResults]   = useState({})

  const resolvedId = isClient ? user.clientId : (clientId || null)

  const run = async (key, fn) => {
    setSyncing(key)
    try {
      const { data } = await fn(resolvedId)
      setResults(r => ({ ...r, [key]: { ok: true, msg: data.message } }))
      toast.success(`${key.charAt(0).toUpperCase() + key.slice(1)} sync complete`)
    } catch (err) {
      const msg = err.response?.data?.message || err.message
      setResults(r => ({ ...r, [key]: { ok: false, msg } }))
      toast.error(msg)
    } finally { setSyncing(null) }
  }

  const StatusMsg = ({ k }) => results[k] ? (
    <p className={`text-xs mt-1.5 ${results[k].ok ? 'text-green-600' : 'text-red-500'}`}>{results[k].msg}</p>
  ) : null

  return (
    <Modal open={open} onClose={onClose} title="🔄 Sync Knowledge Base" size="lg">
      <div className="space-y-5">
        <p className="text-sm text-gray-500">Pull the latest data from any connected source into the AI knowledge base.</p>

        {!isClient && clients.length > 0 && (
          <FormField label="Sync for Client" required>
            <>
              <Select value={clientId} onChange={e => setClientId(e.target.value)}>
                <option value="">— Select a client —</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ''}</option>
                ))}
              </Select>
              <p className="text-xs text-gray-400 mt-1">Each client has an isolated knowledge base (Pinecone namespace).</p>
            </>
          </FormField>
        )}

        {/* Confluence — featured */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 flex flex-col sm:flex-row gap-4">
          <span className="text-3xl flex-shrink-0">🔵</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-semibold text-gray-900">Confluence</h4>
              <span className="text-[10px] font-bold bg-brand-500 text-white px-2 py-0.5 rounded-full uppercase tracking-wide">Primary</span>
            </div>
            <p className="text-sm text-gray-600 mb-3">Syncs pages from your Confluence space directly into the RAG vector database. All content becomes instantly searchable by the AI.</p>
            <Button
              size="sm" variant="primary"
              loading={syncing === 'confluence'}
              disabled={!!syncing}
              onClick={() => run('confluence', kbApi.syncConfluence)}
            >
              Sync from Confluence
            </Button>
            <StatusMsg k="confluence" />
          </div>
        </div>

        {/* Secondary sources */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { key: 'sheets',    icon: '📊', label: 'Google Sheets',   desc: 'Syncs service data from your connected Google Spreadsheet via OAuth.', fn: kbApi.syncSheets },
            { key: 'microsoft', icon: '📗', label: 'Microsoft Excel', desc: 'Syncs service data from your OneDrive / SharePoint file via Microsoft Graph API.', fn: kbApi.syncMicrosoft },
          ].map(src => (
            <div key={src.key} className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="text-2xl mb-2">{src.icon}</div>
              <h4 className="font-semibold text-gray-900 text-sm mb-1">{src.label}</h4>
              <p className="text-xs text-gray-500 mb-3 leading-relaxed">{src.desc}</p>
              <Button
                size="sm" variant="secondary"
                loading={syncing === src.key}
                disabled={!!syncing}
                onClick={() => run(src.key, src.fn)}
              >
                Sync from {src.label}
              </Button>
              <StatusMsg k={src.key} />
            </div>
          ))}
        </div>

        <div className="flex justify-end pt-1 border-t border-gray-100">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  )
}
