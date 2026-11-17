import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AtomicStore } from '../storage/store.mjs';
import { normalizeData } from '../shared/storage-schema.mjs';
import { loadBrowserData, saveBrowserData, DATA_KEY, BACKUP_KEY } from '../shared/browser-storage.mjs';

/** @param {string} name 路线名。 @returns {object} 独立的合法 v2 备份样本。 */
function fixture(name = '原有路线') {
  return {
    version: 2, timestamp: 1,
    folders: [{ id: '1', name: '已骑行', isExpanded: true }],
    routes: [{
      id: 'route-1', name, description: '', folderId: '1', color: '#ef4444', isVisible: true,
      points: [{ lat: 22, lon: 114, ele: 10 }, { lat: 22.01, lon: 114.01, ele: 20 }],
      stats: { distanceKm: 1.5, elevationGainM: 10, elevationLossM: 0, avgSlope: 1, maxSlope: 1, minSlope: 1 }
    }]
  };
}

/** @param {import('node:test').TestContext} t 测试上下文。 @returns {Promise<string>} 自动安全清理的独立数据目录。 */
async function temporaryDirectory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veloroute-storage-'));
  t.after(async () => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('veloroute-storage-'));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return dir;
}

/** 最小 Storage 适配器，用真实 JSON 数据测试迁移、容量错误与原子键替换。 */
class MemoryStorage {
  values = new Map();
  failPrimary = false;
  /** @param {string} key 键名。 @returns {string|null} 与 Web Storage 保持相同的缺省语义。 */
  getItem(key) { return this.values.get(key) ?? null; }
  /** @param {string} key 键名。 @param {string} value 值。 @returns {void} 可模拟主键写入失败。 */
  setItem(key, value) {
    // 使用带数字 code 的真实浏览器异常，验证中文反馈也兼容 DOMException 的字段语义。
    if (this.failPrimary && key === DATA_KEY) throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
    this.values.set(key, value);
  }
}

test('迁移无版本/v2 数据并保留中文、标识符和业务值', () => {
  const old = fixture();
  delete old.version;
  delete old.routes[0].stats.minSlope;
  const data = normalizeData(old);
  assert.equal(data.version, 3);
  assert.equal(data.routes[0].name, '原有路线');
  assert.equal(data.routes[0].folderId, '1');
  assert.equal(data.routes[0].stats.minSlope, 0);
  assert.match(data.folders[0].color, /^#[a-f0-9]{6}$/);
  assert.equal(data.settings.mapboxApiKey, '');
});

test('拒绝无效坐标、非有限统计、重复 ID、孤立路线和错误字段类型', () => {
  const mutations = [
    data => { data.routes[0].points[0].lat = 91; },
    data => { data.routes[0].points[0].ele = NaN; },
    data => { data.routes[0].stats.distanceKm = Infinity; },
    data => { data.folders.push({ ...data.folders[0] }); },
    data => { data.routes.push({ ...data.routes[0] }); },
    data => { data.routes[0].folderId = 'missing'; },
    data => { data.routes[0].isVisible = 'true'; },
    data => { data.settings = null; },
    data => { data.version = null; }
  ];
  for (const mutate of mutations) {
    const data = fixture();
    mutate(data);
    assert.throws(() => normalizeData(data));
  }
  assert.throws(() => normalizeData({ ...fixture(), version: 99 }), /版本较新/);
});

test('首次启动、串行写入和上一份有效快照备份', async t => {
  const dir = await temporaryDirectory(t);
  const store = new AtomicStore(path.join(dir, 'storage.json'));
  assert.equal((await store.load()).status, 'missing');
  const results = await Promise.all(['一', '二', '三'].map(name => store.save(fixture(name))));
  assert.ok(results.every(result => result.success));
  assert.equal(JSON.parse(await fs.readFile(store.file, 'utf8')).routes[0].name, '三');
  assert.equal(JSON.parse(await fs.readFile(store.backup, 'utf8')).routes[0].name, '二');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['storage.json', 'storage.json.bak']);
});

test('替换失败保留正式文件；失败队列可继续写入', async t => {
  const dir = await temporaryDirectory(t);
  const file = path.join(dir, 'storage.json');
  let fail = false;
  const io = { ...fs, rename: async (from, to) => {
    if (fail && to === file) throw new Error('模拟目标文件被占用');
    return fs.rename(from, to);
  } };
  const store = new AtomicStore(file, io);
  await store.load();
  await store.save(fixture('旧值'));
  const original = await fs.readFile(file, 'utf8');
  fail = true;
  assert.equal((await store.save(fixture('失败值'))).success, false);
  assert.equal(await fs.readFile(file, 'utf8'), original);
  assert.ok((await fs.readdir(dir)).every(name => !name.endsWith('.tmp')));
  fail = false;
  assert.equal((await store.save(fixture('重试值'))).success, true);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).routes[0].name, '重试值');
});

test('磁盘同步失败不替换正式文件', async t => {
  const dir = await temporaryDirectory(t);
  const file = path.join(dir, 'storage.json');
  await fs.writeFile(file, JSON.stringify(fixture()));
  const original = await fs.readFile(file, 'utf8');
  const store = new AtomicStore(file, { ...fs, open: async (...args) => {
    const handle = await fs.open(...args);
    return { writeFile: (...values) => handle.writeFile(...values), close: () => handle.close(), sync: async () => { throw new Error('模拟磁盘已满'); } };
  } });
  await store.load();
  assert.equal((await store.save(fixture('新值'))).success, false);
  assert.equal(await fs.readFile(file, 'utf8'), original);
  assert.ok((await fs.readdir(dir)).every(name => !name.endsWith('.tmp')));
});

test('损坏主文件从有效备份读取，保存前保护原文且不污染备份', async t => {
  const dir = await temporaryDirectory(t);
  const store = new AtomicStore(path.join(dir, 'storage.json'));
  await fs.writeFile(store.file, '{broken');
  await fs.writeFile(store.backup, JSON.stringify(fixture('备份路线')));
  const result = await store.load();
  assert.equal(result.status, 'recovered');
  assert.equal(result.data.routes[0].name, '备份路线');
  assert.equal(await fs.readFile(store.file, 'utf8'), '{broken');
  assert.equal((await store.save(fixture('恢复后的编辑'))).success, true);
  assert.equal(JSON.parse(await fs.readFile(store.backup, 'utf8')).routes[0].name, '备份路线');
  const preserved = (await fs.readdir(dir)).find(name => name.includes('.preserved-'));
  assert.equal(await fs.readFile(path.join(dir, preserved), 'utf8'), '{broken');
});

test('双份数据损坏时禁止自动保存，显式恢复保留原文件', async t => {
  const dir = await temporaryDirectory(t);
  const store = new AtomicStore(path.join(dir, 'storage.json'));
  await fs.writeFile(store.file, 'damaged');
  await fs.writeFile(store.backup, 'damaged-backup');
  assert.equal((await store.load()).status, 'error');
  assert.equal((await store.save(fixture())).success, false);
  assert.equal(await fs.readFile(store.file, 'utf8'), 'damaged');
  assert.equal((await store.save(fixture(), true)).success, true);
  assert.equal(JSON.parse(await fs.readFile(store.file, 'utf8')).version, 3);
  assert.equal(await fs.readFile(store.backup, 'utf8'), 'damaged-backup');
});

test('较新版本主文件不回退旧备份，不允许默认写入', async t => {
  const dir = await temporaryDirectory(t);
  const store = new AtomicStore(path.join(dir, 'storage.json'));
  const future = JSON.stringify({ ...fixture(), version: 99 });
  await fs.writeFile(store.file, future);
  await fs.writeFile(store.backup, JSON.stringify(fixture()));
  assert.match((await store.load()).error, /版本较新/);
  assert.equal((await store.save(fixture())).success, false);
  assert.equal(await fs.readFile(store.file, 'utf8'), future);
});

test('读取备份后主文件被外部更新为较新版本，仍拒绝自动覆盖', async t => {
  const dir = await temporaryDirectory(t);
  const store = new AtomicStore(path.join(dir, 'storage.json'));
  await fs.writeFile(store.file, '{broken');
  await fs.writeFile(store.backup, JSON.stringify(fixture()));
  assert.equal((await store.load()).status, 'recovered');
  const future = JSON.stringify({ ...fixture(), version: 99 });
  await fs.writeFile(store.file, future);
  assert.equal((await store.save(fixture())).success, false);
  assert.equal(await fs.readFile(store.file, 'utf8'), future);
});

test('非法备份在文件读写前被拒绝', async t => {
  const dir = await temporaryDirectory(t);
  const store = new AtomicStore(path.join(dir, 'storage.json'));
  await store.load();
  await store.save(fixture());
  const before = await fs.readFile(store.file, 'utf8');
  const invalid = fixture();
  invalid.routes[0].folderId = 'orphan';
  assert.equal((await store.save(invalid, true)).success, false);
  assert.equal(await fs.readFile(store.file, 'utf8'), before);
});

test('浏览器迁移旧三键，保留原键并写入单个完整快照', () => {
  const storage = new MemoryStorage();
  const data = fixture();
  storage.setItem('velo_folders', JSON.stringify(data.folders));
  storage.setItem('velo_routes', JSON.stringify(data.routes));
  const loaded = loadBrowserData(storage);
  assert.equal(loaded.needsMigration, true);
  assert.equal(saveBrowserData(storage, loaded.data).success, true);
  assert.equal(JSON.parse(storage.getItem(DATA_KEY)).version, 3);
  assert.equal(storage.getItem('velo_routes'), JSON.stringify(data.routes));
});

test('浏览器保存容量失败可重试，正式快照仍为原值', () => {
  const storage = new MemoryStorage();
  saveBrowserData(storage, fixture('旧值'));
  const original = storage.getItem(DATA_KEY);
  storage.failPrimary = true;
  const failed = saveBrowserData(storage, fixture('新值'));
  assert.equal(failed.success, false);
  assert.match(failed.error, /浏览器存储空间不足/);
  assert.equal(storage.getItem(DATA_KEY), original);
  assert.equal(storage.getItem(BACKUP_KEY), original);
  storage.failPrimary = false;
  assert.equal(saveBrowserData(storage, fixture('新值')).success, true);
});

test('浏览器损坏时不采用过期旧键，较新版本也不回退', () => {
  const storage = new MemoryStorage();
  storage.setItem('velo_folders', '[]');
  storage.setItem('velo_routes', '[]');
  storage.setItem(DATA_KEY, '{broken');
  assert.equal(loadBrowserData(storage).status, 'error');
  assert.equal(saveBrowserData(storage, fixture()).success, false);
  storage.setItem(BACKUP_KEY, JSON.stringify(fixture()));
  assert.equal(loadBrowserData(storage).status, 'recovered');
  assert.equal(saveBrowserData(storage, fixture()).success, true);
  assert.ok([...storage.values.keys()].some(key => key.startsWith('velo_data_preserved_')));
  storage.setItem(DATA_KEY, JSON.stringify({ ...fixture(), version: 99 }));
  assert.match(loadBrowserData(storage).error, /版本较新/);
});
