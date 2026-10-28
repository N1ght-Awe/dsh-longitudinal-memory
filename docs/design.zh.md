# 纵向记忆：给本地 AI 助手加一层会淡忘的长期记忆

> 横向（记得人）已经做完：身份范围、跨会话共享、私聊/群聊隔离。
> 这份文档解决的是纵向：**同一件事随时间的变化**，以及"什么常驻、什么按需翻、什么到点就扔"。
> 结论先放前面：**不新开库，只给现有那个抽屉装隔板。**

---

## 0. 一句话结论

现有 `dsh-workspace-recollection` 已经有「浅层要点 + 深层原文 + 段级切片」这套**检索**的纵向，
缺的是**生命的纵向**：条目没有种类、没有时间锚、没有重要度、不会淡、不会取代、不会巩固。
补上四件事就够，不需要第二套存储：

1. `kind`（profile / fact / event）——决定它**进不进注入**
2. `at` + `freshness`（时间锚 + 衰减）——决定它**什么时候退场**
3. `factKey` + `supersededBy`（事实键 + 被取代）——决定它**怎么表达"变化"**
4. 巩固任务（日结 → 提事实 → 归档）——决定**谁来挑**

---

## 1. 现状（实测，不是猜的）

### 1.1 装的是什么

| 项 | 实况 |
|---|---|
| 插件 | `dsh-workspace-recollection` 2.5.0，`lib/` 5295 行，本地补丁标记 `identity-audience-v1` |
| 存储 | `$DSH_HOME\session-memory\memory.json`（335 KB）+ `vectors.json`（1.2 MB） |
| 向量 | 本地 bge-small-zh 量化模型，每条两份向量（浅层 s / 深层 d） |
| 注入 | 唯一入口 `lib/index.js:2768` `systemPrompt.section()`，预算 `budgetChars = 6000` |
| 工具 | `memory_write` / `recall` / `locate` / `detail` / `import` / `session_read` / `search` / `forget` |
| 身份 | `identity-policy.json` v2：个人库 `identities\<owner>\<persona>`、桥接、群、桌面工作区 |
| 上限 | 每工作区 500 条、单条正文 20000 字、summary 200 字 |

### 1.2 库里现在有什么（四个桶，共 44 条 / 约 14.3 万字）

| 桶 | 条数 | 正文字数 | 说明 |
|---|---|---|---|
| 个人库（按人物隔离） | 5 | 597 | 2 条偏好类条目（其中 1 条是验收测试数据）、3 条 fish 迁移来的旧条目 |
| `<workspace>` | 5 | 4,236 | 环境/踩坑/决策，质量最好的一批 |
| `<workspace-2>` | 3 | 2,612 | 约定/工具/pet 配置 |
| QQ 桥接 agents | 31 | 135,329 | **全部是"会话导入"的原始流水**，单条 4 KB 上下，summary 只有 16–87 字 |

最后一行就是问题本身：**135 K 字的流水账挤在同一个抽屉里**，它们既不是事实也不是习惯，
却和"主人的口味偏好"享有完全相同的注入权重和检索权重。这就是助手说的"一锅粥"的物理形态。

### 1.3 已经有 / 还缺什么

| 能力 | 现状 | 缺口 |
|---|---|---|
| 跨会话共享（横向） | ✅ 个人库 + 身份范围 | — |
| 浅→深渐进披露 | ✅ 要点 → 段号 → 切片 | — |
| 常驻 vs 按需 | ⚠️ 只按 `pinned` / `meta` 二分 | 缺"人格/习惯"这一层 |
| 时间 | ❌ 只有 `createdAt/updatedAt`（记录时间，不是发生时间） | 缺 `at`、缺时间线上的"那阵子" |
| 重要度 / 情绪 | ❌ 无 | 缺 `importance` / `emotion` |
| 衰减 / 遗忘 | ❌ 只有容量裁剪 `trimEntries`（按时间丢） | 缺 `freshness`、缺归档 |
| 巩固 / 合并 | ❌ 无 | 会话导入 31 条没人提炼 |
| 事实演化 | ❌ 更正靠 `replace_id` 覆盖，旧值直接消失 | 缺 `factKey` + 被取代链 |
| 写入配额 | ❌ 无 | 靠模型自律，容易灌垃圾 |

### 1.4 一个被忽略的资产

`<bridge>\state\diaries\2026-10-26.md` —— 桥接侧已经有**按天写的第一人称日记**。
它天然就是"纵向"的原始素材（当天发生什么、当时怎么想），只是没接进记忆库。
它应该产出 `event`，再由巩固任务提成 `fact`。

---

## 2. 目标 / 非目标

**目标**
- 同一件事能记住"以前是 X、什么时候变成 Y"（纵向的本质，不是记住更多，是记住变化）
- 常驻层不膨胀：人格/习惯有硬上限，且只有主人能定
- 索引层可查证：事实有话则长、无话则短，一行一条
- 经历层会退场：旧流水自动淡出索引和注入，但不真删，问得到

**非目标（明确不做）**
- ❌ 不新开第二个库、不做双写（助手的原话：再开一套得写两份，早晚对不上）
- ❌ 不把全文塞进注入（索引 + 按需展开，双向都省 token）
- ❌ 不让 LLM 决定权限（`person-policy.js` 现有原则保持：权限是配置，不是判断）
- ❌ 不做全自动人格改写（profile 层必须主人确认）

---

## 3. 三层模型

| 层 | 装什么 | 注入 | 生命周期 | 谁能写 | 上限 |
|---|---|---|---|---|---|
| `profile` 习惯层 | 称呼、口味、作息、说话方式、底线、共同约定 | **常驻**（全文） | 不衰减；只有被新值取代 | 主人明确说 / 巩固候选 + 主人确认 | 按 slot 分节（每节 ≤8 条 × 40 字），总 ≤1500 字 |
| `fact` 事实层 | 项目结论、踩过的坑、偏好细节、人物关系、设备与环境 | **索引**（一行一条，按需 recall） | 半衰期 180 天；常被想起可续命 | agent / 面板 / 巩固 | 300 条 |
| `event` 经历层 | 那天说了什么、做了什么、当时的情绪 | **不注入**，只 recall | 半衰期 30 天（带情绪 7 天）；淡到阈值归档 | 日结 / 会话导入 | 500 条（活的） |
| `meta` 施工层 | 改了哪个文件、待重启、自查 | 不注入 | 同 event，且默认 7 天归档 | agent | — |

> 现有 `pinned` 不取消，但语义收窄为"这条在索引里排最前"，不再等于"常驻"。
> 常驻只有 `profile` 一种，避免又长出一个不受控的注入源。

### 3.1 字段（全部可选，缺省兼容旧数据）

在现有 entry 上新增：

```js
kind: "profile" | "fact" | "event"       // 缺省按 source.origin + tags 推导（见 3.2）
at: "2026-10-26T21:05:00+08:00" | ""      // 事情**发生**的时间（≠ createdAt 记录时间）
importance: 1 | 0.5                       // 1 = 长期有效（不淡）；0.5 = 平常（按 kind 半衰期淡）
emotion: 0..1 | null                      // 有情绪才填；空 = 无
factKey: "饮品偏好"                        // 会变化的事共用一个键（纵向的钩子）
supersedes: ["mem_x"]                     // 本条取代了谁
supersededBy: "mem_y"                     // 被谁取代（只读派生）
invalidAt: ""                             // 被取代的时间（= Graphiti 的 invalid_at）
hits: 0                                   // recall 命中次数（强化）
lastHitAt: ""                             // 上次被想起
state: "active" | "archived"              // 归档 = 出索引，仍可 recall
archiveReason: "decay"|"superseded"|"capacity"|"manual"
archiveAt: ""
profileConfirmed: "owner" | ""            // profile 只有 owner 确认过才注入
```

`freshness` **不落盘**，每次按 `at` + `kind` + `hits` 现算，避免"每天写回 44 条"的写放大。

### 3.2 缺省推导（迁移用，不打扰现有数据）

- `source.origin === "person-bridge"` 或 `tags` 含偏好/约定 → `fact`
- `tags` 含「会话导入」→ `event`
- `meta === true` → `event`（且 `meta` 保留，继续不注入）
- 其余 → `fact`

---

## 4. 生命周期：衰减、强化、取代

### 4.1 鲜活度

沿用 `dsh-fish-memory` 已经调过的口径（那个插件用过半年，参数是被实际反馈磨出来的）：

```
age  = now - (at || createdAt)
half = profile ? ∞ : importance === 1 ? ∞ : fact ? 180d : (emotion >= 0.6 ? 7d : 30d)
fresh = 0.5 ** (age / half)
fresh += 0.1 * log2(1 + hits)        // 被想起本身是强化，上限 +0.3
fresh = min(1, fresh)
```

- 普通经历：一个月剩一半 → 符合"琐事慢慢淡"
- 带情绪的经历：一周剩一半 → 但情绪值高的 `importance` 也高，会在**还没淡完的时候**被巩固成 fact
- `importance === 1`：不淡（等价 fish-memory 的"要一直记得的"），配上 `hits` 强化
- profile：恒为 1

### 4.2 排序（recall 时）

```
imp  = importance === 1 ? 1 : 0
rank = 0.60 * 相似度 + 0.20 * fresh + 0.15 * imp + 0.05 * emotion
```

现有 `noise.js` 的四路降噪（绝对底线 / 硬关键词 / 比值长尾 / 平局）**全部保留**，
`rank` 只替换原来的"分数字段"，不改过滤逻辑 —— 那套是踩过坑调出来的，别动。

### 4.3 取代（纵向的核心）

同一 `factKey` 出现矛盾时**不覆盖**：

```
旧: { factKey:"饮品偏好", text:"喜欢奶茶", at:"2026-10-20", state:"active" }
新: { factKey:"饮品偏好", text:"改喝美式了", at:"2026-11-08", supersedes:["旧id"] }
    → 旧.state = "superseded"，新.supersededBy = null
```

- 默认查询只看 `state==="active"`
- 问"以前呢 / 什么时候变的" → 顺着 `supersedes` 链返回，并带 `at`
- 面板上显示成一条时间线：`10-20 奶茶 → 11-08 美式`

**判矛盾的禁令**（直接抄 Graphiti `dedupe_edges.py` 的教训，原文是英文，这里是等价规则）：

| 禁止 | 因为 |
|---|---|
| 因为"新的事实更新"就判旧事实矛盾 | 更新 ≠ 否定；只有新值**明确让旧值为假**时才取代 |
| 把"新发生了一件事"当成矛盾 | 「今天去了趟医院」不否定「她不喜欢医院」 |
| 因为"某人在这项目上干活"判他不再负责别的项目 | 有交集不等于否定 |

宁可**并列两条**（都不标 superseded），也不要错杀 —— 错杀的后果是这条记忆永远查不到。
字段名与 Graphiti 对齐：`at`（= `valid_at` 生效时间）、`invalidAt`（= 被取代的时间）、
`createdAt`（= 记下来的时间）三者分开存，这样"当时我以为"和"后来才知道"也分得清。

这一条是现在**完全没有**的：`replace_id` 是覆盖，覆盖之后"曾经是什么"就永远丢了 —— 那不叫纵向记忆，那叫最新快照。

### 4.4 归档而非删除

| 触发 | 条件 | 去向 |
|---|---|---|
| 衰减 | `event` 且 `fresh < 0.15` 且 `hits === 0` 且 `age > 180d` | `state=archived` |
| 取代 | 被新条目取代 | `state=superseded` |
| 容量 | 该层超上限（按 `fresh × importance` 淘汰尾部） | `state=archived` |
| 主人明确 | `memory_forget` | 改成：先归档，30 天后物理删（现在是一按就真删，只挡 `locked`，见 `index.js:2329`） |

归档条目：不进索引、不参与注入、`memory_recall` 默认跳过；带 `include_archived` 可查。
**永不静默删除** —— 用户最怕的是"我明明记得它说过"。

---

## 5. 注入预算（6000 字怎么分）

| 块 | 预算 | 内容 |
|---|---|---|
| `profile` | ≤ 1500 | 按 slot 分节（称呼/口味/作息/约定/底线），每节 ≤8 条 × 40 字 |
| `fact` 索引 | ≤ 2600 | `- [topic] at · summary`，一行；最多约 40 行 |
| `pinned` 要点 | ≤ 800 | 保留现有行为（pin 了但不在 profile 的条目） |
| 余额 | ~1100 | 超长 fact 的第二行、以及 `还有 N 条，用 memory_recall 查` |

- `event` 进注入 **0 字**（只 recall）
- 工作区桶（非私聊身份）继续走 `renderSection`，同一套分层，只是没有个人库
- 超预算时按 `rank` 截断，并且**明确写出被截断的条数**，不静默

---

## 6. 巩固：谁来挑

### 6.1 写入前先过三问

| 问题 | 归层 |
|---|---|
| 明天不提它，会不会改变我怎么说话 / 怎么称呼他？ | `profile`（候选，等确认） |
| 以后可能需要查证或复用？（路径、结论、约定、偏好细节） | `fact` |
| 只是"那天发生了什么"？ | `event`（60 字以内 + `at`） |
| 都不改 → | **不写** |

配额：`event` 每天 ≤ 8 条（借 fish-memory 的 dailyQuota），`fact` 每次会话 ≤ 3 条，
`profile` 永远只能由主人确认（模型只能塞"候选"进面板待办）。

### 6.2 三档节奏

| 频率 | 动作 | 产物 |
|---|---|---|
| 日结 | 当天 `event` 按会话聚合（桥接侧 diary 可直接当正文） | 1 条 `event`，`at=当天`，summary 3 行 |
| 周巩固 | 近 7 天 `event` + 新 `fact` → 提炼候选 `fact`（带 `factKey`） | 同键一致 → 只加 `hits`；矛盾 → 新条目 + `supersedes`；新增 → 入 `fact` |
| 月清理 | `fresh < 0.15` 的 event、超限的 fact | 归档，写 `archiveReason` |

巩固是**后台 LLM 任务**，复用现有 `queueSummary` 那条通道（`ctx.llm.stream`），
失败不阻塞、留 `consolidationState: failed` 可重跑 —— 与现有 summary 的行为保持一致。

### 6.3 现成的提示词（可直接搬）

`dsh-fish-memory` 的提炼提示词（`lib/index.js:1340-1397`）已经在真实数据上磨过，
判定规矩几乎全部适用，**不用重写**：

| 规则 | 原话要点 |
|---|---|
| 输出格式 | 每行 `编号｜记忆｜检索词｜日期｜重要度｜事实键`，不解释 |
| 重要度 | `1` = 要一直记得的（性格/关系/约定/称呼/喜好/身体/重要日子/经济状况/家里情况）；`0.5` = 平常；拿不准填 0.5 |
| 事实键 | 写成「对象.方面」，如 `我.脾气`、`约定.身边位置` |
| 键里不许有值 | 写 `她.身高`，**不许**写 `她.身高170`（写了值 = 摘要，值一变就永远碰不上） |
| 不许万能键 | `…话.内容`、`…相关`、`…其他`、`…的事`、`…记录` 一律禁止 |
| 流水不给键 | 作息、吃了什么、当天做了什么、某天的心情 —— **给了同一个键等于把流水删到只剩最后一天** |
| 成对的事同键 | 「拼团还没开」和「拼团开了」→ 都写 `拼团.状态` |
| 跳过 | 一次性琐事（某天吃了什么/天气/刷到的东西）、寒暄撒娇甜话的**汇总** → 写「跳过」 |
| 不许跳过的 | 喜好、习惯、身体病史、关系、约定、名字称呼、重要日子、持续经济状况 |

最后一条口诀要抄进代码注释里：**「这个键是给『会变的那一个值』用的吗？是就给，不是就留空。」**
这是唯一一条能防住"把一段生活压成一个值"的规矩 —— 也就是纵向记忆最容易犯的错。

### 6.4 另外三份可直接抄的提示词（来自 OSS 源码，已核对）

| 来源 | 抄什么 | 为什么值得抄 |
|---|---|---|
| mem0 `FACT_RETRIEVAL_PROMPT` | 抽取前先声明"只记 7 类信息"，输出 `{"facts":[...]}`，**注入当前日期**，闲聊返回空数组，用用户的语言记录 | 治愈"什么都想记"；空数组这个出口很关键，模型才敢什么都不记 |
| LangMem `_MEMORY_INSTRUCTIONS` | 三段式：① Extract & Contextualize（**带置信度 p(x)**）② Compare & Update（合并压缩、最大化信噪比）③ Synthesize & Reason | 第二段正是我们要的"同键比对"；置信度让"拿不准"有地方放 |
| Graphiti `dedupe_edges.py` | 输出分两组：`duplicate_facts`（只能来自已有条目）/ `contradicted_facts`；系统提示 **"NEVER mark facts as contradicted unless the new fact explicitly makes the old fact false"** | 见 §4.3 三条禁令 |

LangMem 还有个细节值得抄：`enable_deletes=False` —— **默认不让模型删**，删除是显式动作。
我们照做：巩固任务只能产出 `event/fact` 和 `superseded`，**不能**直接 `forget`。

### 6.5 上游版本核对（2026-10-27）

| 项 | 结果 |
|---|---|
| 本地安装 | `dsh-fish-memory` **1.2.2**（已从 profile bundles 移除，数据迁出，代码还留一份） |
| 上游最新 | **1.3.7**（<https://github.com/Yuuyuko-uu/dsh-fish-memory>，main 分支 `package.json`） |
| 差在哪里 | 1.3.x 的新说法：「**长期事实每轮都在** —— 按重要度→时间固定带前几条，不看这句话问了什么，也不占『最多注入几条』的位置，剩下的位置才留给事件」 |

这条更新正好是我们 P1 要做的常驻层，而且给出了**槽位口径**：常驻条目不占用事件名额，两者各算各的。
Fork 时照这个实现 —— `profile` 配额与 `fact` 索引配额分开算，别互相挤。

不必把 fish-memory 升级装回去（它和 recollection 会抢同一个会话的记忆）；只借用它的参数与提示词。


---

## 7. 现有 44 条怎么处置

| 桶 | 处置 | 理由 |
|---|---|---|
| 个人库 · 2 条饮品偏好 | 合并成 1 条 `fact`（`factKey=口味偏好`），删掉"验收饮品"测试条 | 现在是两条互相打架的测试数据 |
| 个人库 · 3 条 fish 迁移 | `fact`，保留 pinned | 内容是约定/权限，稳定 |
| `<workspace>` 5 条 | `fact` | 环境与踩坑，正是"可查证"层 |
| `<workspace-2>` 3 条 | `fact` | 约定与工具 |
| 桥接 31 条会话导入 | **先跑一次巩固**，能提出 fact 的提出来（估计 5–8 条），其余 `kind=event` 等它自己淡出 | 直接归档会丢信息；直接留着就是一锅粥 |
| 各桶 `meta` 条目 | `event` + 保持不注入 | — |

迁移脚本一次性跑，写 `migration-v4` 记录，与现有 `migrate.js` 的备份机制同款（迁移前自动备份、失败可回读）。

---

## 8. 实施清单（每项都能单独验收）

### P0 · 字段与迁移（不动行为）✅ 2026-10-27 已落地

- [x] `lib/store-logic.js` 加 `deriveKind(entry)` / `deriveImportance(entry, kind)` / `normalizeLifecycle(entry)`
- [x] `lib/migrate.js` 注册 `3 → 4` 迁移步（`STORE_MIGRATIONS` 原本是空 Map、store 版本 3）
- [x] `memory_write` 接受 `kind` / `at` / `importance` / `emotion` / `fact_key`，缺省推导
- [x] **验收**：45 条全部有 `kind`；剥掉新字段后旧字段逐字未变（干跑输出见下）

实现与验收记录：

| 项 | 结果 |
|---|---|
| 改动范围 | 只改 3 个文件：`store-logic.js` / `migrate.js` / `index.js`（diff 见 [`patch/p0-lifecycle.diff`](../patch/p0-lifecycle.diff)） |
| 单测 | `node tests/lifecycle.test.mjs` —— 8 条全绿（种类/重要度/幂等/非法值/只加不改/迁移/重跑/坏数据） |
| 干跑 | 45 条：fact 13 / event 32 / profile 0；每条新增 14 字段，旧字段 0 改动 |
| 对账 | [`tools/p0-diff.mjs`](../tools/p0-diff.mjs) —— 迁移前后，注入用到的字段零差异 |
| 冒烟 | [`tools/smoke-memory-plugin.mjs`](../tools/smoke-memory-plugin.mjs) —— 把 ESM 链接验证提前到重启之前 |
| 生效 | 重启宿主；重启前行为完全不变 |

> ⚠️ **升级/重装这个插件后必须重跑一次补丁**：否则装回来的是 2.5.0 原版，
> 它看到 v4 数据会按「太新」处理 → 记忆库进入**只读**（数据不丢，但记不进去）。
> 判断方法：`memory.json` 的 `version` 是 4，而插件里 `STORE_VERSION` 是 3，就是这个情况。

干跑发现的真实分布（也就是这次"一锅粥"的量化）：

```
d:\workspace                 6 条  fact 5 / event 1
e:\workspace-2                   3 条  fact 3 / event 0
…\state\agents               31 条  fact 0 / event 31   ← 会话导入全落 event
identities\…\<persona>      5 条  fact 5 / event 0
```

`node --test` 在这个沙箱里跑不起来（`spawn EPERM`，子进程管道被拦），直接 `node tests/xxx.test.mjs` 即可。

### P1 · 注入分层
- [ ] `lib/index.js:1395 renderSection` 与 `identity-memory.js:129 renderIdentityPrompt` 改为共用 `renderLayers()`
- [ ] profile 常驻块 + fact 索引块 + pinned 块，各自预算
- [ ] `event` 不进注入
- [ ] **验收**：注入里能看出三段；把一条 fact 改成 event 后它从注入消失、但 `memory_recall` 仍能查到

### P2 · 检索排序与强化
- [ ] `noise.js` 增加 `rankOf(entry, similarity, now)`，`filterHits` 只换排序不改过滤
- [ ] `memory_recall` 命中后 `hits += 1` / `lastHitAt = now`（批量落盘，别每条 flush）
- [ ] `memory_recall` 支持 `include_archived`
- [ ] **验收**：同一查询，旧条目 rank 低于新条目；连查三次后该条 `hits===3`

### P3 · 取代链
- [ ] `factKey` 同键 + 内容矛盾 → 自动 `supersedes`（巩固任务里判定；手动 `memory_write` 也可显式传入）
- [ ] `memory_recall` / `memory_detail` 默认只出 active；显式问"以前"时出链
- [ ] 面板显示时间线
- [ ] **验收**：改一次偏好后，默认查询只看到新值；带 `history:true` 能看到旧值 + 日期

### P4 · 巩固与清理
- [ ] 新文件 `lib/consolidate.js`：`dailyDigest` / `weeklyFacts` / `monthlySweep` 三个纯函数 + LLM 提示词
- [ ] 面板加"巩固""清理"两个按钮（先手动，稳了再定时）
- [ ] 配额：event 8/天、fact 3/会话
- [ ] **验收**：对桥接 31 条跑一次，产出 ≥5 条 fact，且 31 条里 ≥20 条变成 event

### P5 · 老数据处置
- [ ] 按 §7 逐桶迁移，跑完出报告（每桶多少条、提出多少 fact、归档多少）

### 升级保护（从现在就要做）
- [ ] 补丁方式改为 **fork 一份插件源码 + `pnpm link`**，不再直接改 `node_modules`
- [ ] 保留现有 `*.orig-local` 备份习惯（升级会覆盖，这条已经踩过）

---

## 9. 风险与回滚

| 风险 | 处理 |
|---|---|
| 分层把现有注入搞乱，助手突然"忘事" | P0 只加字段不动渲染，跑一周看注入 diff 再上 P1 |
| 巩固任务瞎抽象，把事实提错 | 所有 fact 都保留 `source` 指回 event；错的能一键退回 |
| 衰减太狠，把有用的淡没了 | 不真删；`fresh` 只影响排序和索引，`recall` 仍可命中归档后的相邻条目 |
| 本地补丁被插件升级覆盖 | 改 fork + link（见 P5 末条） |
| 双写两套存储 | 明确不做；所有层都在 `memory.json` 一个文件里，靠 `kind` 分 |

---

## 10. 待拍板（4 个）

1. **载体**：继续直接改 `node_modules`、还是 fork + link（推荐后者，升级不丢）
2. **巩固自动化**：先纯手动按钮 / 还是每日自动跑（推荐手动两周，稳了再定时）
3. **31 条会话导入**：先提炼再归档 / 还是直接归档（推荐先提炼，一次就够）
4. **profile 写入权**：只有主人明确说才写 / 还是模型可自荐进"待确认"（推荐后者，但注入前必须确认）

---

## 11. 参考：别人怎么做的（可抄清单）

### 11.1 对照表

| 项目 | 分层 | 写入 | 检索 | 遗忘/演化 | 许可 |
|---|---|---|---|---|---|
| **mem0** | 无显式层；`user_id/agent_id/run_id` + metadata 定作用域 | `add()` 同步跑：检索旧记忆 → LLM 抽 facts → 去重嵌入 → 写库；2026 版**默认只增不改**（additive） | SQL(事实源) + 向量库 + 实体表；语义/关键词/实体/时间四信号 | 无衰减；靠去重 + 显式删 + top-k | Apache-2.0 |
| **Letta (MemGPT)** | **MemFS 两级**：根目录下的 `persona.md` / `human.md` **每轮进 system prompt**；带 `MEMORY.md` 的子目录不进上下文、按需读 | agent 用文件工具改 Markdown 并 git commit；`dreaming` 子代理后台整理（`stepCount: 25`） | 文件树当索引（frontmatter `name`/`description` 就是摘要）；**默认没有向量索引** | 无衰减；靠重写 + compaction | Apache-2.0 |
| **Zep / Graphiti** | Episodic → Entity → Community 三层图 | 抽实体 → 去重 → 抽边 → 对旧边判 `duplicate`/`contradicted` → 矛盾则旧边写 `invalid_at` | cosine + BM25 + BFS 三路，RRF/MMR 重排 | **双时态**：`valid_at / invalid_at / created_at / expired_at` ← 同我们的 `supersededBy` | Apache-2.0 |
| **cognee** | 图谱 + 向量块 + 会话记忆；会话可「蒸馏」成永久记忆 | `remember / improve / forget`，无 key 时用本地 GLiNER 抽取 | 图 + 向量 + 代码符号三路 | 无衰减；靠 forget | Apache-2.0 |
| **LangMem / LangGraph** | 长记忆 = `Memory(content)` 条目，短记忆 = 摘要；checkpointer（线程内）vs Store（跨线程） | 已有记忆 + 新对话一起喂模型，出 insert/update/delete（**delete 默认关**），`max_steps` 多轮补丁 | Store：`namespace + key + asearch`，`query_limit=5` 多查询召回 | 无衰减 | MIT |
| **A-MEM** | 单层 Zettelkasten 卡片：`content/tags/category/context/keywords/timestamp/links` | 写入时生成 context/keywords/tags → 向量找近邻 → **反向改写近邻的 context**（记忆演化） | 卡片 + 链接 + 向量，`k=5` | 演化而非删除 | MIT |
| **TiMem** | — | — | — | — | ❓ **GitHub 搜不到对应仓库**，截图里那份说法查不到出处 |

### 11.2 四条结论（对着我们的 A/B/C/D）

**A. 常驻层怎么写才不膨胀** —— Letta 的做法最直接可抄：MemFS 里**根目录文件每轮全量注入**，
子目录只靠各自的 `MEMORY.md` 当索引、按需读。对应我们的 `profile`（根）与 `fact`（子目录）。
LangMem 补一条：更新是**打补丁（insert/update）而不是追加**，且 `enable_deletes=False`；
写入提示里明写 "Consolidate and compress redundant memories"、拿不准的标置信度 `p(x)`。
落到参数：`profile` 按 slot 分节（称呼/口味/作息/约定/底线），每节 ≤8 条 × 40 字，总 ≤1500 字，
溢出**降级成 fact**（留 `source` 指回去），不许无声截断。

**B. 索引 + 展开** —— 最成熟的公开实现是 Letta MemFS：目录 + `MEMORY.md` 清单 + frontmatter `name/description`，
展开 = 读文件。我们已经有更好的（`locate` 段级定位到几百字），**不必再引入图数据库**。
只补索引字段：`id / title(≤20 字) / summary(≤80 字) / kind / tags / at / importance / hits / sourceRefs`，
注入只放 `title + summary + at`（30–60 token/条）。

**C. 衰减** —— **这 7 个项目没有一个在 OSS 里做数值衰减**（这条是本次核实过的反直觉结论）：
它们用离散机制替代 —— 矛盾失效（Graphiti `invalid_at`）、容量上限（`limit=10`、`query_limit=5`、`min_score=0.6`）、
压缩合并（dreaming 每 25 步）、内容哈希去重（mem0）。
所以衰减参数**只能从我们自己的 `dsh-fish-memory` 拿**（30 天 / 情绪 7 天 / 重要度 1 不淡，被真实反馈调过），
演化（取代）抄 Zep 的双时态 —— 两边各取所长，不硬套某一个项目。
（业界另有 Generative Agents 的 `0.995^hours` 式衰减，本次未核对原文，不采用。）

**D. 单机可跑性** —— 能直接跑的：mem0（Chroma/in-memory + SQLite）、LangMem + LangGraph（InMemoryStore / SqliteSaver）、
A-MEM（Chroma + MiniLM）。只能抄设计的：Letta（要整套 agent runtime）、Graphiti（默认要 Neo4j/FalkorDB）、cognee（依赖重）。
我们的场景（单进程、单 JSON + 本地 ONNX 向量）继续走"纯本地 + 零依赖"。

> 编号 4 的提醒：**别为了"像个正经系统"引入图数据库**。44 条记忆 + 一个人，`factKey` 加一个字段就够。

### 11.3 出处

完整调研（含源码字段、参数、提示词原文、链接）见 [`docs/ai-memory-survey.md`](docs/ai-memory-survey.md)。关键几处：

- mem0 抽取/更新提示词：`mem0/configs/prompts.py`（v0.1.114）；机制与评测：<https://docs.mem0.ai/core-concepts/how-it-works.md>、<https://arxiv.org/abs/2504.19413>
- Letta MemFS：<https://docs.letta.com/concepts/memfs/index.md>；dreaming：<https://docs.letta.com/agent-sdk/memory/index.md>
- Graphiti 检索参数与矛盾判定：`graphiti_core/search/search_config.py`、`graphiti_core/prompts/dedupe_edges.py`；仓库 <https://github.com/getzep/graphiti>
- LangMem 抽取指令：`src/langmem/knowledge/extraction.py`；LangGraph 分层：<https://docs.langchain.com/oss/python/langgraph/persistence.md>
- A-MEM：<https://github.com/agiresearch/A-mem>；cognee：<https://github.com/topoteretes/cognee>

未查证的（不要当结论用）：star 数、Letta 现行 memory block 字数上限、Graphiti `rrf()` 的 k 常数、Zep 论文分数（仅见转述）。

