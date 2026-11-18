import { hasAiKey } from "../ai-key";
import { esc, html } from "../html";
import { HISTORY_MAX } from "../history";
import { masteryLevels } from "../mastery";
import { requestContext } from "../prefs";
import { setting, startScore, textSetting, type SettingKey, WORD_RESULTS_MAX, PHRASE_RESULTS_MAX, PHRASE_MORE_MAX } from "../settings";
import { layout } from "./layout";

export const DELTA_FIELDS: { key: SettingKey; label: string; hint: string }[] = [
  { key: "review_delta_bad", label: "Bad", hint: "Score change when you press Bad." },
  { key: "review_delta_neutral", label: "Neutral", hint: "Score change when you press Neutral." },
  { key: "review_delta_good", label: "Good", hint: "Score change when you press Good." },
  { key: "review_delta_easy", label: "Easy", hint: "Score change when you press Easy." },
];

// the score scale (-3 to 10) and the starting score live in the settings table and are edited in the database; this page
// edits the score changes for Bad / Neutral / Good / Easy, the mastery levels, pagination and history limits, and resets scores.
export function settingsPage(url: URL, errors: string[] = [], submitted?: Record<string, string>, status = 200) {
  const resetCount = url.searchParams.get("reset");
  const theme = requestContext.getStore()?.theme ?? "light";
  const back = requestContext.getStore()?.back ?? "/settings";
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
  const historyLimit = submitted?.history_limit ?? String(setting("history_limit"));
  const wordPerPage = submitted?.word_results_per_page ?? String(setting("word_results_per_page"));
  const phrasePerKanji = submitted?.phrase_results_per_kanji ?? String(setting("phrase_results_per_kanji"));
  const phraseMore = submitted?.phrase_more_per_click ?? String(setting("phrase_more_per_click"));
  const aiBaseUrl = submitted?.ai_base_url ?? textSetting("ai_base_url");
  const aiModel = submitted?.ai_model ?? textSetting("ai_model");
  const aiEnabled = submitted ? submitted.ai_enabled === "1" : textSetting("ai_enabled") === "1";
  const aiRemoveKey = submitted?.ai_remove_key === "1";
  const hasKey = hasAiKey();
  const phraseOptions = Array.from({ length: PHRASE_RESULTS_MAX }, (_, i) => i + 1)
    .map((n) => `<option value="${n}"${String(n) === phrasePerKanji ? " selected" : ""}>${n}</option>`).join("");
  const body = `<div class="listhead"><div><h1>Settings</h1><p class="sub">Appearance, review scoring, mastery timing and AI.</p></div></div>
${notice}
<form class="card setcard" method="post" action="/theme">
  <input type="hidden" name="back" value="/settings">
  <div class="sethead"><h2>Appearance</h2><p class="sub">Saved in this browser only, not in the database.</p></div>
  <div class="themechoice">
    <button class="pill ${theme === "light" ? "dark" : "ghost"} sm" type="submit" name="theme" value="light">Light</button>
    <button class="pill ${theme === "dark" ? "dark" : "ghost"} sm" type="submit" name="theme" value="dark">Dark</button>
  </div>
</form>
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
  <div class="card setcard">
    <div class="sethead"><h2>Other settings</h2><p class="sub">Search pagination, examples and history limits.</p></div>
    <div class="setfields">
      <label class="setfield"><span class="setflabel">Word results per page</span>
      <input class="setinput" type="number" step="1" min="1" max="${WORD_RESULTS_MAX}" name="word_results_per_page" value="${esc(wordPerPage)}" required>
      <span class="hint">How many word results are shown on each search page (default 20).</span></label>
      <label class="setfield"><span class="setflabel">Phrases per kanji</span>
      <select class="setinput" name="phrase_results_per_kanji">
        ${phraseOptions}
      </select>
      <span class="hint">How many example phrases are shown initially on a kanji page (default 5).</span></label>
      <label class="setfield"><span class="setflabel">More phrases per click</span>
      <input class="setinput" type="number" step="1" min="1" max="${PHRASE_MORE_MAX}" name="phrase_more_per_click" value="${esc(phraseMore)}" required>
      <span class="hint">How many additional phrases each “Show more” click reveals (default 5).</span></label>
      <label class="setfield"><span class="setflabel">History limit</span>
      <input class="setinput" type="number" step="1" min="1" max="${HISTORY_MAX}" name="history_limit" value="${esc(historyLimit)}" required>
      <span class="hint">Entries shown in each history section on the dashboard: this many searches and this many kanji visits (default 50).</span></label>
    </div>
  </div>
  <div class="card setcard">
    <div class="sethead"><h2>AI (optional)</h2><p class="sub">Powers Autofill, Translate and Analyze. Screenshots and text are sent to the provider you choose. Requires an API key.</p></div>
    <div class="setfields">
      <div class="setfield"><span class="setflabel">Enabled</span>
        <label class="setcheckline"><input type="checkbox" name="ai_enabled" value="1"${aiEnabled ? " checked" : ""}> Enable AI</label>
        <span class="hint">${hasKey ? "A key is saved. Tick this and save to use Autofill, Translate and Analyze." : "Autofill and Analyze stay disabled until this is on and a key is saved."}</span></div>
      <label class="setfield"><span class="setflabel">Base URL</span>
        <input class="setinput" type="url" name="ai_base_url" value="${esc(aiBaseUrl)}" required>
        <span class="hint">OpenAI-compatible API root, for example https://api.openai.com/v1. http:// is only allowed for localhost or 127.0.0.1.</span></label>
      <label class="setfield"><span class="setflabel">Model</span>
        <input class="setinput" type="text" name="ai_model" value="${esc(aiModel)}" required>
        <span class="hint">Any model the endpoint offers, for example gpt-4.1-mini or a local vision model.</span></label>
      <label class="setfield"><span class="setflabel">API key</span>
        <input class="setinput" type="password" name="ai_api_key" value="" placeholder="${hasKey ? "•••••• (unchanged)" : "sk-…"}" autocomplete="new-password">
        <span class="hint">Left blank keeps the key in the local .env file; the key is never shown again.</span></label>
      <label class="setcheckline"><input type="checkbox" name="ai_remove_key" value="1"${aiRemoveKey ? " checked" : ""}> Remove key</label>
    </div>
    <div class="ai-test-row">
      <button class="pill ghost sm" type="button" id="ai-test">Test connection</button>
      <span class="sub ai-test-result" id="ai-test-result" role="status" aria-live="polite">Uses the saved settings.</span>
    </div>
  </div>
  <div class="setactions"><button class="pill dark" type="submit">Save settings</button></div>
</form>
<form class="card setdanger" method="post" action="/settings/reset-scores" data-msg="Reset every added kanji to score ${startScore()} and make them all due now? This cannot be undone." onsubmit="return confirm(this.dataset.msg)">
  <div class="sethead"><h2>Reset scores</h2><p class="sub">Sets every added kanji to the starting score (${startScore()}) and makes it due now.</p></div>
  <button class="pill danger" type="submit">Reset scores</button>
</form>
<script src="/js/settings-ai.js" defer></script>`;
  return html(layout("Settings – Kanji", body, { theme, back }), status);
}
