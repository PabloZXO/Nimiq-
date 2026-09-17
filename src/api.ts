export class ApiError extends Error {}
export async function api<T>(path: string, input?: unknown, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 15_000);
  try {
    const response = await fetch(`/api${path}`, {
      method: input === undefined ? 'GET' : 'POST', credentials: 'same-origin',
      headers: input === undefined ? undefined : { 'Content-Type': 'application/json', 'X-Nimduel-Client': '1' },
      body: input === undefined ? undefined : JSON.stringify(input), signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) {
      if (typeof window !== 'undefined' && ['SESSION_REQUIRED', 'VERIFIED_WALLET_REQUIRED', 'NICKNAME_REQUIRED'].includes(data.error)) {
        window.dispatchEvent(new Event('nimduel-auth-required'));
      }
      throw new ApiError(data.error ?? 'SERVER_ERROR');
    }
    return data as T;
  } catch (error) {
    if (signal?.aborted || error instanceof ApiError) throw error;
    throw new ApiError('NETWORK_ERROR');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
export function requestId() {
  // Idempotency identifier, not an authentication credential. Works over LAN HTTP.
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
