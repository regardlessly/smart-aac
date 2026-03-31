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
    <div className="bg-panel rounded-[14px] border border-border p-5 flex items-start gap-3" style={{ boxShadow: '0 2px 14px rgba(61,114,232,0.08)' }}>
      <div className={`w-10 h-10 rounded-[10px] ${bgColor} flex items-center justify-center text-lg shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-muted font-bold uppercase tracking-[0.08em]">{label}</div>
        <div className={`text-[26px] font-bold ${color} mt-0.5 leading-tight`}>{value}</div>
        {subtitle && (
          <div className="text-[11px] text-muted mt-0.5">{subtitle}</div>
        )}
      </div>
    </div>
  )
}
