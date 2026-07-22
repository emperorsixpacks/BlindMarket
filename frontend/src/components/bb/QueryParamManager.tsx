import { FormInput } from './FormField';

interface QueryParam { key: string; value?: string; required: boolean; }

interface QueryParamManagerProps {
  params: QueryParam[];
  onChange: (params: QueryParam[]) => void;
}

export function QueryParamManager({ params, onChange }: QueryParamManagerProps) {
  const addParam = () => onChange([...params, { key: '', value: '', required: false }]);
  const removeParam = (index: number) => onChange(params.filter((_, i) => i !== index));
  const updateParam = (index: number, field: keyof QueryParam, value: string | boolean) => {
    const newParams = [...params];
    newParams[index] = { ...newParams[index], [field]: value };
    onChange(newParams);
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
        {params.map((p, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center px-2 py-1.5 bg-surface-2">
            <FormInput
              placeholder="key"
              value={p.key}
              onChange={e => updateParam(i, 'key', e.target.value)}
              className="!border-0 !bg-transparent !px-1 !py-1.5"
            />
            <FormInput
              placeholder="placeholder"
              value={p.value ?? ''}
              onChange={e => updateParam(i, 'value', e.target.value)}
              className="!border-0 !bg-transparent !px-1 !py-1.5 font-mono"
            />
            <div className="flex items-center justify-center">
              <input
                type="checkbox"
                checked={p.required}
                onChange={e => updateParam(i, 'required', e.target.checked)}
                className="w-3.5 h-3.5 accent-cream"
              />
            </div>
            <button
              type="button"
              aria-label={`Remove parameter ${p.key || i + 1}`}
              onClick={() => removeParam(i)}
              className="w-8 h-8 flex items-center justify-center text-ink-3 hover:text-err transition-colors"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addParam}
        className="mt-1.5 px-3 py-1.5 border border-line text-xs font-mono text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors"
      >
        + add param
      </button>
    </div>
  );
}
