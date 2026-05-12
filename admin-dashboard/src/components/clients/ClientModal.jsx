import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { clientsApi } from '../../services/api'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import FormField, { Input, Select, FormSection } from '../ui/FormField'
import RevealInput from '../ui/RevealInput'

const TIMEZONES = [
  'Africa/Kigali','Africa/Nairobi','Africa/Lagos','Africa/Johannesburg',
  'Europe/London','Europe/Paris','America/New_York','America/Los_Angeles','Asia/Dubai',
]
const CURRENCIES = [
  ['RWF','RWF — Rwandan Franc'],['USD','USD — US Dollar'],['EUR','EUR — Euro'],
  ['GBP','GBP — British Pound'],['KES','KES — Kenyan Shilling'],
  ['UGX','UGX — Ugandan Shilling'],['TZS','TZS — Tanzanian Shilling'],
  ['NGN','NGN — Nigerian Naira'],['ZAR','ZAR — South African Rand'],
]

const EMPTY = {
  name:'', email:'', phone:'',
  botName:'', timezone:'Africa/Kigali', currency:'RWF',
  depositAmount:'',
  subscriptionPlan:'message_only', maxMonthlyMessages:'',
  subscriptionStatus:'trial', subscriptionEndDate:'', isActive:true,
  password:'',
  whatsappBusinessId:'', whatsappToken:'', whatsappAccountId:'',
  whatsappWebhookVerifyToken:'',
  geminiApiKey:'',
  pineconeIndex:'', pineconeApiKey:'', pineconeIndexName:'', pineconeEnvironment:'',
  flutterwaveSecretKey:'', flutterwaveWebhookSecret:'',
  googleSheetId:'', googleSheetsWebhookToken:'',
  microsoftClientId:'', microsoftObjectId:'', microsoftTenantId:'',
  microsoftClientSecret:'', microsoftUserEmail:'', microsoftDriveId:'', microsoftItemId:'',
  confluenceBaseUrl:'', confluenceEmail:'', confluenceApiToken:'', confluenceSpaceKey:'',
}

// Fields that MUST be provided when creating a new client.
// Without these the system either cannot route WhatsApp messages,
// cannot send replies, or cannot isolate the client's knowledge base.
const CREATE_REQUIRED = {
  name:               'Contact Name',
  email:              'Email',
  phone:              'Phone',
  password:           'Portal Password',
  whatsappBusinessId: 'WhatsApp Phone Number ID',
  whatsappToken:      'WhatsApp Permanent Token',
  pineconeIndex:      'Pinecone Namespace',
}

function validate(form, isEdit) {
  const errors = {}
  if (!isEdit) {
    Object.entries(CREATE_REQUIRED).forEach(([key, label]) => {
      if (!form[key]?.trim()) errors[key] = `${label} is required`
    })
    if (form.password && form.password.length < 6) {
      errors.password = 'Password must be at least 6 characters'
    }
  }
  return errors
}

export default function ClientModal({ open, onClose, client, onSaved }) {
  const isEdit = !!client
  const [form, setForm]       = useState(EMPTY)
  const [errors, setErrors]   = useState({})
  const [kbTab, setKbTab]     = useState('pinecone')
  const [loading, setLoading]     = useState(false)
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    if (!open) return
    setErrors({})
    if (isEdit) {
      setForm({
        ...EMPTY, ...client,
        password: '',
        depositAmount: client.depositAmount ?? '',
        maxMonthlyMessages: client.maxMonthlyMessages ?? '',
        subscriptionEndDate: client.subscriptionEndDate ? client.subscriptionEndDate.slice(0, 10) : '',
        isActive: client.isActive ?? true,
      })
    } else {
      setForm(EMPTY)
    }
    setKbTab('pinecone')
  }, [open, client, isEdit])

  const set    = k => e => { setForm(f => ({ ...f, [k]: e.target.value })); setErrors(e => ({ ...e, [k]: undefined })) }
  const setChk = k => e => setForm(f => ({ ...f, [k]: e.target.checked }))

  const handleSubmit = async e => {
    e.preventDefault()

    // Client-side validation for new clients
    const validationErrors = validate(form, isEdit)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      const firstMsg = Object.values(validationErrors)[0]
      toast.error(firstMsg)
      return
    }

    setLoading(true)
    try {
      const payload = { ...form }
      if (!payload.password)           delete payload.password
      if (payload.depositAmount === '') delete payload.depositAmount
      if (payload.maxMonthlyMessages === '') delete payload.maxMonthlyMessages
      if (payload.subscriptionEndDate === '') delete payload.subscriptionEndDate

      if (isEdit) { await clientsApi.update(client.id, payload); toast.success('Client updated') }
      else        { await clientsApi.create(payload);             toast.success('Client registered') }
      onSaved(); onClose()
    } catch (err) {
      const data = err.response?.data

      // Map server field errors back to inline highlights
      if (err.response?.status === 400 && data?.missing?.length) {
        const serverErrors = {}
        data.missing.forEach(({ field, message }) => { serverErrors[field] = message })
        setErrors(serverErrors)
        toast.error(data.missing.map(m => m.message).join(' · '))
        return
      }
      if (err.response?.status === 409 && data?.conflicts?.length) {
        const serverErrors = {}
        data.conflicts.forEach(({ field, message }) => { serverErrors[field] = message })
        setErrors(serverErrors)
        toast.error(data.conflicts.map(c => c.message).join(' · '))
        return
      }

      toast.error(data?.error || 'Operation failed')
    } finally { setLoading(false) }
  }

  const handleResetMessages = async () => {
    setResetting(true)
    try {
      await clientsApi.resetMessages(client.id)
      toast.success('Message count reset to 0')
      onSaved()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Reset failed')
    } finally { setResetting(false) }
  }

  // Field helper — passes error state down so FormField can show red border + message
  const fld = (k, label, opts = {}) => (
    <FormField key={k} label={label} required={opts.required} hint={opts.hint} error={errors[k]}>
      <Input type={opts.type || 'text'} value={form[k]} onChange={set(k)}
        placeholder={opts.placeholder || ''} required={opts.required}
        className={errors[k] ? 'border-red-400 bg-red-50' : ''} />
    </FormField>
  )

  // Secret/password field helper
  const secret = (k, label, hint, opts = {}) => (
    <FormField key={k} label={label} hint={hint} required={opts.required} error={errors[k]}>
      <RevealInput value={form[k]} onChange={set(k)}
        placeholder={opts.placeholder || (isEdit ? 'Paste new value to replace…' : '')}
        className={errors[k] ? 'border-red-400 bg-red-50' : ''} />
    </FormField>
  )

  const KB_TABS   = ['pinecone','sheets','microsoft','confluence']
  const KB_LABELS = { pinecone:'🔷 Pinecone', sheets:'📊 Google Sheets', microsoft:'📁 Microsoft', confluence:'🗂️ Confluence' }

  return (
    <Modal open={open} onClose={onClose}
      title={isEdit ? `✏️ Edit — ${client?.name}` : '🏢 Register New Client'}
      size="xl">
      <form onSubmit={handleSubmit} className="space-y-1">

        {/* ── Basic Info ── */}
        <FormSection title="Basic Info">
          {fld('name',  'Name',  { required: true, placeholder: 'Kigali Hospital' })}
          {fld('email', 'Email', { required: true, type: 'email', placeholder: 'admin@company.com' })}
          {fld('phone', 'Phone', { required: true, placeholder: '+250780000000' })}
        </FormSection>

        {/* ── WhatsApp Configuration ── */}
        <FormSection title="WhatsApp Configuration">
          {fld('whatsappBusinessId', 'Phone Number ID', {
            required: !isEdit,
            placeholder: '908772575661941',
            hint: 'Meta → WhatsApp → API Setup → Phone Number ID'
          })}
          {fld('whatsappAccountId', 'Business Account ID (WABA)', { placeholder: '863459623353177' })}
          {secret('whatsappToken', 'Permanent Token',
            'Meta Business Suite → System Users → Generate Token (not the temporary test token)',
            { required: !isEdit, placeholder: 'EAAxxxxxxx…' }
          )}
          {fld('whatsappWebhookVerifyToken', 'Webhook Verify Token', { placeholder: 'my_secret_verify_token' })}
        </FormSection>

        {/* ── Knowledge Base Namespace (required — not collapsible) ── */}
        <FormSection title="Knowledge Base Namespace">
          <div className="col-span-2 text-xs text-gray-500 -mt-1 mb-1">
            Each client must have a unique namespace. This isolates their AI knowledge from all other clients.
          </div>
          {fld('pineconeIndex', 'Pinecone Namespace', {
            required: !isEdit,
            placeholder: 'client-name-slug',
            hint: 'Unique lowercase slug (e.g. kigali-hospital). Required — every client must have a different value.'
          })}
          {fld('pineconeIndexName', 'Index Name', {
            placeholder: 'moyo-tech-chatbot',
            hint: 'The shared index that holds all namespaces. Blank = server default.'
          })}
        </FormSection>

        {/* ── Portal Access ── */}
        <FormSection title="Portal Access">
          <FormField
            label={isEdit ? 'New Portal Password' : 'Portal Password'}
            hint={isEdit ? 'Leave blank to keep the existing password' : 'Min 6 characters — the client uses this to log into the dashboard'}
            required={!isEdit}
            error={errors.password}>
            <RevealInput value={form.password} onChange={set('password')}
              placeholder={isEdit ? 'Leave blank to keep existing' : 'Min 6 characters'}
              className={errors.password ? 'border-red-400 bg-red-50' : ''} />
          </FormField>
        </FormSection>

        {/* ── Bot Branding & Business Config ── */}
        <FormSection title="Bot Branding & Business Config">
          {fld('botName', 'Bot Name', { placeholder: 'e.g. Kigali Hospital', hint: 'What the AI calls itself in chat. Defaults to Name if blank.' })}
          <FormField label="Timezone">
            <Select value={form.timezone} onChange={set('timezone')}>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </Select>
          </FormField>
          <FormField label="Currency">
            <Select value={form.currency} onChange={set('currency')}>
              {CURRENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </FormField>
          {fld('depositAmount',      'Consultation Deposit', { type: 'number', placeholder: '5000', hint: 'Amount required to confirm a booking. Blank = server default.' })}
        </FormSection>

        {/* ── Subscription ── */}
        <FormSection title="Subscription">
          <FormField label="Plan">
            <Select value={form.subscriptionPlan} onChange={set('subscriptionPlan')}>
              <option value="message_only">Message Only</option>
              <option value="message_and_voice">Message + Voice</option>
            </Select>
          </FormField>
          {fld('maxMonthlyMessages', 'Monthly Message Limit', { type: 'number', placeholder: 'Leave blank = unlimited' })}
          {isEdit && <>
            <FormField label="Status">
              <Select value={form.subscriptionStatus} onChange={set('subscriptionStatus')}>
                <option value="trial">Trial</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="expired">Expired</option>
              </Select>
            </FormField>
            {fld('subscriptionEndDate', 'Subscription End Date', { type: 'date' })}
            <FormField label="">
              <label className="flex items-center gap-2 cursor-pointer mt-4">
                <input type="checkbox" checked={form.isActive} onChange={setChk('isActive')}
                  className="accent-brand-500 w-4 h-4" />
                <span className="text-sm text-gray-700">Client is Active</span>
              </label>
            </FormField>
          </>}
        </FormSection>

        {/* ── AI — collapsible ── */}
        <details className="border border-gray-200 rounded-lg overflow-hidden mt-3">
          <summary className="px-4 py-3 bg-gray-50 cursor-pointer text-sm font-semibold text-gray-700 select-none hover:bg-gray-100 transition-colors">
            🤖 AI Configuration <span className="text-gray-400 font-normal text-xs ml-1">(falls back to server defaults if blank)</span>
          </summary>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {secret('geminiApiKey', 'Gemini API Key', 'Get from aistudio.google.com. Blank = shared server key.')}
          </div>
        </details>

        {/* ── Payments — collapsible ── */}
        <details className="border border-gray-200 rounded-lg overflow-hidden mt-2">
          <summary className="px-4 py-3 bg-gray-50 cursor-pointer text-sm font-semibold text-gray-700 select-none hover:bg-gray-100 transition-colors">
            💳 Payments (Flutterwave) <span className="text-gray-400 font-normal text-xs ml-1">(falls back to server defaults if blank)</span>
          </summary>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {secret('flutterwaveSecretKey',    'Secret Key',    'Flutterwave Dashboard → Settings → API Keys → Secret Key')}
            {secret('flutterwaveWebhookSecret','Webhook Secret','Flutterwave Dashboard → Settings → Webhooks → Secret Hash')}
          </div>
        </details>

        {/* ── Knowledge Base optional credentials — collapsible ── */}
        <details className="border border-gray-200 rounded-lg overflow-hidden mt-2">
          <summary className="px-4 py-3 bg-gray-50 cursor-pointer text-sm font-semibold text-gray-700 select-none hover:bg-gray-100 transition-colors">
            📦 Knowledge Base Credentials <span className="text-gray-400 font-normal text-xs ml-1">(optional — link external data sources)</span>
          </summary>
          <div className="p-4">
            <div className="flex gap-1 flex-wrap mb-4 border-b border-gray-200 pb-3">
              {KB_TABS.map(t => (
                <button key={t} type="button" onClick={() => setKbTab(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${kbTab === t ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {KB_LABELS[t]}
                </button>
              ))}
            </div>

            {/* Pinecone — optional API key only; namespace is set above */}
            {kbTab === 'pinecone' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <p className="col-span-2 text-xs text-gray-500">Namespace and Index Name are configured in the required section above. Add a per-client API key here only if this client uses a different Pinecone project.</p>
              {secret('pineconeApiKey',   'API Key',     'Blank = uses server PINECONE_API_KEY')}
              {fld('pineconeEnvironment', 'Environment', { placeholder: 'us-east-1-aws' })}
            </div>}

            {/* Google Sheets */}
            {kbTab === 'sheets' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fld('googleSheetId',            'Spreadsheet ID',      { placeholder: '1BxiMVs0XRA5nFMdK…', hint: 'From the URL: /spreadsheets/d/[ID]/edit' })}
              {fld('googleSheetsWebhookToken', 'Sheets Webhook Token', { placeholder: 'superdupersecret123' })}
            </div>}

            {/* Microsoft */}
            {kbTab === 'microsoft' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fld('microsoftClientId',  'Azure App (Client) ID', { placeholder: '2bfc96b6-1353-…' })}
              {fld('microsoftObjectId',  'Object ID',             { placeholder: '18c4ecd8-5344-…' })}
              {fld('microsoftTenantId',  'Tenant (Directory) ID', { placeholder: 'bdc996a3-5320-…' })}
              {fld('microsoftUserEmail', 'User Email',            { type: 'email', placeholder: 'hello@company.com' })}
              {secret('microsoftClientSecret', 'Client Secret')}
              {fld('microsoftDriveId',   'Drive ID',              { placeholder: 'b!zn3vYtjcr0qR…' })}
              {fld('microsoftItemId',    'Excel File Item ID',    { placeholder: '3C0B812E-67B5-…' })}
            </div>}

            {/* Confluence */}
            {kbTab === 'confluence' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fld('confluenceBaseUrl',  'Base URL',         { type: 'url', placeholder: 'https://yourcompany.atlassian.net/wiki' })}
              {fld('confluenceEmail',    'Atlassian Email',  { type: 'email' })}
              {fld('confluenceSpaceKey', 'Space Key',        { placeholder: 'MYSPACE' })}
              {secret('confluenceApiToken', 'API Token', 'Generate at id.atlassian.com → Security → API tokens')}
            </div>}
          </div>
        </details>

        {/* ── Footer ── */}
        <div className="flex items-center gap-3 pt-4 border-t border-gray-100 mt-4">
          {isEdit && (
            <Button type="button" variant="danger" size="sm" loading={resetting} onClick={handleResetMessages}>
              Reset Message Count
            </Button>
          )}
          <div className="flex gap-3 ml-auto">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading}>
              {isEdit ? 'Save Changes' : 'Register Client'}
            </Button>
          </div>
        </div>

      </form>
    </Modal>
  )
}
