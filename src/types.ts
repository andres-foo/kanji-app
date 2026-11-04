// Row shapes returned by the kanji and example-word queries.
export type Kanji = {
  literal: string; meanings: string; onReadings: string | null; kunReadings: string | null;
  strokes: number | null; jlpt: number | null; frequency: number | null; grade: number | null;
  heisg6: number | null; components: string | null; other_forms: string | null;
  kanken: number | null; story: string | null; related: string | null; keyword: string | null;
  added: number | null; unfinished: number | null; is_component: number | null;
  score?: number | null; last_reviewed?: string | null; due_date?: string | null;
};
export type Word = {
  id: number; kanji: string | null; kana: string | null; meanings: string | null;
  freq_wiki: number | null; added: number | null; jlpt: number | null; kanji_alternative: string | null;
};
