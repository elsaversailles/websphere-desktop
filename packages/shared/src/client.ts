import type { ApiError } from './index.js';

export class WebSphereClient {
  private access?: string;
  constructor(private readonly baseUrl = (globalThis as { WEBSHERE_API_URL?: string }).WEBSHERE_API_URL ?? 'http://localhost:3000') {}
  setAccessToken(token?: string) { this.access = token; }
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(this.access ? { authorization: `Bearer ${this.access}` } : {}), ...init.headers },
    });
    if (!response.ok) throw (await response.json()) as ApiError;
    return response.json() as Promise<T>;
  }
  register(input: unknown) { return this.request('/auth/register', { method: 'POST', body: JSON.stringify(input) }); }
  login(input: unknown, admin = false) { return this.request(`/auth/${admin ? 'admin/' : ''}login`, { method: 'POST', body: JSON.stringify(input) }); }
  dashboard() { return this.request('/dashboard'); }
  askAi(input: unknown) { return this.request('/ai/ask', { method: 'POST', body: JSON.stringify(input) }); }
}

export const openApiClientPlaceholder = { name: 'WebSphere generated OpenAPI client', version: 'pending-openapi-generation' };
