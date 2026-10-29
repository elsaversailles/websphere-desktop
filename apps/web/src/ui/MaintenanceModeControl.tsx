import { useEffect, useId, useRef, useState } from 'react';

export function MaintenanceModeControl({ active, busy, description, onToggle, onSchedule }: {
  active: boolean;
  busy: boolean;
  description: string;
  onToggle: () => void;
  onSchedule: () => void;
}) {
  const [open, setOpen] = useState(false);
  const controls = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const scheduleButton = useRef<HTMLButtonElement>(null);
  const optionsId = useId();
  useEffect(() => {
    if (!open) return;
    scheduleButton.current?.focus();
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!controls.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return <div className={`security-row maintenance-mode-row ${active ? 'danger' : ''}`}>
    <div className="maintenance-mode-copy"><strong>Maintenance Mode</strong><span>{description}</span></div>
    <div className="maintenance-controls" ref={controls}>
      <button type="button" className={active ? 'btn-red btn-sm' : 'btn-o btn-sm'} disabled={busy} onClick={() => { setOpen(false); onToggle(); }}>{busy ? 'Saving…' : active ? 'End Maintenance' : 'Enable Now'}</button>
      <button type="button" className="btn-o btn-sm maintenance-options-toggle" ref={trigger} disabled={busy} aria-label="More maintenance actions" aria-expanded={open} aria-controls={optionsId} onClick={() => setOpen((value) => !value)}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open ? <div className="maintenance-options" id={optionsId}>
        <button type="button" ref={scheduleButton} disabled={busy || active} onClick={() => { setOpen(false); onSchedule(); }}>Schedule &amp; Announce</button>
      </div> : null}
    </div>
  </div>;
}
