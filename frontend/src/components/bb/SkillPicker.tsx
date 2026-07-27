import { useState, useEffect, useCallback } from 'react';
import { Button, FormField, FormInput, FormTextarea, Tag, Icon, Spinner } from './index';
import { authedPost, get } from '../../lib/api';

/**
 * Skill browse + install picker for the deploy form. A "skill" is a reusable
 * bundle of instructions + declarative tools that composes into the agent's
 * actual behavior (system prompt + tool belt). Two ways in:
 *   1. Browse the public registry (search + capability filter).
 *   2. Import a SKILL.md file (open Agent Skills standard) — parsed
 *      preview-first (scripts are never imported; warnings shown), saved as a
 *      private skill you can then select.
 *
 * The parent owns the selected slug list + the shared toolSecrets map; this
 * component surfaces each selected skill's secret_refs as inputs feeding that
 * same map (identical mechanism to ToolManager).
 */

export interface RegistrySkill {
  id: number;
  slug: string;
  name: string;
  description: string;
  version: string;
  author_address: string;
  capabilities: string[];
  install_count: number;
  secret_refs: Array<{ secret_ref: string; key_name?: string; type?: string } | string>;
}

function secretRefKey(r: RegistrySkill['secret_refs'][number]): string {
  return typeof r === 'string' ? r : r.secret_ref;
}

export default function SkillPicker({
  selectedSlugs,
  onChange,
  secrets,
  onSecretsChange,
}: {
  selectedSlugs: string[];
  /** caps = union of the selected skills' capability tags, so the parent can
   *  auto-check them in its capability picker. */
  onChange: (slugs: string[], caps?: string[]) => void;
  secrets: Record<string, string>;
  onSecretsChange: (s: Record<string, string>) => void;
}) {
  const [tab, setTab] = useState<'browse' | 'import'>('browse');
  const [query, setQuery] = useState('');
  const [list, setList] = useState<RegistrySkill[]>([]);
  const [selectedMeta, setSelectedMeta] = useState<Record<string, RegistrySkill>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await get<{ skills: RegistrySkill[] }>(
        `/api/v1/skills?limit=30${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''}`,
      );
      setList(r.skills ?? []);
    } catch { setList([]); } finally { setLoading(false); }
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  // Union of the selected skills' capability tags — passed back so the parent
  // can auto-check them. Derived from the freshest meta map.
  const capsFor = (slugs: string[], meta: Record<string, RegistrySkill>) =>
    [...new Set(slugs.flatMap((slug) => meta[slug]?.capabilities ?? []))];

  const toggle = (s: RegistrySkill) => {
    if (selectedSlugs.includes(s.slug)) {
      const next = selectedSlugs.filter((x) => x !== s.slug);
      onChange(next, capsFor(next, selectedMeta));
    } else {
      const meta = { ...selectedMeta, [s.slug]: s };
      setSelectedMeta(meta);
      const next = [...selectedSlugs, s.slug];
      onChange(next, capsFor(next, meta));
    }
  };

  // Union of secret refs across selected skills → inputs.
  const selectedSkills = selectedSlugs.map((slug) => selectedMeta[slug]).filter(Boolean);
  const requiredSecretRefs = [...new Set(selectedSkills.flatMap((s) => s.secret_refs.map(secretRefKey)))];

  return (
    <div className="space-y-4">
      <div role="tablist" className="flex gap-6 border-b border-line">
        {([['browse', 'Browse registry'], ['import', 'Import SKILL.md']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`pb-2.5 -mb-px text-xs border-b-2 transition-colors ${tab === id
              ? 'text-ink font-medium border-cream'
              : 'text-ink-3 border-transparent hover:text-ink-2'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'browse' ? (
        <div className="space-y-3">
          <FormInput
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills by name or description…"
          />
          {loading ? (
            <div className="py-6 flex justify-center"><Spinner size={18} /></div>
          ) : list.length === 0 ? (
            <p className="text-xs text-ink-3 py-3">No public skills yet. Import a SKILL.md to create the first one.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {list.map((s) => {
                const active = selectedSlugs.includes(s.slug);
                return (
                  <button
                    key={s.slug}
                    type="button"
                    onClick={() => toggle(s)}
                    className={`text-left border p-3 transition-colors ${active
                      ? 'border-cream/50 bg-cream/5'
                      : 'border-line bg-surface-2 hover:border-line-2'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink truncate">{s.name}</span>
                      {active && <Icon name="check" size={14} className="text-cream shrink-0" />}
                    </div>
                    <p className="text-xs text-ink-3 mt-1 line-clamp-2">{s.description}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {s.capabilities.slice(0, 3).map((c) => <Tag key={c} tone="neutral">{c.replace(/_/g, ' ')}</Tag>)}
                      <span className="text-[10px] text-ink-3 self-center ml-auto">{s.install_count} installs</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <SkillMdImport onCreated={(s) => {
          const meta = { ...selectedMeta, [s.slug]: s };
          setSelectedMeta(meta);
          const next = [...selectedSlugs, s.slug];
          onChange(next, capsFor(next, meta));
          void load();
          setTab('browse');
        }} />
      )}

      {selectedSkills.length > 0 && (
        <div className="border-t border-line pt-3 space-y-2">
          <div className="text-xs text-ink-2 font-medium">{selectedSkills.length} skill(s) selected</div>
          <div className="flex flex-wrap gap-1.5">
            {selectedSkills.map((s) => (
              <span key={s.slug} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs border border-cream/40 bg-cream/5 text-cream">
                {s.name}
                <button type="button" onClick={() => toggle(s)} aria-label={`Remove ${s.name}`}>
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
          </div>
          {requiredSecretRefs.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="text-xs text-ink-3">These skills need secrets (API keys/tokens) — stored encrypted, never shown again:</div>
              {requiredSecretRefs.map((ref) => (
                <FormField key={ref} label={ref}>
                  <FormInput
                    type="password"
                    value={secrets[ref] ?? ''}
                    onChange={(e) => onSecretsChange({ ...secrets, [ref]: e.target.value })}
                    placeholder={`Secret for ${ref}`}
                  />
                </FormField>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SkillMdImport({ onCreated }: { onCreated: (s: RegistrySkill) => void }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<{ name: string; description: string; version: string; instructions: string; warnings: string[] } | null>(null);
  const [slug, setSlug] = useState('');
  const [makePublic, setMakePublic] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const parse = async () => {
    setError(''); setBusy(true);
    try {
      const p = await authedPost<typeof parsed>('/api/v1/skills/parse-skillmd', { text });
      setParsed(p);
      if (p && !slug) setSlug(p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const create = async () => {
    if (!parsed) return;
    setError(''); setBusy(true);
    try {
      const skill = await authedPost<RegistrySkill>('/api/v1/skills', {
        slug,
        name: parsed.name,
        description: parsed.description,
        version: parsed.version,
        instructions: parsed.instructions,
        source: 'skillmd',
        isPublic: makePublic,
      });
      onCreated(skill);
      setText(''); setParsed(null); setSlug('');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <FormField label="Paste a SKILL.md" hint="Frontmatter + instructions. Bundled scripts are never imported.">
        <FormTextarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'---\nname: my-skill\ndescription: …\n---\n\nInstructions for the agent…'} />
      </FormField>
      {!parsed ? (
        <Button type="button" variant="outline" size="sm" label={busy ? 'Parsing…' : 'Parse'} onClick={parse} disabled={busy || text.trim().length === 0} />
      ) : (
        <div className="border border-line bg-surface-2 p-3 space-y-2">
          <div className="text-sm text-ink font-medium">{parsed.name} <span className="text-ink-3 font-normal">v{parsed.version}</span></div>
          {parsed.description && <div className="text-xs text-ink-2">{parsed.description}</div>}
          {parsed.warnings.length > 0 && (
            <div className="border-l-2 border-warn pl-2 py-0.5 space-y-1">
              {parsed.warnings.map((w, i) => <div key={i} className="text-[11px] text-warn leading-snug">{w}</div>)}
            </div>
          )}
          <pre className="whitespace-pre-wrap break-words text-[11px] text-ink-3 max-h-40 overflow-y-auto border border-line p-2">{parsed.instructions}</pre>
          <FormField label="Slug" hint="Unique id, lowercase kebab-case.">
            <FormInput type="text" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-skill" />
          </FormField>
          <label className="flex items-center gap-2 text-xs text-ink-2">
            <input type="checkbox" checked={makePublic} onChange={(e) => setMakePublic(e.target.checked)} />
            Publish to the registry (others can install it)
          </label>
          <div className="flex gap-2">
            <Button type="button" variant="primary" size="sm" label={busy ? 'Saving…' : 'Save & select'} onClick={create} disabled={busy || !slug} />
            <Button type="button" variant="ghost" size="sm" label="Discard" onClick={() => setParsed(null)} />
          </div>
        </div>
      )}
      {error && <div className="text-xs text-err">{error}</div>}
    </div>
  );
}
