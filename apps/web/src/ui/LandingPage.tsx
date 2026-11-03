import type { MouseEvent } from 'react';
import landingMarkup from './landing-reference.html?raw';
import './landing-reference.css';

type LandingPageProps = { onGetStarted: (mode: 'login' | 'register') => void; notify: (message: string) => void };

export function LandingPage({ onGetStarted, notify }: LandingPageProps) {
  function handleClick(event: MouseEvent<HTMLElement>) {
    const target = (event.target as Element).closest<HTMLElement>('[data-auth], [data-android]');
    if (target?.dataset.auth === 'login' || target?.dataset.auth === 'register') onGetStarted(target.dataset.auth);
    if (target?.dataset.android) notify('The Android app is coming soon!');
  }

  return <main className="landing-reference" onClick={handleClick} dangerouslySetInnerHTML={{ __html: landingMarkup }} />;
}
