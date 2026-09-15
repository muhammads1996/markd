import { createSupabaseServerClient } from "./supabase/server";

type RequestOptions = {
  body?: BodyInit;
  headers?: Record<string, string>;
  method?: string;
};

export type MarkdApiClient = {
  json<T>(path: string, options?: RequestOptions): Promise<T>;
  upload<T>(path: string, body: FormData, idempotencyKey: string): Promise<T>;
};

class MarkdApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function apiUrl(path: string): string {
  const baseUrl = process.env.MARKD_API_URL ?? "http://127.0.0.1:8000";
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

async function authenticatedHeaders(): Promise<Record<string, string>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new MarkdApiError("An active operator session is required.", 401);
  }
  return {
    Authorization: `Bearer ${data.session.access_token}`,
    "X-Correlation-Id": crypto.randomUUID(),
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    { detail?: string; error?: string } | T | null;
  if (!response.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body
        ? body.detail
        : body && typeof body === "object" && "error" in body
          ? body.error
          : undefined;
    throw new MarkdApiError(
      typeof detail === "string" ? detail : "The API request failed.",
      response.status,
    );
  }
  return body as T;
}

export async function createMarkdApiClient(): Promise<MarkdApiClient> {
  const request = async <T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> => {
    const authHeaders = await authenticatedHeaders();
    const response = await fetch(apiUrl(path), {
      ...options,
      headers: {
        ...authHeaders,
        ...options.headers,
      },
    });
    return parseResponse<T>(response);
  };

  return {
    json: request,
    upload: async <T>(path: string, body: FormData, idempotencyKey: string) =>
      request<T>(path, {
        body,
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
      }),
  };
}

export { MarkdApiError };
