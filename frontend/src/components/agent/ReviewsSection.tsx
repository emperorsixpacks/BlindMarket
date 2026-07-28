import { useState } from 'react';
import { SectionRule, Button, FormTextarea, EmptyState } from '../bb';
import { truncateAddress } from '../../lib/utils';
import { submitReview } from '../../services/marketplace';
import type { AgentReview, AgentReviewStats } from '../../services/marketplace';

/**
 * Reputation, promoted out of a tab: the average + star distribution buyers
 * actually scan before hiring, then the reviews themselves.
 */
export function ReviewsSection({
  agentWallet,
  reviews,
  stats,
  onSubmitted,
}: {
  agentWallet?: string;
  reviews: AgentReview[];
  stats: AgentReviewStats | null;
  onSubmitted: () => Promise<void>;
}) {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const dist: Record<number, number> = stats?.distribution ?? {};
  const hasStats = !!stats && stats.totalReviews > 0;

  async function handleSubmit() {
    if (!agentWallet) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await submitReview({
        taskId: '',
        agentAddress: agentWallet,
        rating,
        review: text.trim() || undefined,
      });
      setText('');
      setRating(5);
      await onSubmitted();
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section id="reviews" className="scroll-mt-6">
      <SectionRule num="02" title="Reviews" side={hasStats ? `${stats!.totalReviews} total` : undefined} />

      <div className="space-y-5">
        {/* Rating summary — big average on the left, per-star
            histogram bars on the right (relative to the busiest row). */}
        {hasStats && (
          <div className="flex flex-col sm:flex-row gap-6 sm:items-center border border-line p-5">
            <div className="shrink-0 sm:pr-6 sm:border-r border-line">
              <div className="font-mono text-4xl font-bold text-cream tabular-nums">{stats!.avgRating.toFixed(2)}</div>
              <div className="mt-1 text-sm text-cream" aria-hidden>
                {'★'.repeat(Math.round(stats!.avgRating))}
                <span className="text-ink-3">{'★'.repeat(5 - Math.round(stats!.avgRating))}</span>
              </div>
              <div className="mt-1 font-mono text-[11px] text-ink-3">{stats!.totalReviews} reviews</div>
            </div>
            <div className="flex-1 space-y-1.5 min-w-0">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = dist[star] ?? 0;
                const max = Math.max(1, ...[1, 2, 3, 4, 5].map((s) => dist[s] ?? 0));
                return (
                  <div key={star} className="flex items-center gap-3 font-mono text-[11px] text-ink-3">
                    <span className="w-14 shrink-0">{star} star{star > 1 ? 's' : ''}</span>
                    <div className="flex-1 h-1.5 bg-surface-2">
                      <div className="h-full bg-cream" style={{ width: `${(count / max) * 100}%` }} />
                    </div>
                    <span className="w-6 text-right text-ink-2">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Review list */}
        {reviews.length === 0 ? (
          <EmptyState icon="list" title="No reviews yet" description="This agent hasn't been reviewed yet." />
        ) : (
          <div className="space-y-3">
            {reviews.map((r) => (
              <div key={r.id} className="border border-line p-4">
                <div className="flex items-center gap-3 mb-1.5">
                  <span className="text-ink font-mono text-sm">
                    {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                  </span>
                  <span className="text-[11px] text-ink-3 font-mono">{truncateAddress(r.reviewer_address)}</span>
                  <span className="text-[11px] text-ink-3">{new Date(r.created_at).toLocaleDateString()}</span>
                </div>
                {r.review && <p className="text-sm text-ink-2 leading-relaxed">{r.review}</p>}
              </div>
            ))}
          </div>
        )}

        {/* Submit review form */}
        <div className="border border-line p-5">
          <div className="text-sm font-medium text-ink mb-3">Leave a review</div>
          <div className="flex items-center gap-1 mb-3">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                aria-label={`Rate ${star} out of 5`}
                onClick={() => setRating(star)}
                className={`text-lg transition-colors ${star <= rating ? 'text-cream' : 'text-ink-3'}`}
              >
                ★
              </button>
            ))}
            <span className="text-xs text-ink-3 ml-2">{rating}/5</span>
          </div>
          <FormTextarea
            rows={3}
            placeholder="Share your experience with this agent…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex items-center gap-3 mt-3">
            <Button
              variant="primary"
              size="sm"
              label={submitting ? 'Submitting…' : 'Submit review'}
              disabled={submitting}
              onClick={handleSubmit}
            />
            {submitError && <span className="text-xs text-err">{submitError}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
