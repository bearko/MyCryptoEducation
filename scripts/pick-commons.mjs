#!/usr/bin/env node
/* 写真を「見て選ぶ」ための画面。手元でだけ走らせます（CI では走らせません）。

     node scripts/pick-commons.mjs [キー ...]

   キーを省くと、台帳のうち file がまだ無い行を全部まとめて見ます。
   ブラウザーで候補が並ぶので、**よさそうな1枚を押すだけ**です。押した時点で
   webp が書かれ、data/images.json の欄も埋まります。

   **なぜ画面が要るのか。** これまでは3往復かかっていました——
   検索語を書く → `--list` の出力を読む → `commons` に File:名 を書く → 採る。
   しかも文字だけなので、**写っているものが適切かは結局見ないと分かりません。**
   実際に、婚礼の写真・顔だけの接写・カフェにいる人・マヨネーズの皿が来ました。
   見て選ぶ形にすると1往復で済み、しかも判断の材料が本物になります。

   ライセンスの線は `commons-lib.mjs` の usability が引きます。使えないものは
   **消さずに、理由を付けて灰色で並べます。** 「なぜ何も採れなかったのか」が
   画面から読めないと、検索語を直しようがないためです。 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gather, describe, adopt, usability, normalizeLicense, deepQueries,
         asFresh, unpark, parkedKeys, sleep, WAIT } from "./commons-lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "public/commons";
const PORT = Number(process.env.PICK_PORT || 3100);
const args = process.argv.slice(2);
const SELFTEST = args.includes("--selftest");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* ---- 画面 ---- */

const page = model => `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>写真を選ぶ — 世界の教室</title><style>
:root{--ink:#1c2330;--sub:#66707f;--line:#dfe4ec;--bg:#f7f8fb;--ok:#1a7f4b;--no:#b03636}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:14px/1.7 system-ui,-apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif}
header{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line);
  padding:14px 20px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
h1{font-size:16px;margin:0;font-weight:700}
.count{color:var(--sub)}
button{font:inherit;border:1px solid var(--line);background:#fff;border-radius:8px;
  padding:7px 14px;cursor:pointer}
button:hover{background:#f0f2f7}
main{padding:20px;max-width:1280px;margin:0 auto}
section{background:#fff;border:1px solid var(--line);border-radius:12px;
  padding:16px 18px;margin-bottom:22px}
section.done{opacity:.55}
.head{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;margin-bottom:4px}
.key{font-weight:700;font-size:15px}
.tf{font-size:11px;border:1px solid #c9a227;color:#8a6d0b;border-radius:99px;padding:1px 8px}
.alt{color:var(--sub);margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}
figure{margin:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff}
figure.pick{cursor:pointer}
figure.pick:hover{border-color:#1c2330;box-shadow:0 2px 10px rgba(0,0,0,.10)}
figure.no{opacity:.45}
figure.chosen{border-color:var(--ok);box-shadow:0 0 0 2px var(--ok) inset}
.shot{height:150px;display:flex;align-items:center;justify-content:center;background:#eef0f5}
.shot img{max-width:100%;max-height:150px;display:block}
figcaption{padding:8px 10px;font-size:12px;line-height:1.5}
.lic{font-weight:700}
.via,.why,.name{color:var(--sub);display:block}
/* 折り返しを許すのはファイル名だけ。寸法まで break-all にすると
   「640×48 / 0」と割れて読めなくなる */
.name{word-break:break-all}
.why{color:var(--no)}
.msg{margin-top:10px;font-weight:700}
.msg.ok{color:var(--ok)} .msg.ng{color:var(--no)}
.err{color:var(--no);font-size:12px}
.empty{color:var(--no)}
</style></head><body>
<header><h1>写真を選ぶ</h1>
<span class="count"><b id="left">${model.length}</b> 件のこり</span>
<button id="quit">終わる</button>
<span class="count">よさそうな1枚を押すと、その場で取り込みます。</span></header>
<main>
${model.map(m => `<section id="s-${esc(m.key)}">
  <div class="head"><span class="key">${esc(m.key)}</span>
    ${m.entry.titleFree ? '<span class="tf">題名を伏せる用 ◎のみ</span>' : ""}
    <span class="count">${esc(m.entry.use || "")}</span></div>
  <p class="alt">${esc(m.entry.alt || "")}</p>
  ${m.errors.length ? `<p class="err">引けなかった源: ${esc(m.errors.join(" / "))}</p>` : ""}
  ${m.cands.length ? `<div class="grid">${m.cands.map(c => `
    <figure class="${c.use.ok ? "pick" : "no"}" data-key="${esc(m.key)}" data-title="${esc(c.title)}">
      <div class="shot">${c.thumb ? `<img src="${esc(c.thumb)}" loading="lazy" alt="">` : "—"}</div>
      <figcaption>
        <span class="lic">${c.use.mark} ${esc(c.license)}</span>
        <span class="via">${esc(c.via)}${c.width ? ` ・ ${c.width}×${c.height}` : ""}</span>
        <span class="name">${esc(c.objectName || c.title)}</span>
        ${c.note ? `<span class="via">${esc(c.note)}</span>` : ""}
        ${c.use.ok ? "" : `<span class="why">${esc(c.use.why)}</span>`}
      </figcaption></figure>`).join("")}</div>`
    : `<p class="empty">候補がありません。検索語を短くするか、entity / wikipedia を書いてください。</p>`}
  <p class="msg" id="m-${esc(m.key)}"></p>
</section>`).join("")}
</main><script>
let left = ${model.length};
document.addEventListener("click", async ev => {
  const fig = ev.target.closest("figure.pick");
  if (!fig) return;
  const { key, title } = fig.dataset;
  const msg = document.getElementById("m-" + key);
  msg.className = "msg"; msg.textContent = "取り込んでいます…";
  try {
    const r = await fetch("/pick", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, title }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "失敗");
    msg.className = "msg ok"; msg.textContent = "✓ " + j.text;
    fig.parentElement.querySelectorAll("figure").forEach(f => f.classList.remove("chosen"));
    fig.classList.add("chosen");
    const sec = document.getElementById("s-" + key);
    if (!sec.classList.contains("done")) { sec.classList.add("done"); left--; }
    document.getElementById("left").textContent = left;
  } catch (e) { msg.className = "msg ng"; msg.textContent = "✗ " + e.message; }
});
document.getElementById("quit").addEventListener("click", async () => {
  await fetch("/done", { method: "POST" });
  document.body.innerHTML = "<main><p>終わりました。端末に戻ってください。</p></main>";
});
</script></body></html>`;

/* ---- 台帳と候補あつめ ---- */

const bookPath = join(ROOT, "data/images.json");
const bookBefore = await readFile(bookPath, "utf8");
const book = JSON.parse(bookBefore);
const allow = book.allow.map(s => s.toLowerCase());
const keys = args.filter(a => !a.startsWith("--"));
/* **park した行も開きます。**
   park は「自動では当たらなかった」という印で、**そういう行こそ人が見て選ぶ出番**です。
   ここを開けないと行き止まりになります（16行を park した直後、この画面が
   「選ぶものはありません」と言いました）。
     npm run pick:commons -- --parked        park した行をぜんぶ並べる
     npm run pick:commons -- obj-uma         名指し（park にあっても開く）
   **台帳はまだ書き換えません。** 1枚が決まった時点で `images` へ戻します。 */
const PARKED = args.includes("--parked");
const live = Object.entries(book.images).filter(([k, v]) => keys.length
  ? keys.includes(k)
  : !v.file || !existsSync(join(ROOT, OUT, v.file + ".webp")));
const fromPark = parkedKeys(book)
  .filter(k => keys.length ? keys.includes(k) : PARKED)
  .map(k => [k, asFresh(book._parked[k])]);
const wanted = [...live, ...fromPark];

if (!wanted.length && !SELFTEST) {
  console.log("選ぶものはありません。");
  const n = parkedKeys(book).length;
  if (n) console.log(`  park した行が ${n}件 あります → npm run pick:commons -- --parked`);
  process.exit(0);
}

/** 実際に外へ出て候補を集める。--selftest のときは作り物で置き換える */
const buildModel = async () => {
  const model = [];
  for (const [key, entry] of wanted) {
    process.stdout.write(`  ${key} … `);
    const { cands, errors } = await gather(entry);
    const desc = cands.length ? await describe(cands.map(c => c.title), 320) : new Map();
    const rows = cands.map(c => {
      const d = desc.get(c.title);
      if (!d) return null;
      return { ...d, via: c.via, note: c.note,
               use: usability(d.license, { allow, titleFree: entry.titleFree }) };
    }).filter(Boolean)
      /* 使えるものを先に、その中では人が選んだ源（実体・記事）を先に */
      .sort((a, b) => (b.use.ok - a.use.ok));
    console.log(`候補 ${rows.length}件${errors.length ? `（${errors.join(" / ")}）` : ""}`);
    model.push({ key, entry, cands: rows, errors });
    await sleep(WAIT);
  }
  return model;
};

const SWATCH = (c, w, h) => "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
  `<rect width="100%" height="100%" fill="${c}"/></svg>`);
/* **自己テストは台帳の中身に左右されません。** 対象の行を「まだ写真の無いもの」から
   採ると、全部そろった日に検査が黙って素通りします（実際そうなりかけました） */
const fixtureRows = () => {
  const rows = wanted.length ? wanted : Object.entries(book.images);
  return rows.slice(0, 2);
};
const fixtureModel = () => fixtureRows().map(([key, entry]) => ({
  key, entry, errors: [],
  cands: [
    { title: "File:A.jpg", license: "Public domain", objectName: "A", author: "誰か",
      licenseUrl: "", thumb: SWATCH("#9bb0c9", 320, 240), url: "", width: 640, height: 480, via: "ウィキデータ Q1",
      note: "テスト", use: usability("Public domain", { allow, titleFree: entry.titleFree }) },
    { title: "File:B.jpg", license: "CC BY-SA 4.0", objectName: "B", author: "誰か",
      licenseUrl: "", thumb: SWATCH("#c9b09b", 320, 400), url: "", width: 640, height: 480, via: "全文検索",
      note: "", use: usability("CC BY-SA 4.0", { allow, titleFree: entry.titleFree }) },
  ],
}));

/* ---- 選ばれた1枚を採る ---- */

let sharp = null;
const takeReal = async (key, title) => {
  if (!sharp) sharp = (await import("sharp")).default;
  /* park から選ばれたら、ここで `images` へ戻す。**選ばれるまでは park のまま** */
  const entry = unpark(book, key);
  if (!entry) throw new Error("台帳にない行です");
  const desc = (await describe([title])).get(title);
  if (!desc) throw new Error("その画像の情報が引けません");
  const use = usability(desc.license, { allow, titleFree: entry.titleFree });
  if (!use.ok) throw new Error(use.why);
  const size = await adopt({ desc, key, entry, root: ROOT, out: OUT, sharp });
  await writeFile(bookPath, JSON.stringify(book, null, 2) + "\n");
  return `${desc.license} ・ ${Math.round(size.wide / 1024)}KB / small ${Math.round(size.small / 1024)}KB`;
};
const takeFake = async (key, title) => {
  const entry = book.images[key] || book._parked?.[key];
  const use = usability(title === "File:A.jpg" ? "Public domain" : "CC BY-SA 4.0",
                        { allow, titleFree: entry.titleFree });
  if (!use.ok) throw new Error(use.why);
  return "selftest";
};

/* ---- 立てる ---- */

const model = SELFTEST ? fixtureModel() : await buildModel();
/* 押せるのは、いま画面に並んでいる行だけ。**`wanted` から作ると自己テストで食い違います**
   （作り物の行は `wanted` に無いため）。画面に出したものから作ります */
const known = new Set(model.map(m => m.key));
const take = SELFTEST ? takeFake : takeReal;
const html = page(model);

const server = createServer(async (req, res) => {
  const json = (code, o) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(o));
  };
  if (req.method === "POST" && req.url === "/done") { json(200, { ok: true }); stop(); return; }
  if (req.method === "POST" && req.url === "/pick") {
    let body = "";
    for await (const c of req) body += c;
    try {
      const { key, title } = JSON.parse(body || "{}");
      if (!known.has(key)) throw new Error("台帳にない行です");
      const text = await take(key, title);
      console.log(`  ✓ ${key}  ${title}  ${text}`);
      json(200, { ok: true, text });
    } catch (e) { console.warn(`  ✗ ${e.message}`); json(200, { ok: false, error: e.message }); }
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
});

const stop = () => {
  server.close();
  console.log("\n終わりました。npm run validate で確かめてから、");
  console.log("  git add -A && git commit -m \"写真を取り込む\" && git push");
};

if (SELFTEST) {
  /* **外へ出ずに、画面と書き戻しの道だけ通します。** ここが通らないまま
     手元で走らせると、往復が減るどころか増えます */
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const out = [];
  const t = (name, cond, detail = "") => {
    out.push(cond); console.log(`${cond ? "✓" : "✗"} ${name}${cond ? "" : "  ← " + detail}`);
  };
  const body = await (await fetch(base + "/")).text();
  if (process.env.PICK_DUMP) await writeFile(process.env.PICK_DUMP, body);
  t("画面が出る", body.includes("写真を選ぶ"));
  t("行ごとに枠がある", model.every(m => body.includes(`id="s-${m.key}"`)));
  t("使える候補は押せる", body.includes('class="pick"'));
  t("使えない候補は灰色で理由つき", body.includes('class="no"') && body.includes("allow にありません"));
  const pick = async (key, title) =>
    (await (await fetch(base + "/pick", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, title }) })).json());
  const k = model[0].key;
  t("使える1枚は採れる", (await pick(k, "File:A.jpg")).ok === true);
  const bad = await pick(k, "File:B.jpg");
  t("使えない1枚は断る", bad.ok === false && /allow/.test(bad.error), JSON.stringify(bad));
  const gone = await pick("__no_such_key__", "File:A.jpg");
  t("台帳にない行は断る", gone.ok === false, JSON.stringify(gone));
  t("台帳を書き換えていない", await readFile(bookPath, "utf8") === bookBefore);

  /* **短縮名の言い方をそろえているか。**
     コモンズは同じパブリックドメインでも根拠ごとに別の名前を返してくる
     （PD-old-70／PD-US-expired／PD-self／PD-USGov）。ここをそのまま
     `allow` と突き合わせていたので、中身はPDなのに全部落ちていた */
  const lic = v => normalizeLicense({ LicenseShortName: { value: v } });
  t("PDの言い方はどれも Public domain になる",
    ["PD-old-70", "PD-US-expired", "PD-self", "PD-USGov", "PDM 1.0"]
      .every(v => lic(v) === "Public domain"),
    ["PD-old-70", "PD-self"].map(lic).join(" / "));
  t("CC0 の版番号は落とす", lic("CC0 1.0") === "CC0", lic("CC0 1.0"));
  t("CC BY は版番号を残す", lic("CC-BY-2.0") === "CC BY 2.0", lic("CC-BY-2.0"));
  /* **ここを取りちがえると、使ってはいけないものを通します** */
  t("CC BY-SA を CC BY として拾わない", lic("CC BY-SA 4.0") === "CC BY-SA 4.0", lic("CC BY-SA 4.0"));
  t("NC・ND も素通ししない",
    lic("CC BY-NC 3.0").includes("NC") && lic("CC BY-ND 4.0").includes("ND"));

  /* **カテゴリの引き方。**
     21行が「候補がありません／使える候補がありません」で全滅したときの原因は2つ。
     ①大きなカテゴリは中身がほとんど下位カテゴリで、直下にファイルが無い
     ②数件しか無いところへライセンスの網をかけるので、必ず全滅する
     `deepcategory:` で下へたどり、構造化データで PD・CC0 を先に引く。 */
  const q = deepQueries("Rice paddies in Japan", {});
  t("下位カテゴリまでたどる", q.every(x => x.includes('deepcategory:"Rice paddies in Japan"')), q[0]);
  t("写真だけに絞る", q.every(x => x.includes("filetype:bitmap")), q[0]);
  t("PD と CC0 を先に引く",
    q[0].includes("P6216=Q19652") && q[1].includes("P275=Q6938433"), q.slice(0, 2).join(" / "));
  t("構造化データが無い写真も拾える（無指定の段がある）",
    q.some(x => !x.includes("haswbstatement")), q.join(" / "));
  /* **題名を伏せる行に、使えない候補を並べない。** choiceArt とスワイプは
     PD・CC0 しか使えないので、無指定の段を足すと画面が全部 × で埋まる */
  const qf = deepQueries("Footballs", { titleFree: true });
  t("題名を伏せる行では PD・CC0 だけを引く",
    qf.length === 2 && qf.every(x => x.includes("haswbstatement")), qf.join(" / "));
  t("Category: が二重にならない",
    deepQueries("Category:Dams in Japan", {})[0].includes('deepcategory:"Dams in Japan"'),
    deepQueries("Category:Dams in Japan", {})[0]);

  /* **park を開き直せるか。**
     park は「自動では当たらなかった」という印で、二度と触らないという意味ではない。
     16行を park した直後にこの画面が「選ぶものはありません」と言ったので、
     `--parked` と名指しで開けるようにした。**台帳は、1枚が決まるまで書き換えない。** */
  const fake = {
    images: {},
    _parked: { _note: "見出しなので数えない",
               "obj-x": { search: "x", titleFree: true, file: "obj-x", title: "T",
                          author: "A", license: "Public domain", source: "S",
                          width: 640, height: 480, _why: "別のものが来た" } },
  };
  t("park の行を数えられる（見出しは数えない）",
    parkedKeys(fake).length === 1 && parkedKeys(fake)[0] === "obj-x", parkedKeys(fake).join(","));
  const fresh = asFresh(fake._parked["obj-x"]);
  t("開き直した行は「まだ採っていない」状態になる",
    !fresh.file && !fresh.license && !fresh._why && fresh.search === "x" && fresh.titleFree === true,
    JSON.stringify(fresh));
  t("asFresh は台帳を書き換えない", !!fake._parked["obj-x"].file);
  const moved = unpark(fake, "obj-x");
  t("選ばれた行だけ images へ戻る",
    !!fake.images["obj-x"] && !fake._parked["obj-x"] && !moved.file, JSON.stringify(moved));
  t("park にも images にも無い行は null", unpark(fake, "obj-none") === null);
  server.close();
  console.log(out.every(Boolean) ? "\nすべて通過" : `\n${out.filter(x => !x).length}件 失敗`);
  process.exit(out.every(Boolean) ? 0 : 1);
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  ブラウザーで開いてください →  http://127.0.0.1:${PORT}/\n`);
  console.log("  よさそうな1枚を押すと、その場で webp と台帳が埋まります。");
  console.log("  終わったら画面の「終わる」を押してください（Ctrl+C でも止まります）。\n");
});
