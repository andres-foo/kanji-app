import { aiConfigured, testConnection } from "../ai";
import { sameOrigin } from "../prefs";
import { textSetting } from "../settings";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export async function aiStatusResponse() {
  if (!aiConfigured()) return json({ configured: false });
  return json({ configured: true, model: textSetting("ai_model") });
}

export async function aiTestResponse(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false, error: "forbidden" }, 403);
  const result = await testConnection();
  return result.ok ? json({ ok: true }) : json({ ok: false, error: result.error });
}
