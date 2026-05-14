export const DAYS = [
  { key: 'monday',    label: 'Monday' },
  { key: 'tuesday',   label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday',  label: 'Thursday' },
  { key: 'friday',    label: 'Friday' },
  { key: 'saturday',  label: 'Saturday' },
  { key: 'sunday',    label: 'Sunday' },
]

export const DEFAULT_DAY_HOURS = Object.fromEntries(
  DAYS.map(({ key }) => [
    key,
    { status: key === 'saturday' || key === 'sunday' ? 'closed' : 'open', from: '09:00', to: '17:00' },
  ])
)

export default function HoursEditor({ value, onChange }) {
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
