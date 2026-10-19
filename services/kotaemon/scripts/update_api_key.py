"""Update Model Studio-backed component specs with the current API key."""

import json
import os
import sqlite3
from pathlib import Path


def current_key() -> str:
    for line in Path("/home/lh/race/kotaemon/.env").read_text(
        encoding="utf-8"
    ).splitlines():
        if line.startswith("OPENAI_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError("OPENAI_API_KEY is missing")


key = current_key()
database = sqlite3.connect(
    "/home/lh/race/kotaemon/ktem_app_data/user_data/sql.db"
)
updated = 0
try:
    for table in ("llm_table", "embedding", "reranking"):
        try:
            rows = database.execute(
                f"SELECT name, spec FROM {table}"
            ).fetchall()
        except sqlite3.OperationalError:
            continue
        for name, raw_spec in rows:
            spec = json.loads(raw_spec or "{}")
            if "aliyuncs.com" not in str(spec.get("base_url", "")):
                continue
            spec["api_key"] = key
            database.execute(
                f"UPDATE {table} SET spec = ? WHERE name = ?",
                (
                    json.dumps(spec, ensure_ascii=False),
                    name,
                ),
            )
            updated += 1
    database.commit()
finally:
    database.close()

print(f"Updated {updated} Model Studio component spec(s).")
