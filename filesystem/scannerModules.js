const fs = require('fs');
const path = require('path');
const LimitPromise = require('limit-promise'); // 限制并发数量

const axios = require('../scraper/axios.js'); // 数据请求
const { scrapeWorkMetadataFromDLsite, scrapeDynamicWorkMetadataFromDLsite } = require('../scraper/dlsite');
const db = require('../database/db');
const { getFolderList, deleteCoverImageFromDisk, saveCoverImageToDisk, getTrackList } = require('./utils');
const { nameToUUID } = require('../scraper/utils');

const { config } = require('../config');

// 只有在子进程中 process 对象才有 send() 方法
process.send = process.send || function () {};

const tasks = [];
const failedTasks = [];
const mainLogs = [];
const results = [];

const addTask = (rjcode) => tasks.push({
  rjcode,
  result: null,
  logs: []
});

const removeTask = (rjcode) => {
  const index = tasks.findIndex(task => task.rjcode === rjcode);
  const task = tasks[index];
  tasks.splice(index, 1);
  process.send({
    event: 'SCAN_TASKS',
    payload: {
      tasks
    }
  });

  if (task.result === 'failed') {
    failedTasks.push(task);
    process.send({
      event: 'SCAN_FAILED_TASKS',
      payload: {
        failedTasks
      }
    });
  }
};

const addLogForTask = (rjcode, log) => {
  tasks.find(task => task.rjcode === rjcode).logs.push(log);
  process.send({
    event: 'SCAN_TASKS',
    payload: {
      tasks
    }
  });
};

const addResult = (rjcode, result, count) => {
  results.push({
    rjcode,
    result,
    count
  });
  process.send({
    event: 'SCAN_RESULTS',
    payload: {
      results
    }
  });
};

const addMainLog = (log) => {
  mainLogs.push(log);
  process.send({
    event: 'SCAN_MAIN_LOGS',
    payload: {
      mainLogs
    }
  });
};

const emitMainLog = (message, level = 'info', truncate = 3) => {
  console.log(message);
  addMainLog({
    level: level,
    message: message.substring(truncate)
  });
};

const emitTaskLog = (message, rjcode, level = 'info', truncate = 15) => {
  console.log(message);
  addLogForTask(rjcode, {
    level: level,
    message: message.substring(truncate)
  });
}

process.on('message', (m) => {
  if (m.emit === 'SCAN_INIT_STATE') {
    process.send({
      event: 'SCAN_INIT_STATE',
      payload: {
        tasks,
        failedTasks,
        mainLogs,
        results
      }
    });
  } else if (m.exit) {
    console.error(' ! 终止扫描进程.');
    addMainLog({
      level: 'error',
      message: '终止扫描进程.'
    });

    process.exit(1);
  }
});


/**
 * 通过数组 arr 中每个对象的 id 属性来对数组去重
 * @param {Array} arr 
 */
const uniqueArr = (arr) => {
  const uniqueArr = [];
  const duplicate = {};

  for (let i=0; i<arr.length; i++) {
    for (let j=i+1; j<arr.length; j++) {
      if (arr[i].id === arr[j].id) {
        duplicate[arr[i].id] = duplicate[arr[i].id] || [];
        duplicate[arr[i].id].push(arr[i]);
        ++i;
      }
    }
    uniqueArr.push(arr[i]);
  }

  return {
    uniqueArr, // 去重后的数组
    duplicate, // 对象，键为id，值为多余的重复项数组
  };
};

/**
 * 从 DLsite 抓取该音声的元数据，并保存到数据库，
 * 返回一个 Promise 对象，处理结果: 'added' or 'failed'
 * @param {number} id work id
 * @param {string} rootFolderName 根文件夹别名
 * @param {string} dir 音声文件夹相对路径
 * @param {string} tagLanguage 标签语言，'ja-jp', 'zh-tw' or 'zh-cn'，默认'zh-cn'
 */
const getMetadata = (id, rootFolderName, dir, tagLanguage) => {
  //const rjcode = (`000000${id}`).slice(-6); // zero-pad to 6 digits
  let rjcode ;
  if (id>=1000000) {
    rjcode = (`00000000${id}`).slice(-8);
  } else {
    rjcode = (`000000${id}`).slice(-6);
  }
  console.log(` -> [RJ${rjcode}] 从 DLSite 抓取元数据...`);
  addLogForTask(rjcode, {
    level: 'info',
    message: '从 DLSite 抓取元数据...'
  });
  
  return scrapeWorkMetadataFromDLsite(id, tagLanguage) // 抓取该音声的元数据
    .then((metadata) => {
      const rootFolder = config.rootFolders.find(rootFolder => rootFolder.name === rootFolderName);
      const absolutePath = path.join(rootFolder.path, dir);
      console.log(absolutePath)
      return getTrackList(id, absolutePath)
      .then((tracks) => {
        metadata.hasLrc = false
        for (let idx in tracks) {
          const fileLoc = path.join(absolutePath, tracks[idx].subtitle || '', tracks[idx].title);
          const lrcFileLoc = fileLoc.substr(0, fileLoc.lastIndexOf(".")) + ".lrc";

          console.log(fileLoc)
          console.log(lrcFileLoc)
      
          if (fs.existsSync(lrcFileLoc)) {
            metadata.hasLrc = true
          }
        }
        return metadata
      })
    })
    .then((metadata) => {
      // 将抓取到的元数据插入到数据库
      console.log(` -> [RJ${rjcode}] 元数据抓取成功，准备添加到数据库...`);
      addLogForTask(rjcode, {
        level: 'info',
        message: '元数据抓取成功，准备添加到数据库...'
      });
      
      metadata.rootFolderName = rootFolderName;
      metadata.dir = dir;
      if (metadata.hasLrc) metadata.tags.push({"id": -1, "name": "中文字幕"})

      return db.insertWorkMetadata(metadata)
        .then(() => {
          console.log(` -> [RJ${rjcode}] 元数据成功添加到数据库.`);
          addLogForTask(rjcode, {
            level: 'info',
            message: '元数据成功添加到数据库.'
          });
          
          return 'added';
        })
        .catch((err) => {
          console.error(`  ! [RJ${rjcode}] 在插入元数据过程中出错: ${err.message}`);
          addLogForTask(rjcode, {
            level: 'error',
            message: `在插入元数据过程中出错: ${err.message}`
          });
          
          return 'failed';
        });
    })
    .catch((err) => {
      console.error(`  ! [RJ${rjcode}] 在抓取元数据过程中出错: ${err.message}`);
      addLogForTask(rjcode, {
        level: 'error',
        message: `在抓取元数据过程中出错: ${err.message}`
      });
      
      return 'failed';
    });
};

/**
 * 从 DLsite 下载封面图片，并保存到 Images 文件夹，
 * 返回一个 Promise 对象，处理结果: 'added' or 'failed'
 * @param {number} id work id
 * @param {Array} types img types: ['main', 'sam', 'sam@2x', 'sam@3x', '240x240', '360x360']
 */
const getCoverImage = (id, types) => {
  //const rjcode = (`000000${id}`).slice(-6); // zero-pad to 6 digits
  let rjcode ;
  if (id>=1000000) {
    rjcode = (`00000000${id}`).slice(-8);
  } else {
    rjcode = (`000000${id}`).slice(-6);
  }
  const id2 = (id % 1000 === 0) ? id : parseInt(id / 1000) * 1000 + 1000;
  //const rjcode2 = (`000000${id2}`).slice(-6); // zero-pad to 6 digits
  let rjcode2 ;
  if (id2>=1000000) {
    rjcode2 = (`00000000${id2}`).slice(-8);
  } else {
    rjcode2 = (`000000${id2}`).slice(-6);
  }
  const promises = [];
  types.forEach(type => {
    let url = `https://img.dlsite.jp/modpub/images2/work/doujin/RJ${rjcode2}/RJ${rjcode}_img_${type}.jpg`;
    if (type === '240x240'|| type === '360x360') {
      url = `https://img.dlsite.jp/resize/images2/work/doujin/RJ${rjcode2}/RJ${rjcode}_img_main_${type}.jpg`;
    }
    promises.push(
      axios.retryGet(url, { responseType: "stream", retry: {} })
        .then((imageRes) => {
          return saveCoverImageToDisk(imageRes.data, rjcode, type)
            .then(() => {
              console.log(` -> [RJ${rjcode}] 封面 RJ${rjcode}_img_${type}.jpg 下载成功.`);
              addLogForTask(rjcode, {
                level: 'info',
                message: `封面 RJ${rjcode}_img_${type}.jpg 下载成功.`
              });

              return 'added';
            });
        })
        .catch((err) => {
          console.error(`  ! [RJ${rjcode}] 在下载封面 RJ${rjcode}_img_${type}.jpg 过程中出错: ${err.message}`);
          addLogForTask(rjcode, {
            level: 'error',
            message: `在下载封面 RJ${rjcode}_img_${type}.jpg 过程中出错: ${err.message}`
          });
          
          return 'failed';
        })
    );
  });

  console.log(` -> [RJ${rjcode}] 从 DLsite 下载封面...`);
  addLogForTask(rjcode, {
    level: 'info',
    message: `从 DLsite 下载封面...`
  });
  
  return Promise.all(promises)
    .then((results) => {
      results.forEach(result => {
        if (result === 'failed') {
          return 'failed';
        }
      });

      return 'added';
    });
};

/**
 * 获取音声元数据，获取音声封面图片，
 * 返回一个 Promise 对象，处理结果: 'added', 'skipped' or 'failed'
 * @param {string} folder 音声文件夹对象 { relativePath: '相对路径', rootFolderName: '根文件夹别名', id: '音声ID' }
 */
const processFolder = (folder) => db.knex('t_work')
  .select('id')
  .where('id', '=', folder.id)
  .count()
  .first()
  .then((res) => {
    //const rjcode = (`000000${folder.id}`).slice(-6); // zero-pad to 6 digits
    let rjcode ;
    if (folder.id>=1000000) {
      rjcode = (`00000000${folder.id}`).slice(-8);
    } else {
      rjcode = (`000000${folder.id}`).slice(-6);
    }
    const coverTypes = ['main', 'sam', '240x240'];
    const count = res['count(*)'];
    if (count) { // 查询数据库，检查是否已经写入该音声的元数据
      // 已经成功写入元数据
      // 检查音声封面图片是否缺失
      const lostCoverTypes = [];
      coverTypes.forEach(type => {
        const coverPath = path.join(config.coverFolderDir, `RJ${rjcode}_img_${type}.jpg`);
        if (!fs.existsSync(coverPath)) {
          lostCoverTypes.push(type);
        }
      });
      
      if (lostCoverTypes.length) {
        console.log(`  ! [RJ${rjcode}] 封面图片缺失，重新下载封面图片...`);
        addTask(rjcode);
        addLogForTask(rjcode, {
          level: 'info',
          message: '封面图片缺失，重新下载封面图片...'
        });

        return getCoverImage(folder.id, lostCoverTypes);
      } else {
        return 'skipped';
      }
    } else {
      console.log(` * 发现新文件夹: "${folder.absolutePath}"`);
      addTask(rjcode);
      addLogForTask(rjcode, {
        level: 'info',
        message: `发现新文件夹: "${folder.absolutePath}"`
      });
      
      return getMetadata(folder.id, folder.rootFolderName, folder.relativePath, config.tagLanguage) // 获取元数据
        .then((result) => {
          if (result === 'failed') { // 如果获取元数据失败，跳过封面图片下载
            return 'failed';
          } else { // 下载封面图片
            return getCoverImage(folder.id, coverTypes);
          }
        });
    }
  });

const MAX = config.maxParallelism; // 并发请求上限
const limitP = new LimitPromise(MAX); // 核心控制器
/**
 * 限制 processFolder 并发数量，
 * 使用控制器包装 processFolder 方法，实际上是将请求函数递交给控制器处理
 */
const processFolderLimited = (folder) => {
  return limitP.call(processFolder, folder);
};

/**
 * 清理本地不再存在的音声: 将其元数据从数据库中移除，并删除其封面图片
 */
const performCleanup = async () => {
  const trxProvider = db.knex.transactionProvider();
  const trx = await trxProvider();
  const works = await trx('t_work').select('id', 'root_folder', 'dir');
  const promises = works.map(work => new Promise((resolve, reject) => {
    // 检查每个音声的根文件夹或本地路径是否仍然存在
    const rootFolder = config.rootFolders.find(rootFolder => rootFolder.name === work.root_folder);
    if (!rootFolder || !fs.existsSync(path.join(rootFolder.path, work.dir))) {
      db.removeWork(work.id, trxProvider) // 将其数据项从数据库中移除
        .then((result) => { // 然后删除其封面图片
          //const rjcode = (`000000${work.id}`).slice(-6); // zero-pad to 6 digits
          let rjcode ;
          if (work.id>=1000000) {
            rjcode = (`00000000${work.id}`).slice(-8);
          } else {
            rjcode = (`000000${work.id}`).slice(-6);
          }
          deleteCoverImageFromDisk(rjcode)    
            .catch((err) => {
              if (err && err.code !== 'ENOENT') { 
                console.error(`  ! [RJ${rjcode}] 在删除封面过程中出错: ${err.message}`);
                addMainLog({
                  level: 'error',
                  message: `[RJ${rjcode}] 在删除封面过程中出错: ${err.message}`
                });
              }
            })
            .then(() => resolve(result));
        })
        .catch(err => reject(err));
    } else {
      resolve();
    }
  }));

  await Promise.all(promises);
  trx.commit();
};

const prepareEnvironment = () => {
  if (!fs.existsSync(config.coverFolderDir)) {
    fs.mkdirSync(config.coverFolderDir, { recursive: true });
  }
};

const runCleanupStep = async () => {
  console.log(' * 清理本地不再存在的音声的数据与封面图片...');
  addMainLog({ level: 'info', message: '清理本地不再存在的音声的数据与封面图片...' });
  await performCleanup();
  console.log(' * 清理完成. 现在开始扫描...');
};

const collectAllFolders = async () => {
  let list = [];
  for (const rootFolder of config.rootFolders) {
    for await (const folder of getFolderList(rootFolder, '', 0, addMainLog)) {
      list.push(folder);
    }
  }
  console.log(` * 共找到 ${list.length} 个音声文件夹.`);
  return list;
};

const handleDeduplication = (folderList, counts) => {
  const { uniqueArr: uniqueList, duplicate } = uniqueArr(folderList);
  const duplicateNum = folderList.length - uniqueList.length;

  if (duplicateNum > 0) {
    console.log(` ! 发现 ${duplicateNum} 个重复的音声文件夹.`);
    Object.keys(duplicate).forEach(key => {
      const rjcode = formatRJCode(key);
      console.log(` -> [RJ${rjcode}] 存在多个文件夹:`);
      // 这里可以继续遍历打印 duplicate[key] 的路径...
    });
  }
  return { uniqueFolderList: uniqueList, duplicateNum };
};

const processSingleFolder = async (folder, counts) => {
  const result = await processFolderLimited(folder);
  const rjcode = formatRJCode(folder.id);

  counts[result]++; // 更新计数器

  if (result === 'added' || result === 'failed') {
    const isSuccess = result === 'added';
    const logType = isSuccess ? 'info' : 'error';
    const statusText = isSuccess ? '添加成功' : '添加失败';

    console[isSuccess ? 'log' : 'error'](` -> [RJ${rjcode}] ${statusText}! ${result.toUpperCase()}: ${counts[result]}`);

    // 更新任务状态
    const task = tasks.find(t => t.rjcode === rjcode);
    if (task) task.result = result;

    removeTask(rjcode);
    addResult(rjcode, result, counts[result]);
  }
};

const formatRJCode = (id) => {
  return id >= 1000000
    ? (`00000000${id}`).slice(-8)
    : (`000000${id}`).slice(-6);
};

const finalizeScan = (counts) => {
  const message = counts.updated
    ? `扫描完成: 更新 ${counts.updated} 个，新增 ${counts.added} 个，跳过 ${counts.skipped} 个，失败 ${counts.failed} 个.`
    : `扫描完成: 新增 ${counts.added} 个，跳过 ${counts.skipped} 个，失败 ${counts.failed} 个.`;

  console.log(` * ${message}`);
  process.send({ event: 'SCAN_FINISHED', payload: { message } });

  db.knex.destroy();
  process.exit(0);
};
/**
 * 执行扫描
 * createCoverFolder => createSchema => cleanup => getAllFolderList => processAllFolder
 */
const performScan = async () => {
  try {
    // 1. 准备阶段
    prepareEnvironment();

    const counts = { added: 0, failed: 0, skipped: 0, updated: 0 };

    // 2. 数据清理阶段
    if (config.skipCleanup) {
      console.log(' * 根据设置跳过清理.');
    } else {
      await runCleanupStep();
    }

    // 3. 文件获取与去重阶段
    const folderList = await collectAllFolders();
    const { uniqueFolderList, duplicateNum } = handleDeduplication(folderList, counts);
    counts.skipped += duplicateNum;

    // 4. 核心处理阶段 (并行执行)
    await Promise.all(
      uniqueFolderList.map(folder => processSingleFolder(folder, counts))
    );

    // 5. 收尾阶段
    finalizeScan(counts);

  } catch (err) {
    console.error(` ! 扫描过程中出错: ${err.message}`);
    addMainLog({ level: 'error', message: err.message });
    process.exit(1);
  }
};

/**
 * 更新音声的动态元数据
 * @param {number} id work id
 * @param {options = {}} options includeVA, includeTags
 */
const updateMetadata = (id, options = {}) => {
  let scrapeProcessor = () => scrapeWorkMetadataFromDLsite(id, config.tagLanguage);

  //const rjcode = (`000000${id}`).slice(-6); // zero-pad to 6 digits
  let rjcode ;
  if (id>=1000000) {
    rjcode = (`00000000${id}`).slice(-8);
  } else {
    rjcode = (`000000${id}`).slice(-6);
  }
  addTask(rjcode); // addTask only accepts a string
  return scrapeProcessor() // 抓取该音声的元数据
    .then((metadata) => {
      // 将抓取到的元数据插入到数据库
      emitTaskLog(` -> [RJ${rjcode}] 元数据抓取成功，准备更新元数据...`, rjcode);
      metadata.id = id;
      return db.updateWorkMetadata(metadata, options)
        .then(() => {
          emitTaskLog(` -> [RJ${rjcode}] 元数据更新成功`, rjcode);
          return 'updated';
        });
    })
    .catch((err) => {
      emitTaskLog(`  ! [RJ${rjcode}] 在抓取元数据过程中出错: ${err}`, rjcode, 'error');
      return 'failed';
    });
};

const updateMetadataLimited = (id, options = null) => limitP.call(updateMetadata, id, options);
const updateVoiceActorLimited = (id) => limitP.call(updateMetadata, id, { includeVA: true });

// eslint-disable-next-line no-unused-vars
const performUpdate = async (options = null) => {
  const baseQuery = db.knex('t_work').select('id');
  const processor = (id) => updateMetadataLimited(id, options);

  const counts = await refreshWorks(baseQuery, 'id', processor);

  const message = `扫描完成: 更新 ${counts.updated} 个，失败 ${counts.failed} 个.`;
  console.log(` * ${message}`);
  process.send({
    event: 'SCAN_FINISHED',
    payload: {
      message: message
    }
  });
  db.knex.destroy();
  if (counts.failed) process.exit(1);
};

const fixVoiceActorBug = () => {
  const baseQuery = db.knex('r_va_work').select('va_id', 'work_id');
  const filter = (query) => query.where('va_id', nameToUUID('かの仔')).orWhere('va_id', nameToUUID('こっこ'));
  const processor = (id) => updateVoiceActorLimited(id);
  return refreshWorks(filter(baseQuery), 'work_id', processor);
};

const refreshWorks = async (query, idColumnName, processor) => {
  return query.then(async (works) => {
    console.log(` * 共 ${works.length} 个音声.`);
    addMainLog({
      level: 'info',
      message: `共 ${works.length} 个作品. 开始刷新`
    });

    const counts = {
      updated: 0,
      failed: 0,
    }; 

    const promises = works.map((work) => {
      const workid = work[idColumnName];
      //const rjcode = (`000000${workid}`).slice(-6);
      let rjcode ;
      if (workid>=1000000) {
        rjcode = (`00000000${workid}`).slice(-8);
      } else {
        rjcode = (`000000${workid}`).slice(-6);
      }
      return processor(workid)
        .then((result) => { // 统计处理结果
          result === 'failed' ? counts['failed'] += 1 : counts['updated'] += 1;
          tasks.find(task => task.rjcode === rjcode).result = result;
          removeTask(rjcode);
          if (result === 'failed') {
            addResult(rjcode, 'failed', counts.failed);
          } else {
            addResult(rjcode, 'updated', counts.updated);
          }
      })
    });
    await Promise.all(promises);
    emitMainLog(` * 完成元数据更新 ${counts.updated} 个，失败 ${counts.failed} 个.`);

    return counts;
  });
};

module.exports = { performScan, performUpdate}