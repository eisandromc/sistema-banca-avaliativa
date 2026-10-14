/** Cliente HTTP da API. Envia cookies de sessão e o cabeçalho anti-CSRF exigido pelo servidor. */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = 'ERROR',
    public details?: unknown,
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        'x-banca-csrf': '1',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Verifique a rede.', 'NETWORK');
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `Erro ${res.status}`, data?.code ?? 'ERROR', data?.details);
  }
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  put: <T = any>(url: string, body: unknown = {}) => request<T>('PUT', url, body),
  patch: <T = any>(url: string, body: unknown = {}) => request<T>('PATCH', url, body),
  del: <T = any>(url: string) => request<T>('DELETE', url),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Erro inesperado.';
}
