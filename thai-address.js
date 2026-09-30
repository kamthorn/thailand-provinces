/*!
 * thai-address.js — Thai address helper (province > district > subdistrict + postal code)
 * Zero dependencies, works in browsers and Node 18+. Data: ./v2/ (see scripts/build_v2.py).
 *
 *   const db = await ThaiAddress.load({ baseUrl: 'https://s.digest.in.th/v2/' });
 *   db.provinces();                 // [{code, th, en, legacy}]
 *   db.districts(10);               // districts of Bangkok
 *   db.subdistricts(1003);          // subdistricts (with zip)
 *   db.search('บางรัก');            // free text / zip / English -> full addresses
 *   db.byZip('10500');
 *   db.parse('99/1 ม.5 ต.บางรัก อ.บางรัก กทม 10500');
 *
 * Loading is built for slow / flaky networks: cached copy first (stale-while-revalidate),
 * timeout + retry with backoff, and a fallback from the single bundle to small per-province files.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ThaiAddress = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BANGKOK = 10;

  // Popular names -> official province name (Thai). Kept small on purpose; matches the aliases
  // in thai-break-dict-extra data/proper-names/provinces.txt (กรุงเทพฯ, อยุธยา, โคราช).
  var ALIASES = {
    'กทม': 'กรุงเทพมหานคร', 'กรุงเทพ': 'กรุงเทพมหานคร', 'กรุงเทพฯ': 'กรุงเทพมหานคร', 'บางกอก': 'กรุงเทพมหานคร',
    'อยุธยา': 'พระนครศรีอยุธยา', 'โคราช': 'นครราชสีมา', 'ปากน้ำ': 'สมุทรปราการ',
    'สุราษฎร์': 'สุราษฎร์ธานี', 'อุบล': 'อุบลราชธานี', 'อุดร': 'อุดรธานี', 'นครศรี': 'นครศรีธรรมราช',
    'ประจวบ': 'ประจวบคีรีขันธ์', 'ปทุม': 'ปทุมธานี'
  };

  // ---------- normalisation ----------
  var PREFIX_RE = /^(จังหวัด|จ\.|อำเภอ|อ\.|เขต|ตำบล|ต\.|แขวง|แขวง\.|กิ่งอำเภอ)\s*/;
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFC').toLowerCase()
      .replace(/[​-‍﻿]/g, '').replace(/ฯ/g, '').replace(/\s+/g, ' ').trim();
  }
  function nospace(s) { return norm(s).replace(/ /g, ''); }   // 'Si Lom' also matches 'silom'
  function stripPrefix(s) { return norm(s).replace(PREFIX_RE, ''); }

  // ---------- fetch with timeout / retry ----------
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function fetchJSON(url, o) {
    var attempt = 0;
    function once() {
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, o.timeout) : null;
      return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
        return res.json();
      }).then(function (j) { clearTimeout(timer); return j; },
              function (e) { clearTimeout(timer); throw e; });
    }
    function next() {
      return once().catch(function (e) {
        if (++attempt > o.retries) throw e;
        return sleep(o.backoff * Math.pow(2, attempt - 1)).then(next);
      });
    }
    return next();
  }

  // ---------- local cache (localStorage; every access guarded) ----------
  function cacheGet(key) {
    try { var t = localStorage.getItem(key); return t ? JSON.parse(t) : null; } catch (e) { return null; }
  }
  function cacheSet(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); return true; } catch (e) { return false; }
  }

  // ---------- database ----------
  function Database(bundle, opts) {
    this.opts = opts || {};
    this.P = []; this.D = []; this.S = [];
    this._pIdx = {}; this._dIdx = {}; this._sIdx = {};
    this._dByP = {}; this._sByD = {}; this._zip = null; this._names = null;
    this.partial = false;
    this.hash = bundle.hash || null;
    this.add(bundle);
  }

  Database.prototype.add = function (b) {
    var self = this;
    (b.p || []).forEach(function (r) {
      if (self._pIdx[r[0]]) return;
      var o = { code: r[0], th: r[1], en: r[2], legacy: r[3] };
      self.P.push(o); self._pIdx[o.code] = o;
    });
    (b.d || []).forEach(function (r) {
      if (self._dIdx[r[0]]) return;
      var pc = Math.floor(r[0] / 100);
      var o = { code: r[0], th: r[1], en: r[2], legacy: r[3], province: pc };
      self.D.push(o); self._dIdx[o.code] = o; (self._dByP[pc] = self._dByP[pc] || []).push(o);
    });
    (b.s || []).forEach(function (r) {
      if (self._sIdx[r[0]]) return;
      var dc = Math.floor(r[0] / 100);
      var o = { code: r[0], th: r[1], en: r[2], zip: r[3], district: dc, province: Math.floor(dc / 100) };
      self.S.push(o); self._sIdx[o.code] = o; (self._sByD[dc] = self._sByD[dc] || []).push(o);
    });
    this.P.sort(function (a, b) { return a.th.localeCompare(b.th, 'th'); });
    this._zip = null; this._names = null;
  };

  // Bangkok uses เขต/แขวง, every other province อำเภอ/ตำบล.
  Database.prototype.labels = function (provinceCode) {
    return provinceCode === BANGKOK
      ? { province: 'จังหวัด', district: 'เขต', subdistrict: 'แขวง' }
      : { province: 'จังหวัด', district: 'อำเภอ', subdistrict: 'ตำบล' };
  };

  Database.prototype.provinces = function () { return this.P.slice(); };
  Database.prototype.province = function (code) { return this._pIdx[code] || null; };
  Database.prototype.district = function (code) { return this._dIdx[code] || null; };
  Database.prototype.subdistrict = function (code) { return this._sIdx[code] || null; };
  Database.prototype.districts = function (pc) {
    return (this._dByP[pc] || []).slice().sort(function (a, b) { return a.th.localeCompare(b.th, 'th'); });
  };
  Database.prototype.subdistricts = function (dc) {
    return (this._sByD[dc] || []).slice().sort(function (a, b) { return a.th.localeCompare(b.th, 'th'); });
  };

  /** Full address record for a subdistrict code. */
  Database.prototype.address = function (subCode) {
    var s = this._sIdx[subCode]; if (!s) return null;
    var d = this._dIdx[s.district], p = this._pIdx[s.province], L = this.labels(p.code);
    return {
      province: p, district: d, subdistrict: s, zip: s.zip,
      text: L.subdistrict + s.th + ' ' + L.district + d.th + ' ' + (p.code === BANGKOK ? '' : L.province) + p.th + ' ' + s.zip,
      short: (p.code === BANGKOK ? 'แขวง' : 'ต.') + s.th + ' ' + (p.code === BANGKOK ? 'เขต' : 'อ.') + d.th + ' ' +
             (p.code === BANGKOK ? '' : 'จ.') + p.th + ' ' + s.zip
    };
  };

  Database.prototype._zipIndex = function () {
    if (this._zip) return this._zip;
    var z = {};
    this.S.forEach(function (s) { (z[s.zip] = z[s.zip] || []).push(s.code); });
    return (this._zip = z);
  };

  Database.prototype.byZip = function (zip) {
    var self = this;
    return (this._zipIndex()[String(zip).trim()] || []).map(function (c) { return self.address(c); });
  };

  // province aliases resolved against actual data
  Database.prototype._provinceKeys = function () {
    var self = this, keys = [];
    this.P.forEach(function (p) { keys.push([stripPrefix(p.th), p.code], [norm(p.en), p.code]); });
    Object.keys(ALIASES).forEach(function (a) {
      var t = ALIASES[a];
      self.P.forEach(function (p) { if (p.th === t) keys.push([norm(a), p.code]); });
    });
    return keys;
  };

  /**
   * Free-text search over subdistricts. Accepts Thai/English names (with or without ต./อ./จ./เขต/แขวง),
   * province aliases, or a postal code. Multiple words narrow the result (e.g. "บางรัก กทม").
   * Returns up to opts.limit (default 20) addresses, best first.
   */
  Database.prototype.search = function (q, opts) {
    var limit = (opts && opts.limit) || 20, self = this;
    var text = norm(q);
    if (!text) return [];
    if (/^\d{3,5}$/.test(text)) {
      var hits = text.length === 5 ? this.byZip(text)
        : this.S.filter(function (s) { return String(s.zip).indexOf(text) === 0; }).map(function (s) { return self.address(s.code); });
      return hits.slice(0, limit);
    }
    var words = text.split(' ').map(function (w) { return stripPrefix(w); }).filter(Boolean);
    var pkeys = this._provinceKeys();
    var out = [];
    this.S.forEach(function (s) {
      var d = self._dIdx[s.district], p = self._pIdx[s.province];
      var fields = [
        [stripPrefix(s.th), 3], [norm(s.en), 3], [nospace(s.en), 3],
        [stripPrefix(d.th), 2], [norm(d.en), 2], [nospace(d.en), 2],
        [stripPrefix(p.th), 1], [norm(p.en), 1], [nospace(p.en), 1]
      ];
      pkeys.forEach(function (k) { if (k[1] === p.code) fields.push([k[0], 1]); });
      var score = 0;
      for (var i = 0; i < words.length; i++) {
        var best = 0;
        for (var j = 0; j < fields.length; j++) {
          var f = fields[j][0], w = words[i];
          if (f === w) best = Math.max(best, fields[j][1] * 4);
          else if (f.indexOf(w) === 0) best = Math.max(best, fields[j][1] * 2);
          else if (w.length >= 2 && f.indexOf(w) > 0) best = Math.max(best, fields[j][1]);
        }
        if (!best) return;           // every word must match something
        score += best;
      }
      out.push([score, s.code]);
    });
    out.sort(function (a, b) { return b[0] - a[0] || a[1] - b[1]; });
    return out.slice(0, limit).map(function (r) { return self.address(r[1]); });
  };

  /**
   * Best-effort parse of a pasted address line. No tokenizer needed: names are matched
   * as substrings and scored, markers (ต./อ./จ./แขวง/เขต) and a 5-digit zip add weight.
   * Returns { best, candidates, zip, rest } — best is null when nothing matched.
   */
  Database.prototype.parse = function (input) {
    var self = this;
    var t = norm(input).replace(/ก\.ท\.ม\./g, 'กรุงเทพมหานคร').replace(/กทม\.?/g, 'กรุงเทพมหานคร');
    var zipM = t.match(/(?:^|\D)(\d{5})(?!\d)/), zip = zipM ? Number(zipM[1]) : null;
    var pkeys = this._provinceKeys();

    function has(name, markers) {   // -> 2 marked, 1 unmarked, 0 none
      if (!name) return 0;
      if (markers && new RegExp('(?:' + markers + ')\\s*' + escapeRe(name)).test(t)) return 2;
      return t.indexOf(name) >= 0 ? 1 : 0;
    }
    var pScore = {};
    pkeys.forEach(function (k) {
      var sc = has(k[0], 'จังหวัด|จ\\.|จ');
      if (sc) pScore[k[1]] = Math.max(pScore[k[1]] || 0, sc * (k[0].length >= 4 ? 3 : 1));
    });
    var dScore = {};
    this.D.forEach(function (d) {
      var n = stripPrefix(d.th), sc = has(n, d.province === BANGKOK ? 'เขต|อ\\.|อำเภอ' : 'อำเภอ|อ\\.|เขต');
      if (sc) dScore[d.code] = sc * 3;
      if (!dScore[d.code] && n.indexOf('เมือง') === 0) {   // "เมืองX" is often written just "X" / อ.เมือง
        var pn = self._pIdx[d.province] && stripPrefix(self._pIdx[d.province].th);
        if (/(?:อำเภอ|อ\.)\s*เมือง(?!\S)/.test(t) && pScore[d.province]) dScore[d.code] = 2;
      }
    });
    var cands = [];
    this.S.forEach(function (s) {
      var n = stripPrefix(s.th);
      var sc = has(n, 'ตำบล|ต\\.|แขวง');
      if (!sc && !(zip && s.zip === zip)) return;
      var score = sc * 3 + (dScore[s.district] || 0) + (pScore[s.province] || 0) + (zip && s.zip === zip ? 5 : 0);
      if (sc === 1 && n.length < 3) score -= 2;    // short unmarked names are noisy
      cands.push([score, s.code]);
    });
    cands.sort(function (a, b) { return b[0] - a[0] || a[1] - b[1]; });
    var top = cands.slice(0, 5).map(function (c) { var a = self.address(c[1]); a.score = c[0]; return a; });
    var best = top.length && top[0].score >= 5 ? top[0] : null;
    if (best && top[1] && top[1].score === best.score) best = null;   // ambiguous -> let the user choose
    return { best: best, candidates: top, zip: zip, input: input };
  };

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // ---------- loader ----------
  /**
   * @param {object} [o]
   * @param {string} [o.baseUrl]   folder holding v2/ (default: alongside this script, i.e. './v2/')
   * @param {number} [o.timeout=8000] ms per request
   * @param {number} [o.retries=3]
   * @param {number} [o.backoff=500]  ms, doubles each retry
   * @param {boolean} [o.cache=true]  use localStorage copy
   * @param {function} [o.onStatus]   ({state:'cache'|'network'|'fallback'|'error', ...})
   * @param {function} [o.onUpdate]   (db) when a newer network copy replaced the cached one
   */
  function load(o) {
    o = Object.assign({ baseUrl: './v2/', timeout: 8000, retries: 3, backoff: 500, cache: true, onStatus: function () {} }, o || {});
    if (o.baseUrl.slice(-1) !== '/') o.baseUrl += '/';
    var KEY = 'thai-address:v2';
    var cached = o.cache ? cacheGet(KEY) : null;

    function network() {
      return fetchJSON(o.baseUrl + 'address.json', o).then(function (b) {
        if (o.cache) cacheSet(KEY, b);
        return b;
      });
    }

    if (cached && cached.p && cached.s) {
      o.onStatus({ state: 'cache' });
      var db = new Database(cached, o);
      // refresh in the background; never block or break the UI
      network().then(function (b) {
        if (b.hash !== db.hash) { var nd = new Database(b, o); if (o.onUpdate) o.onUpdate(nd); }
        o.onStatus({ state: 'network', revalidated: true });
      }).catch(function () {});
      return Promise.resolve(db);
    }

    return network().then(function (b) {
      o.onStatus({ state: 'network' });
      return new Database(b, o);
    }).catch(function (e) {
      // Bundle failed: fall back to small per-province files, fetched lazily.
      o.onStatus({ state: 'fallback', error: String(e) });
      return fetchJSON(o.baseUrl + 'provinces.json', o).then(function (b) {
        var db = new Database(b, o);
        db.partial = true;
        var loaded = {};
        db.ensureProvince = function (code) {
          if (loaded[code] || db._dByP[code]) return Promise.resolve(db);
          return (loaded[code] = fetchJSON(o.baseUrl + 'province/' + code + '.json', o).then(function (pb) {
            db.add(pb); return db;
          }).catch(function (er) { delete loaded[code]; throw er; }));
        };
        return db;
      });
    }).catch(function (e) { o.onStatus({ state: 'error', error: String(e) }); throw e; });
  }

  // On a bundle-loaded db there is nothing to fetch; keeps caller code identical in both modes.
  Database.prototype.ensureProvince = function () { return Promise.resolve(this); };

  return { load: load, Database: Database, norm: norm, ALIASES: ALIASES, version: 2 };
});
