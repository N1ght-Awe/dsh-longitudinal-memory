# v0.1.0 · 生命周期字段（P0）

> 2026-10-28 · 一个补丁 + 一份设计 + 两件验证工具。
> **不含上游源码，也不含任何真实记忆数据。**

## 这次发布包含什么

给每条记忆补 14 个生命周期字段，存储版本 `3 → 4`：

| 字段 | 作用 |
|---|---|
| `kind` | `profile` / `fact` / `event` —— 决定它进不进注入 |
| `at` | 事情**发生**的时间（≠ 记录时间） |
| `importance` | `1` 长期有效不淡 / `0.5` 平常 |
| `emotion` | 0~1，可空 |
| `factKey` | 同一件事的新旧版本共用同一个键 |
| `supersedes` / `supersededBy` / `invalidAt` | 取代链（对齐 Graphiti 的双时态） |
| `hits` / `lastHitAt` | 被检索命中的次数与时间（强化用） |
| `state` / `archiveReason` / `archiveAt` | 在用 / 被取代 / 归档 |
| `profileConfirmed` | `profile` 只有主人确认过才注入 |

**P0 只加字段、不改渲染** —— 注入文本与打补丁之前逐字相同。这是它有资格先跑几天看 diff 的原因。

## 基线

- 目标：`dsh-workspace-recollection` 2.5.0（MIT，© 2026 reaxlll）
- 作者本地还打过两处与本次无关的改动（身份分层、模型下载修复），所以 `p0-lifecycle.diff` 的上下文
  与**本项目的本地副本**一致。对纯 2.5.0 打补丁时，`git apply --check` 很可能失败 ——
  请按 [patch/README.md](patch/README.md) 里的 6 个接线点手工接，比盲打安全。

## 怎么用

```bash
cd path/to/dsh-workspace-recollection
git apply --check p0-lifecycle.diff && git apply p0-lifecycle.diff
```

打完后跑一次注入对账，确认「加了字段，助手看到的东西没变」：

```bash
node tools/p0-diff.mjs --snapshot --from memory.before.json   # 迁移前
node tools/p0-diff.mjs                                        # 迁移后
```

## 验收标准

- 迁移后每条记忆都有 `kind`，且**剥掉新字段后与原数据逐字段一致**
- 注入文本与迁移前逐字相同
- 会话导入类流水应全部落成 `event`，环境/踩坑类落成 `fact`

## 已知限制

- 分层注入（P1）还没实现：现在装上**不会**改变任何注入行为，只是把字段存进去
- 不包含上游源码；也不包含任何真实记忆数据（本仓库与 release 资产里都没有 `memory.json` / 向量库）
- 补丁与上游 2.5.0 的上下文不完全对齐，属于「设计 + 一次真实落地」而非通用发行版

## 资产

- `dsh-longitudinal-memory-v0.1.0.zip` —— 文档 + 补丁 + 工具（就是本仓库当前内容）
