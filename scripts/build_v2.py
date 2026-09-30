#!/usr/bin/env python3
"""
scripts/build_v2.py
Builds the v2 address dataset (province -> district -> subdistrict + postal code)
from thailand-geography-json (MIT, https://github.com/thailand-geography-data/thailand-geography-json).

Outputs (all under v2/):
  address.json          compact bundle for the whole country (one request)
  provinces.json        provinces only (tiny; for the first dropdown)
  province/{code}.json  one province with nested districts + subdistricts (lazy mode)
  meta.json             version, counts, content hash

and relational exports for databases (under db/):
  provinces.csv, districts.csv, subdistricts.csv, thai_address.csv (flat)
  schema.sql            CREATE TABLE (ANSI; works on PostgreSQL / MySQL / SQLite)
  data.sql              INSERT statements (multi-row, wrapped in a transaction)

The legacy files (provinces.json, amphur/*.json) are NOT touched. Each v2
province/district carries a `legacy` id so old consumers can migrate.

Usage:
  python3 scripts/build_v2.py [--src DIR_OR_URL]
"""

import argparse
import csv
import hashlib
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "v2"
DB = ROOT / "db"
UPSTREAM = "https://raw.githubusercontent.com/thailand-geography-data/thailand-geography-json/main/src/"
BANGKOK = 10


def load(src: str, name: str):
    if src.startswith("http"):
        req = urllib.request.Request(src + name, headers={"User-Agent": "thailand-provinces-build/2"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    return json.loads((Path(src) / name).read_text(encoding="utf-8"))


def dump(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text + "\n", encoding="utf-8", newline="\n")
    return text


def legacy_maps():
    """legacy province id / amphur id, matched by Thai name (verified 77/77 and 928/928)."""
    prov = json.loads((ROOT / "provinces.json").read_text(encoding="utf-8"))
    by_name = {v["t"]: int(k) for k, v in prov.items()}
    dist = {}  # (province legacy id, district name without เขต) -> legacy amphur id
    for pid in prov:
        for aid, v in json.loads((ROOT / "amphur" / f"{pid}.json").read_text(encoding="utf-8")).items():
            name = v["t"][3:] if v["t"].startswith("เขต") else v["t"]
            dist[(int(pid), name)] = int(aid)
    return by_name, dist


def sql_str(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def write_csv(path: Path, header, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:   # plain UTF-8, no BOM
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)


SCHEMA = """-- thailand-provinces: relational schema (ANSI SQL; PostgreSQL / MySQL 8 / SQLite)
-- Codes are official (PP / PPDD / PPDDSS). legacy_id = id used by the old provinces.json / amphur/*.json.
-- MySQL: create the database with utf8mb4 (CREATE DATABASE x CHARACTER SET utf8mb4).

CREATE TABLE th_provinces (
  code        INTEGER      NOT NULL PRIMARY KEY,
  name_th     VARCHAR(100) NOT NULL,
  name_en     VARCHAR(100) NOT NULL,
  legacy_id   INTEGER      NOT NULL
);

CREATE TABLE th_districts (
  code          INTEGER      NOT NULL PRIMARY KEY,
  province_code INTEGER      NOT NULL REFERENCES th_provinces (code),
  name_th       VARCHAR(100) NOT NULL,
  name_en       VARCHAR(100) NOT NULL,
  legacy_id     INTEGER      NOT NULL
);

CREATE TABLE th_subdistricts (
  code          INTEGER      NOT NULL PRIMARY KEY,
  district_code INTEGER      NOT NULL REFERENCES th_districts (code),
  province_code INTEGER      NOT NULL REFERENCES th_provinces (code),
  name_th       VARCHAR(100) NOT NULL,
  name_en       VARCHAR(100) NOT NULL,
  postal_code   CHAR(5)      NOT NULL
);

CREATE INDEX idx_th_districts_province    ON th_districts (province_code);
CREATE INDEX idx_th_subdistricts_district ON th_subdistricts (district_code);
CREATE INDEX idx_th_subdistricts_postal   ON th_subdistricts (postal_code);
"""


def write_sql(prov_rows, dist_rows, sub_rows):
    DB.mkdir(parents=True, exist_ok=True)
    (DB / "schema.sql").write_text(SCHEMA, encoding="utf-8", newline="\n")

    def inserts(table, cols, rows, size=500):
        out = []
        for i in range(0, len(rows), size):
            vals = ",\n".join("  (" + ", ".join(r) + ")" for r in rows[i:i + size])
            out.append(f"INSERT INTO {table} ({', '.join(cols)}) VALUES\n{vals};\n")
        return "".join(out)

    lines = ["-- thailand-provinces data. Load db/schema.sql first.\nBEGIN;\n\n"]
    lines.append(inserts("th_provinces", ["code", "name_th", "name_en", "legacy_id"],
                         [[str(c), sql_str(th), sql_str(en), str(lg)] for c, th, en, lg in prov_rows]))
    lines.append("\n" + inserts("th_districts", ["code", "province_code", "name_th", "name_en", "legacy_id"],
                                [[str(c), str(c // 100), sql_str(th), sql_str(en), str(lg)] for c, th, en, lg in dist_rows]))
    lines.append("\n" + inserts("th_subdistricts", ["code", "district_code", "province_code", "name_th", "name_en", "postal_code"],
                                [[str(c), str(c // 100), str(c // 10000), sql_str(th), sql_str(en), sql_str(f"{z:05d}")]
                                 for c, th, en, z in sub_rows]))
    lines.append("\nCOMMIT;\n")
    (DB / "data.sql").write_text("".join(lines), encoding="utf-8", newline="\n")


def write_db_exports(prov_rows, dist_rows, sub_rows):
    write_csv(DB / "provinces.csv", ["code", "name_th", "name_en", "legacy_id"], prov_rows)
    write_csv(DB / "districts.csv", ["code", "province_code", "name_th", "name_en", "legacy_id"],
              [[c, c // 100, th, en, lg] for c, th, en, lg in dist_rows])
    write_csv(DB / "subdistricts.csv", ["code", "district_code", "province_code", "name_th", "name_en", "postal_code"],
              [[c, c // 100, c // 10000, th, en, f"{z:05d}"] for c, th, en, z in sub_rows])
    pth = {r[0]: r[1:3] for r in prov_rows}
    dth = {r[0]: r[1:3] for r in dist_rows}
    write_csv(DB / "thai_address.csv",
              ["subdistrict_code", "subdistrict_th", "subdistrict_en", "district_code", "district_th", "district_en",
               "province_code", "province_th", "province_en", "postal_code"],
              [[c, th, en, c // 100, *dth[c // 100], c // 10000, *pth[c // 10000], f"{z:05d}"] for c, th, en, z in sub_rows])
    write_sql(prov_rows, dist_rows, sub_rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=UPSTREAM)
    src = ap.parse_args().src

    P = sorted(load(src, "provinces.json"), key=lambda x: x["provinceCode"])
    D = sorted(load(src, "districts.json"), key=lambda x: x["districtCode"])
    S = sorted(load(src, "subdistricts.json"), key=lambda x: x["subdistrictCode"])
    lp, ld = legacy_maps()

    # Codes are hierarchical (PP / PPDD / PPDDSS) so the compact bundle
    # stores no parent ids: parent = code // 100 (subdistrict -> district -> province).
    prov_rows, dist_rows, sub_rows = [], [], []
    for p in P:
        lid = lp[p["provinceNameTh"]]
        prov_rows.append([p["provinceCode"], p["provinceNameTh"], p["provinceNameEn"], lid])
    for d in D:
        assert d["districtCode"] // 100 == d["provinceCode"]
        pth = next(p["provinceNameTh"] for p in P if p["provinceCode"] == d["provinceCode"])
        aid = ld[(lp[pth], d["districtNameTh"])]
        dist_rows.append([d["districtCode"], d["districtNameTh"], d["districtNameEn"], aid])
    for s in S:
        assert s["subdistrictCode"] // 100 == s["districtCode"]
        sub_rows.append([s["subdistrictCode"], s["subdistrictNameTh"], s["subdistrictNameEn"], s["postalCode"]])

    bundle = {
        "v": 2,
        "cols": {
            "p": ["code", "th", "en", "legacy"],
            "d": ["code", "th", "en", "legacy"],
            "s": ["code", "th", "en", "zip"],
        },
        "p": prov_rows,
        "d": dist_rows,
        "s": sub_rows,
    }
    text = dump(OUT / "address.json", bundle)
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]
    bundle["hash"] = digest
    dump(OUT / "address.json", bundle)

    dump(OUT / "provinces.json", {"v": 2, "hash": digest, "cols": bundle["cols"]["p"], "p": prov_rows})

    dists_by_p, subs_by_d = {}, {}
    for r in dist_rows:
        dists_by_p.setdefault(r[0] // 100, []).append(r)
    for r in sub_rows:
        subs_by_d.setdefault(r[0] // 100, []).append(r)
    for pr in prov_rows:
        ds = dists_by_p[pr[0]]
        ss = [r for d in ds for r in subs_by_d[d[0]]]
        dump(OUT / "province" / f"{pr[0]}.json", {
            "v": 2, "hash": digest, "cols": bundle["cols"], "p": [pr], "d": ds, "s": ss,
        })

    write_db_exports(prov_rows, dist_rows, sub_rows)

    dump(OUT / "meta.json", {
        "v": 2, "hash": digest,
        "counts": {"provinces": len(prov_rows), "districts": len(dist_rows), "subdistricts": len(sub_rows)},
        "source": "thailand-geography-data/thailand-geography-json (MIT)",
    })
    print(f"provinces={len(prov_rows)} districts={len(dist_rows)} subdistricts={len(sub_rows)} hash={digest}")


if __name__ == "__main__":
    main()
