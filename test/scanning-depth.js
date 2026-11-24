// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getFolderList } = require('../filesystem/utils');

const collectFolders = async (rootFolder) => {
  const folders = [];
  for await (const folder of getFolderList(rootFolder)) {
    folders.push(folder.id);
  }
  return folders.sort((left, right) => left - right);
};

describe('folder scanning depth', function () {
  let tempRoot;

  beforeEach(async function () {
    tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kikoeru-scan-depth-'));
    await fs.promises.mkdir(path.join(tempRoot, 'RJ100001'));
    await fs.promises.mkdir(path.join(tempRoot, 'level-1', 'RJ200002'), { recursive: true });
    await fs.promises.mkdir(path.join(tempRoot, 'level-1', 'level-2', 'RJ300003'), { recursive: true });
  });

  afterEach(async function () {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  });

  it('uses the recursion depth configured on each root folder', async function () {
    const shallowRoot = {
      id: 1,
      name: 'shallow',
      path: tempRoot,
      maxRecursionDepth: 2
    };
    const deepRoot = {
      id: 2,
      name: 'deep',
      path: tempRoot,
      maxRecursionDepth: 3
    };

    expect(await collectFolders(shallowRoot)).to.deep.equal([100001, 200002]);
    expect(await collectFolders(deepRoot)).to.deep.equal([100001, 200002, 300003]);
  });
});
