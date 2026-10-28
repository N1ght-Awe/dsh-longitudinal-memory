/**
 * 注入基线 / 对账 —— 回答一个问题：「加了字段之后，助手看到的东西变了没有？」
 *
 *   node p0-diff.mjs --snapshot --from memory.before.json   # 迁移前生成基线
 *   node p0-diff.mjs                                       # 迁移后对账
 *
 * 只比**渲染真正读过的那几个字段**（id/summary/text/tags/pinned/meta/updatedAt…），
 * 新字段（kind/at/importance/…）一律忽略 —— 这正是「只加不改」要验证的东西。
 *
 * 退出码：0 = 零差异；1 = 有差异（并逐条打印）。
 * 记忆库路径：默认 $DSH_HOME/session-memory/memory.json，可用 --live 覆盖。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), ".dsh");
const BASELINE = join(HERE, ".p0-baseline.json");

const argOf = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : "";
};
const LIVE = resolve(argOf("--live") || join(DSH_HOME, "session-memory", "memory.json"));
const FROM = argOf("--from");

/** 渲染路径读过、也出现在注入里的字段。 */
const RENDER_FIELDS = ["id", "summary", "text", "tags", "pinned", "meta", "updatedAt", "summaryState", "locked"];

const shape = (entry) => Object.fromEntries(RENDER_FIELDS.map((field) => [field, entry[field] ?? null]));
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function snapshot() {
  if (!FROM) {
    console.error("第一次要指定迁移前的备份：--snapshot --from memory.before-p0.json");
    process.exit(1);
  }
  const raw = readJson(resolve(FROM));
  const buckets = {};
  for (const [key, bucket] of Object.entries(raw.workspaces ?? {})) {
    buckets[key] = (bucket.entries ?? []).map(shape);
  }
  writeFileSync(BASELINE, JSON.stringify({ takenAt: new Date().toISOString(), buckets }, null, 2) + "\n", "utf8");
  const total = Object.values(buckets).reduce((sum, list) => sum + list.length, 0);
  console.log("基线已写入 " + BASELINE);
  console.log("  桶 " + String(Object.keys(buckets).length) + " 个，条目 " + String(total) + " 条");
}

function compare() {
  if (!existsSync(BASELINE)) {
    console.error("没有基线：先跑 node p0-diff.mjs --snapshot --from <迁移前的 json>");
    process.exit(1);
  }
  const base = readJson(BASELINE);
  const live = readJson(LIVE);
  console.log("基线 " + base.takenAt);
  console.log("线上 v" + String(live.version) + "  " + LIVE + "\n");

  let diffs = 0;
  const kinds = { fact: 0, event: 0, profile: 0, 无: 0 };
  for (const [key, list] of Object.entries(base.buckets)) {
    const entries = live.workspaces?.[key]?.entries ?? [];
    const before = new Map(list.map((entry) => [entry.id, entry]));
    const after = new Map(entries.map((entry) => [entry.id, entry]));
    const added = [...after.keys()].filter((id) => !before.has(id));
    const removed = [...before.keys()].filter((id) => !after.has(id));
    const changed = [];
    for (const [id, entry] of before) {
      const now = after.get(id);
      if (now && JSON.stringify(shape(entry)) !== JSON.stringify(shape(now))) changed.push({ id, entry, now: shape(now) });
    }
    for (const entry of entries) kinds[entry.kind in kinds ? entry.kind : "无"] += 1;

    console.log((added.length + removed.length + changed.length === 0 ? "✅ " : "⚠ ") + key);
    console.log("   " + String(list.length) + " → " + String(entries.length) + " 条" +
      (added.length ? "，新增 " + String(added.length) : "") +
      (removed.length ? "，少了 " + String(removed.length) : "") +
      (changed.length ? "，改动 " + String(changed.length) : ""));
    for (const item of changed) {
      for (const field of RENDER_FIELDS) {
        if (JSON.stringify(item.entry[field]) !== JSON.stringify(item.now[field])) {
          console.log("   · " + item.id + " 的 " + field + " 变了");
        }
      }
    }
    for (const id of added) console.log("   · 新增 " + id);
    for (const id of removed) console.log("   · 不见了 " + id);
    diffs += added.length + removed.length + changed.length;
  }

  console.log("\nkind 分布：fact " + String(kinds.fact) + " / event " + String(kinds.event) +
    " / profile " + String(kinds.profile) + (kinds["无"] ? " / **无 kind " + String(kinds["无"]) + "**" : ""));
  console.log(diffs === 0 && kinds["无"] === 0
    ? "\n✅ 渲染字段零差异、每条都有 kind —— 「只加不改」成立。"
    : "\n⚠ 有差异（这几天正常写入的新条目也会算「新增」，看内容再判断）。");
  process.exit(diffs === 0 ? 0 : 1);
}

if (process.argv.includes("--snapshot")) snapshot();
else compare();
