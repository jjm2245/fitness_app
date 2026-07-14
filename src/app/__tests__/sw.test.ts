import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";

// Regression guard for the "a response served by a service worker has
// redirections" crash. We load the real public/sw.js into a mock ServiceWorker
// global scope, grab its fetch handler, and drive it with fake requests. The
// key property: a navigation whose network response was *redirected* must come
// back to the browser as a NON-redirected response (or the installed PWA
// bricks). See public/sw.js.

type Handler = (event: { request: { url: string; mode?: string }; respondWith: (p: Promise<Response>) => void }) => void;

function loadServiceWorker(fetchImpl: typeof fetch, cachesImpl: unknown) {
  const listeners: Record<string, Handler> = {};
  const self = {
    addEventListener: (type: string, fn: Handler) => {
      listeners[type] = fn;
    },
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };
  const src = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
  // sw.js references self / caches / fetch as free identifiers; inject them.
  new Function("self", "caches", "fetch", src)(self, cachesImpl, fetchImpl);
  return listeners;
}

async function runFetch(handler: Handler, request: { url: string; mode?: string }): Promise<Response> {
  let captured: Promise<Response> | null = null;
  handler({ request, respondWith: (p) => (captured = p) });
  if (!captured) throw new Error("fetch handler did not call respondWith");
  return captured;
}

const noCaches = {
  match: vi.fn(async () => undefined),
  open: vi.fn(async () => ({ addAll: vi.fn() })),
  keys: vi.fn(async () => []),
  delete: vi.fn(async () => true),
};

describe("service worker fetch handler", () => {
  it("reconstructs a redirected navigation response as non-redirected", async () => {
    // Simulate the auth flow: proxy 307 → /login, fetch follows it → redirected 200.
    const redirected = { redirected: true, status: 200, statusText: "OK", body: "<login/>", headers: new Headers() };
    const fetchImpl = vi.fn(async () => redirected as unknown as Response);
    const { fetch: onFetch } = loadServiceWorker(fetchImpl, noCaches);

    const res = await runFetch(onFetch, { url: "https://app/sessions", mode: "navigate" });
    expect(res.redirected).toBe(false); // the whole point — no redirected response to a navigation
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<login/>");
  });

  it("passes a non-redirected navigation response straight through", async () => {
    const ok = new Response("<home/>", { status: 200 });
    const fetchImpl = vi.fn(async () => ok);
    const { fetch: onFetch } = loadServiceWorker(fetchImpl, noCaches);

    const res = await runFetch(onFetch, { url: "https://app/sessions", mode: "navigate" });
    expect(res.redirected).toBe(false);
    expect(await res.text()).toBe("<home/>");
  });

  it("falls back to the cached shell when a navigation is offline", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const shell = new Response("<shell/>", { status: 200 });
    const caches = { ...noCaches, match: vi.fn(async () => shell) };
    const { fetch: onFetch } = loadServiceWorker(fetchImpl as unknown as typeof fetch, caches);

    const res = await runFetch(onFetch, { url: "https://app/log/abc", mode: "navigate" });
    expect(await res.text()).toBe("<shell/>");
  });

  it("returns 503 for an offline API request (client queues)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const { fetch: onFetch } = loadServiceWorker(fetchImpl as unknown as typeof fetch, noCaches);

    const res = await runFetch(onFetch, { url: "https://app/api/set-logs", mode: "cors" });
    expect(res.status).toBe(503);
  });
});
