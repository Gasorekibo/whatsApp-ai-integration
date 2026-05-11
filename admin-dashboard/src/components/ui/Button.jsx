import Spinner from './Spinner'

const variants = {
  primary:   'bg-brand-500 hover:bg-brand-600 text-white',
  secondary: 'bg-gray-100  hover:bg-gray-200  text-gray-700',
  danger:    'bg-red-500   hover:bg-red-600   text-white',
  success:   'bg-green-500 hover:bg-green-600 text-white',
  ghost:     'hover:bg-gray-100 text-gray-600',
}

const sizes = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2   text-sm',
  lg: 'px-5 py-2.5 text-sm',
}

export default function Button({
  children, variant = 'primary', size = 'md',
  loading = false, disabled = false,
  className = '', ...props
}) {
  return (
    <button
      disabled={disabled || loading}
      className={`
        inline-flex items-center gap-2 font-medium rounded-lg transition-colors
        disabled:opacity-60 disabled:cursor-not-allowed
        ${variants[variant]} ${sizes[size]} ${className}
      `}
      {...props}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  )
}
