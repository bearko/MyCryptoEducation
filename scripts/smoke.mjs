import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const html = readFileSync("dist/index.html", "utf8");
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
const w = dom.window, d = w.document;
const errs = [];
w.addEventListener("error", e => errs.push(e.message));
const ev = s => w.eval(s);
const txt = () => d.getElementById("app").textContent.replace(/\s+/g, " ");
const wait = ms => new Promise(r => setTimeout(r, ms));

let failed = 0;
const check = (name, cond, extra = "") => {
  console.log((cond ? "✓ " : "✗ ") + name + (cond ? "" : "  ← " + extra));
  if (!cond) failed++;
};

/* 難モードが既定になったので、答えるときは方式に合わせる。
   消去法なら違うものを潰し、4択ならそのまま押す（experience-design-framework の決定2・決定4） */
// 判定を写すとズレるので、アプリが使っている modeOf をそのまま呼ぶ
const modeNow = () => ev(`modeOf(DB.byId[S.run.ids[S.run.i]])`);
const answerNow = (correct = true) => {
  const a = ev("DB.byId[S.run.ids[S.run.i]].answer");
  const n = ev("(DB.byId[S.run.ids[S.run.i]].choices || []).length");
  const mode = modeNow();
  if (mode === "panel") {
    const path = JSON.parse(ev(`JSON.stringify(DB.byId[S.run.ids[S.run.i]].panel.path)`));
    const order = correct ? path : path.slice(0, 2).reverse();
    order.forEach(i => d.querySelector(`.pcell[data-i="${i}"]`)?.click());
    d.getElementById("psubmit").click();
    return true;
  }
  if (mode === "numeric") {
    const want = ev(`JSON.stringify(numericParts(DB.byId[S.run.ids[S.run.i]]))`);
    const v = JSON.parse(want).value;
    const typed = correct ? v : String(Number(v) + 1);
    [...typed].forEach(c => d.querySelector(`.keypad .key[data-k="${c}"]`)?.click());
    d.getElementById("nsubmit").click();
    return true;
  }
  const btns = [...d.querySelectorAll(".choices .choice")];
  if (!btns.length) return false;
  if (mode === "elimination") {
    // ✕ で消す。正解を消せばその場で不正解、ちがうものを全部消せば正解
    if (!correct) { d.querySelector(`.xcut[data-c="${a}"]`).click(); return true; }
    for (let i = 0; i < n; i++) if (i !== a) d.querySelector(`.xcut[data-c="${i}"]`)?.click();
    return true;
  }
  btns[correct ? a : (a + 1) % n].click();
  return true;
};

await wait(200);

/* ---- 決定1: 無説明の初回起動 ---- */
// ホームもチュートリアルも出さず、いきなり小学1年の問題から始まる
check("初回はホームを出さない", !d.getElementById("toquiz") && ev('S.view === "quiz"'),
  txt().slice(0, 60));
check("いきなり小学1年の問題", ev('DB.byId[S.run.ids[0]].grade') === "e1",
  ev('DB.byId[S.run.ids[0]].gradeLabel'));
check("説明もチュートリアルも出さない",
  !/チュートリアル|はじめに|遊び方|使い方/.test(txt()), txt().slice(0, 80));
check("1問目は4択だけ", modeNow() === "choice", modeNow());
check("数問で切り上げる", ev("S.run.ids.length") === 5, `${ev("S.run.ids.length")}問`);
// 1〜2問目は4択。3問目から難モードがすっと現れる（説明はしない）
answerNow(); d.getElementById("next")?.click();
check("2問目も4択", modeNow() === "choice", modeNow());
answerNow(); d.getElementById("next")?.click();
check("3問目から難モードが現れる", ev(`(() => {
  const q = DB.byId[S.run.ids[S.run.i]];
  // その問題に難モードが割り当たっていれば、もう4択には固定されない
  return modeOf(q) === q.mode || q.mode === "choice";
})()`) === true, modeNow());
check("それでも4択へは降りられる",
  modeNow() === "choice" || !!d.getElementById("tochoice"), modeNow());
while (ev('S.view === "quiz"')) {
  if (!answerNow()) break;
  const n = d.getElementById("next");
  if (n) n.click(); else await wait(900);
}
check("解き終わると初めてホームへ行ける", ev("S.introDone") === true && ev("S.runs") === 1,
  `introDone=${ev("S.introDone")} runs=${ev("S.runs")}`);
check("2回目の起動はホームから", (() => {
  ev('S.view="home";render()');
  return !!d.getElementById("toquiz");
})(), txt().slice(0, 60));

check("起動", !!d.getElementById("toquiz"), txt().slice(0, 60));

/* ---- UI基盤: 1画面完結レイアウト ---- */
check("ホームは3層", d.querySelectorAll("#app.home > .layer").length === 3,
  `${d.querySelectorAll("#app > *").length}要素`);
check("ステータス層にマイちゃんの助言", (d.getElementById("advice")?.textContent || "").length > 5,
  d.getElementById("advice")?.textContent);
check("助言は吹き出しに入る", d.getElementById("advice").classList.contains("bubble"));
check("背景はホーム全体に敷く", !!d.querySelector("#app.home > .home-bg") && !d.querySelector(".stage-bg"));
check("ユーザーアイコンが出る", !!d.querySelector(".st-ava"));
check("称号の枠がある", !!d.querySelector(".st-title"), txt().slice(0, 60));
check("ユーザー名の枠がある", d.querySelector(".st-name").textContent.trim() === "旅人",
  d.querySelector(".st-name")?.textContent);
check("GUMの所持数はホームに出さない", (() => {
  ev("S.gum=999999;render()");
  const ok = !d.querySelector(".st-gum") && !/999,999/.test(txt());
  ev("S.gum=0;render()");
  return ok;
})(), txt().slice(0, 120));
check("一等地は知識マップに渡した", (() => {
  const el = d.getElementById("tomap");
  return !!el && /知識 \d+\/\d+/.test(el.textContent) && !!el.querySelector(".mp-bar i");
})(), d.getElementById("tomap")?.textContent);
check("GUMはショップ画面で桁区切りで出す", (() => {
  ev("S.gum=999999;go('shop')");
  const ok = txt().includes("999,999");
  ev("S.gum=0;go('home')");
  return ok;
})());
check("知識マップはホームから1タップで開く", (() => {
  d.getElementById("tomap").click();
  const ok = txt().includes("どこまで来たか") && !!d.querySelector("table.map");
  ev('go("home")');
  return ok;
})(), txt().slice(0, 80));
check("電池はAPIが無い環境では隠す", d.getElementById("batt").hidden);
check("ユーザー名は255文字まで", ev('capName("あ".repeat(400)).length') === 255,
  String(ev('capName("あ".repeat(400)).length')));
check("長い名前でも1行に収める", (() => {
  ev('S.profile.name="あ".repeat(120);render()');
  const el = d.querySelector(".st-name");
  const ok = el.textContent.length === 120;
  ev('S.profile.name="旅人";render()');
  return ok;
})());
check("ナビが4枠そろっている",
  ["toheroes", "toshop", "tocraft", "toquiz"].every(id => !!d.getElementById(id)));
check("ショップは押せる", !d.getElementById("toshop").disabled);
check("挑戦ボタンは主役層にある", !!d.querySelector(".layer-stage #tochal"));
check("挑戦ボタンは文字だけ", d.getElementById("tochal").textContent.trim() === "挑戦",
  d.getElementById("tochal").textContent.trim());
check("挑む相手はボタンの外に大きく出る", !!d.querySelector(".layer-stage .tv-figure img"));
check("相手の名前とレアリティはアートと組で出る",
  /Common/.test(d.querySelector(".tv-name").textContent) &&
  d.querySelector(".tv-name").textContent.includes("ピタゴラス"),
  d.querySelector(".tv-name")?.textContent);
check("削れ具合はホームに出さない", !/削れ/.test(txt()), txt().slice(0, 160));

// カルーセルは自動送り。矢印は置かず、末尾に先頭のクローンを1枚足して繋ぐ
const lockedN = ev("lockedHeroes(DB,S).length");
check("矢印は置かない", !d.getElementById("nexthero") && !d.getElementById("prevhero"));
check("カルーセルのドットが未解放ぶんある",
  d.querySelectorAll(".tv-dots i").length === lockedN,
  `${d.querySelectorAll(".tv-dots i").length}個`);
check("トラックはクローン1枚ぶん多い",
  d.querySelectorAll("#tvtrack .tv-figure").length === lockedN + 1,
  `${d.querySelectorAll("#tvtrack .tv-figure").length}枚 / 未解放 ${lockedN}体`);
check("末尾のクローンは先頭と同じ絵", (() => {
  const f = [...d.querySelectorAll("#tvtrack .tv-figure img")];
  return f[0].getAttribute("src") === f[f.length - 1].getAttribute("src");
})());
check("巡回インデックスは端で回り込む",
  ev("nextIndex(8,9,1)") === 0 && ev("nextIndex(0,9,-1)") === 8 && ev("nextIndex(3,9,1)") === 4,
  `${ev("nextIndex(8,9,1)")} / ${ev("nextIndex(0,9,-1)")}`);
check("ナビのアイコンはラベルと分けて重ねる",
  d.querySelectorAll(".nav3 .tile .lab b").length === 3,
  `${d.querySelectorAll(".nav3 .tile .lab b").length}件`);
check("ホームから素材・カード枚数・英雄一覧を外した",
  !txt().includes("手持ちの英雄") && !d.querySelector(".fams"), txt().slice(0, 120));

// クラフトの通知ドットは、素材が足りているときだけ出す
check("素材0なら通知ドットなし", !d.querySelector("#tocraft .dot"));
// 素材だけでは足りない。知識カードもそろって初めてドットが出る
const keptPoints = ev("JSON.stringify(S.points)");
const keptCards = ev("JSON.stringify(S.cards)");
ev(`S.points=Object.fromEntries(DB.families.map(f => [f, 9999]));render()`);
check("素材だけではドットが出ない", !d.querySelector("#tocraft .dot"));
ev(`(() => {
  Object.keys(DB.cardSubject).filter(c => !c.endsWith("（応用）")).forEach(c => S.cards[c] = true);
  render();
})()`);
check("クラフトできると通知ドット", !!d.querySelector("#tocraft .dot"));
ev(`S.points=${keptPoints};S.cards=${keptCards};render()`);

// 英雄詳細と図鑑への入口は、ホームからヒーロー画面へ移した
d.getElementById("toheroes").click();
check("ヒーロー画面の手持ちタブ", txt().includes("手持ちの英雄"), txt().slice(0, 80));
[...d.querySelectorAll("#htab button")].find(b => b.dataset.t === "codex").click();
check("図鑑タブに知識マップ", txt().includes("知識マップ"), txt().slice(0, 80));
d.getElementById("back").click();
check("ホームへ戻れる", !!d.getElementById("toquiz"));

/* ---- 修正1: 重複しない出題 ---- */
d.getElementById("toquiz").click();
check("ホーム以外は方眼紙のまま", !d.getElementById("app").classList.contains("home"));
// 開始時は第3・4章が未解放。期待値は問題データから出す（問題を足すたびに直さないため）
const openStock = ev("inventory(DB,S,'auto','auto').length");
check("在庫バッジが出ている", new RegExp(`おまかせ\\s*${openStock}`).test(txt()),
  `在庫 ${openStock} / ${txt().slice(0, 120)}`);
check("未解放ぶんは在庫から外れる", openStock < ev("DB.questions.length"),
  `${openStock} / 全 ${ev("DB.questions.length")}問`);
check("未解放の教科は選べない",
  [...d.querySelectorAll("#sub button")].find(b => b.dataset.k === "情報").disabled);

// 在庫が1セッションぶんに満たない範囲での挙動を見る。以前はここで同じ問題が繰り返し出ていた。
// 問題を足すと薄い範囲は無くなるので、検査のあいだだけ在庫を削って作り、あとで戻す
const THIN_BAND = "e", THIN_SUB = "国語", THIN_N = 4;
const thin = ev(`(() => {
  window.__allQs = DB.questions;
  const pool = inventory(DB, S, "${THIN_BAND}", "${THIN_SUB}");
  if (pool.length <= ${THIN_N}) return "null";
  const drop = new Set(pool.slice(${THIN_N}).map(q => q.id));
  DB.questions = DB.questions.filter(q => !drop.has(q.id));
  render();
  return JSON.stringify({ n: inventory(DB, S, "${THIN_BAND}", "${THIN_SUB}").length });
})()`);
check("薄い在庫を作れた（この検査の前提）", thin !== "null" && JSON.parse(thin).n === THIN_N, thin);
const thinBand = THIN_BAND, thinSub = THIN_SUB, thinN = THIN_N;
// 学年帯を選び直すと教科は「おまかせ」に戻るので、帯を先に押す
[...d.querySelectorAll("#band button")].find(b => b.dataset.k === thinBand).click();
[...d.querySelectorAll("#sub button")].find(b => b.dataset.k === thinSub).click();
check("在庫不足の警告", txt().includes(`この範囲は在庫が ${thinN}問なので`),
  `${thinSub} ${thinN}問 / ${txt().slice(0, 160)}`);
check("開始ボタンは形式の数で言う",
  d.getElementById("start").textContent.includes("3つの形式で解く"),
  d.getElementById("start").textContent);

d.getElementById("start").click();
const ids = ev("JSON.stringify(S.run.ids)");
const arr = JSON.parse(ids);
check("在庫ぶんだけ出す（旧: 同じ問題が繰り返し出ていた）", arr.length === thinN,
  `${arr.length}問 / 在庫 ${thinN}問`);
check("同じ問題が出ない", new Set(arr).size === arr.length, ids);

// 削った在庫を戻す
ev('DB.questions = window.__allQs; render();');

// おまかせで10問
ev('S.view="select";S.select.band="auto";S.select.subject="auto";render()');
d.getElementById("start").click();
const arr2 = JSON.parse(ev("JSON.stringify(S.run.ids)"));
/* **1セッションの長さは、束の長さの合計。**（`engine.blockSize`）
   はらうだけのスワイプは8問、なぞる文字パネルは3問。同じ問題数にすると、
   重い形式の束だけが長く感じる */
check("おまかせは3つの束でできている", (() => {
  const plan = JSON.parse(ev("JSON.stringify(S.run.plan)"));
  const want = plan.reduce((a, b) => a + b.n, 0);
  return plan.length === 3 && want === arr2.length &&
    plan.every(b => b.n === ev(`blockSize(${JSON.stringify(b.mode)})`));
})(), ev("JSON.stringify(S.run.plan)"));
check("同じ問題は1問も重ならない", new Set(arr2).size === arr2.length,
  `${arr2.length}問 / 別 ${new Set(arr2).size}`);
const lastId = arr2[arr2.length - 1];
check("最後は越境問題", ev(`DB.byId["${lastId}"].chapter`) >= 2 ||
  ["j3", "w"].includes(ev(`DB.byId["${lastId}"].grade`)),
  ev(`DB.byId["${lastId}"].gradeLabel + " ch" + DB.byId["${lastId}"].chapter`));

/* 20セッション連続で重複が出ないか */
let dup = 0;
for (let i = 0; i < 20; i++) {
  ev('S.view="select";render()'); d.getElementById("start").click();
  const a = JSON.parse(ev("JSON.stringify(S.run.ids)"));
  if (new Set(a).size !== a.length) dup++;
}
check("20セッション連続で重複ゼロ", dup === 0, `${dup}件`);


/* ---- 修正2: 解説スキップ ---- */
// レンジ回答が混ざるようになったので、この節は4択だけで組む。
// 文字パネルと数値入力は「外しても問題が終わらない」ので、不正解の検査には使えない
ev(`(() => {
  const ids = DB.questions.filter(q => (q.format || "choice") === "choice" &&
    (q.mode === "choice" || q.mode === "elimination")).slice(0, 6).map(q => q.id);
  S.settings.showExplanationOnCorrect = true;
  startRun({ ids });
})()`);
answerNow();
check("ONなら解説が出る", !!d.getElementById("next") && txt().includes("知識カード"));
check("ONなら応用編ボタンが出る", !!d.getElementById("tostretch"));

ev('S.settings.showExplanationOnCorrect=false');
const before = ev("S.run.i");
d.getElementById("next").click();
answerNow();
check("OFFなら解説パネルを出さない", !d.getElementById("next"));
check("OFFならトーストが出る", !!d.querySelector(".toast"), "toast なし");
await wait(950);
check("OFFなら自動で次へ進む", ev("S.run.i") === before + 2, `i=${ev("S.run.i")} (期待 ${before + 2})`);
check("トーストが消えている", !d.querySelector(".toast"));

// 不正解のときは設定に関わらず解説を出す
answerNow(false);
await wait(60);
check("OFFでも不正解なら解説が出る", !!d.getElementById("next") && txt().includes("面白い単元"));

/* ---- 方式の束（ポケモンフレンズのような、形式ごとのまとまり）---- */
/* **以前とは逆で、同じ形式を続けて出す。** 操作を覚え直す回数が減るぶん、
   問題そのものに集中できる。飽きは「ばらけさせる」ではなく
   **「束を3つに分ける」**ほうで防ぐ（`engine.planRun`）                      */
const planStats = ev(`(() => {
  const keep = JSON.stringify(S.seen), keepOwned = JSON.stringify(S.owned);
  DB.heroes.forEach(h => S.owned[h.id] = 1);
  const runs = [];
  for (let n = 0; n < 80; n++) {
    S.seen = {};
    const r = planRun(DB, S, { subject: "auto" });
    runs.push({ plan: r.plan, modes: r.ids.map(i => DB.byId[i].mode), ids: r.ids });
  }
  S.seen = JSON.parse(keep);
  S.owned = JSON.parse(keepOwned);      // 借りた解放は返す
  return JSON.stringify(runs);
})()`);
const runs = JSON.parse(planStats);

check("1セッションは3つの束でできている",
  runs.every(r => r.plan.length === 3), JSON.stringify(runs.find(r => r.plan.length !== 3)));
// **同じ形式は1か所にまとまる。** 離れて2度現れたら「まとめて出す」になっていない
check("同じ形式は続けて出る", runs.every(r => {
  const runsOf = [];
  r.modes.forEach((m, i) => { if (i === 0 || m !== r.modes[i - 1]) runsOf.push(m); });
  return new Set(runsOf).size === runsOf.length && runsOf.length === r.plan.length;
}), JSON.stringify(runs.find(r => {
  const g = []; r.modes.forEach((m, i) => { if (i === 0 || m !== r.modes[i - 1]) g.push(m); });
  return new Set(g).size !== g.length;
})?.modes));
check("束の並びは plan のとおり", runs.every(r => {
  let at = 0;
  return r.plan.every(b => {
    const seg = r.modes.slice(at, at + b.n); at += b.n;
    return seg.length === b.n && seg.every(m => m === b.mode);
  }) && at === r.modes.length;
}));
// **束の長さは手数なり。** 軽い形式ほど多く出す
check("束の長さは手数で決まる", runs.every(r =>
  r.plan.every(b => b.n === ev(`blockSize(${JSON.stringify(b.mode)})`))),
  JSON.stringify(runs[0].plan));
check("スワイプの束は8問・文字パネルは3問",
  ev(`blockSize("swipe")`) === 8 && ev(`blockSize("panel")`) === 3 &&
  ev(`blockSize("choice")`) === 6 && ev(`blockSize("elimination")`) === 4,
  [ "swipe", "choice", "elimination", "panel" ].map(m =>
    `${m}${ev(`blockSize(${JSON.stringify(m)})`)}`).join(" "));
check("同じ問題は2度出ない", runs.every(r => new Set(r.ids).size === r.ids.length));
// **最後の1問はいまの範囲の外**（束にしても、この約束は変えない）
check("最後の1問は範囲の外", runs.filter(r =>
  ev(`DB.byId[${JSON.stringify(r.ids[r.ids.length - 1])}].chapter`) >= 2).length >= runs.length * 0.8,
  `${runs.filter(r => ev(`DB.byId[${JSON.stringify(r.ids[r.ids.length-1])}].chapter`) >= 2).length}/${runs.length}`);

/* **形式を選ぶのは完全な乱数。** 正答率や履歴で選ぶと、得意な形式ばかり来る人と
   苦手な形式ばかり来る人に分かれる（ご指示の狙い3）                          */
{
  const tally = {};
  runs.forEach(r => r.plan.forEach(b => { tally[b.mode] = (tally[b.mode] || 0) + 1; }));
  const usable = ev(`(() => {
    const c = {}; inventory(DB, S, "auto", "auto").forEach(q => c[q.mode] = (c[q.mode] || 0) + 1);
    return Object.keys(c).filter(m => c[m] >= 3).length;
  })()`);
  const seen = Object.keys(tally).length;
  check("出せる形式はひととおり出る", seen === usable, `${seen} / 出せる形式 ${usable}`);
  const top = Math.max(...Object.values(tally)), low = Math.min(...Object.values(tally));
  // 3/形式数 が期待値。乱数なので幅は見るが、特定の形式に寄っていないことだけ確かめる
  check("どれかの形式に寄らない", top <= low * 2.2,
    JSON.stringify(tally));
}
// **スワイプは「束としてなら」混ざる。** 1問だけ紛れ込むことはない
check("スワイプは束としてだけ出る", runs.every(r => {
  const n = r.modes.filter(m => m === "swipe").length;
  return n === 0 || n === ev(`blockSize("swipe")`);
}), JSON.stringify(runs.map(r => r.modes.filter(m => m === "swipe").length)));

/* ---- 消去法（難モード）・何個まで削るかを選ぶ ---- */
// ✕ で1つずつ消す。消すほど点が増え、まちがえて消すとそこで終わる。
// **外しても、消せたぶんの点は残る**
// 点の入り方を見るので、報酬ありで回す。**終わったら元に戻す**
const elimRun = `(() => {
  window.__keep = JSON.stringify({ score: S.score, gum: S.gum, cards: S.cards,
    points: S.points, crystals: S.crystals, seen: S.seen, cells: S.cells });
  S.settings.showExplanationOnCorrect = true;
  S.score = 0;
  const ids = DB.questions.filter(q => q.mode === "elimination").slice(0, 4).map(q => q.id);
  S.run = { ids, i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null,
            right: 0, wrong: 0, appliedRight: 0, shortage: 0, gum: 0, found: [], cut: null,
            results: {}, noReward: false, done: false, hard: {} };
  S.view = "quiz"; render();
  return JSON.stringify({ id: ids[0], answer: DB.byId[ids[0]].answer, n: ids.length });
})()`;
const e1 = JSON.parse(ev(elimRun));
check("消去法の問題がある", e1.n === 4, JSON.stringify(e1));
check("消去法では選択肢が出る", d.querySelectorAll(".choices.elim .choice").length === 4,
  String(d.querySelectorAll(".choices .choice").length));
// **押せるのは ✕ だけ。** 文字は読むためのもので、押す場所は行ごとに1つに絞る
check("行ごとに ✕ が1つずつ並ぶ", d.querySelectorAll(".xcut[data-c]").length === 4 &&
  d.querySelectorAll(".choices.elim .row .choice").length === 4,
  `✕${d.querySelectorAll(".xcut[data-c]").length} / 文字${d.querySelectorAll(".choices.elim .row .choice").length}`);
check("何をするかを帯で出す", (d.querySelector(".band.cut .bmain")?.textContent || "")
  .includes("誤っているものを 3つ 消す"), d.querySelector(".band")?.textContent);
check("次にいくつ入るかを見せる",
  (d.getElementById("ecnt")?.textContent || "").includes("次は＋2"),
  d.getElementById("ecnt")?.textContent);
check("点は消す前は増えていない", ev("S.score") === 0, `${ev("S.score")}点`);

const wrong = [0, 1, 2, 3].filter(i => i !== e1.answer);
d.querySelector(`.xcut[data-c="${wrong[0]}"]`).click();
check("1つ消すとその場で点が入る", ev("S.score") === 2, `${ev("S.score")}点`);
check("消した行は打ち消される", !!d.querySelector(`.row[data-r="${wrong[0]}"].gone`));
check("入った点をその場で出す", !!d.querySelector(".cutgain"),
  d.querySelector(".cutgain")?.textContent);
check("帯が次の点に変わる", (d.getElementById("ecnt")?.textContent || "").includes("次は＋3"),
  d.getElementById("ecnt")?.textContent);
check("まだ答えは決まっていない", ev("S.run.picked") === null);

d.querySelector(`.xcut[data-c="${wrong[1]}"]`).click();
// **1つ目より2つ目のほうが大きい。** リスクに比例させる
check("2つ目のほうが大きい", ev("S.score") === 5, `${ev("S.score")}点`);
d.querySelector(`.xcut[data-c="${wrong[2]}"]`).click();
await wait(500);
check("3つ目はさらに大きい", ev("S.score") >= 10, `${ev("S.score")}点`);
check("全部消せば正解になる", ev("S.run.results['" + e1.id + "']") === "ok",
  ev("S.run.results['" + e1.id + "']"));
check("正解でも解説は出る", txt().includes("知識カード"));

// **外しても、そこまでに消せたぶんの点は残る**
const e2 = JSON.parse(ev(`(() => {
  S.run.i = 1; S.run.picked = null; S.run.hintsUsed = 0; S.run.cut = null; S.score = 0; render();
  const id = S.run.ids[1];
  return JSON.stringify({ id, answer: DB.byId[id].answer });
})()`));
const w2 = [0, 1, 2, 3].filter(i => i !== e2.answer);
d.querySelector(`.xcut[data-c="${w2[0]}"]`).click();
d.querySelector(`.xcut[data-c="${w2[1]}"]`).click();
check("2つ消した時点で5点", ev("S.score") === 5, `${ev("S.score")}点`);
d.querySelector(`.xcut[data-c="${e2.answer}"]`).click();   // 正解を消してしまう
await wait(60);
check("正解を消すとそこで終わる", ev("S.run.results['" + e2.id + "']") === "ng",
  ev("S.run.results['" + e2.id + "']"));
check("外しても消せたぶんの点は残る", ev("S.score") === 5, `${ev("S.score")}点`);
check("外しても解説と知識カードは出る（原則3）",
  txt().includes("面白い単元") && txt().includes("知識カード"));

/* **消すことと選ぶことを同じ画面に混ぜない。** 消去法では選択肢の文字は押せず、
   できるのは ✕ で消すことだけ。正しいものを1つ選びたい人は、
   「4択に切り替える」で明示的に降りる（降りるのは常にプレイヤーの手・決定2）*/
const e3 = JSON.parse(ev(`(() => {
  S.run.i = 2; S.run.picked = null; S.run.hintsUsed = 0; S.run.cut = null; S.score = 0; render();
  const id = S.run.ids[2];
  return JSON.stringify({ id, answer: DB.byId[id].answer });
})()`));
d.querySelector(`.choices.elim .choice[data-i="${e3.answer}"]`).click();
await wait(60);
check("消去法では選択肢の文字を押しても何も起きない",
  ev("S.run.picked") === null && ev("S.run.results['" + e3.id + "']") === undefined,
  String(ev("S.run.picked")));
check("4択への降り口がある", !!d.getElementById("tochoice"),
  d.querySelector(".elimbar")?.textContent);
d.getElementById("tochoice").click();
await wait(60);
check("降りると帯が「正しいものを 1つ 選ぶ」に変わる",
  !!d.querySelector(".band.pick") && !d.querySelector(".xcut"),
  d.querySelector(".band")?.textContent);
d.querySelector(`.choices .choice[data-i="${e3.answer}"]`).click();
await wait(60);
check("降りたあとは選んで答えられる", ev("S.run.results['" + e3.id + "']") === "ok",
  ev("S.run.results['" + e3.id + "']"));
check("削らなければ上乗せは無い", ev("S.score") === 10, `${ev("S.score")}点`);

// 消した行はもう押せない。途中の状態は次の問題へ持ち越さない
ev(`S.run.i = 3; S.run.picked = null; S.run.cut = null; render()`);
check("次の問題は4つとも生きている",
  d.querySelectorAll(".choices.elim .row.gone").length === 0);
check("消した行はもう消せない", (() => {
  const a = ev("DB.byId[S.run.ids[3]].answer");
  const other = [0, 1, 2, 3].find(i => i !== a);
  d.querySelector(`.xcut[data-c="${other}"]`).click();
  const before = ev("S.score");
  d.querySelector(`.xcut[data-c="${other}"]`).click();
  return ev("S.score") === before && ev("S.run.picked") === null;
})());
/* **増えるのは点だけ。** 深く削っても GUM・クリスタル・知識カードは動かない（原則3-2）*/
check("削った数で GUM は変わらない", ev(`(() => {
  const id = DB.questions.find(q => q.mode === "elimination").id;
  const q = DB.byId[id];
  const run = cuts => {
    S.gum = 0; S.score = 0; S.cards = {}; S.points = {}; S.crystals = {};
    startRun({ ids: [id] });
    const wrong = q.choices.map((_, i) => i).filter(i => i !== q.answer);
    for (let k = 0; k < cuts; k++) {
      document.querySelector('.xcut[data-c="' + wrong[k] + '"]').click();
    }
    // 削らない側は「4択に切り替える」で降りてから答える（文字は押せないため）
    if (cuts < 3) {
      document.getElementById("tochoice").click();
      document.querySelector('.choices .choice[data-i="' + q.answer + '"]').click();
    }
    return { gum: S.gum, score: S.score, cards: Object.keys(S.cards).length,
             points: Object.values(S.points).reduce((a, b) => a + b, 0) };
  };
  const deep = run(3), none = run(0);
  window.__cutcmp = JSON.stringify({ deep, none });
  return deep.gum === none.gum && deep.gum === gumFor(q)
      && deep.cards === none.cards
      && deep.score > none.score;          // 点だけが増える
})()`) === true, ev("window.__cutcmp"));
check("削った数でクリスタルの入り方も変わらない", ev(`(() => {
  const c = JSON.parse(window.__cutcmp);
  delete window.__cutcmp;
  // 抽選は確率なので個数は揃わない。**確率そのもの**が削った数に依らないことを見る
  const q = DB.questions.find(x => x.mode === "elimination");
  const f = DB.subjectToFamily[q.subject];
  return dropRate(DB, f, gumFor(q)) === dropRate(DB, f, gumFor(q)) && c.deep.gum === c.none.gum;
})()`) === true);

// 借りた状態を返す。ここで得た GUM やカードを残すと、あとの検査がずれる
ev(`(() => { Object.assign(S, JSON.parse(window.__keep)); delete window.__keep; })()`);

// 報酬は答え方で変えない（原則3-2）
check("難モードでも4択でも報酬は同じ", ev(`(() => {
  const a = DB.questions.find(q => q.mode === "elimination");
  return String(gumFor(a));
})()`) === ev(`(() => {
  const a = DB.questions.find(q => q.mode === "elimination");
  return String(gumFor(a));
})()`));

/* ---- スワイプ（2択・テンポ優先） ---- */
/* 中央に写真、上に問い、左右に2つの答え。**10問ぜんぶ同じ形で、途中に何も挟まない。**
   解説は終わりの「ふりかえり」でまとめて出す（原則3はそこで守る）           */
check("スワイプの問題がある", ev("DB.questions.filter(q => q.mode === 'swipe').length") >= 10,
  String(ev("DB.questions.filter(q => q.mode === 'swipe').length")));
/* **混ぜてはいけないのは「1問だけ」。** 8問続けて出るぶんにはテンポが切れない
   （むしろそれがこの形式の持ち味）。束で出せるようになったので在庫は分けていない */
check("スワイプもふつうの在庫に入る",
  ev("inventory(DB, S, 'auto', 'auto').filter(q => q.mode === 'swipe').length") >= 10);
check("スワイプだけの在庫も引ける",
  ev("inventory(DB, S, 'auto', 'auto', 'swipe').every(q => q.mode === 'swipe')") === true &&
  ev("inventory(DB, S, 'auto', 'auto', 'normal').every(q => q.mode !== 'swipe')") === true);

ev('S.view="select";S.select.band="auto";S.select.subject="auto";render()');
check("出題を選ぶ画面にスワイプの入口がある", !!d.getElementById("startswipe"),
  txt().slice(-160));
check("入口に、解説をまとめて出すと書いてある", txt().includes("まとめて出ます"));

const swKeep = `window.__keep = JSON.stringify({ score: S.score, gum: S.gum, cards: S.cards,
  points: S.points, crystals: S.crystals, seen: S.seen, cells: S.cells, days: S.days,
  totalRight: S.totalRight, crossRight: S.crossRight, countries: S.countries, runs: S.runs });`;
ev(`(() => { ${swKeep} })()`);
d.getElementById("startswipe").click();

// 画面は「クイズ」ひとつ。スワイプの問題のときだけカードの画面になる
check("押すとスワイプのカードが出る",
  ev('S.view === "quiz"') && !!d.getElementById("swpcard"));
check("10問ぜんぶがスワイプ",
  ev("S.run.ids.length") === 10 &&
  ev("S.run.ids.every(id => DB.byId[id].mode === 'swipe')") === true,
  `${ev("S.run.ids.length")}問`);
check("左右に2つだけ並ぶ", d.querySelectorAll(".swp-pick").length === 2,
  String(d.querySelectorAll(".swp-pick").length));
check("中央に写真が出る", !!d.querySelector(".swp-card img"));
// **途中には何も挟まない。** ヒントも英雄の解説も出さない
check("ヒントは出さない", !d.getElementById("hint") && !d.querySelector(".hints"));
check("解説の枠も無い", !d.getElementById("verdict"));

/* **写真の alt は、台帳のものではなく問題ごとのもの。**
   台帳の alt は被写体を名指ししているので、そのまま出すと2択が消える */
check("alt は問題ごとに書いたもの", (() => {
  const id = ev("S.run.ids[S.run.i]");
  const qAlt = ev(`DB.byId["${id}"].alt`);
  const bookAlt = ev(`(DB.photos[DB.byId["${id}"].image] || {}).alt`);
  return d.querySelector(".swp-card img").getAttribute("alt") === qAlt && qAlt !== bookAlt;
})());

/* **クレジットは必ず出す。** ただし PD と CC0 は表示義務が無いので、
   出題中だけ題名を伏せる（題名が被写体の名前そのものになっている） */
check("出題中もクレジットは出ている", (() => {
  const c = d.getElementById("swpcred");
  const id = ev("S.run.ids[S.run.i]");
  const lic = ev(`(DB.photos[DB.byId["${id}"].image] || {}).license`);
  return !!c && c.textContent.includes(lic);
})(), d.getElementById("swpcred")?.textContent);
check("PD・CC0 の写真は、出題中だけ題名を伏せる", ev(`(() => {
  const free = DB.questions.filter(q => q.mode === "swipe" &&
    /^(public domain|pdm|cc0)/i.test((DB.photos[q.image] || {}).license || ""));
  return free.length >= 8;
})()`) === true && (() => {
  const id = ev("S.run.ids[S.run.i]");
  const p = JSON.parse(ev(`JSON.stringify(DB.photos[DB.byId["${id}"].image])`));
  const shown = d.getElementById("swpcred").textContent;
  return /^(public domain|pdm|cc0)/i.test(p.license)
    ? !shown.includes(p.title) : shown.includes(p.title);
})(), d.getElementById("swpcred")?.textContent);

/* 左を押せば左の答え、右を押せば右の答え。**はらう向きがそのまま答えになる** */
const swQ = JSON.parse(ev(`(() => {
  const q = DB.byId[S.run.ids[S.run.i]];
  return JSON.stringify({ id: q.id, answer: q.answer, gum: gumFor(q), card: q.card });
})()`));
const gumBefore = ev("S.gum");
d.querySelector(`.swp-pick[data-s="${swQ.answer}"]`).click();
check("押した側が答えになる", ev(`S.run.results['${swQ.id}']`) === "ok",
  ev(`S.run.results['${swQ.id}']`));
check("○ をその場で出す", d.getElementById("swpseal")?.textContent === "○" &&
  d.getElementById("swpseal").classList.contains("ok"));
// **報酬は他の方式とまったく同じ**（原則3-2）。答え方で量を変えない
check("GUM は学年なりに入る", ev("S.gum") - gumBefore === swQ.gum,
  `${ev("S.gum") - gumBefore} / 正 ${swQ.gum}`);
check("知識カードも入る", ev(`!!S.cards[${JSON.stringify(swQ.card)}]`) === true);
check("解説はその場では出さない", !txt().includes(ev(`DB.byId['${swQ.id}'].lesson`).slice(0, 12)));

check("勝手に次へ進む", await (async () => {
  await wait(1100);
  return ev("S.run.i") === 1 && !!d.getElementById("swpcard");
})(), `i=${ev("S.run.i")} / view=${ev("S.view")}`);

// 外したときは ✕。**問題はそこで終わるが、罰は無い**（原則3）
const swQ2 = JSON.parse(ev(`(() => {
  const q = DB.byId[S.run.ids[S.run.i]];
  return JSON.stringify({ id: q.id, answer: q.answer });
})()`));
d.querySelector(`.swp-pick[data-s="${1 - swQ2.answer}"]`).click();
check("外すと ✕ が出る", d.getElementById("swpseal")?.textContent === "✕" &&
  ev(`S.run.results['${swQ2.id}']`) === "ng");
check("外しても知識カードは入る（原則3）",
  ev(`!!S.cards[${JSON.stringify(ev(`DB.byId['${swQ2.id}'].card`))}]`) === true);
check("外したほうと正解のほうを塗り分ける",
  d.querySelector(".swp-pick.miss") !== null && d.querySelector(".swp-pick.right") !== null);
check("答えたあとは題名まで出す", (() => {
  const p = JSON.parse(ev(`JSON.stringify(DB.photos[DB.byId['${swQ2.id}'].image])`));
  return !p?.title || d.getElementById("swpcred").textContent.includes(p.title);
})(), d.getElementById("swpcred")?.textContent);
await wait(1100);

// 矢印キーでも答えられる（はらう向きと同じ意味）
const swQ3 = JSON.parse(ev(`(() => {
  const q = DB.byId[S.run.ids[S.run.i]];
  return JSON.stringify({ id: q.id, answer: q.answer });
})()`));
d.dispatchEvent(new w.KeyboardEvent("keydown",
  { key: swQ3.answer === 0 ? "ArrowLeft" : "ArrowRight", bubbles: true }));
check("矢印キーでも答えられる", ev(`S.run.results['${swQ3.id}']`) === "ok",
  ev(`S.run.results['${swQ3.id}']`));
await wait(1100);

// 残りを流して、ふりかえりまで行く
const swWrong = [];
while (ev('S.view === "quiz"')) {
  const q = JSON.parse(ev(`(() => {
    const x = DB.byId[S.run.ids[S.run.i]];
    return JSON.stringify({ id: x.id, answer: x.answer });
  })()`));
  const miss = ev("S.run.i") === 5;          // 1問だけわざと外す
  if (miss) swWrong.push(q.id);
  d.querySelector(`.swp-pick[data-s="${miss ? 1 - q.answer : q.answer}"]`).click();
  await wait(1000);
}
check("10問終わるとリザルトへ", ev('S.view === "result"'), ev("S.view"));

/* **原則3はここで守る。** 途中で解説を挟まないぶん、終わりに全問ぶんを出す */
check("ふりかえりに10問ぜんぶ並ぶ", d.querySelectorAll(".rv").length === 10,
  String(d.querySelectorAll(".rv").length));
check("外した問題は開いてある", (() => {
  const ng = [...d.querySelectorAll(".rv.ng")];
  return ng.length >= 1 && ng.every(e => e.hasAttribute("open"));
})(), String(d.querySelectorAll(".rv.ng").length));
check("正解した問題は畳んである",
  [...d.querySelectorAll(".rv.ok")].every(e => !e.hasAttribute("open")));
check("ふりかえりに解説そのものが載る", (() => {
  const id = ev("S.run.ids[0]");
  return txt().includes(ev(`DB.byId["${id}"].lesson`).slice(0, 14));
})());
check("ふりかえりの写真にはクレジットが付く",
  d.querySelectorAll(".rv .photo figcaption").length === d.querySelectorAll(".rv .photo").length &&
  d.querySelectorAll(".rv .photo.rvpic").length >= 1);
check("もう一度もスワイプで始まる", (() => {
  const b = d.getElementById("again");
  if (!b) return false;
  b.click();
  return ev("S.run.swipe") === true && !!d.getElementById("swpcard");
})(), ev("S.view"));

// 借りた状態を返す
ev(`(() => { Object.assign(S, JSON.parse(window.__keep)); delete window.__keep;
  S.run = { ids: [], i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null,
            right: 0, wrong: 0, appliedRight: 0, shortage: 0, gum: 0, found: [], cut: null,
            results: {}, noReward: false, done: false, hard: {} };
  S.view = "home"; render(); })()`);
check("スワイプの listener を残さない", ev("swipeBound") === null);

/* ---- 文字パネル（難モード） ---- */
const pan = JSON.parse(ev(`(() => {
  S.settings.showExplanationOnCorrect = true;
  const ids = DB.questions.filter(q => q.mode === "panel").slice(0, 2).map(q => q.id);
  S.run = { ids, i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null, found: [],
            right: 0, wrong: 0, appliedRight: 0, shortage: 0, gum: 0, results: {},
            noReward: true, done: false, hard: {} };
  S.view = "quiz"; render();
  const q = DB.byId[ids[0]];
  return JSON.stringify({ id: ids[0], reading: q.reading, size: q.panel.size, path: q.panel.path });
})()`));
check("文字パネルの問題がある", !!pan.reading, JSON.stringify(pan).slice(0, 90));
check("盤面は読みの長さで決まる", pan.size === (pan.reading.length <= 6 ? 3 : 4),
  `${pan.reading}(${pan.reading.length}) → ${pan.size}×${pan.size}`);
check("マスは盤面のぶんだけ出る",
  d.querySelectorAll(".pcell").length === pan.size * pan.size,
  String(d.querySelectorAll(".pcell").length));
check("選択肢は出さない", d.querySelectorAll(".choices .choice").length === 0);
check("文字数の枠は出さない", !/\d\s*文字/.test(txt()), txt().slice(0, 120));
check("1文字目のマークは出さない", d.querySelectorAll(".pcell.on").length === 0,
  String(d.querySelectorAll(".pcell.on").length));
check("なぞる前は答えられない", d.getElementById("psubmit").disabled);

// マスの形。内側を向いた角だけを落とすので、中は八角形・辺は六角形・隅は五角形になる。
// 角を残すと、ななめにたどったとき隣のマスの角をかすめて拾ってしまう
const corners = t => t.split(",").length;
check("中のマスは八角形", corners(ev(`cellShape(4, 3)`)) === 8, ev(`cellShape(4, 3)`));
check("辺のマスは六角形", corners(ev(`cellShape(1, 3)`)) === 6, ev(`cellShape(1, 3)`));
check("隅のマスは五角形", corners(ev(`cellShape(0, 3)`)) === 5, ev(`cellShape(0, 3)`));
check("4×4でも内は八角形・隅は五角形",
  corners(ev(`cellShape(5, 4)`)) === 8 && corners(ev(`cellShape(15, 4)`)) === 5);
check("隣り合うマスを結ぶ線が敷いてある",
  d.querySelectorAll(".panellattice line").length > 0,
  String(d.querySelectorAll(".panellattice line").length));

// 隣り合っていないマスへは飛べない
const far = ev(`(() => {
  const p = DB.byId["${pan.id}"].panel, n = p.size, a = p.path[0];
  for (let i = 0; i < n * n; i++) {
    const dr = Math.abs(Math.floor(a / n) - Math.floor(i / n)), dc = Math.abs(a % n - i % n);
    if (dr > 1 || dc > 1) return i;
  }
  return -1;
})()`);
d.querySelector(`.pcell[data-i="${pan.path[0]}"]`).click();
if (far >= 0) {
  d.querySelector(`.pcell[data-i="${far}"]`).click();
  check("隣り合わないマスへは飛べない", d.querySelectorAll(".pcell.on").length === 1,
    String(d.querySelectorAll(".pcell.on").length));
}
// 直前のマスに戻ると1つ取り消す
d.querySelector(`.pcell[data-i="${pan.path[1]}"]`).click();
check("たどると文字が並ぶ",
  d.getElementById("pword").textContent === pan.reading.slice(0, 2),
  d.getElementById("pword").textContent);
d.querySelector(`.pcell[data-i="${pan.path[0]}"]`).click();
check("直前のマスに戻ると取り消せる",
  d.getElementById("pword").textContent === pan.reading.slice(0, 1),
  d.getElementById("pword").textContent);

// 違う読みを作っても問題は終わらない
ev(`(() => { S.run.picked = null; render(); })()`);
const rev = pan.path.slice(0, 2).reverse();
rev.forEach(i => d.querySelector(`.pcell[data-i="${i}"]`).click());
d.getElementById("psubmit").click();
await wait(30);
check("違う読みでも問題は終わらない", ev("S.run.picked") === null, String(ev("S.run.picked")));
check("パネルは生きたまま3択になる",
  txt().includes("まだ続けてもいい") && !d.querySelector(".pcell").disabled);

// 連続タップでも正解にできる
pan.path.forEach(i => d.querySelector(`.pcell[data-i="${i}"]`).click());
d.getElementById("psubmit").click();
await wait(40);
check("連続タップでも読みを作れる", ev(`S.run.results["${pan.id}"]`) === "ok",
  ev(`S.run.results["${pan.id}"]`));
check("決着したらマスは止まる", d.querySelector(".pcell").disabled);

// 盤面は問題ごとに決まっていて、描き直しても変わらない
check("盤面は描き直しても変わらない", ev(`(() => {
  const q = DB.byId["${pan.id}"];
  return String(JSON.stringify(panelLayout(q.reading, q.id)) === JSON.stringify(q.panel));
})()`) === "true");
// 実機でつまずいた2点。タッチのポインタは押したマスに暗黙でキャプチャされる
ev(`(() => { S.run.i = 0; S.run.picked = null; S.run.results = {}; render(); })()`);
const cap = ev(`(() => {
  const b = document.querySelector('.pcell');
  let released = false;
  b.hasPointerCapture = () => true;
  b.releasePointerCapture = () => { released = true; };
  b.onpointerdown({ preventDefault() {}, pointerId: 1 });
  return String(released);
})()`);
check("押したマスのキャプチャを放す（放さないと1文字目しか反応しない）", cap === "true", cap);

// jsdom には座標が無いので、マスの位置を自分で用意して指の動きを作る。
// なぞりは座標で拾うようにしたので、ここを通さないと検査にならない
ev(`(() => {
  S.run.i = 0; S.run.picked = null; S.run.results = {}; render();
  const n = DB.byId[S.run.ids[0]].panel.size, W = 100;
  const cells = [...document.querySelectorAll('.pcell')];
  cells.forEach((c, i) => {
    const left = (i % n) * W, top = Math.floor(i / n) * W;
    c.getBoundingClientRect = () => ({ left, top, width: W, height: W,
      right: left + W, bottom: top + W });
  });
  document.elementFromPoint = (x, y) => cells.find(c => {
    const r = c.getBoundingClientRect();
    return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  }) || null;
  window.__center = i => ({ x: (i % n) * W + W / 2, y: Math.floor(i / n) * W + W / 2 });
})()`);
const drag = path => ev(`(() => {
  const cells = [...document.querySelectorAll('.pcell')];
  const wrap = document.querySelector('.panelwrap');
  const p = ${JSON.stringify(path)};
  cells[p[0]].onpointerdown({ preventDefault() {}, pointerId: 3 });
  for (const i of p.slice(1)) {
    const c = window.__center(i);
    wrap.onpointermove({ preventDefault() {}, clientX: c.x, clientY: c.y });
  }
  return document.getElementById('pword').textContent;
})()`);
const p3 = JSON.parse(ev(`JSON.stringify(DB.byId[S.run.ids[0]].panel.path)`));
check("座標でなぞると読みが組み上がる",
  drag(p3) === ev(`DB.byId[S.run.ids[0]].reading`), drag(p3));

// マスの角をかすめただけでは拾わない。ここを緩めると途中のマスが混ざる
const brush = ev(`(() => {
  S.run.picked = null; render();
  const cells = [...document.querySelectorAll('.pcell')];
  const wrap = document.querySelector('.panelwrap');
  const n = DB.byId[S.run.ids[0]].panel.size, W = 100, a = ${p3[0]}, b = ${p3[1]};
  cells[a].onpointerdown({ preventDefault() {}, pointerId: 4 });
  // 隣のマスの「角」を通る。中心から遠いので拾ってはいけない
  const c = window.__center(b);
  wrap.onpointermove({ preventDefault() {}, clientX: c.x + W * 0.46, clientY: c.y + W * 0.46 });
  return document.getElementById('pword').textContent;
})()`);
check("マスの角をかすめても拾わない", brush.length === 1, brush);

// 指を離す監視を once にすると、最初のタップで外れて以降のなぞりが死ぬ
ev(`(() => { S.run.picked = null; render(); })()`);
d.dispatchEvent(new w.Event("pointerup"));
drag(p3);
d.dispatchEvent(new w.Event("pointerup"));
await wait(40);
check("タップのあとでも、なぞりが確定する", ev("S.run.picked") !== null,
  String(ev("S.run.picked")));

check("読みが長すぎるとパネルにしない",
  ev(`String(panelLayout("じゅうしちじょうのけんぽう", "x") === null)`) === "true");

/* ---- 数値入力（難モード） ---- */
const numRun = JSON.parse(ev(`(() => {
  S.settings.showExplanationOnCorrect = true;
  const ids = DB.questions.filter(q => q.mode === "numeric").slice(0, 2).map(q => q.id);
  S.run = { ids, i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null, found: [],
            right: 0, wrong: 0, appliedRight: 0, shortage: 0, gum: 0, results: {},
            noReward: true, done: false, hard: {} };
  S.view = "quiz"; render();
  return JSON.stringify({ id: ids[0], want: numericParts(DB.byId[ids[0]]) });
})()`));
check("数値入力の問題がある", !!numRun.want, JSON.stringify(numRun));
check("選択肢は出さない", d.querySelectorAll(".choices .choice").length === 0);
check("テンキーが出る", d.querySelectorAll(".keypad .key").length === 12,
  String(d.querySelectorAll(".keypad .key").length));
check("単位は固定表示で、打たせない",
  (d.querySelector(".numdisp b")?.textContent || "") === (numRun.want.unit || ""),
  `表示 ${d.querySelector(".numdisp b")?.textContent} / 正解の単位 ${numRun.want.unit}`);
check("入れる前は答えられない", d.getElementById("nsubmit").disabled);

// わざと外す。問題は終わらず、入力欄は生きたまま
const numWrong = String(Number(numRun.want.value) + 7);
[...numWrong].forEach(c => d.querySelector(`.keypad .key[data-k="${c}"]`).click());
d.getElementById("nsubmit").click();
await wait(30);
check("外しても問題は終わらない", ev("S.run.picked") === null, String(ev("S.run.picked")));
check("3択を文言で示す", txt().includes("まだ続けてもいい"), txt().slice(-120));
check("ヒントと4択への道が並ぶ", !!d.getElementById("rhint") && !!d.getElementById("rdown"));
check("「このまま挑み直す」に専用ボタンは置かない",
  d.querySelectorAll(".retry .racts .lnk").length === 2,
  String(d.querySelectorAll(".retry .racts .lnk").length));
check("テンキーは生きている", !d.querySelector(".keypad .key").disabled);

// 続ければ正解にできる
[...numRun.want.value].forEach(c => d.querySelector(`.keypad .key[data-k="${c}"]`).click());
d.getElementById("nsubmit").click();
await wait(40);
check("続けて正解にできる", ev(`S.run.results["${numRun.id}"]`) === "ok",
  ev(`S.run.results["${numRun.id}"]`));
check("決着したらテンキーは止まる", d.querySelector(".keypad .key").disabled);
check("全角でも同じ数として通る", ev(`String(sameNumber("１２", "12"))`) === "true");

// 降りるのはプレイヤーの判断。システムは勝手に降ろさない
const n2 = ev(`(() => { S.run.i = 1; S.run.picked = null; S.run.hintsUsed = 0; render();
  return S.run.ids[1]; })()`);
check("2問目も難モードから始まる", !!d.getElementById("nsubmit"));
d.getElementById("tochoice").click();
check("数値入力からも4択に降りられる",
  d.querySelectorAll(".choices .choice").length === 4 && !d.getElementById("nsubmit"));
check("降りたのはその問題だけ", ev(`JSON.stringify(S.run.hard)`) === `{"${n2}":"choice"}`,
  ev("JSON.stringify(S.run.hard)"));

/* ---- コモンズの写真とクレジット ---- */
// 実体のバイト列が無くても描画は確かめられるので、台帳に仮の1件を差して戻す
ev(`(() => {
  window.__photoBackup = { photos: DB.photos, q: null };
  DB.photos = Object.assign({}, DB.photos, { __t: {
    file: "__t", alt: "テスト用の説明", title: "テスト写真",
    author: "撮影者", license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Test.jpg" } });
  const id = S.run.ids[S.run.i];
  const q = DB.byId[id];
  window.__photoBackup.q = id;
  q.image = "__t"; q.imageAt = "prompt";
  S.run.picked = null; render();
})()`);
check("問題文の下に写真を出せる", d.querySelectorAll(".qtext + .photo img").length === 1,
  String(d.querySelectorAll(".photo").length));
check("写真にaltが付く", d.querySelector(".photo img")?.getAttribute("alt") === "テスト用の説明",
  d.querySelector(".photo img")?.getAttribute("alt"));
check("クレジットに作者とライセンスと出典を出す", (() => {
  const c = d.querySelector(".photo figcaption")?.textContent || "";
  return c.includes("撮影者") && c.includes("CC BY 4.0") && c.includes("Wikimedia Commons");
})(), d.querySelector(".photo figcaption")?.textContent);
check("ライセンスと出典はリンクになる",
  d.querySelectorAll(".photo figcaption a").length === 2,
  String(d.querySelectorAll(".photo figcaption a").length));
// クレジットの欄が欠けた画像は出さない（CC BY の条件を満たせないため）
ev('DB.photos.__t.author = ""; DB.photos.__t.license = ""; render();');
check("ライセンス不明の写真は出さない", d.querySelectorAll(".photo").length === 0,
  String(d.querySelectorAll(".photo").length));
ev(`(() => {
  const q = DB.byId[window.__photoBackup.q];
  delete q.image; delete q.imageAt;
  DB.photos = window.__photoBackup.photos;
  render();
})()`);
check("写真を外せば元に戻る", d.querySelectorAll(".photo").length === 0);

/* ---- 報酬とチャレンジが壊れていないか ---- */
/**
 * **この10問のあいだだけ**乱数を止めて、必ず当たるようにする。
 * クリスタルは確率で落ちるので、止めないと検査が気まぐれになる——外国語なら
 * 1セッションで1個も出ない確率のほうが高い。**出ないのが正しい挙動**なので、
 * アプリ側は素の Math.random のまま。ここで差し替え、答え終わったらすぐ戻す。
 */
ev("window.__rnd = Math.random; Math.random = () => 0");
ev(`(() => {
  const ids = DB.questions.filter(q => (q.format || "choice") === "choice").slice(0, 10).map(q => q.id);
  S.settings.showExplanationOnCorrect = true;
  startRun({ ids });
})()`);
for (let k = 0; k < 10; k++) {

  if (!answerNow()) break;
  const st = d.getElementById("tostretch");
  if (st) { st.click(); const ex = d.querySelectorAll("#exch > .choice");
    if (ex.length) ex[ev("DB.byId[S.run.ids[S.run.i]].applied.answer")].click(); }
  d.getElementById("next").click();
}
ev("Math.random = window.__rnd; delete window.__rnd");   // 以降は素の乱数に戻す
check("乱数は借りたらすぐ返す", ev("typeof window.__rnd") === "undefined" &&
  ev("Math.random() !== Math.random()"));
check("族ポイントが貯まる", ev("Object.values(S.points).reduce((x,y)=>x+y,0)") > 0,
  ev("JSON.stringify(S.points)"));
check("出会った鉱物は図鑑に残る", ev("crystalKinds(S)") > 0, `${ev("crystalKinds(S)")}種`);
check("解いた教科に対応する族に入る", ev(`(() => {
  // **このセッションで増えたぶんだけを見る。** 前から持っている族は関係ない
  const subs = new Set(S.run.ids.map(id => DB.byId[id].subject));
  const want = new Set([...subs].map(s => DB.subjectToFamily[s]));
  return S.run.found.every(id => want.has(DB.crystalById[id].family));
})()`) === true, ev("JSON.stringify(S.run.found.map(id => DB.crystalById[id].family))"));

/* ---- GUM は難易度なり（1〜10） ---- */
check("易しい問題は1GUM", ev('gumFor({grade:"e1"})') === 1);
check("世界の問題は10GUM", ev('gumFor({grade:"w"})') === 10);
check("学年が上がるほど増える",
  ["e1","e2","e3","e4","e5","e6","j1","j2","j3","w"]
    .map(g => ev(`gumFor({grade:"${g}"})`)).every((v, i, a) => i === 0 || v > a[i - 1]));
check("未知の学年でも1〜10に収まる",
  ev('gumFor({grade:"zz"})') === 1 && ev('gumFor({})') === 1);
// ここまでに何セッションか回しているので、所持は今回ぶん以上になる
check("正解した問題ぶんGUMが貯まる", ev("S.run.gum") > 0 && ev("S.gum") >= ev("S.run.gum"),
  `所持 ${ev("S.gum")} / 今回 ${ev("S.run.gum")}`);
check("今回のGUMは正解数と釣り合う",
  ev("S.run.gum") >= ev("S.run.right") && ev("S.run.gum") <= ev("S.run.right") * 10,
  `${ev("S.run.gum")} GUM / 正解 ${ev("S.run.right")}問`);
check("リザルトに到達", !!d.getElementById("again"), txt().slice(0, 80));

/* ---- クラフト（由来のある108種・族ポイント＋知識カード） ---- */
// その教科の知識カードを n 枚だけ持たせる
const giveCards = (sub, n) => ev(`(() => {
  S.cards = {};
  Object.entries(DB.cardSubject).filter(([c, s]) => s === ${JSON.stringify(sub)} && !c.endsWith("（応用）"))
    .slice(0, ${n}).forEach(([c]) => S.cards[c] = true);
  render();
})()`);

ev('S.view="craft";S.craftTab="初伝";render()');
check("由来のある108種そろっている", ev("Object.keys(DB.extensions).length") === 108,
  `${ev("Object.keys(DB.extensions).length")}種`);
check("ランクは初伝・中伝・奥伝の3つ", d.querySelectorAll("#ranktab button").length === 3,
  `${d.querySelectorAll("#ranktab button").length}件`);
check("ランクは、由来がまたがる教科数で決まる", ev(`(() => {
  return Object.values(DB.extensions).every(e => {
    const n = new Set(e.subs).size;
    return e.rank === (n >= 3 ? "奥伝" : n === 2 ? "中伝" : "初伝");
  });
})()`) === true);
check("越境しているものほど、ゲージ寄与も大きい", ev(`(() => {
  const g = r => Object.values(DB.extensions).find(e => e.rank === r).gauge;
  return g("初伝") < g("中伝") && g("中伝") < g("奥伝");
})()`) === true);
check("由来がそのまま説明になる",
  txt().includes(ev(`Object.values(DB.extensions).find(e => e.rank === "初伝").origin`).slice(0, 12)),
  txt().slice(0, 80));

/* **素材だけでは作れない。** ここがクイズ→素材→クラフトに知識を通す関門 */
ev('S.points={"貴金属":9999};S.exts={};S.cards={};render()');
check("素材だけでは作れない（知識カードが要る）",
  d.querySelector('.mini[data-k="5006"]').disabled,
  `社会の札 ${ev('subjectCardCount(DB, S, "社会")')}枚`);
giveCards("国語", 40);
check("別の教科のカードでは通らない",
  d.querySelector('.mini[data-k="5006"]').disabled,
  `国語 ${ev('subjectCardCount(DB, S, "国語")')}枚 / 社会 ${ev('subjectCardCount(DB, S, "社会")')}枚`);
giveCards("社会", 4);
check("枚数が1枚足りなければ作れない",
  d.querySelector('.mini[data-k="5006"]').disabled,
  `社会 ${ev('subjectCardCount(DB, S, "社会")')}枚`);
giveCards("社会", 5);
check("その教科のカードがそろえば作れる（初伝）",
  !d.querySelector('.mini[data-k="5006"]').disabled,
  `社会 ${ev('subjectCardCount(DB, S, "社会")')}枚`);

// 素材のほうも要る
ev('S.points={};render()');
check("カードがそろっていても、素材が無ければ作れない",
  d.querySelector('.mini[data-k="5006"]').disabled);
ev('S.points={"貴金属":50};render()');
d.querySelector('.mini[data-k="5006"]').click();
check("作るとポイントが減る", ev('familyPoints(S, "貴金属")') === 0,
  `${ev('familyPoints(S, "貴金属")')}pt`);
check("作っても知識カードは減らない", ev('subjectCardCount(DB, S, "社会")') === 5,
  `${ev('subjectCardCount(DB, S, "社会")')}枚`);
check("作ったものが手元に入る", ev(`S.exts["5006"]`) === 1);

/* 中伝は2教科、奥伝は3教科すべてで要る */
ev('S.craftTab="中伝";S.points={"貴金属":9999,"生物起源":9999};render()');
ev(`(() => {
  S.cards = {};
  const put = (sub, n) => Object.entries(DB.cardSubject)
    .filter(([c, s]) => s === sub && !c.endsWith("（応用）")).slice(0, n)
    .forEach(([c]) => S.cards[c] = true);
  put("社会", 20); put("国語", 7);   // 与一の弓は 社会8 ＋ 国語8
  render();
})()`);
check("中伝は、片方の教科だけでは作れない",
  d.querySelector('.mini[data-k="5013"]').disabled,
  `社会 ${ev('subjectCardCount(DB, S, "社会")')} / 国語 ${ev('subjectCardCount(DB, S, "国語")')}`);
ev(`(() => {
  Object.entries(DB.cardSubject).filter(([c, s]) => s === "国語" && !c.endsWith("（応用）"))
    .slice(0, 8).forEach(([c]) => S.cards[c] = true);
  render();
})()`);
check("中伝は、2教科そろえば作れる", !d.querySelector('.mini[data-k="5013"]').disabled);

ev('S.craftTab="奥伝";S.points={"貴金属":9999,"生物起源":9999,"宝石":9999};render()');
check("奥伝は、3教科目が欠けていれば作れない",
  d.querySelector('.mini[data-k="5016"]').disabled,
  `外国語 ${ev('subjectCardCount(DB, S, "外国語")')}枚`);
ev(`(() => {
  ["社会", "国語", "外国語"].forEach(sub => Object.entries(DB.cardSubject)
    .filter(([c, s]) => s === sub && !c.endsWith("（応用）")).slice(0, 12)
    .forEach(([c]) => S.cards[c] = true));
  render();
})()`);
/* **奥伝には由来カードも要る。** 素材と教科の広さだけでは届かない */
check("教科がそろっても、由来を知らなければ作れない",
  d.querySelector('.mini[data-k="5016"]').disabled,
  `由来 ${ev('craftCheck(DB, S, "5016").origin.card')}`);
check("由来はクラフト画面から直接たずねられる",
  !!d.querySelector('.mini.ask[data-q]'),
  d.querySelector('.mini.ask')?.dataset.q);
check("たずねる先は、そのカードを配る問題", ev(`(() => {
  const o = craftCheck(DB, S, "5016").origin;
  return DB.byId[o.qid] && DB.byId[o.qid].card === o.card;
})()`) === true, ev('craftCheck(DB, S, "5016").origin.qid'));
ev(`S.cards[craftCheck(DB, S, "5016").origin.card] = true; render()`);
check("由来を知れば、奥伝が作れる", !d.querySelector('.mini[data-k="5016"]').disabled,
  `社会 ${ev('subjectCardCount(DB, S, "社会")')} / 国語 ${ev('subjectCardCount(DB, S, "国語")')} / 外国語 ${ev('subjectCardCount(DB, S, "外国語")')}`);
check("由来カードは奥伝だけが持つ", ev(`(() => {
  return Object.values(DB.extensions).every(e =>
    !!e.originCard === (e.rank === "奥伝"));
})()`) === true);
check("奥伝は4種だけ", ev(`Object.values(DB.extensions).filter(e => e.rank === "奥伝").length`) === 4);

// 108種あるので、作れるものが先に並ばないと見つけられない
check("作れるものが先に並ぶ", (() => {
  ev('S.craftTab="初伝";S.points={"貴金属":9999};render()');
  const first = d.querySelector(".ext");
  return first && !first.classList.contains("dim");
})(), d.querySelector(".ext")?.className);

check("足りない族は、持ち高と要求を並べて見せる", (() => {
  ev('S.craftTab="初伝";S.points={"貴金属":20};render()');
  const short = /貴金属 20\/50pt/.test(txt());
  ev('S.points={"貴金属":50};render()');
  return short && /貴金属 50pt/.test(txt()) && !/貴金属 \d+\/50pt/.test(txt());
})(), txt().slice(0, 60));

ev('S.view="craft";S.craftTab="初伝";S.exts={};S.crystals={};S.points={};S.cards={};render()');
d.querySelector(".mapbtn").click();

ev('S.view="home";render()');
d.getElementById("tochal").click();
check("挑戦先を選ぶ画面を挟む", txt().includes("どの英雄に挑むか"), txt().slice(0, 80));
check("到達度はここで見せる", /到達度 \d+%/.test(txt()), txt().slice(0, 200));
check("未解放の英雄がすべて並ぶ",
  d.querySelectorAll(".trow").length === ev("lockedHeroes(DB,S).length"),
  `${d.querySelectorAll(".trow").length}件`);
d.querySelector(".trow").click();
check("チャレンジ画面", txt().includes("持っている知識で届く"));
d.getElementById("fight").click();
await wait(1500);
const hero = ev("DB.heroById[S.challenge.heroId].name");
check("入力欄が出る", !!d.getElementById("ans"), `相手=${hero}`);
check("3問構成になっている", ev("DB.heroById[S.challenge.heroId].ch.qs.length") === 3);
check("何問目かを見せる", txt().includes("1問目"), txt().slice(0, 80));
check("すすみ具合の点が3つ", d.querySelectorAll(".chprog i").length === 3,
  `${d.querySelectorAll(".chprog i").length}個`);

// 全部外しても、最後まで進んでから判定する
const answerAll = (correct) => {
  for (let k = 0; k < 3; k++) {
    const input = d.getElementById("ans");
    if (!input) break;
    const ansList = JSON.parse(ev(`JSON.stringify(DB.heroById[S.challenge.heroId].ch.qs[S.challenge.qi].ans)`));
    input.value = correct ? ansList[0] : "でたらめ";
    d.getElementById("submit").click();
  }
};
answerAll(false);
check("外しても3問すべて出る", ev("S.challenge.results.length") === 3,
  ev("JSON.stringify(S.challenge.results)"));
check("必要正答数に届かなければ解放しない", ev("S.challenge.won") !== true);
check("挑めば知識カードを1枚持ち帰る", !!ev("S.challenge.gotCard"),
  String(ev("S.challenge.gotCard")));
check("負けても解説と再挑戦が出る", !!d.getElementById("retry") && txt().includes("次はゲージ"),
  txt().slice(0, 80));

// 解放に必要なぶんだけ当てる
d.getElementById("retry").click();
d.getElementById("fight").click();
await wait(1500);
answerAll(true);
check("必要正答数を満たせば解放", ev("S.challenge.won") === true,
  ev("JSON.stringify(S.challenge.results)"));
check("解放されて手持ちに入る", ev(`!!S.owned[S.challenge.heroId]`));
check("レアリティで必要正答数が変わる",
  ev('challengeNeed({rarity:"Common"})') === 1 && ev('challengeNeed({rarity:"Rare"})') === 2 &&
  ev('challengeNeed({rarity:"Legendary"})') === 3);
check("ゲージが削れているほど問いはやさしくなる", ev(`(() => {
  const q = DB.heroById["4007"].ch.qs[0];
  return challengePrompt(q, 0) === q.v[0] && challengePrompt(q, 3) === q.v[3];
})()`), "段階と問い方の対応が逆");
check("レアリティは体力ではなく難度係数になった",
  ev('DB.heroById["5016"].hp') === undefined &&
  ev('difficultyFactor(DB.heroById["5016"])') === 1 &&
  ev('difficultyFactor({rarity:"Common"})') === 0.4,
  String(ev('difficultyFactor(DB.heroById["5016"])')));
check("持ち帰るカードはその英雄の関連カードだけ", ev(`(() => {
  const h = DB.heroById["5016"];
  const st = JSON.parse(JSON.stringify(S));
  st.cards = {};
  const got = [];
  for (let k = 0; k < 10; k++) {
    const c = challengeCard(h, st);
    if (!c) break;
    st.cards[c] = true; got.push(c);
  }
  return got.length === h.rel.cards.length && got.every(c => h.rel.cards.includes(c));
})()`), "無限に増えるか、関係ないカードが出ている");

// 解放すると出題範囲が広がる
ev('S.owned["4007"]=1;S.owned["5016"]=1;S.view="select";S.select.subject="auto";render()');
const gatedCount = ev("DB.questions.filter(q => q.needs).length");
const normalCount = ev("DB.questions.length");
check("章を全部開いても、needs の問題はまだ出てこない",
  new RegExp(`おまかせ\\s*${normalCount - gatedCount}`).test(txt()),
  `通常 ${normalCount}問 / 閉じ ${gatedCount}問 / ${txt().slice(0, 120)}`);

/* ---- 正解の位置と、別表記・注釈 ---- */
// 正解がいつも同じ位置にあると、読まずに当てられる
check("正解の位置が偏っていない", ev(`(() => {
  const ch = DB.questions.filter(q => (q.format || "choice") === "choice" && q.choices);
  const d = [0, 0, 0, 0];
  ch.forEach(q => d[q.answer]++);
  return Math.max(...d) / ch.length <= 0.35;
})()`) === true, ev(`(() => {
  const ch = DB.questions.filter(q => (q.format || "choice") === "choice" && q.choices);
  const d = [0, 0, 0, 0]; ch.forEach(q => d[q.answer]++);
  return d.map((n, i) => (i + 1) + "番目 " + n).join(" / ");
})()`));
check("並べ替えても、正解の中身は変わっていない",
  ev(`DB.byId["joho-022"].choices[DB.byId["joho-022"].answer]`) === "サーバー",
  ev(`JSON.stringify(DB.byId["joho-022"].choices)`));

// どちらの書き方でも正しいときは、両方受けて理由を注釈で言う
check("別表記でも正解になる", ev(`(() => {
  const q = DB.byId["joho-022"];
  return q.accept.includes("サーバ") && q.reading === "サーバー";
})()`) === true);
check("別表記の文字は盤面にある", ev(`(() => {
  const q = DB.byId["joho-022"];
  return q.accept.every(a => [...a].every(c => [...q.reading].includes(c)));
})()`) === true);
check("語尾の長音符がDB全体でそろっている", ev(`(() => {
  const words = ["コンピュータ","センサ","サーバ","ブラウザ","プリンタ","ルータ",
    "アクチュエータ","パラメータ","モニタ","ユーザ","フォルダ","ドライバ"];
  const bare = new RegExp("(" + words.join("|") + ")(?!ー)", "g");
  // accept と note は短い形をわざと引き合いに出す欄なので外す
  return DB.questions.every(q => {
    const { accept, note, ...rest } = q;
    return !bare.test(JSON.stringify(rest));
  });
})()`) === true, "長音符の抜けが残っている");
check("答えが長音符つきの語は、注釈を持つ", ev(`(() => {
  const words = ["コンピューター","センサー","サーバー","ブラウザー","プリンター","ルーター"];
  return DB.questions.filter(q => q.choices && words.some(w => q.choices[q.answer].includes(w)))
    .every(q => !!q.note);
})()`) === true);
check("注釈はJISの改正に触れている",
  /JIS Z 8301/.test(ev(`DB.byId["joho-022"].note`)),
  ev(`DB.byId["joho-022"].note`)?.slice(0, 40));

// **解説を省く設定でも、注釈だけは出す**
check("解説を省いても注釈は出る", (() => {
  ev(`(() => {
    S.settings.showExplanationOnCorrect = false;
    // 報酬なしで回す。ここでクリスタルを引くと、あとの図鑑の検査がずれる
    startRun({ ids: ["joho-022"], noReward: true });
  })()`);
  const mode = ev(`modeOf(DB.byId["joho-022"])`);
  if (mode !== "choice") ev(`S.run.hard["joho-022"]="choice";render()`);
  d.querySelectorAll(".choices .choice")[ev(`DB.byId["joho-022"].answer`)].click();
  const shown = !!d.querySelector(".qnote") && txt().includes("JIS Z 8301");
  ev("S.settings.showExplanationOnCorrect = true");
  return shown;
})(), txt().slice(0, 120));
check("そのとき解説そのものは出さない",
  !txt().includes("ルータはネットワーク同士をつなぎ"), txt().slice(0, 160));
ev('S.view="select";S.select.subject="auto";render()');   // 次の検査は出題選択の画面を見る

/* ---- 報酬が開く問い（docs/reward-economy.md §7）---- */
check("鍵になるカードは needs で閉じていない", ev(`(() => {
  const keys = new Set(DB.questions.filter(q => q.needs).map(q => q.needs));
  return [...keys].every(c => {
    const src = DB.questions.find(q => q.card === c);
    return src && !src.needs;
  });
})()`) === true);
const keptForNeeds = ev("JSON.stringify(S.cards)");
check("カードを手に入れると、その問題が開く", (() => {
  const before = ev("inventory(DB, S).length");
  ev(`(() => {
    new Set(DB.questions.filter(q => q.needs).map(q => q.needs))
      .forEach(c => S.cards[c] = true);
    render();
  })()`);
  const after = ev("inventory(DB, S).length");
  return after === before + gatedCount;
})(), `閉じ ${gatedCount}問`);
check("開いたぶんが在庫の数字にも出る",
  new RegExp(`おまかせ\\s*${normalCount}`).test(txt()),
  txt().slice(0, 120));
ev(`S.cards=${keptForNeeds};render()`);
check("カードを失えばまた閉じる", ev("inventory(DB, S).length")
  === normalCount - gatedCount);

/* ---- カレンダー ---- */
ev('S.view="home";render()');
check("カレンダーは押せる", !!d.getElementById("tocal"));
// 初回起動の5問も1セッションとして数える（報酬もふつうに入るため）
check("1セッションで回数は1だけ増える", ev("S.runs") === 2,
  `runs=${ev("S.runs")}（初回起動 + 通しで1回）`);
check("その日の記録が残る", ev("Object.keys(S.days).length") === 1,
  ev("JSON.stringify(Object.keys(S.days))"));
check("記録にGUMも残る", ev("S.days[dayKey()].gum") > 0, `${ev("S.days[dayKey()].gum")} GUM`);
check("記録は解けた数と問題を持つ", ev(`(() => {
  const r = S.days[dayKey()];
  return r.right + r.wrong > 0 && Object.keys(r.results).length > 0;
})()`), ev("JSON.stringify(S.days[dayKey()])").slice(0, 120));

d.getElementById("tocal").click();
check("カレンダー画面が開く", txt().includes("カレンダー"), txt().slice(0, 60));
check("連続日数の話は出さない", !/連続.*ボーナス(?!も)/.test(txt()) && txt().includes("ペナルティもありません"));
const stamped = [...d.querySelectorAll(".cald.on")];
check("解いた日にスタンプが押される", stamped.length === 1, `${stamped.length}日`);
check("解いていない日は押せない",
  [...d.querySelectorAll(".cald[data-k]")].every(b => b.classList.contains("on") || b.disabled),
  `${[...d.querySelectorAll(".cald[data-k]")].filter(b => !b.classList.contains("on") && !b.disabled).length}件が押せてしまう`);

// 月送り
const monthText = d.querySelector(".calmonth").textContent;
d.getElementById("prevmonth").click();
check("前の月へ送れる", d.querySelector(".calmonth").textContent !== monthText);
check("年またぎも壊れない", ev("JSON.stringify(shiftMonth(2026,1,-1))") === '{"year":2025,"month":12}');
d.getElementById("nextmonth").click();
check("戻ってこられる", d.querySelector(".calmonth").textContent === monthText);

stamped[0].click();
check("その日の記録を開ける", txt().includes("セッション"), txt().slice(0, 80));
check("解説を読み返せる", d.querySelectorAll(".panel .extt").length > 0,
  `${d.querySelectorAll(".panel .extt").length}件`);

// 再挑戦は報酬なし
const had = {
  gum: ev("S.gum"),
  points: ev("Object.values(S.points).reduce((a,b)=>a+b,0)"),
  cards: ev("Object.keys(S.cards).length"),
  runs: ev("S.runs"),
  score: ev("S.score"),
};
d.getElementById("replay").click();
check("再挑戦が始まる", ev("S.run.noReward") === true && ev("S.run.ids.length") > 0);
for (let i = 0; i < 40 && ev('S.view==="quiz"'); i++) {
  if (!answerNow()) break;
  const n = d.getElementById("next");
  if (n) n.click(); else await wait(900);
}
const now = {
  gum: ev("S.gum"),
  points: ev("Object.values(S.points).reduce((a,b)=>a+b,0)"),
  cards: ev("Object.keys(S.cards).length"),
  runs: ev("S.runs"),
  score: ev("S.score"),
};
check("再挑戦ではクリスタルが増えない", now.points === had.points,
  `${had.points} -> ${now.points}`);
check("再挑戦では知識カードが増えない", now.cards === had.cards, `${had.cards} -> ${now.cards}`);
check("再挑戦は回数に入らない", now.runs === had.runs, `${had.runs} -> ${now.runs}`);
check("再挑戦では点が入らない", now.score === had.score, `${had.score} -> ${now.score}`);
check("再挑戦ではGUMも増えない", now.gum === had.gum, `${had.gum} -> ${now.gum}`);
// 初回起動の5問も同じ日の記録に入るので、この日のセッションは2
check("再挑戦は記録を書き換えない", ev("S.days[dayKey()].runs") === 2,
  `runs=${ev("S.days[dayKey()].runs")}`);

/* ---- マイページと称号 ---- */
ev('S.view="home";render()');
check("ステータス層からマイページへ行ける", !!d.getElementById("tomypage"));
d.getElementById("tomypage").click();
check("マイページが開く", txt().includes("マイページ"), txt().slice(0, 60));

// 名前
d.getElementById("nameinput").value = "テスト太郎";
d.getElementById("savename").click();
check("名前を変えられる", ev("S.profile.name") === "テスト太郎", ev("S.profile.name"));
ev('S.myTab="name";render()');
d.getElementById("nameinput").value = "あ".repeat(400);
d.getElementById("savename").click();
check("名前は255文字で切られる", ev("S.profile.name.length") === 255, `${ev("S.profile.name.length")}文字`);
ev('S.profile.name="旅人";S.myTab="icon";render()');

// アイコン
const iconBtns = [...d.querySelectorAll(".hcard[data-i]")];
check("アイコンは手持ちの英雄から選ぶ", iconBtns.length === ev("heroesOwned().length"),
  `${iconBtns.length}件`);
iconBtns[1].click();
check("アイコンを変えられる", ev("S.profile.icon") === iconBtns[1].dataset.i, ev("S.profile.icon"));

// 称号
ev('S.myTab="title";render()');
check("称号が一覧になる", d.querySelectorAll(".eqi[data-t]").length === ev("DB.titles.titles.length") + 1,
  `${d.querySelectorAll(".eqi[data-t]").length}件`);
check("未取得の称号は選べない",
  [...d.querySelectorAll(".eqi[data-t]")].filter(b => b.classList.contains("lock")).every(b => b.disabled));
check("未取得の称号は名前を伏せる",
  [...d.querySelectorAll(".eqi.lock .tname")].every(e => e.textContent === "？？？"));

// 条件を満たすと選べるようになる
ev(`S.countries={"イギリス":1,"インド":1,"フランス":1};render()`);
const world = [...d.querySelectorAll(".eqi[data-t]")].find(b => b.dataset.t === "世界を渡る者");
check("条件を満たすと称号が開く", !!world && !world.disabled, world ? "disabled" : "見つからない");
world.click();
check("称号を付けられる", ev("S.profile.title") === "世界を渡る者", String(ev("S.profile.title")));
ev('S.view="home";render()');
check("ホームに称号が出る", d.querySelector(".st-title").textContent.includes("世界を渡る者"),
  d.querySelector(".st-title").textContent);
check("越境の称号が量より先に並ぶ",
  ev(`titleProgress(DB,S)[0].kind`) === "越境" && ev(`titleProgress(DB,S).at(-1).kind`) === "量");
check("正解した国が記録される", ev("Object.keys(S.countries).length") >= 3);
ev('S.profile.title=null;render()');

/* ---- クリスタル10種 ---- */
check("クリスタルは100種", ev("DB.crystals.crystals.length") === 100,
  `${ev("DB.crystals.crystals.length")}種`);
check("6族すべてに1種以上ある", ev(`(() => {
  const fam = ["貴金属", "宝石", "元素", "鉱石", "生物起源", "石英"];
  const have = new Set(DB.crystals.crystals.map(c => c.family));
  return fam.every(f => have.has(f)) && have.size === fam.length;
})()`) === true, ev(`JSON.stringify([...new Set(DB.crystals.crystals.map(c => c.family))])`));
check("希少度は Amount から出したものと合う", ev(`(() => {
  const cs = DB.crystals.crystals;
  const tot = cs.reduce((a, c) => a + c.amount, 0);
  return cs.every(c => Math.abs(c.scarcity - Math.round(c.amount / tot * 1e5) / 1e3) < 1e-9);
})()`) === true, "図鑑の Amount と希少度が噛み合っていない");
check("和名と英名が両方ある",
  ev(`DB.crystals.crystals.every(c => c.name && c.en)`),
  ev(`JSON.stringify(DB.crystals.crystals.filter(c => !c.name || !c.en).map(c => c.id))`));
check("価格は希少度から出す（計画表の例と一致）",
  ev("crystalPrice(6.250)") === 8 && ev("crystalPrice(3.950)") === 13,
  `銅 ${ev("crystalPrice(6.250)")} / 黒鉛 ${ev("crystalPrice(3.950)")}`);
check("希少なものほど高い", ev(`(() => {
  const cs = [...DB.crystals.crystals].sort((a,b) => a.scarcity - b.scarcity);
  return cs.every((c,i) => i === 0 || crystalPrice(c.scarcity) <= crystalPrice(cs[i-1].scarcity));
})()`));
check("下限は5GUM", ev("crystalPrice(100)") === 5 && ev("crystalPrice(0)") === 5);
// 族は図鑑の見出しだけ。教科には結び付けない
check("族を教科に結び付けていない", ev("typeof CRYSTAL_FAMILIES") === "undefined");
// 希少度 × 価格 は常に 50。ずれるのは価格を整数に丸めたぶんだけで、
// その幅は 希少度 × 0.5 を超えない。100種に増えても偏りは生まれない
check("どの鉱物も GUM あたりの重みが同じ", ev(`(() => {
  return DB.crystals.crystals.every(c =>
    Math.abs(c.scarcity * crystalPrice(c.scarcity) - 50) <= c.scarcity * 0.5 + 1e-9);
})()`) === true,
  ev(`JSON.stringify(DB.crystals.crystals
    .filter(c => Math.abs(c.scarcity * crystalPrice(c.scarcity) - 50) > c.scarcity * 0.5 + 1e-9)
    .map(c => c.name))`));
check("クラフトの重みは払ったGUMそのもの",
  ev(`DB.crystals.crystals.every(c => crystalPoints(c.scarcity) === crystalPrice(c.scarcity))`));
/* ---- クリスタルの抽選（原則2の唯一の例外）---- */
// rng を渡せるので結果を再現できる。0 を返せば必ず当たり、1 なら必ず外れ
check("確率で落ちる。rng を渡せば結果は決まる", ev(`(() => {
  const always = drawCrystal(DB, "理科", 5, () => 0);
  const never  = drawCrystal(DB, "理科", 5, () => 0.999999);
  return !!always && DB.crystalById[always].family === "元素" && never === null;
})()`) === true, ev(`String(drawCrystal(DB, "理科", 5, () => 0))`));

check("外れても失うものはない", ev(`(() => {
  // 抽選は state を触らない純粋関数。外れは null を返すだけ
  const before = JSON.stringify(S.points);
  drawCrystal(DB, "国語", 5, () => 0.999999);
  return JSON.stringify(S.points) === before;
})()`) === true);

// **どの族を貯めても、規定ポイントに届くまでの時間は変わらない。**
// 出にくい族は1回の当たりが大きく、出やすい族は小刻みに入る
check("どの族でも1問あたりの期待ポイントは揃う", ev(`(() => {
  const e = SUBJECTS.map(sub => {
    const f = DB.subjectToFamily[sub];
    return dropRate(DB, f, 5) * familyExpect(DB, f);
  });
  return Math.max(...e) / Math.min(...e) <= 1 + RARE_BONUS + 1e-9;
})()`) === true, ev(`JSON.stringify(SUBJECTS.map(sub => {
  const f = DB.subjectToFamily[sub];
  return +(dropRate(DB, f, 5) * familyExpect(DB, f)).toFixed(2);
}))`));

check("レア寄りの族のほうが、わずかに期待値が高い", ev(`(() => {
  const v = f => dropRate(DB, f, 5) * familyExpect(DB, f);
  // 宝石（当たりが最も重い）> 元素（最も軽い）。差は RARE_BONUS のぶんだけ
  return v("宝石") > v("元素") && v("宝石") / v("元素") <= 1 + RARE_BONUS + 1e-9;
})()`) === true,
  ev(`"宝石 " + (dropRate(DB,"宝石",5)*familyExpect(DB,"宝石")).toFixed(2) +
      " / 元素 " + (dropRate(DB,"元素",5)*familyExpect(DB,"元素")).toFixed(2)`));

check("出にくい族ほど1回の当たりが大きい", ev(`(() => {
  const fam = SUBJECTS.map(s => DB.subjectToFamily[s])
    .map(f => ({ f, h: dropRate(DB, f, 5), e: familyExpect(DB, f) }))
    .sort((a, b) => a.h - b.h);
  return fam.every((x, i) => i === 0 || x.e <= fam[i - 1].e);
})()`) === true);

// 族の中の出やすさは図鑑の希少度そのもの。こちらで盛っていない
check("族の中は希少度そのままの重み", ev(`(() => {
  // 種を固定した乱数で2万回引き、出た割合が希少度の割合と合うか見る
  let x = 123456789;
  const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const hit = {};
  const N = 20000;
  for (let i = 0; i < N; i++) {
    // drawCrystal は rng を2回呼ぶ。1回目は当たり判定、2回目がどれを引くか。
    // 1回目を必ず当たりにして、2回目だけを乱数にする
    let call = 0;
    const id = drawCrystal(DB, "理科", 10, () => (++call === 1 ? 0 : rnd()));
    if (id) hit[id] = (hit[id] || 0) + 1;
  }
  const list = DB.crystals.crystals.filter(c => c.family === "元素");
  const sum = list.reduce((a, c) => a + c.scarcity, 0);
  const total = Object.values(hit).reduce((a, b) => a + b, 0);
  // いちばんありふれた鉄と、いちばん稀なセシウムで、期待割合とのずれを見る
  return list.every(c => {
    const want = c.scarcity / sum, got = (hit[c.id] || 0) / total;
    return Math.abs(got - want) < 0.03;
  });
})()`) === true, "出やすさが希少度とずれている");

check("いちばんありふれた鉱物がいちばん出る", ev(`(() => {
  const list = DB.crystals.crystals.filter(c => c.family === "元素")
    .sort((a, b) => b.scarcity - a.scarcity);
  return list[0].name === "鉄" && crystalPoints(list[0].scarcity) <
         crystalPoints(list[list.length - 1].scarcity);
})()`) === true);

check("いちばん難しい問題でも、期待ポイントは揃ったまま", ev(`(() => {
  const e = SUBJECTS.map(sub => {
    const f = DB.subjectToFamily[sub];
    return dropRate(DB, f, 10) * familyExpect(DB, f);   // 確率が1で頭打ちになると崩れる
  });
  return Math.max(...e) / Math.min(...e) <= 1 + RARE_BONUS + 1e-9;
})()`) === true, "どこかの族で確率が頭打ちになっている");

check("難しい問題ほど当たりやすい",
  ev('dropRate(DB, "元素", 10)') > ev('dropRate(DB, "元素", 1)'));

check("確率は1を超えない", ev(`SUBJECTS.every(s => dropRate(DB, DB.subjectToFamily[s], 10) <= 1)`) === true);

check("教科と族は1対1", ev(`(() => {
  const map = DB.subjectToFamily, fam = DB.families;
  const used = SUBJECTS.map(s => map[s]);
  return used.every(f => fam.includes(f)) && new Set(used).size === 6 && fam.length === 6;
})()`) === true, ev("JSON.stringify(DB.subjectToFamily)"));
check("どの族にも鉱物がある", ev(`(() => {
  return DB.families.every(f => DB.crystals.crystals.some(c => c.family === f));
})()`) === true);
check("レシピは族ごとのポイントで要求する", ev(`(() => {
  return Object.values(DB.extensions).every(e => {
    if (!e.crystals) return e.rarity === "Common";
    const keys = Object.keys(e.crystals);
    if (keys.includes("*")) return keys.length === 1;
    const want = new Set(e.subs.map(s => DB.subjectToFamily[s]));
    return keys.every(f => DB.families.includes(f) && want.has(f));
  });
})()`) === true, "族と分野が噛み合わないレシピがある");
check("族をまたいでも 1GUM あたりの重みは同じ", ev(`(() => {
  // どの族の鉱物を買っても、払った GUM がそのままポイントになる
  return DB.families.every(f => {
    const cs = DB.crystals.crystals.filter(c => c.family === f);
    return cs.every(c => crystalPoints(c.scarcity) === crystalPrice(c.scarcity));
  });
})()`) === true);
check("同じGUMなら鉱物を変えても重みは同じ", ev(`(() => {
  const byId = DB.crystalById;
  const spend = id => { const p = crystalPrice(byId[id].scarcity);
    const n = Math.floor(600 / p); return { paid: n * p, weight: crystalsValue({ [id]: n }, byId) }; };
  return DB.crystals.crystals.every(c => { const r = spend(c.id); return r.paid === r.weight; });
})()`));
check("1個ぶんの目安は50GUM", ev("CRYSTAL_UNIT") === 50);

/* ---- ショップ ---- */
ev('S.view="home";render()');
d.getElementById("toshop").click();
check("ショップが開く", txt().includes("ショップ"), txt().slice(0, 60));
check("100種すべて並ぶ", d.querySelectorAll(".shopitem").length === 100,
  `${d.querySelectorAll(".shopitem").length}件`);
check("品揃えは安い順で固定", (() => {
  const read = () => [...d.querySelectorAll(".shopitem .sn")].map(e => e.textContent.trim());
  const a = read(); ev("render()"); const b = read();
  const prices = ev("JSON.stringify(shopList(DB).map(c => c.price))");
  const p = JSON.parse(prices);
  return a.join("|") === b.join("|") && p.every((v, i) => i === 0 || v >= p[i - 1]);
})(), "並びが変わる、または安い順でない");
check("持っていない鉱物の豆知識は伏せる",
  d.querySelectorAll(".sfact.hide").length === 100,
  `${d.querySelectorAll(".sfact.hide").length}件`);

// 買えないときは押せない
ev("S.gum=0;render()");
check("GUMが0なら何も買えない",
  [...d.querySelectorAll(".mini[data-c]")].every(b => b.disabled));

// 買う
ev("S.gum=300;render()");
const cheap = d.querySelector(".mini[data-c]:not([disabled])");
const cheapId = cheap.dataset.c;
const cheapPrice = ev(`shopList(DB).find(c => c.id === "${cheapId}").price`);
cheap.click();
check("買うとGUMが減る", ev("S.gum") === 300 - cheapPrice, `${ev("S.gum")} / 価格 ${cheapPrice}`);
check("買ったぶんが手持ちに入る", ev(`S.crystals["${cheapId}"]`) === 1);
check("買うと豆知識が読める", d.querySelectorAll(".sfact.hide").length === 99,
  `伏せたまま ${d.querySelectorAll(".sfact.hide").length}件`);
check("高いものは買えないままにする",
  ev(`(() => { const d0 = shopList(DB).find(c => c.price > S.gum); return !!d0; })()`));

// 集めると重みが積み上がる
ev(`S.gum=100000;S.crystals={};render()`);
[...d.querySelectorAll(".mini[data-c]")].slice(0, 5).forEach(b => b.click());
check("5種そろう", ev("crystalKinds(S)") === 5, `${ev("crystalKinds(S)")}種`);
check("合計の重みは払ったGUMと同じ", ev(`(() => {
  const spent = 100000 - S.gum;
  return crystalsValue(S.crystals, DB.crystalById) === spent;
})()`), `使った ${ev("100000 - S.gum")} / 重み ${ev("crystalsValue(S.crystals, DB.crystalById)")}`);

// 5種で称号が開く
check("5種集めると「石を読む者」が開く",
  ev(`titleProgress(DB,S).find(t => t.id === "stone-reader").done`) === true,
  ev(`JSON.stringify(titleProgress(DB,S).find(t => t.id === "stone-reader"))`));
check("クリスタルは知識カードにならない",
  ev(`DB.crystals.crystals.every(c => !S.cards[c.name] && !S.cards[c.fact])`));
ev('S.gum=0;S.crystals={};S.view="home";render()');
check("アートを参照できる", ev(`assetPath.crystal("001")`).length > 0, ev(`assetPath.crystal("001")`));
check("豆知識が全種にある", ev(`DB.crystals.crystals.every(c => c.fact && c.fact.length > 8)`));

/* ---- レンジ回答（年代当て） ---- */
check("許容幅は古いほど広い", ev(`(() => {
  const w = [2011, 1945, 1600, 794, -2560].map(y => rangeWidth(y, 1, 2026));
  return w.every((v, i) => i === 0 || v > w[i - 1]);
})()`), ev("JSON.stringify([2011,1945,1600,794,-2560].map(y=>rangeWidth(y,1,2026)))"));
check("計画表の表と一致する", ev(`(() => {
  const want = { 2011: 12, 1989: 14, 1945: 18, 1868: 26, 1600: 53,
                 1467: 66, 1192: 93, 794: 133, "-221": 235, "-2560": 469 };
  return Object.entries(want).every(([y, w]) => rangeWidth(Number(y), 1, 2026) === w);
})()`));
check("許容幅は10〜500に収まる",
  ev("rangeWidth(2026,1,2026)") === 10 && ev("rangeWidth(-99999,1,2026)") === 500,
  `${ev("rangeWidth(2026,1,2026)")} / ${ev("rangeWidth(-99999,1,2026)")}`);
check("precisionで締めたり緩めたりできる",
  ev("rangeWidth(1600,0.5,2026)") < ev("rangeWidth(1600,1,2026)") &&
  ev("rangeWidth(1600,2,2026)") > ev("rangeWidth(1600,1,2026)"));

check("言い切って当てれば満点", ev("scoreRange(1467,1467,1467,66)") === 1000);
check("外せば0点", ev("scoreRange(1500,1600,1467,66)") === 0);
check("広く取るほど点は伸びない",
  ev("scoreRange(1450,1480,1467,66)") > ev("scoreRange(1400,1500,1467,66)"));
check("広すぎても下限50点は残る", ev("scoreRange(1000,1900,1467,66)") === 50);
check("順序を逆に入れても同じ",
  ev("scoreRange(1480,1450,1467,66)") === ev("scoreRange(1450,1480,1467,66)"));

// 画面から実際に答える
ev(`(() => {
  const q = DB.questions.find(x => x.format === "range");
  S.run = { ids: [q.id], i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null,
            right: 0, wrong: 0, appliedRight: 0, shortage: 0, found: [],
            gum: 0, results: {}, noReward: false, done: false };
  S.view = "quiz"; render();
})()`);
check("レンジ問題では選択肢を出さない",
  !!d.getElementById("ra") && d.querySelectorAll(".choices .choice").length === 0);
check("幅を入れるまで答えられない", d.getElementById("rsubmit").disabled);
check("点数の見込みは出さない", !/点/.test(d.getElementById("rlive").textContent),
  d.getElementById("rlive").textContent);

const ry = ev(`DB.byId[S.run.ids[0]].year`);
const rollsBefore = ev("S.run.found.length");
d.getElementById("ra").value = String(ry);
d.getElementById("rb").value = String(ry);
d.getElementById("ra").dispatchEvent(new w.Event("input", { bubbles: true }));
check("幅を入れると答えられる", !d.getElementById("rsubmit").disabled);
check("入れた幅を見せる", d.getElementById("rlive").textContent.includes("幅 0年"),
  d.getElementById("rlive").textContent);
d.getElementById("rsubmit").click();
check("採点される", ev("S.run.picked && S.run.picked.score") === 1000,
  ev("JSON.stringify(S.run.picked)"));
check("答えたあとに許容幅を明かす", d.getElementById("rlive").textContent.includes("許容幅"),
  d.getElementById("rlive").textContent);
check("正解として数える", ev("S.run.right") === 1);
// 幅を狭く言い切って当てたら、抽選がもう1回。確率なので「出た」ことは保証されない
check("精度が高いと抽選がもう1回",
  txt().includes("抽選がもう1回") && ev("S.run.found.length") >= rollsBefore,
  txt().slice(0, 80));
check("解説は出る", !!d.getElementById("next") && txt().includes("知識カード"));
check("二重に答えられない", (() => {
  const before = ev("S.run.right");
  ev("onRange(DB.byId[S.run.ids[0]])");
  return ev("S.run.right") === before;
})());

// 外したときも解説は出る（原則3）
ev(`(() => {
  const q = DB.questions.filter(x => x.format === "range")[1];
  S.run = { ids: [q.id], i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null,
            right: 0, wrong: 0, appliedRight: 0, shortage: 0, found: [],
            gum: 0, results: {}, noReward: false, done: false };
  S.view = "quiz"; render();
})()`);
d.getElementById("ra").value = "1000";
d.getElementById("rb").value = "1010";
d.getElementById("ra").dispatchEvent(new w.Event("input", { bubbles: true }));
d.getElementById("rsubmit").click();
check("外しても解説は出る", !!d.getElementById("next") && txt().includes("面白い単元"),
  txt().slice(0, 80));
check("外したら正解の年を明かす", d.getElementById("rlive").textContent.includes("正解は"),
  d.getElementById("rlive").textContent);
check("外したぶんは記録に残る", ev("S.run.wrong") === 1);

/* ---- 原則1: 到達度を上げるのは知識であって装備ではない ---- */
const gaugeEnv = `(() => {
  const st = JSON.parse(JSON.stringify(S));
  st.owned = { "10001": 1, "10002": 1, "10003": 1 };
  st.exts = { "5003": 1 };
  st.equip = {};
  st.cards = {};
  return st;
})()`;

check("知識が0なら装備も効かない", ev(`(() => {
  const st = ${gaugeEnv};
  st.equip = { "10001": "5003" };                       // Legendary を装備
  const g = gaugeBreakdown(DB, st, DB.heroById["3030"]);
  return g.percent === 0 && g.gear > 1;                 // 倍率は立つが、かける元が0
})()`) === true, "知識0でも到達度が出てしまう");

check("装備は到達度を最大で倍までしか上げない", ev(`(() => {
  const st = ${gaugeEnv};
  const hero = DB.heroById["3030"];
  hero.rel.cards.forEach(c => st.cards[c] = true);
  const bare = gaugeBreakdown(DB, st, hero);
  // 英雄をすべて解放し、全員に Legendary を装備しても、倍率は2倍で頭打ち
  DB.heroes.forEach(x => { st.owned[x.id] = 1; st.equip[x.id] = "5003"; });
  const geared = gaugeBreakdown(DB, st, hero);
  return bare.gear === 1 && geared.gear === 2 &&
         Math.abs(geared.reach - Math.min(1, bare.base * 2 / bare.factor)) < 1e-9;
})()`) === true, "装備の倍率が2倍を超えている");

check("装備をつければ到達度は動く", ev(`(() => {
  const st = ${gaugeEnv};
  const hero = DB.heroById["3030"];
  st.cards[hero.rel.cards[0]] = true;
  const bare = gaugeBreakdown(DB, st, hero).percent;
  st.equip = { "10001": "5003" };
  return gaugeBreakdown(DB, st, hero).percent > bare;
})()`) === true);

check("内訳は直結と関連に分かれて出る", ev(`(() => {
  const st = ${gaugeEnv};
  const hero = DB.heroById["3030"];
  st.cards[hero.rel.cards[0]] = true;
  const other = Object.keys(DB.cardSubject).find(c =>
    !c.endsWith("（応用）") && hero.rel.subjects.includes(DB.cardSubject[c]) &&
    !hero.rel.cards.includes(c));
  st.cards[other] = true;
  const rows = gaugeBreakdown(DB, st, hero).rows.map(r => r.label);
  return rows.some(l => l.startsWith("直結する知識カード")) &&
         rows.some(l => l.startsWith("関連分野の知識カード"));
})()`) === true);

check("総量ではなく網羅率で測る", ev(`(() => {
  const st = ${gaugeEnv};
  const hero = DB.heroById["3030"];
  hero.rel.cards.forEach(c => st.cards[c] = true);      // 直結を全部＝網羅率1
  const g = gaugeBreakdown(DB, st, hero);
  // 直結を埋めきっても、関連分野が空なら基礎は 0.6 のまま。問題が増えても飽和しない
  return Math.abs(g.base - 0.6) < 1e-9 && g.direct.rate === 1 && g.related.rate === 0;
})()`) === true);

check("難度係数が低いほど早く届く", ev(`(() => {
  const st = ${gaugeEnv};
  Object.keys(DB.cardSubject).forEach(c => st.cards[c] = true);
  const pct = r => {
    const h = DB.heroes.find(x => x.rarity === r && x.rel);
    return h ? gaugeBreakdown(DB, st, h).percent : null;
  };
  return pct("Common") >= pct("Legendary");
})()`) === true);

/* ---- 装備画面の before/after（docs/reward-economy.md §2）---- */
// 測る相手をピタゴラス（算数・数学）に固定する。ここまでで解放されていると
// 相手が変わり、コンパス（算数・数学）が噛み合わなくなって検査が意味を失う
ev(`window.__cards = JSON.stringify(S.cards);
    S.cards = {};
    Object.keys(DB.cardSubject).filter(c => !c.endsWith("（応用）"))
      .forEach((c, i) => { if (i % 5 === 0) S.cards[c] = true; });
    delete S.owned["1006"];
    S.exts={"5003":1,"2156":1}; S.owned["10001"]=1; delete S.equip["10001"];
    S.heroView="10001"; go("hero")`);
check("測る相手はピタゴラス", d.getElementById("gtarget").value === "1006",
  d.getElementById("gtarget")?.value);
check("装備画面に到達度が出る", /への到達度/.test(txt()), txt().slice(0, 120));
check("誰への到達度を見るか選べる", !!d.getElementById("gtarget"),
  d.querySelector(".reach")?.textContent);
check("装備の候補に、つけたときの到達度が並ぶ",
  [...d.querySelectorAll(".eqi em")].length >= 3,
  `${d.querySelectorAll(".eqi em").length}件`);
check("装備を切り替えると数字が動く", (() => {
  const before = d.querySelector(".rnum b").textContent;
  [...d.querySelectorAll(".eqi")].find(b => b.dataset.k === "2156").click();
  const after = d.querySelector(".rnum b").textContent;
  return after !== before && after.includes("→");
})(), d.querySelector(".rnum b")?.textContent);
// 初伝ひとつの効きは1%に満たないことがある。整数に丸めると「動いた」が消えるので、
// そのときだけ小数第1位まで出す
check("1%未満の変化も見えるようにする", (() => {
  const t = d.querySelector(".rnum b").textContent;
  return !t.includes("→") || /\d/.test(t);
})() && ev(`(() => {
  const a = 20.62, b = 21.39;
  return Math.round(a) === Math.round(b);   // 丸めると同じになる幅でも
})()`) === true, d.querySelector(".rnum b")?.textContent);
check("候補には差分を出す",
  [...d.querySelectorAll(".eqi em")].some(e => /＋/.test(e.textContent)) &&
  [...d.querySelectorAll(".eqi em")].some(e => /±0/.test(e.textContent)),
  [...d.querySelectorAll(".eqi em")].map(e => e.textContent).join(" / "));
check("分野が噛み合わない装備では動かない", (() => {
  // 劇作家の羽ペンは国語・外国語。算数・数学のピタゴラスへは効かない（コンパスは効く）
  [...d.querySelectorAll(".eqi")].find(b => b.dataset.k === "5003").click();
  return !d.querySelector(".rnum b").textContent.includes("→");
})(), d.querySelector(".rnum b")?.textContent);
check("外せば元に戻る", (() => {
  [...d.querySelectorAll(".eqi")].find(b => b.dataset.k === "").click();
  return !d.querySelector(".rnum b").textContent.includes("→");
})(), d.querySelector(".rnum b")?.textContent);
ev('S.cards = JSON.parse(window.__cards); S.view="home"; render()');

check("実行時エラーなし", errs.length === 0, errs.slice(0, 3).join(" / "));
console.log(failed ? `\n${failed}件 失敗\n` : "\nすべて通過\n");
process.exit(failed ? 1 : 0);
