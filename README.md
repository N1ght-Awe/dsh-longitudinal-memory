# 纵向记忆 · Longitudinal Memory

给本地 AI 助手加一层**会淡忘、会取代、分三层**的长期记忆。

> 横向记忆是"记得人"——跨会话、跨场合认出同一个人；
> 纵向记忆是"记得事怎么变的"——同一件事从 X 变成 Y，什么时候变的。
> 这个仓库做的是后者：设计文档 + 一个可核对的补丁 + 两件验证工具。

[设计文档](docs/design.zh.md) · [开源实现调研](docs/ai-memory-survey.zh.md) · [补丁说明](patch/README.md)

---

## 上游关系：补丁打在哪，理念从哪来

这三件事经常被混成一件事，所以先分清：

| 角色 | 项目 | 我们用它什么 |
|---|---|---|
| **补丁打在这里** | [`dsh-workspace-recollection`](https://github.com/reaxlll/dsh-workspace-recollection) 2.5.0（MIT） | 已经有的能力：记忆存储、身份范围（个人库/群/工作区）、浅层+深层双向量、段级 BM25 定位、注入预算。本补丁**只往它上面加字段** |
| **衰减与事实键的来源** | [`dsh-fish-memory`](https://github.com/Yuuyuko-uu/dsh-fish-memory)（MIT） | 半衰期 30 天 / 情绪 7 天、重要度 1 与 0.5 两档、每天最多记 8 条、事实键与"已被取代"、以及那份磨过的提炼提示词 |
| **设计对照** | mem0 / Letta / Graphiti / cognee / LangMem / A-MEM | 双时态失效（Graphiti）、常驻层槽位（Letta MemFS）、矛盾判定禁令 |

**为什么补丁打在 recollection、而不是以 fish-memory 为基座？**

fish-memory 的存储形态是"一个会话一个 JSON"，天生不跨会话；要它承载纵向记忆，
得先把身份边界、个人库、双向量、段级定位、注入预算全部搬过去 —— 而这些恰好是 recollection 已经有的。
反过来，让 recollection 学会鱼的衰减规则，只是加几百行的事。
所以取的是：**recollection 的骨架 + fish-memory 的血肉（参数与提示词）+ 调研来的三条规矩**。

fish-memory 1.3.x 自己也加了"长期事实每轮都在"，说明两边在往同一个方向长；但它仍然没有身份边界。

---

## 问题：不是记不住，是记的东西不分轻重

一个真实库的实测（一次自用部署，脱敏后的统计）：

| 内容 | 条数 | 字数 |
|---|---|---|
| 会话导入的原始流水 | 31 | 135,329 |
| 环境与踩坑 | 5 | 4,236 |
| 约定与工具 | 3 | 2,612 |
| 个人偏好（含 1 条测试数据） | 5 | 597 |

31 条流水既不是事实也不是习惯，却和"主人喜欢喝什么"享有**完全相同的注入权重与检索权重**。
聊得越久，索引越像一锅粥，而真正该记住的那几行被稀释掉了。

缺的不是存储容量，是**分层**和**清理规矩**。

---

## 三层

| 层 | 装什么 | 进注入 | 生命周期 |
|---|---|---|---|
| `profile` 习惯层 | 称呼、口味、作息、底线、共同约定 | **常驻**（全文） | 不衰减；只能被新值取代 |
| `fact` 事实层 | 项目结论、踩过的坑、偏好细节、设备与环境 | **索引**（一行一条，按需检索） | 半衰期长；常被想起可续命 |
| `event` 经历层 | 那天说了什么、做了什么、当时的情绪 | **不注入**，只检索 | 会淡；淡到阈值归档 |
| `meta` 施工层 | 改了哪个文件、待重启 | 不注入 | 更快归档 |

常驻只有 `profile` 一种，且只能由主人确认写入 —— 自动生成的"人格层"一定会膨胀。

---

## 四条机制

**1. 种类决定它进不进注入**
每条记忆带 `kind`。`event` 进注入 0 字；`fact` 只出一行索引；`profile` 全量常驻。

**2. 时间锚 + 鲜活度**
`at` 记的是**事情发生的时间**，不是记录时间。鲜活度按下式现算（不落盘，避免每天写回全库）：

```
half  = profile 或 importance===1 ? ∞ : fact ? 180d : (emotion>=0.6 ? 7d : 30d)
fresh = 0.5 ** (age / half) + 0.1 * log2(1 + hits)
```

**3. 事实键 + 取代链（纵向的核心）**

```
旧: { factKey:"口味偏好", text:"喜欢奶茶",  at:"2026-10-20" }
新: { factKey:"口味偏好", text:"改喝美式了", at:"2026-11-08", supersedes:["旧id"] }
    → 旧条 state=superseded、invalidAt=11-08；默认查询只看到新值，问"以前呢"能翻回旧值
```

大多数实现（含 mem0）在这里是**覆盖**：覆盖之后"曾经是什么"就永远丢了 —— 那不叫纵向记忆，那叫最新快照。

判矛盾有三条禁令（抄自 Graphiti 的教训）：不能因为"更新"就判旧值为假、
不能把"新发生一件事"当矛盾、不能因为"有交集"就否定别的。

**4. 巩固与归档**
日结 → 周提事实 → 月归档。归档 ≠ 删除：条目留在库里、仍可检索，只是不进索引。
配额：`event` 每天 ≤8 条、`fact` 每次会话 ≤3 条、`profile` 只能由主人确认。

---

## 为什么是这套参数（调研结论）

调研了 mem0、Letta(MemGPT)、Zep/Graphiti、cognee、LangMem、A-MEM（详见 [调研](docs/ai-memory-survey.zh.md)），三个反直觉的发现：

1. **这七家没有一个在开源实现里做数值衰减。** 它们用离散机制替代：矛盾失效、容量上限、定期压缩、内容哈希去重。
   所以衰减参数不是"抄业界默认值"，而是沿用 `dsh-fish-memory` 里被真实反馈磨过的值。
2. **渐进式披露最成熟的实现是 Letta 的 MemFS**：根目录文件每轮全量注入，子目录只挂一份 `MEMORY.md` 当索引、按需读。
   这直接对应我们的 `profile`（根）/ `fact`（子目录）。
3. **"记住变化"只有 Graphiti 做对了**：边带 `valid_at / invalid_at`，旧事实不删、只标失效。

另外引用一句值得抄进代码注释的话（来自 `dsh-fish-memory` 的事实键提示词）：

> **这个键是给「会变的那一个值」用的吗？是就给，不是就留空。**
> 给每天的流水共用一个键，等于把流水删到只剩最后一天。

---

## 仓库里有什么

```
docs/design.zh.md            设计与实施清单（现状实测、三层模型、参数、分期）
docs/ai-memory-survey.zh.md  七家开源实现的源码级调研
patch/p0-lifecycle.diff      P0 补丁：14 个字段 + 迁移 3→4（附接线点说明）
tools/p0-diff.mjs            注入基线对账：加了字段，助手看到的东西变了没有
tools/smoke-memory-plugin.mjs  ESM 链接冒烟：漏导出会在重启前就暴露
```

## 快速开始

```bash
# 1. 移植：把补丁打进你的插件目录（先备份）
cd path/to/dsh-workspace-recollection
git apply --check /path/to/p0-lifecycle.diff && git apply /path/to/p0-lifecycle.diff

# 2. 注入对账：迁移前存基线，迁移后比差异
node tools/p0-diff.mjs --snapshot --from memory.before.json
node tools/p0-diff.mjs

# 3. 改完插件先冒烟，别等重启
node tools/smoke-memory-plugin.mjs path/to/dsh-workspace-recollection
```

补丁的接线点见 [patch/README.md](patch/README.md)。**P0 只加字段、不改渲染** —— 注入文本与改动前逐字相同，
这是它有资格先跑几天看 diff 的原因。

## 版本

- **v0.1.0** —— P0：生命周期字段与 v3→v4 迁移。详见 [RELEASE.md](RELEASE.md)。

---

## 许可

文档、工具与补丁中的新增部分以 MIT 发布；补丁所修改的上游项目 `dsh-workspace-recollection`
（MIT，© 2026 reaxlll）的版权与许可声明见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)。
本仓库**不包含**上游源码，也不包含任何真实记忆数据。
