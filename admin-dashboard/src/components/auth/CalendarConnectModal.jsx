import Modal from '../ui/Modal'
import Button from '../ui/Button'

export default function CalendarConnectModal({ open, onClose }) {
  const handleConnect = () => {
    window.open('/auth', '_blank', 'noopener')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="📅 Connect Google Calendar" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Link a Google account so the bot can read calendar availability and offer real appointment slots.
        </p>

        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800 leading-relaxed">
          <strong className="block mb-1">What happens next:</strong>
          Clicking Connect will open Google's sign-in page. Sign in with the Google account whose
          calendar contains the availability. On success, the bot can offer real appointment slots.
        </div>

        <div className="flex gap-3 pt-2">
          <Button onClick={handleConnect} variant="success" className="flex-1">
            Connect Google Calendar →
          </Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  )
}
