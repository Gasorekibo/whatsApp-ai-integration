import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { onboardingApi } from '../services/api'
import { Input } from '../components/ui/FormField'
import HoursEditor, { DEFAULT_DAY_HOURS } from '../components/ui/HoursEditor'
import FaqsEditor from '../components/ui/FaqsEditor'
import Spinner from '../components/ui/Spinner'
import toast, { Toaster } from 'react-hot-toast'

const BLANK = {
  businessName: '', industry: '', description: '',
  phone: '', whatsapp: '', email: '', website: '',
  address: '', area: '', city: '', mapsLink: '',
  hours: DEFAULT_DAY_HOURS, faqs: [],
}

function SectionCard({ icon, title, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50/60">
        <span className="text-lg">{icon}</span>
        <h2 className="text-sm font-semibold text-gray-700 tracking-wide">{title}</h2>
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
    </div>
  )
}

function FieldLabel({ children, required }) {
  return (
    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
      {children}{required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  )
}

export default function Onboarding() {
  const { token } = useParams()
  const [status,     setStatus]     = useState('loading')
  const [clientName, setClientName] = useState('')
  const [form,       setForm]       = useState(BLANK)
  const [saving,     setSaving]     = useState(false)

  useEffect(() => {
    onboardingApi.get(token)
      .then(res => {
        setClientName(res.data.clientName)
        if (res.data.prefill) {
          const p = res.data.prefill
          setForm({
            businessName: p.businessName || '',
            industry:     p.industry     || '',
            description:  p.description  || '',
            phone:        p.phone        || '',
            whatsapp:     p.whatsapp     || '',
            email:        p.email        || '',
            website:      p.website      || '',
            address:      p.address      || '',
            area:         p.area         || '',
            city:         p.city         || '',
            mapsLink:     p.mapsLink     || '',
            hours:        p.hours && Object.keys(p.hours).length > 0 ? p.hours : DEFAULT_DAY_HOURS,
            faqs:         p.faqs         || [],
          })
        }
        setStatus('form')
      })
      .catch(() => setStatus('expired'))
  }, [token])

  const set = (f, val) => setForm(prev => ({ ...prev, [f]: val }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.businessName.trim() || !form.phone.trim()) {
      toast.error('Business name and phone number are required.')
      return
    }
    setSaving(true)
    try {
      await onboardingApi.submit(token, form)
      setStatus('success')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Spinner size="lg" />
      </div>
    )
  }

  if (status === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-5 text-2xl">🔗</div>
          <h1 className="text-lg font-bold text-gray-800 mb-2">Link expired or invalid</h1>
          <p className="text-sm text-gray-500 leading-relaxed">Please ask your account manager to send you a new onboarding link. Links are valid for 7 days.</p>
        </div>
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl">🎉</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">You're all set!</h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            Your business information has been saved successfully. Our team will review it and get your WhatsApp AI assistant ready shortly.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Toaster position="top-center" toastOptions={{ duration: 4000, style: { borderRadius: '10px', fontSize: '14px' } }} />

      {/* Top bar */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.558 4.118 1.535 5.845L0 24l6.335-1.512A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.808 9.808 0 01-4.994-1.366l-.357-.214-3.762.987.99-3.656-.234-.374A9.799 9.799 0 012.18 12C2.18 6.57 6.57 2.18 12 2.18c5.43 0 9.82 4.39 9.82 9.82 0 5.43-4.39 9.818-9.82 9.818z"/>
            </svg>
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Business Onboarding</p>
            <p className="text-sm font-semibold text-gray-800 leading-tight">{clientName}</p>
          </div>
        </div>
      </div>

      {/* Hero strip */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <h1 className="text-xl font-bold mb-1">Tell us about your business</h1>
          <p className="text-emerald-100 text-sm">Complete the form below so we can configure your WhatsApp AI assistant. It takes about 5 minutes.</p>
        </div>
      </div>

      {/* Form body */}
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-4">
        <form onSubmit={submit} className="space-y-4">

          {/* ① Business Identity */}
          <SectionCard icon="🏢" title="Business Identity">
            <div>
              <FieldLabel required>Business name</FieldLabel>
              <Input value={form.businessName} onChange={e => set('businessName', e.target.value)} placeholder="Kigali Dental Clinic" required />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel>Industry</FieldLabel>
                <Input value={form.industry} onChange={e => set('industry', e.target.value)} placeholder="Healthcare" />
              </div>
              <div>
                <FieldLabel>City</FieldLabel>
                <Input value={form.city} onChange={e => set('city', e.target.value)} placeholder="Kigali" />
              </div>
            </div>
            <div>
              <FieldLabel>Short description</FieldLabel>
              <textarea
                value={form.description}
                onChange={e => set('description', e.target.value)}
                placeholder="A brief intro shown to customers…"
                rows={3}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none transition resize-none bg-gray-50 focus:bg-white"
              />
            </div>
          </SectionCard>

          {/* ② Contact Info */}
          <SectionCard icon="📞" title="Contact Info">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel required>Phone</FieldLabel>
                <Input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+250 788 000 000" required />
              </div>
              <div>
                <FieldLabel>WhatsApp number</FieldLabel>
                <Input type="tel" value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} placeholder="+250 788 000 000" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel>Email</FieldLabel>
                <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="hello@example.com" />
              </div>
              <div>
                <FieldLabel>Website</FieldLabel>
                <Input type="url" value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://example.com" />
              </div>
            </div>
          </SectionCard>

          {/* ③ Location */}
          <SectionCard icon="📍" title="Location">
            <div>
              <FieldLabel>Street address</FieldLabel>
              <Input value={form.address} onChange={e => set('address', e.target.value)} placeholder="KG 123 St" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel>Area / Neighborhood</FieldLabel>
                <Input value={form.area} onChange={e => set('area', e.target.value)} placeholder="Kicukiro" />
              </div>
              <div>
                <FieldLabel>Google Maps link</FieldLabel>
                <Input type="url" value={form.mapsLink} onChange={e => set('mapsLink', e.target.value)} placeholder="https://maps.google.com/..." />
              </div>
            </div>
          </SectionCard>

          {/* ④ Business Hours */}
          <SectionCard icon="🕐" title="Business Hours">
            <HoursEditor value={form.hours} onChange={v => set('hours', v)} />
          </SectionCard>

          {/* ⑤ FAQs */}
          <SectionCard icon="💬" title="Frequently Asked Questions">
            <FaqsEditor value={form.faqs} onChange={v => set('faqs', v)} />
          </SectionCard>

          {/* Submit */}
          <div className="pt-2 pb-10">
            <button
              type="submit"
              disabled={saving}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold text-sm rounded-xl transition-colors shadow-sm"
            >
              {saving ? 'Saving…' : 'Submit Business Info'}
            </button>
            <p className="text-center text-xs text-gray-400 mt-3">Your information is saved securely and only used to configure your assistant.</p>
          </div>

        </form>
      </div>
    </div>
  )
}
