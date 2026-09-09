/* 画面描画。db と state を受け取り、#app に流し込む */

import { SUBJECTS, GRADES, RUN_LENGTH, inventory, inventoryBySubject,
         unlockedChapters, buildRun, gaugeBreakdown, challengeStage,
         cellKey, craftableKeys, nextHero, lockedHeroes, adviceFor } from "./engine.js";
import { matches } from "./normalize.js";
import { assetPath } from "./data.js";
import { saveState } from "./state.js";

const esc = s => String(s).replace(/[&<>"]/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const STAGE_LABELS = [
  "この英雄の、最も深いところ", "少し輪郭が見えてきた",
  "かなり近づいた", "義務教育で答えられる",
];

let DB, S, app;

export function mount(db, state, root) {
  DB = db; S = state; app = root;
  render();
}

function go(view) { S.view = view; render(); window.scrollTo(0, 0); }

function render() {
  // ホームだけ 100dvh の3層固定。それ以外は方眼紙のまま縦に流す
  const home = S.view === "home";
  app.classList.toggle("home", home);
  document.body.classList.toggle("home", home);

  ({ home: vHome, select: vSelect, quiz: vQuiz, result: vResult, craft: vCraft,
     heroes: vHeroes, hero: vHero, target: vTarget, challenge: vChallenge }[S.view])();
  drawToast();
  if (home) { startClock(); drawBattery(); fitAdvice(); }
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
const currentQ = () => DB.byId[S.run.ids[S.run.i]];

function heroFor(q) {
  const pool = heroesOwned().filter(h => h.fit.includes(q.subject));
  return pool.length ? pool[q.prompt.length % pool.length] : heroesOwned()[0];
}
const fitOf = (q, h) => h.fit.includes(q.subject);

function gemStrip(obj, cls = "") {
  return `<div class="gemrow ${cls}">` + Object.entries(DB.gems).map(([k, g]) =>
    `<span class="gem"><img src="${assetPath.gem(g.id)}" alt="${esc(g.name)}"><b>${obj[k] || 0}</b></span>`
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
  const craftable = craftableKeys(DB, S);
  const p = S.profile || {};

  app.innerHTML = `
  <div class="home-bg" style="background-image:url('${assetPath.bg("1006")}')"></div>

  <div class="layer layer-status">
    <div class="st-top">
      <span class="st-batt" id="batt" hidden>${batteryIcon()}<b></b></span>
      <span class="st-clock" id="clock">${clockText()}</span>
    </div>
    <div class="st-main">
      <img class="st-ava" src="${assetPath.hero(p.icon || "10001")}" alt="ユーザーアイコン">
      <div class="st-fields">
        <div class="st-line">
          <span class="st-title ${p.title ? "" : "none"}">${p.title ? esc(p.title) : "称号なし"}</span>
          <span class="st-gum"><img src="${assetPath.icon("gum")}" alt="GUM">${(S.gum || 0).toLocaleString("ja-JP")}</span>
        </div>
        <div class="st-name">${esc(p.name || "旅人")}</div>
      </div>
    </div>
    <div class="st-advice">
      <img src="${assetPath.icon("mai_sd")}" alt="">
      <p class="bubble" id="advice">${esc(adviceFor(DB, S))}</p>
    </div>
  </div>

  <div class="layer layer-stage">
    <div class="cal"><img src="${assetPath.icon("mch_icon")}" alt="">${dateText()}</div>
    ${target ? `
    <div class="tv">
      <div class="tv-art">
        ${locked.length > 1 ? `<button class="tv-arrow" id="prevhero" aria-label="前の英雄">‹</button>` : ""}
        <div class="tv-figure">
          <img src="${assetPath.rep(target.id)}" alt="${esc(target.name)}">
        </div>
        ${locked.length > 1 ? `<button class="tv-arrow" id="nexthero" aria-label="次の英雄">›</button>` : ""}
      </div>
      <div class="tv-name"><span class="hr r${target.rarity}">${esc(target.rarity)}</span>
        <b>${esc(target.name)}</b></div>
      ${locked.length > 1 ? `<div class="tv-dots">${locked.map((h, n) =>
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
        <img src="${assetPath.hero("10001")}" alt=""><b>ヒーロー</b></button>
      <button class="tile" id="toshop" disabled
        style="background-image:var(--g-shop),url('${assetPath.bg("1004")}')">
        <img src="${assetPath.hero("3037")}" alt=""><b>ショップ</b><small>準備中</small></button>
      <button class="tile" id="tocraft"
        style="background-image:var(--g-craft),url('${assetPath.bg("1046")}')">
        <img src="${assetPath.hero("2023")}" alt=""><b>クラフト</b>
        ${craftable.length ? `<i class="dot" title="クラフトできます"></i>` : ""}</button>
    </div>
    <button class="tile quiz" id="toquiz"
      style="background-image:var(--g-quiz),url('${assetPath.bg("1030")}')">
      <img src="${assetPath.ext("5003")}" alt=""><b>${RUN_LENGTH}問を解く</b></button>
  </div>`;

  document.getElementById("toquiz").onclick = () => go("select");
  document.getElementById("tocraft").onclick = () => go("craft");
  document.getElementById("toheroes").onclick = () => go("heroes");
  const c = document.getElementById("tochal");
  if (c) c.onclick = () => go("target");

  // カルーセル。矢印・ドットのほか、指で払っても動かす
  const shift = d => { S.stage.i = (i + d + locked.length) % locked.length; render(); };
  const prev = document.getElementById("prevhero");
  const nextBtn = document.getElementById("nexthero");
  if (prev) prev.onclick = () => shift(-1);
  if (nextBtn) nextBtn.onclick = () => shift(1);

  const art = app.querySelector(".tv-art");
  if (art && locked.length > 1) {
    let x0 = null;
    art.addEventListener("touchstart", ev => { x0 = ev.changedTouches[0].clientX; }, { passive: true });
    art.addEventListener("touchend", ev => {
      if (x0 === null) return;
      const dx = ev.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 40) shift(dx < 0 ? 1 : -1);
    }, { passive: true });
  }
}

/* ---------- 出題選択（在庫表示つき） ---------- */

function vSelect() {
  const bands = [["auto", "おまかせ"], ["e", "小学校"], ["j", "中学校"], ["w", "世界"]];
  const counts = inventoryBySubject(DB, S, S.select.band);
  const total = inventory(DB, S, S.select.band, "auto").length;
  const n = inventory(DB, S, S.select.band, S.select.subject).length;
  const worldLocked = !unlockedChapters(DB, S).has(3);
  const short = n > 0 && n < RUN_LENGTH;

  app.innerHTML = `
  <header><div class="hbar"><div class="place">出題を選ぶ</div>
    <button class="mapbtn" id="back">もどる</button></div></header>
  <div class="pad">
    <h2 style="margin-top:20px">どこを解きますか</h2>
    <p class="fine">おまかせは知識マップの白いマスから優先して出します。最後の1問は必ずいまの範囲の外から出ます。</p>

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
        ? `<p class="fine lock">この範囲は現在 ${n}問です。${n}問だけ出題します。</p>`
        : `<p class="fine">出題できる問題 ${n}問</p>`}

    <div class="stack"><button class="btn" id="start" ${n ? "" : "disabled"}>
      ${n ? `${Math.min(n, RUN_LENGTH)}問を始める` : "問題がありません"}</button></div>
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
}

function startRun() {
  const ids = buildRun(DB, S);
  S.run = { ids, i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null,
            gems: {}, right: 0, wrong: 0, appliedRight: 0,
            shortage: Math.max(0, RUN_LENGTH - ids.length) };
  go("quiz");
}

/* ---------- クイズ ---------- */

function vQuiz() {
  if (S.run.i >= S.run.ids.length) return go("result");
  const q = currentQ(), h = heroFor(q), fit = fitOf(q, h);
  const place = q.country ? `<b>${esc(q.country)}</b>` : `日本 <b>${esc(q.gradeLabel)}</b>`;

  app.innerHTML = `
  <header><div class="hbar">
    <div class="place">${place} ・ ${esc(q.subject)}</div>
    <div class="score">${S.run.i + 1} / ${S.run.ids.length}</div></div>
    <div class="track"><i style="width:${Math.round(S.run.i / S.run.ids.length * 100)}%"></i></div></header>
  <div class="pad">
    <div class="qmeta"><span class="grade ${q.newCurriculum ? "alt" : ""}">${esc(q.gradeLabel)}</span>
      <span class="unit">${esc(q.unit)}</span></div>
    <div class="qtext">${esc(q.prompt)}</div>
    ${q.figure ? `<div class="figure">${DB.figures[q.figure]}</div>` : ""}
    <div class="choices">${q.choices.map((t, i) =>
      `<button class="choice" data-i="${i}">${esc(t)}</button>`).join("")}</div>
    <div class="hero-row">
      <img class="ava" src="${assetPath.hero(h.id)}" alt="">
      <div><div class="hero-name">${esc(h.name)}</div>
        <div class="hero-fit ${fit ? "good" : ""}">${fit
          ? "この分野が得意 ・ ヒント3段階" : "専門外 ・ ヒントは2段階まで"}</div></div>
      <button class="hintbtn" id="hint">ヒント</button></div>
    <div class="hints" id="hints"></div><div id="verdict"></div>
  </div>`;

  document.getElementById("hint").onclick = () => { S.run.hintsUsed++; drawHints(q, h); };
  app.querySelectorAll(".choices > .choice").forEach(b =>
    b.onclick = () => onPick(Number(b.dataset.i)));
  drawHints(q, h);
}

function drawHints(q, h) {
  const max = fitOf(q, h) ? 3 : 2;
  document.getElementById("hints").innerHTML = q.hints.slice(0, S.run.hintsUsed)
    .map((t, i) => `<div class="hint"><b>ヒント ${i + 1}</b>${esc(t)}</div>`).join("");
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

function onPick(idx) {
  if (S.run.picked !== null) return;
  const q = currentQ(), h = heroFor(q), ok = idx === q.answer;
  S.run.picked = idx;
  S.seen[q.id] = 1;

  app.querySelectorAll(".choices > .choice").forEach((b, i) => {
    b.disabled = true;
    if (i === idx) markChoice(b, ok);
    else if (i === q.answer && !ok) { b.style.borderColor = "var(--pen)"; b.style.color = "var(--pen)"; }
    else b.classList.add("dim");
  });

  const gemKey = DB.subjectToGem[q.subject];
  let gained = 0;
  if (ok) {
    S.run.right++;
    S.score += Math.max(4, 10 - S.run.hintsUsed * 2);
    gained = 1 + (q.chapter >= 2 ? 1 : 0);
    S.gems[gemKey] += gained;
    S.run.gems[gemKey] = (S.run.gems[gemKey] || 0) + gained;
    if (S.cells[cellKey(q)] !== "st") S.cells[cellKey(q)] = "ok";
  } else {
    S.run.wrong++;
    if (!S.cells[cellKey(q)]) S.cells[cellKey(q)] = "ng";
  }
  S.cards[q.card] = true;
  drawHints(q, h);

  // テンポ優先モード：正解なら演出だけ見せて次へ
  if (ok && !S.settings.showExplanationOnCorrect) {
    S.toast = `<span class="seal">✓</span><em>${esc(q.card)}</em>` +
      (gained ? `<img src="${assetPath.gem(DB.gems[gemKey].id)}" alt=""> ×${gained}` : "");
    drawToast();
    setTimeout(() => { S.toast = null; advance(); }, 750);
    return;
  }

  S.run.tipOpen = false; S.run.applied = null;
  drawVerdict(q, h, ok, gained);
}

function drawVerdict(q, h, ok, gained) {
  const head = ok
    ? (S.run.hintsUsed ? "正解。ヒントを使っても、解けたことに変わりはない。" : "正解。")
    : "面白い単元に当たった。ここは聞いていこう。";
  const gemKey = DB.subjectToGem[q.subject];
  document.getElementById("verdict").innerHTML = `
  <div class="verdict"><div class="vhead ${ok ? "ok" : "ng"}">${esc(head)}</div>
    <div class="lesson">
      <div class="speaker"><img class="ava sm" src="${assetPath.hero(h.id)}" alt="">
        <span>${esc(h.name)}</span></div>
      <p>${esc(q.lesson)}</p>
      <div class="gain"><span class="seal">✓</span><span>知識カード ・ <em>${esc(q.card)}</em></span></div>
      ${gained ? `<div class="gain gem2"><img src="${assetPath.gem(DB.gems[gemKey].id)}" alt="">
        <span>${esc(DB.gems[gemKey].name)} × ${gained}</span></div>` : ""}
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
    ${answered ? `<div class="snote"><b>${S.run.applied.ok ? "正解。魔石をもう1つ" : "惜しい。"}</b> ${esc(a.note)}</div>` : ""}</div>`;

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
    const gemKey = DB.subjectToGem[q.subject];
    S.gems[gemKey] += 1;
    S.run.gems[gemKey] = (S.run.gems[gemKey] || 0) + 1;
    S.cards[q.card + "（応用）"] = true;
  }
  drawApplied(q, ok); drawActions(q, ok);
}

function drawActions(q, ok) {
  const acts = document.getElementById("acts");
  const last = S.run.i + 1 >= S.run.ids.length;
  acts.innerHTML = `
    ${ok && q.applied && !S.run.applied
      ? `<button class="btn stretch" id="tostretch">応用編にも挑戦する ・ 魔石+1</button>` : ""}
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
  S.run.i++; S.run.picked = null; S.run.hintsUsed = 0;
  S.run.tipOpen = false; S.run.applied = null;
  render(); window.scrollTo(0, 0);
}

/* ---------- リザルト ---------- */

function vResult() {
  S.runs++;
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
      <div><b>${rate}<small style="font-size:15px">%</small></b><span>正答率</span></div></div>
    ${S.run.shortage ? `<p class="cue">この範囲は在庫が ${S.run.ids.length}問だったので、${S.run.ids.length}問で終わりました。</p>` : ""}
    <div class="panel">
      <div class="phead"><h2>獲得した魔石</h2></div>${gemStrip(S.run.gems, "big")}
      <p class="fine">所持: ${Object.entries(DB.gems).map(([k, g]) => `${g.el} ${S.gems[k]}`).join(" ・ ")}</p>
    </div>
    ${craftable ? `<p class="cue">クラフトできるエクステンションが ${craftable}種あります。</p>` : ""}
    ${next ? `<p class="cue">次に挑めるのは ${esc(next.name)}（${next.rarity}）。いまの知識で難易度ゲージを ${
      Math.round(nextGauge.damage / nextGauge.hp * 100)}% 削れます。</p>` : ""}
    <div class="stack">
      <button class="btn" id="again">もう${RUN_LENGTH}問 ・ ${S.select.band === "auto" ? "おまかせ" : "同じ範囲"}</button>
      <button class="btn ghost" id="change">範囲を変えて解く</button>
      ${craftable ? `<button class="btn ghost" id="craft">クラフトする</button>` : ""}
      ${next ? `<button class="btn stretch" id="chal">${esc(next.name)}に挑む</button>` : ""}
      <button class="btn ghost" id="home">ホームへ</button></div>
  </div></div>`;

  document.getElementById("again").onclick = startRun;
  document.getElementById("change").onclick = () => go("select");
  document.getElementById("home").onclick = () => go("home");
  const c = document.getElementById("craft"); if (c) c.onclick = () => go("craft");
  const b = document.getElementById("chal"); if (b) b.onclick = () => startChallenge(next.id);
}

/* ---------- クラフト・装備 ---------- */

function extIcon(key) {
  const color = { lamp: "var(--pen)", codex: "var(--ai)", proto: "var(--brass)",
                  chart: "var(--moss)", ring: "var(--ink)" }[key];
  const path = {
    lamp: "M20 6 L28 20 L20 34 L12 20 Z", codex: "M8 10 h24 v20 h-24 z M20 10 v20",
    proto: "M6 30 h28 M6 30 A14 14 0 0 1 34 30", chart: "M20 6 L34 34 L20 26 L6 34 Z",
    ring: "M20 8 a12 12 0 1 0 0.1 0 M20 2 v6 M20 32 v6 M2 20 h6 M32 20 h6" }[key];
  return `<svg viewBox="0 0 40 40"><path d="${path}" fill="none" stroke="${color}"
    stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function vCraft() {
  app.innerHTML = `
  <header><div class="hbar"><div class="place">クラフト</div>
    <button class="mapbtn" id="back">もどる</button></div></header>
  <div class="pad">${gemStrip(S.gems, "big")}
    <p class="fine">エクステンションは攻撃力ではありません。持っている知識が、どこまで遠くの問いに届くかを広げます。</p>
    ${(() => { const able0 = new Set(craftableKeys(DB, S)); return Object.entries(DB.extensions).map(([k, e]) => {
      const have = S.exts[k] || 0, able = able0.has(k);
      return `<div class="ext ${able ? "" : "dim"}">
        <div class="exthead"><div class="exticon">${extIcon(k)}</div>
          <div><div class="extname">${esc(e.name)}${have ? ` <span class="cnt">×${have}</span>` : ""}</div>
            <div class="extsub">${e.subs.join(" ・ ")}</div></div></div>
        <p class="extt">${esc(e.text)}</p>
        <div class="cost">${Object.entries(e.cost).map(([g, v]) =>
          `<span class="${S.gems[g] >= v ? "" : "short"}"><img src="${assetPath.gem(DB.gems[g].id)}" alt="">${v}</span>`).join("")}
          <button class="mini" data-k="${k}" ${able ? "" : "disabled"}>クラフト</button></div></div>`;
    }).join(""); })()}</div>`;
  document.getElementById("back").onclick = () => go(S.runs ? "result" : "home");
  app.querySelectorAll(".mini").forEach(b => b.onclick = () => {
    const e = DB.extensions[b.dataset.k];
    if (!craftableKeys(DB, S).includes(b.dataset.k)) return;
    Object.entries(e.cost).forEach(([g, v]) => S.gems[g] -= v);
    S.exts[b.dataset.k] = (S.exts[b.dataset.k] || 0) + 1;
    render();
  });
}

function vHero() {
  const h = DB.heroById[S.heroView], eq = S.equip[h.id];
  const inv = Object.entries(S.exts).filter(([, n]) => n > 0);
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
      ${inv.length ? `<div class="eqlist">
        <button class="eqi ${!eq ? "on" : ""}" data-k="">外す</button>
        ${inv.map(([k]) => `<button class="eqi ${eq === k ? "on" : ""}" data-k="${k}">
          <span class="exticon sm">${extIcon(k)}</span>${esc(DB.extensions[k].name)}</button>`).join("")}</div>
        ${eq ? `<p class="fine">${DB.extensions[eq].subs.some(s => h.fit.includes(s))
          ? "この英雄の得意分野と噛み合っています。効果が2倍になります。"
          : "得意分野とは噛み合っていません。効果は通常のままです。"}</p>` : ""}`
        : `<p class="empty">まだ持っていません。魔石を集めてクラフトしてください。</p>`}</div>
  </div>`;
  document.getElementById("back").onclick = () => go("heroes");
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
      <div class="phead"><h2>魔石</h2><span class="sub">${Object.values(S.gems).reduce((a, b) => a + b, 0)}個</span></div>
      ${gemStrip(S.gems)}
      <p class="fine">魔石は正解した単元の分野から確定で落ちます。運の要素はありません。</p>
    </div>`;

  const codexPanel = `
    <p class="fine">解放は運ではありません。関係する知識カードを集めるほど、難易度ゲージは最初から削れた状態で始まります。</p>
    <div class="cgrid">${DB.heroes.map(h => {
      const own = S.owned[h.id];
      const g = h.rel ? gaugeBreakdown(DB, S, h) : null;
      const pct = g ? Math.round(g.damage / g.hp * 100) : 0;
      return `<div class="ccard ${own ? "" : "locked"}">
        <img src="${assetPath.hero(h.id)}" alt="">
        <div class="cn">${own ? esc(h.name) : "？？？"}</div>
        <div class="hr r${h.rarity}">${esc(h.rarity)}</div>
        ${own ? "" : `<div class="cg"><i style="width:${pct}%"></i></div><div class="cgt">${pct}%</div>`}</div>`;
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

/* ---------- 挑戦先を選ぶ ---------- */

function vTarget() {
  const locked = lockedHeroes(DB, S);
  const here = locked[S.stage.i]?.id;

  app.innerHTML = `
  <header><div class="hbar"><div class="place">どの英雄に挑むか</div>
    <button class="mapbtn" id="back">もどる</button></div></header>
  <div class="pad">
    <p class="fine" style="margin-top:16px">ゲージを削るのは知識カードです。エクステンションは、どの知識が関連としてカウントされるかを広げます。</p>
    ${locked.map(h => {
      const g = h.rel ? gaugeBreakdown(DB, S, h) : null;
      const pct = g ? Math.round(g.damage / g.hp * 100) : 0;
      const top = g && g.rows.length ? g.rows.map(r => `${r.label} −${r.value}`).join(" ・ ")
                                     : "この英雄に関わる知識をまだ持っていません";
      return `<button class="trow ${h.id === here ? "on" : ""}" data-h="${h.id}">
        <img src="${assetPath.hero(h.id)}" alt="">
        <span class="ti">
          <span class="tn">${esc(h.name)}<span class="hr r${h.rarity}">${esc(h.rarity)}</span></span>
          <span class="tg"><i style="width:${pct}%"></i></span>
          <span class="tp">いまの知識でゲージを ${pct}% 削れます</span>
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
                  damage: 0, tries: 0, done: false, message: "" };
  go("challenge");
}

function vChallenge() {
  const c = S.challenge, h = DB.heroById[c.heroId], b = c.breakdown;
  const stage = challengeStage(c.damage, b.hp);
  const prompt = h.ch.v[3 - stage];

  app.innerHTML = `
  <header><div class="hbar"><div class="place">チャレンジ ・ ${esc(h.name)}</div>
    <button class="mapbtn" id="back">${c.done ? "もどる" : "やめる"}</button></div></header>
  <div class="pad">
    <div class="battle">
      <img class="bhero ${c.done ? "won" : ""}" src="${assetPath.hero(h.id)}" alt="">
      <div class="bmeta"><div class="bn">${esc(h.name)}</div>
        <div class="hr r${h.rarity}">${esc(h.rarity)}</div></div>
      <div class="gauge"><i style="width:${Math.round((1 - c.damage / b.hp) * 100)}%"></i>
        <span>難易度 ${b.hp - c.damage} / ${b.hp}</span></div>
      <div class="glabel">${esc(STAGE_LABELS[stage])}</div>
    </div>
    ${c.phase === "intro" ? `
      <div class="panel"><div class="phead"><h2>持っている知識で削る</h2></div>
        ${b.rows.length ? b.rows.map(r => `<div class="brow"><div>
            <div class="bt">${esc(r.label)}</div><div class="bs">${esc(r.detail)}</div></div>
          <div class="bv">−${r.value}</div></div>`).join("")
          : `<p class="empty">この英雄に関わる知識をまだ持っていません。まずは問題を解いてください。</p>`}
        <div class="btotal">合計 −${b.damage} <span class="bhp">難易度 ${b.hp}</span></div></div>
      <div class="stack"><button class="btn" id="fight">挑む</button></div>`
    : `
      <div class="qtext ch">${esc(prompt)}</div>
      ${c.done ? `
        <div class="lesson"><div class="speaker"><img class="ava sm" src="${assetPath.hero(h.id)}" alt="">
          <span>${esc(h.name)}</span></div><p>${esc(h.flavor)}</p>
          <div class="gain"><span class="seal">✓</span><span>解放 ・ <em>${esc(h.name)}</em></span></div>
          ${h.unlocks != null ? `<div class="gain gem2"><span class="seal">＋</span>
            <span>新しい出題範囲が開きました</span></div>` : ""}</div>
        <div class="stack"><button class="btn" id="done">図鑑を見る</button>
          <button class="btn ghost" id="home2">ホームへ</button></div>`
      : `<div class="answer">
          <input id="ans" type="text" placeholder="答えを入力（ひらがなでも可）" autocomplete="off">
          <button class="btn" id="submit">答える</button>
          ${c.message ? `<div class="chmsg">${esc(c.message)}</div>` : ""}
          ${c.tries >= 2 && stage < 3 ? `<p class="fine">解けなくても構いません。知識カードが増えれば、次はゲージがもっと削れた状態から始まります。</p>` : ""}
        </div>`}`}
  </div>`;

  document.getElementById("back").onclick = () => go(c.done ? "home" : "target");
  const f = document.getElementById("fight");
  if (f) f.onclick = animateGauge;
  const submit = document.getElementById("submit");
  if (submit) {
    const input = document.getElementById("ans");
    const send = () => {
      if (matches(input.value, h.ch.ans)) { S.owned[h.id] = 1; c.done = true; c.message = ""; }
      else if (input.value.trim()) { c.tries++; c.message = "ちがう。もう一度考えてみよう。"; }
      else return;
      render();
    };
    submit.onclick = send;
    input.onkeydown = e => { if (e.key === "Enter") send(); };
    input.focus();
  }
  const d = document.getElementById("done");
  if (d) d.onclick = () => { S.heroesTab = "codex"; go("heroes"); };
  const hm = document.getElementById("home2"); if (hm) hm.onclick = () => go("home");
}

function animateGauge() {
  const c = S.challenge, target = c.breakdown.damage, hp = c.breakdown.hp;
  c.phase = "fight";
  const bar = document.querySelector(".gauge i");
  const text = document.querySelector(".gauge span");
  const label = document.querySelector(".glabel");
  const stack = document.querySelector(".stack");
  if (stack) stack.innerHTML = "";
  let d = 0;
  const step = () => {
    d = Math.min(target, d + Math.max(1, target / 26));
    if (bar) {
      bar.style.width = Math.round((1 - d / hp) * 100) + "%";
      text.textContent = `難易度 ${Math.round(hp - d)} / ${hp}`;
      label.textContent = STAGE_LABELS[challengeStage(d, hp)];
    }
    if (d < target) requestAnimationFrame(step);
    else { c.damage = target; setTimeout(render, 420); }
  };
  requestAnimationFrame(step);
}
