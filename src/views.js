/* 画面描画。db と state を受け取り、#app に流し込む */

import { SUBJECTS, GRADES, RUN_LENGTH, inventory, inventoryBySubject,
         unlockedChapters, buildRun, planRun, BLOCKS, gaugeBreakdown, challengeStage,
         levelUps, modeLevel, MAX_LEVEL,
         cellKey, craftableKeys, nextHero, lockedHeroes, nextIndex,
         adviceFor, gumFor, dayKey, monthGrid, mergeDay, shiftMonth,
         titleProgress, earnedTitles, countryOf,
         shopList, canBuy, crystalPrice, crystalKinds,
         familyPoints, ANY_FAMILY, drawCrystal, crystalPoints, dropRate, familyExpect,
         unlockedBy, questionOpen,
         CRYSTAL_UNIT, craftCheck,
         rangeWidth, scoreRange, RANGE_BONUS_SCORE,
         challengeNeed, challengePrompt, challengeCard,
         CHALLENGE_QUESTIONS } from "./engine.js";
import { matches } from "./normalize.js";
import { assetPath, RANK_ORDER } from "./data.js";
import { answerText, hintGroup, hintsFor, numericParts, sameNumber,
         CUT_SCORE, cutScore } from "./answer-mode.js";
import { saveState, capName, NAME_MAX } from "./state.js";

const esc = s => String(s).replace(/[&<>"]/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* 到達度の内訳は「何ポイント押し上げたか」で出す。頭打ちのぶんだけ負になる */
const signed = v => (v < 0 ? `−${-v}%` : `＋${v}%`);

/* ランクの意味を、タブを切り替えた人がその場で読めるように */
const RANK_NOTE = {
  初伝: "由来が1つの教科に収まる品。その教科の知識カードが要ります。",
  中伝: "由来が2つの教科にまたがる品。どちらの教科の知識カードも要ります。",
  奥伝: "由来が3つ以上の教科にまたがる品。教科の壁を越えているものだけが、ここに来ます。",
};

const STAGE_LABELS = [
  "この英雄の、最も深いところ", "少し輪郭が見えてきた",
  "かなり近づいた", "義務教育で答えられる",
];

let DB, S, app;

export function mount(db, state, root) {
  DB = db; S = state; app = root;

  // エクステンションのキーを MCH の画像IDに変えたので、
  // 古い保存データに残っている名前は捨てる（残すと参照先が無くて落ちる）
  Object.keys(S.exts).forEach(k => { if (!db.extensions[k]) delete S.exts[k]; });
  Object.entries(S.equip).forEach(([id, k]) => { if (k && !db.extensions[k]) delete S.equip[id]; });

  // **初回はホームを出さず、いきなり小学1年の問題から始める**（決定1）
  if (!S.introDone && !S.runs) return startIntro();
  render();
}

/* 初回起動で出す問題数。1セッション丸ごとは長いので、数問で切り上げる */
const INTRO_LENGTH = 5;
/* 何問目から難モードを出すか。**説明はしない。**「こっちでもいいのか」と気づかせる */
const INTRO_PLAIN = 2;

/**
 * **無説明の初回起動**（`docs/experience-design-framework.md` 決定1）。
 *
 * ホームもチュートリアルも出さず、小学1年の問題をいきなり出します。
 * 1〜2問目は4択だけ。3問目から難モードがすっと現れますが、**説明はしません。**
 * マリオ1-1がまず「右に進める」を教えるのと同じで、基本形を先に見せてから増やします。
 *
 * **「教わらずにできた」という体験から始まることが、教育を題材にしたこのゲームの
 * テーマそのものです。** ここに説明を足さないでください。
 */
function startIntro() {
  const first = DB.questions.filter(q => q.grade === "e1" && questionOpen(S, q));
  // **教科を順ぐりに取る。** 小1にあるのは国語と算数だけなので、
  // 先頭から詰めると片方に寄る
  const pools = SUBJECTS.map(sub => first.filter(q => q.subject === sub)).filter(a => a.length);
  const ids = [];
  for (let k = 0; ids.length < INTRO_LENGTH && pools.some(p => p.length > k); k++) {
    for (const p of pools) { if (p[k] && ids.length < INTRO_LENGTH) ids.push(p[k].id); }
  }
  if (!ids.length) { S.introDone = true; return render(); }
  startRun({ ids, intro: true });
}

function go(view) { S.view = view; render(); window.scrollTo(0, 0); }

/**
 * **画面ごとのID。** レビューで「どの画面の話か」を指すための番号です。
 *
 * レビューの単位は**ビューではなく状態**にしてあります。クイズは1つのビューですが、
 * 4択・消去法・文字パネル・数値入力・レンジ・スワイプで見た目が別物なので、
 * 「クイズ画面が変」と言われても直す先が決まりません。
 *
 * **番号は使い回しません。** 画面を足すときは末尾に足してください。途中に
 * 差しこむと、過去のレビューの番号が別の画面を指すようになります。
 *
 * 一覧と、その画面の出し方は `scripts/screens.mjs` にあります。
 * `npm run shots` が全画面を実際に開いて撮り、`docs/screens/` に並べます。
 * **撮る側はここを呼んで照合するので、2つがズレたら撮影が落ちます。**
 */
function screenId() {
  const v = S.view;
  if (v === "quiz") {
    const q = currentQ();
    if (S.run.applied) return "S-12";
    if (q && S.run.results[q.id] !== undefined) return "S-11";
    if (S.run.intro) return "S-01";
    return { choice: "S-05", elimination: "S-06", panel: "S-07",
             numeric: "S-08", range: "S-09", swipe: "S-10" }[q ? modeOf(q) : "choice"] || "S-05";
  }
  if (v === "result") return S.run.swipe ? "S-13" : "S-14";
  if (v === "heroes") return S.heroesTab === "codex" ? "S-16" : "S-15";
  return { home: "S-02", map: "S-03", select: "S-04", hero: "S-17", target: "S-18",
           challenge: "S-19", craft: "S-20", shop: "S-21", calendar: "S-22",
           day: "S-23", mypage: "S-24" }[v] || "S-??";
}

/**
 * **`#review` を付けて開くと、画面IDと設問IDが隅に出ます。**
 * ふだんの画面には出しません——遊ぶ人に要らないものだからです。
 * 実機で見ていて「ここが変」と思ったとき、その場で番号が読めます。
 */
function drawReviewTag() {
  const on = location.hash.includes("review");
  let el = document.getElementById("revtag");
  if (!on) { el?.remove(); return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "revtag";
    document.body.appendChild(el);
  }
  const q = S.view === "quiz" ? currentQ() : null;
  el.textContent = [screenId(), q?.id].filter(Boolean).join(" ・ ");
}

function render() {
  // ホームだけ 100dvh の3層固定。それ以外は方眼紙のまま縦に流す
  const home = S.view === "home";
  app.classList.toggle("home", home);
  document.body.classList.toggle("home", home);

  ({ home: vHome, select: vSelect, quiz: vQuiz, result: vResult, craft: vCraft,
     heroes: vHeroes, hero: vHero, target: vTarget, challenge: vChallenge,
     calendar: vCalendar, day: vDay, mypage: vMypage, shop: vShop, map: vMap }[S.view])();
  drawToast();
  drawReviewTag();
  if (!(S.view === "quiz" && currentQ() && modeOf(currentQ()) === "swipe")) unbindSwipe();
  if (home) { startClock(); drawBattery(); fitAdvice(); } else stopCarousel();
  saveState(S);
}

/* ステータス層の時刻。1画面に留まったままでも進むように、20秒ごとに差し替える */
const clockText = () =>
  new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
const dateText = () => {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

/* 残バッテリー。Battery Status API は iOS Safari が未対応なので、
   取れたときだけ出す（取れなければ枠ごと隠したまま） */
function batteryIcon() {
  return `<svg viewBox="0 0 24 12" aria-hidden="true">
    <rect class="cell" x="0.6" y="0.6" width="19" height="10.8" rx="2"></rect>
    <rect class="fill" x="2" y="2" width="0" height="8" rx="1"></rect>
    <rect class="cell" x="21" y="3.6" width="2.4" height="4.8" rx="1"></rect></svg>`;
}

function drawBattery() {
  const el = document.getElementById("batt");
  if (!el || typeof navigator === "undefined" || !navigator.getBattery) return;
  navigator.getBattery().then(b => {
    const pct = Math.max(0, Math.min(100, Math.round(b.level * 100)));
    const bar = el.querySelector(".fill");
    if (bar) {
      bar.setAttribute("width", String(16.4 * pct / 100));
      bar.classList.toggle("low", pct <= 20);
    }
    const label = el.querySelector("b");
    if (label) label.textContent = `${pct}%`;
    el.hidden = false;
  }).catch(() => {});
}

const MIN_ADVICE_PX = 9;

/**
 * マイちゃんの吹き出しは文字数ぶん伸びる。ただし3行が上限で、
 * それを超えたら枠に収まるまで字を縮める（切り詰めると助言が読めなくなる）。
 * jsdom では寸法が取れないので、その場合は何もしない。
 */
function fitAdvice() {
  const p = document.getElementById("advice");
  if (!p) return;
  p.style.fontSize = "";
  p.style.maxHeight = "";
  const cs = getComputedStyle(p);
  const line = parseFloat(cs.lineHeight);
  if (!line || !Number.isFinite(line)) return;
  const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
            + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  p.style.maxHeight = `${line * 3 + pad}px`;
  // これ以上小さくしても読めないので下限で止め、残りは line-clamp が畳む
  let size = parseFloat(cs.fontSize);
  for (let i = 0; i < 24 && p.scrollHeight > p.clientHeight && size > MIN_ADVICE_PX; i++) {
    size = Math.max(MIN_ADVICE_PX, size - 0.5);
    p.style.fontSize = `${size}px`;
  }
}

const nameplate = h =>
  `<span class="hr r${h.rarity}">${esc(h.rarity)}</span><b>${esc(h.name)}</b>`;

/* 挑む相手のカルーセル。4秒静止 → 左へ素早く流す → 切り替え、の繰り返し。
   矢印は置かない（動いていること自体が操作できる合図になる）。指で払う操作も受ける。 */
const CAROUSEL_HOLD = 4000;
const CAROUSEL_SLIDE = 420;
let carouselTimer = null;

function stopCarousel() {
  if (carouselTimer) { clearInterval(carouselTimer); carouselTimer = null; }
}

function startCarousel(locked) {
  stopCarousel();
  const track = document.getElementById("tvtrack");
  if (!track || locked.length < 2) return;

  const n = locked.length;
  let pos = S.stage.i;    // トラック上の位置。n は末尾のクローン（＝先頭と同じ絵）
  let busy = false;

  const place = animate => {
    track.classList.toggle("move", animate);
    track.style.transform = `translateX(${-pos * 100}%)`;
  };

  const paint = () => {
    const h = locked[S.stage.i];
    const name = document.getElementById("tvname");
    if (name) name.innerHTML = nameplate(h);
    app.querySelectorAll("#tvdots i").forEach((d, k) => d.classList.toggle("on", k === S.stage.i));
  };

  const step = dir => {
    if (busy) return;
    busy = true;

    // 先頭から右へ戻すときは、いったん末尾のクローンへ飛んでから動かす
    if (dir < 0 && pos === 0) { pos = n; place(false); void track.offsetWidth; }

    pos += dir;
    S.stage.i = nextIndex(S.stage.i, n, dir);
    paint();
    place(true);

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      track.removeEventListener("transitionend", settle);
      if (pos === n) { pos = 0; place(false); }   // クローンから先頭へ、音もなく戻す
      busy = false;
    };
    track.addEventListener("transitionend", settle);
    setTimeout(settle, CAROUSEL_SLIDE + 260);     // transitionend が来ないときの保険
  };

  const rearm = () => {
    stopCarousel();
    carouselTimer = setInterval(() => step(1), CAROUSEL_HOLD);
  };

  // 指で払う操作。動かしたら、そこから4秒数え直す
  const art = track.parentElement;
  let x0 = null;
  art.addEventListener("touchstart", ev => { x0 = ev.changedTouches[0].clientX; }, { passive: true });
  art.addEventListener("touchend", ev => {
    if (x0 === null) return;
    const dx = ev.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) <= 40) return;
    step(dx < 0 ? 1 : -1);
    rearm();
  }, { passive: true });

  // 動きを減らす設定のときは、自動では送らない（払えば動く）
  if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
  rearm();
}

let clockTimer = null;
function startClock() {
  if (clockTimer) return;
  clockTimer = setInterval(() => {
    const el = document.getElementById("clock");
    if (!el) { clearInterval(clockTimer); clockTimer = null; return; }
    el.textContent = clockText();
  }, 20000);
}

/* ---------- 共通パーツ ---------- */

const heroesOwned = () => DB.heroes.filter(h => S.owned[h.id]);
const cardCount = () => Object.keys(S.cards).length;

/**
 * 知識マップの埋まり具合。**カードの枚数ではなくマスで数えます。**
 * 査読研究では、学習者が動機づけられると答えたゲーム要素の1位がプログレスバー、
 * 次いでコンセプトマップで、仮想通貨は下位でした（docs/research-edtech.md）。
 * 知識マップはコンセプトマップそのものなので、ここをホームの一等地に出します。
 */
function mapProgress() {
  let done = 0, total = 0;
  SUBJECTS.forEach(sub => GRADES.forEach(g => {
    if (!DB.questions.some(q => q.subject === sub && q.grade === g.k)) return;
    total++;
    const st = S.cells[sub + "|" + g.k];
    if (st === "ok" || st === "st") done++;
  }));
  return { done, total, rate: total ? done / total : 0 };
}
const currentQ = () => DB.byId[S.run.ids[S.run.i]];

function heroFor(q) {
  const pool = heroesOwned().filter(h => h.fit.includes(q.subject));
  return pool.length ? pool[q.prompt.length % pool.length] : heroesOwned()[0];
}
const fitOf = (q, h) => h.fit.includes(q.subject);

function famStrip(cls = "") {
  return `<div class="fams ${cls}">` + DB.families.map(f =>
    `<span class="fam ${familyPoints(S, f) ? "" : "zero"}" title="${esc(DB.familyToSubject[f] || "")}"
      ><b>${esc(f)}</b>${familyPoints(S, f)}pt</span>`
  ).join("") + `</div>`;
}

function drawToast() {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  if (!S.toast) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = S.toast;
  document.body.appendChild(el);
}

/* ---------- ホーム ---------- */

function vHome() {
  // どれだけ削れるかはホームには出さない。挑戦先を選ぶ画面で見せる
  const locked = lockedHeroes(DB, S);
  const i = locked.length ? Math.min(S.stage.i, locked.length - 1) : 0;
  S.stage.i = i;
  const target = locked[i] || null;
  // 末尾に先頭のクローンを1枚足しておく。最後から先頭へ回るときも
  // 左方向に流したまま繋げられる（クローンは見た目が同じなので継ぎ目が出ない）
  const slides = locked.length > 1 ? [...locked, locked[0]] : locked;
  const craftable = craftableKeys(DB, S);
  const p = S.profile || {};
  const mp = mapProgress();

  app.innerHTML = `
  <div class="home-bg" style="background-image:url('${assetPath.bg("1006")}')"></div>

  <div class="layer layer-status">
    <div class="st-top">
      <button class="st-map" id="tomap" title="知識マップ">
        <span class="mp-bar"><i style="width:${Math.round(mp.rate * 100)}%"></i></span>
        <b>知識 ${mp.done}/${mp.total}</b></button>
      <span class="st-batt" id="batt" hidden>${batteryIcon()}<b></b></span>
      <span class="st-clock" id="clock">${clockText()}</span>
    </div>
    <button class="st-main" id="tomypage">
      <img class="st-ava" src="${assetPath.hero(p.icon || "10001")}" alt="ユーザーアイコン">
      <span class="st-fields">
        <span class="st-line">
          <span class="st-title ${p.title ? "" : "none"}">${p.title ? esc(p.title) : "称号なし"}</span>
          </span>
        <span class="st-name">${esc(p.name || "旅人")}</span>
      </span>
    </button>
    <div class="st-advice">
      <img src="${assetPath.icon("mai_sd")}" alt="">
      <p class="bubble" id="advice">${esc(adviceFor(DB, S))}</p>
    </div>
  </div>

  <div class="layer layer-stage">
    <button class="cal" id="tocal"><img src="${assetPath.icon("mch_icon")}" alt="">${dateText()}</button>
    ${target ? `
    <div class="tv">
      <div class="tv-art">
        <div class="tv-track" id="tvtrack" style="transform:translateX(${-i * 100}%)">
          ${slides.map(h => `<div class="tv-figure">
            <img src="${assetPath.rep(h.id)}" alt="${esc(h.name)}"></div>`).join("")}
        </div>
      </div>
      <div class="tv-name" id="tvname">${nameplate(target)}</div>
      ${locked.length > 1 ? `<div class="tv-dots" id="tvdots">${locked.map((h, n) =>
        `<i class="${n === i ? "on" : ""}"></i>`).join("")}</div>` : ""}
    </div>
    <button class="chal" id="tochal"
      style="background-image:var(--g-chal),url('${assetPath.bg("1038")}')">挑戦</button>`
    : `
    <div class="tv">
      <div class="tv-name"><b>英雄はすべて解放しました</b></div>
      <p class="fine" style="text-align:center">問題を増やすと、また新しい教室が開きます</p>
    </div>`}
  </div>

  <div class="layer layer-nav">
    <div class="nav3">
      <button class="tile" id="toheroes"
        style="background-image:var(--g-hero),url('${assetPath.bg("1038")}')">
        <img src="${assetPath.hero("10001")}" alt="">
        <span class="lab"><b>ヒーロー</b></span></button>
      <button class="tile" id="toshop"
        style="background-image:var(--g-shop),url('${assetPath.bg("1004")}')">
        <img src="${assetPath.hero("3037")}" alt="">
        <span class="lab"><b>ショップ</b></span></button>
      <button class="tile" id="tocraft"
        style="background-image:var(--g-craft),url('${assetPath.bg("1046")}')">
        <img src="${assetPath.hero("2023")}" alt="">
        <span class="lab"><b>クラフト</b></span>
        ${craftable.length ? `<i class="dot" title="クラフトできます"></i>` : ""}</button>
    </div>
    <button class="tile quiz" id="toquiz"
      style="background-image:var(--g-quiz),url('${assetPath.bg("1030")}')">
      <img src="${assetPath.ext("5003")}" alt=""><b>クイズを解く</b></button>
  </div>`;

  document.getElementById("toquiz").onclick = () => go("select");
  document.getElementById("tocraft").onclick = () => go("craft");
  document.getElementById("toheroes").onclick = () => go("heroes");
  document.getElementById("tocal").onclick = openCalendar;
  document.getElementById("tomypage").onclick = () => go("mypage");
  document.getElementById("toshop").onclick = () => go("shop");
  document.getElementById("tomap").onclick = () => go("map");
  const c = document.getElementById("tochal");
  if (c) c.onclick = () => go("target");

  startCarousel(locked);
}

/* ---------- 出題選択（在庫表示つき） ---------- */

/* 形式ごとの在庫。3問そろわない形式は束にできない（engine.planRun）*/
function modeStock(db, state, band, subject) {
  const out = {};
  inventory(db, state, band, subject).forEach(q => {
    out[q.mode] = (out[q.mode] || 0) + 1;
  });
  return out;
}

function vSelect() {
  const bands = [["auto", "おまかせ"], ["e", "小学校"], ["j", "中学校"], ["w", "世界"]];
  const counts = inventoryBySubject(DB, S, S.select.band);
  const total = inventory(DB, S, S.select.band, "auto").length;
  const n = inventory(DB, S, S.select.band, S.select.subject).length;
  const worldLocked = !unlockedChapters(DB, S).has(3);
  const short = n > 0 && n < RUN_LENGTH;
  // スワイプは在庫が別。混ぜるとテンポの設計が成り立たないので、入口も分ける
  const sw = inventory(DB, S, S.select.band, S.select.subject, "swipe").length;

  app.innerHTML = `
  <header><div class="hbar"><div class="place">出題を選ぶ</div>
    <button class="mapbtn" id="back">もどる</button></div></header>
  <div class="pad">
    <h2 style="margin-top:20px">どこを解きますか</h2>
    <p class="fine">おまかせは知識マップの白いマスから優先して出します。最後の1問は必ずいまの範囲の外から出ます。</p>
    <p class="fine"><b>出題形式は毎回3つ、くじで選びます。</b>形式ごとにまとめて出すので、
      操作を覚え直す回数が減ります。束の長さは手数なりで、はらうだけのスワイプは8問、
      なぞる文字パネルは3問。<b>何が来るかは得意不得意で変わりません。</b></p>
    <div class="lvbar">${Object.keys(MODE_LABEL).map(m =>
      `<span class="lvcell"><b>${esc(MODE_LABEL[m])}</b><i>Lv.${modeLevel(S, m)}</i></span>`).join("")}</div>
    <p class="fine">段は形式ごとに別で、<b>その形式の束で4分の3以上とれた回に1つ上がります</b>
      （Lv.3まで）。学年は変わらず、同じ学年の中で踏みこんだ問いに変わります。
      <b>下がることはありません。</b></p>

    <div class="seg" id="band">${bands.map(([k, l]) =>
      `<button data-k="${k}" class="${S.select.band === k ? "on" : ""}" ${
        (k === "w" && worldLocked) ? "disabled" : ""}>${l}</button>`).join("")}</div>

    <div class="seg wrap" id="sub">
      <button data-k="auto" class="${S.select.subject === "auto" ? "on" : ""}">
        おまかせ<i>${total}</i></button>
      ${SUBJECTS.map(s => `<button data-k="${esc(s)}" ${counts[s] ? "" : "disabled"}
        class="${S.select.subject === s ? "on" : ""}">${esc(s)}<i>${counts[s]}</i></button>`).join("")}
    </div>

    ${worldLocked ? `<p class="fine lock">「世界」はクレオパトラを解放すると開きます。</p>` : ""}

    <div class="panel">
      <label class="switch">
        <input type="checkbox" id="showexp" ${S.settings.showExplanationOnCorrect ? "checked" : ""}>
        <span class="sw"></span>
        <span class="lbl">正解した問題の解説を見る</span>
      </label>
      <p class="fine">${S.settings.showExplanationOnCorrect
        ? "正解しても英雄の解説と応用編が出ます。"
        : "正解したら演出だけで次へ進みます。応用編は出ません。間違えた問題の解説は必ず出ます。"}</p>
    </div>

    ${n === 0
      ? `<p class="fine lock">この範囲にはまだ問題がありません。</p>`
      : short
        ? `<p class="fine lock">この範囲は在庫が ${n}問なので、束が3つそろわないことがあります。</p>`
        : `<p class="fine">出題できる問題 ${n}問 ・ 出せる形式 ${
            Object.entries(modeStock(DB, S, S.select.band, S.select.subject))
              .filter(([, c]) => c >= 3)
              .map(([m, c]) => `${MODE_LABEL[m] || m}${c}`).join(" / ") || "なし"}</p>`}

    <div class="stack"><button class="btn" id="start" ${n ? "" : "disabled"}>
      ${n ? `${BLOCKS}つの形式で解く` : "問題がありません"}</button></div>

    <div class="panel swp-entry">
      <div class="phead"><h2>スワイプで解く</h2></div>
      <p class="fine">写真を見て、<b>正しいと思うほうへカードをはらう</b>2択です。
        ${Math.min(sw, RUN_LENGTH)}問ぜんぶ同じ形で、<b>途中に解説もヒントも挟みません。</b>
        解説はセッションの終わりにまとめて出ます（外した問題は開いた状態で並びます）。
        もらえる GUM も知識カードもクリスタルも、ふつうに解いたときと同じです。</p>
      ${sw === 0
        ? `<p class="fine lock">この範囲にはスワイプの問題がまだありません。</p>`
        : sw < RUN_LENGTH
          ? `<p class="fine lock">この範囲のスワイプは現在 ${sw}問です。${sw}問だけ出題します。</p>`
          : ""}
      <div class="stack"><button class="btn ghost" id="startswipe" ${sw ? "" : "disabled"}>
        ${sw ? `スワイプで ${Math.min(sw, RUN_LENGTH)}問` : "スワイプの問題がありません"}</button></div>
    </div>
  </div>`;

  document.getElementById("back").onclick = () => go("home");
  app.querySelectorAll("#band button").forEach(b =>
    b.onclick = () => { S.select.band = b.dataset.k; S.select.subject = "auto"; render(); });
  app.querySelectorAll("#sub button").forEach(b =>
    b.onclick = () => { S.select.subject = b.dataset.k; render(); });
  document.getElementById("showexp").onchange = e => {
    S.settings.showExplanationOnCorrect = e.target.checked; render();
  };
  document.getElementById("start").onclick = () => startRun();
  const sws = document.getElementById("startswipe");
  if (sws) sws.onclick = () => startRun({ swipe: true });
}

function startRun(opts = {}) {
  const swipe = !!opts.swipe;
  const built = opts.ids ? { ids: opts.ids, plan: [] }
                         : planRun(DB, S, swipe ? { kind: "swipe" } : {});
  const ids = built.ids;
  S.run = { ids, i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null,
            right: 0, wrong: 0, appliedRight: 0,
            // 束の数ぶんそろわなかったときだけ「在庫が足りない」と言う
            shortage: opts.ids || built.plan.length >= BLOCKS || swipe ? 0 : 1,
            gum: 0, found: [], results: {}, noReward: !!opts.noReward, done: false, hard: {},
            cut: null, intro: !!opts.intro, swipe, plan: built.plan };
  go("quiz");
}

/**
 * 1セッションの終わり。ここでだけ回数を数え、その日の記録を積む。
 * 以前は vResult の中で数えていたので、リザルトを描き直すたびに増えていた。
 * 記録からの再挑戦（noReward）は、回数にも記録にも入れない。
 */
function finishRun() {
  if (S.run.done) return;
  S.run.done = true;
  if (S.run.intro) S.introDone = true;   // ここを過ぎて、初めてホームが出る
  if (S.run.noReward) return;
  /* **形式ごとの段は、その束の出来だけで決まります。**上がるだけで下がりません */
  S.run.levelUps = levelUps(S, S.run);
  S.run.levelUps.forEach(u => { (S.modeLevel ||= {})[u.mode] = u.to; });
  S.runs++;
  const k = dayKey();
  S.days[k] = mergeDay(S.days[k], S.run);
}

/**
 * コモンズの写真を1枚出す。クレジットは必ず添える。
 *
 * CC BY は「作者・ライセンス・出典」の表示が条件なので、画像だけ出して
 * クレジットを省くと条件を満たさない。台帳に欄が欠けていたら何も出さない。
 * どこに出すかは問題データの imageAt（prompt / hint / lesson）で決める。
 */
function creditLine(p, withTitle = true) {
  const by = p.author ? `${esc(p.author)} ・ ` : "";
  const lic = p.licenseUrl
    ? `<a href="${esc(p.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(p.license)}</a>`
    : esc(p.license);
  const src = p.source
    ? `<a href="${esc(p.source)}" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>`
    : "Wikimedia Commons";
  return `${withTitle && p.title ? esc(p.title) + " ・ " : ""}${by}${lic} ・ ${src}`;
}

function photoHTML(key, cls = "", hideTitle = false) {
  const p = DB.photos?.[key];
  if (!p || !p.file || !p.license) return "";
  return `<figure class="photo ${cls}">
    <img src="${assetPath.photo(p.file)}" alt="${esc(p.alt || "")}" loading="lazy"
      ${p.width ? `width="${p.width}" height="${p.height}"` : ""}>
    <figcaption>${creditLine(p, !(hideTitle && titleFree(p)))}</figcaption></figure>`;
}

/**
 * その問題の画像を、置き場所ごとに取り出す。
 *
 * **問題に `hideTitle: true` があると、出題中は題名を伏せます。**
 * 応用編が「この人の名前は?」を問うとき、クレジットの題名
 * （"DBP 1955 204 Carl Friedrich Gauß"）がそのまま答えになるためです。
 * 伏せられるのは PD と CC0 だけ（表示義務が無いもの）で、`npm run validate` が
 * それ以外に `hideTitle` を付けたらエラーにします。
 *
 * **解説の中では伏せません。** そこまで来れば答えは済んでいますし、
 * 題名は写真をたどり直すときの手がかりになります。
 */
const photoAt = (q, where) => (q.image && (q.imageAt || "lesson") === where)
  ? photoHTML(q.image, where, !!q.hideTitle && where !== "lesson") : "";

/* ---------- クイズ ---------- */

const MODE_LABEL = { swipe: "スワイプ", choice: "4択", elimination: "消去法",
                     numeric: "数値入力", range: "レンジ", panel: "文字パネル" };

/**
 * **語のかわりに絵と ◯ を出す選択肢**（`choiceArt`）。
 *
 * 「かたかなで書く言葉はどれ?」を語のまま並べると、**カタカナの語が1つだけ
 * 見た目で浮いてしまい、読まずに当てられます。** 絵にすると、その語が
 * かなで書くものか外来語かは、見ただけでは分かりません。
 *
 * ◯ の数はその語の文字数です（パン＝◯◯、たまご＝◯◯◯）。
 * **どの絵が何のことかを言い当てるための手がかりで、答えの手がかりではありません。**
 * 文字数が答えを教えてしまう問いには使わないでください。
 *
 * 答えたあとは、4つとも語を出します。**何だったのかが分からないまま終わらせない**ためです。
 */
/**
 * **出題中に題名を伏せられる写真か。**
 *
 * コモンズの題名は被写体の名前そのものです（"Dmitri Mendeleev 1890s"）。
 * PD と CC0 は表示義務が無いので伏せられますが、CC BY は題名も表示の条件なので
 * 伏せられません。**被写体を言い当てることが問いの中身になる形式
 * （スワイプ・絵の選択肢）では、この2つしか使えません。**
 */
const titleFree = p => /^(public domain|pdm|cc0)/i.test(p?.license || "");

function choiceArtHTML(q, i) {
  const key = q.choiceArt?.[i];
  if (!key) return null;
  const n = [...String(q.choices[i] ?? "")].length;
  const dots = `<span class="cdots" role="img" aria-label="${n}文字">${"<i></i>".repeat(n)}</span>`;
  /* **イメージは写真、図形は線画。** 台帳（images.json）にあれば写真、
     無ければ図版（figures.json）。alt は空にする——名前を書けばそこが答えになる。
     **題名の要る写真は使いません**（validate がエラーにするので、ここへは来ない）。
     来てしまったときに黙って題名を伏せるとライセンス条件を満たさないので、
     写真そのものを出さず図版へ落とします */
  const photo = DB.photos?.[key];
  if (photo?.file && photo.license && titleFree(photo))
    return `<span class="cart"><img src="${assetPath.photo(photo.file)}" alt="" loading="lazy"></span>${dots}`;
  const svg = DB.figures?.[key];
  return svg ? `<span class="cart">${svg}</span>${dots}` : null;
}

/**
 * 絵の選択肢に写真を使ったときのクレジット。
 * **写真はクレジットとセットでしか出しません**（原則どおり）。
 * 作者の名前が、その写真の出典ページへのリンクになります。
 *
 * **題名は出しません。出さなくてよい写真しか使わないからです。**
 * 題名は被写体の名前そのもの（"No-Knead Bread"）で、どの絵が何のことかを
 * 言い当てるのがこの形式の中身です。題名が出た時点で問いが消えます。
 */
function choiceArtCredit(q) {
  const list = (q.choiceArt || []).map(k => DB.photos?.[k])
    .filter(p => p && p.file && p.license && titleFree(p));
  if (!list.length) return "";
  const who = list.map(p => {
    const name = esc(p.author || "作者不明");
    const link = p.source
      ? `<a href="${esc(p.source)}" target="_blank" rel="noopener noreferrer">${name}</a>`
      : name;
    return link;
  }).join(" ／ ");
  const lic = [...new Set(list.map(p => p.license))].map(esc).join("・");
  return `<p class="cartcred">写真 ${who} ・ ${lic} ・ Wikimedia Commons</p>`;
}

/**
 * その問題の段。**学年の隣に置きます。**
 *
 * 学年は「どの教育課程の問題か」、段は「同じ学年の中でどれだけ踏みこむか」。
 * 隣り合わせに出すと、この2つが別の軸だと目で分かります。
 */
function levelChip(q, mode) {
  const lv = Math.min(MAX_LEVEL, Math.max(1, q.level || 1));
  const now = modeLevel(S, mode);
  return `<span class="lv${lv >= now ? " top" : ""}" title="${
    esc(MODE_LABEL[mode] || mode)}の段">Lv.${lv}</span>`;
}

/**
 * ヘッダの進み具合を、**束の並びごと**見せる。
 *
 * 1セッションは3つの形式の束でできています（`engine.planRun`）。
 * ただの1本の線にすると、「あと何問このやり方が続くのか」が分かりません。
 * 束ごとに区切って名前を出すと、**いま集中すべき形式と、次に来る形式**が見えます。
 * 束の幅は問題数に比例するので、軽い形式の束が長いことも目で分かります。
 */
function planStrip() {
  const plan = (S.run.plan || []).filter(b => b.n > 0);
  const total = S.run.ids.length || 1;
  if (plan.length < 2)
    return `<div class="track"><i style="width:${Math.round(S.run.i / total * 100)}%"></i></div>`;
  let from = 0;
  return `<div class="plan">${plan.map(b => {
    const to = from + b.n, at = from;
    from = to;
    const done = S.run.i >= to, on = !done && S.run.i >= at;
    const fill = done ? 1 : on ? (S.run.i - at) / b.n : 0;
    return `<span class="pseg${done ? " done" : on ? " on" : ""}" style="flex:${b.n}">
      <i style="width:${Math.round(fill * 100)}%"></i>
      <b>${esc(MODE_LABEL[b.mode] || b.mode)}</b></span>`;
  }).join("")}</div>`;
}


function vQuiz() {
  if (S.run.i >= S.run.ids.length) return go("result");
  const q = currentQ(), h = heroFor(q), fit = fitOf(q, h);
  const mode = modeOf(q);
  // スワイプは画面ごと別。束で出るので、ふつうのセッションの途中にも現れる
  if (mode === "swipe") return vSwipe();
  const place = q.country ? `<b>${esc(q.country)}</b>` : `日本 <b>${esc(q.gradeLabel)}</b>`;

  app.innerHTML = `
  <header><div class="hbar">
    <div class="place">${place} ・ ${esc(q.subject)}</div>
    <div class="score">${S.run.i + 1} / ${S.run.ids.length}</div></div>
    ${planStrip()}</header>
  <div class="pad">
    <div class="qmeta"><span class="grade ${q.newCurriculum ? "alt" : ""}">${esc(q.gradeLabel)}</span>
      <span class="unit">${esc(q.unit)}</span>${levelChip(q, mode)}</div>
    <div class="qtext">${esc(q.prompt)}</div>
    ${photoAt(q, "prompt")}
    ${q.figure ? `<div class="figure">${DB.figures[q.figure]}</div>` : ""}
    ${mode === "panel" ? panelHTML(q)
    : mode === "numeric" ? `
      <div class="numbox">
        <div class="numdisp"><span id="numval" class="ph">数を入れる</span>${(() => {
          const u = numericParts(q)?.unit; return u ? `<b>${esc(u)}</b>` : ""; })()}</div>
        <div class="keypad">${
          ["7","8","9","4","5","6","1","2","3",".","0","←"].map(k =>
            `<button class="key" data-k="${k}">${k}</button>`).join("")}</div>
        <button class="btn" id="nsubmit" disabled>この数で答える</button>
        <div class="elimbar"><button class="lnk" id="tochoice">4択に切り替える</button></div>
      </div>`
    : q.format === "range" ? `
      <div class="rangebox">
        <div class="rio">
          <input id="ra" type="number" inputmode="numeric" step="1" placeholder="から" aria-label="範囲の始まりの年">
          <span>〜</span>
          <input id="rb" type="number" inputmode="numeric" step="1" placeholder="まで" aria-label="範囲の終わりの年">
          <span class="ru">年</span>
        </div>
        <div class="rlive" id="rlive">幅を決めてください</div>
        <button class="btn" id="rsubmit" disabled>この幅で答える</button>
        <p class="fine">狭く答えるほど高い点になります。紀元前はマイナスで書いてください（例 −221）。</p>
      </div>`
    : `${modeBand(q, mode)}
      <div class="choices${mode === "elimination" ? " elim" : ""}">${q.choices.map((t, i) => {
      const art = choiceArtHTML(q, i);
      const cls = "choice" + (art ? " art" : "");
      return mode === "elimination"
        ? `<div class="row${(S.run.cut || []).includes(i) ? " gone" : ""}" data-r="${i}">
             <button class="xcut" data-c="${i}" aria-label="これを消す">✕</button>
             <div class="${cls}" data-i="${i}">${art || esc(t)}</div></div>`
        : `<button class="${cls}" data-i="${i}">${art || esc(t)}</button>`;
      }).join("")}</div>
      ${choiceArtCredit(q)}
      ${mode === "elimination" ? `
        <p class="fine"><b>1つ目より2つ目、2つ目より3つ目のほうが点は大きくなります。</b>
          まちがえて消すとそこで終わりますが、消せたぶんの点は残ります。</p>
        <div class="elimbar">
          <button class="lnk" id="tochoice">4択に切り替える</button></div>` : ""}`}
    <div class="hero-row">
      <img class="ava" src="${assetPath.hero(h.id)}" alt="">
      <div><div class="hero-name">${esc(h.name)}</div>
        <div class="hero-fit ${fit ? "good" : ""}">${fit
          ? "この分野が得意 ・ ヒント3段階" : "専門外 ・ ヒントは2段階まで"}</div></div>
      <button class="hintbtn" id="hint">ヒント</button></div>
    <div class="hints" id="hints"></div><div id="verdict"></div>
  </div>`;

  document.getElementById("hint").onclick = () => { S.run.hintsUsed++; drawHints(q, h); };
  if (mode === "elimination") wireElimination(q);
  else if (mode === "panel") wirePanel(q);
  else if (mode === "numeric") wireNumeric(q);
  else app.querySelectorAll(".choices .choice").forEach(b =>
    b.onclick = () => onPick(Number(b.dataset.i)));
  if (mode !== "numeric" && mode !== "panel" && q.format === "range") wireRange(q);
  drawHints(q, h);
}

/**
 * レンジ回答の入力。
 *
 * **途中で点数の見込みを出さない。** 点は 1000×(1 − 幅/許容幅) なので、
 * 幅と点が分かると許容幅が割れる。許容幅は正解年から決まるので、
 * そこから年が逆算できてしまう。出すのは自分で決めた幅だけにする。
 */
function wireRange(q) {
  const a = document.getElementById("ra");
  const b = document.getElementById("rb");
  const live = document.getElementById("rlive");
  const submit = document.getElementById("rsubmit");
  if (!a || !b || !submit) return;

  const read = () => [parseInt(a.value, 10), parseInt(b.value, 10)];
  const update = () => {
    const [x, y] = read();
    const ok = Number.isInteger(x) && Number.isInteger(y);
    submit.disabled = !ok || S.run.picked !== null;
    live.textContent = ok
      ? (x === y ? "幅 0年 ・ 一点で言い切る" : `幅 ${Math.abs(y - x)}年`)
      : "幅を決めてください";
  };
  [a, b].forEach(el => { el.oninput = update; el.onkeydown = e => {
    if (e.key === "Enter" && !submit.disabled) onRange(q);
  }; });
  submit.onclick = () => onRange(q);
  update();
  a.focus();
}

/* レンジ回答の採点と報酬。4択と同じ流れに合流させる */
function onRange(q) {
  if (S.run.picked !== null) return;
  const lo = parseInt(document.getElementById("ra").value, 10);
  const hi = parseInt(document.getElementById("rb").value, 10);
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) return;

  const h = heroFor(q);
  const width = rangeWidth(q.year, q.precision);
  const score = scoreRange(lo, hi, q.year, width);
  const ok = score > 0;

  S.run.picked = { lo: Math.min(lo, hi), hi: Math.max(lo, hi), score, width };
  const { gum, found, opened } = grantAnswer(q, ok, score >= RANGE_BONUS_SCORE ? 1 : 0);

  document.getElementById("ra").disabled = true;
  document.getElementById("rb").disabled = true;
  document.getElementById("rsubmit").disabled = true;
  document.getElementById("rlive").innerHTML = ok
    ? `<b>${score}点</b> ・ 許容幅は ±${Math.floor(width / 2)}年でした`
    : `正解は <b>${q.year < 0 ? `紀元前${-q.year}` : q.year}年</b> ・ 許容幅は ±${Math.floor(width / 2)}年`;

  drawHints(q, h);
  S.run.tipOpen = false; S.run.applied = null;
  drawVerdict(q, h, ok, gum, score, found, opened);
}

/**
 * いまその問題を、どの回答方式で解いているか。
 *
 * 難モードに入るまでは、選択肢が出ない `range` だけが hidden になる。
 * プレイヤーが4択へ降りたら `S.run.hard[id]` に "choice" が入り、
 * その問題のあいだだけ選択肢の側に固定される（決定2・不可逆は1問かぎり）。
 */
const READY_MODES = new Set(["elimination", "numeric", "panel", "range", "choice", "swipe"]);

function modeOf(q) {
  // スワイプは降りる先が同じ2択になるので、難モードの梯子に乗らない
  if (q.mode === "swipe") return "swipe";
  const dropped = S.run.hard?.[q.id];
  if (dropped) return dropped;
  // 初回起動の最初の数問は4択だけ。基本形を先に見せる（決定1）
  if (S.run.intro && S.run.ids.indexOf(q.id) < INTRO_PLAIN) return "choice";
  return READY_MODES.has(q.mode) ? q.mode : "choice";
}

function drawHints(q, h) {
  const max = fitOf(q, h) ? 3 : 2;
  // 選択肢が見えているかでヒントの系統が変わる。選択肢を潰す型のヒントは、
  // 文字パネルや数値入力では意味をなさない（experience-design-framework の決定4）
  const list = hintsFor(q.hints, hintGroup(modeOf(q)));
  // 画像つきのヒントは最後の一段に添える。ヒントは答えの直前で止めるので、
  // ここに置く画像もそれだけで答えが割れないものに限る（原則5・validate が形だけ見る）
  const withPhoto = q.imageAt === "hint" ? Math.min(list.length, max) : -1;
  document.getElementById("hints").innerHTML = list.slice(0, S.run.hintsUsed)
    .map((t, i) => `<div class="hint"><b>ヒント ${i + 1}</b>${esc(t.text)}` +
      (i + 1 === withPhoto ? photoHTML(q.image, "hint") : "") + `</div>`).join("");
  const b = document.getElementById("hint");
  if (!b) return;
  b.disabled = S.run.hintsUsed >= max || S.run.picked !== null;
  b.textContent = S.run.hintsUsed === 0 ? "ヒント"
    : (S.run.hintsUsed >= max ? "ヒントなし" : `もう一段 (${S.run.hintsUsed}/${max})`);
}

function markChoice(btn, ok) {
  const w = btn.offsetWidth + 16, h = btn.offsetHeight + 12;
  if (ok) {
    btn.insertAdjacentHTML("beforeend",
      `<svg class="mark" viewBox="0 0 ${w} ${h}" style="--len:${Math.PI * Math.max(w, h)}">
        <ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - 4}" ry="${h / 2 - 3}"
          transform="rotate(-1.5 ${w / 2} ${h / 2})"/></svg>`);
  } else {
    btn.classList.add("miss");
    btn.insertAdjacentHTML("beforeend",
      `<svg class="mark" viewBox="0 0 ${w} ${h}">
        <line x1="${w / 2 - 13}" y1="${h / 2 - 13}" x2="${w / 2 + 13}" y2="${h / 2 + 13}"/>
        <line x1="${w / 2 + 13}" y1="${h / 2 - 13}" x2="${w / 2 - 13}" y2="${h / 2 + 13}"/></svg>`);
  }
}

/**
 * 解答1問ぶんの記録と報酬。4択もレンジ回答もここに合流する。
 * bonusRoll はレンジ回答で高い精度を出したときの上乗せ（抽選をもう1回）。
 *
 * GUM は上乗せしない。1問の上限は10GUMで、難易度は学年だけで決めると
 * 決めてあるため（CLAUDE.md 原則6）。
 */
/**
 * クリスタルを1個手に入れる。**図鑑に残し、ポイントに変える。**
 * 鉱物そのものはクラフトで減りません（減らすと豆知識が読めなくなりますし、
 * たまに出た高い鉱物が安いレシピに丸ごと食われます）。
 */
function takeCrystal(id) {
  const c = id && DB.crystalById[id];
  if (!c) return null;
  S.crystals[c.id] = (S.crystals[c.id] || 0) + 1;
  S.points[c.family] = (S.points[c.family] || 0) + crystalPoints(c.scarcity);
  return c.id;
}

/* 正解1問ぶんの抽選。出会えたら幸運、外れても失うものはない（原則2の唯一の例外） */
function rollCrystal(q, gum) {
  const id = takeCrystal(drawCrystal(DB, q.subject, gum));
  if (id) (S.run.found ||= []).push(id);
  return id;
}

/**
 * 出会ったクリスタルの一行。**外れたときは何も出しません。**
 * 「出なかった」を画面に出すと、外れが罰のように見えます。
 */
function crystalGainHTML(id) {
  const c = DB.crystalById[id];
  if (!c) return "";
  const first = (S.crystals[c.id] || 0) <= 1;
  return `<div class="gain found"><img src="${assetPath.crystal(c.id)}" alt="">
    <span>${first ? "はじめて出会った ・ " : ""}<em>${esc(c.name)}</em>
      ・ ${esc(c.family)} ${crystalPoints(c.scarcity)}pt</span></div>`;
}

function grantAnswer(q, ok, bonusRoll = 0) {
  const reward = !S.run.noReward;
  const isNew = !S.cards[q.card];
  let gum = 0, found = null;
  S.run.results[q.id] = ok ? "ok" : "ng";
  if (!reward) S.seen[q.id] = S.seen[q.id];   // 再挑戦では出題履歴も動かさない

  if (ok) {
    S.run.right++;
    if (reward) {
      S.score += Math.max(4, 10 - S.run.hintsUsed * 2);
      gum = gumFor(q);
      S.gum += gum;
      S.run.gum += gum;
      found = rollCrystal(q, gum);
      // 幅を狭く言い切って当てたときだけ、抽選がもう1回
      for (let i = 0; i < bonusRoll; i++) found = rollCrystal(q, gum) || found;
      S.totalRight++;
      if (q.chapter >= 2) S.crossRight++;
      const country = countryOf(q);
      if (country) S.countries[country] = 1;
      if (S.cells[cellKey(q)] !== "st") S.cells[cellKey(q)] = "ok";
    }
  } else {
    S.run.wrong++;
    if (reward && !S.cells[cellKey(q)]) S.cells[cellKey(q)] = "ng";
  }
  if (reward) S.cards[q.card] = true;
  return { gum, found, opened: reward && isNew ? unlockedBy(DB, q.card) : [] };
}




/**
 * 文字パネル。3×3 か 4×4 の盤面をなぞって読みを作る。
 *
 * **文字数の枠は出さない。** グリッドしか見えないので、何文字なのかが事前に
 * 分からない。ここが4択との決定的な差になる。
 * **1文字目のマークも出さない。** 探索コストは許容範囲だが、マークは読みの
 * 1文字目を漏らしてしまう（決定4）。
 */
/**
 * マスの形。**内側を向いた角だけを落とす。**
 *
 * 中は八角形、辺は六角形、四隅は五角形になり、角どうしが辺で向き合う。
 * ななめのつながりが目で見えるうえ、`clip-path` は当たり判定も削るので、
 * ななめにたどるときに隣のマスの角をかすめて拾ってしまうことがなくなる。
 */
function cellShape(i, n) {
  const r = Math.floor(i / n), c = i % n, k = 30;
  const tl = r > 0 && c > 0, tr = r > 0 && c < n - 1;
  const br = r < n - 1 && c < n - 1, bl = r < n - 1 && c > 0;
  const pt = [];
  pt.push(tl ? `${k}% 0%` : "0% 0%");
  if (tr) pt.push(`${100 - k}% 0%`, `100% ${k}%`); else pt.push("100% 0%");
  if (br) pt.push(`100% ${100 - k}%`, `${100 - k}% 100%`); else pt.push("100% 100%");
  if (bl) pt.push(`${k}% 100%`, `0% ${100 - k}%`); else pt.push("0% 100%");
  if (tl) pt.push(`0% ${k}%`);
  return `clip-path:polygon(${pt.join(",")})`;
}

/* 隣り合うマスを薄い線で結ぶ。**ななめにもたどれる**ことが、触る前に分かる */
function latticeHTML(n) {
  const seg = [];
  for (let i = 0; i < n * n; i++) {
    const r = Math.floor(i / n), c = i % n;
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr >= n || nc < 0 || nc >= n) continue;
      seg.push(`<line x1="${(c + 0.5) / n * 100}" y1="${(r + 0.5) / n * 100}"` +
        ` x2="${(nc + 0.5) / n * 100}" y2="${(nr + 0.5) / n * 100}"/>`);
    }
  }
  return `<svg class="panellattice" viewBox="0 0 100 100" preserveAspectRatio="none"
    aria-hidden="true">${seg.join("")}</svg>`;
}

function panelHTML(q) {
  const p = q.panel;
  const n = p.size;
  return `<div class="panelbox">
    <div class="panelword"><span id="pword" class="ph">なぞって読みを作る</span></div>
    <div class="panelwrap">
      ${latticeHTML(n)}
      <svg class="panelline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline id="pline" points=""/></svg>
      <div class="panelgrid" style="grid-template-columns:repeat(${n},1fr)">${
        p.cells.map((c, i) =>
          `<button class="pcell" data-i="${i}" style="${cellShape(i, n)}">${esc(c)}</button>`
        ).join("")}</div>
    </div>
    <button class="btn" id="psubmit" disabled>この読みで答える</button>
    <div class="elimbar"><button class="lnk" id="tochoice">4択に切り替える</button></div>
  </div>`;
}

let panelUpHandler = null;   // 画面を描き直すたびに張り替える

function wirePanel(q) {
  const p = q.panel, n = p.size;
  const word = document.getElementById("pword");
  const line = document.getElementById("pline");
  const submit = document.getElementById("psubmit");
  const cells = [...app.querySelectorAll(".pcell")];
  if (!word || !submit || !cells.length) return;
  let seq = [], dragging = false, dragged = false;

  const adjacent = (a, b) => {
    const dr = Math.abs(Math.floor(a / n) - Math.floor(b / n));
    const dc = Math.abs((a % n) - (b % n));
    return dr <= 1 && dc <= 1 && (dr || dc);
  };
  const paint = () => {
    const text = seq.map(i => p.cells[i]).join("");
    word.textContent = text || "なぞって読みを作る";
    word.classList.toggle("ph", !text);
    submit.disabled = seq.length < 2;
    cells.forEach((b, i) => b.classList.toggle("on", seq.includes(i)));
    // セルの中心を結ぶ。盤面は正方のマス目なので割合で置ける
    line.setAttribute("points", seq.map(i =>
      `${((i % n) + 0.5) / n * 100},${(Math.floor(i / n) + 0.5) / n * 100}`).join(" "));
  };
  /* たどれるなら伸ばす。直前のセルに戻ったら1つ取り消す */
  const visit = i => {
    if (S.run.picked !== null) return;
    if (seq.length >= 2 && i === seq[seq.length - 2]) { seq.pop(); return paint(); }
    if (seq.includes(i)) return;
    if (seq.length && !adjacent(seq[seq.length - 1], i)) return;
    seq.push(i);
    paint();
  };
  const judge = () => {
    if (S.run.picked !== null || seq.length < 2) return;
    const said = seq.map(i => p.cells[i]).join("");
    // accept は「どちらの書き方でも正しい」ときの別表記（サーバ／サーバー など）
    if (said === q.reading || (q.accept || []).includes(said)) return onPick(q.answer, true);
    drawRetry(q, `「${said}」ではない。`);
    seq = []; paint();
  };

  cells.forEach(b => {
    const i = Number(b.dataset.i);
    b.onpointerdown = e => {
      e.preventDefault();
      /* タッチでは pointerdown したマスにポインタが暗黙にキャプチャされる。
         そのままだと他のマスに pointerenter が飛ばず、1文字目しか反応しない。
         キャプチャを放して、指の下のマスを自分で拾いにいく */
      if (b.hasPointerCapture?.(e.pointerId)) b.releasePointerCapture(e.pointerId);
      dragging = true; dragged = false; seq = [];
      visit(i);
    };
    // なぞれない状況でも片手で操作できるよう、連続タップでも同じ入力が成立する
    b.onclick = () => { if (!dragging) visit(i); };
  });

  /* 指の下にあるマスを座標から引く。キャプチャの有無に左右されない。
     ただし**マスの中心の近くに来たときだけ**拾う。ななめにたどると指は隣のマスの
     角をかすめるので、枠に入っただけで拾うと、通り過ぎたマスが混ざったり、
     直前のマスに触れて取り消されたりする */
  const HIT = 0.46;    // 進むときに拾う半径。マスの短いほうの辺に対する割合。
                      // 形のほうで角を落としてあるので、ここは広めでよい
  const BACK = 0.26;  // 取り消すときはもっと深く入る必要がある。ぶれで消えないように
  const wrap = app.querySelector(".panelwrap");
  if (wrap) wrap.onpointermove = e => {
    if (!dragging) return;
    e.preventDefault();
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const cell = under && under.closest ? under.closest(".pcell") : null;
    if (!cell) return;
    const r = cell.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const i = Number(cell.dataset.i);
    if (i === seq[seq.length - 1]) return;
    // 直前のマスへ戻るのは取り消しなので、はっきり中へ入ったときだけ受ける
    const reach = Math.min(r.width, r.height) * (i === seq[seq.length - 2] ? BACK : HIT);
    if (Math.hypot(dx, dy) > reach) return;
    dragged = true;
    visit(i);
  };

  const stop = () => {
    if (!dragging) return;
    dragging = false;
    if (dragged) judge();   // 1マス押しただけの指離しでは確定しない
  };
  // once にすると、最初のタップで外れて以降のなぞりが確定しなくなる
  if (panelUpHandler) {
    document.removeEventListener("pointerup", panelUpHandler);
    document.removeEventListener("pointercancel", panelUpHandler);
  }
  panelUpHandler = stop;
  document.addEventListener("pointerup", panelUpHandler);
  document.addEventListener("pointercancel", panelUpHandler);
  submit.onclick = judge;
  const down = document.getElementById("tochoice");
  if (down) down.onclick = () => { S.run.hard[q.id] = "choice"; render(); };
  paint();
}

/**
 * 数値入力。テンキーで数だけを打ち、単位は固定で出す（[ 200 ] W）。
 *
 * 打ち間違いを判定の対象にしないので、判定は完全に機械的になる。
 * 外しても問題は終わらない。入力欄は生きたままで、続けるか・ヒントを見るか・
 * 4択に降りるかをプレイヤーが選ぶ。**システムは勝手に降ろさない**（決定4）。
 */
function wireNumeric(q) {
  const want = numericParts(q);
  const disp = document.getElementById("numval");
  const submit = document.getElementById("nsubmit");
  if (!want || !disp || !submit) return;
  let buf = "";

  const paint = () => {
    disp.textContent = buf || "数を入れる";
    disp.classList.toggle("ph", !buf);
    submit.disabled = !buf || buf === ".";
  };
  app.querySelectorAll(".keypad .key").forEach(b => {
    b.onclick = () => {
      if (S.run.picked !== null) return;
      const k = b.dataset.k;
      if (k === "←") buf = buf.slice(0, -1);
      else if (k === "." ) { if (buf && !buf.includes(".")) buf += "."; }
      else if (buf.length < 9) buf = (buf === "0" ? "" : buf) + k;
      paint();
    };
  });
  submit.onclick = () => {
    if (S.run.picked !== null || !buf) return;
    if (sameNumber(buf, want.value)) return onPick(q.answer, true);
    drawRetry(q, `「${buf}${want.unit}」ではない。`);
    buf = ""; paint();
  };
  const down = document.getElementById("tochoice");
  if (down) down.onclick = () => { S.run.hard[q.id] = "choice"; render(); };
  paint();
}

/**
 * 外したあとの3択。**このまま挑み直す／ヒントを見る／4択に切り替える。**
 *
 * 1つ目は「何もしない」なので専用ボタンを置かない。押しても何も起きない
 * ボタンは選択肢の重みを下げるだけなので、文言のほうで3択だと示す。
 */
function drawRetry(q, head) {
  const slot = document.getElementById("verdict");
  if (!slot) return;
  const h = heroFor(q);
  const max = fitOf(q, h) ? 3 : 2;
  const more = S.run.hintsUsed < max;
  slot.innerHTML = `<div class="retry">
    <div class="rhead">${esc(head)} まだ続けてもいい。</div>
    <div class="racts">
      ${more ? `<button class="lnk" id="rhint">ヒントを見る</button>` : ""}
      <button class="lnk" id="rdown">4択に切り替える</button>
    </div></div>`;
  const bar = app.querySelector(".numbox .elimbar, .panelbox .elimbar");
  if (bar) bar.hidden = true;   // 同じ導線が2つ並ばないようにする
  const rh = document.getElementById("rhint");
  if (rh) rh.onclick = () => { S.run.hintsUsed++; drawHints(q, h); drawRetry(q, head); };
  document.getElementById("rdown").onclick = () => { S.run.hard[q.id] = "choice"; render(); };
}

/**
 * 何をする画面かを、読まなくても分かるように出す帯。
 *
 * 4択と消去法は選択肢が並ぶ見た目が同じなのに、押す意味は正反対になる。
 * 見分けがつかないと、選んだつもりで消してしまう。**色で区別する。**
 */
function modeBand(q, mode) {
  if (mode === "elimination") {
    const need = q.choices.length - 1;
    const done = (S.run.cut || []).length;
    const got = cutScore(done), next = CUT_SCORE[done];
    return `<div class="band cut"><span class="bmain">誤っているものを ${need}つ 消す</span>
      <span class="bcnt" id="ecnt">${done} / ${need}${
        got ? ` <i>＋${got}点</i>` : ""}${next ? ` <i>次は＋${next}</i>` : ""}</span></div>`;
  }
  if (mode === "choice") {
    return `<div class="band pick"><span class="bmain">正しいものを 1つ 選ぶ</span></div>`;
  }
  return "";
}

/**
 * 消去法。**何個まで削るかを、プレイヤーが決める。**
 *
 * ✕ を押すと1つ消して、その場で当たり外れが決まる。正しく消せれば点が入り、
 * **1つ目より2つ目、2つ目より3つ目のほうが大きい。** 確信があるほど深く削れて、
 * 点が伸びる。まちがえて正解を消したらそこで終わりだが、
 * **そこまでに消せたぶんの点は残る。** リスクを取った手前までは自分のものになる。
 *
 * **この画面でできるのは消すことだけです。** 「誤っているものを消す」と
 * 「正しいものを選ぶ」が同じ画面に同居すると、どちらをすればよいのか分からなくなる。
 * 選択肢の文字は押せず、✕ だけが押せる。
 *
 * 正しいものを選びたい人は、下の「4択に切り替える」で明示的に降りる。
 * **降りるかどうかは常にプレイヤーの手にある**（決定2）。降りてもその問題かぎりで、
 * 次の問題ではまた難モードから始まる。
 *
 * **増えるのは点だけ。** GUM・クリスタル・知識カードは動かさない（原則3-2）。
 */
function wireElimination(q) {
  const cuts = () => (S.run.cut ||= []);
  const left = () => q.choices.map((_, i) => i).filter(i => !cuts().includes(i));

  /* 消したことを、その行の上で見せる */
  const flash = (i, text, ok) => {
    const row = app.querySelector(`.row[data-r="${i}"]`);
    if (!row) return;
    const tag = document.createElement("span");
    tag.className = "cutgain" + (ok ? "" : " ng");
    tag.textContent = text;
    row.appendChild(tag);
    setTimeout(() => tag.remove(), 1200);
  };

  app.querySelectorAll(".xcut[data-c]").forEach(b => {
    b.onclick = () => {
      if (S.run.picked !== null) return;
      const i = Number(b.dataset.c);
      if (cuts().includes(i)) return;

      if (i === q.answer) {                 // 正解を消した。ここで終わり
        flash(i, "✕", false);
        return onPick(q.answer, false);
      }
      const gain = CUT_SCORE[cuts().length] || 0;
      cuts().push(i);
      if (!S.run.noReward) S.score += gain;   // その場で入る。外しても取り返されない
      flash(i, `＋${gain}`, true);

      const row = app.querySelector(`.row[data-r="${i}"]`);
      if (row) row.classList.add("gone");
      const band = app.querySelector(".band");
      if (band) band.outerHTML = modeBand(q, "elimination");

      // 残り1つになったら、それが答え。＋の表示は浮いて出るので、間を置かずに判定する
      if (left().length === 1) onPick(q.answer, true);
    };
  });

  /**
   * **消去法では、選択肢の文字は押せません。** できるのは ✕ で消すことだけ。
   * 「誤っているものを消す」と「正しいものを選ぶ」が同じ画面に同居すると、
   * どちらをすればよいのか分からなくなります。正しいものを選びたい人は、
   * 下の「4択に切り替える」で明示的に降ります（決定2）。
   */
  const down = document.getElementById("tochoice");
  if (down) down.onclick = () => { S.run.hard[q.id] = "choice"; render(); };
}

/** 絵の選択肢だったときだけ、判定と同時に4つとも語を見せる */
function revealChoiceWords(q) {
  if (!q.choiceArt) return;
  app.querySelectorAll(".choices .choice.art").forEach(b => {
    if (b.querySelector(".cword")) return;
    const i = Number(b.dataset.i);
    b.insertAdjacentHTML("beforeend", `<span class="cword">${esc(q.choices[i] ?? "")}</span>`);
  });
}

function onPick(idx, forcedOk = null) {
  if (S.run.picked !== null) return;
  const q = currentQ(), h = heroFor(q);
  // 消去法は「正解を選んだか」では決まらないので、呼ぶ側が結果を渡す
  const ok = forcedOk === null ? idx === q.answer : forcedOk;
  S.run.picked = idx;
  if (!S.run.noReward) S.seen[q.id] = 1;

  app.querySelectorAll(".keypad .key, #nsubmit, #tochoice, .pcell, #psubmit, .xcut[data-c]")
    .forEach(b => b.disabled = true);
  revealChoiceWords(q);
  app.querySelectorAll(".choices .choice").forEach((b, i) => {
    b.disabled = true;
    if (i === idx) markChoice(b, ok);
    else if (i === q.answer && !ok) { b.style.borderColor = "var(--pen)"; b.style.color = "var(--pen)"; }
    else b.classList.add("dim");
  });

  const reward = !S.run.noReward;
  const isNew = !S.cards[q.card];
  let found = null;
  S.run.results[q.id] = ok ? "ok" : "ng";
  let gum = 0;
  if (ok) {
    S.run.right++;
    if (reward) {
      S.score += Math.max(4, 10 - S.run.hintsUsed * 2);
      gum = gumFor(q);
      S.gum += gum;
      S.run.gum += gum;
      found = rollCrystal(q, gum);
      S.totalRight++;
      if (q.chapter >= 2) S.crossRight++;
      const country = countryOf(q);
      if (country) S.countries[country] = 1;
      if (S.cells[cellKey(q)] !== "st") S.cells[cellKey(q)] = "ok";
    }
  } else {
    S.run.wrong++;
    if (reward && !S.cells[cellKey(q)]) S.cells[cellKey(q)] = "ng";
  }
  const opened = reward && isNew ? unlockedBy(DB, q.card) : [];
  if (reward) S.cards[q.card] = true;
  drawHints(q, h);

  /**
   * テンポ優先モード：正解なら演出だけ見せて次へ。
   * **ただし注釈（`note`）は飛ばしません。** 表記のゆれのように、
   * 知らないと次にぶつかったとき迷うものを置く欄なので、解説を省く設定でも出します。
   */
  if (ok && !S.settings.showExplanationOnCorrect && q.note) {
    S.run.tipOpen = false; S.run.applied = null;
    drawNoteOnly(q, h);
    return;
  }
  if (ok && !S.settings.showExplanationOnCorrect) {
    S.toast = `<span class="seal">✓</span><em>${esc(q.card)}</em>` +
      (gum ? `<img src="${assetPath.icon("gum")}" alt="GUM"> ${gum}` : "") +
      (found ? `<img src="${assetPath.crystal(found)}" alt="">` : "");
    drawToast();
    setTimeout(() => { S.toast = null; advance(); }, 750);
    return;
  }

  S.run.tipOpen = false; S.run.applied = null;
  drawVerdict(q, h, ok, gum, null, found, opened);
}

/**
 * 解説を省く設定のときに、注釈だけを出す小さい判定。
 * 解説（`lesson`）は出さず、注釈と知識カードだけを見せます。
 */
function drawNoteOnly(q, h) {
  document.getElementById("verdict").innerHTML = `
  <div class="verdict"><div class="vhead ok">正解。</div>
    <div class="lesson">
      <div class="speaker"><img class="ava sm" src="${assetPath.hero(h.id)}" alt="">
        <span>${esc(h.name)}</span></div>
      <p class="qnote">${esc(q.note)}</p>
      <div class="gain"><span class="seal">✓</span><span>知識カード ・ <em>${esc(q.card)}</em></span></div>
    </div>
    <div id="tipslot"></div><div id="exslot"></div><div class="stack" id="acts"></div></div>`;
  drawActions(q, true);
}

function drawVerdict(q, h, ok, gum = 0, rangeScore = null, found = null, opened = []) {
  const head = ok
    ? (rangeScore !== null
        ? (rangeScore === 1000 ? "言い切って、当てた。" : "その幅の中にある。")
        : S.run.hintsUsed ? "正解。ヒントを使っても、解けたことに変わりはない。" : "正解。")
    : "面白い単元に当たった。ここは聞いていこう。";
  document.getElementById("verdict").innerHTML = `
  <div class="verdict"><div class="vhead ${ok ? "ok" : "ng"}">${esc(head)}</div>
    <div class="lesson">
      <div class="speaker"><img class="ava sm" src="${assetPath.hero(h.id)}" alt="">
        <span>${esc(h.name)}</span></div>
      <p>${esc(q.lesson)}</p>
      ${q.note ? `<p class="qnote">${esc(q.note)}</p>` : ""}
      ${photoAt(q, "lesson")}
      <div class="gain"><span class="seal">✓</span><span>知識カード ・ <em>${esc(q.card)}</em></span></div>
      ${gum ? `<div class="gain alt"><img src="${assetPath.icon("gum")}" alt="GUM">
        <span>GUM × ${gum} ・ ${esc(q.gradeLabel)}の問題</span></div>` : ""}
      ${found ? crystalGainHTML(found) : ""}
      ${opened.length ? `<div class="gain open"><span class="seal">＋</span>
        <span><em>${opened.length}問</em>が開きました ・ ${
          [...new Set(opened.map(x => x.subject))].map(esc).join("・")}</span></div>` : ""}
      ${rangeScore !== null && rangeScore >= RANGE_BONUS_SCORE ? `<div class="gain">
        <span class="seal">＋</span><span>精度 ${rangeScore}点 ・ 抽選がもう1回</span></div>` : ""}
    </div>
    <div id="tipslot"></div><div id="exslot"></div><div class="stack" id="acts"></div></div>`;
  drawTip(q); drawApplied(q, ok); drawActions(q, ok);
  const v = document.getElementById("verdict");
  if (v && v.scrollIntoView) v.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function drawTip(q) {
  const slot = document.getElementById("tipslot");
  if (!S.run.tipOpen) { slot.innerHTML = ""; return; }
  const others = heroesOwned().filter(x => !x.fit.includes(q.subject));
  const t = others.length ? others[q.card.length % others.length] : heroesOwned()[0];
  slot.innerHTML = `<div class="tip">
    <div class="speaker"><img class="ava sm" src="${assetPath.hero(t.id)}" alt="">
      <span>${esc(t.name)}</span></div><p>${esc(q.tip)}</p></div>`;
}

function drawApplied(q, ok) {
  const slot = document.getElementById("exslot");
  if (!S.run.applied) { slot.innerHTML = ""; return; }
  const a = q.applied, answered = S.run.applied.picked !== null;
  slot.innerHTML = `<div class="stretchbox"><div class="tag">応用編</div>
    <div class="sq">${esc(a.prompt)}</div>
    <div class="choices" id="exch">${a.choices.map((t, i) =>
      `<button class="choice" data-i="${i}">${esc(t)}</button>`).join("")}</div>
    ${!answered ? (S.run.applied.hint
      ? `<div class="hint" style="margin-top:10px"><b>ヒント</b>${esc(a.hint)}</div>`
      : `<button class="shint" id="exhint">ヒントをもらう</button>`) : ""}
    ${answered ? `<div class="snote"><b>${S.run.applied.ok ? "正解。抽選をもう1回" : "惜しい。"}</b> ${esc(a.note)}</div>` : ""}</div>`;

  if (!answered) {
    const hb = document.getElementById("exhint");
    if (hb) hb.onclick = () => { S.run.applied.hint = true; drawApplied(q, ok); };
    app.querySelectorAll("#exch > .choice").forEach(b =>
      b.onclick = () => onAppliedPick(q, ok, Number(b.dataset.i)));
  } else {
    app.querySelectorAll("#exch > .choice").forEach((b, i) => {
      b.disabled = true;
      if (i === S.run.applied.picked && S.run.applied.ok) {
        b.style.borderColor = "var(--moss)"; b.style.color = "var(--moss)";
      } else if (i === a.answer) {
        b.style.borderColor = "var(--pen)"; b.style.color = "var(--pen)";
      } else b.classList.add("dim");
    });
  }
}

function onAppliedPick(q, ok, idx) {
  const right = idx === q.applied.answer;
  S.run.applied.picked = idx; S.run.applied.ok = right;
  if (right) {
    S.run.appliedRight++; S.score += 15;
    S.cells[cellKey(q)] = "st";
    S.cards[q.card + "（応用）"] = true;
    if (!S.run.noReward) rollCrystal(q, gumFor(q));   // 応用を抜けたら抽選がもう1回
  }
  drawApplied(q, ok); drawActions(q, ok);
}

function drawActions(q, ok) {
  const acts = document.getElementById("acts");
  const last = S.run.i + 1 >= S.run.ids.length;
  acts.innerHTML = `
    ${ok && q.applied && !S.run.applied
      ? `<button class="btn stretch" id="tostretch">応用編にも挑戦する ・ 抽選+1</button>` : ""}
    ${!S.run.tipOpen ? `<button class="btn ghost" id="totip">もう少しだけ知りたい</button>` : ""}
    <button class="btn" id="next">${last ? "結果へ" : "つぎへ"}</button>`;
  const st = document.getElementById("tostretch");
  if (st) st.onclick = () => {
    S.run.applied = { picked: null, ok: false, hint: false };
    drawApplied(q, ok); drawActions(q, ok);
  };
  const tp = document.getElementById("totip");
  if (tp) tp.onclick = () => { S.run.tipOpen = true; drawTip(q); drawActions(q, ok); };
  document.getElementById("next").onclick = advance;
}

function advance() {
  S.run.i++; S.run.picked = null; S.run.hintsUsed = 0; S.run.cut = null;
  S.run.tipOpen = false; S.run.applied = null;
  if (S.run.i >= S.run.ids.length) { finishRun(); S.view = "result"; }
  render(); window.scrollTo(0, 0);
}

/* ---------- スワイプ（2択・テンポ優先） ---------- */

/**
 * **カードを、正しいと思うほうへはらう。**
 *
 * 中央に写真、上に短い問い、左右に2つの答え。10問ぜんぶがこの形で、
 * **途中に解説もヒントも挟みません。**○✕ だけをその場で出して、すぐ次へ行きます。
 * ここだけ他の方式と混ぜないのは、混ぜた時点でテンポの設計が成り立たないからです
 * （在庫の段階で分けてあります・`engine.isSwipe`）。
 *
 * **解説を捨てたわけではありません。** 原則3（不正解でも解説は必ず出す）は、
 * セッションの終わりの「ふりかえり」で守ります。外した問題は開いた状態で並びます。
 *
 * **はらう・押す・矢印キー、どれでも同じです。** はらう向きがそのまま答えなので、
 * 押す意味を取りちがえようがありません（だから1手で決まってかまわない画面です）。
 */
/* **PD と CC0 は表示義務そのものが無いので、出題中だけ題名を伏せられます。**
   CC BY は題名も表示の条件なので伏せません。伏せた瞬間に条件を満たさなくなります */

const SWIPE_THROW = 56;    // これだけ横に動かしたら確定。届かなければ戻る
const SWIPE_HOLD = 900;    // ○✕ を見せている時間（ミリ秒）

/* 画面をまたいで残る listener は、毎回まとめて外す（文字パネルと同じ手当て）*/
let swipeBound = null;
function unbindSwipe() {
  if (!swipeBound) return;
  document.removeEventListener("pointermove", swipeBound.move);
  document.removeEventListener("pointerup", swipeBound.up);
  document.removeEventListener("pointercancel", swipeBound.up);
  document.removeEventListener("keydown", swipeBound.key);
  swipeBound = null;
}

/* その handler がまだ生きているか。画面を離れても問題が進んでも死ぬ */
const swipeLive = q => S.view === "quiz" && S.run.ids[S.run.i] === q.id;

function vSwipe() {
  if (S.run.i >= S.run.ids.length) return go("result");
  const q = currentQ();
  const p = DB.photos?.[q.image];
  const place = q.country ? `<b>${esc(q.country)}</b>` : `日本 <b>${esc(q.gradeLabel)}</b>`;

  app.innerHTML = `
  <header><div class="hbar">
    <div class="place">${place} ・ ${esc(q.subject)}</div>
    <div class="score">${S.run.i + 1} / ${S.run.ids.length}</div></div>
    ${planStrip()}</header>
  <div class="pad swp">
    <div class="qmeta"><span class="grade ${q.newCurriculum ? "alt" : ""}">${esc(q.gradeLabel)}</span>
      <span class="unit">${esc(q.unit)}</span>${levelChip(q, "swipe")}</div>
    <div class="swp-q">${esc(q.prompt)}</div>
    <div class="swp-picks">
      <button class="swp-pick l" data-s="0"><i aria-hidden="true">←</i>
        <span>${esc(q.choices[0])}</span></button>
      <button class="swp-pick r" data-s="1"><span>${esc(q.choices[1])}</span>
        <i aria-hidden="true">→</i></button>
    </div>
    <div class="swp-stage">
      <div class="swp-card" id="swpcard" tabindex="0"
        role="group" aria-label="${esc(q.prompt)}">
        ${p && p.file ? `<img src="${assetPath.photo(p.file)}" alt="${esc(q.alt || "")}"
          ${p.width ? `width="${p.width}" height="${p.height}"` : ""} draggable="false">` : ""}
        <div class="swp-seal" id="swpseal" aria-live="polite"></div>
      </div>
    </div>
    <p class="swp-cred" id="swpcred">${p ? creditLine(p, !titleFree(p)) : ""}</p>
    <p class="fine swp-how">カードを、正しいと思うほうへはらう。左右のボタンや矢印キーでも答えられます。</p>
  </div>`;

  wireSwipe(q);
}

function wireSwipe(q) {
  unbindSwipe();
  const card = document.getElementById("swpcard");
  const picks = [...app.querySelectorAll(".swp-pick")];
  if (!card || picks.length !== 2) return;
  let pid = null, x0 = 0, dx = 0, dragging = false;

  const lean = d => {
    const t = Math.max(-1, Math.min(1, d / (SWIPE_THROW * 2)));
    card.style.transform = `translateX(${d}px) rotate(${(t * 7).toFixed(2)}deg)`;
    picks[0].classList.toggle("on", d <= -10);
    picks[1].classList.toggle("on", d >= 10);
  };
  const settle = () => {
    card.style.transform = "";
    picks.forEach(b => b.classList.remove("on"));
  };

  const move = e => {
    if (!dragging || !swipeLive(q) || e.pointerId !== pid) return;
    dx = e.clientX - x0;
    lean(dx);
  };
  const up = e => {
    if (!dragging || !swipeLive(q)) return;
    if (e.pointerId != null && e.pointerId !== pid) return;
    dragging = false;
    card.classList.remove("held");
    const thrown = dx;
    dx = 0;
    if (Math.abs(thrown) >= SWIPE_THROW) onSwipe(q, thrown < 0 ? 0 : 1);
    else settle();
  };
  const key = e => {
    if (!swipeLive(q)) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); onSwipe(q, 0); }
    else if (e.key === "ArrowRight") { e.preventDefault(); onSwipe(q, 1); }
  };

  card.onpointerdown = e => {
    if (S.run.picked !== null) return;
    /* タッチでは pointerdown した要素にポインタが暗黙にキャプチャされる。
       放しておかないと、指がカードの外へ出た瞬間に追えなくなる（文字パネルと同じ）*/
    if (card.hasPointerCapture?.(e.pointerId)) card.releasePointerCapture(e.pointerId);
    dragging = true; pid = e.pointerId; x0 = e.clientX; dx = 0;
    card.classList.add("held");
  };
  picks.forEach(b => b.onclick = () => onSwipe(q, Number(b.dataset.s)));

  swipeBound = { move, up, key };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
  document.addEventListener("pointercancel", up);
  document.addEventListener("keydown", key);
}

/**
 * はらった先で答える。**○✕ だけをその場で見せて、すぐ次へ行きます。**
 *
 * 報酬は他の方式とまったく同じです（原則3-2）。GUM も知識カードもクリスタルの抽選も、
 * 4択で答えたときと1つも変わりません。**出す情報だけを削っています。**
 */
function onSwipe(q, side) {
  if (S.run.picked !== null) return;
  S.run.picked = side;
  if (!S.run.noReward) S.seen[q.id] = 1;
  const ok = side === q.answer;
  grantAnswer(q, ok);

  const card = document.getElementById("swpcard");
  const seal = document.getElementById("swpseal");
  const picks = [...app.querySelectorAll(".swp-pick")];
  picks.forEach((b, i) => {
    b.disabled = true;
    b.classList.toggle("on", i === side);
    b.classList.toggle("miss", i === side && !ok);
    b.classList.toggle("right", i === q.answer && !ok);
  });
  if (seal) { seal.textContent = ok ? "○" : "✕"; seal.className = "swp-seal " + (ok ? "ok" : "ng"); }
  if (card) {
    card.classList.add("thrown");
    card.style.transform = `translateX(${side ? 42 : -42}%) rotate(${side ? 9 : -9}deg)`;
  }
  // 題名まで含めたクレジットは、答えたあとに出す。ここが「誰だったのか」の答え合わせになる
  const cred = document.getElementById("swpcred");
  const p = DB.photos?.[q.image];
  if (cred && p) cred.innerHTML = creditLine(p, true);

  setTimeout(() => { if (swipeLive(q)) { unbindSwipe(); advance(); } }, SWIPE_HOLD);
}

/**
 * セッションの終わりの「ふりかえり」。**原則3はここで守ります。**
 * 外した問題は開いた状態で並べます（解説スキップ設定に関わらず出します）。
 */
function swipeReview() {
  /* **スワイプは解説を途中で出さないので、ここで必ず出す**（原則3）。
     束で混ざったセッションでも、そのぶんだけを並べる */
  const list = S.run.ids.map((id, n) => [DB.byId[id], n])
    .filter(([q]) => q && q.mode === "swipe");
  if (!list.length) return "";
  const rows = list.map(([q, n]) => {
    const ok = S.run.results[q.id] === "ok";
    return `<details class="rv ${ok ? "ok" : "ng"}"${ok ? "" : " open"}>
      <summary><span class="rvmark">${ok ? "○" : "✕"}</span>
        <b>${n + 1}</b><span class="rvq">${esc(q.prompt)}</span>
        <i>${esc(q.choices?.[q.answer] ?? "")}</i></summary>
      <div class="rvbody"><p>${esc(q.lesson)}</p>
        ${q.note ? `<p class="qnote">${esc(q.note)}</p>` : ""}
        ${photoHTML(q.image, "rvpic")}
        <div class="gain"><span class="seal">✓</span>
          <span>知識カード ・ <em>${esc(q.card)}</em></span></div></div></details>`;
  }).join("");
  return `<div class="panel"><div class="phead"><h2>スワイプ ${list.length}問のふりかえり</h2></div>
    <p class="fine">テンポを切らさないために、解説はここへまとめました。
      <b>外した問題は開いてあります。</b></p>${rows}</div>`;
}

/* ---------- リザルト ---------- */

function vResult() {
  const answered = S.run.right + S.run.wrong;
  const rate = answered ? Math.round(S.run.right / answered * 100) : 0;
  const craftable = craftableKeys(DB, S).length;
  const next = DB.heroes.find(h => !S.owned[h.id]);
  const nextGauge = next ? gaugeBreakdown(DB, S, next) : null;

  app.innerHTML = `
  <header><div class="hbar"><div class="place">${S.runs}回目</div>
    <div class="score">${S.score}</div></div></header>
  <div class="pad"><div class="title-wrap" style="padding-top:26px">
    <h1>拾ってきたもの</h1><div class="rule"></div>
    <div class="stat">
      <div><b>${S.run.right}</b><span>解けた</span></div>
      <div><b>${S.run.appliedRight}</b><span>応用も突破</span></div>
      <div><b>${rate}<small style="font-size:15px">%</small></b><span>正答率</span></div>
      ${S.run.noReward ? "" : `<div><b>${S.run.gum}</b><span>GUM</span></div>`}</div>
    ${S.run.shortage ? `<p class="cue">この範囲では形式の束が ${
      (S.run.plan || []).length}つしか組めなかったので、${S.run.ids.length}問で終わりました。</p>` : ""}
    ${(S.run.plan || []).length > 1 ? `<p class="cue">今回の形式 ・ ${
      S.run.plan.map(b => `${MODE_LABEL[b.mode] || b.mode} ${b.n}問`).join(" → ")}</p>` : ""}
    ${(S.run.levelUps || []).length ? `<div class="panel lvup">
      <div class="phead"><h2>段が上がりました</h2></div>
      ${S.run.levelUps.map(u => `<p class="lvrow"><b>${esc(MODE_LABEL[u.mode] || u.mode)}</b>
        <span>Lv.${u.from} → <em>Lv.${u.to}</em></span></p>`).join("")}
      <p class="fine">学年はそのままで、<b>同じ学年の中でもう一段こみ入った問い</b>が出るようになります。
        形式ごとに別なので、ほかの形式の出方は変わりません。<b>下がることはありません。</b></p>
    </div>` : ""}
    ${swipeReview()}
    ${S.run.noReward ? `<p class="cue">記録からの再挑戦なので、クリスタルも知識カードも増えていません。</p>`
    : `<div class="panel">
      <div class="phead"><h2>今回出会ったもの</h2></div>
      ${(S.run.found || []).length ? `<div class="foundrow">${
        [...new Set(S.run.found)].map(id => {
          const c = DB.crystalById[id], n = S.run.found.filter(x => x === id).length;
          return `<span class="fnd"><img src="${assetPath.crystal(id)}" alt="">
            <b>${esc(c.name)}</b>${n > 1 ? `×${n}` : ""}
            <i>${esc(c.family)} ${crystalPoints(c.scarcity)}pt</i></span>`;
        }).join("")}</div>`
        : `<p class="fine">今回はクリスタルに出会いませんでした。次の1問で出るかもしれません。</p>`}
      ${famStrip("big")}
      <p class="fine">GUM は難しい問題ほど多く貯まります（小1で1、世界の問題で10）。
        いくつ持っているかはショップで見られます。</p>
    </div>`}
    ${craftable ? `<p class="cue">クラフトできるエクステンションが ${craftable}種あります。</p>` : ""}
    ${next ? `<p class="cue">次に挑めるのは ${esc(next.name)}（${next.rarity}）。いまの知識での到達度は ${
      nextGauge.percent}% です。</p>` : ""}
    <div class="stack">
      <button class="btn" id="again">もう一度 ・ ${
        S.run.swipe ? "スワイプ" : S.select.band === "auto" ? "おまかせ" : "同じ範囲"}</button>
      <button class="btn ghost" id="change">範囲を変えて解く</button>
      ${craftable ? `<button class="btn ghost" id="craft">クラフトする</button>` : ""}
      ${next ? `<button class="btn stretch" id="chal">${esc(next.name)}に挑む</button>` : ""}
      <button class="btn ghost" id="home">ホームへ</button></div>
  </div></div>`;

  const swipeAgain = !!S.run.swipe;
  document.getElementById("again").onclick = () => startRun(swipeAgain ? { swipe: true } : {});
  document.getElementById("change").onclick = () => go("select");
  document.getElementById("home").onclick = () => go("home");
  const c = document.getElementById("craft"); if (c) c.onclick = () => go("craft");
  const b = document.getElementById("chal"); if (b) b.onclick = () => startChallenge(next.id);
}

/* ---------- クラフト・装備 ---------- */

function vCraft() {
  const tab = RANK_ORDER.includes(S.craftTab) ? S.craftTab : RANK_ORDER[0];
  const all = Object.values(DB.extensions);
  /* 作れるものを先に、次に足りないものが少ない順。108種あるので並び順が効く */
  const items = all.filter(e => e.rank === tab).map(e => {
    const c = craftCheck(DB, S, e.id);
    const short = c.crystals.filter(x => !x.enough).length + c.cards.filter(x => !x.ok).length;
    return { e, c, short };
  }).sort((a, b) => a.short - b.short || a.e.name.localeCompare(b.e.name, "ja"));
  const made = Object.values(S.exts).reduce((a, b) => a + b, 0);

  app.innerHTML = `
  <header><div class="hbar"><div class="place">クラフト</div>
    <button class="mapbtn" id="back">もどる</button></div></header>
  <div class="pad">
    <p class="fine">エクステンションは攻撃力ではありません。持っている知識が、どこまで遠くの問いに届くかを広げます。
      <b>到達度を上げるのは知識カードで、装備はそれを最大で2倍にするところまでです。</b></p>
    ${famStrip()}
    <p class="fine">クラフトには<b>族ごとのポイント</b>と、<b>その品の由来がまたがる教科の知識カード</b>が
      要ります。素材だけでは作れません。ポイントは鉱物に出会ったときに入り、
      <b>鉱物そのものは図鑑に残ります</b>（クラフトでは減りません）。</p>
    <div class="seg" id="ranktab">${RANK_ORDER.map(r => {
      const n = all.filter(e => e.rank === r);
      const own = n.filter(e => S.exts[e.id]).length;
      return `<button data-r="${esc(r)}" class="${r === tab ? "on" : ""}">${esc(r)}<i>${own}/${n.length}</i></button>`;
    }).join("")}</div>
    <p class="fine">${esc(RANK_NOTE[tab])}</p>

    ${items.map(({ e, c }) => {
      const have = S.exts[e.id] || 0;
      return `<div class="ext ${c.ok ? "" : "dim"}">
        <div class="exthead">
          <img class="exticon" src="${assetPath.ext(e.id)}" alt="">
          <div><div class="extname">${esc(e.name)}${have ? ` <span class="cnt">×${have}</span>` : ""}</div>
            <div class="extsub"><span class="rk r${RANK_ORDER.indexOf(e.rank)}">${esc(e.rank)}</span>
              ${e.subs.join(" ・ ")} ・ ゲージ +${e.gauge}</div></div></div>
        <p class="extt">${esc(e.origin)}</p>
        <div class="cost">
          ${c.crystals.map(x => `<span class="${x.enough ? "" : "short"}"
            title="${esc(x.family)}は${esc(DB.familyToSubject[x.family] || "")}を解くと貯まります"
            >${esc(x.family)} ${x.enough ? `${x.need}pt` : `${x.have}/${x.need}pt`}</span>`).join("")}
          ${c.cards.map(x => `<span class="${x.ok ? "" : "short"}"
            title="${esc(x.subject)}の知識カード">${esc(x.subject)}の札 ${
              x.ok ? `${x.need}枚` : `${x.have}/${x.need}枚`}</span>`).join("")}
          ${c.origin ? `<span class="${c.origin.ok ? "" : "short"}"
            title="この品の元になった問いを解くと手に入ります"
            >由来 ・ ${esc(c.origin.card)}</span>` : ""}
          <button class="mini" data-k="${e.id}" ${c.ok ? "" : "disabled"}>クラフト</button></div>
        ${c.origin && !c.origin.ok && c.origin.qid ? `
          <p class="fine">この品の由来をまだ知りません。
            <button class="mini ask" data-q="${c.origin.qid}">由来をたずねる</button></p>` : ""}
        ${c.origin && c.origin.ok ? `<p class="fine">由来は確かめてあります。
          ${unlockedBy(DB, c.origin.card).length}問がここから開きました。</p>` : ""}
        ${e.upgrade ? `<p class="fine">上位に「${esc(e.upgrade.name)}」があります。</p>` : ""}
      </div>`;
    }).join("")}
    <p class="fine">作った数 ${made} ・ ランクは<b>由来がいくつの教科にまたがるか</b>で決まります。
      MCHのレアリティは使いません。上位レアリティだけを見ていると、算数・数学がゼロのままになるためです。</p>
  </div>`;

  document.getElementById("back").onclick = () => go(S.runs ? "result" : "home");
  app.querySelectorAll("#ranktab button").forEach(b =>
    b.onclick = () => { S.craftTab = b.dataset.r; render(); });
  /* 由来の問いには、ここから直接挑める。**運で当たるのを待たせないため。**
     報酬はふつうに入るので、解けばその場でカードが手に入る */
  app.querySelectorAll(".mini.ask").forEach(b =>
    b.onclick = () => startRun({ ids: [b.dataset.q] }));
  app.querySelectorAll(".mini[data-k]").forEach(b => b.onclick = () => {
    const id = b.dataset.k, e = DB.extensions[id];
    const c = craftCheck(DB, S, id);
    if (!c.ok) return;
    c.crystals.forEach(x => { S.points[x.family] = (S.points[x.family] || 0) - x.need; });
    S.exts[id] = (S.exts[id] || 0) + 1;
    S.toast = `<img src="${assetPath.ext(id)}" alt=""><em>${esc(e.name)}</em>`;
    render();
    setTimeout(() => { S.toast = null; drawToast(); }, 1600);
  });
}

/**
 * 「この装備をつけたら、誰への到達度がどれだけ動くか」を見る相手。
 * 装備画面のあいだだけ覚えていればよいので、保存はしない。
 */
let gaugeTarget = null;

/* 装備を差し替えたときの equip を作る。同じ品は他の英雄から外れる（付け替えと同じ挙動） */
function equipWith(heroId, key) {
  const eq = {};
  Object.entries(S.equip).forEach(([id, k]) => {
    if (k && k !== key && id !== heroId) eq[id] = k;   // 自分の枠は key で置き直す
  });
  if (key) eq[heroId] = key;
  return eq;
}

/**
 * その装備にしたときの、対象英雄への到達度（%）。**丸めません。**
 * 初伝ひとつの効きは1%に満たないことがあり、整数に丸めると
 * 「動いた」ことが画面から消えます。丸めるのは出すときだけ。
 */
function reachWith(target, heroId, key) {
  if (!target || !target.rel) return null;
  return gaugeBreakdown(DB, { ...S, equip: equipWith(heroId, key) }, target).reach * 100;
}

/* 整数では同じに見えてしまうときだけ、小数第1位まで出す */
function reachPair(a, b) {
  const same = Math.round(a) === Math.round(b);
  const d = same && a !== b ? 1 : 0;
  return [a.toFixed(d), b.toFixed(d)];
}

function vHero() {
  const h = DB.heroById[S.heroView], eq = S.equip[h.id];
  const inv = Object.entries(S.exts).filter(([k, n]) => n > 0 && DB.extensions[k]);

  /* 到達度を測る相手。まだ解放していない英雄がいればそちらを既定にする */
  const targets = DB.heroes.filter(x => x.rel);
  const locked = targets.filter(x => !S.owned[x.id]);
  const pool = locked.length ? locked : targets;
  if (!pool.some(x => x.id === gaugeTarget)) gaugeTarget = pool[0]?.id || null;
  const target = gaugeTarget ? DB.heroById[gaugeTarget] : null;

  const bare = reachWith(target, h.id, "");   // この英雄の枠を空にしたとき
  const now  = reachWith(target, h.id, eq || "");

  app.innerHTML = `
  <header><div class="hbar"><div class="place">${esc(h.name)}</div>
    <button class="mapbtn" id="back">もどる</button></div></header>
  <div class="pad">
    <div class="herohead"><img src="${assetPath.hero(h.id)}" alt="">
      <div><div class="hh-name">${esc(h.name)}</div>
        <div class="hr r${h.rarity}">${esc(h.rarity)}</div>
        <div class="fine" style="margin-top:6px">得意 ・ ${h.fit.join(" ")}</div></div></div>
    <p class="flavor">${esc(h.flavor)}</p>
    <div class="panel"><div class="phead"><h2>エクステンション</h2></div>
      ${target ? `<div class="reach">
        <select id="gtarget" aria-label="誰への到達度を見るか">
          ${pool.map(x => `<option value="${x.id}" ${x.id === target.id ? "selected" : ""}
            >${esc(x.name)}（${esc(x.rarity)}）</option>`).join("")}</select>
        <div class="rnum"><span>${esc(target.name)}への到達度</span>
          <b class="${now > bare ? "up" : ""}">${(([x, y]) =>
            now === bare ? `${x}%` : `${x}% → ${y}%`)(reachPair(bare, now))}</b></div>
        <div class="rbar"><i style="width:${bare}%"></i>
          <u style="left:${Math.min(bare, now)}%;width:${Math.abs(now - bare)}%"></u></div>
      </div>` : ""}
      ${inv.length ? `<div class="eqlist">
        <button class="eqi ${!eq ? "on" : ""}" data-k="">外す${
          target ? `<em>±0</em>` : ""}</button>
        ${inv.map(([k]) => {
          const r = reachWith(target, h.id, k);
          // **候補には差分を出します。** 到達度そのものを並べると、効きが小さいときに
          // どれも同じ数字に見えてしまい、選ぶ手がかりにならない
          const dd = r === null ? null : r - bare;
          return `<button class="eqi ${eq === k ? "on" : ""}" data-k="${k}">
          <img class="exticon sm" src="${assetPath.ext(k)}" alt="">${esc(DB.extensions[k].name)}${
            dd === null ? "" : `<em class="${dd > 0 ? "up" : ""}">${
              dd > 0 ? `＋${dd < 1 ? dd.toFixed(1) : Math.round(dd)}` : "±0"}</em>`}</button>`;
        }).join("")}</div>
        ${eq ? `<p class="fine">${DB.extensions[eq].subs.some(s => h.fit.includes(s))
          ? "この英雄の得意分野と噛み合っています。効果が2倍になります。"
          : "得意分野とは噛み合っていません。効果は通常のままです。"}</p>` : ""}`
        : `<p class="empty">まだ持っていません。クリスタルを集めてクラフトしてください。</p>`}
      <p class="fine">装備は到達度を<b>何倍にするか</b>だけを変えます（合計で最大2倍）。
        知識がゼロなら、何をつけても0%のままです。</p></div>
  </div>`;
  document.getElementById("back").onclick = () => go("heroes");
  const sel = document.getElementById("gtarget");
  if (sel) sel.onchange = () => { gaugeTarget = sel.value; render(); };
  app.querySelectorAll(".eqi").forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (k) {
      Object.keys(S.equip).forEach(id => { if (S.equip[id] === k && id !== h.id) delete S.equip[id]; });
      S.equip[h.id] = k;
    } else delete S.equip[h.id];
    render();
  });
}

/* ---------- 図鑑 ---------- */

function mapHTML() {
  const bands = [{ b: "小", n: 6 }, { b: "中", n: 3 }, { b: "外", n: 1 }];
  const h1 = "<tr><th></th>" + bands.map(x => `<th colspan="${x.n}" class="band">${x.b}</th>`).join("") + "</tr>";
  const h2 = "<tr><th></th>" + GRADES.map(g => `<th>${g.l}</th>`).join("") + "</tr>";
  const rows = SUBJECTS.map(sub => {
    const tds = GRADES.map(g => {
      const st = S.cells[sub + "|" + g.k];
      const exists = DB.questions.some(q => q.subject === sub && q.grade === g.k);
      return `<td><div class="cell ${st || (exists ? "" : "none")}"></div></td>`;
    }).join("");
    return `<tr><th class="rowh">${sub}</th>${tds}</tr>`;
  }).join("");
  return `<div class="gridwrap"><table class="map">${h1}${h2}${rows}</table></div>`;
}

const LEGEND = `<div class="legend"><span><i class="sw-st"></i>応用まで</span>
  <span><i class="sw-ok"></i>解けた</span><span><i class="sw-ng"></i>未達</span>
  <span><i class="sw-un"></i>未挑戦</span></div>`;

function vHeroes() {
  const tab = S.heroesTab === "codex" ? "codex" : "own";
  const owned = heroesOwned();

  const ownPanel = `
    <div class="panel">
      <div class="phead"><h2>手持ちの英雄</h2><span class="sub">${owned.length} / ${DB.heroes.length}</span></div>
      <div class="hgrid">${owned.map(h => `
        <button class="hcard" data-h="${h.id}">
          <img src="${assetPath.hero(h.id)}" alt="">
          <span class="hn">${esc(h.name)}</span>
          <span class="hr r${h.rarity}">${esc(h.rarity)}</span>
          <span class="heq ${S.equip[h.id] ? "" : "none"}">${
            S.equip[h.id] ? esc(DB.extensions[S.equip[h.id]].name) : "装備なし"}</span>
        </button>`).join("")}</div>
      <p class="fine">英雄を選ぶとエクステンションを付け替えられます。得意分野と噛み合うと効果が2倍になります。</p>
    </div>
    <div class="panel">
      <div class="phead"><h2>知識カード</h2><span class="sub">${cardCount()}枚</span></div>
      <p class="fine">カードは英雄を解放するための鍵になります。集めた分野が、そのまま挑める相手を決めます。</p>
    </div>
    <div class="panel">
      <div class="phead"><h2>クリスタル</h2>
        <span class="sub">${crystalKinds(S)} / ${(DB.crystals.crystals || []).length}種</span></div>
      ${famStrip()}
      <p class="fine">解いた教科の族から、たまに出会います。出会った鉱物は図鑑に残り、
        族のポイントに変わります。クラフトで払うのはポイントのほうです。</p>
    </div>`;

  const codexPanel = `
    <p class="fine">解放は運ではありません。関係する知識カードを集めるほど、難易度ゲージは最初から削れた状態で始まります。</p>
    <div class="cgrid">${DB.heroes.map(h => {
      const own = S.owned[h.id];
      const g = h.rel ? gaugeBreakdown(DB, S, h) : null;
      const pct = g ? g.percent : 0;
      return `<div class="ccard ${own ? "" : "locked"}">
        <img src="${assetPath.hero(h.id)}" alt="">
        <div class="cn">${own ? esc(h.name) : "？？？"}</div>
        <div class="hr r${h.rarity}">${esc(h.rarity)}</div>
        ${g ? `<div class="cg"><i style="width:${pct}%"></i></div>
          <div class="cgt">${own ? "到達" : ""}${pct}%</div>` : ""}</div>`;
    }).join("")}</div>
    <div class="panel" style="margin-top:20px"><div class="phead"><h2>知識マップ</h2>
      <span class="sub">${cardCount()}枚</span></div>${mapHTML()}${LEGEND}</div>`;

  app.innerHTML = `
  <header><div class="hbar"><div class="place">ヒーロー</div>
    <button class="mapbtn" id="back">もどる</button></div></header>
  <div class="pad">
    <div class="seg" id="htab">
      <button data-t="own" class="${tab === "own" ? "on" : ""}">手持ち<i>${owned.length}</i></button>
      <button data-t="codex" class="${tab === "codex" ? "on" : ""}">図鑑<i>${DB.heroes.length}</i></button>
    </div>
    ${tab === "own" ? ownPanel : codexPanel}
  </div>`;

  document.getElementById("back").onclick = () => go("home");
  app.querySelectorAll("#htab button").forEach(b =>
    b.onclick = () => { S.heroesTab = b.dataset.t; render(); });
  app.querySelectorAll(".hcard").forEach(b =>
    b.onclick = () => { S.heroView = b.dataset.h; go("hero"); });
}

/* ---------- ショップ ---------- */

/**
 * クリスタルをGUMで買う。**品揃えは固定で、安い順。**
 * 日替わりでランダムに並べ替えると「良い品が出るまで待つ」待機が生まれる。
 *
 * どれを買っても GUM あたりの重みは同じなので、選ぶ基準は損得ではなく
 * 「どの鉱物を知りたいか」になる。豆知識は手に入れてから読める。
 */
function vShop() {
  const list = shopList(DB);
  const kinds = crystalKinds(S);
  const value = familyPoints(S, ANY_FAMILY);

  app.innerHTML = `
  <header><div class="hbar"><div class="place">ショップ</div>
    <button class="mapbtn" id="back">もどる</button></div></header>
  <div class="pad">
    <div class="panel">
      <div class="phead"><h2>手持ち</h2><span class="sub">${kinds} / ${list.length}種</span></div>
      <div class="gumbig"><img src="${assetPath.icon("gum")}" alt="GUM">
        <b>${(S.gum || 0).toLocaleString("ja-JP")}</b></div>
      <p class="fine">GUM は解いた問題の難しさに応じて貯まります。</p>
      <div class="fams">${DB.families.map(f => {
        const pt = familyPoints(S, f);
        return `<span class="fam ${pt ? "" : "zero"}" title="${esc(DB.familyToSubject[f] || "")}"
          ><b>${esc(f)}</b>${pt}pt</span>`;
      }).join("")}</div>
      <p class="fine">クラフトは族ごとのポイントで払います（合計 ${value.toLocaleString("ja-JP")}pt
        ・ 1個ぶんの目安は ${CRYSTAL_UNIT}pt）。<b>買った鉱物は図鑑に残り、クラフトでは減りません。</b>
        解いた教科からも、たまに出会います。</p>
    </div>
    <p class="fine">値段は希少度から決まります。<b>どれを買っても、同じ GUM ならクラフトの進み方は同じです。</b>
      選ぶ基準は損得ではなく、どの鉱物を知りたいかです。</p>
    ${list.map(c => {
      const have = S.crystals[c.id] || 0;
      const afford = canBuy(S, c.price);
      return `<div class="shopitem ${have ? "owned" : ""}">
        <img src="${assetPath.crystal(c.id)}" alt="">
        <div class="si">
          <div class="sn">${esc(c.name)}<span class="sen">${esc(c.en)}</span>
            ${have ? `<span class="cnt">×${have}</span>` : ""}</div>
          <div class="ss">${esc(c.family)} ・ 希少度 ${c.scarcity}%</div>
          <div class="sfact ${have ? "" : "hide"}">${have ? esc(c.fact) : "手に入れると、この鉱物の話が読めます"}</div>
        </div>
        <div class="sbuy">
          <span class="sp ${afford ? "" : "short"}"><img src="${assetPath.icon("gum")}" alt="">${c.price.toLocaleString("ja-JP")}</span>
          <button class="mini" data-c="${c.id}" ${afford ? "" : "disabled"}>買う</button>
        </div></div>`;
    }).join("")}
  </div>`;

  document.getElementById("back").onclick = () => go("home");
  app.querySelectorAll(".mini[data-c]").forEach(b => b.onclick = () => {
    const c = list.find(x => x.id === b.dataset.c);
    if (!c || !canBuy(S, c.price)) return;
    S.gum -= c.price;
    takeCrystal(c.id);   // 図鑑に残り、族ポイントに変わる（買っても落ちても同じ扱い）
    S.toast = `<img src="${assetPath.crystal(c.id)}" alt=""><em>${esc(c.name)}</em>`;
    render();
    setTimeout(() => { S.toast = null; drawToast(); }, 1600);
  });
}

/* ---------- マイページ ---------- */

function vMypage() {
  const tab = ["name", "icon", "title"].includes(S.myTab) ? S.myTab : "name";
  const p = S.profile;
  const owned = heroesOwned();
  const titles = titleProgress(DB, S);
  const got = titles.filter(t => t.done).length;

  const panels = {
    name: `
      <div class="panel">
        <div class="phead"><h2>ユーザー名</h2><span class="sub">${NAME_MAX}文字まで</span></div>
        <div class="answer"><input id="nameinput" type="text" maxlength="${NAME_MAX}"
          value="${esc(p.name || "")}" placeholder="旅人" autocomplete="off"></div>
        <button class="btn" id="savename">この名前にする</button>
      </div>`,
    icon: `
      <div class="panel">
        <div class="phead"><h2>ユーザーアイコン</h2><span class="sub">手持ちの英雄から</span></div>
        <div class="hgrid">${owned.map(h => `
          <button class="hcard ${p.icon === h.id ? "on" : ""}" data-i="${h.id}">
            <img src="${assetPath.hero(h.id)}" alt="">
            <span class="hn">${esc(h.name)}</span></button>`).join("")}</div>
        <p class="fine">解放した英雄が増えるほど、選べる顔も増えます。</p>
      </div>`,
    title: `
      <div class="panel">
        <div class="phead"><h2>称号</h2><span class="sub">${got} / ${titles.length}</span></div>
        <div class="eqlist">
          <button class="eqi ${p.title ? "" : "on"}" data-t="">称号なし</button>
          ${titles.map(t => `
            <button class="eqi ${p.title === t.name ? "on" : ""} ${t.done ? "" : "lock"}"
              data-t="${esc(t.name)}" ${t.done ? "" : "disabled"}>
              <span class="tkind">${esc(t.kind)}</span>
              <span class="tname">${t.done ? esc(t.name) : "？？？"}</span>
              <span class="tneed">${esc(t.need)}<b>${t.have} / ${t.goal}</b></span>
            </button>`).join("")}
        </div>
        <p class="fine">称号は集めた量よりも、どこまで越えたかで付きます。</p>
      </div>`,
  };

  app.innerHTML = `
  <header><div class="hbar"><div class="place">マイページ</div>
    <button class="mapbtn" id="back">もどる</button></div></header>
  <div class="pad">
    <div class="myhead">
      <img src="${assetPath.hero(p.icon || "10001")}" alt="">
      <div>
        <div class="st-title ${p.title ? "" : "none"}">${p.title ? esc(p.title) : "称号なし"}</div>
        <div class="myname">${esc(p.name || "旅人")}</div>
      </div>
    </div>
    <div class="seg" id="mytab">
      <button data-t="name" class="${tab === "name" ? "on" : ""}">名前</button>
      <button data-t="icon" class="${tab === "icon" ? "on" : ""}">アイコン</button>
      <button data-t="title" class="${tab === "title" ? "on" : ""}">称号<i>${got}</i></button>
    </div>
    ${panels[tab]}
  </div>`;

  document.getElementById("back").onclick = () => go("home");
  app.querySelectorAll("#mytab button").forEach(b =>
    b.onclick = () => { S.myTab = b.dataset.t; render(); });

  const save = document.getElementById("savename");
  if (save) {
    const input = document.getElementById("nameinput");
    const commit = () => {
      const name = capName(input.value.trim());
      S.profile.name = name || "旅人";
      S.toast = `<span class="seal">✓</span><em>${esc(S.profile.name)}</em>`;
      render();
      setTimeout(() => { S.toast = null; drawToast(); }, 1400);
    };
    save.onclick = commit;
    input.onkeydown = e => { if (e.key === "Enter") commit(); };
  }
  app.querySelectorAll(".hcard[data-i]").forEach(b =>
    b.onclick = () => { S.profile.icon = b.dataset.i; render(); });
  app.querySelectorAll(".eqi[data-t]").forEach(b =>
    b.onclick = () => { S.profile.title = b.dataset.t || null; render(); });
}

/* ---------- カレンダー ---------- */

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const dayLabel = k => {
  const [y, m, d] = k.split("-").map(Number);
  return `${y}年${m}月${d}日（${WEEKDAYS[new Date(y, m - 1, d).getDay()]}）`;
};

function openCalendar() {
  const now = new Date();
  S.calendar = S.calendar || { year: now.getFullYear(), month: now.getMonth() + 1 };
  go("calendar");
}

function vCalendar() {
  const { year, month } = S.calendar;
  const today = dayKey();
  const weeks = monthGrid(year, month);
  const played = weeks.flat().filter(c => c.inMonth && S.days[c.key]).length;

  app.innerHTML = `
  <header><div class="hbar"><div class="place">カレンダー</div>
    <button class="mapbtn" id="back">もどる</button></div></header>
  <div class="pad">
    <div class="calhead">
      <button class="calnav" id="prevmonth" aria-label="前の月">‹</button>
      <div class="calmonth">${year}年${month}月<span>${played}日</span></div>
      <button class="calnav" id="nextmonth" aria-label="次の月">›</button>
    </div>
    <table class="calgrid">
      <tr>${WEEKDAYS.map((w, n) =>
        `<th class="${n === 0 ? "sun" : n === 6 ? "sat" : ""}">${w}</th>`).join("")}</tr>
      ${weeks.map(row => `<tr>${row.map(c => {
        const rec = c.inMonth ? S.days[c.key] : null;
        if (!c.inMonth) return `<td><div class="cald out"></div></td>`;
        return `<td><button class="cald ${rec ? "on" : ""} ${c.key === today ? "today" : ""}"
          data-k="${c.key}" ${rec ? "" : "disabled"}>
          <span class="cn">${c.day}</span>
          ${rec ? `<img src="${assetPath.icon("mch_icon")}" alt="解いた日">` : ""}
        </button></td>`;
      }).join("")}</tr>`).join("")}
    </table>
    <p class="fine">解いた日にスタンプが押されます。<b>連続日数のボーナスもペナルティもありません。</b>
      途切れても、次に開いたときの出題は何も変わりません。</p>
    ${played ? `<p class="cue">スタンプの日を選ぶと、その日の成績と解説を読み返せます。</p>`
             : `<p class="empty">この月はまだ記録がありません。</p>`}
  </div>`;

  document.getElementById("back").onclick = () => go("home");
  document.getElementById("prevmonth").onclick = () => { S.calendar = shiftMonth(year, month, -1); render(); };
  document.getElementById("nextmonth").onclick = () => { S.calendar = shiftMonth(year, month, 1); render(); };
  app.querySelectorAll(".cald[data-k]").forEach(b =>
    b.onclick = () => { S.dayView = b.dataset.k; go("day"); });
}

/* その日に解いた問題を読み返す。再挑戦もできるが、報酬は出ない */
function vDay() {
  const k = S.dayView, rec = S.days[k];
  if (!rec) return go("calendar");
  const ids = Object.keys(rec.results).filter(id => DB.byId[id]);
  const answered = rec.right + rec.wrong;
  const rate = answered ? Math.round(rec.right / answered * 100) : 0;

  app.innerHTML = `
  <header><div class="hbar"><div class="place">${dayLabel(k)}</div>
    <button class="mapbtn" id="back">もどる</button></div></header>
  <div class="pad">
    <div class="stat" style="margin-top:20px">
      <div><b>${rec.right}</b><span>解けた</span></div>
      <div><b>${rec.appliedRight}</b><span>応用も突破</span></div>
      <div><b>${rate}<small style="font-size:15px">%</small></b><span>正答率</span></div>
      <div><b>${rec.runs}</b><span>セッション</span></div>
      ${rec.gum ? `<div><b>${rec.gum}</b><span>GUM</span></div>` : ""}
    </div>
    ${ids.length ? `<div class="stack" style="margin-top:18px">
      <button class="btn ghost" id="replay">この日の${ids.length}問をもう一度解く</button></div>
      <p class="fine">再挑戦ではクリスタルも知識カードも増えません。記録も変わりません。読み返すためのものです。</p>` : ""}
    ${ids.map(id => {
      const q = DB.byId[id], ok = rec.results[id] === "ok";
      return `<div class="panel">
        <div class="phead"><h2>${esc(q.subject)} ・ ${esc(q.gradeLabel)}</h2>
          <span class="sub ${ok ? "ok" : "ng"}">${ok ? "解けた" : "面白い単元"}</span></div>
        <p class="dq">${esc(q.prompt)}</p>
        <p class="da">答え ・ <b>${esc(answerText(q))}${q.format === "range" ? "年" : ""}</b></p>
        <p class="extt">${esc(q.lesson)}</p>
      </div>`;
    }).join("")}
  </div>`;

  document.getElementById("back").onclick = () => go("calendar");
  const r = document.getElementById("replay");
  if (r) r.onclick = () => startRun({ ids, noReward: true });
}

/* ---------- 知識マップ ---------- */

/**
 * 知識マップだけの画面。ホームのチップから1タップで開く。
 * **ここに報酬の数字は出しません。** 出すのは、どこが埋まっていてどこが空いているかだけ。
 */
function vMap() {
  const mp = mapProgress();
  const blanks = SUBJECTS.filter(sub => GRADES.some(g =>
    DB.questions.some(q => q.subject === sub && q.grade === g.k) &&
    !S.cells[sub + "|" + g.k]));

  app.innerHTML = `
  <header><div class="hbar"><div class="place">知識マップ</div>
    <button class="mapbtn" id="back">もどる</button></div></header>
  <div class="pad">
    <div class="title-wrap"><h1>どこまで来たか</h1><div class="rule"></div>
      <p class="fine">解いたマスが埋まります。<b>${mp.done} / ${mp.total}マス</b>
        ・ 知識カード ${cardCount()}枚</p></div>
    <div class="panel">${mapHTML()}${LEGEND}</div>
    ${blanks.length ? `<p class="cue">まだ空いているマスが残っているのは
      ${blanks.map(esc).join("・")}です。</p>`
      : `<p class="cue">すべてのマスに一度は手が届きました。</p>`}
    <div class="stack">
      <button class="btn" id="toquiz2">${RUN_LENGTH}問を解く</button>
      <button class="btn ghost" id="home3">ホームへ</button></div>
  </div>`;
  document.getElementById("back").onclick = () => go("home");
  document.getElementById("home3").onclick = () => go("home");
  document.getElementById("toquiz2").onclick = () => go("select");
}

/* ---------- 挑戦先を選ぶ ---------- */

function vTarget() {
  const locked = lockedHeroes(DB, S);
  const here = locked[S.stage.i]?.id;

  app.innerHTML = `
  <header><div class="hbar"><div class="place">どの英雄に挑むか</div>
    <button class="mapbtn" id="back">もどる</button></div></header>
  <div class="pad">
    <p class="fine" style="margin-top:16px">到達度を上げるのは知識カードです。直結するカードの網羅率と、関連分野の網羅率で決まります。エクステンションはそれを何倍にするかだけを変えます。</p>
    ${locked.map(h => {
      const g = h.rel ? gaugeBreakdown(DB, S, h) : null;
      const pct = g ? g.percent : 0;
      const top = g && g.rows.length ? g.rows.map(r => `${r.label} ${signed(r.value)}`).join(" ・ ")
                                     : "この英雄に関わる知識をまだ持っていません";
      return `<button class="trow ${h.id === here ? "on" : ""}" data-h="${h.id}">
        <img src="${assetPath.hero(h.id)}" alt="">
        <span class="ti">
          <span class="tn">${esc(h.name)}<span class="hr r${h.rarity}">${esc(h.rarity)}</span></span>
          <span class="tg"><i style="width:${pct}%"></i></span>
          <span class="tp">いまの知識での到達度 ${pct}%<span class="tf">難度係数 ${g ? g.factor : 1}</span></span>
          <span class="ts">${esc(top)}</span>
        </span></button>`;
    }).join("")}
    ${locked.length ? "" : `<p class="empty">挑める英雄はもういません。</p>`}
    <p class="cue">削りきれていなくても挑めます。負けても、その英雄にまつわる知識は残ります。</p>
  </div>`;

  document.getElementById("back").onclick = () => go("home");
  app.querySelectorAll(".trow").forEach(b => b.onclick = () => startChallenge(b.dataset.h));
}

/* ---------- チャレンジ ---------- */

function startChallenge(id) {
  S.challenge = { heroId: id, phase: "intro", breakdown: gaugeBreakdown(DB, S, DB.heroById[id]),
                  reach: 0, tries: 0, done: false, message: "",
                  qi: 0, results: [], gotCard: null };
  go("challenge");
}

/**
 * 3問中いくつ当てたかで解放を決める。1問1答だと、たまたま知っていた1問で
 * 解放されてしまう。必要正答数はレアリティで変える（Common 1、Rare 2、Legendary 3）。
 */
function finishChallenge() {
  const c = S.challenge, h = DB.heroById[c.heroId];
  const right = c.results.filter(Boolean).length;
  c.done = true;
  c.won = right >= challengeNeed(h);
  if (c.won) S.owned[h.id] = 1;

  // 挑んだ以上は、その人物にまつわる知識カードを1枚持って帰る。
  // 負けるほど次が有利になる。プールはこの英雄の関連カードだけなので、
  // 挑み続けても無限には増えない
  const card = challengeCard(h, S);
  if (card) { S.cards[card] = true; c.gotCard = card; }
  render();
}

function vChallenge() {
  const c = S.challenge, h = DB.heroById[c.heroId], b = c.breakdown;
  const stage = challengeStage(c.reach);
  const need = challengeNeed(h);
  const qs = h.ch.qs;
  const q = qs[Math.min(c.qi, qs.length - 1)];
  const right = c.results.filter(Boolean).length;

  app.innerHTML = `
  <header><div class="hbar"><div class="place">チャレンジ ・ ${esc(h.name)}</div>
    <button class="mapbtn" id="back">${c.done ? "もどる" : "やめる"}</button></div></header>
  <div class="pad">
    <div class="battle">
      <img class="bhero ${c.won ? "won" : ""}" src="${assetPath.hero(h.id)}" alt="">
      <div class="bmeta"><div class="bn">${esc(h.name)}</div>
        <div class="hr r${h.rarity}">${esc(h.rarity)}</div></div>
      <div class="gauge"><i style="width:${Math.round(c.reach * 100)}%"></i>
        <span>到達度 ${Math.round(c.reach * 100)}%</span></div>
      <div class="glabel">${esc(STAGE_LABELS[stage])}</div>
      ${c.phase !== "intro" ? `<div class="chprog">${qs.map((_, i) => {
        const r = c.results[i];
        return `<i class="${r === true ? "ok" : r === false ? "ng" : i === c.qi && !c.done ? "now" : ""}"></i>`;
      }).join("")}<span>${CHALLENGE_QUESTIONS}問中 ${need}問で解放</span></div>` : ""}
    </div>

    ${c.phase === "intro" ? `
      <div class="panel"><div class="phead"><h2>持っている知識で届く</h2>
        <span class="sub">${CHALLENGE_QUESTIONS}問中 ${need}問</span></div>
        ${b.rows.length ? b.rows.map(r => `<div class="brow"><div>
            <div class="bt">${esc(r.label)}</div><div class="bs">${esc(r.detail)}</div></div>
          <div class="bv ${r.value < 0 ? "back" : ""}">${signed(r.value)}</div></div>`).join("")
          : `<p class="empty">この英雄に関わる知識をまだ持っていません。まずは問題を解いてください。</p>`}
        <div class="btotal">到達度 ${b.percent}% <span class="bhp">${esc(h.rarity)}の難度係数 ${b.factor}</span></div></div>
      <p class="fine">ゲージが削れているほど、問い方がやさしくなります。<b>どれだけ削れても、
        その人物を知らないと答えられないことは変わりません。</b></p>
      <div class="stack"><button class="btn" id="fight">挑む</button></div>`

    : c.done ? `
      <div class="lesson"><div class="speaker"><img class="ava sm" src="${assetPath.hero(h.id)}" alt="">
        <span>${esc(h.name)}</span></div>
        <p>${esc(c.won ? h.flavor : "その距離まで来ている。あとは、私という人間をもう少し知ればよい。")}</p>
        <div class="gain"><span class="seal">${c.won ? "✓" : "・"}</span>
          <span>${CHALLENGE_QUESTIONS}問中 <em>${right}問</em> 正解 ・ 解放には${need}問</span></div>
        ${c.won ? `<div class="gain"><span class="seal">✓</span>
          <span>解放 ・ <em>${esc(h.name)}</em></span></div>` : ""}
        ${c.won && h.unlocks != null ? `<div class="gain alt"><span class="seal">＋</span>
          <span>新しい出題範囲が開きました</span></div>` : ""}
        ${c.gotCard ? `<div class="gain alt"><span class="seal">＋</span>
          <span>知識カード ・ <em>${esc(c.gotCard)}</em></span></div>` : ""}</div>
      ${c.won ? "" : `<p class="cue">負けても、いま受け取った知識カードのぶんだけ次はゲージが削れた状態から始まります。</p>`}
      <div class="stack">
        ${c.won ? `<button class="btn" id="done">図鑑を見る</button>`
                : `<button class="btn" id="retry">もう一度挑む</button>`}
        <button class="btn ghost" id="home2">ホームへ</button></div>`

    : `
      <div class="qmeta"><span class="grade">${c.qi + 1}問目</span>
        <span class="unit">${esc(STAGE_LABELS[stage])}</span></div>
      <div class="qtext ch">${esc(challengePrompt(q, stage))}</div>
      <div class="answer">
        <input id="ans" type="text" placeholder="答えを入力（ひらがなでも可）" autocomplete="off">
        <button class="btn" id="submit">答える</button>
        ${c.message ? `<div class="chmsg">${esc(c.message)}</div>` : ""}
        <p class="fine">分からなければ空のまま答えても構いません。次の問いへ進みます。</p>
      </div>`}
  </div>`;

  document.getElementById("back").onclick = () => go(c.done ? "home" : "target");
  const f = document.getElementById("fight");
  if (f) f.onclick = animateGauge;

  const submit = document.getElementById("submit");
  if (submit) {
    const input = document.getElementById("ans");
    const send = () => {
      const ok = matches(input.value, q.ans);
      c.results[c.qi] = ok;
      c.message = "";
      if (!ok) c.tries++;
      c.qi++;
      if (c.qi >= qs.length) finishChallenge();
      else render();
    };
    submit.onclick = send;
    input.onkeydown = e => { if (e.key === "Enter") send(); };
    input.focus();
  }

  const rt = document.getElementById("retry");
  if (rt) rt.onclick = () => startChallenge(h.id);
  const d = document.getElementById("done");
  if (d) d.onclick = () => { S.heroesTab = "codex"; go("heroes"); };
  const hm = document.getElementById("home2"); if (hm) hm.onclick = () => go("home");
}

function animateGauge() {
  const c = S.challenge, target = c.breakdown.reach;
  c.phase = "fight";
  const bar = document.querySelector(".gauge i");
  const text = document.querySelector(".gauge span");
  const label = document.querySelector(".glabel");
  const stack = document.querySelector(".stack");
  if (stack) stack.innerHTML = "";
  let d = 0;
  const step = () => {
    d = Math.min(target, d + Math.max(0.01, target / 26));
    if (bar) {
      bar.style.width = Math.round(d * 100) + "%";
      text.textContent = `到達度 ${Math.round(d * 100)}%`;
      label.textContent = STAGE_LABELS[challengeStage(d)];
    }
    if (d < target) requestAnimationFrame(step);
    else { c.reach = target; setTimeout(render, 420); }
  };
  requestAnimationFrame(step);
}
