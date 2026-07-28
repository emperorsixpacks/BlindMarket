import { useState, useEffect, useCallback, useRef } from 'react';
import { parseEther, formatUnits } from 'ethers';
import {
  SectionRule,
  Tag,
  Button,
  FormField,
  FormInput,
  FormTextarea,
  LoadingState,
  EmptyState,
  ErrorState,
} from '../bb';
import {
  getAgentServices,
  createService,
  updateService,
  deleteService,
} from '../../services/marketplace';
import type { AgentService } from '../../services/marketplace';
import { ChoiceChip } from './ChoiceChip';
import UseServiceModal from '../UseServiceModal';
import UseFromAgentModal from '../UseFromAgentModal';

/**
 * The storefront. The public list is owned by the page (the header from-price
 * and the sold stat read the same rows); this section owns only the owner's
 * manage list and the rent modals.
 */
export function ServicesSection({
  agentId,
  isOwner,
  symbol,
  agentStatus,
  services,
  loading,
  loadError,
  onReload,
  onLinkOwner,
}: {
  agentId: string;
  isOwner: boolean;
  symbol: string;
  agentStatus: string;
  services: AgentService[] | null;
  loading: boolean;
  loadError: boolean;
  onReload: () => Promise<void>;
  onLinkOwner: () => Promise<void>;
}) {
  const [useService, setUseService] = useState<AgentService | null>(null);
  // "Use from your agent" — copyable prompt/script for the buyer's OWN agent
  // to run this rent flow headlessly (works even while this agent is stopped:
  // the copy block is documentation, the task just waits for it to start).
  const [agentUseService, setAgentUseService] = useState<AgentService | null>(null);
  const [needsLink, setNeedsLink] = useState(false);
  const [linking, setLinking] = useState(false);
  const retryRef = useRef<null | (() => Promise<void>)>(null);
  const [ownerServices, setOwnerServices] = useState<AgentService[] | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [serviceType, setServiceType] = useState<'api' | 'a2a'>('api');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const loadOwnerServices = useCallback(async () => {
    if (!isOwner) { setOwnerServices(null); return; }
    try { setOwnerServices(await getAgentServices(agentId)); } catch { /* owner list is additive */ }
  }, [isOwner, agentId]);

  useEffect(() => { loadOwnerServices(); }, [loadOwnerServices]);

  // Any mutation (and a settled Use-now) refreshes both views.
  const load = useCallback(async () => {
    await Promise.all([onReload(), loadOwnerServices()]);
  }, [onReload, loadOwnerServices]);

  const fmt = (wei: string) => {
    try { return `${formatUnits(wei, 18)} ${symbol}`; } catch { return `${wei} wei`; }
  };

  // On an owner-mismatch 403, stash the failed mutation so a one-click
  // "Link this wallet & retry" can re-run it after linking (mirrors Start/Stop).
  function onMutationError(err: unknown, retry: () => Promise<void>) {
    if ((err as { code?: string }).code === 'FORBIDDEN') {
      setNeedsLink(true);
      retryRef.current = retry;
      setFormError("This wallet isn't linked to the agent yet — link it and retry.");
    } else {
      setFormError((err as Error).message);
    }
  }

  async function linkAndRetry() {
    setLinking(true);
    setFormError('');
    try {
      await onLinkOwner();
      setNeedsLink(false);
      const retry = retryRef.current;
      retryRef.current = null;
      if (retry) await retry();
    } catch (err) {
      setFormError((err as Error).message || 'Could not link this wallet');
    } finally {
      setLinking(false);
    }
  }

  async function handleCreate() {
    setFormError('');
    if (name.trim().length < 5) { setFormError('Name must be at least 5 characters.'); return; }
    let priceRaw: string;
    try { priceRaw = parseEther(price || '0').toString(); } catch { setFormError('Enter a valid price.'); return; }
    if (priceRaw === '0') { setFormError('Price must be greater than 0.'); return; }
    setSaving(true);
    try {
      await createService(agentId, { name: name.trim(), description: description.trim(), priceRaw, serviceType });
      setName(''); setDescription(''); setPrice(''); setServiceType('api');
      setNeedsLink(false);
      await load();
    } catch (err) {
      onMutationError(err, handleCreate);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(s: AgentService) {
    try { await updateService(agentId, s.id, { active: !s.active }); await load(); }
    catch (err) { onMutationError(err, () => toggleActive(s)); }
  }
  async function remove(s: AgentService) {
    try { await deleteService(agentId, s.id); await load(); }
    catch (err) { onMutationError(err, () => remove(s)); }
  }

  return (
    <section id="services" className="scroll-mt-6">
      <SectionRule num="01" title="Services" side={services?.length ? `${services.length} listed` : undefined} />

      {loading ? (
        <LoadingState label="Loading services…" />
      ) : loadError ? (
        <ErrorState title="Couldn't load services" onRetry={() => onReload()} />
      ) : (
        <>
          {agentStatus !== 'running' && services && services.length > 0 && (
            <div className="mb-3 text-xs text-ink-3 border border-line bg-surface-2 px-3 py-2">
              This agent is stopped — the owner must start it before it can take calls.
            </div>
          )}
          {services && services.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {services.map(s => (
                <div key={s.id} className="border border-line bg-surface-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-ink font-medium">{s.name}</div>
                    <Tag tone="info">{s.service_type}</Tag>
                  </div>
                  {s.description && <div className="text-xs text-ink-3 mt-1.5">{s.description}</div>}
                  <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-line">
                    <div className="min-w-0">
                      <span className="whitespace-nowrap">
                        <span className="font-mono text-cream text-sm">{fmt(s.price_raw)}</span>
                        <span className="font-mono text-ink-3 text-xs"> / call</span>
                      </span>
                      {s.sold_count > 0 && (
                        <div className="whitespace-nowrap font-mono text-[11px] text-ink-3 mt-0.5">{s.sold_count} sold{s.avg_rating > 0 ? ` · ★ ${s.avg_rating.toFixed(1)}` : ''}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        label="Use from your agent"
                        disabled={!s.agent_public_key}
                        onClick={() => setAgentUseService(s)}
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        label="Use now"
                        disabled={agentStatus !== 'running' || !s.agent_public_key}
                        onClick={() => setUseService(s)}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="briefcase"
              title="No services listed"
              description={isOwner ? 'Publish a service below to let others rent this agent per call.' : 'This agent has no rentable services yet.'}
            />
          )}
        </>
      )}

      {isOwner && (
        <div className="mt-8 pt-6 border-t border-line">
          <div className="text-sm font-semibold text-ink mb-4">Manage services</div>
          <div className="border border-line bg-surface-2 p-4 space-y-4">
            <FormField label="Service name" required>
              <FormInput placeholder="e.g. Market sentiment analysis" value={name} onChange={e => setName(e.target.value)} />
            </FormField>
            <FormField label="Description">
              <FormTextarea rows={2} placeholder="What the buyer gets per call" value={description} onChange={e => setDescription(e.target.value)} />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label={`Price per call (${symbol})`} required>
                <FormInput className="font-mono" placeholder="0.5" value={price} onChange={e => setPrice(e.target.value)} />
              </FormField>
              <FormField label="Type">
                <div className="flex gap-2">
                  {(['api', 'a2a'] as const).map(t => (
                    <ChoiceChip key={t} selected={serviceType === t} onClick={() => setServiceType(t)}>
                      {t}
                    </ChoiceChip>
                  ))}
                </div>
              </FormField>
            </div>
            {formError && <div className="text-xs text-err">{formError}</div>}
            {needsLink && (
              <Button variant="outline" size="sm" label={linking ? 'Linking…' : 'Link this wallet & retry'} disabled={linking} onClick={linkAndRetry} />
            )}
            <Button variant="primary" size="sm" label={saving ? 'Publishing…' : 'Publish service'} disabled={saving} onClick={handleCreate} />
          </div>

          {ownerServices && ownerServices.length > 0 && (
            <div className="mt-4 space-y-2">
              {ownerServices.map(s => (
                <div key={s.id} className="flex items-center justify-between gap-3 border border-line bg-surface-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-ink text-sm truncate">
                      {s.name}{!s.active && <span className="text-ink-3 text-xs"> · inactive</span>}
                    </div>
                    <div className="font-mono text-xs text-ink-3">{fmt(s.price_raw)} / call · {s.service_type}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="ghost" size="sm" label={s.active ? 'Deactivate' : 'Activate'} onClick={() => toggleActive(s)} />
                    <Button variant="ghost" size="sm" label="Delete" onClick={() => remove(s)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {useService && (
        <UseServiceModal
          service={useService}
          symbol={symbol}
          onClose={() => setUseService(null)}
          onSettled={load}
        />
      )}
      {agentUseService && (
        <UseFromAgentModal
          service={agentUseService}
          symbol={symbol}
          onClose={() => setAgentUseService(null)}
        />
      )}
    </section>
  );
}
