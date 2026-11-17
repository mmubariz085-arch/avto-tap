export interface JsonResponse<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T;
  networkError?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function wakeServerIfNeeded(): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });
    window.clearTimeout(timer);
  } catch {
    // ignore wakeup failures
  }
}

export async function postJsonWithRetry<T = Record<string, unknown>>(
  url: string,
  body: unknown,
  options?: {
    token?: string | null;
    retries?: number;
    timeoutMs?: number;
  }
): Promise<JsonResponse<T>> {
  const maxAttempts = (options?.retries ?? 2) + 1;
  const timeoutMs = options?.timeoutMs ?? 15000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (options?.token) {
        headers.Authorization = `Bearer ${options.token}`;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      window.clearTimeout(timer);

      const rawText = await res.text();
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
      } catch {
        parsed = null;
      }

      // If proxy/gateway returned HTML or 5xx while container was waking up, retry after waking
      const isTransientGateway = res.status >= 500 || parsed === null;
      if (isTransientGateway && attempt < maxAttempts - 1) {
        await wakeServerIfNeeded();
        await sleep(500 * (attempt + 1));
        continue;
      }

      if (parsed === null) {
        return {
          ok: false,
          status: res.status || 502,
          data: { error: 'Server oyanır, zəhmət olmasa yenidən cəhd edin.' } as T,
          networkError: true,
        };
      }

      return {
        ok: res.ok,
        status: res.status,
        data: parsed as T,
      };
    } catch {
      if (attempt < maxAttempts - 1) {
        await wakeServerIfNeeded();
        await sleep(500 * (attempt + 1));
        continue;
      }
      return {
        ok: false,
        status: 0,
        data: { error: 'Serverlə əlaqə yaradılmadı. İnterneti yoxlayıb yenidən cəhd edin.' } as T,
        networkError: true,
      };
    }
  }

  return {
    ok: false,
    status: 0,
    data: { error: 'Serverlə əlaqə yaradılmadı. Yenidən cəhd edin.' } as T,
    networkError: true,
  };
}
