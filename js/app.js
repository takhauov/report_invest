/* Интерфейс: вкладки «Расчёт за месяц», «Товар инвестора», «Движение денег», «Справочник». */
(function () {
  'use strict';
  var C = window.Calc, S = window.Store;

  /* ---------- Утилиты ---------- */
  var $ = function (s, el) { return (el || document).querySelector(s); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  var nf2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  function fmt(n) { var r = Math.round(n || 0); if (r === 0) r = 0; return nf0.format(r); }
  function rub(n) { return fmt(n) + ' ₽'; }
  function pct(n) { return nf2.format((n || 0) * 100) + '%'; }
  function sgn(n) { return Math.round(n || 0) < 0 ? 'neg' : (Math.round(n || 0) > 0 ? 'pos' : ''); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function todayKey() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function nextKey(k) { var p = k.split('-').map(Number); return p[1] === 12 ? (p[0] + 1) + '-01' : p[0] + '-' + String(p[1] + 1).padStart(2, '0'); }
  function shortKey(k) { return k.slice(5) + '.' + k.slice(2, 4); }
  var ICON_DL = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16"/></svg>';
  var ICON_X = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  /* ---------- Состояние и настройки подключения ---------- */
  var CFG_KEY = 'wbinv.cfg', TOKEN_KEY = 'wbinv.token', SEL_KEY = 'wbinv.month';
  function loadCfg() {
    var c = {}, tok = '';
    try { c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch (e) { c = {}; }
    try { tok = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { tok = ''; }
    return {
      mode: c.mode === 'github' ? 'github' : 'local',
      owner: c.owner || '', repo: c.repo || '', branch: c.branch || 'main',
      role: c.role === 'investor' ? 'investor' : 'owner',
      remember: c.remember !== false, token: tok
    };
  }
  function saveCfg(cfg) {
    localStorage.setItem(CFG_KEY, JSON.stringify({ mode: cfg.mode, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, role: cfg.role, remember: cfg.remember }));
    localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY);
    if (cfg.token) (cfg.remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, cfg.token);
  }

  var state = { cfg: loadCfg(), store: null, data: null, L: null, tab: 'month', sel: '', loadError: '', busy: false };

  function makeStore(cfg) {
    if (cfg.mode === 'github' && cfg.token && cfg.owner && cfg.repo) return new S.GitHubStore(cfg);
    return new S.LocalStore('wbinv');
  }
  function isOwner() { return state.cfg.role === 'owner' && !state.loadError; }
  function canFlow() { return !state.loadError; }

  function emptyData() {
    return { settings: C.defaultSettings(), ledger: { batches: [], losses: [], corrections: [] }, flows: {}, months: {} };
  }

  async function loadAll() {
    state.loadError = '';
    var s = state.store;
    try {
      var r = await Promise.all([s.read('settings.json'), s.read('ledger.json'), s.read('flows.json'), s.list('months')]);
      var months = {};
      await Promise.all(r[3].filter(function (n) { return /^\d{4}-\d{2}\.json$/.test(n); }).map(async function (n) {
        var rec = await s.read('months/' + n);
        if (rec) months[n.slice(0, 7)] = rec;
      }));
      var d = emptyData();
      d.settings = Object.assign(d.settings, r[0] || {});
      if (!d.settings.mapping || !Object.keys(d.settings.mapping).length) d.settings.mapping = C.defaultMapping();
      var led = r[1] || {};
      d.ledger = { batches: led.batches || [], losses: led.losses || [], corrections: led.corrections || [] };
      d.flows = r[2] || {};
      d.months = months;
      state.data = d;
    } catch (e) {
      state.data = emptyData();
      state.loadError = e.message || String(e);
    }
  }

  var NOLOGIN_KEY = 'wbinv.nologin';
  async function fetchAccess() {
    if (typeof fetch !== 'function' || typeof Access === 'undefined') return null;
    try {
      var r = await fetch('access.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return null;
      var j = await r.json();
      return j && j.v === 1 && j.ct ? j : null;
    } catch (e) { return null; }
  }
  function openLogin(msg) {
    openDlg('<h2>Вход</h2><form data-form="login">' +
      '<div class="form-row"><div><label for="lgUser">Логин</label><input id="lgUser" name="login" autocomplete="username" autocapitalize="none" required></div>' +
      '<div><label for="lgPass">Пароль</label><input id="lgPass" name="password" type="password" autocomplete="current-password" required></div></div>' +
      '<div id="lgMsg" class="hint" role="status">' + (msg ? '<span class="neg">' + esc(msg) + '</span>' : '') + '</div>' +
      '<div class="dlg-actions"><button type="button" class="btn ghost" data-act="login-manual">Я владелец — подключить вручную</button><button type="submit" class="btn">Войти</button></div></form>');
    var u = $('#lgUser'); if (u) u.focus();
  }

  async function boot() {
    if (state.cfg.mode !== 'github' || !state.cfg.token) {
      var skip = false; try { skip = localStorage.getItem(NOLOGIN_KEY) === '1'; } catch (e) { skip = false; }
      if (!skip) {
        state.access = await fetchAccess();
        if (state.access) openLogin();
      }
    }
    state.store = makeStore(state.cfg);
    try { state.sel = localStorage.getItem(SEL_KEY) || ''; } catch (e) { state.sel = ''; }
    $('#view').innerHTML = '<div class="empty">Загружаю данные…</div>';
    await loadAll();
    if (!C.validKey(state.sel)) state.sel = '';
    render();
  }

  /* ---------- Сохранение ---------- */
  function setBusy(b) { state.busy = b; $('#view').classList.toggle('busy', b); }

  async function writeFiles(files, label) {
    var s = state.store, d = state.data;
    for (var i = 0; i < files.length; i++) {
      var f = files[i], kind = Array.isArray(f) ? f[0] : f, key = Array.isArray(f) ? f[1] : null;
      if (kind === 'settings') await s.write('settings.json', d.settings, label);
      else if (kind === 'ledger') await s.write('ledger.json', d.ledger, label);
      else if (kind === 'flow') {
        // Свежие данные с сервера + только изменённый месяц: владелец и инвестор не затирают друг друга
        var remote = (await s.read('flows.json')) || {};
        if (d.flows[key]) remote[key] = d.flows[key]; else delete remote[key];
        await s.write('flows.json', remote, label);
        d.flows = remote;
      } else if (kind === 'month') {
        if (d.months[key]) {
          var L = C.buildLedger(d), row = L.byKey[key];
          if (row && row.calc) {
            var t = row.calc.totals;
            d.months[key].totals = { revenue: t.revenue, gross: t.gross, net: t.net, cogs: t.cogs, sold: t.sold, cumProfit: row.cumProfit, savedAt: Date.now() };
          }
          await s.write('months/' + key + '.json', d.months[key], label);
        } else await s.remove('months/' + key + '.json', label);
      }
    }
  }

  async function mutate(fn, files, okMsg, commit) {
    var snap = JSON.stringify(state.data);
    setBusy(true);
    try {
      fn(state.data);
      await writeFiles(files, commit || okMsg);
      render();
      if (okMsg) toast(okMsg, 'ok');
      return true;
    } catch (e) {
      state.data = JSON.parse(snap);
      render();
      toast('Не удалось сохранить: ' + (e.message || e), 'err');
      return false;
    } finally { setBusy(false); }
  }

  function toast(msg, type) {
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    $('#toast').appendChild(el);
    setTimeout(function () { el.remove(); }, type === 'err' ? 7000 : 3500);
  }

  /* ---------- Диалоги ---------- */
  function openDlg(html) {
    var d = $('#dlg');
    d.innerHTML = html;
    if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
  }
  function closeDlg() {
    var d = $('#dlg');
    if (typeof d.close === 'function') { if (d.open) d.close(); } else d.removeAttribute('open');
    d.innerHTML = '';
    createCtx = null;
  }

  /* ---------- Отрисовка каркаса ---------- */
  var TABS = [['month', 'Расчёт за месяц'], ['goods', 'Товар инвестора'], ['cash', 'Движение денег'], ['dir', 'Справочник']];

  function render() {
    state.L = C.buildLedger(state.data);
    var keys = state.L.keys;
    if (!state.sel && keys.length) state.sel = keys[keys.length - 1];
    renderHeader();
    renderTabs();
    renderToolbar();
    var ae = document.activeElement, keep = ae && ae.getAttribute && ae.hasAttribute('data-cell') ? [ae.getAttribute('data-key'), ae.getAttribute('data-field')] : null;
    var v = state.tab === 'goods' ? viewGoods() : state.tab === 'cash' ? viewCash() : state.tab === 'dir' ? viewDir() : viewMonth();
    $('#view').innerHTML = (state.loadError ? '<div class="note err"><b>Данные не загружены.</b> ' + esc(state.loadError) + ' Редактирование отключено, чтобы не затереть сохранённое. Проверьте «Подключение» и нажмите «Обновить».</div>' : '') + v;
    if (keep) { var nf = document.querySelector('[data-cell][data-key="' + keep[0] + '"][data-field="' + keep[1] + '"]'); if (nf && !nf.disabled) nf.focus(); }
  }

  function renderHeader() {
    var c = state.cfg, dot = $('#statusPill .dot'), txt = $('#statusText');
    if (state.loadError) { dot.className = 'dot err'; txt.textContent = 'Нет связи с GitHub'; }
    else if (state.store.kind === 'github') { dot.className = 'dot ok'; txt.textContent = 'GitHub: ' + c.owner + '/' + c.repo; }
    else { dot.className = 'dot warn'; txt.textContent = 'Локальный режим (только этот браузер)'; }
    $('#rolePill').textContent = c.role === 'owner' ? 'Роль: владелец' : 'Роль: инвестор';
    var lo = $('#btnLogout'); if (lo) lo.hidden = !(c.mode === 'github' && c.role === 'investor');
  }

  function renderTabs() {
    $('#tabs').innerHTML = TABS.map(function (t) {
      return '<button class="tab" role="tab" type="button" data-act="tab" data-tab="' + t[0] + '" aria-selected="' + (state.tab === t[0]) + '">' + t[1] + '</button>';
    }).join('');
  }

  function renderToolbar() {
    var keys = state.L.keys.slice().reverse();
    if (state.sel && keys.indexOf(state.sel) < 0) keys.unshift(state.sel);
    var opts = keys.map(function (k) { return '<option value="' + k + '"' + (k === state.sel ? ' selected' : '') + '>' + esc(C.monthLabel(k)) + '</option>'; }).join('');
    $('#toolbar').innerHTML =
      '<div><label for="selMonth">Месяц</label><select id="selMonth" data-change="sel" style="min-width:200px">' + (opts || '<option value="">— нет данных —</option>') + '</select></div>' +
      '<div><label for="selInput">Другой месяц</label><input id="selInput" type="month" data-change="selInput" value="' + (state.sel || '') + '"></div>' +
      '<div class="grow"></div>' +
      (isOwner() ? '<button class="btn" type="button" data-act="create">Создать расчёт</button>' : '');
  }

  /* ---------- Общие блоки ---------- */
  function kpi(label, value, cls, size, sub) {
    return '<div class="card kpi ' + (size || '') + '"><span class="k">' + label + '</span><span class="v ' + (cls || '') + '">' + value + '</span>' + (sub ? '<span class="s">' + sub + '</span>' : '') + '</div>';
  }
  function knownProducts() {
    var set = new Set(Object.values(state.data.settings.mapping || {}));
    state.data.ledger.batches.forEach(function (b) { set.add(b.product); });
    return Array.from(set).sort(function (a, b) { return a.localeCompare(b, 'ru'); });
  }
  function productsDatalist() {
    return '<datalist id="productsList">' + knownProducts().map(function (p) { return '<option value="' + esc(p) + '">'; }).join('') + '</datalist>';
  }
  function dis() { return isOwner() ? '' : ' disabled'; }

  /* ---------- Вкладка 1: расчёт за месяц ---------- */
  function viewMonth() {
    var key = state.sel, rec = key && state.data.months[key];
    if (!rec) {
      return '<div class="card empty"><h2>' + (key ? 'Расчёта за ' + esc(C.monthLabel(key)) + ' пока нет' : 'Здесь появятся расчёты по месяцам') + '</h2>' +
        '<p>Загрузите отчёты WB, Яндекс Маркета и Ozon — расчёт по артикулам, остатки и движение денег посчитаются сами.</p>' +
        (isOwner() ? '<button class="btn" type="button" data-act="create">Создать расчёт</button>' : '<p>Расчёт создаёт владелец.</p>') + '</div>';
    }
    var row = state.L.byKey[key], calc = row.calc, t = calc.totals, h = '';

    if (calc.noStock && calc.noStock.length) h += '<div class="note warn"><b>Не учтены в продажах, нет в наличии у инвестора:</b> ' + calc.noStock.map(function (x) { return esc(x.product) + ' (по доле ' + fmt(x.sold) + ' шт)'; }).join(', ') + '. Продажи считаются только по товарам, которые есть на складе инвестора. Если товар был, проверьте закупки и статус «на складе».</div>';
    if (calc.capped && calc.capped.length) h += '<div class="note warn"><b>Продажи ограничены остатком на складе:</b> ' + calc.capped.map(function (x) { return esc(x.product) + ' — по доле ' + fmt(x.raw) + ' шт, учтено ' + fmt(x.sold) + ' шт'; }).join('; ') + '. Проверьте закупки: возможно, не внесена новая партия.</div>';
    if (calc.missingCost.length) h += '<div class="note warn"><b>Нет себестоимости:</b> ' + calc.missingCost.map(esc).join(', ') + '. Пока она считается как 0 — добавьте закупку на вкладке «Товар инвестора», иначе движение денег будет занижено.</div>';
    if (!rec.pctFound) h += '<div class="note warn"><b>Проценты расходов и фулфилмента взяты не из отчётов</b> (нужный месяц не нашёлся на листе ОПиУ). Проверьте значения ниже и нажмите «Пересчитать».</div>';
    if (calc.unmapped.length) {
      h += '<div class="note info"><b>Не учтено артикулов с продажами: ' + calc.unmapped.length + '</b> (аксессуары и прочее, что не входит в товар инвестора). Чтобы учитывать — сопоставьте их на вкладке «Справочник».</div>';
    }

    h += '<section class="bento">' +
      kpi('Чистая прибыль за месяц', rub(t.net), sgn(t.net), 'wide', 'после расходов (ФОТ, налоги, прочее) и фулфилмента') +
      kpi('Выручка', rub(t.revenue)) +
      kpi('Валовая прибыль', rub(t.gross), sgn(t.gross)) +
      kpi('Прибыль накопленным итогом', rub(row.cumProfit), sgn(row.cumProfit)) +
      kpi('Продано, шт', fmt(t.sold), '', '', 'доля инвестора ' + C.formatShare(calc.share) + ' от продаж') +
      kpi('Средняя прибыль на единицу', rub(t.avgProfit), sgn(t.avgProfit), '', 'по всем кабинетам, взвешено по продажам') +
      kpi('Расходы и фулфилмент', pct(rec.fotPct + rec.fulfillPct), '', '', rub(t.fot + t.fulfill) + ' от выручки') +
      '</section>';

    h += '<div class="card"><h2>Расчёт по товарам · ' + esc(C.monthLabel(key)) + '</h2><div class="tbl-wrap"><table><thead><tr>' +
      '<th>Товар</th><th>Закуп, ₽/шт</th><th>Продано, шт</th><th>Цена (средняя), ₽</th><th>Прибыль/ед (средняя), ₽</th><th>Выручка, ₽</th><th>Вал. прибыль, ₽</th><th>Фулфилмент, ₽</th><th>Расходы, ₽</th><th>Чистая прибыль, ₽</th></tr></thead><tbody>';
    calc.products.forEach(function (p) {
      h += '<tr><td>' + esc(p.product) + '</td><td>' + (p.cost == null ? '—' : fmt(p.cost)) + '</td><td>' + fmt(p.sold) + '</td><td>' + fmt(p.price) + '</td><td class="' + sgn(p.profitUnit) + '">' + fmt(p.profitUnit) + '</td>' +
        '<td>' + fmt(p.revenue) + '</td><td class="' + sgn(p.gross) + '">' + fmt(p.gross) + '</td><td>' + fmt(p.fulfill) + '</td><td>' + fmt(p.fot) + '</td><td class="' + sgn(p.net) + '">' + fmt(p.net) + '</td></tr>';
    });
    h += '<tr class="total"><td>Итого</td><td></td><td>' + fmt(t.sold) + '</td><td></td><td></td><td>' + fmt(t.revenue) + '</td><td class="' + sgn(t.gross) + '">' + fmt(t.gross) + '</td><td>' + fmt(t.fulfill) + '</td><td>' + fmt(t.fot) + '</td><td class="' + sgn(t.net) + '">' + fmt(t.net) + '</td></tr>';
    h += '</tbody></table></div><p class="hint">Продано = ' + C.formatShare(calc.share) + ' органических продаж по всем отчётам, округлено вверх. Цена и прибыль на единицу — средние по всем кабинетам и маркетплейсам, взвешенные по продажам.' + (rec.recalcAt ? ' Пересчитан ' + new Date(rec.recalcAt).toLocaleDateString('ru-RU') + '.' : '') + '</p></div>';

    // Откуда взялись данные
    var srcs = C.recSources(rec);
    h += '<div class="card"><h2>Отчёты за месяц</h2><div class="tbl-wrap"><table><thead><tr><th>Маркетплейс</th><th class="left">Кабинет</th><th class="left">Файл</th><th>Артикулов</th><th>Расходы, % от реализации</th><th>Фулфилмент</th><th></th></tr></thead><tbody>' +
      srcs.map(function (s) {
        return '<tr><td>' + esc(C.MARKET_LABEL[s.marketplace] || s.marketplace) + '</td><td class="left">' + esc(s.entity || '—') + '</td><td class="left">' + (s.fromService ? 'Сервис' + (s.final === false ? ' · <b style="color:var(--warn)">предварительно</b>' : '') + (s.generatedAt ? ' · ' + esc(String(s.generatedAt).slice(0, 10)) : '') : esc(s.file || '—')) + '</td><td>' + fmt((s.articles || []).length) + '</td>' +
          '<td>' + (s.amounts && s.amounts.base ? pct(s.amounts.fot / s.amounts.base) : '—') + '</td><td>' + (s.amounts && s.amounts.base ? pct(s.amounts.fulfill / s.amounts.base) : '—') + '</td>' +
          '<td>' + (isOwner() ? '<button class="btn ghost sm" type="button" data-act="del-source" data-id="' + esc(s.id) + '" aria-label="Убрать отчёт">' + ICON_X + '</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (srcs.some(function (s) { return s.fromService && s.final === false; }) ? '<div class="note warn" style="margin-top:12px">Часть данных предварительная: сервис ещё не закрыл этот месяц, цифры могут измениться. Обновите их кнопкой «Создать расчёт» → «Загрузить из сервиса» позже.</div>' : '') +
      '<p class="hint">Общие проценты = сумма расходов по всем отчётам ÷ сумма их «Реализации до СПП». Новый файл того же кабинета заменяет прежний, остальные остаются.</p></div>';

    // Как получена средняя прибыль
    h += '<details class="card"><summary style="cursor:pointer;font-weight:600;min-height:32px">Как получены средние цена и прибыль на единицу</summary><div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Товар / артикул</th><th>Маркетплейс</th><th class="left">Кабинет</th><th>Продаж (орг.)</th><th>Цена, ₽</th><th>Прибыль/ед, ₽</th></tr></thead><tbody>' +
      calc.products.map(function (p) {
        return '<tr class="section"><td colspan="6">' + esc(p.product) + ' — в среднем: цена ' + fmt(p.price) + ' ₽, прибыль ' + fmt(p.profitUnit) + ' ₽ на единицу, всего продаж ' + fmt(p.orgSales) + '</td></tr>' +
          p.rows.map(function (r) {
            return '<tr><td class="left">' + esc(r.article) + '</td><td>' + esc(C.MARKET_LABEL[r.marketplace] || r.marketplace) + '</td><td class="left">' + esc(r.entity || '—') + '</td><td>' + fmt(r.orgSales) + '</td><td>' + fmt(r.price) + '</td><td class="' + sgn(r.profitUnit) + '">' + fmt(r.profitUnit) + '</td></tr>';
          }).join('');
      }).join('') + '</tbody></table></div><p class="hint">Среднее = Σ(значение × продажи) ÷ Σ продаж, считаются только артикулы с положительными продажами.</p></details>';

    h += '<div class="card no-print"><h2>Пересчёт</h2><div class="form-row" style="margin-top:0">' +
      '<div><label for="shareInp">Доля продаж инвестора</label><input id="shareInp" type="text" value="' + esc(C.formatShare(calc.share)) + '" placeholder="1/3"' + dis() + '></div>' +
      '<div><label for="fotPct">Расходы (ФОТ, налоги, прочее), % от выручки</label><input id="fotPct" type="number" step="0.01" min="0" value="' + (Math.round(rec.fotPct * 10000) / 100) + '"' + dis() + '></div>' +
      '<div><label for="fulPct">Услуги фулфилмента, % от выручки</label><input id="fulPct" type="number" step="0.01" min="0" value="' + (Math.round(rec.fulfillPct * 10000) / 100) + '"' + dis() + '></div>' +
      '<div><button class="btn" type="button" data-act="recalc"' + dis() + '>Пересчитать</button></div></div>' +
      '<div class="toolbar" style="margin:16px 0 0">' +
      '<button class="btn ghost sm" type="button" data-act="replace"' + dis() + '>Добавить или заменить отчёты</button>' +
      '<button class="btn ghost sm" type="button" data-act="csv-month">' + ICON_DL + 'CSV</button>' +
      '<button class="btn ghost sm" type="button" data-act="print">Печать / PDF</button>' +
      '<div class="grow"></div>' +
      '<button class="btn danger sm" type="button" data-act="delete-month"' + dis() + '>Удалить расчёт</button></div>' +
      '<p class="hint">«Пересчитать» применяет текущие проценты, справочник товаров и себестоимость к сохранённым данным отчёта. Если в WB-отчёте что-то изменилось — загрузите его заново.</p></div>';
    return h;
  }

  /* ---------- Вкладка 2: товар инвестора ---------- */
  function viewGoods() {
    var key = state.sel || todayKey(), d = state.data, mg = C.moneyInGoods(d, key);
    var h = productsDatalist();
    var shortKeys = Object.keys(mg.short);
    if (shortKeys.length) h += '<div class="note warn"><b>Продано или списано больше, чем есть на складе:</b> ' + shortKeys.map(function (p) { return esc(p) + ' — ' + fmt(mg.short[p]) + ' шт'; }).join('; ') + '. Проверьте закупки и статусы партий (в пути / на складе).</div>';

    h += '<section class="bento">' +
      kpi('Деньги в товаре', rub(mg.total), '', 'wide', 'на конец ' + esc(C.monthLabel(key)).toLowerCase()) +
      kpi('На складе', rub(mg.totalWarehouse)) + kpi('В пути', rub(mg.totalTransit)) + '</section>';

    var batchRow = function (x) {
      var b = x.batch;
      var st = isOwner()
        ? '<select data-change="batch-status" data-id="' + esc(b.id) + '" aria-label="Статус партии"><option value="склад"' + (b.status === 'склад' ? ' selected' : '') + '>на складе</option><option value="путь"' + (b.status === 'путь' ? ' selected' : '') + '>в пути</option></select>'
        : esc(b.status === 'путь' ? 'в пути' : 'на складе');
      return '<tr><td>' + esc(b.product) + '</td><td>' + esc(C.monthLabel(b.month)) + (b.opening ? ' <span class="hint">(нач. остаток)</span>' : '') + '</td><td>' + fmt(b.cost) + '</td><td>' + fmt(x.qty) + '</td><td>' + fmt(x.value) + '</td><td>' + st + '</td>' +
        '<td>' + (isOwner() ? '<button class="btn ghost sm" type="button" data-act="del-batch" data-id="' + esc(b.id) + '" aria-label="Удалить партию">' + ICON_X + '</button>' : '') + '</td></tr>';
    };
    h += '<div class="card"><h2>Деньги в товаре</h2><div class="tbl-wrap"><table><thead><tr><th>Товар</th><th>Закуплено</th><th>Руб/шт</th><th>Шт</th><th>Руб</th><th>Статус</th><th></th></tr></thead><tbody>' +
      '<tr class="section"><td colspan="7">Товары на складе</td></tr>' +
      (mg.warehouse.length ? mg.warehouse.map(batchRow).join('') : '<tr><td colspan="7" class="left">На складе ничего нет</td></tr>') +
      '<tr class="section"><td colspan="7">Товары в пути</td></tr>' +
      (mg.transit.length ? mg.transit.map(batchRow).join('') : '<tr><td colspan="7" class="left">Ничего в пути</td></tr>') +
      '<tr class="total"><td>ИТОГО</td><td></td><td></td><td></td><td>' + fmt(mg.total) + '</td><td></td><td></td></tr></tbody></table></div>' +
      '<p class="hint">Остаток считается по порядку закупок: сначала списываются самые ранние партии. Товар «в пути» в продажи не попадает, пока вы не переведёте его «на склад».</p></div>';

    // Движение остатков за месяц: проданное списывается автоматически
    var mv = C.stockMovement(d, key);
    h += '<div class="card"><h2>Движение остатков, шт · ' + esc(C.monthLabel(key)) + '</h2>' +
      (mv.length ? '<div class="tbl-wrap"><table><thead><tr><th>Товар</th><th>Было</th><th>Закуплено</th><th>Продано</th><th>Потеряно</th><th>Осталось</th></tr></thead><tbody>' +
        mv.map(function (r) {
          return '<tr><td>' + esc(r.product) + '</td><td>' + fmt(r.open) + '</td><td>' + (r.incoming ? '+' + fmt(r.incoming) : '0') + '</td><td>' + (r.sold ? '−' + fmt(r.sold) : '0') + '</td><td>' + (r.lost ? '−' + fmt(r.lost) : '0') + '</td><td><b>' + fmt(r.close) + '</b>' + (r.short ? ' <span class="neg" title="Не хватило товара на складе">(не хватает ' + fmt(r.short) + ')</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="hint">За этот месяц движения товара нет.</p>') +
      '<p class="hint">Проданное количество берётся из расчёта месяца и списывается со склада автоматически (сначала самые ранние партии). Потери списываются так же. Товар «в пути» не считается остатком на складе.</p></div>';

    // Закупка
    h += '<div class="card"><h2>Новая закупка</h2><form data-form="purchase"><div class="form-row" style="margin-top:0">' +
      '<div><label for="pName">Товар</label><input id="pName" name="product" list="productsList" required autocomplete="off"' + dis() + '></div>' +
      '<div><label for="pCost">Себестоимость, ₽/шт</label><input id="pCost" name="cost" type="number" step="0.01" min="0" required' + dis() + '></div>' +
      '<div><label for="pQty">Количество, шт</label><input id="pQty" name="qty" type="number" step="1" min="1" required' + dis() + '></div>' +
      '<div><label for="pMonth">Месяц закупа</label><input id="pMonth" name="month" type="month" value="' + key + '" required' + dis() + '></div>' +
      '<div><label for="pStatus">Статус</label><select id="pStatus" name="status"' + dis() + '><option value="склад">на складе</option><option value="путь">в пути</option></select></div>' +
      '<div style="grid-column: 1 / -1"><label style="display:flex;gap:8px;align-items:center;min-height:32px;font-weight:400"><input type="checkbox" name="opening" style="width:auto;min-height:0"' + dis() + '> Начальный остаток: товар уже был у инвестора, деньги за него не списываются (месяц укажите на один раньше первого расчётного, например 08.2026)</label></div>' +
      '<div><button class="btn" type="submit"' + dis() + '>Добавить</button></div></div></form></div>';

    // Потери
    var losses = d.ledger.losses.filter(function (l) { return l.month === key; });
    h += '<div class="card"><h2>Потеря товара · ' + esc(C.monthLabel(key)) + '</h2>' +
      (losses.length ? '<div class="tbl-wrap"><table><thead><tr><th>Товар</th><th>Шт</th><th>Руб/шт</th><th>Руб</th><th class="left">Комментарий</th><th></th></tr></thead><tbody>' +
        state.L.byKey[key].lossLines.map(function (x) {
          return '<tr><td>' + esc(x.loss.product) + '</td><td>' + fmt(x.loss.qty) + '</td><td>' + fmt(x.cost) + '</td><td>' + fmt(x.value) + '</td><td class="left">' + esc(x.loss.comment || '') + '</td>' +
            '<td>' + (isOwner() ? '<button class="btn ghost sm" type="button" data-act="del-loss" data-id="' + esc(x.loss.id) + '" aria-label="Удалить потерю">' + ICON_X + '</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="hint">В этом месяце потерь нет.</p>') +
      '<form data-form="loss"><div class="form-row">' +
      '<div><label for="lName">Товар</label><input id="lName" name="product" list="productsList" required autocomplete="off"' + dis() + '></div>' +
      '<div><label for="lQty">Количество, шт</label><input id="lQty" name="qty" type="number" step="1" min="1" required' + dis() + '></div>' +
      '<div><label for="lComment">Комментарий</label><input id="lComment" name="comment" placeholder="Что случилось"' + dis() + '></div>' +
      '<div><label for="lMonth">Месяц</label><input id="lMonth" name="month" type="month" value="' + key + '" required' + dis() + '></div>' +
      '<div><button class="btn" type="submit"' + dis() + '>Списать</button></div></div></form>' +
      '<p class="hint">Потеря списывается по последней известной себестоимости товара и уменьшает остаток на складе.</p></div>';

    // Корректировки
    var corr = d.ledger.corrections.filter(function (c) { return c.month === key; });
    var batchOpts = C.sortBatches(d.ledger.batches).map(function (b) {
      return '<option value="' + esc(b.id) + '">' + esc(b.product) + ' · ' + esc(C.monthLabel(b.month)) + ' · ' + fmt(b.cost) + ' ₽ × ' + fmt(b.qty) + ' шт</option>';
    }).join('');
    h += '<div class="card"><h2>Корректировки закупа · ' + esc(C.monthLabel(key)) + '</h2>' +
      (corr.length ? '<div class="tbl-wrap"><table><thead><tr><th>Описание</th><th>Руб</th><th></th></tr></thead><tbody>' + corr.map(function (c) {
        var label = c.kind === 'batch' ? 'Корректировка закупа: ' + esc(c.product) + ' (' + fmt(c.oldCost) + ' → ' + fmt(c.newCost) + ' ₽ × ' + fmt(c.qty) + ' шт)' : esc(c.comment || 'Корректировка');
        return '<tr><td>' + label + '</td><td class="' + sgn(c.amount) + '">' + fmt(c.amount) + '</td><td>' +
          (isOwner() && c.kind !== 'batch' ? '<button class="btn ghost sm" type="button" data-act="del-corr" data-id="' + esc(c.id) + '" aria-label="Удалить корректировку">' + ICON_X + '</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="hint">Корректировок в этом месяце нет.</p>') +
      '<h3>Изменилась себестоимость партии</h3><form data-form="corr-batch"><div class="form-row" style="margin-top:0">' +
      '<div style="grid-column: span 2"><label for="kBatch">Партия</label><select id="kBatch" name="batch" required' + dis() + '><option value="">— выберите —</option>' + batchOpts + '</select></div>' +
      '<div><label for="kCost">Новая себестоимость, ₽/шт</label><input id="kCost" name="cost" type="number" step="0.01" min="0" required' + dis() + '></div>' +
      '<div><label for="kMonth">Месяц</label><input id="kMonth" name="month" type="month" value="' + key + '" required' + dis() + '></div>' +
      '<div><button class="btn" type="submit"' + dis() + '>Применить</button></div></div></form>' +
      '<p class="hint">Сумма = (старая − новая себестоимость) × количество в партии. Если себестоимость выросла, сальдо уменьшится.</p>' +
      '<h3>Произвольная корректировка</h3><form data-form="corr-manual"><div class="form-row" style="margin-top:0">' +
      '<div style="grid-column: span 2"><label for="mComment">Описание</label><input id="mComment" name="comment" required' + dis() + '></div>' +
      '<div><label for="mAmount">Сумма, ₽ (− списание, + возврат)</label><input id="mAmount" name="amount" type="number" step="0.01" required' + dis() + '></div>' +
      '<div><label for="mMonth">Месяц</label><input id="mMonth" name="month" type="month" value="' + key + '" required' + dis() + '></div>' +
      '<div><button class="btn" type="submit"' + dis() + '>Добавить</button></div></div></form></div>';
    return h;
  }

  /* ---------- Вкладка 3: движение денежных средств (таблица) ---------- */
  var cashOpen = {}, extraMonths = [];

  function cashKeys() {
    var s = new Set(state.L.keys);
    extraMonths.forEach(function (k) { s.add(k); });
    if (state.sel) s.add(state.sel);
    return Array.from(s).filter(C.validKey).sort();
  }

  // Подстроки (разбивка по товарам) для раскрывающихся статей
  function cashDetails(id, keys) {
    var L = state.L, order = [], cells = {};
    var put = function (label, k, v) {
      if (!cells[label]) { cells[label] = {}; order.push(label); }
      cells[label][k] = (cells[label][k] || 0) + v;
    };
    keys.forEach(function (k) {
      var r = L.byKey[k]; if (!r) return;
      if (id === 'cogs' && r.calc) r.calc.products.forEach(function (p) { if (p.cogs) put(p.product + ', ' + fmt(p.sold) + ' шт', k, p.cogs); });
      if (id === 'net' && r.calc) r.calc.products.forEach(function (p) { put(p.product, k, p.net); });
      if (id === 'loss') r.lossLines.forEach(function (x) { put(x.loss.product + (x.loss.comment ? ' (' + x.loss.comment + ')' : ''), k, -x.value); });
      if (id === 'buy') r.purchaseLines.forEach(function (x) { put(x.batch.product + (x.batch.status === 'путь' ? ' (в пути)' : ''), k, -x.value); });
      if (id === 'corr') r.corrLines.forEach(function (c) { put(c.kind === 'batch' ? 'Корректировка закупа: ' + c.product : (c.comment || 'Корректировка'), k, c.amount); });
    });
    return order.map(function (label) { return { label: label, cells: cells[label] }; });
  }

  function cashRows() {
    return [
      { id: 'start', label: 'Входящий остаток (сальдо)', get: function (r) { return r.start; }, cls: 'main' },
      { id: 'cogs', label: 'Проданный товар (себестоимость)', get: function (r) { return r.cogs; }, signed: true, detail: true },
      { id: 'net', label: 'Чистая прибыль', get: function (r) { return r.net; }, signed: true, detail: true },
      { id: 'loss', label: 'Сгоревший товар', get: function (r) { return -r.lossValue; }, signed: true, detail: true },
      { id: 'buy', label: 'Новые закупки товара', get: function (r) { return -r.purchases; }, signed: true, detail: true },
      { id: 'corr', label: 'Корректировки стоимости закупок', get: function (r) { return r.corrSum; }, signed: true, detail: true },
      { id: 'in', label: 'Внесение денежных средств', edit: 'in' },
      { id: 'out', label: 'Вывод денежных средств', edit: 'out' },
      { id: 'end', label: 'Исходящий остаток (сальдо)', get: function (r) { return r.end; }, cls: 'end' },
      { id: 'cum', label: 'Чистая прибыль накопленным итогом', get: function (r) { return r.cumProfit; }, signed: true, cls: 'cum' }
    ];
  }

  function viewCash() {
    var key = state.sel || todayKey(), L = state.L, row = L.byKey[key], keys = cashKeys(), h = '';
    if (!L.keys.length && !extraMonths.length) h += '<div class="note info">Данных пока нет. Владелец создаёт расчёт и вносит закупки; внесение и вывод средств может отмечать и инвестор. Всё остальное в таблице считается само.</div>';

    if (row) {
      h += '<section class="bento">' +
        kpi('Исходящее сальдо', rub(row.end), sgn(row.end), 'wide', 'на конец ' + esc(C.monthLabel(key)).toLowerCase()) +
        kpi('Входящее сальдо', rub(row.start), sgn(row.start)) +
        kpi('Чистая прибыль накопленным итогом', rub(row.cumProfit), sgn(row.cumProfit)) + '</section>';
    }

    var editable = canFlow();
    var th = keys.map(function (k) {
      return '<th class="m' + (k === key ? ' cur' : '') + '" scope="col"><button type="button" class="mh" data-act="cash-sel" data-key="' + k + '" title="Выбрать месяц">' + esc(C.monthLabel(k)) + '</button></th>';
    }).join('');
    var body = '';

    cashRows().forEach(function (def) {
      var open = !!cashOpen[def.id];
      var lab = def.detail
        ? '<button type="button" class="tg" data-act="cash-toggle" data-row="' + def.id + '" aria-expanded="' + open + '" aria-label="Показать разбивку: ' + esc(def.label) + '"><span class="car">' + (open ? '▾' : '▸') + '</span>' + esc(def.label) + '</button>'
        : esc(def.label);
      body += '<tr class="rw ' + (def.cls || '') + (def.edit ? ' editrow' : '') + '"><th scope="row">' + lab + '</th>';
      keys.forEach(function (k) {
        var r = L.byKey[k], cur = k === key ? ' cur' : '';
        if (def.edit) {
          var f = state.data.flows[k] || {}, v = f[def.edit] || 0;
          body += '<td class="c ed' + cur + '"><input class="cell" type="number" step="0.01" min="0" inputmode="decimal" data-cell="1" data-change="cell-flow" data-key="' + k + '" data-field="' + def.edit + '" value="' + (v || '') + '" placeholder="0" aria-label="' + esc(def.label) + ', ' + esc(C.monthLabel(k)) + '"' + (editable ? '' : ' disabled') + '></td>';
        } else if (!r) body += '<td class="c empty' + cur + '">—</td>';
        else {
          var val = def.get(r);
          body += '<td class="c' + cur + ' ' + (def.signed ? sgn(val) : '') + '">' + fmt(val) + '</td>';
        }
      });
      body += '</tr>';
      if (def.detail && open) {
        var det = cashDetails(def.id, keys);
        if (!det.length) body += '<tr class="rw sub"><th scope="row">нет данных</th>' + keys.map(function () { return '<td class="c"></td>'; }).join('') + '</tr>';
        det.forEach(function (d) {
          body += '<tr class="rw sub"><th scope="row">' + esc(d.label) + '</th>' + keys.map(function (k) {
            var v = d.cells[k];
            return '<td class="c' + (k === key ? ' cur' : '') + '">' + (v == null ? '' : fmt(v)) + '</td>';
          }).join('') + '</tr>';
        });
      }
    });

    // Деньги в товаре: справочно
    body += '<tr class="rw sect"><th scope="row" colspan="' + (keys.length + 1) + '">Товар инвестора на конец месяца (после автоматического списания проданного)</th></tr>';
    var mgs = {};
    keys.forEach(function (k) { mgs[k] = C.moneyInGoods(state.data, k); });
    [['На складе', 'totalWarehouse'], ['В пути', 'totalTransit'], ['Всего деньги в товаре', 'total']].forEach(function (p, i) {
      body += '<tr class="rw info' + (i === 2 ? ' main' : '') + '"><th scope="row">' + p[0] + '</th>' + keys.map(function (k) {
        return '<td class="c' + (k === key ? ' cur' : '') + '">' + (L.byKey[k] || state.data.ledger.batches.length ? fmt(mgs[k][p[1]]) : '—') + '</td>';
      }).join('') + '</tr>';
    });

    h += '<div class="card sheet-card"><div class="toolbar no-print" style="margin:0 0 12px"><h2 style="margin:0">Движение денежных средств</h2><div class="grow"></div>' +
      '<label class="sr" for="addMonth">Добавить месяц</label><input id="addMonth" type="month" style="width:auto">' +
      '<button class="btn ghost sm" type="button" data-act="cash-addmonth">Добавить месяц</button>' +
      '<button class="btn ghost sm" type="button" data-act="csv-cash">' + ICON_DL + 'CSV</button>' +
      '<button class="btn ghost sm" type="button" data-act="print">Печать / PDF</button></div>' +
      '<div class="sheet-wrap" tabindex="0" role="region" aria-label="Таблица движения денежных средств по месяцам"><table class="sheet"><thead><tr><th class="corner" scope="col">Статья, ₽</th>' + th + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="hint">Всё считается автоматически: проданный товар (по последней известной себестоимости), чистая прибыль из расчёта месяца, закупки, потери и корректировки с вкладки «Товар инвестора», входящий остаток из прошлого месяца. Вручную меняются только две выделенные строки — внесение и вывод (положительными числами); их может править и инвестор. Нажмите ▸ у статьи, чтобы увидеть разбивку по товарам.' + (editable ? '' : ' <b>Сейчас таблица только для просмотра.</b>') + '</p></div>';

    if (L.keys.length) {
      h += '<div class="card"><h2>Динамика по месяцам</h2>' + chart(L) +
        '<div class="legend"><span><i style="border-color:var(--accent)"></i>Исходящее сальдо</span><span><i style="border-color:var(--info);border-top-style:dashed"></i>Чистая прибыль накопленным итогом</span></div></div>';
    }
    return h;
  }

  function chart(L) {
    var keys = L.keys;
    if (keys.length < 2) return '<p class="hint">График появится, когда в данных будет два месяца и больше.</p>';
    var W = 720, H = 240, pl = 72, pr = 16, pt = 16, pb = 32;
    var A = keys.map(function (k) { return L.byKey[k].end; }), B = keys.map(function (k) { return L.byKey[k].cumProfit; });
    var all = A.concat(B, [0]), mn = Math.min.apply(null, all), mx = Math.max.apply(null, all);
    if (mx === mn) mx = mn + 1;
    var X = function (i) { return pl + (W - pl - pr) * i / (keys.length - 1); };
    var Y = function (v) { return pt + (H - pt - pb) * (1 - (v - mn) / (mx - mn)); };
    var grid = '';
    for (var g = 0; g <= 4; g++) {
      var v = mn + (mx - mn) * g / 4, y = Y(v);
      grid += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '" style="stroke:var(--border)"/><text x="' + (pl - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" style="fill:var(--muted)">' + nf0.format(Math.round(v / 1000)) + ' тыс.</text>';
    }
    var pts = function (arr) { return arr.map(function (v, i) { return X(i).toFixed(1) + ',' + Y(v).toFixed(1); }).join(' '); };
    var labels = keys.map(function (k, i) { return (keys.length <= 12 || i % Math.ceil(keys.length / 12) === 0) ? '<text x="' + X(i) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="11" style="fill:var(--muted)">' + shortKey(k) + '</text>' : ''; }).join('');
    var dots = function (arr, color) { return arr.map(function (v, i) { return '<circle cx="' + X(i) + '" cy="' + Y(v) + '" r="3.5" style="fill:' + color + '"/>'; }).join(''); };
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Исходящее сальдо и прибыль накопленным итогом по месяцам"><title>Исходящее сальдо и прибыль накопленным итогом по месяцам</title>' +
      grid + labels +
      '<polyline points="' + pts(B) + '" fill="none" stroke-width="2.5" stroke-dasharray="6 4" style="stroke:var(--info)"/>' + dots(B, 'var(--info)') +
      '<polyline points="' + pts(A) + '" fill="none" stroke-width="2.5" style="stroke:var(--accent)"/>' + dots(A, 'var(--accent)') + '</svg>';
  }

  /* ---------- Вкладка 4: справочник ---------- */
  function viewDir() {
    var d = state.data, s = d.settings, map = s.mapping, h = '';
    var mapped = new Set(Object.keys(map).map(C.norm));
    var allArt = new Map();
    Object.keys(d.months).forEach(function (k) {
      C.recSources(d.months[k]).forEach(function (src) {
        (src.articles || []).forEach(function (a) {
          var n = C.norm(a.article), prev = allArt.get(n);
          if (!prev) allArt.set(n, { article: a.article, orgSales: a.orgSales, marketplace: src.marketplace });
          else prev.orgSales += a.orgSales;
        });
      });
    });
    var free = Array.from(allArt.values()).filter(function (a) { return !mapped.has(C.norm(a.article)) && a.orgSales > 0; });

    h += productsDatalist();
    h += '<div class="card"><h2>Соответствие артикулов WB и товаров инвестора</h2><p class="hint" style="margin-top:0">Несколько артикулов можно привязать к одному товару — продажи сложатся. Артикулы без привязки в расчёт не попадают.</p>' +
      '<form data-form="map"><div class="tbl-wrap"><table><thead><tr><th>Артикул в отчёте WB</th><th class="left">Товар инвестора</th><th></th></tr></thead><tbody id="mapRows">' +
      Object.keys(map).sort(function (a, b) { return map[a].localeCompare(map[b], 'ru') || a.localeCompare(b, 'ru'); }).map(function (a) {
        return mapRow(a, map[a]);
      }).join('') + '</tbody></table></div>' +
      (isOwner() ? '<div class="toolbar" style="margin:12px 0 0"><button class="btn ghost sm" type="button" data-act="map-add">Добавить строку</button><div class="grow"></div><button class="btn" type="submit">Сохранить справочник</button></div>' : '') + '</form>' +
      (free.length ? '<h3>Артикулы из загруженных отчётов без привязки</h3><div class="chips">' + free.sort(function (a, b) { return b.orgSales - a.orgSales; }).map(function (a) {
        return '<button class="chip" type="button" data-act="map-chip" data-art="' + esc(a.article) + '"' + dis() + '>' + esc(a.article) + ' · ' + esc(C.MARKET_LABEL[a.marketplace] || '') + ' · ' + fmt(a.orgSales) + '</button>';
      }).join('') + '</div><p class="hint">Нажмите на артикул, чтобы добавить его в таблицу выше, затем укажите товар и сохраните.</p>' : '') + '</div>';

    h += '<div class="card"><h2>Резервная копия</h2><p class="hint" style="margin-top:0">Все данные (настройки, закупки, потери, корректировки, движение средств и расчёты всех месяцев) одним файлом. Храните копию вне GitHub: на компьютере или в облачном диске. Сделайте её после закрытия каждого месяца.</p>' +
      '<div class="toolbar" style="margin:0"><button class="btn" type="button" data-act="backup-dl">Скачать резервную копию</button>' +
      (isOwner() ? '<label class="btn ghost" for="backupFile" style="cursor:pointer">Восстановить из файла</label><input id="backupFile" type="file" accept=".json,application/json" class="sr" data-change="backup-file">' : '') + '</div>' +
      (isOwner() ? '<p class="hint">Восстановление добавляет и заменяет записи из файла, но ничего не удаляет. Перед ним лучше скачать свежую копию.</p>' : '') + '</div>';
    if (isOwner()) {
      h += '<div class="card"><h2>Доступ для инвестора (логин и пароль)</h2>' +
        '<p class="hint" style="margin-top:0">Инвестор заходит на сайт по логину и паролю, GitHub ему не нужен. Создайте для него отдельный токен (только репозиторий с данными, право Contents: Read and write), введите его ниже вместе с логином и паролем — сайт зашифрует подключение паролем и выдаст файл access.json. Загрузите его в корень репозитория сайта (Add file → Upload files). Пароль и токен на сайте не сохраняются.</p>' +
        '<form data-form="access"><div class="form-row" style="margin-top:0">' +
        '<div><label for="acLogin">Логин инвестора</label><input id="acLogin" name="login" autocomplete="off" required></div>' +
        '<div><label for="acPass">Пароль (от 8 символов)</label><input id="acPass" name="password" type="password" autocomplete="new-password" minlength="8" required></div>' +
        '<div><label for="acOwner">Владелец репозитория данных</label><input id="acOwner" name="owner" value="' + esc(state.cfg.owner) + '" autocomplete="off" required></div>' +
        '<div><label for="acRepo">Репозиторий данных</label><input id="acRepo" name="repo" value="' + esc(state.cfg.repo || 'investor-data') + '" autocomplete="off" required></div>' +
        '<div style="grid-column: span 2"><label for="acToken">Токен инвестора</label><input id="acToken" name="token" type="password" autocomplete="off" required></div>' +
        '<div><button class="btn" type="submit">Создать access.json</button></div></div></form>' +
        '<p class="hint">Чтобы сменить пароль или токен, создайте файл заново и загрузите поверх старого. Используйте длинный пароль: файл лежит на публичном сайте, и слабый пароль можно подобрать. Токен выдавайте с коротким сроком и обновляйте.</p></div>';
    }
    h += '<div class="card"><h2>Параметры</h2><form data-form="settings"><div class="form-row" style="margin-top:0">' +
      '<div><label for="sShare">Доля продаж инвестора</label><input id="sShare" name="investorShare" type="text" value="' + esc(C.formatShare(C.shareOf({ share: s.investorShare }))) + '" placeholder="1/3"' + dis() + '></div>' +
      '<div><label for="sOpen">Входящее сальдо первого месяца, ₽</label><input id="sOpen" name="openingBalance" type="number" step="0.01" value="' + s.openingBalance + '"' + dis() + '></div>' +
      '<div><label for="sCum">Прибыль накопленным итогом до первого месяца, ₽</label><input id="sCum" name="openingCumulative" type="number" step="0.01" value="' + s.openingCumulative + '"' + dis() + '></div>' +
      '<div><label for="sFot">ФОТ и сервисы по умолчанию, %</label><input id="sFot" name="defaultFotPct" type="number" step="0.01" min="0" value="' + Math.round(s.defaultFotPct * 10000) / 100 + '"' + dis() + '></div>' +
      '<div><label for="sFul">Фулфилмент по умолчанию, %</label><input id="sFul" name="defaultFulfillPct" type="number" step="0.01" min="0" value="' + Math.round(s.defaultFulfillPct * 10000) / 100 + '"' + dis() + '></div>' +
      '<div><button class="btn" type="submit"' + dis() + '>Сохранить</button></div></div></form>' +
      '<p class="hint">Доля инвестора — какая часть органических продаж относится к нему (например, 1/3); её можно изменить для отдельного месяца при пересчёте. Проценты по умолчанию применяются, только если нужный месяц не нашёлся в отчётах. Входящее сальдо первого месяца — остаток на начало ведения учёта на сайте.</p></div>';
    return h;
  }
  function mapRow(art, prod) {
    return '<tr data-map-row><td class="left"><input name="art" value="' + esc(art) + '" aria-label="Артикул WB"' + dis() + '></td><td class="left"><input name="prod" list="productsList" value="' + esc(prod) + '" aria-label="Товар инвестора"' + dis() + '></td>' +
      '<td>' + (isOwner() ? '<button class="btn ghost sm" type="button" data-act="map-del" aria-label="Убрать строку">' + ICON_X + '</button>' : '') + '</td></tr>';
  }

  /* ---------- CSV ---------- */
  function csvCell(c) {
    if (typeof c === 'number') return String(Math.round(c * 100) / 100).replace('.', ',');
    var s = String(c == null ? '' : c);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function download(name, rows) {
    var text = '﻿' + rows.map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  /* ---------- Создание расчёта ---------- */
  var createCtx = null;

  function openCreate(forKey) {
    var def = forKey || (state.L.keys.length ? nextKey(state.L.keys[state.L.keys.length - 1]) : todayKey());
    createCtx = { items: [] };
    openDlg('<h2>Отчёты за месяц</h2><form data-form="create">' +
      '<label for="cMonth">Месяц расчёта</label><input id="cMonth" type="month" value="' + def + '" required data-change="create-month">' +
      '<div style="height:12px"></div>' +
      '<label class="drop" id="drop"><input id="cFile" type="file" accept=".xlsm,.xlsx" multiple data-change="create-file"><span>Перетащите сюда отчёты <b>WB, Яндекс Маркета и Ozon</b> (<b>.xlsm</b> / <b>.xlsx</b>) — можно сразу несколько — или нажмите, чтобы выбрать</span></label>' +
      '<div class="toolbar" style="margin:10px 0 0"><button type="button" class="btn ghost sm" data-act="from-service">Загрузить из сервиса</button><span class="hint" style="margin:0">данные за выбранный месяц, выгруженные сервисом оцифровки</span></div>' +
      '<div id="cPreview" class="hint">Файлы читаются в вашем браузере. В базу сохраняются только строки по артикулам (продажи, цена, прибыль на единицу) и суммы расходов — сами файлы не загружаются.</div>' +
      '<div class="dlg-actions"><button type="button" class="btn ghost" data-act="dlg-close">Отмена</button><button type="submit" class="btn" id="cGo" disabled>Создать расчёт</button></div></form>');
    var drop = $('#drop');
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) readReports(e.dataTransfer.files); });
    reparse();
  }

  // Читаем только нужные листы: отчёты тяжёлые (5–9 МБ), остальные листы не нужны
  async function readReports(fileList) {
    var box = $('#cPreview'), go = $('#cGo');
    go.disabled = true;
    if (!window.XLSX) { box.innerHTML = '<span class="neg">Не загрузилась библиотека чтения Excel (нет доступа к cdnjs.cloudflare.com). Проверьте интернет и обновите страницу.</span>'; return; }
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      box.textContent = 'Читаю файлы… ' + (i + 1) + ' из ' + fileList.length;
      await new Promise(function (r) { setTimeout(r, 0); });
      try {
        var buf = await f.arrayBuffer();
        var names = window.XLSX.read(buf, { type: 'array', bookSheets: true }).SheetNames;
        var wb = window.XLSX.read(buf, { type: 'array', sheets: C.neededSheets(names), cellFormula: false, cellStyles: false, cellHTML: false, cellText: false });
        createCtx.items.push({ name: f.name, wb: wb, parsed: null, error: '' });
      } catch (e) {
        createCtx.items.push({ name: f.name, wb: null, parsed: null, error: e.message || String(e) });
      }
    }
    reparse();
  }

  function parsedSources() {
    var byId = new Map();
    (createCtx ? createCtx.items : []).forEach(function (it) { if (it.parsed) byId.set(it.parsed.id, it.parsed); });
    return Array.from(byId.values());
  }

  function reparse() {
    if (!createCtx) return;
    var box = $('#cPreview'), go = $('#cGo'), key = $('#cMonth').value;
    if (!createCtx.items.length) { go.disabled = true; return; }
    if (!C.validKey(key)) { box.textContent = 'Выберите месяц расчёта.'; go.disabled = true; return; }
    var html = '';
    createCtx.items.forEach(function (it) {
      it.parsed = null;
      if (it.svc) {
        if (it.svc.month !== key) it.error = 'Данные сервиса относятся к месяцу ' + it.svc.month + ', а выбран ' + key + '. Выберите тот же месяц или загрузите данные заново.';
        else { it.error = ''; it.parsed = C.parseServiceCabinet(it.svc.cab, 'сервис ' + it.svc.month); it.parsed.generatedAt = it.svc.generatedAt; it.parsed.final = !!it.svc.final; if (!it.svc.final) it.parsed.warnings.push('Месяц в сервисе ещё не закрыт — данные могут измениться, при необходимости загрузите их заново позже.'); }
      } else if (it.wb) {
        try { it.parsed = C.parseReport(window.XLSX, it.wb, key, it.name); } catch (e) { it.error = e.message || String(e); }
      }
      if (it.parsed) {
        var p = it.parsed;
        html += '<div style="margin-top:8px"><b>' + (p.fromService ? 'Сервис · ' : '') + esc(C.MARKET_LABEL[p.marketplace]) + ' · ' + esc(p.entity || it.name) + '</b> — артикулов: ' + p.articles.length + ' · ' +
          (p.pctFound ? 'расходы ' + pct(p.fotPct) + ', фулфилмент ' + pct(p.fulfillPct) : 'проценты не найдены') +
          (p.warnings.length ? '<br><span style="color:var(--warn)">' + p.warnings.map(esc).join('<br>') + '</span>' : '') + '</div>';
      } else {
        html += '<div style="margin-top:8px"><b>' + esc(it.name) + '</b><br><span class="neg">' + esc(it.error || 'Не удалось прочитать файл') + '</span></div>';
      }
    });
    var ok = parsedSources();
    if (ok.length) {
      var gp = C.groupByProduct({ sources: ok }, state.data.settings.mapping), bl = C.blendPct(ok);
      html += '<div style="margin-top:12px;color:var(--text)">Учтено товаров: <b>' + gp.groups.length + '</b> · артикулов без привязки (с продажами): <b>' + gp.unmapped.length + '</b>' +
        (bl.found ? '<br>Общие проценты: расходы <b>' + pct(bl.fotPct) + '</b>, фулфилмент <b>' + pct(bl.fulfillPct) + '</b>' : '<br>Проценты расходов не найдены, будут взяты значения по умолчанию.') + '</div>';
      var old = state.data.months[key];
      if (old) html += '<div style="margin-top:8px;color:var(--warn)">Расчёт за этот месяц уже есть: отчёты тех же кабинетов будут заменены, остальные останутся.</div>';
      go.textContent = old ? 'Обновить расчёт' : 'Создать расчёт';
      var oldManual = old ? C.recSources(old).filter(function (x) { return !x.fromService; }) : [];
      if (ok.every(function (x) { return x.fromService; }) && oldManual.length) {
        html += '<label class="check" style="margin-top:8px"><input type="checkbox" id="cReplaceAll" checked>Заменить прежние отчёты месяца (' + oldManual.length + ', из Excel) данными сервиса</label><div class="hint" style="margin-top:4px">Иначе кабинеты из Excel и из сервиса сложатся и продажи удвоятся.</div>';
      }
    }
    box.innerHTML = html;
    go.disabled = !ok.length;
  }

  /* ---------- Подключение ---------- */
  function openConn() {
    var c = state.cfg;
    openDlg('<h2>Подключение</h2><form data-form="conn">' +
      '<div class="radio-row"><label class="check"><input type="radio" name="mode" value="github"' + (c.mode === 'github' ? ' checked' : '') + '>GitHub (общая база)</label><label class="check"><input type="radio" name="mode" value="local"' + (c.mode === 'local' ? ' checked' : '') + '>Локально (проба)</label></div>' +
      '<div class="form-row"><div><label for="cnOwner">Владелец репозитория</label><input id="cnOwner" name="owner" value="' + esc(c.owner) + '" autocomplete="off" placeholder="ваш-логин"></div>' +
      '<div><label for="cnRepo">Репозиторий с данными</label><input id="cnRepo" name="repo" value="' + esc(c.repo) + '" autocomplete="off" placeholder="investor-data"></div>' +
      '<div><label for="cnBranch">Ветка</label><input id="cnBranch" name="branch" value="' + esc(c.branch) + '" autocomplete="off"></div></div>' +
      '<div class="form-row"><div style="grid-column: span 2"><label for="cnToken">Токен доступа GitHub</label><input id="cnToken" name="token" type="password" value="' + esc(c.token) + '" autocomplete="off"></div>' +
      '<div><label for="cnRole">Роль на этом устройстве</label><select id="cnRole" name="role"><option value="owner"' + (c.role === 'owner' ? ' selected' : '') + '>Владелец</option><option value="investor"' + (c.role === 'investor' ? ' selected' : '') + '>Инвестор</option></select></div></div>' +
      '<label class="check"><input type="checkbox" name="remember"' + (c.remember ? ' checked' : '') + '>Запомнить токен на этом устройстве</label>' +
      '<p class="hint">Роль меняет только интерфейс: инвестор видит всё, но правит лишь внесение и вывод средств. Токен хранится в браузере этого устройства — не вводите его на чужих компьютерах.</p>' +
      '<div id="connMsg" class="hint" role="status"></div>' +
      '<div class="dlg-actions"><button type="button" class="btn ghost" data-act="dlg-close">Закрыть</button><button type="button" class="btn ghost" data-act="conn-test">Проверить</button><button type="submit" class="btn">Сохранить</button></div></form>');
  }
  function connValues(f) {
    var fd = new FormData(f);
    return {
      mode: fd.get('mode') === 'github' ? 'github' : 'local',
      owner: String(fd.get('owner') || '').trim(), repo: String(fd.get('repo') || '').trim(),
      branch: String(fd.get('branch') || '').trim() || 'main', token: String(fd.get('token') || '').trim(),
      role: fd.get('role') === 'investor' ? 'investor' : 'owner', remember: !!fd.get('remember')
    };
  }

  /* ---------- Действия ---------- */
  var ACT = {
    tab: function (el) { state.tab = el.getAttribute('data-tab'); render(); },
    'dlg-close': closeDlg,
    create: function () { if (isOwner()) openCreate(); },
    replace: function () { if (isOwner()) openCreate(state.sel); },
    print: function () { window.print(); },
    recalc: function () {
      if (!isOwner()) return;
      var key = state.sel, fot = C.num($('#fotPct').value) / 100, ful = C.num($('#fulPct').value) / 100, share = C.parseShare($('#shareInp').value);
      if (fot < 0 || ful < 0) return toast('Проценты не могут быть отрицательными', 'err');
      if (!(share > 0 && share <= 1)) return toast('Доля инвестора — число от 0 до 1, например 1/3 или 33%', 'err');
      mutate(function (d) { var r = d.months[key]; r.fotPct = fot; r.fulfillPct = ful; r.share = share; r.pctFound = true; r.recalcAt = Date.now(); },
        [['month', key]], 'Расчёт пересчитан', 'Пересчёт ' + key);
    },
    'del-source': function (el) {
      var id = el.getAttribute('data-id'), key = state.sel, s = state.data.settings;
      if (!isOwner()) return;
      if (C.recSources(state.data.months[key]).length < 2) return toast('Это последний отчёт месяца. Чтобы убрать его, удалите расчёт целиком.', 'err');
      if (!confirm('Убрать этот отчёт из расчёта за ' + C.monthLabel(key) + '? Проценты расходов пересчитаются по оставшимся.')) return;
      mutate(function (d) {
        var rec = d.months[key];
        rec.sources = C.recSources(rec).filter(function (x) { return x.id !== id; });
        delete rec.articles;
        var bl = C.blendPct(rec.sources);
        rec.fotPct = bl.found ? bl.fotPct : s.defaultFotPct;
        rec.fulfillPct = bl.found ? bl.fulfillPct : s.defaultFulfillPct;
        rec.pctFound = bl.found; rec.updatedAt = Date.now();
      }, [['month', key]], 'Отчёт убран из расчёта', 'Убран отчёт из расчёта ' + key);
    },
    'delete-month': function () {
      var key = state.sel;
      if (!isOwner() || !confirm('Удалить расчёт за ' + C.monthLabel(key) + '? Закупки, потери и движение средств останутся.')) return;
      mutate(function (d) { delete d.months[key]; }, [['month', key]], 'Расчёт удалён', 'Удалён расчёт ' + key);
    },
    'csv-month': function () {
      var key = state.sel, row = state.L.byKey[key]; if (!row || !row.calc) return;
      var rows = [['Товар', 'Закуп руб/шт', 'Продано шт', 'Цена руб', 'Прибыль на ед руб', 'Выручка', 'Вал. прибыль', 'Фулфилмент', 'Расходы', 'Чистая прибыль']];
      row.calc.products.forEach(function (p) { rows.push([p.product, p.cost == null ? '' : p.cost, p.sold, p.price, p.profitUnit, p.revenue, p.gross, p.fulfill, p.fot, p.net]); });
      var t = row.calc.totals; rows.push(['Итого', '', t.sold, '', '', t.revenue, t.gross, t.fulfill, t.fot, t.net]);
      download('расчет-' + key + '.csv', rows);
    },
    'csv-cash': function () {
      var L = state.L, keys = cashKeys(), rows = [['Статья'].concat(keys)];
      cashRows().forEach(function (def) {
        rows.push([def.label].concat(keys.map(function (k) {
          if (def.edit) { var f = state.data.flows[k] || {}; return def.edit === 'out' ? -(f.out || 0) : (f.in || 0); }
          return L.byKey[k] ? def.get(L.byKey[k]) : '';
        })));
      });
      download('движение-денег.csv', rows);
    },
    'backup-dl': function () {
      var d = state.data, snap = { app: 'investor-calc', version: 1, exportedAt: new Date().toISOString(), settings: d.settings, ledger: d.ledger, flows: d.flows, months: d.months };
      var blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'investor-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    },
    'from-service': async function () {
      if (!isOwner() || !createCtx) return;
      var key = $('#cMonth').value, box = $('#cPreview'), go = $('#cGo');
      if (!C.validKey(key)) { box.innerHTML = '<span class="neg">Сначала выберите месяц расчёта.</span>'; return; }
      box.textContent = 'Запрашиваю данные сервиса за ' + key + '…'; go.disabled = true;
      var j = null;
      try { j = await state.store.read('import/' + key + '.json'); }
      catch (e) { box.innerHTML = '<span class="neg">Не удалось прочитать данные сервиса: ' + esc(e.message || e) + '</span>'; reparse(); return; }
      if (!j || !Array.isArray(j.cabinets) || !j.cabinets.length) {
        var why = '';
        if (state.store.kind !== 'github') why = 'Сайт сейчас работает в локальном режиме и не видит репозиторий. Откройте «Подключение», выберите GitHub, введите репозиторий и токен.';
        else {
          try {
            await state.store.ping();
            var have = [];
            try { have = (await state.store.list('import')).filter(function (n) { return /\.json$/.test(n); }); } catch (e2) { have = []; }
            why = j ? 'Файл найден, но в нём нет кабинетов.' : 'В репозитории ' + state.cfg.owner + '/' + state.cfg.repo + ' (ветка ' + state.cfg.branch + ') нет файла import/' + key + '.json. ' + (have.length ? 'В папке import есть: ' + have.join(', ') + '.' : 'Папки import в этой ветке нет: проверьте имя репозитория и ветку в «Подключении».');
          } catch (e3) { why = 'Не удаётся открыть репозиторий ' + state.cfg.owner + '/' + state.cfg.repo + ': ' + (e3.message || e3); }
        }
        box.innerHTML = '<span class="neg">' + esc(why) + '</span>';
        createCtx.items = createCtx.items.filter(function (it) { return !it.svc; }); reparse(); return;
      }
      if (j.month && j.month !== key) { box.innerHTML = '<span class="neg">В файле данные за ' + esc(j.month) + ', а запрошен ' + esc(key) + '.</span>'; return; }
      createCtx.items = createCtx.items.filter(function (it) { return !it.svc; });
      j.cabinets.forEach(function (cab) {
        createCtx.items.push({ name: 'Сервис · ' + (cab.cabinet || cab.marketplace || ''), wb: null, parsed: null, error: '', svc: { month: key, cab: cab, final: !!j.final, generatedAt: j.generated_at || '' } });
      });
      reparse();
    },
    'login-manual': function () { try { localStorage.setItem(NOLOGIN_KEY, '1'); } catch (e) { /* ничего */ } closeDlg(); openConn(); },
    'cash-toggle': function (el) { var id = el.getAttribute('data-row'); cashOpen[id] = !cashOpen[id]; render(); var b = document.querySelector('[data-act="cash-toggle"][data-row="' + id + '"]'); if (b) b.focus(); },
    'cash-sel': function (el) { var k = el.getAttribute('data-key'); if (!C.validKey(k)) return; state.sel = k; try { localStorage.setItem(SEL_KEY, k); } catch (e) { /* ничего */ } render(); },
    'cash-addmonth': function () {
      var v = ($('#addMonth') || {}).value;
      if (!C.validKey(v)) return toast('Выберите месяц', 'err');
      if (extraMonths.indexOf(v) < 0) extraMonths.push(v);
      state.sel = v; render();
      var c = document.querySelector('[data-cell][data-key="' + v + '"][data-field="in"]'); if (c && !c.disabled) c.focus();
    },
    'del-batch': function (el) {
      var id = el.getAttribute('data-id'), L = state.data.ledger;
      if (!isOwner()) return;
      if (L.corrections.some(function (c) { return c.batchId === id; })) return toast('У партии есть корректировки — сначала удалите их или внесите обратную корректировку.', 'err');
      if (!confirm('Удалить партию из закупок? Это изменит остатки и сальдо.')) return;
      mutate(function (d) { d.ledger.batches = d.ledger.batches.filter(function (b) { return b.id !== id; }); }, ['ledger'], 'Партия удалена', 'Удалена партия');
    },
    'del-loss': function (el) {
      var id = el.getAttribute('data-id'); if (!isOwner()) return;
      mutate(function (d) { d.ledger.losses = d.ledger.losses.filter(function (l) { return l.id !== id; }); }, ['ledger'], 'Потеря удалена', 'Удалена потеря');
    },
    'del-corr': function (el) {
      var id = el.getAttribute('data-id'); if (!isOwner()) return;
      mutate(function (d) { d.ledger.corrections = d.ledger.corrections.filter(function (c) { return c.id !== id; }); }, ['ledger'], 'Корректировка удалена', 'Удалена корректировка');
    },
    'map-add': function () { $('#mapRows').insertAdjacentHTML('beforeend', mapRow('', '')); var r = $('#mapRows tr:last-child input'); if (r) r.focus(); },
    'map-del': function (el) { el.closest('tr').remove(); },
    'map-chip': function (el) {
      if (!isOwner()) return;
      $('#mapRows').insertAdjacentHTML('beforeend', mapRow(el.getAttribute('data-art'), ''));
      var inp = $('#mapRows tr:last-child input[name="prod"]'); if (inp) inp.focus();
      el.remove();
    },
    'conn-test': async function () {
      var v = connValues($('#dlg form')), msg = $('#connMsg');
      if (v.mode !== 'github') { msg.textContent = 'Выбран локальный режим — проверять нечего.'; return; }
      if (!v.owner || !v.repo || !v.token) { msg.textContent = 'Заполните владельца, репозиторий и токен.'; return; }
      msg.textContent = 'Проверяю…';
      try {
        var r = await new S.GitHubStore(v).ping();
        msg.innerHTML = '<span class="pos">Подключение работает.</span> ' + (r.canPush ? 'Запись разрешена.' : '<span style="color:var(--warn)">У токена нет права записи — сохранять данные не получится.</span>') + (r.isPrivate ? ' Репозиторий приватный.' : ' <span style="color:var(--warn)">Репозиторий публичный — данные увидят все!</span>');
      } catch (e) { msg.innerHTML = '<span class="neg">' + esc(e.message || e) + '</span>'; }
    }
  };

  var CHG = {
    sel: function (el) { state.sel = el.value; try { localStorage.setItem(SEL_KEY, state.sel); } catch (e) { /* ничего */ } render(); },
    selInput: function (el) { if (C.validKey(el.value)) CHG.sel(el); },
    'create-month': function () { reparse(); },
    'create-file': function (el) { if (el.files && el.files.length) readReports(el.files); },
    'backup-file': function (el) {
      var f = el.files && el.files[0]; if (!f || !isOwner()) return;
      var rd = new FileReader();
      rd.onload = function () {
        var b;
        try { b = JSON.parse(String(rd.result)); } catch (e) { return toast('Это не файл резервной копии (не читается как JSON)', 'err'); }
        if (!b || b.app !== 'investor-calc' || !b.settings || !b.ledger) return toast('Это не файл резервной копии этого сайта', 'err');
        var mk = Object.keys(b.months || {}).filter(C.validKey), fk = Object.keys(b.flows || {}).filter(C.validKey);
        if (!confirm('Восстановить данные из копии от ' + String(b.exportedAt || '').slice(0, 10) + '? Закупки, настройки и месячные расчёты будут заменены данными из файла (месяцев: ' + mk.length + '). Движение средств и месяцы, которых нет в файле, останутся.')) { el.value = ''; return; }
        var files = ['settings', 'ledger'].concat(mk.map(function (k) { return ['month', k]; }), fk.map(function (k) { return ['flow', k]; }));
        mutate(function (d) {
          d.settings = Object.assign(d.settings, b.settings);
          d.ledger = { batches: b.ledger.batches || [], losses: b.ledger.losses || [], corrections: b.ledger.corrections || [] };
          mk.forEach(function (k) { d.months[k] = b.months[k]; });
          fk.forEach(function (k) { d.flows[k] = b.flows[k]; });
        }, files, 'Данные восстановлены из копии', 'Восстановление из резервной копии');
      };
      rd.readAsText(f);
    },
    'cell-flow': function (el) {
      if (!canFlow()) return;
      var key = el.getAttribute('data-key'), field = el.getAttribute('data-field') === 'out' ? 'out' : 'in', val = C.num(el.value);
      var cur = (state.data.flows[key] || {})[field] || 0;
      if (val < 0) { toast('Суммы вводятся положительными числами', 'err'); render(); return; }
      if (Math.abs(val - cur) < 1e-9) return;
      var who = state.cfg.role === 'owner' ? 'владелец' : 'инвестор';
      mutate(function (d) {
        var f = Object.assign({ in: 0, out: 0 }, d.flows[key] || {});
        f[field] = val; f.by = who; f.at = Date.now();
        if (!f.in && !f.out) delete d.flows[key]; else d.flows[key] = f;
      }, [['flow', key]], 'Сохранено: ' + (field === 'out' ? 'вывод' : 'внесение') + ' за ' + C.monthLabel(key), (field === 'out' ? 'Вывод средств ' : 'Внесение средств ') + key + ' (' + who + ')');
    },
    'batch-status': function (el) {
      if (!isOwner()) return;
      var id = el.getAttribute('data-id'), val = el.value === 'путь' ? 'путь' : 'склад';
      mutate(function (d) { d.ledger.batches.forEach(function (b) { if (b.id === id) b.status = val; }); }, ['ledger'], 'Статус обновлён', 'Смена статуса партии');
    }
  };

  var FORM = {
    create: function () {
      if (!isOwner() || !createCtx) return;
      var key = $('#cMonth').value, s = state.data.settings;
      var fresh = parsedSources().map(function (p) {
        return {
          id: p.id, marketplace: p.marketplace, entity: p.entity, file: p.file, loadedAt: Date.now(),
          fromService: p.fromService || undefined, generatedAt: p.generatedAt || undefined, final: p.fromService ? !!p.final : undefined,
          articles: p.articles.map(function (a) { return { article: a.article, orgSales: a.orgSales, price: Math.round(a.price * 10000) / 10000, profitUnit: Math.round(a.profitUnit * 10000) / 10000 }; }),
          amounts: p.amounts, pctFound: p.pctFound
        };
      });
      if (!fresh.length || !C.validKey(key)) return;
      var ids = new Set(fresh.map(function (x) { return x.id; }));
      var existed = !!state.data.months[key];
      var repAll = $('#cReplaceAll') ? $('#cReplaceAll').checked : false;
      closeDlg();
      mutate(function (d) {
        var old = d.months[key];
        var keep = old && !repAll ? C.recSources(old).filter(function (x) { return !ids.has(x.id); }) : [];
        var sources = keep.concat(fresh), bl = C.blendPct(sources);
        var rec = old || { key: key, createdAt: Date.now(), share: s.investorShare };
        delete rec.articles; delete rec.source;
        rec.sources = sources; rec.updatedAt = Date.now();
        rec.fotPct = bl.found ? bl.fotPct : s.defaultFotPct;
        rec.fulfillPct = bl.found ? bl.fulfillPct : s.defaultFulfillPct;
        rec.pctFound = bl.found;
        d.months[key] = rec;
      }, [['month', key], 'settings'], 'Расчёт за ' + C.monthLabel(key) + (existed ? ' обновлён' : ' создан'), 'Расчёт ' + key).then(function (ok) {
        if (ok) { state.sel = key; state.tab = 'month'; try { localStorage.setItem(SEL_KEY, key); } catch (e) { /* ничего */ } render(); }
      });
    },
    purchase: function (f) {
      if (!isOwner()) return;
      var fd = new FormData(f), product = String(fd.get('product') || '').trim(), cost = C.num(fd.get('cost')), qty = C.num(fd.get('qty')), month = String(fd.get('month'));
      if (!product || qty <= 0 || cost < 0 || !C.validKey(month)) return toast('Проверьте поля закупки', 'err');
      mutate(function (d) { d.ledger.batches.push({ id: uid(), month: month, product: product, cost: cost, costOriginal: cost, qty: qty, status: fd.get('status') === 'путь' ? 'путь' : 'склад', opening: fd.get('opening') ? true : undefined, createdAt: Date.now() }); },
        ['ledger'], 'Закупка добавлена', 'Закупка: ' + product).then(function (ok) { if (ok) f.reset(); });
    },
    loss: function (f) {
      if (!isOwner()) return;
      var fd = new FormData(f), product = String(fd.get('product') || '').trim(), qty = C.num(fd.get('qty')), month = String(fd.get('month'));
      if (!product || qty <= 0 || !C.validKey(month)) return toast('Проверьте поля потери', 'err');
      mutate(function (d) { d.ledger.losses.push({ id: uid(), month: month, product: product, qty: qty, comment: String(fd.get('comment') || '').trim() }); },
        ['ledger'], 'Потеря записана', 'Потеря: ' + product);
    },
    'corr-batch': function (f) {
      if (!isOwner()) return;
      var fd = new FormData(f), id = String(fd.get('batch')), newCost = C.num(fd.get('cost')), month = String(fd.get('month'));
      var b = state.data.ledger.batches.filter(function (x) { return x.id === id; })[0];
      if (!b || !C.validKey(month) || newCost < 0) return toast('Выберите партию и укажите новую себестоимость', 'err');
      if (Math.abs(newCost - C.num(b.cost)) < 1e-9) return toast('Новая себестоимость совпадает с текущей', 'err');
      var old = C.num(b.cost), amount = (old - newCost) * C.num(b.qty);
      mutate(function (d) {
        d.ledger.batches.forEach(function (x) { if (x.id === id) x.cost = newCost; });
        d.ledger.corrections.push({ id: uid(), month: month, kind: 'batch', batchId: id, product: b.product, oldCost: old, newCost: newCost, qty: C.num(b.qty), amount: amount });
      }, ['ledger'], 'Корректировка применена: ' + rub(amount), 'Корректировка закупа: ' + b.product);
    },
    'corr-manual': function (f) {
      if (!isOwner()) return;
      var fd = new FormData(f), comment = String(fd.get('comment') || '').trim(), amount = C.num(fd.get('amount')), month = String(fd.get('month'));
      if (!comment || !amount || !C.validKey(month)) return toast('Укажите описание и сумму', 'err');
      mutate(function (d) { d.ledger.corrections.push({ id: uid(), month: month, kind: 'manual', comment: comment, amount: amount }); },
        ['ledger'], 'Корректировка добавлена', 'Корректировка закупа').then(function (ok) { if (ok) f.reset(); });
    },
    flow: function (f) {
      if (!canFlow()) return;
      var fd = new FormData(f), key = state.sel || todayKey(), inn = C.num(fd.get('in')), out = C.num(fd.get('out'));
      if (inn < 0 || out < 0) return toast('Суммы вводятся положительными числами', 'err');
      var who = state.cfg.role === 'owner' ? 'владелец' : 'инвестор';
      mutate(function (d) { if (inn || out) d.flows[key] = { in: inn, out: out, by: who, at: Date.now() }; else delete d.flows[key]; },
        [['flow', key]], 'Движение средств сохранено', 'Движение средств ' + key + ' (' + who + ')');
    },
    map: function (f) {
      if (!isOwner()) return;
      var map = {}, rows = f.querySelectorAll('[data-map-row]'), bad = false;
      rows.forEach(function (tr) {
        var a = tr.querySelector('[name="art"]').value.trim(), p = tr.querySelector('[name="prod"]').value.trim();
        if (!a && !p) return;
        if (!a || !p) { bad = true; return; }
        map[a] = p;
      });
      if (bad) return toast('В каждой строке нужны и артикул, и товар', 'err');
      mutate(function (d) { d.settings.mapping = map; }, ['settings'], 'Справочник сохранён. Нажмите «Пересчитать» в нужном месяце', 'Справочник товаров');
    },
    settings: function (f) {
      if (!isOwner()) return;
      var fd = new FormData(f), share = C.parseShare(fd.get('investorShare'));
      if (!(share > 0 && share <= 1)) return toast('Доля инвестора — число от 0 до 1, например 1/3 или 33%', 'err');
      mutate(function (d) {
        d.settings.investorShare = share;
        d.settings.openingBalance = C.num(fd.get('openingBalance'));
        d.settings.openingCumulative = C.num(fd.get('openingCumulative'));
        d.settings.defaultFotPct = C.num(fd.get('defaultFotPct')) / 100;
        d.settings.defaultFulfillPct = C.num(fd.get('defaultFulfillPct')) / 100;
      }, ['settings'], 'Параметры сохранены', 'Параметры расчёта');
    },
    login: async function (f) {
      var fd = new FormData(f), msg = $('#lgMsg');
      if (msg) msg.textContent = 'Проверяю…';
      try {
        var p = await Access.open(fd.get('login'), fd.get('password'), state.access);
        if (!p || !p.owner || !p.repo || !p.token) throw new Error('Файл доступа заполнен не полностью.');
        state.cfg = { mode: 'github', owner: p.owner, repo: p.repo, branch: p.branch || 'main', role: 'investor', remember: true, token: p.token };
        saveCfg(state.cfg); closeDlg(); boot();
      } catch (e) { if (msg) msg.innerHTML = '<span class="neg">' + esc(e.message || e) + '</span>'; }
    },
    access: async function (f) {
      var fd = new FormData(f), btn = f.querySelector('button[type="submit"]');
      var token = String(fd.get('token') || '').trim(), owner = String(fd.get('owner') || '').trim(), repo = String(fd.get('repo') || '').trim();
      if (btn) btn.disabled = true;
      try {
        var blob = await Access.seal(fd.get('login'), fd.get('password'), { owner: owner, repo: repo, branch: state.cfg.branch || 'main', token: token });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(blob)], { type: 'application/json' }));
        a.download = 'access.json';
        document.body.appendChild(a); a.click(); a.remove();
        f.reset();
        toast('Файл access.json скачан. Загрузите его в корень репозитория сайта.', 'ok');
      } catch (e) { toast(e.message || String(e), 'err'); }
      finally { if (btn) btn.disabled = false; }
    },
    conn: function (f) {
      var v = connValues(f);
      if (v.mode === 'github' && (!v.owner || !v.repo || !v.token)) { $('#connMsg').innerHTML = '<span class="neg">Для GitHub нужны владелец, репозиторий и токен.</span>'; return; }
      state.cfg = v; saveCfg(v); closeDlg(); boot();
    }
  };

  /* ---------- Обработчики событий ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var a = ACT[el.getAttribute('data-act')];
    if (a) { e.preventDefault(); a(el, e); }
  });
  document.addEventListener('change', function (e) {
    var el = e.target.closest('[data-change]');
    if (el && CHG[el.getAttribute('data-change')]) CHG[el.getAttribute('data-change')](el, e);
  });
  document.addEventListener('submit', function (e) {
    var f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    if (FORM[f.getAttribute('data-form')]) FORM[f.getAttribute('data-form')](f);
  });
  document.addEventListener('keydown', function (e) {
    var el = e.target;
    if (!el || !el.hasAttribute || !el.hasAttribute('data-cell')) return;
    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    var k = el.getAttribute('data-key'), f = el.getAttribute('data-field');
    var tf = e.key === 'ArrowUp' ? (f === 'out' ? 'in' : 'in') : 'out';
    if (e.key === 'Enter' && f === 'out') tf = 'in';
    var next = document.querySelector('[data-cell][data-key="' + k + '"][data-field="' + tf + '"]');
    if (e.key === 'Enter' && f === 'out') { var cols = Array.from(document.querySelectorAll('[data-cell][data-field="in"]')), i = cols.findIndex(function (x) { return x.getAttribute('data-key') === k; }); next = cols[i + 1] || null; }
    if (next && !next.disabled) { next.focus(); next.select && next.select(); } else el.blur();
  });
  $('#btnSettings').addEventListener('click', openConn);
  $('#btnLogout').addEventListener('click', function () {
    state.cfg = { mode: 'local', owner: '', repo: '', branch: 'main', role: 'owner', remember: true, token: '' };
    saveCfg(state.cfg);
    try { localStorage.removeItem(NOLOGIN_KEY); } catch (e) { /* ничего */ }
    boot();
  });
  $('#btnReload').addEventListener('click', async function () { await boot(); toast('Данные обновлены', 'ok'); });
  $('#tabs').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var i = TABS.findIndex(function (t) { return t[0] === state.tab; });
    i = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    state.tab = TABS[i][0]; render();
    var b = $('.tab[aria-selected="true"]'); if (b) b.focus();
  });

  boot();
})();
