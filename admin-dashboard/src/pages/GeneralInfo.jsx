import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { generalInfoApi, clientsApi } from '../services/api'
import PageHeader from '../components/ui/PageHeader'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import FormField, { Input, Select, FormSection } from '../components/ui/FormField'
import HoursEditor, { DEFAULT_DAY_HOURS } from '../components/ui/HoursEditor'
import FaqsEditor from '../components/ui/FaqsEditor'
import toast from 'react-hot-toast'

// ── Shareable link panel ───────────────────────────────────────────────────────

function ShareLinkPanel({ tenantId }) {
  const [link,        setLink]        = useState(null)
  const [expiresAt,   setExpiresAt]   = useState(null)
  const [generating,  setGenerating]  = useState(false)
  const [copied,      setCopied]      = useState(false)

  const generate = async () => {
    setGenerating(true)
    try {
      const res = await clientsApi.generateFormToken(tenantId)
      setLink(res.data.url)
      setExpiresAt(res.data.expiresAt)
      toast.success('Link ready — share it with the client')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not generate link')
    } finally {
      setGenerating(false)
    }
  }

  const copy = () => {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const expiry = expiresAt
    ? new Date(expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  return (
    <div className="mb-6 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-emerald-800">📤 Client Onboarding Form</p>
          <p className="text-xs text-emerald-600 mt-0.5">
            Generate a secure link so the client can fill in their business info directly.
            {expiry && <span className="ml-1 text-gray-400">Expires {expiry}.</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={generating}
          className="shrink-0 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {generating ? 'Generating…' : link ? '🔄 New Link' : '🔗 Publish & Get Link'}
        </button>
      </div>

      {link && (
        <div className="mt-3 flex items-center gap-2">
          <input
            readOnly
            value={link}
            className="flex-1 px-3 py-2 text-xs bg-white border border-emerald-200 rounded-lg outline-none text-gray-600 font-mono truncate"
            onClick={e => e.target.select()}
          />
          <button
            type="button"
            onClick={copy}
            className="shrink-0 px-3 py-2 bg-white border border-emerald-200 hover:bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-lg transition-colors"
          >
            {copied ? '✓ Copied!' : 'Copy'}
          </button>
        </div>
      )}
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
  const [tenantId, setTenantId] = useState(user?.tenantId || '')
  const [form,     setForm]     = useState(BLANK)
  const [loading,  setLoading]  = useState(false)
  const [saving,   setSaving]   = useState(false)

  useEffect(() => {
    if (isAdmin) {
      clientsApi.getAll().then(res => setClients(res.data?.clients || [])).catch(() => {})
    }
  }, [isAdmin])

  useEffect(() => {
    if (!tenantId) return
    const client = clients.find(c => c.id === tenantId) || null
    setLoading(true)
    generalInfoApi.get()
      .then(res => setForm(fromApi(res.data?.info, client)))
      .catch(() => toast.error('Failed to load general info'))
      .finally(() => setLoading(false))
  }, [tenantId, isAdmin, clients])

  const set  = (field, val) => setForm(f => ({ ...f, [field]: val }))

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = { ...form }
      if (isAdmin) payload.tenantId = tenantId
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
            <Select value={tenantId} onChange={e => setTenantId(e.target.value)}>
              <option value="">— Select a client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </FormField>
        </div>
      )}

      {!tenantId && isAdmin && (
        <p className="text-gray-400 text-sm">Select a client to view or edit their general info.</p>
      )}

      {tenantId && isAdmin && <ShareLinkPanel tenantId={tenantId} />}

      {tenantId && loading && (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      )}

      {tenantId && !loading && (
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
