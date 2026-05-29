import { FormInput } from './FormField';

interface Header { name: string; value: string; isSensitive: boolean; }

interface HeaderManagerProps {
  headers: Header[];
  onChange: (headers: Header[]) => void;
}

export function HeaderManager({ headers, onChange }: HeaderManagerProps) {
  const addHeader = () => onChange([...headers, { name: '', value: '', isSensitive: false }]);
  const removeHeader = (index: number) => onChange(headers.filter((_, i) => i !== index));
  const updateHeader = (index: number, field: keyof Header, value: any) => {
    const newHeaders = [...headers];
    newHeaders[index] = { ...newHeaders[index], [field]: value };
    onChange(newHeaders);
  };

  return (
    <div className="space-y-2 mt-2">
      {headers.map((h, i) => (
        <div key={i} className="flex gap-2 items-center">
          <FormInput placeholder="Header name" value={h.name} onChange={e => updateHeader(i, 'name', e.target.value)} />
          <FormInput placeholder="Value" value={h.value} onChange={e => updateHeader(i, 'value', e.target.value)} />
          <label className="flex items-center gap-1 text-[10px] text-ink-3 uppercase whitespace-nowrap">
            <input type="checkbox" checked={h.isSensitive} onChange={e => updateHeader(i, 'isSensitive', e.target.checked)} />
            Sensitive
          </label>
          <button type="button" aria-label={`Remove header ${h.name || i + 1}`} onClick={() => removeHeader(i)} className="text-red-400 hover:text-red-300">×</button>
        </div>
      ))}
      <button type="button" onClick={addHeader} className="px-4 py-2 border border-line text-xs font-mono text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors">
        + add header
      </button>
    </div>
  );
}
