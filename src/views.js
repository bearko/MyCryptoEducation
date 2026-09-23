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
         subjectGrade, subjectLabel, drawSubjects, enemyOf,
         heroHit, heroMaxHp, foeMaxHp, foeHit, battleBonus, ATTACK_RATE,
         skillChance, skillHit, skillName,
         CRYSTAL_UNIT, craftCheck,
         rangeWidth, scoreRange, RANGE_BONUS_SCORE,
         challengeNeed, challengePrompt, challengeCard,
         CHALLENGE_QUESTIONS } from "./engine.js";
import { FACTIONS, affinity, affinityMark } from "./faction.js";
import { timeLimit, judge, asCount, JUDGES, chainNext, chainBonus, CHAIN_MAX_SHOWN,
         DECK_SIZE, costOf, deckCost, deckCap, overCost, costFactor,
         coverageOf, heroPower, asDamage, asFires, onceOnly,
         ssNeed, ssReady, SS_POWER, foeFaction, BOSS_HP } from "./battle.js";
import { matches } from "./normalize.js";
import { assetPath, RANK_ORDER } from "./data.js";
import { answerText, hintGroup, hintsFor, numericParts, sameNumber,
         CUT_SCORE, cutScore } from "./answer-mode.js";
import { saveState, capName, NAME_MAX, STARTER_DECK } from "./state.js";

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
/**
 * **初回だけ、どの学年から始めるかを聞きます**（S-31）。
 *
 * 決定1（無説明の初回起動）をひとつだけゆるめた画面です。**聞くのは1つ、
 * 答えるのは1タップ**で、説明も遊び方も置きません。大人が小1から
 * 駆け上がるのがこのゲームの入口ですが、**そこを選べないと「自分の話では
 * ない」と感じる人がいます**（自律性・原則7）。
 *
 * 選んだ学年は `S.startGrade` に入り、**梯子の下端**になります
 * （`engine.subjectGrade`）。進行そのものは知識マップのままです。
 */
function vGrade() {
  const pick = GRADES.filter(g => g.band !== "w");
  app.innerHTML = `
  <div class="gp">
    <h1>何年生から始める?</h1>
    <div class="gp-grid">
      ${pick.map(g => `<button class="gp-btn" data-g="${g.k}">
        <b>${g.band === "e" ? "小学" : "中学"}</b><em>${g.l}</em><i>年</i></button>`).join("")}
    </div>
  </div>`;
  app.querySelectorAll(".gp-btn").forEach(b => b.onclick = () => {
    S.startGrade = b.dataset.g;
    saveState(S);
    beginIntro();
  });
}

function startIntro() {
  /* **学年を聞いてから始めます。** 聞くのはここ1回だけです */
  if (!S.startGrade) { S.view = "grade"; return render(); }
  beginIntro();
}

function beginIntro() {
  const from = S.startGrade || "e1";
  const first = DB.questions.filter(q => q.grade === from && questionOpen(S, q));
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
    /* 必殺技は、下に何があっても見た目がそちらに変わるので別の番号にする */
    if (document.querySelector(".skcut")) return "S-33";
    if (S.run.skill === "offer") return "S-32";
    /* ポップアップは、下の画面が何であれ見た目がそれに変わるので別の番号にする */
    if (S.run.ssOpen) return "S-34";
    if (S.run.hintOpen) return "S-27";
    if (S.run.settingOpen) return "S-28";
    if (S.run.applied) return "S-12";
    if (q && S.run.results[q.id] !== undefined) return S.run.battle ? "S-26" : "S-11";
    if (S.run.intro) return "S-01";
    return { choice: "S-05", elimination: "S-06", panel: "S-07",
             numeric: "S-08", range: "S-09", swipe: "S-10" }[q ? modeOf(q) : "choice"] || "S-05";
  }
  if (v === "grade") return "S-31";
  if (v === "wave") return S.run.gate?.kind === "end" ? "S-30" : "S-29";
  if (v === "result") return S.run.swipe ? "S-13" : "S-14";
  if (v === "heroes") return S.heroesTab === "codex" ? "S-16" : "S-15";
  /* 教科を選ぶ前と後は、見た目が別物なので別の番号にする */
  if (v === "select") return S.select.picks?.includes(S.select.subject) ? "S-25" : "S-04";
  return { home: "S-02", map: "S-03", hero: "S-17", target: "S-18",
           challenge: "S-19", craft: "S-20", shop: "S-21", calendar: "S-22",
           day: "S-23", mypage: "S-24",
           deck: "S-35", deckpick: "S-36", deckext: "S-37" }[v] || "S-??";
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

  ({ home: vHome, grade: vGrade, select: vSelect, quiz: vQuiz, wave: vWave, result: vResult, craft: vCraft,
     heroes: vHeroes, hero: vHero, target: vTarget, challenge: vChallenge,
     calendar: vCalendar, day: vDay, mypage: vMypage, shop: vShop, map: vMap,
     deck: vDeck, deckpick: vDeckPick, deckext: vDeckExt }[S.view])();
  /* **持ち時間の時計は、出題の画面にしか置きません。** 画面を離れたら必ず止めます
     （止め忘れると、ホームに戻ったあとに時間切れが走ります） */
  if (S.view !== "quiz") clearClock();
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
    <!-- **デッキ5枚。押すと編成へ。** 上の行（知識マップ）と下の行（コスト上限）が
         同じ理由で動くので、2つが並んでいることに意味があります -->
    <button class="deckstrip${deckOver() ? " over" : ""}" id="todeck" aria-label="デッキ編成">
      ${deckHeroes().map(h => h
        ? `<span class="ds-face"><img src="${assetPath.hero(h.id)}" alt="">
             <i class="fac ${facCls(h.faction)}"></i></span>`
        : `<span class="ds-face empty"></span>`).join("")}
      <b>${deckCostNow()} / ${deckCapNow()}</b>
    </button>
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
  document.getElementById("todeck").onclick = () => go("deck");
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

/**
 * **出題を選ぶ**（S-04）。
 *
 * 作り直しの柱は3つです。
 *
 * 1. **文字で説明しない。** 段の上がり方も束の組み方も、遊んでいれば分かります。
 *    説明を並べるほど、読まずに飛ばす人が増えます
 * 2. **選択肢を増やさない。** 6教科ぜんぶ並べると、選ぶだけで疲れます。
 *    **毎回くじで3教科**だけ出します
 * 3. **スクロールさせない。** 1画面に収めます
 *
 * 範囲（小学校/中学校/世界）の選択は外しました。**学年は教科ごとに決まります** ——
 * 知識マップでまだ埋まっていない一番下の学年です（`engine.subjectGrade`）。
 * 海外の問題は、その教科を中3まで埋めた人のところへ自然に来ます。
 */
function vSelect() {
  /* くじは引いたら覚えておく。**ホームへ戻って入り直しても引き直しません** ——
     引き直せると、欲しい教科が出るまで往復することになります */
  if (!S.select.picks?.length) {
    S.select.picks = drawSubjects(DB, S);
    S.select.seed = Math.floor(Math.random() * 1e9);
    if (!S.select.picks.includes(S.select.subject)) S.select.subject = "auto";
  }
  const picks = S.select.picks;
  const chosen = picks.includes(S.select.subject) ? S.select.subject : null;
  const art = k => DB.subjectArt[k] || {};
  const bg = chosen ? art(chosen).bg : DB.defaultBg;

  /* **予告と実物を同じものにします。** ここで planRun を呼び直すと、描き直すたびに
     形式が変わって、出発した先が予告と食い違います。教科を選んだ時点で1度だけ
     引いて、それをそのまま出発に渡します */
  if (chosen && S.select.run?.subject !== chosen)
    S.select.run = { subject: chosen, ...planRun(DB, S, { band: "auto", subject: chosen }) };
  const plan = chosen ? (S.select.run.plan || []) : [];

  const naviSay = chosen
    ? `今日の${subjectLabel(DB.subjects, chosen, subjectGrade(DB, S, chosen)?.k)}はこの3つ！ 札をおすと、くわしく出るよ。`
    : "Guten Tag! 今日もジャンジャン問題解いていこう！";

  app.innerHTML = `
  <div class="sel-bg" style="background-image:url('${assetPath.bg(bg)}')"></div>
  <div class="sel">
    <header><div class="hbar"><div class="place">出題を選ぶ</div>
      <button class="mapbtn" id="back">もどる</button></div></header>

    <!-- 右側は**知識カード**の枚数。解いた数だけ確実に入る唯一のもので、
         難易度ゲージを削るのもこれです（原則1・原則3）。GUM は行動量の副産物、
         クリスタルは抽選なので、「倒したら必ずこれ」とは書けません -->
    <!-- **敵の属性をここで出します。** これがデッキを選ぶ理由になります。
         数字（1.5倍）は出さず、▲●▼ の記号だけ —— 一目で読めるほうを取ります。
         **持ち時間も形式ごとに違う**ので、行く前に見せます -->
    <div class="sel-modes">${plan.map((seg, wi) => {
      const e = enemyOf(DB.subjects, chosen, seg.mode, S.select.seed);
      const ff = foeFaction(e);
      const lead = deckHeroes().find(Boolean);
      const boss = plan.length > 1 && wi === plan.length - 1;
      return `<button class="mcard" data-m="${esc(seg.mode)}">
        <span class="mfoe">${e ? `<img src="${assetPath.enemy(e)}" alt="">` : ""}
          <i class="fac ${facCls(ff)}">${esc(ff)}${lead ? affinityMark(lead.faction, ff) : ""}</i>
          ${boss ? `<u>BOSS</u>` : ""}</span>
        <span class="mname"><b>${esc(MODE_LABEL[seg.mode] || seg.mode)}</b>
          <i>Lv.${modeLevel(S, seg.mode)} ・ ${timeLimit(seg.mode)}秒</i></span>
        <span class="mprize"><b>${seg.n}</b><i>カード</i></span>
      </button>`;
    }).join("")}</div>

    <div class="sel-navi">
      <p class="navi-say" id="navisay">${esc(naviSay)}</p>
      <img class="navi" src="${assetPath.navi("navi_ain_11_idle")}" alt="マインちゃん">
    </div>

    <div class="sel-subs">${picks.map(k => {
      const g = subjectGrade(DB, S, k);
      const on = chosen === k;
      return `<button class="scard${on ? " on" : ""}" data-k="${esc(k)}"
        style="background-image:url('${assetPath.bg(art(k).bg)}')">
        <img class="shero" src="${assetPath.hero(art(k).hero)}" alt="">
        <span class="sname">${esc(subjectLabel(DB.subjects, k, g?.k))}</span>
        <span class="sgrade">${g ? esc(gradeLabelOf(g)) : "—"}</span>
      </button>`;
    }).join("")}</div>

    <button class="btn go" id="start" ${chosen ? "" : "disabled"}>出発</button>
  </div>`;

  document.getElementById("back").onclick = () => go("home");
  app.querySelectorAll(".scard").forEach(b =>
    b.onclick = () => { S.select.subject = b.dataset.k; render(); });
  /* 形式の札を押すと、マインちゃんがその形式を説明する。
     **文字は最初から並べません** —— 知りたい人が押したときだけ出します */
  app.querySelectorAll(".mcard").forEach(b =>
    b.onclick = () => {
      const say = document.getElementById("navisay");
      if (say) say.textContent = MODE_SAY[b.dataset.m] || "";
    });
  document.getElementById("start").onclick = () => {
    if (!chosen) return;
    const built = S.select.run;
    S.select.picks = null;          // 出発したら引き直す
    S.select.run = null;
    startRun({ built });
  };
}

/** 学年の見出し。知識マップと同じ言い方にそろえる */
const gradeLabelOf = g => g.band === "e" ? `小${g.l}` : g.band === "j" ? `中${g.l}` : "世界";

/** 形式の札を押したときに、マインちゃんが言うこと。**押すまで出しません** */
const MODE_SAY = {
  swipe: "しゃしんを見て、正しいと思うほうへカードをはらってね。とちゅうで手をはなせばもどせるよ。",
  choice: "4つのうち、正しいものを1つえらんでね。",
  elimination: "ちがうものを ✕ で消していくよ。深く消すほど点は大きいけど、正解を消すとそこで終わり。",
  numeric: "数字だけを打ってね。たんいは出してあるから、打たなくていいよ。",
  range: "年を「から」「まで」のはばで答えてね。せまく当てるほど高い点になるよ。",
  panel: "マスをなぞって読みを作ってね。ななめにもたどれるよ。",
};

function startRun(opts = {}) {
  const swipe = !!opts.swipe;
  /* **引いてあるものがあれば、それを使います。** 出題を選ぶ画面は、
     予告した形式のまま出発させるために、引いた結果をそのまま渡してきます */
  const built = opts.built ? opts.built
              : opts.ids ? { ids: opts.ids, plan: [] }
              : planRun(DB, S, swipe ? { kind: "swipe" } : {});
  const ids = built.ids;
  S.run = { ids, i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null,
            right: 0, wrong: 0, appliedRight: 0,
            // 束の数ぶんそろわなかったときだけ「在庫が足りない」と言う
            shortage: opts.ids || built.plan.length >= BLOCKS || swipe ? 0 : 1,
            gum: 0, found: [], results: {}, noReward: !!opts.noReward, done: false, hard: {},
            cut: null, intro: !!opts.intro, swipe, plan: built.plan, verdict: null,
            hintOpen: false, gate: null, mark: null, skill: null,
            waves: [], countedKills: 0, battle: null, settingOpen: false };
  /* 初回起動は問題と解答だけにするので、バトルを立てません（決定1） */
  if (!opts.intro && ids.length) startBattle();
  /* **束があるときだけ、接敵の画面から始めます。** ID を名指しで渡す道
     （記録からの再挑戦・由来をたずねる・検査）は1問だけのことが多く、
     そこに wave の演出を挟むと、聞きたい1問にたどり着くのが遠くなります */
  if (gated()) { gateStart(0); render(); } else go("quiz");
}

/** wave の演出を挟むかどうか。**束が組めているときだけです** */
const gated = () => (S.run.plan || []).filter(b => b.n > 0).length > 0 && !S.run.intro;

/**
 * 接敵の画面をひらく。
 *
 * **ここで成績の目印を取ります。** wave ごとの「解けた・応用も突破・正答率・
 * GUM・クリスタル」は、束の始めと終わりの差で出します（別に数えると、
 * 4択への降り方や再挑戦でセッション全体とズレます）。
 */
function gateStart(index) {
  S.run.gate = { kind: "start", wave: index };
  S.run.mark = { right: S.run.right, wrong: S.run.wrong,
                 appliedRight: S.run.appliedRight, gum: S.run.gum,
                 found: (S.run.found || []).length };
  S.view = "wave";
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
  /* **倒したぶんの上乗せ。** 1問ごとの GUM・知識カード・クリスタルは
     倒せていても倒せていなくても同じで、動くのはここだけです。
     ヒーローが倒れているあいだは敵を削れないので、この上乗せだけが取れません */
  const waves = S.run.waves || [];
  const kills = waves.reduce((a, w) => a + w.kills, 0);
  const cleared = waves.filter(w => w.cleared).length;
  const bonus = battleBonus(kills, false);
  bonus.gum += cleared * (battleBonus(0, true).gum);
  bonus.score += cleared * (battleBonus(0, true).score);
  S.run.battleBonus = { kills, cleared, ...bonus };
  if (bonus.gum) { S.gum += bonus.gum; S.run.gum += bonus.gum; }
  if (bonus.score) S.score += bonus.score;

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


/* ---------- デッキ（5枚編成） ---------- */

/**
 * **デッキは5枚。左が先で、右ほどASが落ちます。**
 *
 * 黒ウィズの芯をそのまま写した形です。速く答えるほど右まで届くので、
 * **並び順を決めることが「どれだけ速く答えるつもりか」の宣言**になります。
 */
const deckHeroes = () => (S.deck || []).slice(0, DECK_SIZE).map(id => DB.crewById[id] || null);
const crewOwned = () => DB.crew.filter(h => S.crew?.[h.id]);

/** 教科ごとに、いま何枚の知識カードを持っているか */
function haveBySubject() {
  const out = {};
  const seen = new Set();
  Object.keys(S.cards || {}).forEach(c => {
    const base = c.replace("（応用）", "");
    if (seen.has(base)) return;
    seen.add(base);
    const sub = DB.cardSubject[base];
    if (sub) out[sub] = (out[sub] || 0) + 1;
  });
  return out;
}

/**
 * そのヒーローの**知識倍率**（0.5〜2.0倍）。縁のある教科の網羅率で決まります。
 * **ここが原則1の入口です** —— レベルも進化も無いので、攻撃力を動かす手段は
 * 「解くこと」しかありません。
 */
const coverageFor = (hero, have = haveBySubject()) => coverageOf(hero, have, DB.cardTotal);

const deckCapNow = () => deckCap(mapProgress().done);
const deckCostNow = () => deckCost(deckHeroes());
const deckOver = () => overCost(deckCostNow(), deckCapNow());

/** そのヒーローが仲間になるのに要る枚数。**割合なので、DBが増えても置いていかれません** */
const unlockNeed = hero => hero?.unlock
  ? Math.max(1, Math.ceil((DB.cardTotal[hero.unlock.subject] || 0) * hero.unlock.rate)) : 0;

/**
 * **解くとヒーローが仲間になります。ガチャは引きません**（原則2）。
 * その教科の知識カードが規定の割合に届いた時点で、確定で加わります。
 */
function crewJoin() {
  const have = haveBySubject();
  const joined = [];
  DB.crew.forEach(h => {
    if (S.crew?.[h.id]) return;
    if (h.unlock && (have[h.unlock.subject] || 0) < unlockNeed(h)) return;
    (S.crew ||= {})[h.id] = 1;
    joined.push(h);
  });
  return joined;
}

/* ---------- 持ち時間の時計 ---------- */

/**
 * **持ち時間は形式ごとです**（`battle.timeLimit`）。スワイプ8秒・4択11秒・
 * 文字パネル22秒。その中の速さで、発動するASの本数が変わります。
 *
 * **報酬は速さで変わりません**（原則3-2）。GUM も知識カードもクリスタルも、
 * 遅く答えても1つも減りません。変わるのは敵に与えるダメージだけです。
 *
 * **時計を止める場所が3つあります** —— ヒント・設定・SSのポップアップ。
 * 原則5で渡した道具を使うと罰される、という形にしないためです。
 */
let qTimer = null;

function clearClock() {
  if (qTimer) { clearTimeout(qTimer); qTimer = null; }
}

const clockSec = () => timeLimit(S.run.clockMode || "choice");

function armClock(mode) {
  clearClock();
  if (S.run.intro) return;          // 初回起動には持ち時間を置かない（決定1）
  S.run.clockMode = mode;
  S.run.qStart = Date.now();
  S.run.qPaused = 0;
  S.run.qPauseAt = 0;
  qTimer = setTimeout(timeUp, timeLimit(mode) * 1000);
}

/** いま何ミリ秒たったか。止めているあいだは進みません */
function elapsedMs() {
  if (!S.run.qStart) return 0;
  const held = S.run.qPaused + (S.run.qPauseAt ? Date.now() - S.run.qPauseAt : 0);
  return Math.max(0, Date.now() - S.run.qStart - held);
}

function pauseClock() {
  if (!S.run.qStart || S.run.qPauseAt || S.run.picked !== null) return;
  S.run.qPauseAt = Date.now();
  clearClock();
}

function resumeClock() {
  if (!S.run.qStart || !S.run.qPauseAt || S.run.picked !== null) return;
  S.run.qPaused += Date.now() - S.run.qPauseAt;
  S.run.qPauseAt = 0;
  qTimer = setTimeout(timeUp, Math.max(0, clockSec() * 1000 - elapsedMs()));
}

/**
 * **時間切れは不正解と同じ扱いです。**
 *
 * 攻撃できず、チェインが半減し、敵の反撃を受けます。**知識カードと解説は
 * 入ります**（原則3）。責める文言は足しません。
 */
function timeUp() {
  clearClock();
  if (!S.run.ids.length || S.run.picked !== null || S.view !== "quiz") return;
  const q = currentQ();
  if (!q) return;
  S.run.timedOut = true;
  if (modeOf(q) === "swipe") return onSwipe(q, q.answer === 0 ? 1 : 0);
  onPick(-1, false);
}

/**
 * 持ち時間のバー。**数字（残り秒）は出しません** —— 秒を読むと問題を読む時間が減ります。
 *
 * **幅ではなく `transform` を動かします**（width を動かすと再レイアウトが走ります）。
 * 描き直しの途中でも位置がズレないよう、**いま何割たったかを `--from` に入れて
 * そこから続けます**（⚙ を開いて閉じても巻き戻りません）。
 */
function timeBarHTML(mode) {
  if (S.run.intro) return "";
  const sec = timeLimit(mode);
  /* 答えたあとは止める。まだ始まっていない（qStart が無い）ときは頭から */
  const done = S.run.picked !== null;
  const gone = done ? 1
    : S.run.qStart ? Math.min(1, elapsedMs() / (sec * 1000)) : 0;
  return `<div class="tbar${done ? " done" : ""}" data-sec="${sec}" aria-hidden="true"><i style="
    animation-duration:${done ? 0 : Math.max(0, sec * (1 - gone))}s;--from:${gone}"></i></div>`;
}

/* ---------- バトル ---------- */

/**
 * **1つの束が1つの wave です。** 3束なので、1セッションで3回たたかいます。
 * いま何束目の何問目かは、`S.run.plan` と `S.run.i` から毎回数えます
 * （別に持つと、記録からの再挑戦や4択への降り方でズレます）。
 */
function waveAt(i) {
  const plan = (S.run.plan || []).filter(b => b.n > 0);
  if (!plan.length) return { index: 0, at: 0, size: S.run.ids.length || 1, mode: null };
  let from = 0;
  for (let w = 0; w < plan.length; w++) {
    const to = from + plan[w].n;
    if (i < to) return { index: w, at: i - from, size: plan[w].n, mode: plan[w].mode };
    from = to;
  }
  const last = plan[plan.length - 1];
  return { index: plan.length - 1, at: last.n, size: last.n, mode: last.mode };
}

/** その wave の教科。束の中の問題から取る（おまかせだと束ごとに教科が違うため） */
const waveSubject = () => currentQ()?.subject || S.select.subject;

/**
 * この wave に出てくる敵を立てる。
 *
 * **残りの問題数から体力を決めます。** 1体目を早く倒したら2体目が出ますが、
 * そのときは「残り何問あるか」で決め直すので、**最後の1問で満タンの敵が
 * 湧く**ようなことになりません。
 *
 * **敵は属性を持ちます**（`battle.foeFaction`）。MCHの敵データは属性を
 * 持っていないので、こちらでIDから決めています。**同じ敵はいつでも同じ属性**で、
 * サイコロは振りません。
 */
function spawnFoe(fresh = false) {
  const b = S.run.battle;
  if (!b) return;
  const w = waveAt(S.run.i);
  const sub = waveSubject();
  const left = Math.max(1, w.size - w.at);
  b.foeId = enemyOf(DB.subjects, sub, w.mode || "choice", (S.select.seed || 0) + b.kills);
  b.foeFaction = foeFaction(b.foeId);
  /* **最後の束の敵がボスです。** 体力だけ上乗せします */
  const plan = (S.run.plan || []).filter(x => x.n > 0);
  b.boss = plan.length > 1 && w.index === plan.length - 1;
  b.foeMax = foeHpFor(left, b.boss);
  b.foeHp = b.foeMax;
  /* **敵の一撃は、パーティ全体のHPに合わせて測り直します。**
     `engine.foeHit` は英雄1体ぶんで測るので、5枚ぶんのHPに対してそのまま
     使うと、いつまでも倒れません（FALL_RATE の意味が変わります） */
  const lead = b.deck.find(Boolean)?.id || "1006";
  const one = Math.max(1, heroMaxHp(DB.battle, lead));
  b.foeHit = Math.max(1, Math.round(
    foeHit(DB.battle, DB.subjects, sub, b.foeId, lead, S.run.ids.length || 1)
    * (b.heroMax / one)));
  b.wave = w.index;
  if (fresh) b.cleared = false;
}

/**
 * **その枠の一撃。** MCHの (phy + int) / 2 に、知識倍率（0.5〜2.0）と
 * コスト超過の補正（0.75）を掛けたものです。
 *
 * **装備倍率は掛けません。** 掛けると「装備の量＝攻撃力」になり、原則1が
 * 裏返ります。エクステンションが効くのはSSの中身だけです。
 */
function slotPower(hero, have, factor) {
  if (!hero) return 0;
  return heroPower(hero.stats, coverageFor(hero, have), factor);
}

/**
 * **動いた枠は、必ず一撃を入れます。**
 *
 * MCH では、ヒーローは毎ターン装備の Active Skill で殴り、パッシブはその
 * まわりで条件つきに乗ります。ここも同じにしてあります —— 出番が回ってきた
 * 枠は `BASIC_RATE` ぶんの攻撃を必ず入れ、**ASの条件が満たされたときだけ
 * その効果が上乗せされます。**
 *
 * **こうしないとバトルが止まります。** 最初の5体は、確率40%の攻撃AS・
 * 開始時だけのAS・回復AS・条件つきのバフASで、**そのままだと1問も敵を
 * 削れない組み合わせ**でした（実際に止まりました）。
 */
const BASIC_RATE = 0.35;

/**
 * 敵の体力。**NICE（2枠しか動かない）で、その束の8割に正解したら倒れる**
 * ところに置きます。EXCELLENTを取り続ける前提にすると、速く答えられない人が
 * 1体も倒せません。
 *
 * **上は「全問正解ぶん」で頭打ちにします。** 全問正解しても届かない体力に
 * すると、倒すことが運任せになります。
 */
function foeHpFor(left, boss = false) {
  const need = Math.max(1, Math.ceil(left * ATTACK_RATE));
  const base = Math.max(1, baseHit(2));
  const tough = boss ? BOSS_HP : 1;
  return Math.min(left * base, Math.max(base, Math.round(need * base * tough)));
}

/** 左から n 枠ぶんの、**必ず入る**火力（属性相性もチェインもASも乗せない） */
function baseHit(n) {
  const b = S.run.battle;
  if (!b) return 1;
  let sum = 0;
  for (let k = 0; k < Math.min(n, DECK_SIZE); k++) {
    if (b.deck[k]) sum += b.power[k] * BASIC_RATE;
  }
  return Math.max(1, Math.round(sum));
}

/** セッションの始めに、デッキ5枚と最初の敵を立てる */
function startBattle() {
  const have = haveBySubject();
  const factor = costFactor(deckCostNow(), deckCapNow());
  const deck = deckHeroes();
  const power = deck.map(h => slotPower(h, have, factor));
  const partyMax = Math.max(1, Math.round(
    deck.reduce((a, h) => a + (h?.stats.hp || 0), 0) * factor));
  S.run.battle = {
    deck, power, over: deckOver(),
    /* 画面に顔を出すときの代表。先頭の枠です */
    heroId: deck.find(Boolean)?.id || STARTER_DECK[0],
    /* **パーティ全体のHPをひとつの帯で持ちます**（5体ぶんの合計）。
       名前は既存のまま（heroHp / heroMax）—— 戦果の画面も検査もここを読みます */
    heroMax: partyMax, heroHp: partyMax,
    ss: new Array(DECK_SIZE).fill(0),
    chain: 0, judge: null, fired: [], as: [], once: {}, wasHit: false,
    buff: 0, debuff: 0,
    foeId: null, foeFaction: "朱雀", foeHp: 0, foeMax: 1, foeHit: 1, boss: false,
    kills: 0, wave: 0, cleared: false, down: false, fx: null, dmg: 0,
  };
  spawnFoe(true);
}

/* バフとデバフの頭打ち。積み上げて無敵にならないところで止める */
const BUFF_MAX = 1.0;
const DEBUFF_MAX = 0.6;

/**
 * 答えたあとの殴り合い。**正解ならこちらが、外せば向こうが殴ります。**
 *
 * 黒ウィズに寄せて、**速さでASの発動本数が変わります**（EXCELLENT 5体 /
 * GREAT 4体 / GOOD 3体 / NICE 2体）。**落ちるのはデッキの右からです。**
 *
 * **ヒーローが倒れても wave は続きます**（確認済み）。1問ごとの GUM も
 * 知識カードも解説も、倒れているかどうかで変わりません（原則3）。
 */
function battleHit(ok) {
  const b = S.run.battle;
  if (!b || S.run.noReward) return;
  const q = currentQ();
  const mode = q ? modeOf(q) : "choice";
  const ms = elapsedMs();

  b.chain = chainNext(b.chain, ok);
  b.judge = ok ? judge(ms, timeLimit(mode)) : null;
  b.fired = [];
  b.as = [];
  b.dmg = 0;

  if (!ok) {
    b.heroHp = Math.max(0, b.heroHp - Math.round(b.foeHit * (1 - b.debuff)));
    b.fx = "hero";
    b.wasHit = true;
    if (b.heroHp === 0) b.down = true;
    return;
  }

  /* **倒れているあいだは敵を削れません。** それでも報酬は変わりません（原則3） */
  if (b.down) { b.fx = null; b.wasHit = false; return; }

  const ctx = {
    waveFirst: waveAt(S.run.i).at === 0,
    wasHit: b.wasHit,
    down: b.down,
    hpRate: b.heroHp / Math.max(1, b.heroMax),
  };
  b.wasHit = false;

  (S.run.judges ||= {})[b.judge] = (S.run.judges[b.judge] || 0) + 1;
  S.run.maxChain = Math.max(S.run.maxChain || 0, b.chain);

  /* **SSゲージは正解のたびに1つ溜まります。** 速さでは変わりません */
  b.ss = b.ss.map((g, k) => b.deck[k] ? g + 1 : g);

  const n = asCount(b.judge);
  let dmg = 0;
  for (let k = 0; k < Math.min(n, DECK_SIZE); k++) {
    const h = b.deck[k];
    if (!h) continue;
    /* **出番が回ってきた枠は、必ず一撃を入れます**（＝そのヒーローが動いた） */
    b.fired.push(k);
    dmg += asDamage(Math.round(b.power[k] * (1 + b.buff)), BASIC_RATE,
                    h.faction, b.foeFaction, b.chain);
    /* **ASはその上に乗ります。条件を満たしたときだけです** */
    const once = onceOnly(h.as.condition);
    if (once && b.once[h.id]) continue;
    if (!asFires({ description: { ja: { condition: h.as.condition, trigger_rate: h.as.triggerRate } } },
                 q?.id || "", h.id, ctx)) continue;
    if (once) b.once[h.id] = 1;
    b.as.push(k);
    dmg += applyAS(b, k, h);
  }
  b.dmg = dmg;
  if (dmg > 0) {
    b.foeHp = Math.max(0, b.foeHp - dmg);
    b.fx = "foe";
    /* **削った結果として倒れたときだけ数えます。** 倒したあと次の敵が立つまでの
       0.7秒のあいだにもう1問答えると、同じ敵を2回数えてしまいます */
    if (b.foeHp === 0) killFoe();
  } else b.fx = null;
}

/**
 * AS 1本ぶんの効き。**MCH の effect_id がそのまま種類です。**
 * 1 単体 / 2 全体 / 3 回復・復活 / 4 バフ / 5 デバフ・状態異常。
 */
function applyAS(b, k, h) {
  const rate = h.as.rate / 100;
  const kind = h.as.effect;
  if (kind === 3) {            // 回復
    b.heroHp = Math.min(b.heroMax, b.heroHp + Math.round(b.heroMax * rate));
    b.heroHp = b.heroHp;
    if (b.heroHp > 0) b.down = false;
    return 0;
  }
  if (kind === 4) {            // バフ（このセッションのあいだ火力が乗る）
    b.buff = Math.min(BUFF_MAX, b.buff + rate);
    return 0;
  }
  if (kind === 5) {            // デバフ（敵の一撃が軽くなる）
    b.debuff = Math.min(DEBUFF_MAX, b.debuff + rate);
    return 0;
  }
  const power = Math.round(b.power[k] * (1 + b.buff));
  return asDamage(power, rate, h.faction, b.foeFaction, b.chain);
}

/** 敵を倒したとき。**この wave に問題が残っていれば、次の敵が出ます** */
function killFoe() {
  const b = S.run.battle;
  b.kills++;
  const w = waveAt(S.run.i);
  if (w.at + 1 < w.size) setTimeout(() => { spawnFoe(); drawBattle(); }, 700);
  else b.cleared = true;
}

/** wave が変わったら、次の敵を立て、倒しきっていた記録をつける */
function battleStep() {
  const b = S.run.battle;
  if (!b) return;
  const w = waveAt(S.run.i);
  if (w.index !== b.wave) { b.cleared = false; spawnFoe(true); }
  b.fx = null;
}

/**
 * バトルの層だけを描き替える。
 *
 * **画面ぜんぶを描き直しません。** 答えたあとの `onPick` は、選択肢に印を付けて
 * 解説を出すところまでを DOM のまま進めます。ここで `render()` を呼ぶと、
 * その印ごと消えてしまいます。
 */
function drawBattle() {
  const el = app.querySelector(".bt-stage");
  if (el) el.outerHTML = battleStage();
  const row = app.querySelector(".bt-deck");
  if (row) { row.outerHTML = deckRow(); wireDeckRow(); }
}

/** ヒーローと敵。**情報は最小限にします** —— 主役は設問と解答です */
function battleStage() {
  const b = S.run.battle;
  if (!b) return "";
  const pct = (hp, max) => Math.max(0, Math.round(hp / Math.max(1, max) * 100));
  const mark = affinityMark(b.deck.find(Boolean)?.faction || "朱雀", b.foeFaction);
  /* 「たおした！」「にげられた」は、**束の終わりの画面**が引き取りました
     （`vWave`）。ここに重ねると、同じことを2回言うことになります */
  return `<div class="bt-stage">
    <div class="bt-side foe${b.fx === "foe" ? " hit" : ""}${b.foeHp === 0 ? " down" : ""}">
      <img class="bt-ch" src="${assetPath.enemy(b.foeId)}" alt="">
      <span class="fac ${facCls(b.foeFaction)}">${esc(b.foeFaction)}<i>${mark}</i></span>
      ${b.boss ? `<span class="bt-boss">BOSS</span>` : ""}
      <div class="bt-hp foe"><i style="width:${pct(b.foeHp, b.foeMax)}%"></i></div>
      <div class="bt-num"><span>${b.foeHp}/${b.foeMax}</span><b>${pct(b.foeHp, b.foeMax)}%</b></div>
      ${b.fx === "foe" ? `<span class="bt-fx" style="background-image:url('${
        assetPath.fx("01_single_damage")}')"></span>` : ""}
      ${b.dmg > 0 && b.fx === "foe" ? `<span class="bt-dmg">${b.dmg}</span>` : ""}
    </div>
    <div class="bt-meta">
      ${b.kills > 0 ? `<span class="bt-kills">×${b.kills}</span>` : ""}
      <span class="bt-chain${b.chain ? " on" : ""}"><b>CHAIN</b>${Math.min(CHAIN_MAX_SHOWN, b.chain)}</span>
    </div>
  </div>`;
}

/**
 * **デッキ5枚とパーティのHP。画面のいちばん下です。**
 *
 * 左から順にASが乗り、**右ほど落ちます。** どこまで届いたかが答えたあとに
 * 光るので、速さの手ざわりがここに出ます。SSゲージが溜まった枠は縁が光り、
 * 押すと撃つ相手を選べます。
 */
function deckRow() {
  const b = S.run.battle;
  if (!b) return "";
  const pct = Math.max(0, Math.round(b.heroHp / Math.max(1, b.heroMax) * 100));
  const tight = ["panel", "numeric"].includes(S.run.clockMode);
  return `<div class="bt-deck${tight ? " tight" : ""}${b.down ? " down" : ""}">
    <div class="bt-party">
      <div class="bt-hp"><i style="width:${pct}%"></i></div>
      <div class="bt-num"><span>${b.heroHp}/${b.heroMax}</span><b>${pct}%</b></div>
    </div>
    <div class="bt-slots">${b.deck.map((h, k) => {
      if (!h) return `<span class="slot empty"></span>`;
      const ext = DB.extensions[S.deckExt?.[h.id]];
      const need = ext ? ssNeed(ext) : 0;
      const ready = ext && ssReady(b.ss[k], ext);
      return `<button class="slot${b.fired.includes(k) ? " fired" : ""}${
        b.as.includes(k) ? " asfired" : ""}${
        ready ? " ready" : ""}" data-slot="${k}" ${ready ? "" : "disabled"}
        aria-label="${esc(h.name)}">
        <img src="${assetPath.hero(h.id)}" alt="">
        <i class="fac ${facCls(h.faction)}"></i>
        <span class="ssg">${ext ? Array.from({ length: need }, (_, i) =>
          `<i class="${i < b.ss[k] ? "on" : ""}"></i>`).join("") : ""}</span>
      </button>`;
    }).join("")}</div>
  </div>`;
}

/**
 * **バトルの帯**（画面のいちばん上・全体の32%）。
 *
 * 背景・敵・チェイン・Q.◯／あと◯問・3つの束の帯が入ります。
 * **出題の画面とスワイプで同じものを使います** —— スワイプだけ帯が無いと、
 * 8問のあいだ戦いが画面から消えます（実際に消えていました）。
 */
function battleBandHTML(q) {
  const w = waveAt(S.run.i);
  const bg = DB.subjectArt[q.subject]?.bg || DB.defaultBg;
  return `
    <div class="qz-battle" style="background-image:url('${assetPath.bg(bg)}')">
      <i class="qz-shade"></i>
      ${battleStage()}
      <div class="bt-count">
        <span class="bt-q">Q.${w.at + 1}</span>
        <span class="bt-left">${w.size - w.at - 1 > 0 ? `あと${w.size - w.at - 1}問` : "この束の最後"}</span>
      </div>
      <!-- **3つの束と進み具合。** Q.1／あと3問 は「いまの束の中」の話なので、
           セッション全体のどこにいるかは、この帯でしか分かりません -->
      <div class="bt-plan">${planStrip()}</div>
    </div>`;
}

/* ---------- スペシャルスキル（装備したエクステンションの Active Skill） ---------- */

/**
 * **SSはデッキの枠から撃ちます**（S-34）。
 *
 * ゲージは正解のたびに1つ溜まり、ランクぶん（初伝3・中伝4・奥伝6）たまると
 * 撃てます。**撃つとカウントは0に戻ります。**
 *
 * **SSはクイズに干渉しません。** 黒ウィズのSSには「選択肢を減らす」
 * 「制限時間を止める」がありますが、入れていません —— 難易度のつまみは
 * ヒントと「4択に切り替える」がすでに持っていて、そこはプレイヤーの手に
 * 置いてあります（決定2）。**SSが動かすのは敵とパーティの数値だけです。**
 */
function wireDeckRow() {
  app.querySelectorAll(".bt-slots .slot[data-slot]").forEach(btn => {
    btn.onclick = () => { S.run.ssOpen = true; pauseClock(); drawSS(); };
  });
}

/** そのヒーローに装備してあるSS（エクステンションの Active Skill） */
const ssOf = hero => hero ? DB.extSkills?.[S.deckExt?.[hero.id]] : null;

function drawSS() {
  const slot = document.getElementById("ssmodal");
  const b = S.run.battle;
  if (!slot || !b) return;
  if (!S.run.ssOpen) { slot.innerHTML = ""; return; }
  slot.innerHTML = `
  <div class="modal" id="ssmodal-bg"><div class="msheet sssheet">
    <b class="sstitle">スペシャルスキル</b>
    <div class="sslist">${b.deck.map((h, k) => {
      if (!h) return "";
      const ext = DB.extensions[S.deckExt?.[h.id]];
      const sk = ssOf(h);
      if (!ext || !sk) return `<div class="ssrow none">
        <img src="${assetPath.hero(h.id)}" alt="">
        <div><b>${esc(h.name)}</b><p class="fine">エクステンションを装備すると、その品の技が使えます。</p></div>
      </div>`;
      const need = ssNeed(ext), have = b.ss[k], ready = ssReady(have, ext);
      return `<div class="ssrow${ready ? " ready" : ""}">
        <img src="${assetPath.hero(h.id)}" alt="">
        <div>
          <b>${esc(h.name)} ・ ${esc(ext.name)}</b>
          <em>${esc(sk.name)}</em>
          <p class="fine">${esc(sk.text)}</p>
          <span class="ssg big">${Array.from({ length: need }, (_, i) =>
            `<i class="${i < have ? "on" : ""}"></i>`).join("")}</span>
        </div>
        ${ready ? `<button class="btn sm" data-fire="${k}">撃つ</button>`
                : `<span class="fine">あと${need - have}問</span>`}
      </div>`;
    }).join("")}</div>
    <button class="btn ghost" id="ssclose">とじる</button>
  </div></div>`;
  slot.querySelectorAll("[data-fire]").forEach(btn =>
    btn.onclick = () => fireSS(Number(btn.dataset.fire)));
  const close = document.getElementById("ssclose");
  if (close) close.onclick = () => { S.run.ssOpen = false; resumeClock(); drawSS(); };
}

/** SSのカットインの長さ。MCH のパッシブスキル演出と同じ尺 */
const SS_CUT_MS = 1200;

/**
 * SSを撃つ。**カットインは MCH の `Style/Cutins/passive_skill_cutin.css` を
 * 写したもので、技の名前は `active_skill.name.ja` そのものです。**
 *
 * **`app` の下に置かないでください。** 最中に `render()` が走ると
 * `app.innerHTML` ごと消えます。`document.body` に置いてあります。
 */
function fireSS(k) {
  const b = S.run.battle;
  const h = b?.deck[k];
  const ext = h && DB.extensions[S.deckExt?.[h.id]];
  const sk = ssOf(h);
  if (!b || !h || !ext || !sk || !ssReady(b.ss[k], ext)) return;
  b.ss[k] = 0;
  S.run.ssOpen = false;
  drawSS();
  const el = skillCutIn(h.id, sk.name);
  setTimeout(() => {
    el.remove();
    applySS(b, k, h, sk);
    drawBattle();
    setTimeout(() => { b.fx = null; b.dmg = 0; drawBattle(); }, 460);
    resumeClock();
  }, SS_CUT_MS);
}

/**
 * SSの効き。ASと同じ `effect_id` の表を使い、**倍率だけ `SS_POWER` 倍**です。
 * **GUM も知識カードも増えません**（原則3-2・原則6）。
 */
function applySS(b, k, h, sk) {
  const rate = sk.rate / 100;
  if (sk.effect === 3) {
    b.heroHp = Math.min(b.heroMax, b.heroHp + Math.round(b.heroMax * rate * SS_POWER));
    b.heroHp = b.heroHp;
    if (b.heroHp > 0) b.down = false;
    b.fx = "hero";
    return;
  }
  if (sk.effect === 4) { b.buff = Math.min(BUFF_MAX, b.buff + rate * SS_POWER); b.fx = "hero"; return; }
  if (sk.effect === 5) { b.debuff = Math.min(DEBUFF_MAX, b.debuff + rate * SS_POWER); b.fx = "foe"; return; }
  if (b.down) return;
  const power = Math.round(b.power[k] * (1 + b.buff) * SS_POWER);
  const dmg = asDamage(power, rate, h.faction, b.foeFaction, b.chain);
  b.dmg = dmg;
  b.foeHp = Math.max(0, b.foeHp - dmg);
  b.fx = "foe";
  if (b.foeHp === 0) killFoe();
}

/**
 * 束の切れ目に挟む2つの画面（S-29 / S-30）。
 *
 * **敵に出会った → 問題を解いて倒す → 倒せた／逃げられた**、という1本の
 * 筋を見えるようにするための画面です。出題の画面ではバトルを上に小さく
 * 畳んでいるので（主役は設問と解答）、**戦いの手ざわりを受け持つ場所が
 * どこにも無いままでした。** ここがその場所です。
 *
 * **1問ごとの報酬は、ここでも変わりません**（原則3-2）。出しているのは
 * すでに手に入れたものの内訳で、倒したかどうかで動くのは上乗せだけです。
 */
function vWave() {
  const g = S.run.gate;
  if (!g) return go(S.run.i >= S.run.ids.length ? "result" : "quiz");
  return g.kind === "end" ? vWaveEnd(S.run.waves[g.wave]) : vWaveStart(g.wave);
}

/** その束の1問目から、教科の絵を引く（おまかせだと束ごとに教科が違う） */
const waveBg = () => {
  const q = DB.byId[S.run.ids[S.run.i]];
  return DB.subjectArt[q?.subject]?.bg || DB.defaultBg;
};

/* 接敵（S-29）。**英雄が画面の外から入ってきて、敵の体力が満ちるまで** */
function vWaveStart(index) {
  const b = S.run.battle;
  const plan = (S.run.plan || []).filter(x => x.n > 0);
  const seg = plan[index] || { mode: "choice", n: S.run.ids.length };
  app.innerHTML = `
  <div class="wv">
    <div class="wv-head">
      <h1>${esc(MODE_LABEL[seg.mode] || seg.mode)}</h1>
      <p>全${seg.n}問</p>
    </div>
    <div class="wv-stage" style="background-image:url('${assetPath.bg(waveBg())}')">
      <div class="wv-hero"><img class="bt-ch" src="${assetPath.hero(b.heroId)}" alt=""></div>
      <div class="wv-foe">
        <img class="bt-ch" src="${assetPath.enemy(b.foeId)}" alt="">
        <div class="wv-hp"><i></i></div>
        <div class="bt-num"><span>${b.foeMax}/${b.foeMax}</span><b>100%</b></div>
      </div>
    </div>
    <div class="wv-foot"><button class="btn" id="wvgo">GO!</button></div>
  </div>`;
  document.getElementById("wvgo").onclick = () => { S.run.gate = null; go("quiz"); };
}

/* 戦果（S-30）。**倒しきったか、逃げられたか** */
function vWaveEnd(rec) {
  const w = rec || { right: 0, wrong: 0, appliedRight: 0, gum: 0, found: [], cleared: false };
  const asked = w.right + w.wrong;
  const rate = asked ? Math.round(w.right / asked * 100) : 0;
  /* **1体でも倒していれば「撃破！」です。** 2体目を残して終わっても、
     倒した事実は消えません。**逃げられたほうは、名前を添えて1行で補います** */
  const won = w.cleared || w.kills > 0;
  const fled = !w.cleared && w.foeId
    ? (DB.battle?.enemies?.[String(w.foeId)]?.name || "エネミー") : "";
  const last = S.run.i >= S.run.ids.length;
  const found = w.found || [];
  app.innerHTML = `
  <div class="wv">
    <div class="wv-head">
      <h1>${esc(MODE_LABEL[w.mode] || w.mode || "")}</h1>
      <p>結果</p>
    </div>
    <div class="wv-stage end" style="background-image:url('${assetPath.bg(w.bg || waveBg())}')">
      <div class="wv-hero"><img class="bt-ch" src="${assetPath.hero(w.heroId)}" alt=""></div>
      <span class="wv-cry ${won ? "win" : "lose"}">${
        won ? "撃破！" : "逃げられた……"}</span>
      <div class="wv-foe${w.cleared ? " gone" : ""}">
        <img class="bt-ch" src="${assetPath.enemy(w.foeId)}" alt="">
        <div class="wv-hp"><i style="width:${w.cleared ? 0 : 100}%"></i></div>
        <div class="bt-num"><span>${w.cleared ? 0 : w.foeMax}/${w.foeMax}</span>
          <b>${w.cleared ? 0 : 100}%</b></div>
      </div>
    </div>
    <div class="wv-body">
      ${fled ? `<p class="wv-fled">${esc(fled)}には逃げられた</p>` : ""}
      <div class="stat">
        <div><b>${w.right}</b><span>解けた</span></div>
        <div><b>${w.appliedRight}</b><span>応用も突破</span></div>
        <div><b>${rate}<small style="font-size:15px">%</small></b><span>正答率</span></div>
      </div>
      ${won ? "" : `
      <!-- 1体も倒せなかったときだけ、手の打ち方を言う。**罰ではなく道順です**（原則3） -->
      <div class="wv-tip">
        <img src="${assetPath.navi("navi_ain_07_talk")}" alt="マイちゃん">
        <div>
          <b>エネミーを倒すには</b>
          <ul>
            <li>・ヒーローのレベルを上げて強化</li>
            <li>・応用問題に挑戦して追加攻撃</li>
          </ul>
          <p>を試してみよう!</p>
        </div>
      </div>`}
      ${S.run.noReward ? `<p class="fine">記録からの再挑戦なので、何も増えていません。</p>`
      : `<div class="wv-loot">
        ${found.length ? [...new Set(found)].map(id => `<span class="fnd sm">
            <img src="${assetPath.crystal(id)}" alt="">
            <b>${esc(DB.crystalById[id].name)}</b>×${found.filter(x => x === id).length}
          </span>`).join("") : ""}
        <span class="fnd sm"><img src="${assetPath.icon("gum")}" alt="GUM"><b>GUM</b>×${w.gum}</span>
      </div>`}
    </div>
    <div class="wv-foot"><button class="btn" id="wvnext">${last ? "結果へ" : "NEXT"}</button></div>
  </div>`;
  document.getElementById("wvnext").onclick = () => {
    S.run.gate = null;
    if (last) return go("result");
    gateStart(waveAt(S.run.i).index);
    render(); window.scrollTo(0, 0);
  };
}

function vQuiz() {
  if (S.run.i >= S.run.ids.length) return go("result");
  const q = currentQ(), h = heroFor(q), fit = fitOf(q, h);
  const mode = modeOf(q);
  // スワイプは画面ごと別。束で出るので、ふつうのセッションの途中にも現れる
  if (mode === "swipe") return vSwipe();
  /**
   * **初回起動は、問題と解答だけにします**（決定1）。
   *
   * 国・学年・教科・進み具合・単元・段・ヒント——どれも出しません。
   * **難しくなっていくことは、解いていれば分かります。** 先に数字で言うと、
   * 「教わらずにできた」で始めるという狙いが崩れます。
   *
   * 画面の上は**空けたままにしてあります**（`.introtop`）。あとでここに
   * 演出が入るので、いま別のものを置くと、入れるときに動かすことになります。
   */
  const intro = !!S.run.intro;

  /**
   * **画面は4つの帯です**（`docs/wiz-redesign-screens.md`）。
   *
   * ```
   * バトル 37% ／ 設問 18% ／ 解答 のこり ／ デッキ行
   * ```
   *
   * **比率は黒ウィズの実画面から採りました。** バトルを細く畳んでいたころは、
   * 敵が 56px しかなく、戦っている感じがありませんでした。**背景も
   * バトルの帯の中だけに敷きます** —— 画面ぜんぶに薄く敷くと、
   * 絵が効かないうえに設問が読みにくくなります。
   *
   * **文字パネルと数値入力だけは帯を詰めます**（`.tall`）。盤面とテンキーに
   * 高さが要るので、バトルを 37% のまま取ると解答がはみ出します。
   *
   * 初回起動（決定1）はこの帯立てに乗せません——問題と解答だけにするためです。
   */
  const tall = mode === "panel" || mode === "numeric";

  /* 設問の帯。**補足（教科・単元・段・ヒント・⚙）は問題文の下**に置きます */
  const askHTML = `
    ${q.stem ? `<div class="qstem">${esc(q.stem)}</div>` : ""}
    <div class="qtext">${esc(q.prompt)}</div>
    ${photoAt(q, "prompt")}
    ${q.figure ? `<div class="figure">${DB.figures[q.figure]}</div>` : ""}
    ${intro ? "" : `<div class="bt-sub">
      <span class="grade ${q.newCurriculum ? "alt" : ""}">${esc(q.subject)}</span>
      <span class="unit">${esc(q.unit)}</span>${levelChip(q, mode)}
      <button class="hintbtn sm" id="hint">ヒント</button>
      <button class="gear" id="gear" aria-label="設定">⚙</button>
    </div>`}`;

  /* 解答の帯 */
  const ansHTML = `
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
    : `${intro && mode === "choice" ? "" : modeBand(q, mode)}
      <div class="choices${mode === "elimination" ? " elim" : ""}${
        /* **短い選択肢は2×2に並べます。** 「は・を・わ・に」を縦に4つ積むと、
           読む前に目が上から下へ流れます。碁盤に置くと4つが一度に目に入ります */
        intro && mode === "choice" && q.choices.every(c => [...String(c)].length <= 6) ? " grid2" : ""}">${q.choices.map((t, i) => {
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
    <div id="verdict"></div>`;

  const modals = `
  ${S.run.settingOpen ? `<div class="modal" id="setmodal"><div class="msheet">
    <label class="switch">
      <input type="checkbox" id="showexp" ${S.settings.showExplanationOnCorrect ? "checked" : ""}>
      <span class="sw"></span>
      <span class="lbl">正解した問題の解説を見る</span>
    </label>
    <button class="btn ghost" id="setclose">とじる</button>
  </div></div>` : ""}
  <div id="hintmodal"></div><div id="ssmodal"></div>`;

  /* **ヒントはポップアップで出します**（`#hintmodal`）。流れの中に置くと、
     開いた瞬間に解答エリアが下へ押し出されてスクロールが要りました。
     中身は `drawHints` が入れます——空のあいだは何も描かないので、
     場所も取りません。**HTMLコメントをテンプレートリテラルの中に書くときは
     バッククォートを入れないでください**（そこで文字列が閉じます）。 */

  app.innerHTML = intro ? `
  <div class="introtop"></div>
  <div class="pad intro">${askHTML}${ansHTML}</div>
  ${modals}` : `
  <div class="qz${tall ? " tall" : ""}">
    ${battleBandHTML(q)}
    ${timeBarHTML(mode)}
    <div class="qz-ask">${askHTML}</div>
    <div class="qz-ans">${ansHTML}</div>
    ${deckRow()}
  </div>
  ${modals}`;

  /* **1本も見ていないときだけ、開くと同時に1本目が出ます。**
     2回目からは読み直すだけなので、本数は増えません（点が勝手に減りません） */
  const hintBtn = document.getElementById("hint");
  if (hintBtn) hintBtn.onclick = () => {
    if (S.run.hintsUsed === 0) S.run.hintsUsed++;
    S.run.hintOpen = true;
    /* **開いているあいだ、持ち時間の時計を止めます。** 原則5で渡した道具を
       使うと罰される、という形にしないためです */
    pauseClock();
    drawHints(q, h);
  };
  /* 設定は⚙から。**ヒントの隣に置くと押し間違えます**が、どちらも小さく畳んで
     あるので、解答エリアの邪魔にはなりません */
  const gear = document.getElementById("gear");
  if (gear) gear.onclick = () => { S.run.settingOpen = true; pauseClock(); render(); };
  const setClose = document.getElementById("setclose");
  if (setClose) setClose.onclick = () => { S.run.settingOpen = false; resumeClock(); render(); };
  const setExp = document.getElementById("showexp");
  if (setExp) setExp.onchange = e => {
    S.settings.showExplanationOnCorrect = e.target.checked; render();
  };
  if (mode === "elimination") wireElimination(q);
  else if (mode === "panel") wirePanel(q);
  else if (mode === "numeric") wireNumeric(q);
  else app.querySelectorAll(".choices .choice").forEach(b =>
    b.onclick = () => onPick(Number(b.dataset.i)));
  if (mode !== "numeric" && mode !== "panel" && q.format === "range") wireRange(q);
  wireDeckRow();
  drawHints(q, h);
  /* **SSのポップアップも、描き直したら描き直します。** `#ssmodal` へ命令的に
     差しこんでいるので、`render()` が走ると消えます（⚙ を押しただけで
     消えていました——解説と同じ話です） */
  drawSS();
  replayVerdict(q, h);
  /* **予告した持ち時間のまま始めます。** 答えたあとに描き直しても
     数え直さないよう、まだ答えていないときだけ時計を立てます */
  if (S.run.picked === null && !S.run.hintOpen && !S.run.settingOpen) armClock(mode);
}

/**
 * **答えたあとの解説を、描き直しても残します。**
 *
 * 判定は `drawVerdict` が `#verdict` に差しこむので、`render()` が走ると
 * 消えます。⚙（設定）を開くだけで解説が飛んでいました。控えてある
 * `S.run.verdict` から同じものを描き直します。ヒントの続き（`tipOpen`）と
 * 応用編（`applied`）は状態に残っているので、そのまま戻ります。
 */
function replayVerdict(q, h) {
  const v = S.run.verdict;
  if (!v || v.qid !== q.id) return;
  if (v.skill) return S.run.skill === "offer" ? drawSkillOffer(q, h) : drawSkillPanel(q, h);
  if (v.note) return drawNoteOnly(q, h);
  drawVerdict(q, h, v.ok, v.gum, v.rangeScore ?? null, v.found, v.opened || [], true);
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
  clearClock();
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

/**
 * ヒントは**ポップアップ**で出します。
 *
 * **元の画面を動かしません。** 流れの中に置いていたころは、開いた瞬間に
 * 解答エリアが下へ押し出されて、答えるのにスクロールが要りました。
 * ポップアップなら、読んで閉じれば元の位置のままです。
 *
 * **段を増やすのはポップアップの中の「もう一段」だけです。** 開き直しでは
 * 増えません——点はヒントの本数で決まるので（`10 − 本数×2`）、読み返した
 * だけで減るのは筋が通りません。
 */
function drawHints(q, h) {
  const max = fitOf(q, h) ? 3 : 2;
  // 選択肢が見えているかでヒントの系統が変わる。選択肢を潰す型のヒントは、
  // 文字パネルや数値入力では意味をなさない（experience-design-framework の決定4）
  const list = hintsFor(q.hints, hintGroup(modeOf(q)));
  // 画像つきのヒントは最後の一段に添える。ヒントは答えの直前で止めるので、
  // ここに置く画像もそれだけで答えが割れないものに限る（原則5・validate が形だけ見る）
  const withPhoto = q.imageAt === "hint" ? Math.min(list.length, max) : -1;
  const used = Math.min(S.run.hintsUsed, max);
  const slot = document.getElementById("hintmodal");
  const b = document.getElementById("hint");

  if (slot) {
    slot.innerHTML = !S.run.hintOpen || !used ? "" : `
      <div class="modal" id="hintmodal-bg"><div class="msheet hintsheet">
        <div class="hintlist">${list.slice(0, used)
          .map((t, i) => `<div class="hint"><b>ヒント ${i + 1}</b>${esc(t.text)}` +
            (i + 1 === withPhoto ? photoHTML(q.image, "hint") : "") + `</div>`).join("")}</div>
        ${used < max && S.run.picked === null
          ? `<button class="hintbtn" id="hintmore">もう一段 (${used}/${max})</button>`
          : `<p class="fine hintend">${used >= max ? "ヒントはここまで。" : ""}</p>`}
        <button class="btn" id="hintclose">とじる</button>
      </div></div>`;
    const more = document.getElementById("hintmore");
    if (more) more.onclick = () => { S.run.hintsUsed++; drawHints(q, h); };
    const close = document.getElementById("hintclose");
    if (close) close.onclick = () => { S.run.hintOpen = false; resumeClock(); drawHints(q, h); };
  }

  if (!b) return;
  /* **使い切っても押せるままにします。** 中身を読み返すための入口なので、
     ここで閉じると、一度見たヒントに戻れなくなります */
  b.disabled = S.run.picked !== null;
  b.textContent = used === 0 ? "ヒント" : `ヒント (${used}/${max})`;
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
  battleHit(ok); drawBattle();
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
  /* **解くとヒーローが仲間になります。ガチャは引きません**（原則2） */
  if (reward) (S.run.joined ||= []).push(...crewJoin());
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
  if (rh) rh.onclick = () => {
    S.run.hintsUsed++; S.run.hintOpen = true; drawHints(q, h); drawRetry(q, head);
  };
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

  clearClock();
  app.querySelectorAll(".keypad .key, #nsubmit, #tochoice, .pcell, #psubmit, .xcut[data-c], #ra, #rb, #rsubmit")
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
  battleHit(ok); drawBattle();
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
  if (reward) (S.run.joined ||= []).push(...crewJoin());
  S.run.hintOpen = false;   // 解説と重ねない。答えたらヒントは引っこめる
  drawHints(q, h);

  /**
   * テンポ優先モード：正解なら演出だけ見せて次へ。
   * **ただし注釈（`note`）は飛ばしません。** 表記のゆれのように、
   * 知らないと次にぶつかったとき迷うものを置く欄なので、解説を省く設定でも出します。
   */
  /* **解説を省いていても、隙を見せた問題では必殺技の入口を出します。**
     応用編は解説の中にしか置いていなかったので、テンポ優先モードの人は
     いつまでも挑めませんでした（`docs/review-points.md` §24） */
  if (ok && !S.settings.showExplanationOnCorrect && skillOpen(q)) {
    S.run.tipOpen = false; S.run.applied = null;
    S.run.skill = "offer"; S.run.verdict = { qid: q.id, skill: true };
    drawSkillOffer(q, h);
    return;
  }
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

/* ---------- 必殺技（英雄のパッシブスキル） ---------- */

/**
 * **この問題で敵が隙を見せるか。**
 *
 * 解説を省く設定だと、応用編にたどり着く道がありませんでした
 * （応用編のボタンは解説の中にしか無いため）。そこを開ける入口です。
 *
 * **サイコロは振りません**（`engine.skillChance`）。問題IDと英雄から
 * 決まるので、出るまで引き直すことはできません。初回起動では出しません
 * （決定1・バトルそのものを立てないため）。
 */
const skillOpen = q => !S.run.intro && !!S.run.battle &&
  skillChance(q, S.run.battle.heroId);

/** 「必殺技発動チャンス!」。**押さずに進むこともできます** */
function drawSkillOffer(q, h) {
  const b = S.run.battle;
  const slot = document.getElementById("verdict");
  if (!slot) return;
  slot.innerHTML = `
  <div class="skmodal" id="skmodal"><div class="msheet sksheet">
    <img class="bt-ch skface" src="${assetPath.hero(b.heroId)}" alt="">
    <b class="sktitle">必殺技発動チャンス!</b>
    <p class="skwhy">敵が隙を見せた! 応用問題を解いて必殺技を発動しよう!</p>
    <button class="btn" id="skgo">応用問題にチャレンジ!</button>
    <button class="btn ghost" id="skskip">つぎへ</button>
  </div></div>`;
  document.getElementById("skgo").onclick = () => {
    S.run.skill = "open";
    S.run.applied = { picked: null, ok: false, hint: false };
    drawSkillPanel(q, h);
  };
  document.getElementById("skskip").onclick = () => { S.run.skill = null; advance(); };
}

/**
 * 応用編だけを出す小さい判定。**解説は出しません** —— 解説を省く設定の
 * 人に向けた画面なので、ここで本文を出すと設定を裏切ることになります。
 */
function drawSkillPanel(q, h) {
  document.getElementById("verdict").innerHTML = `
  <div class="verdict"><div class="vhead ok">正解。敵が隙を見せた。</div>
    <div class="lesson">
      <div class="speaker"><img class="ava sm" src="${assetPath.hero(h.id)}" alt="">
        <span>${esc(h.name)}</span></div>
      <p>応用編を抜けると、${esc(skillName(DB.battle, S.run.battle.heroId) || "必殺技")}が出る。</p>
    </div>
    <div id="tipslot"></div><div id="exslot"></div><div class="stack" id="acts"></div></div>`;
  drawApplied(q, true); drawActions(q, true);
}

/**
 * **必殺技のカットイン。** MCH の `Style/Cutins/passive_skill_cutin.css` を
 * 写したものです（斜めの帯・色ドッジの光・2倍のドット絵・縁取りの技名）。
 * 帯が流れきってから、敵に `SKILL_POWER` 倍の一撃が入ります。
 */
const SKILL_CUT_MS = 1200;

/**
 * 帯を出すところだけ。**消すのは呼ぶ側です** —— 絵として撮りたいときに、
 * 1.2秒の勝負をしなくて済みます（`npm run shots` が S-33 でそうします）。
 *
 * **`app` の下に置かないでください。** カットインの最中に `render()` が
 * 走ると、`app.innerHTML` ごと消えます（実際に消えました）。
 * `position:fixed` なので、body に置いても見た目は変わりません。
 */
function skillCutIn(heroId, name) {
  const el = document.createElement("div");
  el.className = "skcut";
  el.innerHTML = `<div class="skcut-band"><span class="skcut-shine"></span></div>
    <div class="skcut-unit"><img src="${assetPath.hero(heroId)}" alt="">
      <p>${esc(name)}</p></div>`;
  document.body.appendChild(el);
  return el;
}

function fireSkill() {
  const b = S.run.battle;
  if (!b || S.run.skill === "fired") return;
  S.run.skill = "fired";
  const hit = skillHit(DB.battle, b.heroId);
  const el = skillCutIn(b.heroId, skillName(DB.battle, b.heroId));
  setTimeout(() => {
    el.remove();
    if (!b.down) { b.foeHp = Math.max(0, b.foeHp - hit); if (b.foeHp === 0) b.kills++; }
    b.fx = "foe"; drawBattle();
    setTimeout(() => { b.fx = null; drawBattle(); }, 460);
  }, SKILL_CUT_MS);
}

/**
 * 解説を省く設定のときに、注釈だけを出す小さい判定。
 * 解説（`lesson`）は出さず、注釈と知識カードだけを見せます。
 */
function drawNoteOnly(q, h) {
  S.run.verdict = { qid: q.id, note: true };
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

function drawVerdict(q, h, ok, gum = 0, rangeScore = null, found = null, opened = [], replay = false) {
  /* **描いたものを控えておきます。** 判定は命令的に差しこんでいるので、
     このあと `render()` が走ると消えます（⚙ を押しただけで解説が飛びました）。
     `opened` は教科しか使わないので、そこだけ持ちます——問題そのものを
     持つと localStorage が太ります */
  S.run.verdict = { qid: q.id, ok, gum, rangeScore, found,
                    opened: (opened || []).map(x => ({ subject: x.subject })) };
  /* **判定はその場かぎりの表示です。** 集計して見せません（原則3-2）——
     速さで変わるのは敵に与えるダメージだけで、報酬は1つも動きません */
  const j = ok && S.run.battle?.judge ? S.run.battle.judge : null;
  const head = ok
    ? (rangeScore !== null
        ? (rangeScore === 1000 ? "言い切って、当てた。" : "その幅の中にある。")
        : S.run.hintsUsed ? "正解。ヒントを使っても、解けたことに変わりはない。" : "正解。")
    : "面白い単元に当たった。ここは聞いていこう。";
  document.getElementById("verdict").innerHTML = `
  <div class="verdict"><div class="vhead ${ok ? "ok" : "ng"}">${
    j ? `<span class="vjudge ${j}">${j}</span>` : ""}${
    S.run.timedOut && !ok ? `<span class="vjudge NICE">時間切れ</span>` : ""}${esc(head)}</div>
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
  if (replay) return;   // 描き直しのときは動かさない（読んでいる途中で飛びます）
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
    /* **応用編を抜けると必殺技が出ます。** 動くのは敵の体力だけで、
       GUM も知識カードも増えません（原則3-2・原則6） */
    if (S.run.battle && skillOpen(q)) fireSkill();
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
  /* **wave が変わる前に、戦果を控えます。** 束の最後の問題を終えた時点で
     敵が残っていれば「逃げられた」、残っていなければ「倒しきった」。
     **敵と英雄もここで控えます** —— このあとの `battleStep` が次の敵を
     立ててしまうので、終了画面から見にいくともう別の敵になっています */
  const b = S.run.battle;
  let ended = false;
  if (b) {
    const w = waveAt(S.run.i);
    if (w.at + 1 >= w.size) {
      const m = S.run.mark || { right: 0, wrong: 0, appliedRight: 0, gum: 0, found: 0 };
      (S.run.waves ||= []).push({
        kills: b.kills - (S.run.countedKills || 0), cleared: b.foeHp === 0,
        mode: w.mode, size: w.size, heroId: b.heroId, foeId: b.foeId, foeMax: b.foeMax,
        /* **絵も控えます。** 束の終わりでは次の設問がもう無いことがあるので、
           そこから教科を引くと、最後だけ既定の背景に変わります */
        bg: waveBg(),
        right: S.run.right - m.right, wrong: S.run.wrong - m.wrong,
        appliedRight: S.run.appliedRight - m.appliedRight,
        gum: S.run.gum - m.gum, found: (S.run.found || []).slice(m.found),
      });
      S.run.countedKills = b.kills;
      ended = true;
    }
  }
  clearClock();
  /* **次の問題の時計は、まだ動いていません。** ここを消しておかないと、
     次の設問を描くときに前の問題の経過ぶんだけバーが減った状態で出ます */
  S.run.timedOut = false;
  S.run.qStart = 0; S.run.qPaused = 0; S.run.qPauseAt = 0;
  S.run.i++; S.run.picked = null; S.run.hintsUsed = 0; S.run.cut = null;
  S.run.tipOpen = false; S.run.applied = null; S.run.settingOpen = false;
  S.run.verdict = null; S.run.hintOpen = false; S.run.skill = null;
  battleStep();
  const done = S.run.i >= S.run.ids.length;
  if (done) finishRun();
  if (ended && gated()) { S.run.gate = { kind: "end", wave: S.run.waves.length - 1 }; S.view = "wave"; }
  else if (done) S.view = "result";
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

  /* **スワイプも出題の画面と同じ帯立てです。** ここだけ帯が無いと、
     8問のあいだ戦いが画面から消えます（実際に消えていました）。
     **写真に高さが要るので、バトルの帯だけ少し詰めます**（`.qz.swipe`） */
  app.innerHTML = `
  <div class="qz swipe">
    ${battleBandHTML(q)}
    ${timeBarHTML("swipe")}
    <div class="qz-ask">
      <div class="swp-q">${esc(q.prompt)}</div>
      <div class="qmeta"><span class="grade ${q.newCurriculum ? "alt" : ""}">${esc(q.gradeLabel)}</span>
        <span class="unit">${esc(q.unit)}</span>${levelChip(q, "swipe")}</div>
    </div>
    <div class="qz-ans swp">
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
    </div>
    ${deckRow()}
  </div>`;

  wireSwipe(q);
  if (S.run.picked === null) armClock("swipe");
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
  clearClock();
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
    ${(() => {
      /* **倒したぶんの上乗せ。** 1問ごとの GUM・知識カード・クリスタルは
         倒せていても倒せていなくても同じで、動くのはここだけです */
      const b = S.run.battleBonus;
      if (!b || (!b.kills && !b.cleared)) return "";
      return `<p class="fine btwin"><b>たおした敵 ${b.kills}体</b>${
        b.cleared ? ` ・ 倒しきった束 ${b.cleared}つ` : ""}${
        b.gum ? ` ・ GUM +${b.gum}` : ""} ・ 点 +${b.score}</p>`;
    })()}
    ${(() => {
      /* **チェインと判定の内訳。そのセッションかぎりの記録です。**
         集計して持ち越しません（原則3-2）。平均回答時間のような統計も出しません */
      const js = S.run.judges || {};
      const any = JUDGES.some(j => js[j]);
      if (!S.run.maxChain && !any) return "";
      return `<p class="fine btchain">最高チェイン <b>${S.run.maxChain || 0}</b>${
        any ? " ・ " + JUDGES.filter(j => js[j]).map(j => `${j} ${js[j]}`).join(" / ") : ""}</p>`;
    })()}
    ${(() => {
      /* **解くと仲間が増えます。ガチャは引きません**（原則2） */
      const joined = S.run.joined || [];
      if (!joined.length) return "";
      return `<div class="panel lvup">
        <div class="phead"><h2>仲間になりました</h2></div>
        ${joined.map(h => `<p class="lvrow">
          <b>${esc(h.name)}</b><span>${esc(h.faction)} ・ AS ${esc(h.as.name)}</span></p>`).join("")}
        <p class="fine">解いた教科の知識カードが届いたので、確定で加わりました。
          <b>デッキに入れられます。</b></p>
      </div>`;
    })()}
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

/* ---------- デッキ編成（S-35 / S-36 / S-37） ---------- */

/** 属性の札。色は data/factions.json が持つ。クラス名は英字表記のほうを使う */
const facCls = f => "f-" + (DB.factionInfo?.[f]?.en || "X");
const facChip = (f, cls = "") =>
  `<span class="fac ${facCls(f)} ${cls}">${esc(f)}</span>`;

/**
 * **デッキ編成**（S-35）。黒ウィズの芯がここにあります。
 *
 * 見せたいことは1つだけ —— **左が先で、右ほど落ちる。**
 * 速く答えるほど右まで届くので、**並び順を決めることが「どれだけ速く
 * 答えるつもりか」の宣言**になります。
 */
function vDeck() {
  const heroes = deckHeroes();
  const have = haveBySubject();
  const cost = deckCostNow(), cap = deckCapNow(), over = cost > cap;
  const mp = mapProgress();

  app.innerHTML = `
  <header><div class="hbar"><div class="place">デッキ</div>
    <button class="mapbtn" id="back">もどる</button></div></header>
  <div class="pad">
    <div class="dk-cost${over ? " over" : ""}">
      <b>コスト ${cost} / ${cap}</b>
      ${over ? `<em>超過 −25%</em>` : ""}
      <span class="fine">上限は知識マップが伸ばします（${mp.done}/${mp.total}マス）</span>
    </div>

    <div class="dk-slots">${heroes.map((h, k) => {
      const ext = h && DB.extensions[S.deckExt?.[h.id]];
      const sk = ssOf(h);
      const mul = h ? (0.5 + Math.min(1, coverageFor(h, have)) * 1.5) : 0;
      return `<div class="dk-slot${h ? "" : " empty"}">
        <span class="dk-no">${k + 1}</span>
        <button class="dk-face" data-pick="${k}">
          ${h ? `<img src="${assetPath.hero(h.id)}" alt="${esc(h.name)}">` : `<i>＋</i>`}
        </button>
        <div class="dk-body">
          ${h ? `<b>${esc(h.name)}</b>${facChip(h.faction)}
            <span class="hr r${esc(h.rarity)}">${esc(h.rarity)}</span>
            <span class="dk-c">${h.cost}</span>
            <p class="dk-as"><em>AS</em> ${esc(h.as.name)}</p>
            <p class="fine">${esc(h.as.text)}</p>
            <p class="dk-mul">攻撃 ×${mul.toFixed(2)}<span class="fine">${
              esc(h.fit.join("・"))}の知識で伸びます</span></p>
            <button class="dk-ext" data-ext="${h.id}">
              ${ext && sk ? `<img src="${assetPath.ext(ext.id)}" alt=""><em>SS</em> ${esc(sk.name)}
                <span class="ssg">${Array.from({ length: ssNeed(ext) },
                  () => "<i></i>").join("")}</span>`
                : `<em>SS</em> エクステンションを装備する`}
            </button>`
          : `<b class="fine">空いています</b>`}
        </div>
        <div class="dk-move">
          <button class="dk-arw" data-mv="${k}:-1" ${k === 0 ? "disabled" : ""} aria-label="左へ">◀</button>
          <button class="dk-arw" data-mv="${k}:1" ${k === DECK_SIZE - 1 ? "disabled" : ""} aria-label="右へ">▶</button>
        </div>
      </div>`;
    }).join("")}</div>

    <div class="dk-order">
      <p class="dk-lead">速く答えるほど、右まで届く</p>
      ${JUDGES.map(j => `<div class="dk-j">
        <b class="j${j}">${j}</b>
        <span>${Array.from({ length: DECK_SIZE }, (_, k) =>
          `<i class="${k < asCount(j) ? "on" : ""}"></i>`).join("")}</span>
      </div>`).join("")}
    </div>
  </div>`;

  document.getElementById("back").onclick = () => go("home");
  app.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => {
    S.deckPick = Number(b.dataset.pick); go("deckpick");
  });
  app.querySelectorAll("[data-ext]").forEach(b => b.onclick = () => {
    S.deckPick = b.dataset.ext; go("deckext");
  });
  app.querySelectorAll("[data-mv]").forEach(b => b.onclick = () => {
    const [k, d] = b.dataset.mv.split(":").map(Number);
    const to = k + d;
    if (to < 0 || to >= DECK_SIZE) return;
    const deck = [...S.deck];
    [deck[k], deck[to]] = [deck[to], deck[k]];
    S.deck = deck;
    render();
  });
}

/**
 * **枠に入れるヒーローを選ぶ**（S-36）。
 *
 * **未解放のヒーローは、名前を伏せて条件と進み具合だけ見せます。**
 * 「あと◯枚で仲間になる」が、そのまま次の問いになります（原則7）。
 * **ガチャはありません**（原則2）。
 */
function vDeckPick() {
  const k = Number(S.deckPick) || 0;
  const have = haveBySubject();
  const list = [...DB.crew].sort((a, b) =>
    (S.crew?.[b.id] ? 1 : 0) - (S.crew?.[a.id] ? 1 : 0) ||
    DB.factionOrder.indexOf(a.faction) - DB.factionOrder.indexOf(b.faction) ||
    a.cost - b.cost);
  const used = new Set((S.deck || []).filter((id, i) => i !== k));

  app.innerHTML = `
  <header><div class="hbar"><div class="place">枠 ${k + 1} に入れる</div>
    <button class="mapbtn" id="back">もどる</button></div></header>
  <div class="pad">
    <div class="dk-list">${list.map(h => {
      const own = !!S.crew?.[h.id];
      const need = unlockNeed(h);
      const got = have[h.unlock?.subject] || 0;
      const mul = 0.5 + Math.min(1, coverageFor(h, have)) * 1.5;
      if (!own) return `<div class="dk-row locked">
        <span class="dk-face mini"><img src="${assetPath.hero(h.id)}" alt="" class="silhouette"></span>
        <div><b>???</b>${facChip(h.faction)}
          <p class="fine">${esc(h.unlock.subject)}の知識カード ${got}/${need} で仲間になります</p>
          <span class="mp-bar sm"><i style="width:${Math.min(100, Math.round(got / Math.max(1, need) * 100))}%"></i></span>
        </div></div>`;
      return `<button class="dk-row${used.has(h.id) ? " used" : ""}" data-h="${h.id}">
        <span class="dk-face mini"><img src="${assetPath.hero(h.id)}" alt=""></span>
        <div><b>${esc(h.name)}</b>${facChip(h.faction)}
          <span class="hr r${esc(h.rarity)}">${esc(h.rarity)}</span>
          <span class="dk-c">${h.cost}</span>
          <p class="dk-as"><em>AS</em> ${esc(h.as.name)}</p>
          <p class="fine">${esc(h.fit.join("・"))} ・ 攻撃 ×${mul.toFixed(2)}</p>
        </div>
        ${used.has(h.id) ? `<span class="fine">編成中</span>` : ""}
      </button>`;
    }).join("")}</div>
  </div>`;

  document.getElementById("back").onclick = () => go("deck");
  app.querySelectorAll("[data-h]").forEach(b => b.onclick = () => {
    const id = b.dataset.h;
    const deck = [...S.deck];
    const at = deck.indexOf(id);
    if (at >= 0) [deck[at], deck[k]] = [deck[k], deck[at]];   // すでに居れば入れ替え
    else deck[k] = id;
    S.deck = deck;
    go("deck");
  });
}

/**
 * **エクステンションを装備してSSを決める**（S-37）。
 *
 * **クラフトの出口がSSになります。** 何を作るかが、そのままどう戦うかに
 * なるので、「作りたい品が、解く教科を選ぶ理由になる」という筋がもう一段
 * つながります。
 */
function vDeckExt() {
  const hero = DB.crewById[S.deckPick];
  if (!hero) return go("deck");
  const owned = Object.keys(S.exts || {}).filter(id => DB.extensions[id]);
  const now = S.deckExt?.[hero.id];

  app.innerHTML = `
  <header><div class="hbar"><div class="place">${esc(hero.name)} に装備</div>
    <button class="mapbtn" id="back">もどる</button></div></header>
  <div class="pad">
    ${owned.length ? `<div class="dk-list">${
      RANK_ORDER.flatMap(rank => owned.filter(id => DB.extensions[id].rank === rank)).map(id => {
      const e = DB.extensions[id], sk = DB.extSkills?.[id];
      if (!sk) return "";
      return `<button class="dk-row${now === id ? " on" : ""}" data-e="${id}">
        <span class="dk-face mini"><img src="${assetPath.ext(id)}" alt=""></span>
        <div><b>${esc(e.name)}</b><span class="rank">${esc(e.rank)}</span>
          <p class="dk-as"><em>SS</em> ${esc(sk.name)}</p>
          <p class="fine">${esc(sk.text)}</p>
          <span class="ssg">${Array.from({ length: ssNeed(e) }, () => "<i></i>").join("")}
            <small>${ssNeed(e)}問で撃てます</small></span>
        </div></button>`;
      }).join("")}</div>`
    : `<p class="cue">まだ何も作っていません。クラフトで品を作ると、その品の技が
        スペシャルスキルになります。</p>`}
    <div class="stack">
      ${now ? `<button class="btn ghost" id="unequip">外す</button>` : ""}
      <button class="btn ghost" id="tocraft2">クラフトへ</button>
    </div>
  </div>`;

  document.getElementById("back").onclick = () => go("deck");
  document.getElementById("tocraft2").onclick = () => go("craft");
  const un = document.getElementById("unequip");
  if (un) un.onclick = () => { delete S.deckExt[hero.id]; render(); };
  app.querySelectorAll("[data-e]").forEach(b => b.onclick = () => {
    (S.deckExt ||= {})[hero.id] = b.dataset.e;
    go("deck");
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
  const tab = ["name", "icon", "title", "setting"].includes(S.myTab) ? S.myTab : "name";
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
    /* **出題を選ぶ画面から移してきました**（S-04 を「問題と解答だけ」にしたため）。
       設定は遊ぶたびに触るものではないので、置き場所はここが合っています */
    setting: `
      <div class="panel">
        <div class="phead"><h2>設定</h2></div>
        <label class="switch">
          <input type="checkbox" id="showexp" ${S.settings.showExplanationOnCorrect ? "checked" : ""}>
          <span class="sw"></span>
          <span class="lbl">正解した問題の解説を見る</span>
        </label>
        <p class="fine">${S.settings.showExplanationOnCorrect
          ? "正解しても英雄の解説と応用編が出ます。"
          : "正解したら演出だけで次へ進みます。応用編は出ません。間違えた問題の解説は必ず出ます。"}</p>
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
      <button data-t="setting" class="${tab === "setting" ? "on" : ""}">設定</button>
    </div>
    ${panels[tab]}
  </div>`;

  document.getElementById("back").onclick = () => go("home");
  const exp = document.getElementById("showexp");
  if (exp) exp.onchange = e => {
    S.settings.showExplanationOnCorrect = e.target.checked; render();
  };
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
