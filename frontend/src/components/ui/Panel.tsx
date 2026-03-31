interface PanelProps {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export default function Panel({ title, subtitle, action, children, className = '' }: PanelProps) {
  return (
    <div className={`bg-panel rounded-[14px] border border-border ${className}`} style={{ boxShadow: '0 2px 14px rgba(61,114,232,0.08)' }}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <div>
          <h3 className="font-bold text-[15px] text-text">{title}</h3>
          {subtitle && (
            <p className="text-[11px] text-muted mt-0.5">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
      <div className="p-5">
        {children}
      </div>
    </div>
  )
}
