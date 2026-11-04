import { esc, html } from "../html";
import { masteryLevels } from "../mastery";
import { setting, startScore, type SettingKey } from "../settings";
import { layout } from "./layout";

export const DELTA_FIELDS: { key: SettingKey; label: string; hint: string }[] = [
  { key: "review_delta_bad", label: "Bad", hint: "Score change when you press Bad." },
  { key: "review_delta_neutral", label: "Neutral", hint: "Score change when you press Neutral." },
  { key: "review_delta_good", label: "Good", hint: "Score change when you press Good." },
  { key: "review_delta_easy", label: "Easy", hint: "Score change when you press Easy." },
];

// the score scale (-3 to 10) and the starting score live in the settings table and are edited in the database; this page
// edits the score changes for Bad / Neutral / Good and the mastery levels (label and days until the next review), and resets scores.
export function settingsPage(url: URL, errors: string[] = [], submitted?: Record<string, string>, status = 200) {
  const resetCount = url.searchParams.get("reset");
  const notice = errors.length
    ? `<p class="notice err">${errors.map(esc).join("<br>")}</p>`
    : url.searchParams.get("saved") === "1" ? `<p class="notice ok">Settings saved.</p>`
      : resetCount !== null ? `<p class="notice ok">${esc(resetCount)} added kanji were reset to score ${esc(url.searchParams.get("to") ?? "")} and are due now.</p>` : "";
  const rows = masteryLevels().map((m) => `<div class="mlrow"><span class="mlscore">${m.score}</span>
<input type="text" maxlength="30" name="label_${m.score}" value="${esc(submitted?.[`label_${m.score}`] ?? m.label)}" aria-label="Label for score ${m.score}" required>
<input type="number" step="1" min="1" max="3650" name="days_${m.score}" value="${esc(submitted?.[`days_${m.score}`] ?? String(m.interval_days))}" aria-label="Days until next review for score ${m.score}" required></div>`).join("");
  const body = `<h1>SETTINGS</h1>${notice}<div class="box setbox">
<form class="editf" style="margin-top:0" method="post" action="/settings">
<section><h2>Score changes</h2><div class="setgrid">${DELTA_FIELDS.map((f) => `<label class="fl">${f.label}
<input type="number" step="1" min="-10" max="10" name="${f.key}" value="${esc(submitted?.[f.key] ?? String(setting(f.key)))}" required>
<span class="hint">${f.hint}</span></label>`).join("")}</div></section>
<section><h2>Mastery levels</h2>
<p class="hint">After a review, the kanji's new score decides when it is due again. The label is shown on the kanji page. A bad answer is always due again today.</p>
<div class="mlrow mlhead"><span>Score</span><span>Label</span><span>Days</span></div>${rows}</section>
<div class="formbtns"><button class="reviewbtn" type="submit">Save</button></div></form>
<form class="resetrow" method="post" action="/settings/reset-scores" data-msg="Reset every added kanji to score ${startScore()} and make them all due now? This cannot be undone." onsubmit="return confirm(this.dataset.msg)">
<button class="reviewbtn bad" type="submit">Reset scores</button><span class="hint">Sets every added kanji to the starting score (${startScore()}) and makes it due now.</span></form></div>`;
  return html(layout("Settings – Kanji", "", body), status);
}
