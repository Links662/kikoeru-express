# kikoeru-express Agent Guide

## 适用范围

本文件约束 `kikoeru-express` 仓库。开始修改前先阅读工作区根目录的 `AGENTS.md`；本文件补充后端实现细节，冲突时以更具体、更新的约束为准。

## 项目定位

- Node.js >= 22，CommonJS 项目。
- Express 5 API 服务，使用 SQLite + Knex 保存作品、用户、评论、收藏和播放历史。
- 同时托管前端构建产物 `dist/`（存在时），并为管理员扫描页面提供 Socket.IO 通道。
- 扫描和抓取在子进程中执行，Web 进程通过 IPC 汇总进度。

## 常用命令

```powershell
npm ci
npm run dev
npm start
npm test
```

- `npm run dev`：nodemon 启动，忽略 `config/` 和 `sqlite/`，默认监听 `8888`。
- `npm start`：普通启动。
- `npm test`：先执行 ESLint，再以 `NODE_ENV=test` 运行 Mocha。
- 单个测试文件：`npx cross-env NODE_ENV=test mocha test/subtitles.js`。
- `npm run scan` 仍指向 `filesystem/scanWorker.js`，但扫描入口不应继续扩展为带参数的外部 CLI；字幕重扫只能从管理员扫描页面触发。

## 目录职责

| 路径 | 职责 |
| --- | --- |
| `app.js` | HTTP/HTTPS、静态前端、全局错误处理、Socket 初始化 |
| `api.js` | `/api` JWT 中间件、账户状态复核 |
| `socket.js` | 管理员 Socket.IO 鉴权、扫描指令和事件广播 |
| `config.js` | 默认配置、`config/config.json` 读写、公开配置 |
| `routes/` | HTTP 路由、参数校验、响应格式 |
| `database/db.js` | 所有 Knex 查询、事务和 API 数据整理 |
| `database/schema.js` | 新数据库基线表结构和 `staticMetadata` 视图 |
| `db-migrations/` | 现有数据库需要手动执行的 SQL 升级脚本 |
| `filesystem/` | 文件列表、封面资源、扫描子进程 |
| `state/scannerState.js` | 扫描子进程生命周期和进度的唯一状态源 |
| `scraper/` | DLsite/HVDB 抓取和重试 |
| `test/` | Mocha 测试 |

## 运行时链路

1. `app.js` 加载 `config.js`，挂载 JSON/urlencoded 解析、可选 gzip、历史回退、API 和 `dist/`。
2. 除 `GET /api/health` 和 `POST /api/auth/me` 外，启用认证时的 `/api` 请求都要求 HS256 JWT。
3. JWT 通过后，`verifyUserState` 每次回库检查账户是否仍存在、是否被禁用，并用数据库中的用户名和用户组覆盖 token 内容。
4. 管理员扫描页面通过 Socket.IO 发送 `PERFORM_SCAN`、`PERFORM_UPDATE`、`PERFORM_SUBTITLE_SCAN`、`PERFORM_COVER_REPAIR`、`KILL_SCAN_PROCESS`。
5. `state/scannerState.js` 只允许一个子进程运行，保存进度快照，并向所有 Socket 客户端广播事件。
6. `GET /api/scanner/state` 仅作为 Socket 不可用时的管理员轮询兜底。

## 数据库与迁移（强制）

- 数据库文件默认在 `sqlite/db.sqlite3`；表结构基线在 `database/schema.js`，当前 `dbVersion` 为 `20261018`。
- 修改数据库结构、字幕存储或字幕扫描行为前，必须阅读：
  1. `db-migrations/README.md`
  2. 相关 SQL 文件
  3. 工作区根说明提到的 `CHANGELOG.md`（目前版本变更记录实际写在 `db-migrations/README.md` 中；若以后新增该文件，必须一并阅读和维护）
- 现有数据库通过手动执行 `db-migrations/*.sql` 升级。不要新增启动时自动识别旧库并迁移的逻辑，也不要重新启用 `app.js` 中被注释掉的 `initApp()` 自动升级路径。
- 新增结构变更时同时处理：
  - `database/schema.js` 的新库基线；
  - `db-migrations/` 中针对旧库的 SQL；
  - `db-migrations/README.md` 的版本记录与执行顺序；
  - 必要的迁移测试。
- `t_work.nsfw` 是 `NOT NULL DEFAULT 1`。无法确定年龄分级时按 R18 处理。
- `staticMetadata` 是 API 主要读取的视图。修改 `t_work`、`t_circle`、标签或声优关系后，必须重建该视图，并保持 `circle_name`、`subtitle`、`tagObj`、`vaObj` 等字段契约。
- 播放历史是 `(work_id, user_name)` 一条记录，`file_index` 表示最后播放的曲目；评论主键是 `(user_name, work_id)`；标签收藏等使用 `t_favourite`。

## 字幕规则（强制）

- 持久字段是 `t_work.subtitle`，API 字段是 `metadata.subtitle`，对前端输出布尔值。
- “有字幕”的定义是作品目录中存在任意 `.lrc` 文件，扩展名判断不区分大小写。
- `.srt`、`.ass` 可以作为文本文件播放，但不算字幕状态。
- 字幕重扫只由管理员扫描页面触发，通过 `PERFORM_SUBTITLE_SCAN` 进入 `subtitleScanWorker.js`。
- 不要新增外部字幕扫描 CLI、公开 API、定时任务或独立调度器。
- `filesystem/utils.js` 的 `hasLrc()` 是判定入口；`filesystem/scannerModules.js` 的 `performSubtitleScan()` 负责回写数据库。

## 扫描子系统

- `SCANNER_ENTRY` 将 `scan`、`update`、`subtitles`、`covers` 映射到对应 worker。
- worker 通过 `process.send()` 上报 `SCAN_TASKS`、`SCAN_FAILED_TASKS`、`SCAN_MAIN_LOGS`、`SCAN_RESULTS`、`SCAN_FINISHED` 等事件。
- `updateWorker.js`、`subtitleScanWorker.js`、`coverScanWorker.js` 必须由服务端 fork；没有 IPC 时会主动退出。
- 不要把扫描进程状态分散到路由、Socket 或组件中。新增扫描类型时修改 `SCANNER_ENTRY`，继续复用 `scannerState.startScan()`。
- 单个作品失败不能中断整场扫描；沿用现有计数、失败任务和日志汇总方式。
- 封面写入使用 `.part` 临时文件、JPEG 头校验和原子重命名。不要直接覆盖正式封面。

## API 与数据约定

- 路由层保持薄，数据访问和事务放在 `database/db.js`。
- 列表统一返回 `{ works, pagination: { currentPage, pageSize, totalCount } }`。
- `staticMetadata` 行在输出前经过 `routes/utils/normalize.js`：
  - `nsfw`、`subtitle` 转布尔；
  - `circle_id`/`circle_name` 转为 `circle: { id, name }`；
  - 解析 `rate_count_detail`、`rank`、`tagObj`、`vaObj`；
  - 删除内部 JSON 字段。
- 前端依赖 `id`、`title`、`circle`、`tags`、`vas`、`nsfw`、`subtitle` 等字段；修改响应结构时同步检查 `kikoeru-quasar`。
- 作品 URL 和封面路径使用 `formatRJLabel()`。6 位旧编号补足 6 位，数值达到 `1,000,000` 后使用 8 位。
- 曲目 `hash` 格式为 `${workId}/${index}`，媒体流、下载、LRC 检查和播放历史都依赖它。
- 浏览器 `<audio>`、`<img>` 和下载链接通过查询参数携带 `?token=`，不要假设这些请求能带 Authorization 头。

## 认证与安全

- 密码只接受 `$scrypt$...` 哈希；旧 MD5 哈希不再兼容，只能通过密码重置模式重新设置。
- JWT 使用 HS256、固定 issuer/audience，并通过数据库复核账户状态。不要删除逐请求复核。
- Socket 在启用认证时只允许 `administrator` 连接；token 可来自 `x-auth-token`、查询参数或 handshake auth。
- `jwtsecret` 不得通过管理配置接口返回或写入日志。
- 密码重置模式仅由 `KIKOERU_PASSWORD_RESET=1` 开启，只提供一次性重置页面，不挂业务 API，不初始化 Socket。不要把该模式变成长期接口。
- 管理员修改/删除/禁用账户后，继续使用 `state/userSockets.js` 主动断开对应 Socket。

## 配置与环境变量

- 默认配置在 `config.js`，运行配置在 `config/config.json`（gitignored）。首次导入 `config.js` 可能创建配置文件。
- `FREEZE_CONFIG_FILE` 阻止写回配置文件。
- `PORT` 覆盖监听端口；`IS_DOCKER` 改变默认媒体目录。
- `NODE_ENV=production` 或 `config.production=true` 会强制开启认证。
- `NODE_ENV=development` 会额外提供 `VoiceWork` 静态目录，仅用于开发。
- 修改监听方式、认证、数据库或封面路径等启动配置后需要重启服务。

## 编码约定

- 使用 CommonJS、2 空格缩进，不引入构建步骤或 TypeScript。
- 路由参数统一使用 `express-validator` 和 `routes/utils/validate.js` 的 `isValidRequest()`。
- Express 5 的 `path-to-regexp` 不支持旧式正则参数和可选参数；需要约束路径时使用通用参数加校验，参考 `routes/metadata.js` 的 `mapFieldParam`。
- 数据库查询使用参数绑定；不要在请求处理里拼接用户输入 SQL。
- 需要返回特定 HTTP 状态时使用 `database/db.js` 的 `httpError()` 或路由层明确状态码。
- 保持现有中文用户提示风格；日志中可以记录上下文，但不能记录密码、JWT 或重置令牌。

## 验证清单

- 修改后端逻辑后至少运行 `npm test`。
- 涉及封面、字幕、迁移、筛选、URL 拼接或作品 ID 时，运行对应 `test/*.js`。
- 扫描相关修改至少验证：单进程互斥、失败作品继续执行、进度事件、结束状态、终止进程和 Socket 断线后的快照查询。
- 涉及媒体路径时同时检查 Windows 反斜杠和多级子目录。
- 数据库变更必须验证迁移后的 `PRAGMA foreign_key_check`、视图字段和旧数据回填。

## 易踩坑

- `app.js` 里 `initApp()` 当前是注释状态；不要因为“服务能启动”就认为旧库会自动升级。
- `normalize()` 假定部分 JSON 字段可解析；新增可空字段时要处理 `null`，避免整个列表接口 500。
- 搜索关键词的 OR 条件必须整体分组，否则后续 `nsfw`/`subtitle` 过滤只作用于最后一个 OR 分支。
- 封面类型只允许 `main`、`sam`、`240x240`，并兼容旧的 `sam@2x`、`sam@3x`、`360x360` 请求；未知类型必须回退 `main`，不能参与路径拼接。
- 不要直接编辑 `node_modules/`、`VoiceWork/`、`sqlite/`、`covers/`、`config/config.json` 或运行产物 `dist/`。
