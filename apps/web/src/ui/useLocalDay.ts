import { useEffect, useState } from 'react';
import { localDateKey } from './dates';

/** Keep date-based displays current while the page stays open or returns from the background. */
export function useLocalDay(): string {
  const [day, setDay] = useState(() => localDateKey());
  useEffect(() => {
    const update = () => setDay(localDateKey());
    const timer = window.setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, []);
  return day;
}
