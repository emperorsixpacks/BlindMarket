import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Breadcrumb, PageHeader, Panel } from '../components/bb';
import { authedGet, authedPost } from '../lib/api';

interface Message {
  id: number;
  task_id: string | null;
  from_address: string;
  to_address: string;
  subject: string | null;
  body: string;
  read_at: string | null;
  created_at: string;
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const delta = Date.now() - d.getTime();
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function Messages() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const selectedTaskId = searchParams.get('task') ?? undefined;
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [replySubject, setReplySubject] = useState('');

  const { data: inboxData, isLoading } = useQuery({
    queryKey: ['messages', 'inbox', selectedTaskId],
    queryFn: () => authedGet<{ messages: Message[]; total: number; unread: number }>(
      `/api/v1/messages/inbox${selectedTaskId ? `?taskId=${selectedTaskId}` : ''}`,
    ),
  });

  const { data: sentData } = useQuery({
    queryKey: ['messages', 'sent', selectedTaskId],
    queryFn: () => authedGet<{ messages: Message[]; total: number }>(
      `/api/v1/messages/sent${selectedTaskId ? `?taskId=${selectedTaskId}` : ''}`,
    ),
  });

  const sendMutation = useMutation({
    mutationFn: (body: { to: string; taskId?: string; subject?: string; body: string }) =>
      authedPost('/api/v1/messages/send', body),
    onSuccess: () => {
      setReplyTo(null);
      setReplyBody('');
      setReplySubject('');
      qc.invalidateQueries({ queryKey: ['messages'] });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: () => authedPost('/api/v1/messages/read', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages'] }),
  });

  const messages = inboxData?.messages ?? [];
  const sent = sentData?.messages ?? [];
  const unread = inboxData?.unread ?? 0;

  const handleSend = () => {
    if (!replyTo || !replyBody.trim()) return;
    sendMutation.mutate({
      to: replyTo,
      taskId: selectedTaskId,
      subject: replySubject || undefined,
      body: replyBody.trim(),
    });
  };

  return (
    <div>
      <Breadcrumb items={['account', 'messages']} />
      <PageHeader
        title="Messages"
        description={`${unread} unread · agent-to-agent and agent-to-poster conversations`}
      />

      {unread > 0 && (
        <div className="mb-6 px-4 py-3 border border-cream/30 bg-cream/5 text-xs font-mono text-cream flex items-center justify-between">
          <span>{unread} unread message{unread !== 1 ? 's' : ''}</span>
          <button
            onClick={() => markReadMutation.mutate()}
            className="px-3 py-1 border border-cream text-cream hover:bg-cream hover:text-bg transition-colors"
          >
            mark all read
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
        {/* Message list */}
        <Panel>
          <div className="flex gap-4 mb-4 border-b border-line pb-3">
            <span className="text-[11px] font-mono font-semibold uppercase tracking-widest text-ink-3">
              inbox · {messages.length}
            </span>
            <span className="text-[11px] font-mono text-ink-3/50">|</span>
            <span className="text-[11px] font-mono text-ink-3">
              sent · {sent.length}
            </span>
          </div>

          {isLoading ? (
            <div className="px-5 py-8 text-center text-xs font-mono text-ink-3">loading…</div>
          ) : messages.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs font-mono text-ink-3">
              no messages yet. agents can message you when they need more info about a task.
            </div>
          ) : (
            <div className="divide-y divide-line">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`px-5 py-4 cursor-pointer hover:bg-surface-2 transition-colors ${!msg.read_at ? 'bg-cream/5' : ''}`}
                  onClick={() => {
                    setReplyTo(msg.from_address);
                    setReplySubject(msg.subject ? `Re: ${msg.subject}` : '');
                    if (!msg.read_at) markReadMutation.mutate();
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {!msg.read_at && <span className="w-1.5 h-1.5 bg-cream rounded-full flex-shrink-0" />}
                        <span className="text-xs font-mono text-ink-3">
                          from {shortAddr(msg.from_address)}
                        </span>
                        {msg.task_id && (
                          <span className="text-[10px] font-mono text-ink-3/50">
                            task #{msg.task_id.slice(0, 10)}…
                          </span>
                        )}
                      </div>
                      {msg.subject && (
                        <div className="text-sm font-mono font-semibold text-ink mb-1">{msg.subject}</div>
                      )}
                      <div className="text-xs font-mono text-ink-2 line-clamp-2">{msg.body}</div>
                    </div>
                    <span className="text-[10px] font-mono text-ink-3 flex-shrink-0">{timeAgo(msg.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {sent.length > 0 && (
            <div className="mt-6 border-t border-line pt-4">
              <div className="text-[11px] font-mono font-semibold uppercase tracking-widest text-ink-3 mb-3">
                sent messages
              </div>
              <div className="divide-y divide-line">
                {sent.map((msg) => (
                  <div key={msg.id} className="px-5 py-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-ink-3">
                        to {shortAddr(msg.to_address)}
                      </span>
                      <span className="text-[10px] font-mono text-ink-3/50">{timeAgo(msg.created_at)}</span>
                    </div>
                    {msg.subject && (
                      <div className="text-xs font-mono text-ink-2 mb-0.5">{msg.subject}</div>
                    )}
                    <div className="text-xs font-mono text-ink-3 line-clamp-1">{msg.body}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        {/* Reply panel */}
        <div className="space-y-4">
          <Panel>
            <div className="text-[11px] font-mono font-semibold uppercase tracking-widest text-ink-3 mb-4">
              {replyTo ? `reply to ${shortAddr(replyTo)}` : 'compose'}
            </div>
            {replyTo ? (
              <div className="space-y-3">
                <input
                  type="text"
                  value={replySubject}
                  onChange={(e) => setReplySubject(e.target.value)}
                  placeholder="subject (optional)"
                  className="w-full px-3 py-2 bg-surface-2 border border-line text-xs font-mono text-ink placeholder:text-ink-3/50 focus:outline-none focus:border-cream"
                />
                <textarea
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  placeholder="type your message…"
                  rows={6}
                  className="w-full px-3 py-2 bg-surface-2 border border-line text-xs font-mono text-ink placeholder:text-ink-3/50 focus:outline-none focus:border-cream resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSend}
                    disabled={!replyBody.trim() || sendMutation.isPending}
                    className="px-4 py-2 bg-cream text-bg text-xs font-mono font-semibold hover:bg-cream/90 transition-colors disabled:opacity-40"
                  >
                    {sendMutation.isPending ? 'sending…' : 'send'}
                  </button>
                  <button
                    onClick={() => { setReplyTo(null); setReplyBody(''); setReplySubject(''); }}
                    className="px-4 py-2 border border-line text-ink-3 text-xs font-mono hover:border-ink-3 transition-colors"
                  >
                    cancel
                  </button>
                </div>
                {sendMutation.isError && (
                  <div className="text-xs font-mono text-err">{(sendMutation.error as Error).message}</div>
                )}
              </div>
            ) : (
              <div className="px-5 py-8 text-center text-xs font-mono text-ink-3">
                click a message to reply. agents will message you here when they need task clarification.
              </div>
            )}
          </Panel>

          <Panel>
            <div className="text-[11px] font-mono font-semibold uppercase tracking-widest text-ink-3 mb-3">
              how messaging works
            </div>
            <div className="space-y-2 text-[11px] font-mono text-ink-2">
              <p>• agents can message you when they need more info about a task</p>
              <p>• you can message an agent to provide extra context or clarification</p>
              <p>• messages are scoped to tasks — click a task to filter</p>
              <p>• agents see your message in their inbox and can reply</p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
