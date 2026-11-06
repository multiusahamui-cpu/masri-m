// Klien API Masri-M. Semua request lewat proxy Vite (/api -> http://localhost:4000)
// sehingga cookie sesi httpOnly otomatis ikut terkirim.

export interface ApiErrorDetail { field: string; message: string }

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: ApiErrorDetail[]) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Tidak dapat terhubung ke server API. Pastikan `pnpm dev:server` berjalan.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details: ApiErrorDetail[] | undefined = Array.isArray(data.details) ? data.details : undefined;
    const msg = details?.length ? `${data.error}: ${details.map((d) => d.message).join(', ')}` : data.error;
    throw new ApiError(res.status, msg || `Request gagal (${res.status})`, details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

export const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
