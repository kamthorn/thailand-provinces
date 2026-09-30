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

## ทดสอบ
`node --test tests/thai-address.test.js`

## เกี่ยวกับ thai-break-dict-extra
`data/proper-names/{provinces,districts,subdistricts}.txt` ใน [thai-break-dict-extra](https://github.com/kamthorn/thai-break-dict-extra) เป็นรายชื่อล้วน (ไม่มีลำดับชั้น/zip) เหมาะเป็นพจนานุกรมตัดคำ ไม่ใช่ตัวข้อมูลหลักของฟอร์ม
โปรเจคต์นี้ใช้แนวเดียวกัน (ชื่อเรียกย่อ กรุงเทพฯ/อยุธยา/โคราช และตัวย่อ จ. อ. ต.) ใน `db.search/parse` โดยไม่ต้องพึ่ง tokenizer
ถ้าต้องการตัดคำที่อยู่ยาวๆ ที่ไม่มีเครื่องหมายคั่น ให้ใช้ thai-break + words-extra ตัดคำก่อน แล้วส่งแต่ละคำเข้า `db.search`
