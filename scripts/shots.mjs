#!/usr/bin/env node
/* **全画面を実際に開いて撮り、`docs/screens/` に並べる。**

     npm run shots            ぜんぶ撮る
     npm run shots -- S-06    その画面だけ撮り直す

   画面IDの一覧と出し方は `scripts/screens.mjs`。判定そのものは `views.screenId()` が
   持っていて、**撮ったあとに突き合わせます。** 表と実装がズレたらここで落ちます
   （ズレたまま古い絵が残ると、レビューの指摘先が別の画面になります）。

   撮った絵は webp にします。PNG のままだと1枚が数百KBあり、24枚をリポジトリに
   置くと重くなります。**見比べるのが目的なので、この圧縮で足ります。** */

import { mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { SCREENS } from "./screens.mjs";

let sharp;
try { sharp = (await import("sharp")).default; }
catch { console.error("sharp が見つかりません。先に npm install を走らせてください。"); process.exit(1); }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs/screens");
const PAGE = "file://" + join(ROOT, "dist/index.html");
const W = 390, H = 844;                 // iPhone 相当。ふだん遊ぶ幅で見る
/* **縦に長い画面は途中で切ります。** ショップは100種、クラフトは108種を縦に並べるので、
   全部撮ると webp の上限（16383px）を超えて書けません。レビューで見たいのは
   並びの作りと1件ぶんの見え方なので、上から4000px（実寸8000px）あれば足ります。
   切ったことは一覧に出します——黙って切ると「下が無い」と読まれます。 */
const MAX_CSS = 4000;

if (!existsSync(join(ROOT, "dist/index.html"))) {
  console.error("dist/index.html がありません。先に npm run build を走らせてください。");
  process.exit(1);
}

/* playwright を上げると期待する版番号が動くのに、置いてある実体は古いままのことがある。
   実体はあるので、見つけて渡せば動く（touch-check と同じ手） */
const findChromium = () => {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return null;
  for (const d of readdirSync(root).filter(x => x.startsWith("chromium-")).sort().reverse()) {
    const exe = join(root, d, "chrome-linux", "chrome");
    if (existsSync(exe)) return exe;
  }
  return null;
};

const only = process.argv.slice(2).filter(a => !a.startsWith("--"));
const targets = only.length ? SCREENS.filter(s => only.includes(s.id)) : SCREENS;
if (!targets.length) { console.error(`そのIDはありません: ${only.join(" ")}`); process.exit(1); }

await mkdir(OUT, { recursive: true });
const exe = findChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const shot = [];
let bad = 0;

for (const s of targets) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H },
                                         hasTouch: true, isMobile: true,
                                         deviceScaleFactor: 2, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(e.message));
  try {
    await page.goto(PAGE);
    await page.waitForTimeout(350);
    /* 残っている進行を消してから作る。前の画面の状態が漏れると、
       撮れた絵が「その画面の素の姿」でなくなる */
    await page.evaluate(() => { try { localStorage.clear(); } catch {} });
    await page.reload();
    await page.waitForTimeout(350);

    /* 出題の画面は、どの設問を撮ったかも控えます。**「S-06 の during が…」より
       「S-06（gaikokugo-071）が…」のほうが、直す先が一意に決まります** */
    const qid = (await s.go(page)) || await page.evaluate(() =>
      S.view === "quiz" ? (S.run.ids[S.run.i] || null) : null);
    await page.evaluate(() => render());
    await page.waitForTimeout(450);          // 画像とフォントの読みこみ待ち

    // **実装が返すIDと突き合わせる。** ズレたら、この絵は別の画面のもの
    const got = await page.evaluate(() => screenId());
    if (got !== s.id) throw new Error(`views.screenId() は ${got} を返しました（表は ${s.id}）`);

    const full = await page.evaluate(() => document.documentElement.scrollHeight);
    const cut = full > MAX_CSS;
    /* **切るときは画面の高さのほうを変えます。** `clip` は表示領域に閉じるので、
       `clip` だけ渡すと 844px ぶんしか撮れません（一度そうなりました）。
       表示領域を伸ばしてから全面を撮ると、狙った高さで切れます */
    if (cut) {
      await page.setViewportSize({ width: W, height: MAX_CSS });
      await page.evaluate(() => { window.scrollTo(0, 0); render(); });
      await page.waitForTimeout(350);
    }
    const png = await page.screenshot({ fullPage: !cut });
    const webp = await sharp(png).webp({ quality: 82 }).toBuffer();
    const meta = await sharp(webp).metadata();
    await writeFile(join(OUT, `${s.id}.webp`), webp);
    shot.push({ ...s, w: meta.width, h: meta.height, kb: Math.round(webp.length / 1024), errs, cut, full, qid });
    console.log(`  ✓ ${s.id}  ${s.name}  ${meta.width}×${meta.height}  ${Math.round(webp.length / 1024)}KB` +
                (cut ? `  ※ 全体 ${full}px を ${MAX_CSS}px で切りました` : "") +
                (errs.length ? `  ※ JSエラー ${errs.length}件` : ""));
    if (errs.length) { bad++; errs.forEach(e => console.warn(`      ${e}`)); }
  } catch (e) {
    console.warn(`  ✗ ${s.id}  ${s.name}  ${e.message}`);
    bad++;
  }
  await ctx.close();
}
await browser.close();

/* ---- 見比べる1枚のページ ---- */
/* 撮り直しが一部だけでも、目次はいつも全部を並べる。**無い絵は「未撮影」と出します。**
   黙って抜けると、その画面を見落とします */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const have = new Set((await readdir(OUT)).filter(f => f.endsWith(".webp")).map(f => f.replace(/\.webp$/, "")));
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");

await writeFile(join(OUT, "index.html"), `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>画面の一覧 — 世界の教室</title><style>
:root{--ink:#1c2330;--sub:#6b7583;--line:#e0e5ec;--bg:#f6f7fa}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:14px/1.7 system-ui,-apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif}
header{background:#fff;border-bottom:1px solid var(--line);padding:18px 22px}
h1{font-size:17px;margin:0 0 4px}
header p{margin:0;color:var(--sub);font-size:13px}
main{padding:22px;max-width:1500px;margin:0 auto;
  display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:22px}
figure{margin:0;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden;
  display:flex;flex-direction:column}
figure.miss{border-style:dashed;background:#fff8f8}
.shot{background:#eef0f5;max-height:520px;overflow:hidden;display:flex;justify-content:center}
.shot img{width:100%;height:auto;display:block}
.shot a{display:block;width:100%}
.none{padding:60px 12px;text-align:center;color:#b03636;font-weight:700}
figcaption{padding:10px 13px 13px}
.id{font:700 12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff;
  background:#1c2330;border-radius:5px;padding:2px 7px;display:inline-block}
.nm{font-weight:700;margin:7px 0 3px}
.nt,.sz{color:var(--sub);font-size:12px;line-height:1.6}
.qid{margin:4px 0 0;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#3c4656}
.sz{margin-top:5px}
@media (max-width:480px){main{padding:14px;gap:14px}}
</style></head><body>
<header><h1>画面の一覧 ・ ${have.size} / ${SCREENS.length} 枚</h1>
<p>${stamp} に <code>npm run shots</code> で撮ったもの。幅 ${W}px（iPhone相当）の実機ブラウザーです。
絵を押すと原寸で開きます。<b>「S-06 の帯が…」のようにIDで指してください。</b>
出題の画面には、撮ったときの設問IDも出しています。
実機で見ているときは、URLの末尾に <code>#review</code> を付けると画面の隅に同じ番号が出ます。</p></header>
<main>
${SCREENS.map(s => {
  const ok = have.has(s.id);
  const got = shot.find(x => x.id === s.id);
  return `<figure class="${ok ? "" : "miss"}">
  <div class="shot">${ok
    ? `<a href="${s.id}.webp" target="_blank" rel="noopener"><img src="${s.id}.webp" alt="${esc(s.name)}" loading="lazy"></a>`
    : `<p class="none">未撮影</p>`}</div>
  <figcaption><span class="id">${s.id}</span>
    <p class="nm">${esc(s.name)}</p>
    <p class="nt">${esc(s.note)}</p>
    ${got?.qid ? `<p class="qid">設問 <b>${esc(got.qid)}</b></p>` : ""}
    ${got ? `<p class="sz">${got.w}×${got.h} ・ ${got.kb}KB${
        got.cut ? ` ・ <b>上から${MAX_CSS}pxまで</b>（全体は${got.full}px）` : ""}${
        got.errs.length ? ` ・ <b style="color:#b03636">JSエラー ${got.errs.length}件</b>` : ""}</p>` : ""}
  </figcaption></figure>`;
}).join("\n")}
</main></body></html>\n`);

console.log(`\n${shot.length}枚 撮りました  →  docs/screens/`);
console.log(`一覧: docs/screens/index.html`);
if (have.size < SCREENS.length)
  console.log(`※ まだ ${SCREENS.length - have.size}枚 撮れていません（一覧に「未撮影」と出ます）`);
process.exit(bad ? 1 : 0);
