#!/usr/bin/env node
/* MyCryptoHeroes のアセットを public/ に取り込む。
   MCH社から許諾を得た範囲で利用する。実行は手動（毎回叩かない）。
   使い方:
     node scripts/fetch-mch-assets.mjs                      # GitHub から採る
     node scripts/fetch-mch-assets.mjs --repo ../mycryptoheroes   # 手元の clone から
     node scripts/fetch-mch-assets.mjs --repo <path> --audio      # 音だけ      */

import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = "https://raw.githubusercontent.com/bearko/mycryptoheroes/main";

/* 手元に clone があればそちらから採る（--repo <path>）。
   無ければ GitHub から落とす。**どちらでも同じものが入ります** */
const argv = process.argv.slice(2);
const repo = (() => { const i = argv.indexOf("--repo"); return i >= 0 ? argv[i + 1] : null; })();
const onlyAudio = argv.includes("--audio");

/* data/heroes.json に載っている英雄と、その Rep.画像（id + 10000） */
const heroes = JSON.parse(await readFile(join(ROOT, "data/heroes.json"), "utf8"));
const roster = heroes.map(h => h.id);
const reps = heroes.filter(h => !h.own).map(h => String(Number(h.id) + 10000));

/* ホームのボタンに重ねる英雄。ロスターには入らないが画像だけ使う */
const UI_HEROES = ["2023", "3037"];   // クラフト（ミケランジェロ）/ ショップ

/* 背景。1030 が既定で、1001〜1004 と 1010 が「出題を選ぶ」の教科ごとの絵。
   **外国語は 1005 のつもりでしたが、その番号は存在しません**（404）。
   代わりの 1006 は国語の 1001 とほぼ同じ絵なので、赤系の 1010 を当てています。
   情報は 1046（そろばん状の棚）。残っていた中でいちばん「計算」に見える絵です */
const BACKGROUNDS = ["1006", "1038", "1046", "1030",
                     "1001", "1002", "1003", "1004", "1010"];
const ICONS = ["mai_sd", "gum", "mch_icon"];

/* 攻撃が当たったときに重ねる絵。1枚を透過で光らせるだけなので、これだけで足ります */
const EFFECTS = ["01_single_damage"];

/* 「出題を選ぶ」で教科の札に乗せる英雄。**ロスターとは別**で、絵だけ借ります */
const SUBJECT_HEROES = ["4056", "10006", "5027", "10004", "3030", "4041"];

/* **マインちゃん**（`navi_ain`）。読み上げ役として画面に立ちます。
   原本は 96x128 のドット絵なので、大きく出すときは image-rendering: pixelated を
   付けてください（英雄と同じ理由）。表情は用途ごとに使い分けます */
const NAVI = ["navi_ain_11_idle", "navi_ain_12_blink",
              "navi_ain_03_wave", "navi_ain_07_talk", "navi_ain_08_sparkle",
              "navi_ain_02_both_arms_up", "navi_ain_06_smile"];

/* エネミー。IDの並びが教科に対応しています（310国語 / 320算数・数学 / 330理科 /
   340社会 / 350外国語）。**在るものだけ採ります** —— 番号が飛んでいても止めません */
const ENEMIES = Array.from({ length: 60 }, (_, i) => String(310 + i));
/* エクステンションは data/extensions-curated.json の108種。
   ここに列挙せず台帳から読むので、品を足したら取り込みも自動で追いつく */
const curated = JSON.parse(await readFile(join(ROOT, "data/extensions-curated.json"), "utf8"));
const EXTENSIONS = curated.map(e => e.id);

/* 上限サイズ。withoutEnlargement なので、これより小さい原本はそのまま通る。
   MCH の英雄・エクステンション画像は原本が 64x64 なので、実際には拡大されない。
   ホームの主役層で Rep. を出すときは、この解像度を前提に表示サイズを決めること */
const SIZE = { hero: 128, ext: 128, icon: 128, bg: 1080, navi: 256 };

/* 単一ファイル版（dist/index.html）に data URI で畳む用の縮小コピー。
   1080px のまま base64 にすると1枚で数百KBになり、配布ファイルが実用外の大きさになる */
const BG_EMBED = { size: 480, quality: 60 };

async function grab(url, out, size, quality = 88) {
  const res = await fetch(url);
  if (!res.ok) { console.warn(`  スキップ ${url} (${res.status})`); return null; }
  const buf = Buffer.from(await res.arrayBuffer());
  let img = sharp(buf);
  if (size) img = img.resize(size, size, { fit: "inside", withoutEnlargement: true });
  await writeFile(join(ROOT, out), await img.webp({ quality }).toBuffer());
  return buf;
}

let n = 0;

/* **--audio のときは音だけ採ります。** 画像は毎回落とし直す必要がありません */
if (!onlyAudio) {
  const count = async (...args) => { if (await grab(...args)) n++; };

  await mkdir(join(ROOT, "public/heroes"), { recursive: true });
  for (const id of roster)
    await count(`${RAW}/Image/Heroes/${id}.png`, `public/heroes/${id}.webp`, SIZE.hero);
  for (const id of reps)
    await count(`${RAW}/Image/Heroes/${id}.png`, `public/heroes/${id}.webp`, SIZE.hero);
  for (const id of UI_HEROES)
    await count(`${RAW}/Image/Heroes/${id}.png`, `public/heroes/${id}.webp`, SIZE.hero);
  for (const id of SUBJECT_HEROES)
    await count(`${RAW}/Image/Heroes/${id}.png`, `public/heroes/${id}.webp`, SIZE.hero);

  await mkdir(join(ROOT, "public/extensions"), { recursive: true });
  for (const id of EXTENSIONS)
    await count(`${RAW}/Image/Extensions/${id}.png`, `public/extensions/${id}.webp`, SIZE.ext);

  await mkdir(join(ROOT, "public/backgrounds/small"), { recursive: true });
  for (const id of BACKGROUNDS) {
    const src = await grab(`${RAW}/Image/Backgrounds/${id}.png`, `public/backgrounds/${id}.webp`, SIZE.bg);
    if (!src) continue;
    n++;
    await writeFile(join(ROOT, `public/backgrounds/small/${id}.webp`),
      await sharp(src).resize(BG_EMBED.size, BG_EMBED.size, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: BG_EMBED.quality }).toBuffer());
  }

  await mkdir(join(ROOT, "public/enemies"), { recursive: true });
  for (const id of ENEMIES)
    await count(`${RAW}/Image/Enemies/${id}.png`, `public/enemies/${id}.webp`, SIZE.hero);

  await mkdir(join(ROOT, "public/characters"), { recursive: true });
  for (const name of NAVI)
    await count(`${RAW}/Image/Characters/${name}.png`, `public/characters/${name}.webp`, SIZE.navi);

  await mkdir(join(ROOT, "public/effects"), { recursive: true });
  for (const name of EFFECTS)
    await count(`${RAW}/Image/Effects/Battle/${name}.png`, `public/effects/${name}.webp`, SIZE.navi);

  await mkdir(join(ROOT, "public/icons"), { recursive: true });
  for (const name of ICONS)
    await count(`${RAW}/Image/Icons/${name}.png`, `public/icons/${name}.webp`, SIZE.icon);

  /* ---- バトルの数値 ---- */
  /* **使う英雄と敵のぶんだけ抜き出して data/battle-stats.json に置きます。**
     MCH の一覧は英雄404体・敵934体あるので、丸ごと持つと単一ファイル版が太ります。
     元は向こうにあるので、ここは取り込みのたびに作り直して構いません */
  const pick = async (url, key) => {
    const res = await fetch(url);
    if (!res.ok) { console.warn(`  スキップ ${url} (${res.status})`); return null; }
    const rows = await res.json();
    return Array.isArray(rows) ? rows : rows[key] || [];
  };
  const heroRows = await pick(`${RAW}/Data/Heroes/heroes.json`, "heroes");
  const foeRows  = await pick(`${RAW}/Data/Enemies/enemies.json`, "enemies");
  if (heroRows && foeRows) {
    const want = new Set(SUBJECT_HEROES.map(Number));
    const stats = { _note: "バトルに使う数値だけを MCH から抜いたもの。作り直しは node scripts/fetch-mch-assets.mjs。手で書かない。", heroes: {}, enemies: {} };
    for (const h of heroRows) {
      if (!want.has(h.id)) continue;
      const st = h.max_level_stats || h.initial_stats || {};
      /* **パッシブスキルの名前も持ちます。** 必殺技のカットインに出す1行で、
         MCH の `passive.name.ja` そのものです（こちらで付けません） */
      stats.heroes[String(h.id)] = { name: h.name?.ja || String(h.id),
        skill: h.passive?.name?.ja || "", 
        hp: st.hp | 0, phy: st.phy | 0, int: st.int | 0, agi: st.agi | 0 };
    }
    for (const e of foeRows) {
      const id = Number(e.id);
      if (!(id >= 310 && id <= 369)) continue;
      const b = e.base_param || {};
      stats.enemies[String(id)] = { name: e.name?.ja || String(id),
        hp: b.hp | 0, phy: b.phy | 0, int: b.int | 0, agi: b.agi | 0 };
    }
    await writeFile(join(ROOT, "data/battle-stats.json"), JSON.stringify(stats, null, 2) + "\n");
    console.log(`  ✓ data/battle-stats.json  英雄${Object.keys(stats.heroes).length}体 / 敵${Object.keys(stats.enemies).length}体`);
  }
}

/* ---- 音 ---- */
/* **既定はOFFです。自動で鳴らさないでください** —— 電車の中で開く人がいます。
   SEは小さいので単一ファイル版にも畳みますが、**BGMは畳みません**
   （1曲1〜2.8MBあり、base64は元の1.33倍になるため）*/
const sounds = JSON.parse(await readFile(join(ROOT, "data/sounds.json"), "utf8"));
let audioN = 0;
const grabAudio = async (src, out) => {
  if (repo) {
    const from = join(repo, src);
    if (!existsSync(from)) { console.warn(`  スキップ ${src}（手元にありません）`); return; }
    await copyFile(from, join(ROOT, out));
  } else {
    const res = await fetch(`${RAW}/${src}`);
    if (!res.ok) { console.warn(`  スキップ ${src} (${res.status})`); return; }
    await writeFile(join(ROOT, out), Buffer.from(await res.arrayBuffer()));
  }
  audioN++;
};
await mkdir(join(ROOT, "public/audio/se"), { recursive: true });
for (const [key, v] of Object.entries(sounds.se))
  await grabAudio(v.src, `public/audio/se/${key}.mp3`);
await mkdir(join(ROOT, "public/audio/bgm"), { recursive: true });
for (const [key, v] of Object.entries(sounds.bgm))
  await grabAudio(v.src, `public/audio/bgm/${key}.mp3`);
console.log(`  ✓ 音 ${audioN}点（SE ${Object.keys(sounds.se).length} / BGM ${Object.keys(sounds.bgm).length}）`);

console.log(`${n + audioN}点を取得しました`);
