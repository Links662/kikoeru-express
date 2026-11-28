// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const path = require('path');

const { planMovedWorkRemap } = require('../filesystem/scanner/libraryScan');

describe('scan path remapping', function () {
  it('remaps a missing path only when there is exactly one candidate', function () {
    const rootFolders = [
      { id: 1, name: 'old-root', path: path.join('library', 'old') },
      { id: 2, name: 'new-root', path: path.join('library', 'new') }
    ];
    const works = [
      { id: 100001, root_folder_id: 1, dir: path.join('moved', 'RJ100001') },
      { id: 100002, root_folder_id: 1, dir: path.join('still-here', 'RJ100002') },
      { id: 100003, root_folder_id: 1, dir: path.join('duplicate', 'RJ100003') },
      { id: 100004, root_folder_id: 1, dir: path.join('deleted', 'RJ100004') }
    ];
    const folderList = [
      {
        id: 100001,
        rootFolderId: 2,
        rootFolderName: 'new-root',
        relativePath: path.join('archive', 'RJ100001'),
        absolutePath: path.join('library', 'new', 'archive', 'RJ100001')
      },
      {
        id: 100003,
        rootFolderId: 2,
        rootFolderName: 'new-root',
        relativePath: path.join('copy-a', 'RJ100003'),
        absolutePath: path.join('library', 'new', 'copy-a', 'RJ100003')
      },
      {
        id: 100003,
        rootFolderId: 2,
        rootFolderName: 'new-root',
        relativePath: path.join('copy-b', 'RJ100003'),
        absolutePath: path.join('library', 'new', 'copy-b', 'RJ100003')
      }
    ];
    const existingPath = path.join('library', 'old', 'still-here', 'RJ100002');

    const plan = planMovedWorkRemap({
      works,
      folderList,
      rootFolders,
      pathExists: candidate => candidate === existingPath
    });

    expect(plan.remaps).to.have.length(1);
    expect(plan.remaps[0].work.id).to.equal(100001);
    expect(plan.remaps[0].target.rootFolderId).to.equal(2);
    expect(plan.remaps[0].target.relativePath).to.equal(path.join('archive', 'RJ100001'));

    expect(plan.ambiguous).to.have.length(1);
    expect(plan.ambiguous[0].work.id).to.equal(100003);
  });
});
