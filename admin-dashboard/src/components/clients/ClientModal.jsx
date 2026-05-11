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
  name:'', email:'', phone:'', company:'',
  companyName:'', timezone:'Africa/Kigali', currency:'RWF',
  depositAmount:'', paymentRedirectUrl:'',
  subscriptionPlan:'message_only', maxMonthlyMessages:'',
  subscriptionStatus:'trial', subscriptionEndDate:'', isActive:true,
  password:'',
  whatsappBusinessId:'', whatsappToken:'', whatsappAccountId:'',
  whatsappWebhookVerifyToken:'', whatsappToNumber:'',
  geminiApiKey:'',
  pineconeIndex:'', pineconeApiKey:'', pineconeIndexName:'', pineconeEnvironment:'',
  flutterwaveSecretKey:'', flutterwaveWebhookSecret:'',
  googleSheetId:'', googleSheetsWebhookToken:'',
  microsoftClientId:'', microsoftObjectId:'', microsoftTenantId:'',
  microsoftClientSecret:'', microsoftUserEmail:'', microsoftDriveId:'', microsoftItemId:'',
  confluenceBaseUrl:'', confluenceEmail:'', confluenceApiToken:'', confluenceSpaceKey:'',
}

export default function ClientModal({ open, onClose, client, onSaved }) {
  const isEdit = !!client
  const [form, setForm]     = useState(EMPTY)
  const [kbTab, setKbTab]   = useState('pinecone')
  const [loading, setLoading]        = useState(false)
  const [resetting, setResetting]    = useState(false)

  useEffect(() => {
    if (!open) return
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

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  const setChk = k => e => setForm(f => ({ ...f, [k]: e.target.checked }))

  const handleSubmit = async e => {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = { ...form }
      if (!payload.password) delete payload.password
      if (payload.depositAmount === '') delete payload.depositAmount
      if (payload.maxMonthlyMessages === '') delete payload.maxMonthlyMessages
      if (payload.subscriptionEndDate === '') delete payload.subscriptionEndDate

      if (isEdit) { await clientsApi.update(client.id, payload); toast.success('Client updated') }
      else        { await clientsApi.create(payload);             toast.success('Client created') }
      onSaved(); onClose()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Operation failed')
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

  const fld = (k, label, opts = {}) => (
    <FormField key={k} label={label} required={opts.required} hint={opts.hint}>
      <Input type={opts.type || 'text'} value={form[k]} onChange={set(k)}
        placeholder={opts.placeholder || ''} required={opts.required} />
    </FormField>
  )
  const secret = (k, label, hint) => (
    <FormField key={k} label={label} hint={hint}>
      <RevealInput value={form[k]} onChange={set(k)} placeholder={isEdit ? 'Paste new value to replace…' : ''} />
    </FormField>
  )

  const KB_TABS = ['pinecone','sheets','microsoft','confluence']
  const KB_LABELS = { pinecone:'🔷 Pinecone', sheets:'📊 Google Sheets', microsoft:'📁 Microsoft', confluence:'🗂️ Confluence' }

  return (
    <Modal open={open} onClose={onClose}
      title={isEdit ? `✏️ Edit — ${client?.name}` : '🏢 Register New Client'}
      size="xl">
      <form onSubmit={handleSubmit} className="space-y-1">

        {/* Basic Info */}
        <FormSection title="Basic Info">
          {fld('name',    'Contact Name',      { required: true })}
          {fld('company', 'Company (legal name)', { placeholder: 'Kigali Hospital Ltd' })}
          {fld('email',   'Email',             { required: true, type: 'email' })}
          {fld('phone',   'Phone',             { required: true, placeholder: '+250780000000' })}
        </FormSection>

        {/* Bot Branding */}
        <FormSection title="Bot Branding & Business Config">
          {fld('companyName', 'Display Name (shown in chat)', { placeholder: 'e.g. Kigali Hospital', hint: 'Defaults to Company name if blank' })}
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
          {fld('depositAmount', 'Consultation Deposit', { type: 'number', placeholder: '5000', hint: 'Amount to confirm a booking' })}
          {fld('paymentRedirectUrl', 'Payment Redirect URL', { type: 'url', placeholder: 'https://yoursite.com/confirmed' })}
        </FormSection>

        {/* Subscription */}
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
                <span className="text-sm text-gray-700">Client is Active (can send & receive messages)</span>
              </label>
            </FormField>
          </>}
        </FormSection>

        {/* WhatsApp */}
        <FormSection title="WhatsApp Configuration">
          {fld('whatsappBusinessId', 'Phone Number ID', { placeholder: '908772575661941', hint: 'Meta → WhatsApp → API Setup → Phone Number ID' })}
          {fld('whatsappAccountId',  'Business Account ID (WABA)', { placeholder: '863459623353177' })}
          {secret('whatsappToken', 'Permanent Token', 'Create via Meta Business Suite → System Users → Generate Token')}
          {fld('whatsappWebhookVerifyToken', 'Webhook Verify Token', { placeholder: 'my_secret_verify_token' })}
          {fld('whatsappToNumber', 'Default Recipient Number', { placeholder: '+250780000000' })}
        </FormSection>

        {/* Portal Access */}
        <FormSection title="Portal Access">
          <FormField label={isEdit ? 'New Portal Password (blank = keep existing)' : 'Portal Password (optional)'}>
            <RevealInput value={form.password} onChange={set('password')} placeholder="Leave blank to disable portal access" />
          </FormField>
        </FormSection>

        {/* AI — collapsible */}
        <details className="border border-gray-200 rounded-lg overflow-hidden mt-3">
          <summary className="px-4 py-3 bg-gray-50 cursor-pointer text-sm font-semibold text-gray-700 select-none hover:bg-gray-100 transition-colors">
            🤖 AI Configuration <span className="text-gray-400 font-normal text-xs ml-1">(falls back to server defaults if blank)</span>
          </summary>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {secret('geminiApiKey', 'Gemini API Key', 'Get from aistudio.google.com. Blank = shared server key.')}
          </div>
        </details>

        {/* Payments — collapsible */}
        <details className="border border-gray-200 rounded-lg overflow-hidden mt-2">
          <summary className="px-4 py-3 bg-gray-50 cursor-pointer text-sm font-semibold text-gray-700 select-none hover:bg-gray-100 transition-colors">
            💳 Payments (Flutterwave) <span className="text-gray-400 font-normal text-xs ml-1">(falls back to server defaults if blank)</span>
          </summary>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {secret('flutterwaveSecretKey', 'Secret Key', 'Flutterwave Dashboard → Settings → API Keys → Secret Key')}
            {secret('flutterwaveWebhookSecret', 'Webhook Secret', 'Flutterwave Dashboard → Settings → Webhooks → Secret Hash')}
          </div>
        </details>

        {/* Knowledge Base Sources — collapsible + tabbed */}
        <details className="border border-gray-200 rounded-lg overflow-hidden mt-2">
          <summary className="px-4 py-3 bg-gray-50 cursor-pointer text-sm font-semibold text-gray-700 select-none hover:bg-gray-100 transition-colors">
            📦 Knowledge Base Sources <span className="text-gray-400 font-normal text-xs ml-1">(data the AI learns from)</span>
          </summary>
          <div className="p-4">
            {/* Tabs */}
            <div className="flex gap-1 flex-wrap mb-4 border-b border-gray-200 pb-3">
              {KB_TABS.map(t => (
                <button key={t} type="button" onClick={() => setKbTab(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${kbTab === t ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {KB_LABELS[t]}
                </button>
              ))}
            </div>

            {/* Pinecone */}
            {kbTab === 'pinecone' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fld('pineconeIndex',       'Namespace (per-client slug)', { placeholder: 'kigali-hospital', hint: 'Isolates this client\'s data' })}
              {fld('pineconeIndexName',   'Index Name', { placeholder: 'moyo-tech-chatbot' })}
              {secret('pineconeApiKey', 'API Key', 'Blank = uses server PINECONE_API_KEY')}
              {fld('pineconeEnvironment', 'Environment', { placeholder: 'us-east-1-aws' })}
            </div>}

            {/* Google Sheets */}
            {kbTab === 'sheets' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fld('googleSheetId', 'Spreadsheet ID', { placeholder: '1BxiMVs0XRA5nFMdK…', hint: 'From the URL: /spreadsheets/d/[ID]/edit' })}
              {fld('googleSheetsWebhookToken', 'Sheets Webhook Token', { placeholder: 'superdupersecret123' })}
            </div>}

            {/* Microsoft */}
            {kbTab === 'microsoft' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fld('microsoftClientId',     'Azure App (Client) ID', { placeholder: '2bfc96b6-1353-…' })}
              {fld('microsoftObjectId',     'Object ID',             { placeholder: '18c4ecd8-5344-…' })}
              {fld('microsoftTenantId',     'Tenant (Directory) ID', { placeholder: 'bdc996a3-5320-…' })}
              {fld('microsoftUserEmail',    'User Email',            { type: 'email', placeholder: 'hello@company.com' })}
              {secret('microsoftClientSecret', 'Client Secret')}
              {fld('microsoftDriveId',      'Drive ID',              { placeholder: 'b!zn3vYtjcr0qR…' })}
              {fld('microsoftItemId',       'Excel File Item ID',    { placeholder: '3C0B812E-67B5-…' })}
            </div>}

            {/* Confluence */}
            {kbTab === 'confluence' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fld('confluenceBaseUrl',  'Base URL', { type: 'url', placeholder: 'https://yourcompany.atlassian.net/wiki' })}
              {fld('confluenceEmail',    'Atlassian Email', { type: 'email' })}
              {fld('confluenceSpaceKey', 'Space Key', { placeholder: 'MYSPACE' })}
              {secret('confluenceApiToken', 'API Token', 'Generate at id.atlassian.com → Security → API tokens')}
            </div>}
          </div>
        </details>

        {/* Footer */}
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
