import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import {
  Breadcrumb,
  PageHeader,
  SectionRule,
  Button,
  Tag,
  FormField,
  FormInput,
  FormTextarea,
  Panel,
  LoadingState,
  EmptyState,
  ErrorState,
} from '../components/bb';
import {
  getPublicTemplates,
  createTemplate,
  getMyTemplates,
} from '../services/marketplace';
import { AGENT_CAPABILITIES } from '../config/capabilities';
import { truncateAddress } from '../lib/utils';

type Tab = 'browse' | 'mine' | 'create';

const TABS: { id: Tab; label: string }[] = [
  { id: 'browse', label: 'Public templates' },
  { id: 'mine', label: 'My templates' },
  { id: 'create', label: 'Create template' },
];

const CATEGORIES = [
  'data_processing', 'research', 'content', 'analysis',
  'development', 'integration', 'automation', 'other',
];

export default function TaskTemplates() {
  const [tab, setTab] = useState<Tab>('browse');
  const { address } = useAccount();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCaps, setSelectedCaps] = useState<string[]>([]);
  const [suggestedReward, setSuggestedReward] = useState('');
  const [isPublic, setIsPublic] = useState(true);

  const { data: publicData, isLoading: publicLoading, isError: publicError, refetch: refetchPublic } = useQuery({
    queryKey: ['public-templates'],
    queryFn: () => getPublicTemplates(50),
    enabled: tab === 'browse',
  });

  const { data: myTemplates, isLoading: myLoading } = useQuery({
    queryKey: ['my-templates', address],
    queryFn: () => getMyTemplates(),
    enabled: tab === 'mine' && !!address,
  });

  const createMut = useMutation({
    mutationFn: () => createTemplate({
      name,
      category: category || 'other',
      description,
      requiredCapabilities: selectedCaps,
      suggestedReward: suggestedReward || undefined,
      isPublic,
    }),
    onSuccess: () => {
      setName('');
      setCategory('');
      setDescription('');
      setSelectedCaps([]);
      setSuggestedReward('');
      setIsPublic(true);
      qc.invalidateQueries({ queryKey: ['public-templates'] });
      qc.invalidateQueries({ queryKey: ['my-templates'] });
      setTab('mine');
    },
  });

  const toggleCap = (cap: string) =>
    setSelectedCaps((prev) => (prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]));

  return (
    <div>
      <Breadcrumb items={['marketplace', 'tasks', 'templates']} />
      <PageHeader
        title="Task templates"
        description="Pre-built task briefs you can use to post tasks faster. Browse public templates or create your own."
      />

      <div role="tablist" className="flex gap-6 border-b border-line mb-8">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`pb-3 -mb-px text-sm border-b-2 transition-colors ${
              tab === t.id
                ? 'text-ink font-medium border-cream'
                : 'text-ink-3 border-transparent hover:text-ink-2'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'browse' && (
        <div>
          {publicLoading ? (
            <LoadingState label="Loading templates…" />
          ) : publicError ? (
            <ErrorState title="Couldn't load templates" onRetry={() => refetchPublic()} />
          ) : !publicData?.templates.length ? (
            <EmptyState
              icon="list"
              title="No public templates yet"
              description="Be the first to create a template and share it with the marketplace."
              action={
                <Button variant="outline" label="Create template" size="sm" onClick={() => setTab('create')} />
              }
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {publicData.templates.map((t) => (
                <Panel key={t.id} padding="md">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink truncate">{t.name}</div>
                      <div className="text-[11px] text-ink-3 mt-0.5">{t.category.replace(/_/g, ' ')}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-ink-3 font-mono">{t.use_count} uses</span>
                      <Tag tone="info">{t.category.replace(/_/g, ' ')}</Tag>
                    </div>
                  </div>
                  <p className="text-xs text-ink-3 leading-relaxed line-clamp-3 mb-3">
                    {t.description}
                  </p>
                  <div className="flex flex-wrap gap-1 mb-3">
                    {t.required_capabilities.map((c) => (
                      <Tag key={c} tone="neutral">{c.replace(/_/g, ' ')}</Tag>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-xs text-ink-3">
                    <span className="font-mono">{truncateAddress(t.creator_address)}</span>
                    {t.suggested_reward && <span className="font-mono text-ink-2">{t.suggested_reward} 0G</span>}
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'mine' && (
        <div>
          {myLoading ? (
            <LoadingState label="Loading your templates…" />
          ) : !myTemplates?.length ? (
            <EmptyState
              icon="list"
              title="No templates yet"
              description="Templates you create will appear here."
              action={
                <Button variant="outline" label="Create template" size="sm" onClick={() => setTab('create')} />
              }
            />
          ) : (
            <div className="space-y-2">
              {myTemplates.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 border border-line px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="text-ink font-medium truncate">{t.name}</div>
                    <div className="text-xs text-ink-3 mt-0.5">
                      {t.category} · {t.use_count} uses{t.suggested_reward && ` · ${t.suggested_reward} 0G`}
                    </div>
                  </div>
                  <Tag tone={t.is_public ? 'ok' : 'neutral'}>{t.is_public ? 'public' : 'private'}</Tag>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'create' && (
        <div className="max-w-2xl space-y-5 border border-line p-6">
          <SectionRule num="01" title="New template" />
          <FormField label="Template name" required>
            <FormInput placeholder="e.g. Market research report" value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="Category" required>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button key={c} type="button"
                  onClick={() => setCategory(category === c ? '' : c)}
                  className={`px-2.5 py-1 text-xs border transition-colors ${category === c ? 'bg-cream/10 border-cream/40 text-cream' : 'bg-surface-2 border-line text-ink-3 hover:text-ink-2'}`}
                >
                  {c.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </FormField>
          <FormField label="Description" required hint="Describe the task brief in detail">
            <FormTextarea rows={6} placeholder="Describe what needs to be done…" value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <FormField label="Required capabilities" hint={`${selectedCaps.length} selected`}>
            <div className="flex flex-wrap gap-1.5">
              {AGENT_CAPABILITIES.map((cap) => (
                <button key={cap} type="button"
                  onClick={() => toggleCap(cap)}
                  className={`px-2.5 py-1 text-xs border transition-colors ${selectedCaps.includes(cap) ? 'bg-cream/10 border-cream/40 text-cream' : 'bg-surface-2 border-line text-ink-3 hover:text-ink-2'}`}
                >
                  {cap.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Suggested reward (0G)">
              <FormInput className="font-mono" placeholder="50" value={suggestedReward} onChange={(e) => setSuggestedReward(e.target.value)} />
            </FormField>
            <FormField label="Visibility">
              <div className="flex gap-2">
                <button type="button"
                  onClick={() => setIsPublic(true)}
                  className={`px-3 py-1.5 text-xs border transition-colors ${isPublic ? 'bg-cream/10 border-cream/40 text-cream' : 'bg-surface-2 border-line text-ink-3'}`}
                >Public</button>
                <button type="button"
                  onClick={() => setIsPublic(false)}
                  className={`px-3 py-1.5 text-xs border transition-colors ${!isPublic ? 'bg-cream/10 border-cream/40 text-cream' : 'bg-surface-2 border-line text-ink-3'}`}
                >Private</button>
              </div>
            </FormField>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="primary"
              label={createMut.isPending ? 'Creating…' : 'Create template'}
              disabled={!name.trim() || !category || !description.trim() || selectedCaps.length === 0 || createMut.isPending}
              onClick={() => createMut.mutate()}
            />
            {createMut.isError && (
              <span className="text-xs text-err">Failed: {(createMut.error as Error).message}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
