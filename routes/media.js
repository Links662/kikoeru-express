const express = require('express');
const router = express.Router();
const { findRootFolder } = require('../config');
const db = require('../database/db');
const { param } = require('express-validator');
const fs = require('fs');
const path = require('path');
const jschardet = require('jschardet');
const { getTrackList } = require('../filesystem/utils');
const { isValidRequest } = require('./utils/validate')

router.get('/stream/:id/:index',
  param('id').isInt(),
  param('index').isInt(),
  (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    db.knex('t_work')
      .select('root_folder_id', 'dir')
      .where('id', '=', req.params.id)
      .first()
      .then((work) => {
        const rootFolder = findRootFolder(work);
        if (rootFolder) {
          getTrackList(req.params.id, path.join(rootFolder.path, work.dir))
            .then((tracks) => {
              const track = tracks[req.params.index];

              const fileName = path.join(rootFolder.path, work.dir, track.subtitle || '', track.title);
              const extName = path.extname(fileName);
              if (extName === '.txt' || extName === '.lrc') {
                const fileBuffer = fs.readFileSync(fileName);
                const charsetMatch = jschardet.detect(fileBuffer).encoding;
                if (charsetMatch) {
                  res.setHeader('Content-Type', `text/plain; charset=${charsetMatch}`);
                }
              }
              if (extName === '.flac') {
                // iOS不支持audio/x-flac
                res.setHeader('Content-Type', `audio/flac`);
              }

              res.sendFile(fileName);
            })
            .catch(err => next(err));
        } else {
          res.status(500).send({error: `找不到根目录 #${work.root_folder_id}，请检查存储管理设置.`});
        }
      })
      .catch(err => next(err));
});

router.get('/download/:id/:index',
  param('id').isInt(),
  param('index').isInt(),
  (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    db.knex('t_work')
      .select('root_folder_id', 'dir')
      .where('id', '=', req.params.id)
      .first()
      .then((work) => {
        const rootFolder = findRootFolder(work);
        if (rootFolder) {
          getTrackList(req.params.id, path.join(rootFolder.path, work.dir))
            .then((tracks) => {
              const track = tracks[req.params.index];

              res.download(path.join(rootFolder.path, work.dir, track.subtitle || '', track.title));
            })
            .catch(err => next(err));
        } else {
          res.status(500).send({error: `找不到根目录 #${work.root_folder_id}，请检查存储管理设置.`});
        }
      });
});

router.get('/check-lrc/:id/:index',
  param('id').isInt(),
  param('index').isInt(),
  (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    db.knex('t_work')
      .select('root_folder_id', 'dir')
      .where('id', '=', req.params.id)
      .first()
      .then((work) => {
        const rootFolder = findRootFolder(work);
        if (rootFolder) {
          getTrackList(req.params.id, path.join(rootFolder.path, work.dir))
            .then((tracks) => {
              const track = tracks[req.params.index];
              const fileLoc = path.join(rootFolder.path, work.dir, track.subtitle || '', track.title);
              const lrcFileLoc = fileLoc.substr(0, fileLoc.lastIndexOf(".")) + ".lrc";

              if (!fs.existsSync(lrcFileLoc)) {
                res.send({result: false, message:'不存在歌词文件', hash: ''});
              } else {
                console.log('找到歌词文件');             
                const lrcFileName = track.title.substr(0, track.title.lastIndexOf(".")) + ".lrc";
                const subtitleToFind = track.subtitle;
                console.log('歌词文件名： ', lrcFileName);
                // 文件名、子目录名相同
                tracks.forEach(trackItem => {
                  if (trackItem.title === lrcFileName && subtitleToFind === trackItem.subtitle) {
                      res.send({result: true, message:'找到歌词文件', hash: trackItem.hash});
                  }
                })
              }
            })
            .catch(err => next(err));
        } else {
          res.status(500).send({error: `找不到根目录 #${work.root_folder_id}，请检查存储管理设置.`});
        }
      })
      .catch(err => next(err));
});

module.exports = router;
