import { FormInput } from './FormField';

interface Header { key: string; value?: string; required: boolean; }

interface HeaderManagerProps {
  headers: Header[];
  onChange: (headers: Header[]) => void;
}

export function HeaderManager({ headers, onChange }: HeaderManagerProps) {
  const addHeader = () => onChange([...headers, { key: '', value: '', required: false }]);
  const removeHeader = (index: number) => onChange(headers.filter((_, i) => i !== index));
  const updateHeader = (index: number, field: keyof Header, value: string | boolean) => {
    const newHeaders = [...headers];
    newHeaders[index] = { ...newHeaders[index], [field]: value };
    onChange(newHeaders);
  };

  return (
    <div className="space-y-0">
      <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 px-2 py-1.5 text-[11px] font-medium text-ink-3 uppercase tracking-wide">
        <span>Key</span>
        <span>Value / Placeholder</span>
        <span className="text-center">Required</span>
        <span className="w-8"></span>
      </div>
      <div className="divide-y divide-line border border-line">
        {headers.map((h, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center px-2 py-1.5 bg-surface-2">
            <FormInput
              placeholder="header-name"
              value={h.key}
              onChange={e => updateHeader(i, 'key', e.target.value)}
              className="!border-0 !bg-transparent !px-1 !py-1.5"
            />
            <FormInput
              placeholder="value"
              value={h.value ?? ''}
              onChange={e => updateHeader(i, 'value', e.target.value)}
              className="!border-0 !bg-transparent !px-1 !py-1.5 font-mono"
            />
            <div className="flex items-center justify-center">
              <input
                type="checkbox"
                checked={h.required}
                onChange={e => updateHeader(i, 'required', e.target.checked)}
                className="w-3.5 h-3.5 accent-cream"
              />
            </div>
            <button
              type="button"
              aria-label={`Remove header ${h.key || i + 1}`}
              onClick={() => removeHeader(i)}
              className="w-8 h-8 flex items-center justify-center text-ink-3 hover:text-err transition-colors"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addHeader}
        className="mt-1.5 px-3 py-1.5 border border-line text-xs font-mono text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors"
      >
        + add header
      </button>
    </div>
  );
}
