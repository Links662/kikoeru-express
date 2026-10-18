# 数据库迁移说明

本目录位于 `kikoeru-express` 项目内，用于保存数据库结构迁移脚本、版本记录和操作说明。

# 数据库版本变更记录

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
