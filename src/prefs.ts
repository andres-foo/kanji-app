import { AsyncLocalStorage } from "node:async_hooks";

export type Theme = "light" | "dark";
export type RequestContext = { theme: Theme | null; detailsOpen: boolean; back: string };
// Request-scoped so concurrent requests don't share the visitor's preferences.
export const requestContext = new AsyncLocalStorage<RequestContext>();

export const cookieValue = (req: Request, name: string) =>
  new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(req.headers.get("cookie") ?? "")?.[1] ?? null;

export const themeFrom = (req: Request): Theme | null => {
  const value = cookieValue(req, "kanji_theme");
  return value === "light" || value === "dark" ? value : null;
};

export const detailsOpenFrom = (req: Request) => cookieValue(req, "kanji_details") !== "closed";

export const sameOrigin = (req: Request) => {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.get("host"); } catch { return false; }
};

export const safeBack = (value: unknown) => {
  try {
    const url = new URL(String(value ?? "/"), "http://localhost");
    return url.origin === "http://localhost" ? url.pathname + url.search + url.hash : "/";
  } catch { return "/"; }
};
