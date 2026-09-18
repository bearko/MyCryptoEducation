#!/usr/bin/env node
/* コモンズから写真を取り込み、data/images.json の台帳を埋める。
   実行は手動（CI では走らせない。相手先に負荷をかけないため）。

   使い方
     node scripts/fetch-commons.mjs [キー ...]     file がまだ無い行を取りに行く
     node scripts/fetch-commons.mjs --list [キー]  取り込まずに候補を並べる

   **見て選びたいときは `node scripts/pick-commons.mjs` のほうが速いです。**
   候補が写真のまま並ぶので、往復が1回で済みます。こちらは、`commons` や
   `entity` がもう書いてあって、まとめて採るだけのときに使います。

   候補の集め方は `commons-lib.mjs` の gather が持っています。**全文検索は
   最後に見ます。** 検索はファイル解説ページの全文検索なので、投稿者名にも
   当たるためです（詳しくは commons-lib.mjs の頭）。 */

import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gather, describe, adopt, usability, isTitleFree,
         asFresh, unpark, parkedKeys, sleep, WAIT } from "./commons-lib.mjs";

let sharp;
try { sharp = (await import("sharp")).default; }
catch { console.error("sharp が見つかりません。先に npm install を走らせてください。"); process.exit(1); }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "public/commons";

const bookPath = join(ROOT, "data/images.json");
const bookBefore = await readFile(bookPath, "utf8");
const book = JSON.parse(bookBefore);
const allow = book.allow.map(s => s.toLowerCase());
const args = process.argv.slice(2);
const LIST = args.includes("--list");
const keys = args.filter(a => !a.startsWith("--"));
/* **park した行も取りに行けます**（`--parked`、または名指し）。park は
   「自動では当たらなかった」という印で、二度と触らないという意味ではありません。
   **採れた時点で `images` へ戻します** —— 採れなければ park のままです。 */
const PARKED = args.includes("--parked");
const live = Object.entries(book.images).filter(([k, v]) => keys.length
  ? keys.includes(k)
  : !v.file || !existsSync(join(ROOT, OUT, v.file + ".webp")));
const fromPark = parkedKeys(book)
  .filter(k => keys.length ? keys.includes(k) : PARKED)
  .map(k => [k, asFresh(book._parked[k])]);
const wanted = [...live, ...fromPark];

if (!wanted.length) {
  console.log("取りに行くものはありません。");
  const n = parkedKeys(book).length;
  if (n) console.log(`  park した行が ${n}件 あります → node scripts/fetch-commons.mjs --parked`);
  process.exit(0);
}

let ok = 0, ng = 0, listed = 0;
for (const [key, entry] of wanted) {
  try {
    const { cands, errors, stats } = await gather(entry);
    const where = stats.length ? `      源ごとの件数: ${stats.join(" / ")}` : "";
    if (!cands.length) {
      console.warn(`  ${key}: 候補がありません` + (errors.length ? `（${errors.join(" / ")}）` : ""));
      if (where) console.warn(where);
      console.warn(`      → カテゴリ名が違っているかもしれません（転送カテゴリは空を返します）。`);
      console.warn(`        "wikipedia": "<記事名>" か "search": "<英語の語>" も足せます`);
      ng++; await sleep(WAIT); continue;
    }
    const desc = await describe(cands.map(c => c.title));
    const rows = cands.map(c => {
      const d = desc.get(c.title);
      return d && { ...d, via: c.via, note: c.note,
                    use: usability(d.license, { allow, titleFree: entry.titleFree }) };
    }).filter(Boolean);

    /* --list: 並べて終わり。**選ぶのは人。**
       ◎ 題名を伏せられる（PD・CC0） / ○ 使えるが題名が出る / × allow に無い */
    if (LIST) {
      console.log(`\n  ${key}`);
      rows.slice(0, 20).forEach((r, i) =>
        console.log(`   ${r.use.mark} ${String(i + 1).padStart(2)}. ${r.license.padEnd(16)}` +
                    ` ${String(r.width).padStart(5)}x${String(r.height).padEnd(5)}` +
                    ` ${r.via.padEnd(14)} ${r.title}`));
      if (entry.titleFree)
        console.log(`      ※ この行は題名を伏せる用（titleFree）です。◎ からだけ選んでください`);
      if (errors.length) console.log(`      引けなかった源: ${errors.join(" / ")}`);
      console.log(`      → 決めたら images.json の "${key}" に "commons": "File:〜" を書いて、`);
      console.log(`        node scripts/fetch-commons.mjs ${key}`);
      console.log(`      → 写真のまま見て選ぶなら: node scripts/pick-commons.mjs ${key}`);
      listed++; await sleep(WAIT); continue;
    }

    const hit = rows.find(r => r.use.ok);
    if (!hit) {
      const seen = [...new Set(rows.map(r => r.license))];
      console.warn(`  ${key}: 使える候補がありません（見えたもの: ${seen.join(" / ")}）` +
                   (entry.titleFree ? "。この行は題名を伏せる用なので PD・CC0 だけです" : ""));
      rows.slice(0, 6).forEach(r => console.warn(`      ${r.use.mark} ${r.license.padEnd(16)} ${r.title}`));
      if (where) console.warn(where);
      console.warn(`      → node scripts/pick-commons.mjs ${key} で写真を見て選べます`);
      ng++; await sleep(WAIT); continue;
    }

    /* park から採れたら、ここで `images` へ戻す（採れなければ park のまま） */
    const target = unpark(book, key) || entry;
    const size = await adopt({ desc: hit, key, entry: target, root: ROOT, out: OUT, sharp });
    console.log(`  ✓ ${key}  ${hit.license}  ${hit.via}  ${Math.round(size.wide / 1024)}KB / small ${
      Math.round(size.small / 1024)}KB`);
    if (!isTitleFree(hit.license))
      console.log(`      ※ 題名「${hit.objectName}」が画面に出ます。答えが割れないか確かめてください`);
    ok++;
  } catch (e) {
    console.warn(`  ${key}: ${e.message}`);
    ng++;
  }
  await sleep(WAIT);
}

/* 中身が変わっていないなら書かない。毎回書くと、取り込むものが無い実行でも
   未コミットの変更が残って、git pull が止まる */
const bookAfter = JSON.stringify(book, null, 2) + "\n";
const changed = bookAfter !== bookBefore;
if (changed) await writeFile(bookPath, bookAfter);

if (LIST) { console.log(`\n候補を並べました（${listed}件）。取り込みはしていません。`); process.exit(0); }
console.log(`\n取り込み ${ok}件 / 見送り ${ng}件  →  ${OUT}/`);
console.log(changed
  ? "data/images.json を更新しました。npm run validate で確かめてください。"
  : "data/images.json は変わっていません。");
