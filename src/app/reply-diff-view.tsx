'use client';

import { computeWordDiff } from '@/lib/reply-diff';

type ReplyDiffViewProps = {
  iaDraft: string;
  sent: string;
};

export function ReplyDiffView({ iaDraft, sent }: ReplyDiffViewProps) {
  const segments = computeWordDiff(iaDraft, sent);

  return (
    <div className="reply-diff-panel" aria-label="Comparacion entre borrador IA y enviado">
      <div className="reply-diff-legend" aria-hidden="true">
        <span className="reply-diff-legend-item added">Agregado en enviado</span>
        <span className="reply-diff-legend-item removed">Quitado de IA</span>
      </div>
      <div className="reply-diff-body">
        {segments.map((segment, index) => (
          <span
            className={`reply-diff-segment diff-${segment.type}`}
            key={`${segment.type}-${index}`}
          >
            {segment.text}
          </span>
        ))}
      </div>
    </div>
  );
}
