/**
 * P0 生命周期字段的单测 —— 零依赖，直接 `node --test` 就能跑。
 *
 * 钉的是四件事（都属于「跑起来正常、数据慢慢被弄乱」的类型）：
 *   ① 种类只推 event，绝不自动造出 profile（常驻层一旦被自动生成就会膨胀）
 *   ② 迁移**只加不改**：剥掉新字段后必须与原数据逐字段一致
 *   ③ 幂等：同一份数据跑两遍结果一致，迁移可以放心重跑
 *   ④ 非法值不许漏进库里（importance=0.7、at="上周三" 这种）
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeLifecycle,
  deriveKind,
  deriveImportance,
  withoutLifecycle,
  LIFECYCLE_FIELDS,
} from "../lib/store-logic.js";
import { planMigration, STORE_MIGRATIONS, storeV3ToV4 } from "../lib/migrate.js";

const baseEntry = (extra = {}) => ({
  id: "mem_a",
  text: "主人喜欢喝美式",
  topic: "饮品偏好",
  sensitivity: "normal",
  assertion: "user-stated",
  revision: 1,
  summary: "喜欢美式",
  summaryState: "manual",
  tags: ["偏好", "饮品"],
  pinned: false,
  meta: false,
  locked: false,
  source: { sessionId: "s1", at: "2026-10-26T10:00:00+08:00", origin: "agent", workspace: "D:\\x", ownerId: "", personaId: "" },
  createdAt: "2026-10-26T10:00:00+08:00",
  updatedAt: "2026-10-26T10:00:00+08:00",
  ...extra,
});

test("种类：会话导入与元信息推成 event，其余推成 fact，profile 从不自动出现", () => {
  assert.equal(deriveKind(baseEntry()), "fact");
  assert.equal(deriveKind({ ...baseEntry(), tags: ["会话导入"] }), "event");
  assert.equal(deriveKind({ ...baseEntry(), meta: true }), "event");
  assert.equal(deriveKind({}), "fact");
  assert.equal(deriveKind(null), "fact");
  // 任何输入都不该推出 profile
  for (const sample of [baseEntry(), { ...baseEntry(), tags: ["习惯", "偏好"] }, { meta: true }, {}]) {
    assert.notEqual(deriveKind(sample), "profile");
  }
});

test("重要度：带长期标签的推 1，其余的 0.5，已有合法值不覆盖，非法值不留", () => {
  assert.equal(deriveImportance(baseEntry(), "fact"), 1); // tags 含「偏好」
  assert.equal(deriveImportance({ ...baseEntry(), tags: ["环境"] }, "fact"), 0.5);
  assert.equal(deriveImportance({ ...baseEntry(), tags: ["环境"], importance: 1 }, "fact"), 1);
  assert.equal(deriveImportance({ ...baseEntry(), tags: ["环境"], importance: 0.5 }, "fact"), 0.5);
  assert.equal(deriveImportance({ ...baseEntry(), tags: ["环境"], importance: 0.7 }, "fact"), 0.5);
  assert.equal(deriveImportance(baseEntry(), "profile"), 1);
});

test("补字段：缺省值齐全且幂等", () => {
  const once = normalizeLifecycle(baseEntry());
  const twice = normalizeLifecycle(once);
  assert.deepEqual(twice, once);
  assert.equal(once.kind, "fact");
  assert.equal(once.state, "active");
  assert.equal(once.hits, 0);
  assert.equal(once.at, "");
  assert.deepEqual(once.supersedes, []);
  assert.equal(once.emotion, null);
  assert.equal(once.profileConfirmed, "");
  for (const field of LIFECYCLE_FIELDS) assert.ok(field in once, "缺字段 " + field);
});

test("非法值不许漏进库里", () => {
  const entry = normalizeLifecycle(baseEntry({
    kind: "常驻",                 // 不认识 → 按规则推
    at: "上周三",                 // 解析不了 → 空
    emotion: 7,                   // 夹到 1
    hits: -3,                     // 归零
    supersedes: ["mem_b", "mem_b", "", 42],
    archiveReason: "因为太旧",     // 不认识的枚举 → 空
    state: "done",                // 不认识 → active
  }));
  assert.equal(entry.kind, "fact");
  assert.equal(entry.at, "");
  assert.equal(entry.emotion, 1);
  assert.equal(entry.hits, 0);
  assert.deepEqual(entry.supersedes, ["mem_b"]);
  assert.equal(entry.archiveReason, "");
  assert.equal(entry.state, "active");
});

test("只加不改：剥掉生命周期字段后与原数据逐字段一致", () => {
  const original = baseEntry({ tags: ["会话导入"], text: "很长的一段流水" });
  const withLife = normalizeLifecycle(original);
  assert.deepEqual(withoutLifecycle(withLife), original);
});

test("迁移 v3 → v4：版本抬高、每条都有 kind、内容一个字都没动", () => {
  const v3 = {
    version: 3,
    budgetChars: 6000,
    summaryProvider: "deepseek-account",
    summaryModel: "deepseek-flash",
    summaryTimeoutMs: 60000,
    embedTimeoutMs: 60000,
    workspaces: {
      "d:\\demo-workspace": {
        cwd: "D:\\demo-workspace",
        enabled: true,
        injectMode: "index",
        createdAt: "2026-10-24T00:00:00+08:00",
        updatedAt: "2026-10-26T00:00:00+08:00",
        entries: [baseEntry(), baseEntry({ id: "mem_b", tags: ["会话导入"], meta: false })],
      },
    },
  };
  const plan = planMigration(v3, 3, 4, STORE_MIGRATIONS);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.applied, [4]);
  const v4 = plan.value;
  assert.equal(v4.version, 4);
  const bucket = v4.workspaces["d:\\demo-workspace"];
  assert.equal(bucket.entries.length, 2);
  assert.deepEqual(bucket.entries.map((e) => e.kind), ["fact", "event"]);
  // 桶级字段不许动
  assert.equal(bucket.injectMode, "index");
  assert.equal(bucket.cwd, "D:\\demo-workspace");
  assert.equal(v4.budgetChars, 6000);
  // 内容不许动
  assert.deepEqual(
    bucket.entries.map(withoutLifecycle),
    v3.workspaces["d:\\demo-workspace"].entries,
  );
});

test("迁移可重跑：v4 数据再跑一遍不出错、不改内容", () => {
  const v3 = {
    version: 3,
    workspaces: { "d:\\x": { cwd: "D:\\x", enabled: true, injectMode: "index", createdAt: "", updatedAt: "", entries: [baseEntry()] } },
  };
  const once = storeV3ToV4(v3);
  const twice = storeV3ToV4(once);
  assert.deepEqual(twice.workspaces["d:\\x"].entries, once.workspaces["d:\\x"].entries);
});

test("坏数据不炸：workspaces 缺失 / 桶是 null / 条目不是对象", () => {
  assert.equal(storeV3ToV4(null).version, 4);
  assert.deepEqual(storeV3ToV4({}).workspaces, {});
  const weird = storeV3ToV4({ version: 3, workspaces: { a: null, b: { entries: [null, 7, baseEntry()] } } });
  assert.equal(weird.workspaces.a, null);
  assert.equal(weird.workspaces.b.entries.length, 3);
  assert.equal(weird.workspaces.b.entries[2].kind, "fact");
});
