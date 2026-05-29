import { FormInput } from './FormField';

interface QueryParam { name: string; value: string; }

interface QueryParamManagerProps {
  params: QueryParam[];
  onChange: (params: QueryParam[]) => void;
}

export function QueryParamManager({ params, onChange }: QueryParamManagerProps) {
  const addParam = () => onChange([...params, { name: '', value: '' }]);
  const removeParam = (index: number) => onChange(params.filter((_, i) => i !== index));
  const updateParam = (index: number, field: keyof QueryParam, value: string) => {
    const newParams = [...params];
    newParams[index] = { ...newParams[index], [field]: value };
    onChange(newParams);
  };

  return (
    <div className="space-y-2 mt-2">
      {params.map((p, i) => (
        <div key={i} className="flex gap-2 items-center">
          <FormInput placeholder="Param name" value={p.name} onChange={e => updateParam(i, 'name', e.target.value)} />
          <FormInput placeholder="Value" value={p.value} onChange={e => updateParam(i, 'value', e.target.value)} />
          <button type="button" aria-label={`Remove parameter ${p.name || i + 1}`} onClick={() => removeParam(i)} className="text-red-400 hover:text-red-300">×</button>
        </div>
      ))}
      <button type="button" onClick={addParam} className="px-4 py-2 border border-line text-xs font-mono text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors">
        + add param
      </button>
    </div>
  );
}
