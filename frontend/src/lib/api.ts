/**
 * Fetch wrapper for the FastAPI backend.
 * Attaches the current Supabase access token and turns the backend's
 * { error: { code, message } } responses into ApiError exceptions.
 */
import { env } from './env';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** No request may hang forever (a stuck request would mean an endless spinner). */
const REQUEST_TIMEOUT_MS = 20_000;

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  // getSession() returns the stored session and refreshes it first if it has expired.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${env.apiBaseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    const timedOut = controller.signal.aborted;
    throw new ApiError(
      0,
      timedOut ? 'timeout' : 'network_error',
      timedOut
        ? 'The server took too long to respond. Please try again.'
        : 'Cannot reach the server. Check your connection and try again.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const err = payload?.error;
    throw new ApiError(response.status, err?.code ?? `http_${response.status}`, err?.message ?? 'Request failed');
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

/** Download a file (e.g. a CSV report) with the user's token and save it. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const response = await fetch(`${env.apiBaseUrl}${path}`, {
    headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {},
  }).catch(() => {
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Check your connection and try again.');
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(response.status, payload?.error?.code ?? 'download_failed', payload?.error?.message ?? 'Download failed.');
  }
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Root URL of the backend (without /api/v1), for /health. */
export const backendRoot = env.apiBaseUrl.replace(/\/api\/v1$/, '');
