import { vi } from "vitest";

export interface MockResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export function createMockFetch(defaultResponse: MockResponse = {}) {
  const {
    status = 200,
    body = {},
    headers = {},
  } = defaultResponse;

  const mockFetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    }),
  );

  return mockFetch;
}

export function mockFetchResponse(
  mockFetch: ReturnType<typeof createMockFetch>,
  response: MockResponse,
) {
  const { status = 200, body = {}, headers = {} } = response;

  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    }),
  );
}

export function mockFetchError(
  mockFetch: ReturnType<typeof createMockFetch>,
  error: Error,
) {
  mockFetch.mockRejectedValueOnce(error);
}

export function getLastFetchCall(mockFetch: ReturnType<typeof createMockFetch>) {
  const calls = mockFetch.mock.calls;
  if (calls.length === 0) throw new Error("No fetch calls recorded");
  const lastCall = calls[calls.length - 1];
  return {
    url: String(lastCall[0]),
    init: lastCall[1] as RequestInit,
  };
}

export function getLastFetchHeaders(mockFetch: ReturnType<typeof createMockFetch>) {
  const { init } = getLastFetchCall(mockFetch);
  return init.headers as Record<string, string>;
}
