const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const configFolderDir = path.join(__dirname, 'config');
const configPath = path.join(configFolderDir, 'config.json');
const pjson = require('./package.json');

const versionWithoutVerTracking = '0.4.1';
const DEFAULT_MAX_RECURSION_DEPTH = 2;

const voiceWorkDefaultPath = () => {
  if (process.env.IS_DOCKER) {
    return '/usr/src/kikoeru/VoiceWork';
  }
  return path.join(__dirname, 'VoiceWork');
};

const clone = value => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
};

// These values are needed before SQLite can be opened or before the HTTP server starts.
const bootstrapDefaults = {
  version: pjson.version,
  production: process.env.NODE_ENV === 'production',
  dbBusyTimeout: 1000,
  coverFolderDir: path.join(__dirname, 'covers'),
  databaseFolderDir: path.join(__dirname, 'sqlite'),
  coverUseDefaultPath: false,
  dbUseDefaultPath: true,
  voiceWorkDefaultPath: voiceWorkDefaultPath(),
  auth: process.env.NODE_ENV === 'production',
  jwtsecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
  listenPort: 8888,
  blockRemoteConnection: false,
  behindProxy: false,
  httpsEnabled: false,
  httpsPrivateKey: 'kikoeru.key',
  httpsCert: 'kikoeru.crt',
  httpsPort: 8443,
  enableGzip: true,
  offloadMedia: false,
  offloadStreamPath: '/media/stream/',
  offloadDownloadPath: '/media/download/'
};

// Runtime settings are loaded from SQLite after the database is initialized.
const runtimeDefaults = {
  rootFolders: [],
  checkUpdate: true,
  checkBetaUpdate: false,
  maxParallelism: 16,
  pageSize: 12,
  listPageSize: 50,
  recentCount: 20,
  rewindSeekTime: 5,
  forwardSeekTime: 30,
  tagLanguage: 'zh-CN',
  retry: 5,
  dlsiteTimeout: 10000,
  hvdbTimeout: 10000,
  retryDelay: 2000,
  httpProxyHost: '',
  httpProxyPort: 0,
  skipCleanup: false,
  coverUpgradeIntervalDays: 7,
  coverUpgradeTypes: ['sam']
};

const bootstrapKeys = Object.keys(bootstrapDefaults);
const runtimeKeys = Object.keys(runtimeDefaults);

let config = {
  ...clone(bootstrapDefaults),
  ...clone(runtimeDefaults)
};

const normalizeMaxRecursionDepth = (value, fallback = DEFAULT_MAX_RECURSION_DEPTH) => {
  const depth = Number(value);
  return Number.isInteger(depth) && depth >= 1 ? depth : fallback;
};

const normalizeRootFolders = (rootFolders, fallbackDepth = DEFAULT_MAX_RECURSION_DEPTH) => {
  if (!Array.isArray(rootFolders)) return [];

  return rootFolders.map(rootFolder => ({
    ...rootFolder,
    maxRecursionDepth: normalizeMaxRecursionDepth(rootFolder.maxRecursionDepth, fallbackDepth)
  }));
};

const pick = (source, keys) => {
  const result = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      result[key] = clone(source[key]);
    }
  }
  return result;
};

const applyBootstrapRules = () => {
  if (!path.isAbsolute(config.coverFolderDir)) {
    config.coverFolderDir = path.join(__dirname, config.coverFolderDir);
  }
  if (!path.isAbsolute(config.databaseFolderDir)) {
    config.databaseFolderDir = path.join(__dirname, config.databaseFolderDir);
  }
  if (!path.isAbsolute(config.voiceWorkDefaultPath)) {
    config.voiceWorkDefaultPath = path.join(__dirname, config.voiceWorkDefaultPath);
  }
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

const getBootstrapConfig = () => pick(config, bootstrapKeys);

const writeConfigFile = () => {
  if (process.env.FREEZE_CONFIG_FILE) return;
  fs.writeFileSync(configPath, JSON.stringify(getBootstrapConfig(), null, '\t'));
};

const initConfig = () => {
  config = {
    ...clone(bootstrapDefaults),
    ...clone(runtimeDefaults)
  };
  applyBootstrapRules();
  writeConfigFile();
};

const readConfig = () => {
  const savedConfig = JSON.parse(fs.readFileSync(configPath));
  const loadedBootstrap = {};

  for (const key of bootstrapKeys) {
    loadedBootstrap[key] = Object.prototype.hasOwnProperty.call(savedConfig, key)
      ? savedConfig[key]
      : (key === 'version' ? versionWithoutVerTracking : clone(bootstrapDefaults[key]));
  }

  config = {
    ...clone(bootstrapDefaults),
    ...loadedBootstrap,
    ...clone(runtimeDefaults)
  };
  applyBootstrapRules();
};

const setBootstrapConfig = (newConfig, writeConfigToFile = !process.env.FREEZE_CONFIG_FILE) => {
  const update = pick(newConfig, bootstrapKeys);
  update.production = config.production;
  update.jwtsecret = config.jwtsecret;
  if (process.env.NODE_ENV === 'production' || config.production) {
    update.auth = true;
  }

  config = Object.assign(config, update);
  applyBootstrapRules();
  if (writeConfigToFile) writeConfigFile();
};

const setRuntimeConfig = (newConfig) => {
  const update = pick(newConfig, runtimeKeys);
  if (Object.prototype.hasOwnProperty.call(update, 'rootFolders')) {
    update.rootFolders = normalizeRootFolders(update.rootFolders);
  }
  config = Object.assign(config, update);
};

const getRuntimeConfig = () => pick(config, runtimeKeys);

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
    };
  }
}

const sharedConfigHandle = new publicConfig();

if (!fs.existsSync(configPath)) {
  if (!fs.existsSync(configFolderDir)) {
    fs.mkdirSync(configFolderDir, { recursive: true });
  }
  initConfig();
} else {
  readConfig();
}

function getPageSize() {
  return config.pageSize || runtimeDefaults.pageSize;
}

function getListPageSize() {
  return config.listPageSize || runtimeDefaults.listPageSize;
}

module.exports = {
  config,
  bootstrapDefaults,
  runtimeDefaults,
  bootstrapKeys,
  runtimeKeys,
  normalizeMaxRecursionDepth,
  normalizeRootFolders,
  setBootstrapConfig,
  setRuntimeConfig,
  getRuntimeConfig,
  sharedConfigHandle,
  getPageSize,
  getListPageSize
};
