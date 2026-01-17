const fs = require('fs');
const { md5 } = require('../auth/utils');
const { databaseExist, createUser } = require('./db');
const { config, updateConfig } = require('../config');
const { initDatabase } = require('./schema');

const initApp = async () => {


  function initDatabaseDir () {
    const databaseFolderDir = config.databaseFolderDir;
    if (!fs.existsSync(databaseFolderDir)) {
      try {
        fs.mkdirSync(databaseFolderDir, { recursive: true });
      } catch(err) {
        console.error(` ! 在创建存放数据库文件的文件夹时出错: ${err.message}`);
      }
    }
  }

  if (!databaseExist) {
    initDatabaseDir();
    await initDatabase();
    try { // 创建内置的管理员账号
      await createUser({
        name: 'admin',
        password: md5('admin'),
        group: 'administrator'
      });
    } catch(err) {{
        console.error(err.message);
        process.exit(1);
      }
    }
  }
}

module.exports = { initApp };
