interface BadgeProps {
  children: React.ReactNode
  bg?: string
  text?: string
}

export default function Badge({ children, bg = 'bg-gray-100', text = 'text-gray-600' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${bg} ${text}`}>
      {children}
    </span>
  )
}
