interface StatusDotProps {
  color: string
  pulse?: boolean
}

export default function StatusDot({ color, pulse = false }: StatusDotProps) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${color} ${pulse ? 'animate-pulse-dot' : ''}`} />
  )
}
