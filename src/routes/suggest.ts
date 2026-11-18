import { suggestHtml } from "../views/suggest";

// Rows for the nav search dropdown. Rendered server-side like the other
// suggestion endpoints, so the client just swaps in the returned HTML.
export function suggestions(url: URL) {
  const query = (url.searchParams.get("q") ?? "").slice(0, 80);
  return new Response(suggestHtml(query), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
