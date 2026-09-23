#!/usr/bin/env node
/* デッキに入れるヒーローと、そのアンサースキルを MCH から引き写す。
   **手で書かないでください** —— 台帳（data/roster-curated.json）に書くのは
   ID と教科（fit）だけで、名前・勢力・レアリティ・スキル・パラメーターは
   すべて向こうから採ります。エクステンションの Active Skill（＝SS）も同じです。

   使い方:
     node scripts/build-roster.mjs                      # GitHub から採る
     node scripts/build-roster.mjs --repo ../mycryptoheroes   # 手元の clone から採る
     node scripts/build-roster.mjs --repo <path> --images     # 画像も取り込む（sharp が要る）
*/

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = "https://raw.githubusercontent.com/bearko/mycryptoheroes/main";

const argv = process.argv.slice(2);
const repo = (() => { const i = argv.indexOf("--repo"); return i >= 0 ? argv[i + 1] : null; })();
const wantImages = argv.includes("--images");

/** MCH のファイルを1つ読む。手元の clone があればそちらを見る */
async function mch(path) {
  if (repo) return JSON.parse(await readFile(join(repo, path), "utf8"));
  const res = await fetch(`${RAW}/${path}`);
  if (!res.ok) throw new Error(`${path} を取れませんでした (${res.status})`);
  return res.json();
}

const json = async p => JSON.parse(await readFile(join(ROOT, p), "utf8"));

/**
 * **効果率は、effect_id に合う行から取ります。**
 *
 * MCH のスキルは効果を複数持つことがあり、先頭が本体とは限りません
 * （甲斐姫の「浪切」は effect_id 1（単体ダメージ）ですが、effects[0] は
 * 味方のPHYダウンです）。先頭から素直に取ると、50%ダメージのスキルが
 * 15%になります。
 *
 * 幅のあるものは**中央値に固定**します。乱数にすると同じ問題で結果が変わり、
 * 原則2（ランダム報酬を入れない）に触れます。
 */
const WANT = { 1: /ダメージ/, 2: /ダメージ/, 3: /回復|復活/, 4: /アップ/, 5: /ダウン|付与/ };

/**
 * **説明文の `{triggerRate}` `{successRate}` を、実際の数字に置き換えます。**
 *
 * MCH の `text` は差し込み前の形なので、そのまま画面に出すと
 * 「{successRate}%の確率で出血を付与」と波かっこが見えます（実際に見えました）。
 * 条件は trigger_rate、効果ごとの確率はその効果の success_rate で埋めます。
 */
const fill = (t, map) => String(t || "").replace(/\{(\w+)\}/g,
  (m, k) => map[k] != null ? map[k] : m);
function skillText(desc) {
  const parts = [];
  if (desc?.condition) parts.push(fill(desc.condition, { triggerRate: desc.trigger_rate }));
  (desc?.effects || []).forEach(e =>
    parts.push(fill(e.description, { successRate: e.success_rate,
                                     minRate: e.min_rate, maxRate: e.max_rate })));
  return parts.join(" / ") || fill(desc?.text || "", { triggerRate: desc?.trigger_rate });
}
function pickRate(desc, effectId, fallback) {
  const list = desc?.effects || [];
  const want = WANT[effectId];
  const hit = (want && list.find(e => want.test(String(e?.description || "")))) || list[0];
  const lo = Number(hit?.min_rate), hi = Number(hit?.max_rate);
  if (!Number.isFinite(lo)) return fallback;
  return Math.round((lo + (Number.isFinite(hi) ? hi : lo)) / 2);
}

/* ---- コストと解放 ---- */

/* コストは**枠の重さ**です。強さには効きません（原則1・src/battle.js の COST と同じ表） */
const COST = { Common: 4, Uncommon: 6, Rare: 9, Epic: 13, Legendary: 18 };

/* 解放は、その教科の知識カードを**どれだけの割合**集めたか。
   割合なので、問題DBが増えても条件が置いていかれません。
   Common は最初から仲間です（5勢力に1体ずつ置いてあるので、初日から5枚デッキが組めます） */
const UNLOCK_RATE = { Common: 0, Uncommon: 0.08, Rare: 0.18, Epic: 0.32, Legendary: 0.5 };

/* ---- 組み立て ---- */

const curated = (await json("data/roster-curated.json")).filter(r => r.id);
const heroRows = await mch("Data/Heroes/heroes.json");
const byId = new Map(heroRows.map(h => [String(h.id), h]));

const roster = [];
const problems = [];
for (const c of curated) {
  const h = byId.get(String(c.id));
  if (!h) { problems.push(`${c.id}: MCH に居ません`); continue; }
  const fac = h.faction?.name?.ja;
  if (fac !== c.faction)
    problems.push(`${c.id} ${h.name?.ja}: 台帳は ${c.faction} ですが MCH では ${fac} です`);
  const rarity = h.rarity?.name;
  if (!COST[rarity]) { problems.push(`${c.id}: 知らないレアリティ ${rarity}`); continue; }
  const st = h.max_level_stats || h.initial_stats || {};
  const p = h.passive || {};
  const d = p.description?.ja || {};
  roster.push({
    id: String(h.id),
    name: h.name?.ja || String(h.id),
    faction: fac,
    rarity,
    cost: COST[rarity],
    fit: c.fit,
    /* アンサースキル。**MCH の passive をそのまま写します** */
    as: {
      id: p.id ?? null,
      name: p.name?.ja || "",
      effect: p.effect_id ?? 1,
      icon: p.icon_file_name || "",
      condition: d.condition || "",
      triggerRate: d.trigger_rate ?? 100,
      text: skillText(d),
      rate: pickRate(d, p.effect_id ?? 1, 40),
    },
    stats: { hp: st.hp | 0, phy: st.phy | 0, int: st.int | 0, agi: st.agi | 0 },
    unlock: UNLOCK_RATE[rarity] > 0
      ? { subject: c.fit[0], rate: UNLOCK_RATE[rarity] } : null,
  });
}

/* ---- エクステンションの Active Skill（＝SS） ---- */

const extCurated = await json("data/extensions-curated.json");
const extRows = await mch("Data/Extensions/extensions.json");
const extById = new Map(extRows.map(e => [String(e.id), e]));
const skills = {};
for (const e of extCurated) {
  const m = extById.get(String(e.id));
  if (!m?.active_skill) { problems.push(`ext ${e.id} ${e.name}: MCH に Active Skill がありません`); continue; }
  const a = m.active_skill;
  const d = a.description?.ja || {};
  skills[String(e.id)] = {
    id: a.id ?? null,
    name: a.name?.ja || "",
    effect: a.effect_id ?? 1,
    text: skillText(d),
    rate: pickRate(d, a.effect_id ?? 1, 50),
  };
}

await writeFile(join(ROOT, "data/roster.json"),
  JSON.stringify({
    _note: "生成物です。手で書かないでください（node scripts/build-roster.mjs）。台帳は data/roster-curated.json。",
    _source: "bearko/mycryptoheroes ・ Data/Heroes/heroes.json と Data/Extensions/extensions.json",
    heroes: roster,
    extSkills: skills,
  }, null, 2) + "\n");

/* ---- バトルの数値を足す ---- */
/* 既存の data/battle-stats.json（教科の札に使う6体と敵60体）は残したまま、
   ロスターぶんを足します。**敵の側は触りません** */
const stats = await json("data/battle-stats.json");
for (const h of roster) {
  stats.heroes[h.id] = { name: h.name, skill: h.as.name, ...h.stats };
}
await writeFile(join(ROOT, "data/battle-stats.json"), JSON.stringify(stats, null, 2) + "\n");

/* ---- 画像 ---- */
let images = 0;
if (wantImages) {
  const sharp = (await import("sharp")).default;
  await mkdir(join(ROOT, "public/heroes"), { recursive: true });
  const have = new Set(await readdir(join(ROOT, "public/heroes")));
  for (const h of roster) {
    if (have.has(`${h.id}.webp`)) continue;
    const src = repo ? join(repo, `Image/Heroes/${h.id}.png`) : `${RAW}/Image/Heroes/${h.id}.png`;
    let buf;
    if (repo) {
      if (!existsSync(src)) { problems.push(`${h.id}: 画像がありません`); continue; }
      buf = await readFile(src);
    } else {
      const res = await fetch(src);
      if (!res.ok) { problems.push(`${h.id}: 画像を取れません (${res.status})`); continue; }
      buf = Buffer.from(await res.arrayBuffer());
    }
    await writeFile(join(ROOT, `public/heroes/${h.id}.webp`),
      await sharp(buf).resize(128, 128, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 88 }).toBuffer());
    images++;
  }
}

const byFaction = {};
roster.forEach(h => { byFaction[h.faction] = (byFaction[h.faction] || 0) + 1; });
console.log(`ヒーロー ${roster.length}体 ・ ${Object.entries(byFaction).map(([f, n]) => `${f}${n}`).join(" / ")}`);
console.log(`エクステンションのSS ${Object.keys(skills).length}件` + (wantImages ? ` ・ 画像 ${images}点` : ""));
if (problems.length) {
  console.log(`\n⚠ ${problems.length}件`);
  problems.forEach(p => console.log("  - " + p));
  process.exit(1);
}
