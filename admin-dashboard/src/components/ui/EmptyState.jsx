export default function EmptyState({ icon = '📭', message = 'No data found' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-5xl mb-4">{icon}</div>
      <p className="text-gray-500 text-sm">{message}</p>
    </div>
  )
}
