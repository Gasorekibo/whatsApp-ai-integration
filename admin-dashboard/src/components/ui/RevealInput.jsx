import { useState } from 'react'

export default function RevealInput({ value, onChange, placeholder = '', className = '', ...props }) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-l-lg text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none transition ${className}`}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="px-3 border border-l-0 border-gray-300 rounded-r-lg text-xs text-gray-500 hover:bg-gray-50 transition-colors whitespace-nowrap"
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
