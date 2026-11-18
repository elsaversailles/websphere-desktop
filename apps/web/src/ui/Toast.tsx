import { createPortal } from 'react-dom';

type ToastProps = { message: string | null; onDismiss: () => void };

export function Toast({ message, onDismiss }: ToastProps) {
  if (!message) return null;
  return createPortal(<button role="status" aria-live="polite" className="toast" onClick={onDismiss} type="button">{message}</button>, document.body);
}
