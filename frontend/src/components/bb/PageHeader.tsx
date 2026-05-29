interface PageHeaderProps {
  title: string;
  description?: string;
  right?: React.ReactNode;
}

export function PageHeader({ title, description, right }: PageHeaderProps) {
  return (
    // Mobile: stack title above the right slot so action buttons don't get
    // squeezed next to a large display title. Desktop: side-by-side.
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
      <div className="min-w-0">
        <h1 className="text-3xl sm:text-[38px] font-bold text-ink leading-[1.05] tracking-tight break-words">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-ink-2 mt-2.5 max-w-xl leading-relaxed">{description}</p>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
