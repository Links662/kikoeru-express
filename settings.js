const {
  config,
  runtimeDefaults,
  runtimeKeys,
  setRuntimeConfig,
  normalizeRootFolders
} = require('./config');

const SETTING_TABLE = 't_app_setting';
const ROOT_FOLDER_TABLE = 't_root_folder';
const ROOT_FOLDER_KEY = 'rootFolders';
const settingKeys = runtimeKeys.filter(key => key !== ROOT_FOLDER_KEY);

const getDatabaseKnex = () => require('./database/db').knex;

const decodeSetting = row => {
  try {
    return JSON.parse(row.value);
  } catch (err) {
    throw new Error(`运行时配置 ${row.key} 的 JSON 无效: ${err.message}`);
  }
};

const normalizeStoredRootFolders = rows => normalizeRootFolders(rows.map(row => ({
  id: row.id,
  name: String(row.name || '').trim(),
  path: String(row.path || '').trim(),
  maxRecursionDepth: row.max_recursion_depth
})));

const normalizeInputRootFolders = rootFolders => normalizeRootFolders(rootFolders).map(rootFolder => ({
  ...rootFolder,
  name: String(rootFolder.name || '').trim(),
  path: String(rootFolder.path || '').trim()
}));

const loadRuntimeSettings = async (knex = getDatabaseKnex()) => {
  const [settingRows, rootFolderRows] = await Promise.all([
    knex(SETTING_TABLE).select('key', 'value'),
    knex(ROOT_FOLDER_TABLE)
      .select('id', 'name', 'path', 'max_recursion_depth')
      .orderBy('id', 'asc')
  ]);

  const runtimeSettings = {};
  for (const key of settingKeys) {
    runtimeSettings[key] = runtimeDefaults[key];
  }
  for (const row of settingRows) {
    if (settingKeys.includes(row.key)) {
      runtimeSettings[row.key] = decodeSetting(row);
    }
  }
  runtimeSettings[ROOT_FOLDER_KEY] = normalizeStoredRootFolders(rootFolderRows);

  setRuntimeConfig(runtimeSettings);
  return config;
};

const saveRuntimeSettings = async (newSettings, knex = getDatabaseKnex()) => {
  const update = {};
  for (const key of settingKeys) {
    if (Object.prototype.hasOwnProperty.call(newSettings, key)) {
      update[key] = newSettings[key];
    }
  }

  const hasRootFolders = Object.prototype.hasOwnProperty.call(newSettings, ROOT_FOLDER_KEY);
  const rootFolders = hasRootFolders
    ? normalizeInputRootFolders(newSettings[ROOT_FOLDER_KEY])
    : null;

  let savedRootFolders = null;

  await knex.transaction(async trx => {
    for (const [key, value] of Object.entries(update)) {
      await trx(SETTING_TABLE)
        .insert({
          key,
          value: JSON.stringify(value),
          updated_at: trx.fn.now()
        })
        .onConflict('key')
        .merge(['value', 'updated_at']);
    }

    if (hasRootFolders) {
      const currentRootFolders = await trx(ROOT_FOLDER_TABLE).select('*');
      const usedIds = new Set();

      for (const rootFolder of rootFolders) {
        const existingRootFolder = rootFolder.id
          ? currentRootFolders.find(row => Number(row.id) === Number(rootFolder.id))
          : null;

        if (existingRootFolder) {
          const id = Number(existingRootFolder.id);
          usedIds.add(id);

          await trx(ROOT_FOLDER_TABLE)
            .where('id', '=', id)
            .update({
              name: rootFolder.name,
              path: rootFolder.path,
              max_recursion_depth: rootFolder.maxRecursionDepth
            });
        } else {
          const insertedIds = await trx(ROOT_FOLDER_TABLE).insert({
            name: rootFolder.name,
            path: rootFolder.path,
            max_recursion_depth: rootFolder.maxRecursionDepth
          });
          usedIds.add(Number(insertedIds[0]));
        }
      }

      const removedIds = currentRootFolders
        .map(row => Number(row.id))
        .filter(id => !usedIds.has(id));
      if (removedIds.length > 0) {
        await trx(ROOT_FOLDER_TABLE).whereIn('id', removedIds).del();
      }

      savedRootFolders = normalizeStoredRootFolders(
        await trx(ROOT_FOLDER_TABLE)
          .select('id', 'name', 'path', 'max_recursion_depth')
          .orderBy('id', 'asc')
      );
    }
  });

  const appliedSettings = { ...update };
  if (hasRootFolders) {
    appliedSettings[ROOT_FOLDER_KEY] = savedRootFolders;
  }
  setRuntimeConfig(appliedSettings);
  return config;
};

module.exports = {
  SETTING_TABLE,
  ROOT_FOLDER_TABLE,
  loadRuntimeSettings,
  saveRuntimeSettings
};
