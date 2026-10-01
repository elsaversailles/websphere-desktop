import type { OAuthTokens } from './connectors.js';

// Split out of connectors.ts so canva-mcp.ts can reuse the same request/parsing helpers without
// creating a circular import (connectors.ts also imports the finished Canva connector back).
export type OAuthPayload = { access_token?: string; refresh_token?: string; expires_in?: number };

export const tokensFrom = (payload: OAuthPayload, refreshToken?: string): OAuthTokens => {
  if (!payload.access_token) throw new Error('OAUTH_EXCHANGE_FAILED');
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token ?? refreshToken, expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : undefined };
};

export const requestForm = async (url: string, body: URLSearchParams, headers: Record<string, string> = {}) => {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: body.toString() });
  if (!response.ok) throw new Error('OAUTH_EXCHANGE_FAILED');
  return response.json() as Promise<OAuthPayload>;
};

export const requestTokenJson = async (url: string, body: Record<string, string>) => {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('OAUTH_EXCHANGE_FAILED');
  return response.json() as Promise<OAuthPayload>;
};

export const requestJson = async (url: string, accessToken: string) => {
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error('INTEGRATION_SYNC_FAILED');
  return response.json() as Promise<any>;
};
