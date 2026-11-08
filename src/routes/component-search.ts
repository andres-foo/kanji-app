import { componentResultsHtml, parseSelected, suggestionHtml } from "../views/component-search";

export function componentSuggestions(url: URL) {
  const query = url.searchParams.get("q") ?? "";
  const selected = parseSelected(url.searchParams.get("components"));
  return new Response(suggestionHtml(query, selected), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export function componentResults(url: URL) {
  const selected = parseSelected(url.searchParams.get("components"));
  const addedOnly = url.searchParams.get("added") === "1";
  return new Response(componentResultsHtml(selected, addedOnly), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
