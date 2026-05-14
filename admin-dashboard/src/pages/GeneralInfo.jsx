import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { generalInfoApi, clientsApi } from '../services/api'
import PageHeader from '../components/ui/PageHeader'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import FormField, { Input, Select, FormSection } from '../components/ui/FormField'
import toast from 'react-hot-toast'

// ── Days config ───────────────────────────────────────────────────────────────

const DAYS = [
  { key: 'monday',    label: 'Monday' },
  { key: 'tuesday',   label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday',  label: 'Thursday' },
  { key: 'friday',    label: 'Friday' },
  { key: 'saturday',  label: 'Saturday' },
  { key: 'sunday',    label: 'Sunday' },
]

const DEFAULT_DAY_HOURS = Object.fromEntries(
  DAYS.map(({ key }) => [
    key,
    { status: key === 'saturday' || key === 'sunday' ? 'closed' : 'open', from: '09:00', to: '17:00' },
  ])
)

// ── Structured hours editor ───────────────────────────────────────────────────

function HoursEditor({ value, onChange }) {
  const hours = value && Object.keys(value).length > 0 ? value : DEFAULT_DAY_HOURS
  const all24 = DAYS.every(({ key }) => hours[key]?.status === '24hrs')

  const toggle24_7 = (checked) => {
    onChange(
      checked
        ? Object.fromEntries(DAYS.map(({ key }) => [key, { status: '24hrs' }]))
        : DEFAULT_DAY_HOURS
    )
  }

  const setDay = (key, field, val) =>
    onChange({ ...hours, [key]: { ...hours[key], [field]: val } })

  const inputCls = 'px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none transition'

  return (
    <div className="space-y-3">
      <label className="inline-flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={all24}
          onChange={e => toggle24_7(e.target.checked)}
          className="w-4 h-4 accent-brand-500"
        />
        <span className="text-sm font-medium text-gray-700">Open 24 / 7 — all days, all hours</span>
      </label>

      {all24 ? (
        <p className="text-sm text-green-600 font-medium">✅ This business is open 24 hours a day, 7 days a week.</p>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          {DAYS.map(({ key, label }, i) => {
            const day = hours[key] || { status: 'open', from: '09:00', to: '17:00' }
            return (
              <div
                key={key}
                className={`flex items-center gap-3 px-4 py-2.5 ${i < DAYS.length - 1 ? 'border-b border-gray-100' : ''} ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
              >
                <span className="w-24 text-sm font-medium text-gray-600 shrink-0">{label}</span>

                <select
                  value={day.status || 'open'}
                  onChange={e => setDay(key, 'status', e.target.value)}
                  className={`${inputCls} w-28 bg-white`}
                >
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                  <option value="24hrs">24 hours</option>
                </select>

                {day.status === 'open' && (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <input type="time" value={day.from || '09:00'} onChange={e => setDay(key, 'from', e.target.value)} className={inputCls} />
                    <span className="text-gray-400">to</span>
                    <input type="time" value={day.to || '17:00'} onChange={e => setDay(key, 'to', e.target.value)} className={inputCls} />
                  </div>
                )}
                {day.status === 'closed' && <span className="text-xs text-gray-400 italic">No hours</span>}
                {day.status === '24hrs'  && <span className="text-xs text-green-600 font-medium">All day</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── FAQ editor ────────────────────────────────────────────────────────────────

function FaqsEditor({ value, onChange }) {
  const faqs = value || []
  const update = (i, field, val) => onChange(faqs.map((f, idx) => idx === i ? { ...f, [field]: val } : f))
  const add    = () => onChange([...faqs, { question: '', answer: '' }])
  const remove = (i) => onChange(faqs.filter((_, idx) => idx !== i))

  return (
    <div className="space-y-3">
      {faqs.map((faq, i) => (
        <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">FAQ {i + 1}</span>
            <button type="button" onClick={() => remove(i)} className="text-red-400 hover:text-red-600 text-xs font-medium">Remove</button>
          </div>
          <Input placeholder="Question" value={faq.question} onChange={e => update(i, 'question', e.target.value)} />
          <textarea
            placeholder="Answer"
            value={faq.answer}
            onChange={e => update(i, 'answer', e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none transition resize-none"
          />
        </div>
      ))}
      <button type="button" onClick={add} className="text-sm text-brand-500 hover:text-brand-600 font-medium">
        + Add FAQ
      </button>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const BLANK = {
  businessName: '', industry: '', description: '',
  phone: '', email: '', website: '',
  address: '', area: '', city: '', mapsLink: '',
  hours: DEFAULT_DAY_HOURS, faqs: [],
}

function fromApi(info, client) {
  return {
    businessName: info?.business_name || client?.name  || '',
    industry:     info?.industry      || '',
    description:  info?.description   || '',
    phone:        info?.phone         || client?.phone || '',
    email:        info?.email         || client?.email || '',
    website:      info?.website       || '',
    address:      info?.address       || '',
    area:         info?.area          || '',
    city:         info?.city          || '',
    mapsLink:     info?.maps_link     || '',
    hours:        info?.hours && Object.keys(info.hours).length > 0 ? info.hours : DEFAULT_DAY_HOURS,
    faqs:         info?.faqs          || [],
  }
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function GeneralInfo() {
  const { user, isAdmin } = useAuth()
  const [clients,  setClients]  = useState([])
  const [clientId, setClientId] = useState(user?.clientId || '')
  const [form,     setForm]     = useState(BLANK)
  const [loading,  setLoading]  = useState(false)
  const [saving,   setSaving]   = useState(false)

  useEffect(() => {
    if (isAdmin) {
      clientsApi.getAll().then(res => setClients(res.data?.clients || [])).catch(() => {})
    }
  }, [isAdmin])

  useEffect(() => {
    if (!clientId) return
    const client = clients.find(c => c.id === clientId) || null
    setLoading(true)
    generalInfoApi.get(isAdmin ? clientId : undefined)
      .then(res => setForm(fromApi(res.data?.info, client)))
      .catch(() => toast.error('Failed to load general info'))
      .finally(() => setLoading(false))
  // clients is a dep so auto-fill fires once the client list is available
  }, [clientId, isAdmin, clients])

  const set  = (field, val) => setForm(f => ({ ...f, [field]: val }))

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = { ...form }
      if (isAdmin) payload.clientId = clientId
      await generalInfoApi.update(payload)
      toast.success('General info saved')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const cardCls = 'bg-white border border-gray-200 rounded-xl p-5'

  return (
    <div>
      <PageHeader
        title="📋 General Information"
        subtitle="Business details shown to customers in general inquiries"
      />

      {isAdmin && (
        <div className="mb-6 max-w-xs">
          <FormField label="Client">
            <Select value={clientId} onChange={e => setClientId(e.target.value)}>
              <option value="">— Select a client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </FormField>
        </div>
      )}

      {!clientId && isAdmin && (
        <p className="text-gray-400 text-sm">Select a client to view or edit their general info.</p>
      )}

      {clientId && loading && (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      )}

      {clientId && !loading && (
        <form onSubmit={save} className="space-y-5">

          {/* Top two-column grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* Left: Business identity */}
            <div className={`${cardCls} space-y-4`}>
              <FormSection title="Business Identity">
                <FormField label="Business name">
                  <Input value={form.businessName} onChange={e => set('businessName', e.target.value)} placeholder="Kigali Dental Clinic" />
                </FormField>
                <FormField label="Industry">
                  <Input value={form.industry} onChange={e => set('industry', e.target.value)} placeholder="Healthcare" />
                </FormField>
              </FormSection>
              <FormField label="Description">
                <textarea
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  placeholder="Short description shown to customers…"
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none transition resize-none"
                />
              </FormField>
            </div>

            {/* Right: Contact + Location */}
            <div className="space-y-5">
              <div className={cardCls}>
                <FormSection title="Contact">
                  <FormField label="Phone">
                    <Input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+250 788 000 000" />
                  </FormField>
                  <FormField label="Email">
                    <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="hello@example.com" />
                  </FormField>
                  <FormField label="Website" className="col-span-2">
                    <Input value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://example.com" />
                  </FormField>
                </FormSection>
              </div>

              <div className={cardCls}>
                <FormSection title="Location">
                  <FormField label="Street address" className="col-span-2">
                    <Input value={form.address} onChange={e => set('address', e.target.value)} placeholder="KG 123 St" />
                  </FormField>
                  <FormField label="Area / Neighborhood">
                    <Input value={form.area} onChange={e => set('area', e.target.value)} placeholder="Kicukiro" />
                  </FormField>
                  <FormField label="City">
                    <Input value={form.city} onChange={e => set('city', e.target.value)} placeholder="Kigali" />
                  </FormField>
                  <FormField label="Google Maps link" className="col-span-2">
                    <Input value={form.mapsLink} onChange={e => set('mapsLink', e.target.value)} placeholder="https://maps.google.com/?q=..." />
                  </FormField>
                </FormSection>
              </div>
            </div>
          </div>

          {/* Business hours — full width */}
          <div className={cardCls}>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 pb-1 border-b border-gray-100">
              Business Hours
            </h4>
            <HoursEditor value={form.hours} onChange={v => set('hours', v)} />
          </div>

          {/* FAQs — full width */}
          <div className={cardCls}>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 pb-1 border-b border-gray-100">
              Frequently Asked Questions
            </h4>
            <FaqsEditor value={form.faqs} onChange={v => set('faqs', v)} />
          </div>

          <div className="flex justify-end pb-8">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
