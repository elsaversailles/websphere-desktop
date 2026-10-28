import { useEffect, useId, useRef } from 'react';

type ConfirmDialogProps = {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** The shared replacement for browser confirmation dialogs. */
export function ConfirmDialog({ title, description, confirmLabel, destructive = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const titleId = useId();
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);
  return <div className="modal-ov open" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="modal-box security-modal action-confirm-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="modal-ttl"><span id={titleId}>{title}</span><button type="button" className="modal-close" aria-label={`Close ${title}`} onClick={onCancel}>×</button></div>
      <p className="security-modal-help">{description}</p>
      <div className="modal-acts"><button type="button" className="btn-o" onClick={onCancel}>Cancel</button><button ref={confirmButton} type="button" className={`btn ${destructive ? 'btn-red' : ''}`} onClick={onConfirm}>{confirmLabel}</button></div>
    </section>
  </div>;
}
