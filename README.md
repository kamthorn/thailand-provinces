# thailand-provinces

รายชื่อจังหวัด / อำเภอ(เขต) / ตำบล(แขวง) + รหัสไปรษณีย์ของไทย เป็น static JSON พร้อมไลบรารีเล็กๆ (`thai-address.js`, ไม่มี dependency) สำหรับทำฟอร์มป้อนที่อยู่
หน้าหลัก ([index.html](index.html)) เป็นตัวอย่างใช้งาน: ค้นหาช่องเดียว, เลือกทีละขั้น, วางที่อยู่ทั้งบรรทัดให้แยกให้

## ข้อมูล

| รูปแบบ | ไฟล์ | หมายเหตุ |
|---|---|---|
| **v2 (แนะนำ)** | `v2/address.json` | ทั้งประเทศในไฟล์เดียว ~438 KB (~116 KB gzip) มีรหัสทางการ + ตำบล + zip |
| | `v2/provinces.json` | จังหวัดอย่างเดียว ~4 KB |
| | `v2/province/{code}.json` | 1 จังหวัด พร้อมอำเภอและตำบล ≤ ~17 KB (โหมดสำรองเมื่อเน็ตช้า) |
| | `v2/meta.json` | เวอร์ชัน/จำนวน/hash |
| **เดิม (legacy)** | `provinces.json`, `amphur/{id}.json` | **ไม่เปลี่ยนแปลง** ใช้ต่อได้เหมือนเดิม |

v2 เป็นตารางแบบ array (ลดขนาด) ดูชื่อคอลัมน์ใน `cols` รหัสเป็นรหัสทางการ (`PP`, `PPDD`, `PPDDSS`) จึงหา parent ได้ด้วย `code / 100`
แต่ละจังหวัด/อำเภอมีฟิลด์ `legacy` = id ในไฟล์เดิม เพื่อ migrate ง่าย (ตรวจแล้วตรงครบ 77 จังหวัด, 928 อำเภอ/เขต)

สร้างใหม่: `python3 scripts/build_v2.py` (ดึงจาก [thailand-geography-json](https://github.com/thailand-geography-data/thailand-geography-json), MIT)

## ใช้ใน browser

```html
<script src="thai-address.js"></script>
<script>
  const db = await ThaiAddress.load({ baseUrl: './v2/' });
  db.provinces();            // [{code, th, en, legacy}]
  db.districts(10);          // เขตของ กทม.   (db.labels(10) -> เขต/แขวง)
  db.subdistricts(1004);     // แขวงของเขตบางรัก (มี zip)
  db.search('สีลม กทม');     // ชื่อ/ชื่ออังกฤษ/ชื่อย่อ/ชื่อเล่น (โคราช, อยุธยา)/รหัสไปรษณีย์
  db.byZip(10500);
  db.parse('99/1 ม.5 ต.บางรัก อ.บางรัก กทม 10500'); // {best, candidates}
</script>
```

### รับมือเน็ตช้า/หลุด
- แคชใน `localStorage` แล้วอัปเดตเบื้องหลัง (stale-while-revalidate) — เปิดครั้งที่สองไม่ต้องรอเน็ต
- timeout + retry แบบ exponential backoff (`timeout`, `retries`, `backoff`)
- ถ้าไฟล์รวมโหลดไม่ได้ จะถอยไปโหมดโหลดทีละจังหวัด (`onStatus` แจ้ง `fallback`, เรียก `await db.ensureProvince(code)` ก่อนใช้ `districts()`; โหมดนี้ `search()` ค้นได้เฉพาะจังหวัดที่โหลดแล้ว)

### ออฟไลน์ (service worker)
หน้าตัวอย่างลงทะเบียน `sw.js` (ต้องเป็น https หรือ localhost): หน้า/ไลบรารีใช้ network-first แล้วถอยไปแคช, ข้อมูล `v2/` ใช้แคชทันทีแล้วอัปเดตเบื้องหลัง เมื่อเปลี่ยนกลยุทธ์หรือรายการไฟล์ให้แก้ `VERSION` ใน `sw.js`

## นำเข้าฐานข้อมูล (`db/`)

ดาวน์โหลด: เปิดโฟลเดอร์ [`db/`](db/) บน repo หรือโหลดจากหน้าเว็บ https://kamthorn.github.io/thailand-provinces/#download
(ไฟล์ตรงๆ เช่น `https://kamthorn.github.io/thailand-provinces/db/thai_address.csv`)

| ไฟล์ | เนื้อหา |
|---|---|
| `db/provinces.csv` | `code, name_th, name_en, legacy_id` (77 แถว) |
| `db/districts.csv` | `code, province_code, name_th, name_en, legacy_id` (928 แถว) |
| `db/subdistricts.csv` | `code, district_code, province_code, name_th, name_en, postal_code` (7,436 แถว) |
| `db/thai_address.csv` | ตารางเดียวแบบ flat ระดับตำบล (มีชื่อ/รหัสของอำเภอและจังหวัดครบ) |
| `db/schema.sql` | `CREATE TABLE th_provinces / th_districts / th_subdistricts` พร้อม FK และ index |
| `db/data.sql` | `INSERT` ทั้งหมด (ครอบด้วย transaction) |

- CSV เป็น UTF-8 ไม่มี BOM (เปิดใน Excel แล้วภาษาไทยเพี้ยน ให้ import แบบเลือก UTF-8)
- `postal_code` เป็น `CHAR(5)` ส่วน `code` เป็นรหัสทางการของกรมการปกครอง (`PP`, `PPDD`, `PPDDSS`) ใช้เป็น foreign key ในระบบของคุณได้เลย
- โหลด: `psql -f db/schema.sql -f db/data.sql`, `sqlite3 app.db < db/schema.sql && sqlite3 app.db < db/data.sql`, MySQL 8 สร้าง DB เป็น `utf8mb4` ก่อน แล้ว `mysql db < db/schema.sql` และ `< db/data.sql`
- ทดสอบโหลดจริงใน SQLite (นับแถว, FK, ลำดับชั้น) ใน CI; PostgreSQL/MySQL เขียนเป็น ANSI SQL แต่ยังไม่ได้ทดสอบกับเซิร์ฟเวอร์จริง
- ไฟล์ทั้งหมดสร้างจาก `python3 scripts/build_v2.py` (พร้อม `v2/`)

## ทดสอบ
`node --test tests/thai-address.test.js` และ `python3 -m unittest discover tests`

## เกี่ยวกับ thai-break-dict-extra
`data/proper-names/{provinces,districts,subdistricts}.txt` ใน [thai-break-dict-extra](https://github.com/kamthorn/thai-break-dict-extra) เป็นรายชื่อล้วน (ไม่มีลำดับชั้น/zip) เหมาะเป็นพจนานุกรมตัดคำ ไม่ใช่ตัวข้อมูลหลักของฟอร์ม
โปรเจคต์นี้ใช้แนวเดียวกัน (ชื่อเรียกย่อ กรุงเทพฯ/อยุธยา/โคราช และตัวย่อ จ. อ. ต.) ใน `db.search/parse` โดยไม่ต้องพึ่ง tokenizer
ถ้าต้องการตัดคำที่อยู่ยาวๆ ที่ไม่มีเครื่องหมายคั่น ให้ใช้ thai-break + words-extra ตัดคำก่อน แล้วส่งแต่ละคำเข้า `db.search`
