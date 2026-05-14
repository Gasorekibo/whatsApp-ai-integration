import { Input } from './FormField'

export default function FaqsEditor({ value, onChange }) {
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
