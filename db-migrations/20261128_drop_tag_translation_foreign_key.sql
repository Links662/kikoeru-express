PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE t_tag_translation_new (
  id INTEGER NOT NULL,
  locale TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (id, locale)
);

INSERT INTO t_tag_translation_new (id, locale, name)
SELECT id, locale, name
FROM t_tag_translation;

DROP TABLE t_tag_translation;
ALTER TABLE t_tag_translation_new RENAME TO t_tag_translation;

COMMIT;

PRAGMA foreign_keys = ON;
