-- thailand-provinces: relational schema (ANSI SQL; PostgreSQL / MySQL 8 / SQLite)
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
