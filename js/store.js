/*
 * Хранилище данных. Два варианта с одним интерфейсом:
 *  - LocalStore  — в браузере (для пробы, данные видны только на этом устройстве);
 *  - GitHubStore — JSON-файлы в репозитории GitHub через Contents API.
 */
(function (root) {
  'use strict';

  function b64enc(s) { return btoa(unescape(encodeURIComponent(s))); }
  function b64dec(s) { return decodeURIComponent(escape(atob(String(s).replace(/\s/g, '')))); }

  function LocalStore(ns) {
    this.kind = 'local';
    this.ns = ns || 'wbinv';
  }
  LocalStore.prototype.read = async function (path) {
    var v = localStorage.getItem(this.ns + ':' + path);
    return v ? JSON.parse(v) : null;
  };
  LocalStore.prototype.write = async function (path, obj) {
    localStorage.setItem(this.ns + ':' + path, JSON.stringify(obj));
  };
  LocalStore.prototype.remove = async function (path) {
    localStorage.removeItem(this.ns + ':' + path);
  };
  LocalStore.prototype.list = async function (dir) {
    var pre = this.ns + ':' + dir + '/';
    return Object.keys(localStorage).filter(function (k) { return k.indexOf(pre) === 0; })
      .map(function (k) { return k.slice(pre.length); });
  };

  function GitHubStore(cfg) {
    this.kind = 'github';
    this.owner = cfg.owner;
    this.repo = cfg.repo;
    this.branch = cfg.branch || '';
    this.token = cfg.token;
    this.shas = new Map();
  }
  GitHubStore.prototype.url = function (path) {
    var p = path.split('/').map(encodeURIComponent).join('/');
    return 'https://api.github.com/repos/' + encodeURIComponent(this.owner) + '/' + encodeURIComponent(this.repo) + '/contents/' + p;
  };
  GitHubStore.prototype.req = function (method, url, body) {
    var headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + this.token,
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  };
  GitHubStore.prototype.err = async function (res) {
    var msg = '';
    try { msg = (await res.json()).message || ''; } catch (e) { /* пустой ответ */ }
    if (res.status === 401) return new Error('GitHub не принял токен (401). Проверьте токен и срок его действия.');
    if (res.status === 403) return new Error('Нет прав на репозиторий или превышен лимит запросов (403). ' + msg);
    if (res.status === 404) return new Error('Репозиторий не найден или у токена нет к нему доступа (404).');
    return new Error('GitHub ' + res.status + (msg ? ': ' + msg : ''));
  };
  GitHubStore.prototype.ref = function () {
    return this.branch ? '?ref=' + encodeURIComponent(this.branch) : '';
  };
  GitHubStore.prototype.ping = async function () {
    var res = await this.req('GET', 'https://api.github.com/repos/' + encodeURIComponent(this.owner) + '/' + encodeURIComponent(this.repo));
    if (!res.ok) throw await this.err(res);
    var j = await res.json();
    return { canPush: !!(j.permissions && j.permissions.push), isPrivate: !!j.private, defaultBranch: j.default_branch };
  };
  GitHubStore.prototype.read = async function (path) {
    var res = await this.req('GET', this.url(path) + this.ref());
    if (res.status === 404) { this.shas.delete(path); return null; }
    if (!res.ok) throw await this.err(res);
    var j = await res.json();
    this.shas.set(path, j.sha);
    return JSON.parse(b64dec(j.content));
  };
  GitHubStore.prototype.write = async function (path, obj, message) {
    var content = b64enc(JSON.stringify(obj, null, 2));
    for (var attempt = 0; attempt < 2; attempt++) {
      var sha = this.shas.get(path);
      if (!sha) { await this.read(path); sha = this.shas.get(path); }
      var body = { message: message || ('Обновление ' + path), content: content };
      if (this.branch) body.branch = this.branch;
      if (sha) body.sha = sha;
      var res = await this.req('PUT', this.url(path), body);
      if (res.ok) {
        var j = await res.json();
        this.shas.set(path, j.content.sha);
        return;
      }
      if ((res.status === 409 || res.status === 422) && attempt === 0) { this.shas.delete(path); continue; }
      throw await this.err(res);
    }
  };
  GitHubStore.prototype.remove = async function (path, message) {
    var sha = this.shas.get(path);
    if (!sha) { await this.read(path); sha = this.shas.get(path); }
    if (!sha) return;
    var body = { message: message || ('Удаление ' + path), sha: sha };
    if (this.branch) body.branch = this.branch;
    var res = await this.req('DELETE', this.url(path), body);
    if (!res.ok && res.status !== 404) throw await this.err(res);
    this.shas.delete(path);
  };
  GitHubStore.prototype.list = async function (dir) {
    var res = await this.req('GET', this.url(dir) + this.ref());
    if (res.status === 404) return [];
    if (!res.ok) throw await this.err(res);
    var j = await res.json();
    return Array.isArray(j) ? j.filter(function (x) { return x.type === 'file'; }).map(function (x) { return x.name; }) : [];
  };

  root.Store = { LocalStore: LocalStore, GitHubStore: GitHubStore };
})(typeof self !== 'undefined' ? self : this);
