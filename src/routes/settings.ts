import { db } from "../db";
import { HISTORY_MAX } from "../history";
import { MAX_SCORE, MIN_SCORE, type Mastery } from "../mastery";
import { sameOrigin } from "../prefs";
import { startScore, type SettingKey, WORD_RESULTS_MAX, PHRASE_RESULTS_MAX } from "../settings";
import { DELTA_FIELDS, settingsPage } from "../views/settings";

export async function saveSettings(req: Request, url: URL) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const submitted: Record<string, string> = {};
  const levels: Mastery[] = [];
  const deltas: [SettingKey, number][] = [];
  const errors: string[] = [];
  for (const f of DELTA_FIELDS) {
    const text = String(form.get(f.key) ?? "").trim();
    submitted[f.key] = text;
    const n = Number(text);
    if (text === "" || !Number.isInteger(n) || n < -10 || n > 10) errors.push(`${f.label} must be a whole number from -10 to 10.`);
    else deltas.push([f.key, n]);
  }
  const historyText = String(form.get("history_limit") ?? "").trim();
  submitted.history_limit = historyText;
  const historyLimit = Number(historyText);
  if (historyText === "" || !Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > HISTORY_MAX) {
    errors.push(`History limit must be a whole number from 1 to ${HISTORY_MAX}.`);
  }
  const wordText = String(form.get("word_results_per_page") ?? "").trim();
  submitted.word_results_per_page = wordText;
  const wordResults = Number(wordText);
  if (wordText === "" || !Number.isInteger(wordResults) || wordResults < 1 || wordResults > WORD_RESULTS_MAX) {
    errors.push(`Word results per page must be a whole number from 1 to ${WORD_RESULTS_MAX}.`);
  }
  const phraseText = String(form.get("phrase_results_per_kanji") ?? "").trim();
  submitted.phrase_results_per_kanji = phraseText;
  const phraseResults = Number(phraseText);
  if (phraseText === "" || !Number.isInteger(phraseResults) || phraseResults < 1 || phraseResults > PHRASE_RESULTS_MAX) {
    errors.push(`Phrases per kanji must be a whole number from 1 to ${PHRASE_RESULTS_MAX}.`);
  }
  for (let score = MIN_SCORE; score <= MAX_SCORE; score++) {
    const label = String(form.get(`label_${score}`) ?? "").trim();
    const daysText = String(form.get(`days_${score}`) ?? "").trim();
    submitted[`label_${score}`] = label;
    submitted[`days_${score}`] = daysText;
    const days = Number(daysText);
    if (!label) errors.push(`Score ${score}: the label cannot be empty.`);
    else if (label.length > 30) errors.push(`Score ${score}: the label is too long (30 characters at most).`);
    if (daysText === "" || !Number.isInteger(days) || days < 1 || days > 3650) errors.push(`Score ${score}: days must be a whole number from 1 to 3650.`);
    levels.push({ score, label, interval_days: days });
  }
  if (errors.length) return settingsPage(url, errors, submitted, 400);
  try {
    db.transaction(() => {
      for (const [key, value] of deltas) {
        db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, String(value)]);
      }
      db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, ["history_limit", String(historyLimit)]);
      db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, ["word_results_per_page", String(wordResults)]);
      db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, ["phrase_results_per_kanji", String(phraseResults)]);
      for (const m of levels) {
        db.run(
          `INSERT INTO mastery_levels (score, label, interval_days) VALUES (?, ?, ?)
           ON CONFLICT(score) DO UPDATE SET label = excluded.label, interval_days = excluded.interval_days`,
          [m.score, m.label, m.interval_days],
        );
      }
    })();
  } catch (e) {
    return settingsPage(url, [`Could not save the settings: ${(e as Error).message}. Do the settings and mastery_levels tables exist?`], submitted, 500);
  }
  return new Response(null, { status: 303, headers: { location: "/settings?saved=1" } });
}

// sets every added kanji to the starting score and makes it due now (no due date, never reviewed)
export async function resetScores(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const start = startScore();
  try {
    const res = db.run(`UPDATE user_kanjis SET score = ?, due_date = NULL, last_reviewed = NULL WHERE COALESCE(added, 0) = 1`, [start]);
    return new Response(null, { status: 303, headers: { location: `/settings?reset=${res.changes}&to=${start}` } });
  } catch (e) {
    return settingsPage(new URL(req.url), [`Could not reset the scores: ${(e as Error).message}. Is the database file writable, and do the last_reviewed and due_date columns exist?`], undefined, 500);
  }
}
