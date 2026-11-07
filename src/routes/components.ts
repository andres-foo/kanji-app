import { db } from "../db";
import { sameOrigin } from "../prefs";
import { messagePage } from "../views/message";

export async function groupComponents(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const literals = [...new Set(form.getAll("literal").map(String).filter(Boolean))];
  if (!literals.length) return new Response(null, { status: 303, headers: { location: "/components" } });

  const action = String(form.get("action") ?? "");
  let group: number | null = null;
  if (action !== "ungroup") {
    let raw = String(form.get("group") ?? "").trim();
    if (raw === "new") raw = String(form.get("new_group") ?? "").trim();
    if (!/^\d+$/.test(raw)) {
      return messagePage("Group not set", "Choose an existing group or enter a new group number.", 400, { href: "/components", label: "Back to components" });
    }
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 9999) {
      return messagePage("Group not set", "Group numbers must be between 1 and 9999.", 400, { href: "/components", label: "Back to components" });
    }
    group = parsed;
  }

  try {
    const placeholders = literals.map(() => "?").join(",");
    db.run(
      `UPDATE user_kanjis
       SET component_group = ?, is_component = 1
       WHERE literal IN (${placeholders})`,
      [group, ...literals],
    );
  } catch (e) {
    return messagePage("Could not update components", `Could not change the component groups: ${(e as Error).message}.`, 500, { href: "/components", label: "Back to components" });
  }
  return new Response(null, { status: 303, headers: { location: "/components" } });
}
