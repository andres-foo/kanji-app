import { esc, html } from "../html";
import { masteryLevels } from "../mastery";
import { requestContext } from "../prefs";
import { setting, startScore, type SettingKey } from "../settings";
import { layout } from "./layout";

export const DELTA_FIELDS: { key: SettingKey; label: string; hint: string }[] = [
  { key: "review_delta_bad", label: "Bad", hint: "Score change when you press Bad." },
  { key: "review_delta_neutral", label: "Neutral", hint: "Score change when you press Neutral." },
  { key: "review_delta_good", label: "Good", hint: "Score change when you press Good." },
  { key: "review_delta_easy", label: "Easy", hint: "Score change when you press Easy." },
];

// the score scale (-3 to 10) and the starting score live in the settings table and are edited in the database; this page
// edits the score changes for Bad / Neutral / Good / Easy and the mastery levels (label and days until the next review), and resets scores.
export function settingsPage(url: URL, errors: string[] = [], submitted?: Record<string, string>, status = 200) {
  const resetCount = url.searchParams.get("reset");
  const notice = errors.length
    ? `<div class="setnotice err">${errors.map(esc).join("<br>")}</div>`
    : url.searchParams.get("saved") === "1" ? `<div class="setnotice ok">Settings saved.</div>`
      : resetCount !== null ? `<div class="setnotice ok">${esc(resetCount)} added kanji were reset to score ${esc(url.searchParams.get("to") ?? "")} and are due now.</div>` : "";
  const rows = masteryLevels().map((m) => `<div class="setrow"><span class="scoretag">${m.score}</span>
<input class="setinput" type="text" maxlength="30" name="label_${m.score}" value="${esc(submitted?.[`label_${m.score}`] ?? m.label)}" aria-label="Label for score ${m.score}" required>
<input class="setinput" type="number" step="1" min="1" max="3650" name="days_${m.score}" value="${esc(submitted?.[`days_${m.score}`] ?? String(m.interval_days))}" aria-label="Days until next review for score ${m.score}" required></div>`).join("");
  const fields = DELTA_FIELDS.map((f) => `<label class="setfield"><span class="setflabel">${f.label}</span>
<input class="setinput" type="number" step="1" min="-10" max="10" name="${f.key}" value="${esc(submitted?.[f.key] ?? String(setting(f.key)))}" required>
<span class="hint">${f.hint}</span></label>`).join("");
  const body = `<div class="listhead"><div><h1>Settings</h1><p class="sub">Review scoring and mastery timing.</p></div></div>
${notice}
<form class="setform" method="post" action="/settings">
  <div class="card setcard">
    <div class="sethead"><h2>Score changes</h2><p class="sub">How much each answer moves a kanji's score.</p></div>
    <div class="setfields">${fields}</div>
  </div>
  <div class="card setcard">
    <div class="sethead"><h2>Mastery levels</h2><p class="sub">After a review, the new score decides when the kanji is due again. A bad answer is always due again today.</p></div>
    <div class="settable">
      <div class="setrow setheadrow"><span>Score</span><span>Label</span><span>Days until review</span></div>
      ${rows}
    </div>
  </div>
  <div class="setactions"><button class="pill dark" type="submit">Save settings</button></div>
</form>
<form class="card setdanger" method="post" action="/settings/reset-scores" data-msg="Reset every added kanji to score ${startScore()} and make them all due now? This cannot be undone." onsubmit="return confirm(this.dataset.msg)">
  <div class="sethead"><h2>Reset scores</h2><p class="sub">Sets every added kanji to the starting score (${startScore()}) and makes it due now.</p></div>
  <button class="pill danger" type="submit">Reset scores</button>
</form>`;
  const theme = requestContext.getStore()?.theme ?? "light";
  const back = requestContext.getStore()?.back ?? "/settings";
  return html(layout("Settings – Kanji", body, { theme, back }), status);
}
