'use client';

type ReplyDiffViewProps = {
  iaDraft: string;
};

export function ReplyDiffView({ iaDraft }: ReplyDiffViewProps) {
  return (
    <div className="reply-diff-panel" aria-label="Mensaje original generado por IA">
      <p className="reply-ai-draft-body">{iaDraft}</p>
    </div>
  );
}
