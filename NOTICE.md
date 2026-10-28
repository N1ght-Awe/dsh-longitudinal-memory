# NOTICE

本仓库是一个**下游补丁与设计文档**，不是上游项目的分支打包。

## 上游

- 项目：`dsh-workspace-recollection` 2.5.0
- 作者：reaxlll
- 许可：MIT（Copyright © 2026 reaxlll，全文见 [LICENSE](LICENSE)）
- 上游地址：<https://github.com/reaxlll/dsh-workspace-recollection>

本仓库 **不包含** 上游源码，也**不包含任何真实记忆数据**。`patch/p0-lifecycle.diff` 是相对上游的修改（diff 形式），
`tools/` 是本仓库新增的验证工具。补丁中的修改部分同样以 MIT 发布。

## 本仓库内容

- `docs/design.zh.md`、`docs/ai-memory-survey.zh.md`：设计与调研文档，MIT
- `patch/p0-lifecycle.diff`、`tools/*.mjs`：MIT

## 第三方引用

文档中引用了其他开源项目的设计（mem0、Letta/MemGPT、Zep/Graphiti、cognee、LangMem、A-MEM）与
`dsh-fish-memory` 的参数与提示词。均为设计参考，未复制其代码；各项目许可见其仓库。

## 脱敏说明

本仓库的文档经过脱敏：不含账号 ID、本机路径、人格名、个人偏好内容与任何会话原文。
文档中的统计数字（条数、字数）来自一次真实用例，仅用于说明问题规模。
