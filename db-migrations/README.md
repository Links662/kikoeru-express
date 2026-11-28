# 数据库迁移说明

本目录位于 `kikoeru-express` 项目内，用于保存数据库结构迁移脚本、版本记录和操作说明。

# 数据库版本变更记录

## 20261128 - 声优 ID 改为自增整数

迁移文件：`20261128_integerize_va_ids.sql`

执行前提：数据库已执行完 `20261125` 系列迁移。

### 结构变更

- `t_va.id` 从 UUID 字符串改为 `INTEGER PRIMARY KEY AUTOINCREMENT`。
- `t_va.name` 增加唯一约束；完全相同的名称复用同一个自增 ID。
- `r_va_work.va_id` 改为整数外键。
- `t_favourite` 中 `field='va'` 的 `item_id` 同步改为新整数 ID 的字符串形式。
- 已有声优名称先按采集规则清洗，并合并清洗后同名的旧记录。
- 新数据库基线的 `dbVersion` 更新为 `20261128`。

### 行为变化

- 抓取器只返回声优名称，不再自行生成 UUID。
- 声优名称会删除成对括号及其内容，并移除名称中的所有空白字符。
- 数据库按精确名称查找声优；不存在时创建自增 ID。
- 旧 UUID 形式的收藏链接和 `vaIds` 查询参数不再兼容。
- 完全相同名称的旧记录会合并为一个声优，相关作品和收藏会去重。

### 手动迁移步骤

1. 停止 Kikoeru 服务并备份 `sqlite/db.sqlite3`。
2. 对数据库执行 `20261128_integerize_va_ids.sql`。
3. 启动服务并确认声优列表、作品详情、收藏和筛选正常。

### 验证

- 执行 `PRAGMA foreign_key_check;`，结果应为空。
- 确认 `t_va.id` 和 `r_va_work.va_id` 均为整数。
- 确认 `staticMetadata.vaObj` 中声优 ID 已为新整数。
- 确认 `t_favourite` 中声优收藏已完成映射。

## 20261125 - 运行时配置迁移到 SQLite

迁移文件：`20261125_split_runtime_config_to_sqlite.sql`

执行前提：数据库已执行完 `20261018` 系列迁移。

### 结构变更

- 新增 `t_app_setting(key, value, updated_at)`，以 JSON 文本保存运行时配置。
- 新增 `t_root_folder`，保存根目录名称、绝对路径和扫描深度。
- 新数据库基线同步包含以上两张表，`dbVersion` 更新为 `20261125`。

### 手动迁移步骤

1. 停止 Kikoeru 服务并备份 `sqlite/db.sqlite3` 与 `config/config.json`。
2. 对数据库执行 `20261125_split_runtime_config_to_sqlite.sql`。
3. 使用仓库根目录的 `config.example.json` 替换 `config/config.json`，保留原 JWT 密钥并修改为实际部署路径。
4. 在 `t_root_folder` 中准备根目录记录，然后执行 `20261125_add_work_root_folder_id.sql`。
5. 启动服务并检查运行时设置，确认 `t_app_setting` 内容符合预期。

`t_root_folder` 不包含自动导入逻辑，因为迁移脚本无法读取旧 JSON 配置中的路径。

### 验证

- 执行 `PRAGMA foreign_key_check;`，结果应为空。
- 确认 `t_app_setting` 和 `t_root_folder` 存在。

## 20261125 - 移除根目录 position

迁移文件：`20261125_drop_root_folder_position.sql`

执行前提：数据库中的 `t_root_folder` 仍包含旧 `position` 字段。

### 结构变更

- 重建 `t_root_folder`，移除 `position`。
- 保留根目录 `id`、名称、路径和扫描深度。
- 根目录加载顺序统一按 `id ASC`，不再提供持久化排序功能。

如果数据库是使用更新后的 `20261125_split_runtime_config_to_sqlite.sql` 新建的，则不会创建 `position`，不需要执行此脚本。

## 20261125 - 作品根目录稳定 ID

迁移文件：`20261125_add_work_root_folder_id.sql`

执行前提：先执行 `20261125_split_runtime_config_to_sqlite.sql`。

### 结构变更

- `t_work.root_folder_id` 成为唯一根目录关联字段，外键指向 `t_root_folder(id)`。
- `t_work.root_folder` 名称字段会被删除。
- 外键规则为 `ON UPDATE CASCADE ON DELETE RESTRICT`。
- 新增 `idx_t_work_root_folder_id` 索引。
- 迁移时按旧 `root_folder` 名称匹配 `t_root_folder`，无法匹配时整次迁移失败。

### 行为变化

- 新建作品只保存稳定的 `root_folder_id`。
- 根目录别名或路径变化时，媒体、封面和扫描逻辑只使用 `root_folder_id` 定位，不存在名称回退。
- 仍被作品引用的根目录不能删除。

### 验证

- 执行 `PRAGMA foreign_key_check;`，结果应为空。
- 检查 `t_work` 是否存在 `root_folder_id` 和 `idx_t_work_root_folder_id`。
- 执行根目录 ID 迁移前必须准备好 `t_root_folder`，否则迁移因 `root_folder_id` 非空约束失败。

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
