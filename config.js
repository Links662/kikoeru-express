const fs = require('fs');
const path = require('path');
const crypto = require('crypto')

const configFolderDir = path.join(__dirname, 'config');
const configPath = path.join(configFolderDir, 'config.json');
const pjson = require('./package.json');

// Before the following version, there is no version tracking
const versionWithoutVerTracking = '0.4.1';

let config = {};

const voiceWorkDefaultPath = () => {
  if (process.env.IS_DOCKER) {
    return '/usr/src/kikoeru/VoiceWork';
  } else {
    return path.join(__dirname, 'VoiceWork');
  }
}

const defaultConfig = {
  version: pjson.version,
  production: process.env.NODE_ENV === 'production' ? true : false,
  dbBusyTimeout: 1000,
  checkUpdate: true,
  checkBetaUpdate: false,
  maxParallelism: 16,
  rootFolders: [
    // {
    //   name: '',
    //   path: ''
    // }
  ],
  coverFolderDir: path.join(__dirname, 'covers'),
  databaseFolderDir: path.join(__dirname, 'sqlite'),
  coverUseDefaultPath: false, // Ignores coverFolderDir if set to true
  dbUseDefaultPath: true, // Ignores databaseFolderDir if set to true
  voiceWorkDefaultPath: voiceWorkDefaultPath(),
  auth: process.env.NODE_ENV === 'production' ? true : false,
  md5secret: crypto.randomBytes(32).toString('hex'),
  jwtsecret: crypto.randomBytes(32).toString('hex'),
  expiresIn: 2592000,
  scannerMaxRecursionDepth: 2,
  pageSize: 12,
  tagLanguage: 'zh-cn',
  retry: 5,
  dlsiteTimeout: 10000,
  hvdbTimeout: 10000,
  retryDelay: 2000,
  httpProxyHost: '',
  httpProxyPort: 0,
  listenPort: 8888,
  blockRemoteConnection: false,
  behindProxy: false,
  httpsEnabled: false,
  httpsPrivateKey: 'kikoeru.key',
  httpsCert: 'kikoeru.crt',
  httpsPort: 8443,
  skipCleanup: false,
  // 本地生成的缩略图会在这些天之后尝试换成 DLsite 的原图（0 = 每次扫描都试）
  coverUpgradeIntervalDays: 7,
  // 允许升级为 DLsite 原图的缩略图类型；sam 是降级最明显的那个，240x240 也可以加进来
  coverUpgradeTypes: ['sam'],
  enableGzip: true,
  rewindSeekTime: 5,
  forwardSeekTime: 30,
  offloadMedia: false,
  recentCount: 20,
  offloadStreamPath: '/media/stream/',          // /media/stream/RJ123456/subdirs/track.mp3
  offloadDownloadPath: '/media/download/'      // /media/download/RJ123456/subdirs/track.mp3
};

const initConfig = (writeConfigToFile = !process.env.FREEZE_CONFIG_FILE) => {
  config = Object.assign(config, defaultConfig);
  if (writeConfigToFile) {
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, "\t"));
  }
}

const setConfig = (newConfig, writeConfigToFile = !process.env.FREEZE_CONFIG_FILE) => {
  // Prevent changing some values, overwrite with old ones
  newConfig.production = config.production;
  if (process.env.NODE_ENV === 'production' || config.production) {
    newConfig.auth = true;
  }
  newConfig.md5secret = config.md5secret;
  newConfig.jwtsecret = config.jwtsecret;

  // Merge config
  config = Object.assign(config, newConfig);
  if (writeConfigToFile) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, "\t"));
  }
}

const readConfig = () => {
  config = JSON.parse(fs.readFileSync(configPath));
  for (let key in defaultConfig) {
    if (!config.hasOwnProperty(key)) {
      if (key === 'version') {
        config['version'] = versionWithoutVerTracking;
      } else {
        config[key] = defaultConfig[key];
      }
    }
  }

  // Support reading relative path
  // When config is saved in admin panel, it will still be stored as absolute path 
  if(!path.isAbsolute(config.coverFolderDir)) {
    config.coverFolderDir = path.join(__dirname, config.coverFolderDir);
  }
  if(!path.isAbsolute(config.databaseFolderDir)) {
    config.databaseFolderDir = path.join(__dirname, config.databaseFolderDir);
  }

  // Use ./covers and ./sqlite to override settings, ignoring corresponding fields in config
  if (config.coverUseDefaultPath) {
    config.coverFolderDir = path.join(__dirname, 'covers');
  }
  if (config.dbUseDefaultPath) {
    config.databaseFolderDir = path.join(__dirname, 'sqlite');
  }

  if (process.env.NODE_ENV === 'production' || config.production) {
    config.auth = true;
    config.production = true;
  }
};

const updateConfig = (writeConfigToFile = !process.env.FREEZE_CONFIG_FILE) => {
  let cfg = JSON.parse(fs.readFileSync(configPath));
  let countChanged = 0;
  for (let key in defaultConfig) {
    if (!cfg.hasOwnProperty(key)) {
      console.log('写入设置', key);
      cfg[key] = defaultConfig[key];
      countChanged += 1;
    }
  }
  if (countChanged || cfg.version !== pjson.version) {
    cfg.version = pjson.version;
    setConfig(cfg, writeConfigToFile)
  }
}

class publicConfig {
  get rewindSeekTime() {
    return config.rewindSeekTime;
  }
  get forwardSeekTime() {
    return config.forwardSeekTime;
  }
  export() {
    return {
      rewindSeekTime: this.rewindSeekTime,
      forwardSeekTime: this.forwardSeekTime
    }
  }
}

const sharedConfigHandle = new publicConfig();

// This part runs when the module is initialized
// TODO: refactor global side effect
if (!fs.existsSync(configPath)) {
  if (!fs.existsSync(configFolderDir)) {
    try {
      fs.mkdirSync(configFolderDir, { recursive: true });
    } catch(err) {
      console.error(` ! 在创建存放配置文件的文件夹时出错: ${err.message}`);
    }
  }
  const writeConfigToFile = !process.env.FREEZE_CONFIG_FILE;
  initConfig(writeConfigToFile);
} else {
  readConfig();
}

function getPageSize() {
  return config.pageSize || 12;
}

module.exports = {
  setConfig, updateConfig, config, sharedConfigHandle, configFolderDir, getPageSize
};
