BEGIN;

CREATE TABLE IF NOT EXISTS t_app_setting (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS t_root_folder (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL UNIQUE,
  max_recursion_depth INTEGER NOT NULL DEFAULT 2
);

INSERT OR IGNORE INTO t_app_setting (key, value) VALUES
  ('maxParallelism', '16'),
  ('pageSize', '12'),
  ('listPageSize', '50'),
  ('recentCount', '20'),
  ('rewindSeekTime', '5'),
  ('forwardSeekTime', '30'),
  ('expiresIn', '2592000'),
  ('tagLanguage', '"zh-cn"'),
  ('retry', '5'),
  ('dlsiteTimeout', '10000'),
  ('hvdbTimeout', '10000'),
  ('retryDelay', '2000'),
  ('httpProxyHost', '""'),
  ('httpProxyPort', '0'),
  ('skipCleanup', 'false'),
  ('coverUpgradeIntervalDays', '7'),
  ('coverUpgradeTypes', '["sam"]');

-- 清理已经移除的运行时配置记录。
DELETE FROM t_app_setting
WHERE key IN (
  'checkUpdate',
  'checkBetaUpdate',
  'scannerMaxRecursionDepth',
  'offloadMedia',
  'offloadStreamPath',
  'offloadDownloadPath',
  'httpsEnabled',
  'httpsPrivateKey',
  'httpsCert',
  'httpsPort'
);

-- 根目录不能从旧 config.json 自动读取，请在迁移后通过“存储管理”重新添加；
-- 也可以手动执行类似下面的语句（请替换为实际名称、绝对路径和扫描深度）：
-- INSERT INTO t_root_folder (name, path, max_recursion_depth)
-- VALUES ('media', '/path/to/VoiceWork', 2);

COMMIT;
