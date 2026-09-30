// node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const TA = require('../thai-address.js');

const V2 = path.join(__dirname, '..', 'v2');
const fakeFetch = (fail) => async (url) => {
  const u = String(url);
  if (fail && fail(u)) throw new Error('offline');
  const f = path.join(V2, u.split('/v2/')[1]);
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')) };
};
const opts = { baseUrl: 'http://x/v2/', cache: false, backoff: 1, retries: 1 };

test('bundle loads with expected counts', async () => {
  global.fetch = fakeFetch();
  const db = await TA.load(opts);
  assert.equal(db.P.length, 77); assert.equal(db.D.length, 928); assert.equal(db.S.length, 7436);
  assert.equal(db.districts(10).length, 50);
});

test('cascade + labels', async () => {
  global.fetch = fakeFetch();
  const db = await TA.load(opts);
  const bkk = db.provinces().find(p => p.th === 'กรุงเทพมหานคร');
  assert.equal(db.labels(bkk.code).district, 'เขต');
  const d = db.districts(bkk.code).find(x => x.th === 'บางรัก');
  assert.ok(db.subdistricts(d.code).some(s => s.th === 'สีลม'));
});

test('search: name, alias, english, zip', async () => {
  global.fetch = fakeFetch();
  const db = await TA.load(opts);
  assert.ok(db.search('สีลม')[0].text.includes('สีลม'));
  assert.equal(db.search('สีลม กทม')[0].province.en, 'Bangkok');
  assert.equal(db.search('ต.สีลม อ.บางรัก')[0].district.th, 'บางรัก');
  assert.ok(db.search('silom')[0].subdistrict.th === 'สีลม');
  assert.ok(db.search('10500').every(a => a.zip === 10500));
  assert.ok(db.search('โคราช').every(a => a.province.th === 'นครราชสีมา'));
  assert.deepEqual(db.search('ไม่มีที่นี่'), []);
});

test('parse pasted address', async () => {
  global.fetch = fakeFetch();
  const db = await TA.load(opts);
  let r = db.parse('99/1 ม.5 ต.บางรัก อ.บางรัก กทม 10500');
  assert.ok(r.best, JSON.stringify(r.candidates.map(c => [c.text, c.score])));
  assert.equal(r.best.district.th, 'บางรัก');
  r = db.parse('123 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110');
  assert.equal(r.best.subdistrict.th, 'คลองเตย');
  r = db.parse('55 หมู่ 3 ตำบลสุเทพ อำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่ 50200');
  assert.equal(r.best.subdistrict.th, 'สุเทพ'); assert.equal(r.best.province.th, 'เชียงใหม่');
  assert.equal(db.parse('สวัสดีครับ').best, null);
});

test('falls back to per-province files when bundle fails', async () => {
  global.fetch = fakeFetch(u => u.endsWith('address.json'));
  let state; const db = await TA.load({ ...opts, onStatus: s => { state = s.state; } });
  assert.equal(state, 'fallback'); assert.ok(db.partial);
  assert.equal(db.P.length, 77); assert.equal(db.districts(10).length, 0);
  await db.ensureProvince(10);
  assert.equal(db.districts(10).length, 50);
});

test('v2 legacy ids match legacy files', () => {
  const lp = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'provinces.json'), 'utf8'));
  const b = JSON.parse(fs.readFileSync(path.join(V2, 'address.json'), 'utf8'));
  for (const r of b.p) assert.equal(lp[r[3]].t, r[1]);
  const la = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'amphur', '1.json'), 'utf8'));
  const d = b.d.find(x => x[0] === 1001); assert.equal(la[d[3]].t.replace('เขต', ''), d[1]);
});
