PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE t_tag_translation (
  id INTEGER NOT NULL,
  locale TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (id, locale),
  FOREIGN KEY (id) REFERENCES t_tag (id) ON UPDATE CASCADE ON DELETE CASCADE
);

INSERT OR IGNORE INTO t_app_setting (key, value)
VALUES ('tagLanguage', '"zh-cn"');

UPDATE t_app_setting
SET value = CASE value
  WHEN '"ja-JP"' THEN '"ja-jp"'
  WHEN '"zh-CN"' THEN '"zh-cn"'
  WHEN '"zh-TW"' THEN '"zh-tw"'
  ELSE value
END
WHERE key = 'tagLanguage';

COMMIT;

PRAGMA foreign_keys = ON;
