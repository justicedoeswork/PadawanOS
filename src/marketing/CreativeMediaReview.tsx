import { useCallback, useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Spinner } from '@astryxdesign/core/Spinner';
import { decideCreativeCandidate, getCreativeCandidateReviews, redoCreativeCandidate, type MarketingApiError } from './client';
import type { CreativeCandidateReview } from './types';
import './CreativeMediaReview.css';

function previewUrl(candidateId: string, variant: 'ORIGINAL' | 'GENERATED'): string {
  return '/api/marketing/media/candidates/' + encodeURIComponent(candidateId) + '/preview?variant=' + variant;
}

function MediaPreview({ item, variant }: { item: CreativeCandidateReview; variant: 'ORIGINAL' | 'GENERATED' }) {
  const mime = variant === 'ORIGINAL' ? item.originalAsset.mimeType : item.derivedAsset?.mimeType;
  if (variant === 'GENERATED' && !item.derivedAsset) return <p className="creative-review-muted">No generated version for this item.</p>;
  if (!mime) return <p className="creative-review-muted">Preview unavailable.</p>;
  const src = previewUrl(item.candidateId, variant);
  return mime.startsWith('video/')
    ? <video className="creative-review-media" controls preload="metadata" src={src} aria-label={variant.toLowerCase() + ' preview for ' + item.project.name} />
    : <img className="creative-review-media" src={src} alt={variant.toLowerCase() + ' image for ' + item.project.name} loading="lazy" />;
}

export function CreativeMediaReview() {
  const [items, setItems] = useState<readonly CreativeCandidateReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<MarketingApiError | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [redoPrompts, setRedoPrompts] = useState<Record<string, string>>({});
  const [redoProviders, setRedoProviders] = useState<Record<string, 'runway' | 'higgsfield'>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    const result = await getCreativeCandidateReviews(signal, ['READY_FOR_CAMPAIGN']);
    if (result.ok) { setItems(result.data.items.filter((item) => item.status === 'READY_FOR_CAMPAIGN')); setError(null); }
    else setError(result.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const decide = async (item: CreativeCandidateReview, decision: 'APPROVED' | 'REJECTED') => {
    if (busyId) return;
    setBusyId(item.candidateId);
    setError(null);
    try {
      const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'creative-' + item.candidateId + '-' + Date.now();
      const result = await decideCreativeCandidate(item.candidateId, decision, notes[item.candidateId] ?? '', key);
      if (!result.ok) { setError(result.error); return; }
      setItems((current) => current.filter((candidate) => candidate.candidateId !== item.candidateId));
    } finally {
      setBusyId(null);
    }
  };

  const redo = async (item: CreativeCandidateReview) => {
    if (busyId) return;
    setBusyId(item.candidateId);
    setError(null);
    setStatusMessage(null);
    try {
      const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'redo-' + item.candidateId + '-' + Date.now();
      const provider = redoProviders[item.candidateId] ?? (item.transformation?.provider === 'runway' ? 'higgsfield' : 'runway');
      const prompt = redoPrompts[item.candidateId]?.trim();
      const result = await redoCreativeCandidate(item.candidateId, { provider, ...(prompt ? { prompt } : {}) }, key);
      if (!result.ok) { setError(result.error); return; }
      setItems((current) => current.filter((candidate) => candidate.candidateId !== item.candidateId));
      setStatusMessage(result.data.jobId
        ? `Redo submitted to ${result.data.provider} / ${result.data.model}. The item will return to review when generation finishes.`
        : `Redo was not submitted because its plan needs review (${result.data.planStatus}). No generation job was started.`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="creative-review" aria-labelledby="creative-review-title">
      <div className="creative-review-heading">
        <div>
          <h2 id="creative-review-title">Individual media review</h2>
          <p>Review one photo or video at a time. Approvals do not schedule or publish content.</p>
        </div>
        <Button variant="secondary" size="sm" label="Refresh" isDisabled={loading || Boolean(busyId)} clickAction={() => void refresh()} />
      </div>
      {statusMessage && <p className="creative-review-muted" role="status">{statusMessage}</p>}
      {error && <p className="creative-review-error" role="alert">{error.message || 'The media review service could not be reached.'}</p>}
      {loading && <div className="creative-review-loading"><Spinner size="sm" label="Loading media" /></div>}
      {!loading && items.length === 0 && !error && <p className="creative-review-muted">No generated media is waiting for review.</p>}
      <div className="creative-review-list">
        {items.map((item) => (
          <article className="creative-review-card" key={item.candidateId}>
            <header>
              <div><h3>{item.project.name}</h3><p>{item.contentCategory.replaceAll('_', ' ')} · {item.stillOrVideo.toLowerCase()}</p></div>
              <span className="creative-review-status">{item.status.replaceAll('_', ' ').toLowerCase()}</span>
            </header>
            <div className="creative-review-previews">
              <div><h4>Original · {item.originalAsset.filename}</h4><MediaPreview item={item} variant="ORIGINAL" /></div>
              <div><h4>Proposed · {item.transformation?.provider ?? 'Original media'}{item.transformation?.model ? ' / ' + item.transformation.model : ''}</h4><MediaPreview item={item} variant="GENERATED" /></div>
            </div>
            {item.transformation && <details><summary>Generation details</summary><dl>
              <dt>Prompt</dt><dd>{item.transformation.prompt}</dd>
              <dt>Why this format</dt><dd>{item.whyThisFormat.join(' · ') || '—'}</dd>
              <dt>Estimated spend</dt><dd>{item.cost.estimatedCostUsd === null ? 'Not available' : '$' + item.cost.estimatedCostUsd.toFixed(2)}</dd>
              <dt>Actual spend</dt><dd>{item.cost.realizedCostUsd === null ? 'Not reported' : '$' + item.cost.realizedCostUsd.toFixed(2)}</dd>
            </dl></details>}
            {item.captionDraft && <p className="creative-review-caption">{item.captionDraft}</p>}
            <label className="creative-review-note">Decision note<textarea value={notes[item.candidateId] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [item.candidateId]: event.target.value }))} rows={2} /></label>
            <label className="creative-review-note">Redo instructions (optional)<textarea value={redoPrompts[item.candidateId] ?? ''} onChange={(event) => setRedoPrompts((current) => ({ ...current, [item.candidateId]: event.target.value }))} rows={2} placeholder="Leave blank to reuse the current prompt." /></label>
            <label className="creative-review-note">Provider for redo<select value={redoProviders[item.candidateId] ?? (item.transformation?.provider === 'runway' ? 'higgsfield' : 'runway')} onChange={(event) => setRedoProviders((current) => ({ ...current, [item.candidateId]: event.target.value as 'runway' | 'higgsfield' }))}>
              <option value="runway">Runway</option><option value="higgsfield">Higgsfield.ai</option>
            </select></label>
            <footer>
              {item.status !== 'REJECTED' && <Button variant="secondary" size="sm" label={busyId === item.candidateId ? 'Working…' : 'Reject'} isDisabled={Boolean(busyId)} clickAction={() => void decide(item, 'REJECTED')} />}
              <Button variant="secondary" size="sm" label={busyId === item.candidateId ? 'Working…' : `Redo with ${redoProviders[item.candidateId] ?? (item.transformation?.provider === 'runway' ? 'Higgsfield' : 'Runway')}`} isDisabled={Boolean(busyId)} clickAction={() => void redo(item)} />
              {item.status !== 'REJECTED' && <Button variant="primary" size="sm" label={busyId === item.candidateId ? 'Working…' : 'Approve item'} isDisabled={Boolean(busyId)} clickAction={() => void decide(item, 'APPROVED')} />}
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}
