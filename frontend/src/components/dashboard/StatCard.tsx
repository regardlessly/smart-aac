interface StatCardProps {
  label: string
  value: string | number
  subtitle?: string
  icon: string
  color: string
  bgColor: string
}

export default function StatCard({ label, value, subtitle, icon, color, bgColor }: StatCardProps) {
  return (
    <div className="bg-panel rounded-xl border border-border p-4 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-lg ${bgColor} flex items-center justify-center text-lg shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted font-medium uppercase tracking-wide">{label}</div>
        <div className={`text-2xl font-bold ${color} mt-0.5`}>{value}</div>
        {subtitle && (
          <div className="text-xs text-muted mt-0.5">{subtitle}</div>
        )}
      </div>
    </div>
  )
}
