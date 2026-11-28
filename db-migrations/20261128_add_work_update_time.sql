BEGIN;

ALTER TABLE t_work ADD COLUMN update_time TIMESTAMP;
UPDATE t_work SET update_time = insert_time WHERE update_time IS NULL;
CREATE INDEX idx_t_work_update_time ON t_work(update_time, id);

COMMIT;
