/*
 * Расчётное ядро: разбор отчётов маркетплейсов (WB, Яндекс Маркет, Ozon) и все формулы.
 * Без обращения к DOM и сети, поэтому тот же файл запускается и в браузере, и в Node (для проверки).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MONTHS_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  var MARKET_LABEL = { wb: 'WB', ym: 'Яндекс Маркет', ozon: 'Ozon', other: 'Другой' };
  // Строки ОПиУ, которые входят в «ФОТ и сервисы», и строка «услуги фулфилмента»
  var FOT_LABELS = ['ФОТ', 'Внешняя логистика', 'Сервисы; Программное обеспечение', 'Сертификация и регистрация торговых марок'];
  var FULFILL_LABEL = 'Услуги Фулфилмента';
  var LOAD_TOLERANCE = 0.25;
  var NET_LABEL = 'Чистая прибыль';
  var INTEREST_LABEL = 'Выплата процентов по кредитным обязательствам';
  var DEFAULT_SHARE = 1 / 3; // доля продаж, относящаяся к инвестору

  // Названия листов и столбцов в отчётах разных маркетплейсов
  var SHEETS_ARTICLES = ['По артикулам', 'Артикулы'];
  var SHEETS_OPIU = ['ОПиУ - месяцы', 'ОПиУ'];
  var COL_ARTICLE = ['Артикул продавца'];
  var COL_SALES = ['Продажи (органические)'];
  var COL_PRICE = ['Средний чек продажи до СПП', 'Ср цена реализации до СПП', 'Средняя цена продажи до СПП'];
  var COL_PROFIT = ['Операционная прибыль на единицу', 'Операционная прибыль на единицу продаж'];

  // Соответствие артикулов и товаров инвестора. Редактируется на вкладке «Справочник».
  function defaultMapping() {
    return {
      // WB
      'Набор медиум': 'Наборы медиум',
      'Культиватор ручной': 'Культиваторы ручные',
      'Пила 8 дюймов': 'Пилы 8"',
      'Секатор голубой': 'Секаторы',
      'Душ_серый 8000': 'Души серые',
      'Душ_зеленый 10000': 'Души зеленые',
      'Душ_черный 12000': 'Души черные',
      'Гриль с окошком металлик': 'Аэрогрили',
      'Культиватор со штангой': 'Культиваторы со штангой',
      'Пила 6 дюймов': 'Пилы 6"',
      // Яндекс Маркет и Ozon (только однозначные названия, остальное сопоставляется вручную)
      'культиватор_штанга': 'Культиваторы со штангой',
      'культиватор_со_штангой': 'Культиваторы со штангой',
      'медиум_д': 'Наборы медиум',
      'Душ_зелёный': 'Души зеленые',
      'садовыйдуш_зеленый': 'Души зеленые',
      'душ_серый': 'Души серые',
      'садовыйдуш_серый': 'Души серые',
      'пила8_д': 'Пилы 8"',
      'пила6_д': 'Пилы 6"',
      'секатор': 'Секаторы'
    };
  }

  function defaultSettings() {
    return {
      openingBalance: 0,        // входящее сальдо самого первого месяца
      openingCumulative: 0,     // прибыль накопленным итогом до первого месяца
      investorShare: DEFAULT_SHARE, // доля органических продаж инвестора
      defaultFotPct: 0.10,      // если в отчёте не нашёлся нужный месяц
      defaultFulfillPct: 0.01,
      mapping: defaultMapping()
    };
  }

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  function validKey(k) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(k)); }
  function prevKey(key) {
    var p = key.split('-').map(Number);
    return p[1] === 1 ? (p[0] - 1) + '-12' : p[0] + '-' + String(p[1] - 1).padStart(2, '0');
  }
  function monthLabel(key) {
    var p = key.split('-').map(Number);
    var m = MONTHS_RU[p[1] - 1];
    return m.charAt(0).toUpperCase() + m.slice(1) + ' ' + p[0];
  }

  // «1/3», «0,5», «33%» → число от 0 до 1 (NaN, если не разобрать)
  function parseShare(v) {
    if (typeof v === 'number') return v;
    var s = String(v == null ? '' : v).trim().replace(',', '.');
    if (!s) return NaN;
    if (s.indexOf('/') > 0) { var p = s.split('/'); var b = parseFloat(p[1]); return b ? parseFloat(p[0]) / b : NaN; }
    if (/%$/.test(s)) return parseFloat(s) / 100;
    var n = parseFloat(s);
    return n > 1 ? n / 100 : n;
  }
  function formatShare(x) {
    var fr = [[1, 1], [1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [1, 5]];
    for (var i = 0; i < fr.length; i++) if (Math.abs(x - fr[i][0] / fr[i][1]) < 1e-6) return fr[i][0] + '/' + fr[i][1];
    return (Math.round(x * 10000) / 100).toString().replace('.', ',') + '%';
  }

  /* ---------- Разбор файла отчёта ---------- */
  function findSheet(wb, names) {
    var low = names.map(norm);
    for (var i = 0; i < wb.SheetNames.length; i++) if (low.indexOf(norm(wb.SheetNames[i])) >= 0) return wb.SheetNames[i];
    return null;
  }
  // Листы, которые нужно прочитать (остальные тяжёлые листы отчёта пропускаем)
  function neededSheets(sheetNames) {
    var want = SHEETS_ARTICLES.concat(SHEETS_OPIU, ['Информационный лист']).map(norm);
    return sheetNames.filter(function (n) { return want.indexOf(norm(n)) >= 0; });
  }
  function pickCol(header, names) {
    for (var i = 0; i < names.length; i++) {
      var idx = header.findIndex(function (h) { return typeof h === 'string' && norm(h) === norm(names[i]); });
      if (idx >= 0) return { idx: idx, name: names[i] };
    }
    return { idx: -1, name: names[0] };
  }
  function detectMarket(priceName, sheetNames) {
    if (priceName === 'Средний чек продажи до СПП') return 'wb';
    if (priceName === 'Ср цена реализации до СПП') return 'ym';
    if (priceName === 'Средняя цена продажи до СПП') return 'ozon';
    var low = sheetNames.map(norm);
    if (low.indexOf('периоды') >= 0) return 'ozon';
    return 'other';
  }
  function readEntity(XLSX, wb) {
    var sh = findSheet(wb, ['Информационный лист']);
    if (!sh) return '';
    var rows = XLSX.utils.sheet_to_json(wb.Sheets[sh], { header: 1, defval: null, raw: true });
    for (var r = 0; r < Math.min(rows.length, 40); r++) {
      var row = rows[r] || [];
      for (var c = 0; c < row.length; c++) {
        if (typeof row[c] === 'string' && norm(row[c]) === 'юрлицо') {
          var below = rows[r + 1] && rows[r + 1][c];
          if (typeof below === 'string' && below.trim()) return below.trim();
        }
      }
    }
    return '';
  }

  function parseReport(XLSX, wb, key, fileName) {
    var warnings = [];
    var artName = findSheet(wb, SHEETS_ARTICLES);
    if (!artName) throw new Error('В файле нет листа «По артикулам» или «Артикулы». Проверьте, что это отчёт маркетплейса.');
    var rows = XLSX.utils.sheet_to_json(wb.Sheets[artName], { header: 1, defval: null, raw: true });

    var h = -1;
    for (var r = 0; r < Math.min(rows.length, 60) && h < 0; r++) {
      var row = rows[r] || [];
      for (var c = 0; c < row.length; c++) {
        if (typeof row[c] === 'string' && norm(row[c]) === norm(COL_ARTICLE[0])) { h = r; break; }
      }
    }
    if (h < 0) throw new Error('На листе «' + artName + '» не найден столбец «Артикул продавца».');

    var header = rows[h].map(function (x) { return typeof x === 'string' ? x.trim() : x; });
    var cA = pickCol(header, COL_ARTICLE), cS = pickCol(header, COL_SALES), cP = pickCol(header, COL_PRICE), cU = pickCol(header, COL_PROFIT);
    var missing = [];
    if (cS.idx < 0) missing.push('«' + COL_SALES[0] + '»');
    if (cP.idx < 0) missing.push('«' + COL_PRICE.join('» / «') + '»');
    if (cU.idx < 0) missing.push('«' + COL_PROFIT.join('» / «') + '»');
    if (missing.length) throw new Error('На листе «' + artName + '» не найдены столбцы: ' + missing.join(', ') + '. Возможно, изменилась структура отчёта.');

    var byArt = new Map();
    for (var i = h + 1; i < rows.length; i++) {
      var rw = rows[i];
      if (!rw) continue;
      var nm = rw[cA.idx];
      if (typeof nm !== 'string' || !nm.trim()) continue;
      nm = nm.trim();
      if (/^итого/i.test(nm) || nm === '-1') continue;
      var sales = num(rw[cS.idx]), price = num(rw[cP.idx]), pu = num(rw[cU.idx]);
      var a = byArt.get(nm);
      if (!a) { a = { article: nm, orgSales: 0, wPrice: 0, wProfit: 0, w: 0, fPrice: 0, fProfit: 0 }; byArt.set(nm, a); }
      a.orgSales += sales;
      if (sales > 0) { a.wPrice += price * sales; a.wProfit += pu * sales; a.w += sales; }
      if (price) a.fPrice = price;
      if (pu) a.fProfit = pu;
    }
    var articles = Array.from(byArt.values()).map(function (a) {
      return {
        article: a.article,
        orgSales: a.orgSales,
        price: a.w > 0 ? a.wPrice / a.w : a.fPrice,
        profitUnit: a.w > 0 ? a.wProfit / a.w : a.fProfit
      };
    });
    if (!articles.length) warnings.push('На листе «' + artName + '» не найдено ни одной строки с артикулом.');

    // Расходы из ОПиУ: суммы за месяц и «Реализация до СПП» как база для процентов
    var amounts = null, pctFound = false;
    var opName = findSheet(wb, SHEETS_OPIU);
    var monthName = MONTHS_RU[Number(key.split('-')[1]) - 1];
    if (!opName) {
      warnings.push('В файле нет листа ОПиУ — проценты ФОТ и фулфилмента нужно ввести вручную.');
    } else {
      var op = XLSX.utils.sheet_to_json(wb.Sheets[opName], { header: 1, defval: null, raw: true });
      var vc = -1;
      for (var rr = 0; rr < Math.min(op.length, 6) && vc < 0; rr++) {
        var orow = op[rr] || [];
        for (var cc = 0; cc < orow.length; cc++) {
          if (typeof orow[cc] === 'string' && norm(orow[cc]) === monthName) { vc = cc; break; }
        }
      }
      if (vc < 0) {
        warnings.push('Месяц «' + monthName + '» не найден на листе «' + opName + '» — проценты нужно ввести вручную.');
      } else {
        var firstRow = function (test) {
          for (var q = 0; q < op.length; q++) {
            var lab = op[q] && op[q][2];
            if (typeof lab === 'string' && test(norm(lab))) {
              var v = op[q][vc];
              return typeof v === 'number' ? Math.abs(v) : 0;
            }
          }
          return undefined; // строки нет вообще
        };
        var base = firstRow(function (l) { return /^реализация\s*\(?\s*до спп\s*\)?$/.test(l); });
        var sum = 0, notFound = [];
        FOT_LABELS.forEach(function (l) {
          var v = firstRow(function (x) { return x === norm(l); });
          if (v === undefined) notFound.push(l); else sum += v;
        });
        // Значение со знаком (чистая прибыль может быть отрицательной)
        var signed = function (test) {
          for (var q2 = 0; q2 < op.length; q2++) {
            var lab2 = op[q2] && op[q2][2];
            if (typeof lab2 === 'string' && test(norm(lab2))) { var v2 = op[q2][vc]; return typeof v2 === 'number' ? v2 : 0; }
          }
          return undefined;
        };
        var netV = signed(function (x) { return x === norm(NET_LABEL); });
        var intV = signed(function (x) { return x === norm(INTEREST_LABEL); });
        var f = firstRow(function (x) { return x === norm(FULFILL_LABEL); });
        if (f === undefined) notFound.push(FULFILL_LABEL);
        if (notFound.length) warnings.push('На листе «' + opName + '» не найдены строки: ' + notFound.join('; ') + '.');
        if (!base) {
          warnings.push('На листе «' + opName + '» нет «Реализация до СПП» за этот месяц — проценты нужно ввести вручную.');
        } else {
          amounts = { fot: sum, fulfill: f || 0, base: base };
          // Полная нагрузка: всё, что отделяет валовую прибыль по артикулам от чистой прибыли ОПиУ,
          // кроме процентов по кредитам (они не относятся к инвестору) и фулфилмента (считается отдельно)
          if (netV !== undefined) {
            var gross = articles.reduce(function (t, a2) { return t + a2.orgSales * a2.profitUnit; }, 0);
            amounts.net = netV; amounts.interest = Math.abs(intV || 0); amounts.gross = gross;
            // Страховка: если недели на листе артикулов не соответствуют месяцу, выручка по артикулам сильно разойдётся с ОПиУ
            var artRev = articles.reduce(function (t, a3) { return t + a3.orgSales * a3.price; }, 0);
            if (Math.abs(artRev / base - 1) <= LOAD_TOLERANCE) amounts.load = gross - netV - amounts.interest - (f || 0);
            else warnings.push('Выручка по артикулам (' + Math.round(artRev) + ' ₽) расходится с ОПиУ (' + Math.round(base) + ' ₽) больше чем на ' + Math.round(LOAD_TOLERANCE * 100) + '%: проверьте недели на листе «' + artName + '». Расходы посчитаны только по ФОТ, логистике и сервисам.');
          } else warnings.push('На листе «' + opName + '» не найдена строка «' + NET_LABEL + '» — расходы посчитаны по ФОТ, логистике и сервисам без налогов.');
          pctFound = true;
        }
      }
    }
    var market = detectMarket(cP.name, wb.SheetNames);
    var entity = readEntity(XLSX, wb);
    return {
      id: market + '|' + norm(entity || fileName || ''),
      marketplace: market, entity: entity, file: fileName || '',
      articles: articles,
      amounts: amounts, pctFound: pctFound,
      fotPct: amounts ? (amounts.load !== undefined ? amounts.load : amounts.fot) / amounts.base : null,
      fulfillPct: amounts ? amounts.fulfill / amounts.base : null,
      warnings: warnings
    };
  }

  // Общие проценты по нескольким отчётам: сумма расходов / сумма «Реализации до СПП».
  // Если во всех отчётах есть чистая прибыль ОПиУ, берётся полная нагрузка (режим 'full'),
  // иначе только ФОТ, логистика и сервисы (режим 'basic').
  function blendPct(sources) {
    var list = (sources || []).filter(function (s) { return s.amounts && s.amounts.base > 0; });
    if (!list.length) return { fotPct: null, fulfillPct: null, found: false, count: 0, mode: 'basic' };
    var full = list.every(function (s) { return s.amounts.load !== undefined; });
    var fot = 0, ful = 0, base = 0;
    list.forEach(function (s) { fot += full ? s.amounts.load : s.amounts.fot; ful += s.amounts.fulfill; base += s.amounts.base; });
    return { fotPct: fot / base, fulfillPct: ful / base, found: true, count: list.length, mode: full ? 'full' : 'basic' };
  }

  /* ---------- Расчёт месяца ---------- */
  function recSources(rec) {
    if (rec.sources && rec.sources.length) return rec.sources;
    if (rec.articles) return [{ id: 'legacy', marketplace: 'wb', entity: '', articles: rec.articles }];
    return [];
  }
  function shareOf(rec) { return rec.share > 0 && rec.share <= 1 ? rec.share : DEFAULT_SHARE; }

  function groupByProduct(rec, mapping) {
    var map = new Map();
    Object.keys(mapping || {}).forEach(function (k) { map.set(norm(k), mapping[k]); });
    var groups = new Map(), unmapped = [];
    recSources(rec).forEach(function (src) {
      (src.articles || []).forEach(function (a) {
        var p = map.get(norm(a.article));
        if (!p) { if (a.orgSales > 0) unmapped.push({ article: a.article, orgSales: a.orgSales, marketplace: src.marketplace, entity: src.entity }); return; }
        var g = groups.get(p);
        if (!g) { g = { product: p, rows: [], orgSales: 0, wPrice: 0, wProfit: 0, w: 0, fPrice: 0, fProfit: 0 }; groups.set(p, g); }
        g.rows.push({ marketplace: src.marketplace, entity: src.entity, article: a.article, orgSales: a.orgSales, price: a.price, profitUnit: a.profitUnit });
        g.orgSales += a.orgSales;
        if (a.orgSales > 0) { g.wPrice += a.price * a.orgSales; g.wProfit += a.profitUnit * a.orgSales; g.w += a.orgSales; }
        if (a.price) g.fPrice = a.price;
        if (a.profitUnit) g.fProfit = a.profitUnit;
      });
    });
    return { groups: Array.from(groups.values()), unmapped: unmapped };
  }

  // Продано для инвестора = доля (по умолчанию 1/3) органических продаж, округлённая вверх
  function soldOf(orgSales, share) { return Math.ceil(orgSales * share - 1e-9); }

  function monthSold(rec, mapping, availFn) {
    var out = {}, share = shareOf(rec);
    groupByProduct(rec, mapping).groups.forEach(function (g) { var sold = soldOf(g.orgSales, share); out[g.product] = availFn ? Math.max(0, Math.min(sold, availFn(g.product))) : sold; });
    return out;
  }

  // costFn(product) -> себестоимость за шт или null, если неизвестна
  function computeMonth(rec, mapping, costFn, availFn) {
    var gp = groupByProduct(rec, mapping), share = shareOf(rec);
    var fot = num(rec.fotPct), ful = num(rec.fulfillPct);
    var totals = { sold: 0, revenue: 0, gross: 0, fulfill: 0, fot: 0, net: 0, cogs: 0 };
    var missingCost = [], noStock = [], capped = [];
    var products = gp.groups.map(function (g) {
      var raw = soldOf(g.orgSales, share), sold = raw;
      // Продажи учитываются только по товарам, которые есть у инвестора в наличии
      // и не больше остатка на складе
      if (availFn) {
        var lim = Math.max(0, availFn(g.product));
        if (lim <= 0) { sold = 0; if (raw > 0) noStock.push({ product: g.product, sold: raw }); }
        else if (raw > lim) { sold = lim; capped.push({ product: g.product, raw: raw, sold: lim }); }
      }
      // Средние по всем кабинетам и маркетплейсам, взвешенные по органическим продажам
      var price = g.w > 0 ? g.wPrice / g.w : g.fPrice;
      var pu = g.w > 0 ? g.wProfit / g.w : g.fProfit;
      var cost = costFn ? costFn(g.product) : null;
      if (cost == null && sold > 0) missingCost.push(g.product);
      var revenue = sold * price, gross = sold * pu;
      var fulfill = revenue * ful, fotSum = revenue * fot;
      var net = gross - fulfill - fotSum;
      var cogs = sold * (cost || 0);
      var p = { product: g.product, rows: g.rows, orgSales: g.orgSales, sold: sold, price: price, profitUnit: pu, cost: cost, revenue: revenue, gross: gross, fulfill: fulfill, fot: fotSum, net: net, cogs: cogs };
      Object.keys(totals).forEach(function (k) { totals[k] += p[k] || 0; });
      return p;
    });
    products.sort(function (a, b) { return b.revenue - a.revenue; });
    totals.avgProfit = totals.sold ? totals.gross / totals.sold : 0;
    return { products: products, totals: totals, unmapped: gp.unmapped, missingCost: missingCost, noStock: noStock, capped: capped, share: share };
  }

  /* ---------- Партии, остатки, потери ---------- */
  function sortBatches(list) {
    return list.slice().sort(function (a, b) {
      return a.month.localeCompare(b.month) || (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id));
    });
  }
  // Последняя известная себестоимость товара на месяц key
  function costOf(batches, product, key) {
    var c = sortBatches(batches.filter(function (b) { return b.product === product && b.month <= key; }));
    return c.length ? num(c[c.length - 1].cost) : null;
  }

  // Списание проданного и потерянного по принципу FIFO со складских партий.
  // Продажи месяца учитываются только по товарам, которые есть у инвестора на складе.
  function replayStock(data, upToKey) {
    var batches = data.ledger.batches, losses = data.ledger.losses, mapping = data.settings.mapping;
    var rem = {}, short = {}, availByKey = {}, soldByKey = {}, excludedByKey = {};
    batches.forEach(function (b) { rem[b.id] = num(b.qty); });
    var keys = new Set(Object.keys(data.months).filter(function (k) { return k <= upToKey; }));
    losses.forEach(function (l) { if (l.month <= upToKey) keys.add(l.month); });
    Array.from(keys).sort().forEach(function (key) {
      var raw = data.months[key] ? monthSold(data.months[key], mapping) : {};
      var lossQ = {}, products = {};
      Object.keys(raw).forEach(function (p) { products[p] = 1; });
      losses.forEach(function (l) { if (l.month === key) { lossQ[l.product] = (lossQ[l.product] || 0) + num(l.qty); products[l.product] = 1; } });
      availByKey[key] = {}; soldByKey[key] = {}; excludedByKey[key] = {};
      Object.keys(products).forEach(function (p) {
        var pool = sortBatches(batches.filter(function (b) { return b.product === p && b.status === 'склад' && b.month <= key; }));
        var have = Math.max(0, pool.reduce(function (t, b) { return t + rem[b.id]; }, 0) - (lossQ[p] || 0));
        var ok = have > 0;
        availByKey[key][p] = have;
        var sold = Math.min(raw[p] || 0, have);
        soldByKey[key][p] = sold;
        if (raw[p] > sold) excludedByKey[key][p] = raw[p] - sold;
        var need = sold + (lossQ[p] || 0);
        for (var i = 0; i < pool.length && need > 0; i++) {
          var take = Math.min(rem[pool[i].id], need);
          rem[pool[i].id] -= take; need -= take;
        }
        if (need > 0) short[p] = (short[p] || 0) + need;
      });
    });
    return { rem: rem, short: short, availByKey: availByKey, soldByKey: soldByKey, excludedByKey: excludedByKey };
  }

  // «Деньги в товаре» на конец месяца key
  function moneyInGoods(data, key) {
    var st = replayStock(data, key);
    var wh = [], tr = [];
    sortBatches(data.ledger.batches.filter(function (b) { return b.month <= key; })).forEach(function (b) {
      if (b.status === 'путь') tr.push({ batch: b, qty: num(b.qty), value: num(b.qty) * num(b.cost) });
      else if (st.rem[b.id] > 0) wh.push({ batch: b, qty: st.rem[b.id], value: st.rem[b.id] * num(b.cost) });
    });
    var sum = function (l) { return l.reduce(function (s, x) { return s + x.value; }, 0); };
    var byName = function (a, b) { return a.batch.product.localeCompare(b.batch.product, 'ru') || a.batch.month.localeCompare(b.batch.month); };
    wh.sort(byName); tr.sort(byName);
    return { warehouse: wh, transit: tr, totalWarehouse: sum(wh), totalTransit: sum(tr), total: sum(wh) + sum(tr), short: st.short };
  }

  // Движение остатков на складе за месяц, шт: было + закуплено − продано − потеряно = стало
  function stockMovement(data, key) {
    var batches = data.ledger.batches, mapping = data.settings.mapping, map = {};
    var get = function (p) { return map[p] || (map[p] = { product: p, open: 0, incoming: 0, sold: 0, lost: 0, close: 0, short: 0 }); };
    var now = replayStock(data, key), prev = replayStock(data, prevKey(key));
    batches.forEach(function (b) {
      if (b.status !== 'склад') return;
      if (b.month <= prevKey(key)) get(b.product).open += prev.rem[b.id] || 0;
      if (b.month === key) get(b.product).incoming += num(b.qty);
      if (b.month <= key) get(b.product).close += now.rem[b.id] || 0;
    });
    var sold = now.soldByKey[key] || {};
    Object.keys(sold).forEach(function (p) { get(p).sold += sold[p]; });
    data.ledger.losses.forEach(function (l) { if (l.month === key) get(l.product).lost += num(l.qty); });
    Object.keys(now.short).forEach(function (p) { get(p).short = Math.max(0, now.short[p] - (prev.short[p] || 0)); });
    return Object.keys(map).map(function (p) { return map[p]; }).filter(function (r) {
      return r.open || r.incoming || r.sold || r.lost || r.close || r.short;
    }).sort(function (a, b) { return a.product.localeCompare(b.product, 'ru'); });
  }

  /* ---------- Движение денежных средств ---------- */
  function buildLedger(data) {
    var s = data.settings, L = data.ledger, flows = data.flows || {}, months = data.months;
    var set = new Set(Object.keys(months));
    Object.keys(flows).forEach(function (k) { set.add(k); });
    L.batches.forEach(function (b) { if (!b.opening) set.add(b.month); });
    L.losses.forEach(function (l) { set.add(l.month); });
    L.corrections.forEach(function (c) { set.add(c.month); });
    var keys = Array.from(set).filter(validKey).sort();

    var cash = num(s.openingBalance), cum = num(s.openingCumulative);
    var byKey = {}, stock = replayStock(data, '9999-12');
    keys.forEach(function (key) {
      var rec = months[key];
      var av = stock.availByKey[key] || {};
      var calc = rec ? computeMonth(rec, s.mapping, function (p) { return costOf(L.batches, p, key); }, function (p) { return av[p] || 0; }) : null;
      var cogs = calc ? calc.totals.cogs : 0, net = calc ? calc.totals.net : 0;

      var purchaseLines = L.batches.filter(function (b) { return b.month === key && !b.opening; }).map(function (b) {
        var orig = b.costOriginal != null ? num(b.costOriginal) : num(b.cost);
        return { batch: b, value: orig * num(b.qty) };
      });
      var purchases = purchaseLines.reduce(function (t, x) { return t + x.value; }, 0);

      var lossLines = L.losses.filter(function (l) { return l.month === key; }).map(function (l) {
        var c = costOf(L.batches, l.product, key) || 0;
        return { loss: l, cost: c, value: c * num(l.qty) };
      });
      var lossValue = lossLines.reduce(function (t, x) { return t + x.value; }, 0);

      var corrLines = L.corrections.filter(function (c) { return c.month === key; });
      var corrSum = corrLines.reduce(function (t, c) { return t + num(c.amount); }, 0);

      var f = flows[key] || {};
      var inflow = num(f.in), outflow = num(f.out);
      var start = cash;
      var end = start + cogs + net - lossValue - purchases + corrSum + inflow - outflow;
      cum += net;
      byKey[key] = { key: key, start: start, cogs: cogs, net: net, purchases: purchases, purchaseLines: purchaseLines, lossValue: lossValue, lossLines: lossLines, corrSum: corrSum, corrLines: corrLines, inflow: inflow, outflow: outflow, end: end, cumProfit: cum, calc: calc };
      cash = end;
    });
    return { keys: keys, byKey: byKey };
  }

  return {
    MONTHS_RU: MONTHS_RU, MARKET_LABEL: MARKET_LABEL, FOT_LABELS: FOT_LABELS, FULFILL_LABEL: FULFILL_LABEL, DEFAULT_SHARE: DEFAULT_SHARE,
    defaultMapping: defaultMapping, defaultSettings: defaultSettings,
    norm: norm, num: num, validKey: validKey, prevKey: prevKey, monthLabel: monthLabel, parseShare: parseShare, formatShare: formatShare,
    neededSheets: neededSheets, parseReport: parseReport, blendPct: blendPct, recSources: recSources, shareOf: shareOf,
    groupByProduct: groupByProduct, monthSold: monthSold, computeMonth: computeMonth,
    sortBatches: sortBatches, costOf: costOf, replayStock: replayStock, moneyInGoods: moneyInGoods, stockMovement: stockMovement, buildLedger: buildLedger
  };
});
