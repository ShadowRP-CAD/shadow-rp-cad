export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const AUTH_STORAGE_KEY = 'srp.webAuthToken';

if (typeof window !== 'undefined' && window.location.hash.startsWith('#auth_token=')) {
  const token = decodeURIComponent(window.location.hash.slice('#auth_token='.length));
  if (/^[A-Za-z0-9_-]{32,}$/.test(token)) window.localStorage.setItem(AUTH_STORAGE_KEY, token);
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`);
}

export function webAuthToken() {
  return typeof window === 'undefined' ? '' : window.localStorage.getItem(AUTH_STORAGE_KEY) || '';
}

export function authHeaders() {
  const token = webAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function clearWebAuthToken() {
  if (typeof window !== 'undefined') window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

export async function api(path, options = {}) {
  const { headers = {}, ...requestOptions } = options;
  const response = await fetch(`${API_URL}/api${path}`, {
    credentials: 'include',
    ...requestOptions,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...headers }
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export function socketUrl() {
  const url = new URL(API_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  const token = webAuthToken();
  if (token) url.searchParams.set('token', token);
  return url.toString();
}
