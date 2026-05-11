import { useState, useEffect } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import FormField, { Select } from '../ui/FormField'

export default function CalendarConnectModal({ open, onClose, clients = [], defaultClientId = '' }) {
  const [clientId, setClientId] = useState(defaultClientId)

  useEffect(() => { setClientId(defaultClientId) }, [defaultClientId, open])

  const handleConnect = () => {
    if (!clientId) return
    window.open(`/auth?clientId=${clientId}`, '_blank', 'noopener')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="📅 Connect Google Calendar" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Link a Google account so the bot can read calendar availability for this client.
        </p>

        <FormField label="Select Client" required>
          <Select value={clientId} onChange={e => setClientId(e.target.value)}>
            <option value="">— Select a client —</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ''}</option>
            ))}
          </Select>
        </FormField>

        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800 leading-relaxed">
          <strong className="block mb-1">What happens next:</strong>
          Clicking Connect will open Google's sign-in page. Sign in with the Google account whose
          calendar contains the client's availability. On success, the bot will be able to offer
          real appointment slots.
        </div>

        <div className="flex gap-3 pt-2">
          <Button
            onClick={handleConnect}
            disabled={!clientId}
            variant="success"
            className="flex-1"
          >
            Connect Google Calendar →
          </Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  )
}
