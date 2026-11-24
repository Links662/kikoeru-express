# 数据库迁移说明

本目录位于 `kikoeru-express` 项目内，用于保存数据库结构迁移脚本、版本记录和操作说明。

# 数据库版本变更记录

## 20261125 - 运行时配置迁移到 SQLite

迁移文件：`20261125_split_runtime_config_to_sqlite.sql`

执行前提：数据库已执行完 `20261018` 系列迁移。

### 结构变更

- 新增 `t_app_setting(key, value, updated_at)`，以 JSON 文本保存运行时配置。
- 新增 `t_root_folder`，保存根目录名称、绝对路径、扫描深度和显示顺序。
- 新数据库基线同步包含以上两张表，`dbVersion` 更新为 `20261125`。

### 手动迁移步骤

1. 停止 Kikoeru 服务并备份 `sqlite/db.sqlite3` 与 `config/config.json`。
2. 对数据库执行 `20261125_split_runtime_config_to_sqlite.sql`。
3. 使用仓库根目录的 `config.example.json` 替换 `config/config.json`，保留原 JWT 密钥并修改为实际部署路径。
4. 启动服务后，在“存储管理”中重新添加原根目录。
5. 检查运行时设置后再保存一次，确认 `t_app_setting` 内容符合预期。

`t_root_folder` 不包含自动导入逻辑，因为迁移脚本无法读取旧 JSON 配置中的路径。

### 验证

- 执行 `PRAGMA foreign_key_check;`，结果应为空。
- 确认 `t_app_setting` 和 `t_root_folder` 存在。
- 启动服务时如果提示缺少运行时配置表，说明 SQL 脚本尚未执行。

## 20261018 - 年龄分级不允许为空

迁移文件：`20261018_make_t_work_nsfw_not_null.sql`

执行前提：先执行 `20261018_add_work_subtitle.sql` 和
`20261018_replace_circle_obj_with_circle_name.sql`。

### 结构变更

- `t_work.nsfw` 改为 `INTEGER NOT NULL DEFAULT 1`。
- 重建 `t_work` 时保留原有主键、外键和 `t_work_index`。
- 同步重建 `staticMetadata` 视图，保留 `circle_name` 和 `subtitle` 字段。

### 数据清理

- 现有 `nsfw IS NULL` 的记录按 R18 回填为 `1`。

## 20261018 - 作品字幕状态

迁移文件：`20261018_add_work_subtitle.sql`

### 结构变更

- `t_work` 新增 `subtitle INTEGER NOT NULL DEFAULT 0`。
- `staticMetadata` 视图增加 `w.subtitle`。

### 数据清理

- 删除 `r_tag_work` 中 `tag_id=-1` 的旧关联。
- 删除 `t_tag` 中 `id=-1` 的“中文字幕”伪标签。
- 不迁移、不回填旧伪标签对应的字幕状态。

## 20261018 - 简化 staticMetadata 社团字段

迁移文件：`20261018_replace_circle_obj_with_circle_name.sql`

执行前提：先执行 `20261018_add_work_subtitle.sql`。

### 结构变更

- `staticMetadata` 视图移除 `circleObj` JSON 聚合列。
- 使用 `circle_name` 提供社团名称，`circle_id` 继续提供社团 ID。
- API 归一化仍输出 `metadata.circle = { id, name }`，接口结构不变。
