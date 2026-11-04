import { type Theme, sameOrigin, safeBack } from "../prefs";

// store the explicit theme (or clear it) in a cookie, then go back to where the user was
export async function setTheme(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const value = String(form.get("theme") ?? "");
  const theme: Theme | null = value === "light" || value === "dark" ? value : null;
  const headers = new Headers({ location: safeBack(form.get("back")) });
  headers.set("set-cookie", theme
    ? `kanji_theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`
    : `kanji_theme=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`);
  return new Response(null, { status: 303, headers });
}

// remember whether the details table is shown, then go back to the kanji page
export async function toggleDetails(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const open = form.get("details") === "open";
  const headers = new Headers({ location: safeBack(form.get("back")) });
  headers.set("set-cookie", `kanji_details=${open ? "open" : "closed"}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`);
  return new Response(null, { status: 303, headers });
}
