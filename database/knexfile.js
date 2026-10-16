const path = require('path')
const { config } = require('../config')

module.exports = {
  development: {
    client: 'sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: path.join(config.databaseFolderDir, 'db.sqlite3'),
    },
    acquireConnectionTimeout: 40000,
    pool: {
      afterCreate: (conn, done) => {
        conn.run('PRAGMA foreign_keys = ON;', function (err) {
          if (err) {
            done(err, conn);
          } else {
            conn.run(`PRAGMA busy_timeout = ${config.dbBusyTimeout};`, function (err) {
              done(err, conn);
            });
          }
        });
      }
    }
  }
};
