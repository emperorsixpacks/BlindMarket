interface PageHeaderProps {
  title: string;
  description?: string;
  right?: React.ReactNode;
}

export function PageHeader({ title, description, right }: PageHeaderProps) {
  return (
    // Mobile: stack title above the right slot so action buttons don't get
    // squeezed next to a 40px display title. Desktop: classic side-by-side.
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
      <div className="min-w-0">
        <h1 className="text-3xl sm:text-[40px] font-mono font-bold text-ink leading-none tracking-tightest break-words">
          {title}
        </h1>
        {description && (
          <p className="text-sm font-mono text-ink-2 mt-2 max-w-lg">{description}</p>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
