/* 回答方式のルーター。アプリと validate.mjs の両方から使う。
   「選択肢が見えるか」で二分される点が重要:
     choice … 4択・消去法（選択肢が画面に出る）
     hidden … 文字パネル・数値入力・レンジ（選択肢が出ない）
   ヒントの出し分けはこの区別に従う。                                */

const NUMERIC = /^[0-9０-９]+([.．][0-9]+)?\s*(cm²|cm|kWh|Wh|W|本|人|個|度|点|倍|℃|問|月|%)?$/;
const ERA = /(時代|世紀)$|^[0-9]{3,4}年$/;
const JA_TERM = /^[ぁ-んァ-ヶ一-龥ー]{2,12}$/;

/** 正解の表示文字列。format によって置き場所が違う */
export function answerText(q) {
  if (q.format === "range") return String(q.year ?? "");
  if (Array.isArray(q.choices) && q.answer != null) return String(q.choices[q.answer] ?? "");
  return "";
}

/** 難モードでどの方式を使うか */
export function answerMode(q) {
  if (q.hardMode) return q.hardMode;
  if (q.format === "range") return "range";          // 既にレンジ回答の問題はそのまま
  if (!Array.isArray(q.choices)) return "elimination";
  const a = answerText(q).trim();
  if (NUMERIC.test(a)) return "numeric";
  if (ERA.test(a)) return "range";
  if (q.multi) return "multi";
  if (q.reading && JA_TERM.test(a)) return "panel";
  return "elimination";
}

/** その方式で選択肢が画面に見えるか */
export function isChoiceVisible(mode) {
  return mode === "elimination" || mode === "choice";
}

/** ヒントの表示グループ。"choice" | "hidden" */
export function hintGroup(mode) {
  return isChoiceVisible(mode) ? "choice" : "hidden";
}

/** ヒントを {text, only} の形に揃える */
export function normalizeHints(hints) {
  return hints.map(h => (typeof h === "string" ? { text: h } : { ...h }));
}

/**
 * 指定グループで使えるヒントだけを返す。
 * only が付いていないヒントは両方のグループで使う。
 */
export function hintsFor(hints, group) {
  return normalizeHints(hints).filter(h => !h.only || h.only === group);
}
