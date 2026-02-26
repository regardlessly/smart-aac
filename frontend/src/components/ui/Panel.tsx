interface PanelProps {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export default function Panel({ title, subtitle, action, children, className = '' }: PanelProps) {
  return (
    <div className={`bg-panel rounded-xl border border-border ${className}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <h3 className="font-semibold text-sm text-text">{title}</h3>
          {subtitle && (
            <p className="text-xs text-muted mt-0.5">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
      <div className="p-4">
        {children}
      </div>
    </div>
  )
}
