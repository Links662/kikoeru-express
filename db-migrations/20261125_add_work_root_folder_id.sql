-- 执行前提：先执行 20261125_split_runtime_config_to_sqlite.sql，
-- 并自行在 t_root_folder 中准备好根目录记录。
-- 本脚本移除旧 t_work.root_folder；路径名称无法匹配根目录时会迁移失败。

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

DROP VIEW IF EXISTS staticMetadata;

CREATE TABLE t_work_new (
  id integer NOT NULL PRIMARY KEY AUTOINCREMENT,
  root_folder_id integer NOT NULL,
  dir varchar(255) NOT NULL,
  title varchar(255) NOT NULL,
  circle_id integer NOT NULL,
  nsfw boolean NOT NULL DEFAULT 1,
  subtitle boolean NOT NULL DEFAULT 0,
  release varchar(255),
  dl_count integer,
  price integer,
  review_count integer,
  rate_count integer,
  rate_average_2dp float,
  rate_count_detail text,
  rank text,
  insert_time datetime DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (circle_id) REFERENCES t_circle (id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (root_folder_id) REFERENCES t_root_folder (id) ON UPDATE CASCADE ON DELETE RESTRICT
);

INSERT INTO t_work_new (
  id,
  root_folder_id,
  dir,
  title,
  circle_id,
  nsfw,
  subtitle,
  release,
  dl_count,
  price,
  review_count,
  rate_count,
  rate_average_2dp,
  rate_count_detail,
  rank,
  insert_time
)
SELECT
  w.id,
  (
    SELECT root.id
    FROM t_root_folder AS root
    WHERE root.name = w.root_folder
  ),
  w.dir,
  w.title,
  w.circle_id,
  w.nsfw,
  w.subtitle,
  w.release,
  w.dl_count,
  w.price,
  w.review_count,
  w.rate_count,
  w.rate_average_2dp,
  w.rate_count_detail,
  w.rank,
  w.insert_time
FROM t_work AS w;

DROP TABLE t_work;

ALTER TABLE t_work_new RENAME TO t_work;

CREATE INDEX t_work_index ON t_work (circle_id, release);
CREATE INDEX idx_t_work_root_folder_id ON t_work (root_folder_id);

CREATE VIEW staticMetadata AS
SELECT
  w.id,
  w.title,
  w.circle_id,
  c.name AS circle_name,
  w.nsfw,
  w.subtitle,
  w.release,
  w.dl_count,
  w.price,
  w.review_count,
  w.rate_count,
  w.rate_average_2dp,
  w.rate_count_detail,
  w.rank,
  w.insert_time,
  (
    SELECT json_object('vas', json_group_array(json_object('id', v.id, 'name', v.name)))
    FROM r_va_work rv
    JOIN t_va v ON v.id = rv.va_id
    WHERE rv.work_id = w.id
  ) AS vaObj,
  (
    SELECT json_object('tags', json_group_array(json_object('id', t.id, 'name', t.name)))
    FROM r_tag_work rt
    JOIN t_tag t ON t.id = rt.tag_id
    WHERE rt.work_id = w.id
  ) AS tagObj
FROM t_work AS w
JOIN t_circle AS c ON c.id = w.circle_id;

COMMIT;

PRAGMA foreign_keys = ON;
