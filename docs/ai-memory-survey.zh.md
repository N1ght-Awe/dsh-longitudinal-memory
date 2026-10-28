# 开源「AI 长期记忆」项目实现机制调研

> 目的：为单机 Node/TS、单 JSON 文件 + 本地向量库、作用域「跨会话记住一个人」的自研记忆系统提供可抄的工程思路。
> 调研方式：GitHub raw 源码 + 官方 docs（Mintlify 的 `.md` 端点）+ arXiv 摘要。**未查到的数字一律标注，不编造。**
> 核对时间：2026-10-27。

## 0. 一句话结论

业界把「记住一个人」拆成 **常驻小档案（system prompt 里的 Markdown 块）+ 大量按需检索的事实条目**，中间用一层 **索引/摘要（标题 + 一句话描述 + 标签 + 时间）** 做渐进式披露；写入走「LLM 抽取 + 与候选旧记忆对比后 patch」；**遗忘几乎不靠数值衰减，而是靠 失效标记(valid_at/invalid_at)、压缩合并(compaction/summarize)、容量上限 三种离散机制**。

---

## 1. 项目对比表

| 项目 | 分层模型 | 写入策略 | 组织/检索 | 遗忘衰减 | 许可证 | 单机可跑 |
|---|---|---|---|---|---|---|
| **mem0** | 无显式多层；按 `user_id/agent_id/run_id` 作用域 + metadata 过滤；事实条目平铺 | `add()` 同步触发：先检索相关旧记忆 → LLM 抽 facts → 去重/嵌入 → 写库。**2026 版默认 additive（只加不改）**，显式 `update/delete` 才改 | 三库分工：SQL(事实源) + 向量库(嵌入) + 实体表(实体加成)；检索信号 语义/关键词/实体/时间 | 无 importance 衰减；靠去重 + 显式删除 + 检索 top-k | Apache-2.0 | ✅ 可跑（需 LLM+embedding） |
| **Letta / MemGPT** | MemFS 两级：**根目录文件常驻 system prompt** / 带 `MEMORY.md` 的子目录不进上下文按需读；另有对话历史 + dreaming 后台整理 | Agent 自己用文件工具改 Markdown 并 git commit；后台 dreaming 子代理按 `step-count`(默认 25) 或 compaction 触发整理 | 文件树 = 索引；`MEMORY.md` 列目录；**默认无向量索引**，靠文件搜索/读取，可选 memfs-search 扩展 | 无衰减；靠 agent 重写 + dreaming 压缩 + 上下文 compaction | Apache-2.0 | ⚠️ 需完整 agent runtime（抄设计更划算） |
| **Zep / Graphiti** | 三层图：Episodic(原始回合) → Entity(实体) → Community(社区摘要) | `add_episode()` 流水线：抽实体 → 去重(entity) → 抽边(fact) → 对旧边做 **duplicate / contradicted** 判定 → 矛盾则让旧边 `invalid_at` 失效 | 图 + 双时间轴；检索 = cosine + BM25 + BFS 多路，RRF/MMR/节点距离重排 | **双时间失效**：`valid_at/invalid_at`(世界时间) + `created_at`(摄入) + `expired_at`(失效时刻)；无频率衰减 | Apache-2.0 | ⚠️ 需图库（支持 Kuzu 嵌入式但重） |
| **cognee** | 记忆 = 知识图谱 + 向量块 + 会话记忆；会话期「蒸馏」出 lessons 升级为永久记忆 | `remember()` 入图或入 session；`improve()` 做反馈与 session→graph 桥接；`forget()` 删除 | 图 + 向量 + 代码符号图三路；`recall()` 自动路由检索策略 | 无衰减；靠 forget + 合并 + 会话 TTL 语义 | Apache-2.0（仓库标注） | ⚠️ 可本地无 key（GLiNER+本地 embedding），但依赖重 |
| **LangMem** | 长记忆 = `Memory(content)` 条目（semantic/episodic/procedural 统一为条目+自定义 schema）；短记忆 = 对话摘要 | `create_memory_manager()`：把「已有记忆」和「新对话」一起喂模型，输出 insert/update/delete（**delete 默认关**）；`max_steps` 多轮补丁 + `Done` 工具 | LangGraph Store：`namespace=(...,user_id)` + `key` + 语义 `asearch(query=...)`；`query_limit=5` 多查询并行召回再 enrich | 无衰减；靠 update 覆盖 + delete + 检索上限 | MIT（仓库标注） | ✅ 可跑（InMemoryStore/SqliteSaver） |
| **A-MEM** | 单层 Zettelkasten 笔记网络（不是分层，是**链接**） | `add_note()`：LLM 生成 `context/keywords/tags` → 向量找近邻 → 对近邻做「记忆演化」（改它们的 context/tags、连边） | 笔记 + 链接 + ChromaDB 向量；`search_agentic(q,k=5)` | 无衰减；靠演化重写 | MIT（README 明示） | ✅ 可跑（Chroma 本地 + Ollama） |
| **TiMem** | — | — | — | — | — | ❌ **未找到可核实的仓库/论文**，GitHub 搜索无对应项目（详见 §8） |

---

## 2. mem0 —— 最值得抄「写入操作集」的那个

**分层**：严格说没有 working/episodic/semantic 分层。它的「层」是**作用域**：`user_id` / `agent_id` / `run_id` / 自定义 `metadata`，检索时必须带 scope 过滤，否则不同人记忆会串（官方文档明确警告）。

**写入**：两阶段。写入侧 4 步（官方 2026 文档口径）：context lookup → fact extraction → dedup+embed → entity extraction。2026 版关键变化：**自动抽取是 additive 的**，「用户从 Austin 搬到 Seattle」不会静默改写旧事实，要纠正必须显式 `update/delete`。

**历史版操作集（v0.1.114，`mem0/configs/prompts.py`）** 是最经典的、可直接抄的 prompt 设计：

- `FACT_RETRIEVAL_PROMPT`：7 类信息（偏好/个人细节/计划/活动偏好/健康/职业/杂项），输出 `{"facts": [...]}`，few-shot 示例里明确「闲聊 → 空列表」；注入当天日期 `datetime.now().strftime("%Y-%m-%d")`；要求「用用户语言记录」。
- `DEFAULT_UPDATE_MEMORY_PROMPT`：四个操作 `ADD / UPDATE / DELETE / NONE`，含 4 组 old-memory→new-memory 的 JSON few-shot。
- 输出 schema（关键）：
  ```json
  {"memory": [{"id": "0", "text": "...", "event": "ADD|UPDATE|DELETE|NONE", "old_memory": "仅 UPDATE 需要"}]}
  ```
- `get_update_memory_messages()` 把 `retrieved_old_memory_dict` 和新 facts 三段式拼进 prompt，并强制「只返回 JSON」「空记忆时全 ADD」。

**检索**（2026 文档）：四个信号 —— Semantic / Keyword / Entity / Temporal，平台侧在服务端融合；**OSS 侧只有向量 + 可选 reranker + 实体重叠加成，没有 graph memory**（早期 OSS 的 Neo4j `graph_memory.py` 已归到平台能力）。

**评测**（arXiv:2504.19413 摘要，已核对）：LoCoMo 上 LLM-as-Judge 相对 OpenAI memory **+26%**；加图记忆再 **+2%**；p95 延迟 **-91%**，token **-90%+**。

---

## 3. Letta / MemGPT —— 「常驻层」和「渐进式披露」的最佳范本

先说事实：`letta-ai/letta` 主仓现在只剩文档指针（README 1.4KB），实际代码在 **`letta-ai/letta-code`**（npm `@letta-ai/letta-code`）。

**分层（MemFS，2026）**：记忆是 agent 自己的 **git 仓库**，投影到工作机的 `$MEMORY_DIR`：

```
$MEMORY_DIR/
├── MEMORY.md          ← 根索引：列出所有子目录（不进上下文的内容靠它导航）
├── persona.md         ← 常驻：我是谁
├── human.md           ← 常驻：用户是谁
├── reference/
│   ├── MEMORY.md      ← 子索引
│   └── project-notes.md
└── skills/
```

- **根目录文件每轮都进 system prompt**；**带自己 `MEMORY.md` 的子目录不进上下文**，agent 只看到文件树，需要时自己去读 → 这就是「标题索引 + 展开原文」的成品。
- 每个文件是 Markdown + YAML frontmatter：`name` / `description`（**description 就是索引摘要**）。
- 旧版机制的对应关系：core memory blocks（label/value，带字数上限、常驻）≈ 今天的根文件；recall memory ≈ 对话检索；archival memory ≈ 向量库（今天退化成了「可选的 memfs-search」）。
- 版本化：每次编辑 `git commit`，天然有 diff/回滚/冲突解决。

**写入时机**：agent 自己写（工具调用）；另有 **dreaming** 后台子代理（用 git worktree 并发），配置形如 `{trigger: "step-count"|"compaction-event"|"off", behavior: "reminder"|"auto-launch", stepCount: 25}`。

**检索**：默认**不用向量**，靠文件搜索/读取；关键词搜索零依赖，语义/混合搜索要装 `@letta-ai/memfs-search` + QMD；会话历史搜索是另一套（`letta messages search`）。

**启发**：它证明了「用文件系统当记忆」在工程上完全可行 —— 对我们的单 JSON 文件方案，等于把「文件」换成「记录 + parent_id」。

---

## 4. Zep / Graphiti —— 双时间轴 + 矛盾检测

**Schema（源码可查）**：

- `EpisodicNode`: `content, source, source_description, valid_at, created_at, entity_edges`
- `EntityNode`: `name, name_embedding, summary, labels, attributes, group_id`
- `EntityEdge`(=fact): `name, fact, fact_embedding, episodes[], valid_at, invalid_at, expired_at, attributes`
- `CommunityNode`: `name, summary, name_embedding`

**时间语义**：`valid_at/invalid_at` 是**世界时间**（事实何时为真），`created_at` 是**摄入时间**，`expired_at` 是失效那一刻 —— 典型 bi-temporal，检索时可以问「当时的真相」而不是「现在的真相」。

**矛盾消解**（`graphiti_core/prompts/dedupe_edges.py`，这段 prompt 值得逐句抄）：
- 输出两个数组：`duplicate_facts`（**只允许来自 EXISTING FACTS 的 idx**）、`contradicted_facts`（可来自 EXISTING + INVALIDATION CANDIDATES，两段 idx 连续编号）。
- 系统提示一句话立规矩：*"NEVER mark facts as contradicted unless the new fact explicitly makes the old fact false."*
- 反模式清单（很实用）：不得因「更新更近」推断矛盾；不得因「同一实体的新事件」推断矛盾；不得把「某人在项目上干活」当成对「某人负责该项目」的矛盾；数值/日期/限定词有差异不算重复。
- 三个判例：同句 → dup；头衔从 engineer→senior engineer → contradiction 非 dup；「周二跑5英里」vs「周三跑3英里」→ 都不是。

**检索参数（`search_config.py` + `search_utils.py`，已核对默认值）**：
- 每种对象（edge/node/episode/community）独立配置 method 组合：`cosine_similarity | bm25 | bfs`。
- reranker 可选：`rrf | node_distance | episode_mentions | mmr | cross_encoder`，默认 **RRF**。
- 默认值：`limit=10`、`min_score=0.6`、`mmr_lambda=0.5`、`bfs_max_depth=3`、`MAX_QUERY_LENGTH=128`、`RELEVANT_SCHEMA_LIMIT=10`。
- 混合检索实现：BM25 与 cosine **各取 2×limit**，去重后 `rrf()` 融合。

**落地成本**：需要图库（Neo4j/FalkorDB/Kuzu/Neptune，源码里有 `GraphProvider.KUZU` 分支，理论上可嵌入式单机），Python 栈。→ 对我们：**抄 schema 和 prompt，不抄实现**。

---

## 5. cognee —— 「会话蒸馏」和「全塞一个 Postgres」

- 对外四动词：`remember / recall / improve / forget`。
- 关键概念 **session distillation**：会话期的东西先落 session，之后把「被接受的 lessons」蒸馏成永久记忆（`improve` 负责 feedback 与 session→graph 桥接）。这正是「短期缓冲 → 长期固化」的显式建模。
- 抽取可**不用 LLM**：无 key 时用本地 GLiNER 抽实体 + 本地 embedding（v1.6.0 起）。
- 存储：图 + 向量 + 关系元数据三件套；1.0 后宣称「整个记忆层跑一个 Postgres」（README 同时标注图存储部分是 demo 特性）。
- 评测：BEAM，100K 上下文 **0.79**，10M 上下文 **0.67**（厂商自述，方法学差异需看 REPORT.md）。
- 论文：arXiv:2505.24478。

---

## 6. LangMem + LangGraph 的 checkpointer/store 分层

**LangGraph 两层（官方 docs 原文口径）**：

| | Checkpointer | Store |
|---|---|---|
| 存什么 | 图状态快照（每 super-step） | 应用自定义 KV |
| 作用域 | 单 thread（`thread_id`） | 跨 thread |
| 用途 | 对话连续性、HITL、time travel、容错 | 用户偏好、事实、共享知识 |

- 短期 = checkpointer（`SqliteSaver` 可本地落盘；文档明确提醒 checkpoint 会无限增长，要定期 prune）。
- 长期 = `BaseStore`，条目字段 `namespace / key / value / created_at / updated_at / score`；语义检索靠 `index={"dims":1536,"embed":"..."} `+ `asearch(namespace, query=..., limit=...)`。

**LangMem 的可抄点**：
- 极简 schema：`class Memory(BaseModel): content: str`（描述里要求写成 "standalone episode/fact/note/preference"）。
- `_MEMORY_INSTRUCTIONS` 三段式：① Extract & Contextualize（**不确定信息要带置信度 p(x)**）② Compare & Update（**合并压缩冗余、按可靠性与新近度增强、删错删重、最大化 SNR、避免空话**）③ Synthesize & Reason（演绎/归纳/溯因，给出概率化结论）。
- 补丁机制：`create_memory_manager(model, schemas=(Memory,), enable_inserts=True, enable_updates=True, enable_deletes=False)`＋`max_steps` 多轮＋`Done` 工具收尾；底层用 `trustcall.create_extractor` 做 JSON patch。
- 落库版 `MemoryStoreManager`：先用 query model 生成**并行多查询**（`query_limit=5`）召回旧记忆，按 score 截断，再连同新对话一起喂 manager；无 query model 时用 `get_dialated_windows` 按时间窗检索。还有 `phases` 可挂「只做 dedupe/consolidate」的第二阶段。
- 检索：`score` 排序 + 上限（`query_limit`）；无 reranker、无 BM25。

---

## 7. A-MEM —— 「索引条目字段」的参考答案

- 每条记忆是一张 Zettelkasten 笔记，字段：`content`、`tags`、`category`、`context`（LLM 生成的上下文描述）、`keywords`（LLM 抽取）、`timestamp`（`YYYYMMDDHHmm`）、links（近邻连边）。
- 写入：`add_note()` → LLM 生成 context/keywords/tags → ChromaDB 找近邻 → **memory evolution**：反过来修改近邻笔记的 context/tags 并连边。
- 检索：`search_agentic(query, k=5)`。
- 意义：它把「摘要式索引字段」和「原文」放在同一条记录里，并用链接做二跳扩展 —— 对单文件 JSON 结构化最友好。

---

## 8. TiMem —— 查不到

- GitHub 仓库搜索 `TiMem` 无对应项目（返回的是 TimeMixer / TimeMe.js 等无关仓库）。
- 唯一遇到的中文「Mem0 / Zep / LangMem / TiMem 横评」文章（juejin）无法核实其技术细节，且未给出仓库链接。
- **结论：不采信、不作为参考。** 如果它确实存在，本次未能定位到源码或论文，属查不到。

---

## 9. 四个工程问题的直接回答

### A. 「常驻人设/习惯」vs「按需检索的事实」怎么分工

业界的做法（三种流派）：

1. **文件常驻 + 目录索引**（Letta MemFS）：根目录 `persona.md` / `human.md` 恒定进 system prompt，子目录靠 `MEMORY.md` 索引导航。防膨胀靠**分层**而不是靠裁剪。
2. **小 schema 原地 patch**（LangMem）：常驻层就是一个 `Profile` 对象，每次写入是「读旧值 → 生成新值 → 覆盖」，`enable_deletes=False` 防止模型乱删。
3. **additive + 显式纠正**（mem0）：常驻层不放东西，全部按需检索；写入只增不改，纠正靠 API。

**可落地的分工（建议）**：
- 常驻层（`profile`）：身份/称呼、稳定偏好、关系、禁忌、沟通风格、当前长期目标。**硬上限 1500–2000 字（≈ 2–3% 上下文）**，按 slot 分节，每节再各自限长（如 8 条 × 40 字）。
- 溢出策略：slot 满了 → 旧条目降级为 fact（带 `source` 指回 profile），profile 只留「最高频/最重要」。这就是 Letta 的「根文件 vs 子目录」在单文件 JSON 里的等价物。
- 写入：**必须 patch 不能 append**（LangMem 证据）；每次 patch 输出 `{slot, op, new_text, reason}`，便于审计。
- 防膨胀的三道闸：① 字数上限硬截断 ② 每次写入时让模型自己合并同类项（`_MEMORY_INSTRUCTIONS` 的 "consolidate and compress redundant memories"）③ 定期 compaction（对应 Letta dreaming 的 `stepCount: 25`，即每 25 步整理一次）。

### B. 「标题索引 + 展开原文」有没有成熟实现

**有，Letta MemFS 是最完整的**：

- 索引 = 目录结构 + 每个文件的 `MEMORY.md` 清单；
- 索引条目 = YAML frontmatter 的 `name` + `description`（一句话）；
- 展开 = agent 自己 `read` 文件；
- 代价 = 需要 agent 有工具调用能力（我们若无 tool loop，就把「展开」做成一次额外的检索调用）。

**索引条目应有的字段**（综合 Letta frontmatter + A-MEM note + Graphiti node）：

```ts
type MemIndexEntry = {
  id: string;            // uuid
  title: string;         // ≤ 20 字，模型生成
  summary: string;       // ≤ 80 字，模型生成（= Letta description）
  type: "profile" | "fact" | "event" | "procedure" | "preference";
  entities: string[];    // 人名/项目/地点（= mem0 entity / graphiti Entity）
  keywords: string[];    // = A-MEM keywords，用于 BM25
  valid_at?: string;     // 世界时间（已发生/生效）
  invalid_at?: string;   // 失效时间（Graphiti 双时间）
  importance: 1..10;     // 无衰减时的替代排序依据
  tokens: number;        // 预算控制用
  updated_at: string;
  access_count: number;  // 后续接衰减/淘汰
  source_refs: string[]; // 指向原始会话 message id，用于"展开原文"
};
```
注入时只放 `title + summary + entities`（≈ 30–60 token/条），命中后再取 `body`。

### C. 有没有可直接用的衰减默认参数

**先给结论：这 7 个项目里没有一个在 OSS 代码里实现「数值衰减」，它们用三种离散机制替代**：

| 机制 | 出处 | 参数 |
|---|---|---|
| 矛盾即失效 | Graphiti `invalid_at`/`expired_at` | 无阈值，靠 LLM 判定 |
| 容量/召回上限 | Graphiti `limit=10`；LangMem `query_limit=5`；A-MEM `k=5`；Graphiti `min_score=0.6` | 可直接抄 |
| 压缩合并 | Letta dreaming `stepCount=25`；LangMem `phases` | 可直接抄 |
| 去重 | mem0 `hash` 内容哈希；Graphiti duplicate_facts | 精确/语义两档 |

**如果要真做衰减**，业界最常引用的是 Generative Agents（Park et al., 2023）的线性加权 + 指数 recency：

```
score = α_rec · recency + α_imp · importance + α_rel · relevance
recency = 0.995 ^ hours_since_last_access      # 每 24h 约 ×0.886，30 天约 ×0.026
importance ∈ [0, 10]（LLM 打分，1=琐碎，10=人生大事）
α 三者相等（论文取 1/3 归一化后相加）
```
> 注意：这条公式出自该论文，**本次未逐字核对原文**，属公认做法而非本次源码核对结果。

**给单机系统的建议默认值**（工程折中，非来自某个项目）：
```
importance: 1–10，profile 类固定 9，闲聊 2
half_life: fact 90 天 / event 30 天 / procedure 不衰减
retention = importance/10 * 0.5^(age_days/90) * (1 + 0.1*log(1+access_count))
淘汰：retention < 0.15 且 access_count == 0 且 age_days > 180 → 移到 archive（不删除）
硬上限：total facts ≤ 5000，超了按 retention 升序 archive
```

### D. 单进程本地部署（无 Redis/Neo4j/云）

| 项目 | 能否直接跑 | 说明 |
|---|---|---|
| **mem0** | ✅ | 向量库可选 in-memory/Chroma/Qdrant local，SQLite 存 history；只依赖 LLM+embedding API。**最省事** |
| **LangMem + LangGraph** | ✅ | `InMemoryStore` / `SqliteSaver`；`index={dims,embed}` 可接本地 embedding |
| **A-MEM** | ✅ | Chroma 本地 + `all-MiniLM-L6-v2` + Ollama 后端 |
| **cognee** | ⚠️ | 可无 LLM key（GLiNER 本地），但图/向量/关系三库依赖重；1.0 后可全塞一个 Postgres（demo 级） |
| **Graphiti** | ⚠️ | 有 Kuzu 嵌入式分支，但代码里大量 Cypher/Apache AGE 假设，Python 栈；单机勉强 |
| **Letta** | ❌ | 要整套 agent runtime（Node 22 / CLI / App Server），记忆只是它的一个子系统 |
| **TiMem** | — | 不存在/查不到 |

→ **可以直接跑并当参照实现的：mem0、LangMem、A-MEM**；**只抄设计的：Letta（分层+索引）、Graphiti（双时间+矛盾检测）**。

---

## 10. 可抄清单（按 A/B/C/D）

### A. 常驻人设 / 按需事实 的分工

1. **根文件常驻 + 子目录延迟加载** —— 出自 Letta MemFS 文档：`https://docs.letta.com/concepts/memfs/index.md`（原文："Files at the memory root are loaded into the agent's system prompt on every turn." / "Directories with their own MEMORY.md index stay out of context until they are needed."）
   → 抄法：JSON 里 `profile` 树顶层恒注入，`facts` 只注入索引条目。
2. **补丁式更新，禁 delete** —— 出自 LangMem `create_memory_manager(..., enable_deletes=False)` 与 `_MEMORY_INSTRUCTIONS` 的 "Consolidate and compress redundant memories... Remove incorrect or redundant memories"：`https://github.com/langchain-ai/langmem/blob/main/src/langmem/knowledge/extraction.py`
3. **additive 写入 + 显式纠正** —— 出自 mem0 官方文档 "The automatic extraction path is additive."：`https://docs.mem0.ai/core-concepts/how-it-works.md`
4. **带置信度的不确定信息** —— LangMem `_MEMORY_INSTRUCTIONS` 第 1 条 "Caveat uncertain or suppositional information with confidence levels (p(x))"（同上 URL）→ 我们的 `fact` 加 `confidence: 0..1`。

### B. 标题索引 + 展开原文

5. **`MEMORY.md` 式索引 + frontmatter `name/description`** —— Letta MemFS 文档（同 A-1）。索引条目字段直接照 §B 的 `MemIndexEntry`。
6. **笔记自带 context/keywords/tags** —— A-MEM README：`memory.context / memory.keywords / memory.tags`，`https://github.com/agiresearch/A-mem`（MIT，可放心抄字段设计）。
7. **社区/主题摘要层** —— Graphiti `CommunityNode.summary`（`graphiti_core/nodes.py`）→ 我们可加一层「每 20 条 fact 聚一个 topic summary」，注入时先给 topic 再给条目。
8. **检索结果按 score 截断再注入** —— LangMem `MemoryStoreManager._sort_results(..., query_limit)`；Graphiti `limit=10`。

### C. 遗忘 / 衰减默认参数

9. **矛盾即失效，而非打分衰减** —— Graphiti `dedupe_edges.resolve_edge`：`https://github.com/getzep/graphiti/blob/main/graphiti_core/prompts/dedupe_edges.py`。三条禁令 + 三个判例可直接进我们的 prompt。
10. **双时间字段** —— `valid_at / invalid_at / created_at / expired_at`（Graphiti `EntityEdge`）→ JSON 里给每条 fact 加 `validAt / invalidAt / createdAt`。
11. **硬容量参数** —— `limit=10`、`min_score=0.6`、`mmr_lambda=0.5`、`bfs_max_depth=3`（`graphiti_core/search/search_utils.py`）；`query_limit=5`（LangMem）。
12. **周期性压缩** —— Letta dreaming `stepCount: 25`（每 25 步）/ `trigger: "compaction-event"`：`https://docs.letta.com/agent-sdk/memory/index.md`。
13. **衰减公式**（业界通用，需自行验证）：Generative Agents `0.995^hours` + importance 1–10 加权。

### D. 单进程可直接跑

14. **mem0 作为行为基准**：跑一遍 `add/search` 记录它的 ADD/UPDATE/DELETE 判定，用来对齐我们的抽取 prompt。
15. **LangGraph Store 的 namespace 设计**：`("memories", "{user_id}")` —— 出自 langmem `create_memory_searcher(namespace=("memories","{langgraph_user_id}"))`，等于我们 JSON 里的 `scopes[userId]`。
16. **A-MEM 本地栈**：Chroma + MiniLM + Ollama，验证「笔记 + 链接」在小规模下的召回质量。

---

## 11. 明确没查到的（不编造）

- **star 数**：未取（API 限流风险 + 与本任务无关）。
- **Letta 的具体 memory block 字数上限**：当前 docs 已改用 MemFS 文件模型，未找到 `limit` 字段的现行文档；旧版 MemGPT 的 core memory 字符限额未核对。
- **Graphiti 的 RRF 常数 k**：`rrf()` 实现位于 `search_utils.py` 被截断的后半段，未取到具体常数。
- **Zep 论文分数**（DMR 94.8% / LongMemEval +18.5%）：仅见转述，未核对 arXiv:2501.13956 原文，故不引用。
- **TiMem**：无仓库、无论文可核实。
