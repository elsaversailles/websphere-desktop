import { request, type Session } from './api';

type Mode = 'login' | 'register' | 'link';
const pendingKey = 'ws_google_flow';
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export async function startGoogle(mode: Mode) {
  const verifier = hex(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const { url } = await request<{ url: string }>('/auth/google/start', {
    method: 'POST', body: JSON.stringify({ mode, clientType: 'web', challenge }),
  });
  sessionStorage.setItem(pendingKey, JSON.stringify({ verifier, mode }));
  window.location.assign(url);
}

let pendingExchange: Promise<Session | { linked: true } | null> | undefined;
export function finishGoogle() {
  if (pendingExchange) return pendingExchange;
  const url = new URL(window.location.href);
  const code = url.searchParams.get('googleCode');
  const error = url.searchParams.get('googleError');
  if (!code && !error) return Promise.resolve(null);
  const saved = sessionStorage.getItem(pendingKey);
  sessionStorage.removeItem(pendingKey);
  url.searchParams.delete('googleCode');
  url.searchParams.delete('googleError');
  window.history.replaceState(null, '', url);
  pendingExchange = (async () => {
    if (error) throw new Error(error === 'cancelled' ? 'Google sign-in was cancelled.' : 'Google sign-in failed. Try again or use your password.');
    if (!saved) throw new Error('Google sign-in expired. Please try again.');
    const { verifier } = JSON.parse(saved) as { verifier: string; mode: Mode };
    return request<Session | { linked: true }>('/auth/google/exchange', {
      method: 'POST', body: JSON.stringify({ code, verifier }), skipSessionInvalidation: true, skipAuthRetry: true,
    });
  })().finally(() => { pendingExchange = undefined; });
  return pendingExchange;
}
