import { request } from './api';

export type PushStatus = 'enabled' | 'disabled' | 'blocked' | 'unsupported';

function supported() {
  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

function applicationServerKey(publicKey: string) {
  const padded = `${publicKey}${'='.repeat((4 - publicKey.length % 4) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = atob(padded);
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

async function registration() {
  return navigator.serviceWorker.register('/sw.js');
}

export async function pushStatus(): Promise<PushStatus> {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const current = await navigator.serviceWorker.getRegistration();
  return (await current?.pushManager.getSubscription()) ? 'enabled' : 'disabled';
}

export async function enablePush() {
  if (!supported()) throw new Error('This browser does not support push notifications.');
  const config = await request<{ enabled: boolean; publicKey?: string }>('/push/config');
  if (!config.enabled || !config.publicKey) throw new Error('Push notifications are not configured on the server.');
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') throw new Error('Browser notification permission was not granted.');
  const worker = await registration();
  const current = await worker.pushManager.getSubscription();
  const subscription = current ?? await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config.publicKey) });
  const data = subscription.toJSON();
  if (!data.endpoint || !data.keys?.p256dh || !data.keys.auth) throw new Error('The browser returned an incomplete push subscription.');
  await request('/push/subscribe', { method: 'POST', body: JSON.stringify({ endpoint: data.endpoint, keys: { p256dh: data.keys.p256dh, auth: data.keys.auth } }) });
}

export async function disablePush() {
  if (!supported()) return;
  const worker = await navigator.serviceWorker.getRegistration();
  const subscription = await worker?.pushManager.getSubscription();
  if (!subscription) return;
  await request('/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) });
  await subscription.unsubscribe();
}
