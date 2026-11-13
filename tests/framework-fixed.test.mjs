import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import {localData} from './helpers/local-data.mjs';

const framework = await readFile(new URL('./fixtures/framework-fixed.js', import.meta.url), 'utf8');
const plugin = await readFile(new URL('../dist/monika.js', import.meta.url), 'utf8');

async function host(t) {
  const local=localData(t),recorder=local.service.recorder('usr_alt');
  recorder.observeSelf({id:'usr_alt',displayName:'Alt',location:'wrld_a:1',status:'active'},1000);
  recorder.observeSelf({id:'usr_alt',displayName:'Alt',location:'wrld_b:2',status:'busy'},2000);recorder.close(2500);
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE configs (key TEXT PRIMARY KEY,value TEXT)');
  const credentials = JSON.stringify({ usr_main: { user: { id: 'usr_main' }, cookies: 'primary-session' } });
  sql.prepare('INSERT INTO configs VALUES (?,?)').run('config:savedcredentials', credentials);
  const dom = new JSDOM('<div id="root"><aside data-slot="sidebar"><div data-slot="sidebar-content"><ul data-slot="sidebar-menu"></ul></div></aside><main><div>Native page</div></main></div>',
    { url: 'http://localhost/#/feed', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window, errors = [], requests = [], hooks = [], routes = [];
  w.addEventListener('error', event => { errors.push(event.error || event.message); });
  w.addEventListener('unhandledrejection', event => errors.push(event.reason));
  w.indexedDB = new IDBFactory(); w.structuredClone = structuredClone;
  w.AbortSignal.timeout = () => new w.AbortController().signal;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.Element.prototype.scrollIntoView = function() {};
  w.$pinia = { auth: { loginForm: { loading: false }, $subscribe: () => () => {} },
    user: { currentUser: { id: 'usr_main', displayName: 'Primary' }, $subscribe: () => () => {} },
    ui: { $subscribe: () => () => {} }, dialog: { $subscribe: () => () => {} }, advancedSettings: { enablePrimaryPassword: false } };
  const router = { currentRoute: { value: { name: 'feed', path: '/feed', fullPath: '/feed', params: {} } },
    getRoutes: () => [{ path: '/', components: { default: { name: 'MainLayout' } } }],
    hasRoute: () => routes.length > 0, addRoute: route => routes.push(route), afterEach: fn => { hooks.push(fn); return () => {}; },
    async push(target) { const from = this.currentRoute.value; this.currentRoute.value = { name: target.name,
      path: `/customjs/${target.params.pluginId}`, fullPath: `/customjs/${target.params.pluginId}`, params: target.params };
      w.location.hash = this.currentRoute.value.fullPath; hooks.forEach(fn => fn(this.currentRoute.value, from)); },
    async replace(path) { const from = this.currentRoute.value; this.currentRoute.value = { name: 'feed', path, fullPath: path, params: {} };
      w.location.hash = path; hooks.forEach(fn => fn(this.currentRoute.value, from)); } };
  w.document.getElementById('root').__vue_app__ = { config: { globalProperties: { $router: router } } };
  w.sqliteService = {
    async execute(callback, statement, args = {}) { for (const row of sql.prepare(statement).all(args || {})) callback(Object.values(row)); },
    async executeNonQuery(statement, args = {}) { return Number(sql.prepare(statement).run(args || {}).changes); },
    async executeInsert(statement, args = {}) { return Number(sql.prepare(statement).run(args || {}).lastInsertRowid); }
  };
  w.configRepository = { async getString(key, fallback) { return sql.prepare('SELECT value FROM configs WHERE key=?').get('config:' + key.toLowerCase())?.value ?? fallback; } };
  w.webApiService = { execute() { throw new Error('Monika used the primary transport'); } };
  w.fetch = async (input, options) => {
    const url = new URL(String(input)); requests.push({ url: url.href, options });
    assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '39123');
    assert(!url.pathname.endsWith('.js') && !url.pathname.includes('repository'), 'script import must remain local');
    const result=await local.api(url.pathname,options.body?JSON.parse(options.body):undefined,Object.fromEntries(url.searchParams));
    return { status: 200, async text() { return JSON.stringify(result); } };
  };
  w.console.log = () => {}; w.console.info = () => {}; w.console.warn = () => {};
  w.eval(framework);
  for (let attempt = 0; attempt < 100 && w.customjs.compatibility.stage === 'starting'; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(w.customjs.compatibility.stage, 'ready');
  t.after(async () => {
    for (const module of [...w.customjs.modules]) await module.unload();
    dom.window.close(); sql.close(); assert.deepEqual(errors, []);
  });
  return { w, sql, credentials, router, requests, hooks };
}

test('built Monika imports locally into the actual Fixed framework without adding router wrappers', async t => {
  const { w, sql, credentials, router, requests, hooks } = await host(t);
  const navigation = w.customjs.api.navigation;
  const update = navigation.updateContentVisibility, remove = navigation.removeItem, hookCount = hooks.length;
  const imported = await w.customjs.importLocalPlugin(new w.File([plugin], 'monika.js', { type: 'text/javascript' }));
  assert.equal(imported.success, true, imported.message); assert.equal(imported.module.started, true);
  assert.equal(imported.module.metadata.url, 'local:///monika.js');
  assert.equal(navigation.updateContentVisibility, update); assert.equal(navigation.removeItem, remove); assert.equal(hooks.length, hookCount);
  imported.module.show(); await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(router.currentRoute.value.params.pluginId, 'monika');
  assert.equal(sql.prepare('SELECT value FROM configs WHERE key=?').get('config:savedcredentials').value, credentials);
  assert(requests.length > 0 && requests.every(request => request.options.credentials === 'omit'));
  assert(requests.some(request=>new URL(request.url).pathname==='/native-ack'));
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM usralt_feed_gps').get().n,1);
  assert(!sql.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().some(row=>row.name.includes('monika')));
  const reloaded = await w.customjs.reloadModule('monika');
  assert.equal(reloaded.success, true, reloaded.message); assert.notEqual(reloaded.module, imported.module); assert.equal(reloaded.module.started, true);
  assert.equal(navigation.updateContentVisibility, update); assert.equal(hooks.length, hookCount);
  await w.customjs.removeLocalPlugin('local:///monika.js');
  assert.equal(w.customjs.getModule('monika'), undefined); assert.equal(router.currentRoute.value.path, '/feed');
});
