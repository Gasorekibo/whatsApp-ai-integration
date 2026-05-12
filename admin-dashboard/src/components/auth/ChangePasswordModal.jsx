import { useState } from 'react'
import toast from 'react-hot-toast'
import { authApi } from '../../services/api'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import FormField, { Input } from '../ui/FormField'

export default function ChangePasswordModal({ open, onClose }) {
  const [form, setForm]     = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [loading, setLoading] = useState(false)

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (form.newPassword !== form.confirmPassword) { toast.error('Passwords do not match'); return }
    if (form.newPassword.length < 6) { toast.error('New password must be at least 6 characters'); return }

    setLoading(true)
    try {
      await authApi.changePassword(form.currentPassword, form.newPassword)
      toast.success('Password changed successfully')
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to change password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="🔑 Change Password" size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Current Password" required>
          <Input type="password" value={form.currentPassword} onChange={set('currentPassword')} placeholder="••••••••" required />
        </FormField>
        <FormField label="New Password" required>
          <Input type="password" value={form.newPassword} onChange={set('newPassword')} placeholder="••••••••" required />
        </FormField>
        <FormField label="Confirm New Password" required>
          <Input type="password" value={form.confirmPassword} onChange={set('confirmPassword')} placeholder="••••••••" required />
        </FormField>
        <div className="flex gap-3 pt-2">
          <Button type="submit" loading={loading} className="flex-1">Save Password</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  )
}
