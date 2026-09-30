"""Loads db/schema.sql + db/data.sql into SQLite and cross-checks CSVs and v2 JSON."""
import csv, json, sqlite3, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class DbExport(unittest.TestCase):
    def setUp(self):
        self.con = sqlite3.connect(":memory:")
        self.con.execute("PRAGMA foreign_keys = ON")
        self.con.executescript((ROOT / "db" / "schema.sql").read_text(encoding="utf-8"))
        self.con.executescript((ROOT / "db" / "data.sql").read_text(encoding="utf-8"))

    def count(self, t):
        return self.con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]

    def test_counts_match_v2(self):
        b = json.loads((ROOT / "v2" / "address.json").read_text(encoding="utf-8"))
        self.assertEqual(self.count("th_provinces"), len(b["p"]))
        self.assertEqual(self.count("th_districts"), len(b["d"]))
        self.assertEqual(self.count("th_subdistricts"), len(b["s"]))

    def test_foreign_keys_and_hierarchy(self):
        self.assertEqual(self.con.execute("PRAGMA foreign_key_check").fetchall(), [])
        bad = self.con.execute("""SELECT COUNT(*) FROM th_subdistricts s JOIN th_districts d ON d.code = s.district_code
                                  WHERE d.province_code <> s.province_code""").fetchone()[0]
        self.assertEqual(bad, 0)

    def test_known_row(self):
        r = self.con.execute("""SELECT s.postal_code, d.name_th, p.name_th FROM th_subdistricts s
            JOIN th_districts d ON d.code = s.district_code JOIN th_provinces p ON p.code = s.province_code
            WHERE s.name_th = 'สีลม'""").fetchone()
        self.assertEqual(r, ("10500", "บางรัก", "กรุงเทพมหานคร"))

    def test_csv_rows_match_sql(self):
        for f, t in (("provinces", "th_provinces"), ("districts", "th_districts"), ("subdistricts", "th_subdistricts")):
            with open(ROOT / "db" / f"{f}.csv", encoding="utf-8", newline="") as fh:
                rows = list(csv.DictReader(fh))
            self.assertEqual(len(rows), self.count(t))
        with open(ROOT / "db" / "thai_address.csv", encoding="utf-8", newline="") as fh:
            self.assertEqual(len(list(csv.DictReader(fh))), self.count("th_subdistricts"))


if __name__ == "__main__":
    unittest.main()
