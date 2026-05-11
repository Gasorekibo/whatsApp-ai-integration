const variants = {
  orange: 'bg-orange-100 text-orange-700',
  green:  'bg-green-100  text-green-700',
  blue:   'bg-blue-100   text-blue-700',
  red:    'bg-red-100    text-red-700',
  gray:   'bg-gray-100   text-gray-600',
  yellow: 'bg-yellow-100 text-yellow-700',
  purple: 'bg-purple-100 text-purple-700',
}

export default function Badge({ children, variant = 'gray', className = '' }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${variants[variant]} ${className}`}>
      {children}
    </span>
  )
}
