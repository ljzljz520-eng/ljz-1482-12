# ScriptEditor · 协同脚本拆场台（全栈）

多人在浏览器里协同拆分/合并视频脚本场次，在线编辑**旁白、台词、镜头及时长**，后端 API 持久化每次操作与修订证据，数据库以**稳定身份**维护场次节点、字幕锚点与素材区间。

## ✨ 解决的核心问题

- **拆/合场不是数组下标游戏**：场次、元素、字幕锚点、素材区间都持有不可变 `id`，顺序只由 `orderIdx` 决定。拆场时元素携带原 id 迁移，锚点/区间跟随身份或进入「待修复」，绝不级联删除或悬空。
- **协作不丢内容**：对比 OT、CRDT 后选定「版本化修订 + 显式三路合并」（理由见 [`docs/concurrency-choice.md`](docs/concurrency-choice.md)）。典型冲突「甲拆场、乙删除原场」必须显式裁决：恢复原场再拆 / 元素抢救为待归场 / 放弃并留痕。
- **撤销只反本人意图**：他人在你之后改过同一节点时撤销被硬阻止，不会把别人刚改的台词一并抹掉。
- **离线安全**：离线修改只进本地 `local-only` 队列；重连按 `opId` 幂等补提交。本地缓存**永不**被标记为云端已同步；保存失败的草稿有可见恢复横幅。
- **引用完整性服务端把关**：所有提交在 Serializable 事务内校验，非法 Payload 被 Zod 拒绝；Revision 表仅追加保存操作、触碰身份、操作前指纹与 rebase 轨迹（变更证据）。

## 🛠 技术栈

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + Zustand + react-hot-toast
- **Backend**: Node.js + Fastify + Zod（Pino 结构化日志）
- **Database**: PostgreSQL 16 + Prisma ORM（仅追加修订表 + 稳定身份实体表）
- **协作模型**: 版本化事件溯源（Revision）+ 服务端三路合并 + 显式冲突队列
- **容器**: docker compose 三服务（db / backend / frontend），数据卷持久化

## 🚀 启动指南（一键）

1. 确保 Docker Desktop（或 docker / compose 插件）已启动。
2. 在仓库根目录执行：

```bash
docker compose up --build
```

3. 等待数据库 migration（`prisma db push`）与 seed 自动完成。
4. 浏览器访问：

| 服务 | 地址 |
|---|---|
| 前端（Nginx） | http://localhost:3000 |
| 后端 API | http://localhost:3001/api |
| 健康检查 | http://localhost:3001/api/health |
| PostgreSQL | localhost:5432（user: `script` / pass: `script_pwd` / db: `scriptdb`） |

启动后自带演示脚本《云溪公园 · 秋日宣传片》：4 场次 / 11 个旁白·台词·镜头节点 / 4 个字幕锚点 / 4 段素材区间。

## 🧪 验收怎么走（建议双人/双标签演练）

右上角可在 **甲 / 乙 / 丙** 三个身份间切换（也可以开两个浏览器窗口，分别选甲和乙）。

1. **并发调时长**：甲乙几乎同时把同一镜头时长改成不同值 → 后提交者收到字段冲突卡，可"采用我的/保留云端/手填合并值"；改的是不同元素则自动 rebase，修订卡显示 `rebase r1→[2]`。
2. **断线重复提交**：DevTools → Network 切 Offline，改两句旁白（出现"本地待同步队列"），再切回 Online → 自动补提交；重复点击不会产生两条修订（`opId` 幂等，接口返回 `duplicate`）。
3. **甲拆场 / 乙删原场**：乙删除第一场（节点进入待归场），同时甲基于旧修订勾选节点拆场 → 右侧「待修复」出现结构冲突，三个显式选项任选，每种都不丢内容。
4. **节点迁移后旧响应晚到**：拆场后若旧版本 GET 晚回来，前端按请求代际（generation）与单调 `revision` 直接丢弃；左侧合计与右侧预览卡始终来自**同一 revision 快照**。
5. **撤销边界**：修订列表里只能看到"撤销我的这一步"；乙的操作对甲显示"他人操作不可撤销"；甲改完台词乙又改过，甲的撤销按钮变 🔒，悬浮可见阻断原因。
6. **草稿恢复**：离线编辑后刷新页面，顶部出现"本地未同步草稿"横幅，可作为新修改提交或丢弃——状态始终标注 `local-only`。

## 📁 目录结构

```
backend/
  prisma/schema.prisma     # 稳定身份模型 + Revision 证据表 + MergeConflict + Draft
  src/domain/              # 纯函数协作引擎：apply / commit(rebase) / 指纹 / undo 校验
  src/services/            # 事务提交、快照装载持久化、撤销、冲突裁决
  src/routes/              # Fastify 路由 + Zod 校验
  test/                    # 16 个引擎用例 + 10 个 HTTP 端到端用例（内存 DB）
frontend/
  src/store/editorStore.ts # 队列、乐观更新、generation 防晚到、冲突/草稿
  src/components/editor    # 场次卡、元素行、统计、队列、草稿横幅
  src/components/panels    # 预览卡（同一 revision）/ 待修复 / 修订证据链
docs/concurrency-choice.md # OT vs CRDT vs 显式合并的选型与支持边界
```

## 🔍 本地开发（无 Docker 时）

- 引擎单测与 HTTP 端到端测试用**内存 Prisma 替身**，无需数据库：

```bash
cd backend
npm install
npm run test:all   # 26 个用例
```

- 连真实 PostgreSQL 开发：复制 `backend/.env.example` 为 `.env`，填好 `DATABASE_URL`，`npm run prisma:push && npm run seed && npm run dev`。
- 前端：`cd frontend && npm install && npm run dev`（Vite 已把 `/api` 代理到 `localhost:3001`）。

## 🔐 身份说明

演示用 `x-user-id` 请求头在甲/乙/丙之间切换（无密码，便于验收）。生产应替换为会话/JWT；协作引擎本身不依赖鉴权形式。
