# P0：给记忆条目加生命周期字段

> 基线：作者本地使用的 `dsh-workspace-recollection` 2.5.0（已含身份分层与模型下载修复两处本地改动）。
> **不是**可直接提交给上游的 patch —— 上游目前没有这些本地改动，上下文对不齐。
> 这份 diff 的作用是「把改动讲清楚」，移植时按下面「接线点」逐处对齐。

## 这个补丁做了什么

给每条记忆补 14 个字段，**不新建存储、不改渲染**：

```js
kind          // profile | fact | event —— 决定它进不进注入
at            // 事情发生的时间（≠ createdAt 记录时间）
importance    // 1 = 长期有效不淡；0.5 = 平常
emotion       // 0~1，可空
factKey       // 「对象.方面」，同一件事的新旧版本共用
supersedes    // 本条取代了谁
supersededBy  // 被谁取代
invalidAt     // 被取代的时间（对齐 Graphiti 的 invalid_at）
hits          // 被 recall 命中的次数（强化）
lastHitAt
state         // active | superseded | archived
archiveReason // decay | superseded | capacity | manual
archiveAt
profileConfirmed // profile 只有主人确认过才注入
```

存储版本 `3 → 4`；`normalizeLifecycle()` 幂等，旧数据读进来就补全，写回即固化。

## 接线点（index.js 一共 6 处）

1. 顶部 import：加上 `normalizeLifecycle, LIFECYCLE_FIELDS`
2. `const STORE_VERSION = 3` → `4`
3. `normalizeEntry()` 结尾：`return normalizeLifecycle(entry)`
4. `MemoryStore.add()`：新建条目过一遍 `normalizeLifecycle`，命中已有条目时 `applyLifecyclePatch`
5. `MemoryStore.update()`：`applyLifecyclePatch(entry, patch)`
6. `memory_write` 工具：多五个可选参数 `kind / at / importance / emotion / fact_key`

其余全是新增的纯函数，不碰旧代码。

## 怎么用

```bash
# 在你的插件目录里（先备份）
git apply --check p0-lifecycle.diff && git apply p0-lifecycle.diff
# 跑单测（把 tests/lifecycle.test.mjs 放到插件根目录的 tests/ 下）
node tests/lifecycle.test.mjs
```

diff 对不上时不要硬打 —— 看上面 6 个接线点手工接，比盲打安全。

## 验收

- 迁移后每条都有 `kind`，且**剥掉新字段后与原数据逐字段一致**
- 注入文本与加字段之前逐字相同（渲染路径没读过新字段）
- 31 条会话流水应该全部落成 `event`，环境/踩坑类落成 `fact`
