const fs = require('fs');
const path = require('path');
const recursiveReaddir = require('recursive-readdir');
const { orderBy } = require('natural-orderby');
const { joinFragments } = require('../routes/utils/url')
const { config } = require('../config');
const { formatRJLabel } = require('../utils/workId');

/**
 * Returns list of playable tracks in a given folder. Track is an object
 * containing 'title', 'subtitle' and 'hash'.
 * @param {Number} id Work identifier. Currently, RJ/RE code.
 * @param {String} dir Work directory (absolute).
 */
const getTrackList = (id, dir) => recursiveReaddir(dir)
  .then((files) => {
    const filteredFiles = files.filter((file) => {
      const ext = path.extname(file).toLowerCase();

      return (ext === '.mp3' || ext === '.ogg' || ext === '.opus' || ext === '.wav' || ext === '.aac'
        || ext === '.flac' || ext === '.webm' || ext === '.mp4'|| ext === '.m4a' 
        || ext === '.txt' || ext === '.lrc' || ext === '.srt' || ext === '.ass'
        || ext === '.pdf'
        || ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp');
    });

    const sortedFiles = orderBy(filteredFiles.map((file) => {
      const shortFilePath = file.replace(path.join(dir, '/'), '');
      const dirName = path.dirname(shortFilePath);

      return {
        title: path.basename(file),
        subtitle: dirName === '.' ? null : dirName,
        ext: path.extname(file),
      };
    }), [v => v.subtitle, v => v.title, v => v.ext]);

    const sortedHashedFiles = sortedFiles.map(
      (file, index) => ({
        title: file.title,
        subtitle: file.subtitle,
        hash: `${id}/${index}`,
        ext: file.ext,
      }),
    );

    return sortedHashedFiles;
  })
  .catch((err) => { throw new Error(`Failed to get tracklist from disk: ${err}`); });

const hasLrc = (tracks) => Array.isArray(tracks) && tracks.some((track) => {
  return track && typeof track.ext === 'string' && track.ext.toLowerCase() === '.lrc';
});

/**
 * 转换成树状结构
 * @param {Array} tracks 
 */
const toTree = (tracks, workDir, rootFolder) => {
  const tree = [];

  // 插入文件夹
  tracks.forEach(track => {
    let fatherFolder = tree;
    const paths = track.subtitle ? track.subtitle.split(path.sep) : [];
    paths.forEach(folderName => {
      const index = fatherFolder.findIndex(item => item.type === 'folder' && item.title === folderName);
      if (index === -1) {
        fatherFolder.push({
          type: 'folder',
          title: folderName,
          children: []
        });
      }
      fatherFolder = fatherFolder.find(item => item.type === 'folder' && item.title === folderName).children;
    });
  });

  // 插入文件
  tracks.forEach(track => {
    let fatherFolder = tree;
    const paths = track.subtitle ? track.subtitle.split(path.sep) : [];
    paths.forEach(folderName => {
      fatherFolder = fatherFolder.find(item => item.type === 'folder' && item.title === folderName).children;
    });

    // Path controlled by config.offloadMedia, config.offloadStreamPath and config.offloadDownloadPath
    // If config.offloadMedia is enabled, by default, the paths are:
    // /media/stream/VoiceWork/RJ123456/subdirs/track.mp3
    // /media/download//VoiceWork/RJ123456/subdirs/track.mp3
    //
    // If the folder is deeper:
    // /media/stream/VoiceWork/second/RJ123456/subdirs/track.mp3
    // /media/download/VoiceWork/second/RJ123456/subdirs/track.mp3
    let offloadStreamUrl = joinFragments(config.offloadStreamPath, rootFolder.name, workDir, track.subtitle || '', track.title);
    let offloadDownloadUrl = joinFragments(config.offloadDownloadPath, rootFolder.name, workDir, track.subtitle || '', track.title);
    if (process.platform === 'win32') {
      offloadStreamUrl = offloadStreamUrl.replace(/\\/g, '/');
      offloadDownloadUrl = offloadDownloadUrl.replace(/\\/g, '/');
    }
  
    const textBaseUrl = '/api/media/stream/'
    const mediaStreamBaseUrl = '/api/media/stream/'
    const mediaDownloadBaseUrl = '/api/media/download/'
    const textStreamBaseUrl = textBaseUrl + track.hash;    // Handle charset detection internally with jschardet
    const textDownloadBaseUrl = config.offloadMedia ? offloadDownloadUrl : mediaDownloadBaseUrl + track.hash;
    const mediaStreamUrl = config.offloadMedia ? offloadStreamUrl : mediaStreamBaseUrl + track.hash;
    const mediaDownloadUrl = config.offloadMedia ? offloadDownloadUrl : mediaDownloadBaseUrl + track.hash;

    if (track.ext === '.txt' || track.ext === '.lrc' || track.ext === '.srt' || track.ext === '.ass') {
      fatherFolder.push({
        type: 'text',
        hash: track.hash,
        title: track.title,
        mediaStreamUrl: textStreamBaseUrl,
        mediaDownloadUrl: textDownloadBaseUrl
      });
    } else if (track.ext === '.jpg' || track.ext === '.jpeg' || track.ext === '.png' || track.ext === '.webp' ) {
      fatherFolder.push({
        type: 'image',
        hash: track.hash,
        title: track.title,
        mediaStreamUrl,
        mediaDownloadUrl
      });
    } else if (track.ext === '.pdf') {
      fatherFolder.push({
        type: 'other',
        hash: track.hash,
        title: track.title,
        mediaStreamUrl,
        mediaDownloadUrl
      });
    } else {
      fatherFolder.push({
        type: 'audio',
        hash: track.hash,
        title: track.title,
        mediaStreamUrl,
        mediaDownloadUrl
      });
    }
  });

  return tree;
};

/**
 * 返回一个成员为指定根文件夹下所有包含 RJ 号的音声文件夹对象的数组，
 * 音声文件夹对象 { relativePath: '相对路径', rootFolderName: '根文件夹别名', id: '音声ID' }
 * @param {Object} rootFolder 根文件夹对象 { name: '别名', path: '绝对路径' }
 */
async function* getFolderList(rootFolder, current = '', depth = 0, callback = function addMainLog(){} ) {
  const folders = await fs.promises.readdir(path.join(rootFolder.path, current));    

  for (const folder of folders) {
    const absolutePath = path.resolve(rootFolder.path, current, folder);
    const relativePath = path.join(current, folder);

    try {
    // eslint-disable-next-line no-await-in-loop
      if ((await fs.promises.stat(absolutePath)).isDirectory()) {
          if (folder.match(/RJ\d+/)) {
            // Found a work folder, don't go any deeper.
            yield { absolutePath, relativePath, rootFolderName: rootFolder.name, id: parseInt(folder.match(/RJ(\d+)/)[1]) };
          } else if (depth + 1 < config.scannerMaxRecursionDepth) {
            // 若文件夹名称中不含有RJ号，就进入该文件夹内部
            yield* getFolderList(rootFolder, relativePath, depth + 1);
          }
        }
    } catch (err) {
      if (err.code === 'EPERM') {
        if (err.path && !err.path.endsWith('System Volume Information')) {
          console.log(' ! 无法访问', err.path)
          callback({
            level: 'info',
            message: ` ! 无法访问 ${err.path}`
          })
        }
      } else {
        throw err
      }
    }
  }
}

// 封面资源：main（必需，DLsite 的 560x420 原图）和两张缩略图。
//   240x240  DLsite 的 240x240 就是 main 的等比缩放（实测 560x420 -> 240x180），
//            本地生成的结果与 DLsite 一致，可以离线自愈
//   sam      原图的等比缩略图（保留原图比例：100x100 / 100x75 / ...），DLsite 仍在提供，
//            由 main 派生只能得到 4:3 版本（丢掉原图上下部分），所以优先下载，本地生成只作兜底
// 360x360 已废弃：不再下载/生成，只在删除工作时清理，并在路由里兼容旧客户端
const COVER_TYPES = ['main', 'sam', '240x240'];
const LEGACY_COVER_TYPES = ['360x360'];

/**
 * 封面文件的绝对路径.
 * @param {Number|String} id work id
 * @param {String} type 'main' or '240x240'
 */
const coverFilePath = (id, type) => path.join(config.coverFolderDir, `${formatRJLabel(id)}_img_${type}.jpg`);

/**
 * 判断封面文件是否可用：存在、非空、且确实是 JPEG。
 * 下载中途断流会在磁盘上留下 0 字节 / 截断的文件，DLsite 被拦截时还可能返回 HTML 错误页，
 * 只判断「文件是否存在」会把这些坏文件当成有效封面，导致它们永远不会被重新下载或生成。
 * @param {String} filePath 封面绝对路径
 */
const isUsableCoverFile = (filePath) => {
  let fd;

  try {
    if (fs.statSync(filePath).size < 3) return false;

    fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(3);
    fs.readSync(fd, header, 0, 3, 0);

    return header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF; // JPEG 的 SOI 标记
  } catch (err) {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
};

/**
 * 封面来源标记：写在图片自带的 JPEG 注释段（COM，0xFFFE）里，用来记住
 * 「这张图是本地由 main 生成的降级版」，扫描时才有依据把它换回 DLsite 的原图。
 * 放进图片本身而不是边车文件，是为了拷库 / 搬目录 / 只备份 covers 时标记不会和图片失散
 * —— 标记一失散，那张降级图就再也不会被修复了。
 */
const ORIGIN_MARKER_PREFIX = 'kikoeru-origin:';
// 标记只可能出现在文件头（我们把段插在 SOI 之后），不必读整个文件
const ORIGIN_SCAN_BYTES = 4096;

/**
 * 在 JPEG 头部按段结构找出我们写入的来源标记。
 * @param {Buffer} header 文件头
 * @param {Number} length 实际读到的字节数
 * @returns {Object|null} { offset, size, meta }
 */
const findOriginSegment = (header, length) => {
  if (length < 4 || header[0] !== 0xFF || header[1] !== 0xD8) return null;

  let offset = 2;

  while (offset + 4 <= length) {
    if (header[offset] !== 0xFF) return null; // 段结构对不上就不硬猜

    const marker = header[offset + 1];
    // 0xD8 = 又一个 SOI，0xDA = SOS，后面是压缩数据，都不会再有段
    if (marker === 0xD8 || marker === 0xDA) return null;

    const size = header.readUInt16BE(offset + 2);
    if (marker === 0xFE) {
      const text = header.toString('utf8', offset + 4, Math.min(offset + 2 + size, length));
      if (text.startsWith(ORIGIN_MARKER_PREFIX)) {
        try {
          return { offset, size, meta: JSON.parse(text.slice(ORIGIN_MARKER_PREFIX.length)) };
        } catch (err) {
          return null;
        }
      }
    }

    offset += 2 + size;
  }

  return null;
};

/**
 * 读取封面的来源标记。
 * @param {String} filePath 封面路径
 * @returns {Object|null} 本地生成的标记内容（{ from, mainSize, mainMtime, at, tried }）；
 *                        DLsite 原图、或读不到时返回 null
 */
const readCoverOrigin = (filePath) => {
  let fd;

  try {
    fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(ORIGIN_SCAN_BYTES);
    const length = fs.readSync(fd, header, 0, header.length, 0);
    const segment = findOriginSegment(header, length);

    return segment ? segment.meta : null;
  } catch (err) {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
};

/**
 * 给本地生成的封面打上来源标记（只改文件头，图像数据不重新编码）。
 * @param {String} filePath 图片路径
 * @param {Object} meta { from, mainSize, mainMtime, at, tried }
 */
const markCoverAsGenerated = async (filePath, meta) => {
  const payload = Buffer.from(ORIGIN_MARKER_PREFIX + JSON.stringify(meta), 'utf8');
  const size = payload.length + 2; // 段长包含自身的 2 字节
  const segment = Buffer.concat([
    Buffer.from([0xFF, 0xFE, (size >> 8) & 0xFF, size & 0xFF]),
    payload,
  ]);

  const original = await fs.promises.readFile(filePath);
  const existing = findOriginSegment(original, original.length);
  // 已经有标记就先把旧段去掉，避免重复插入
  const clean = existing
    ? Buffer.concat([
      original.subarray(0, existing.offset),
      original.subarray(existing.offset + 2 + existing.size),
    ])
    : original;

  if (clean.length < 4) throw new Error('不是有效的图片文件');

  const tempPath = `${filePath}.part`;
  await fs.promises.writeFile(tempPath, Buffer.concat([clean.subarray(0, 2), segment, clean.subarray(2)]));
  await fs.promises.rename(tempPath, filePath);
};

/**
 * 取文件的 size + mtime，用来判断本地生成的缩略图是否跟着 main 过期了。
 * @param {String} filePath
 * @returns {Object|null} { size, mtime } 或 null（读不到）
 */
const getFileStamp = (filePath) => {
  try {
    const stat = fs.statSync(filePath);
    return { size: stat.size, mtime: Math.floor(stat.mtimeMs) };
  } catch (err) {
    return null;
  }
};

/**
 * Deletes a work's cover image from disk.
 * @param {Number|String} id work id
 */
const deleteCoverImageFromDisk = async (id) => {
  const types = [...COVER_TYPES, ...LEGACY_COVER_TYPES];
  const results = await Promise.allSettled(
    types.map(type => fs.promises.unlink(coverFilePath(id, type))),
  );

  // 文件本来就不存在（ENOENT）是正常情况，其他错误才交给调用方处理
  const failed = results.find(result => result.status === 'rejected' && result.reason.code !== 'ENOENT');
  if (failed) throw failed.reason;
};

/**
 * Saves cover image to disk.
 * 用 'finish'（数据全部写完）而不是 'close' 判定成功：响应体中途断流时 'close' 一样会触发，
 * 会把半个文件当成下载成功。先写 .part 再改名，同理避免半成品出现在正式路径上。
 * 改名之前先校验一遍：DLsite 被拦截时可能返回 200 + 一个 HTML 错误页，
 * 校验不过就直接失败，不会覆盖掉已经有用的封面。
 * @param {ReadableStream} stream Image data stream.
 * @param {Number|String} id work id
 * @param {String} type img type: 'main' or '240x240'.
 */
const saveCoverImageToDisk = (stream, id, type) => new Promise((resolve, reject) => {
  const finalPath = coverFilePath(id, type);
  const tempPath = `${finalPath}.part`;
  const out = fs.createWriteStream(tempPath);
  let sourceEnded = false;
  let streamError = null;
  let settled = false;

  const fail = (err) => {
    if (settled) return;
    settled = true;

    out.destroy();
    stream.destroy();
    fs.promises.unlink(tempPath)
      .catch(() => {})
      .then(() => reject(err));
  };

  // 必须显式接住源流错误：pipe 不会把错误传给写入流，Promise 也就永远不会结束
  stream.on('error', (err) => {
    streamError = err;
    fail(err);
  });
  stream.on('end', () => { sourceEnded = true; });
  // 连接被直接掐断时源流可能只触发 close 而不触发 error；已经报过错的就用那个错误
  stream.on('close', () => {
    if (!sourceEnded && !streamError) fail(new Error('封面下载没有完成（连接中断）'));
  });
  out.on('error', fail);
  out.on('finish', () => {
    if (settled) return;

    if (!isUsableCoverFile(tempPath)) {
      return fail(new Error('下载到的内容不是有效图片'));
    }

    fs.promises.rename(tempPath, finalPath).then(() => resolve(), fail);
  });

  stream.pipe(out);
});

/**
 * 清理下载中断留下的 .part 半成品。
 */
const removeTemporaryCoverFiles = async () => {
  const entries = await fs.promises.readdir(config.coverFolderDir).catch(() => []);

  await Promise.all(
    entries
      .filter(name => name.endsWith('.jpg.part'))
      .map(name => fs.promises.unlink(path.join(config.coverFolderDir, name)).catch(() => {})),
  );
};


module.exports = {
  getTrackList,
  hasLrc,
  toTree,
  getFolderList,
  deleteCoverImageFromDisk,
  saveCoverImageToDisk,
  removeTemporaryCoverFiles,
  COVER_TYPES,
  coverFilePath,
  isUsableCoverFile,
  readCoverOrigin,
  markCoverAsGenerated,
  getFileStamp,
};

