import { describe, expect, it } from "vitest";

import { openSqliteDatabase } from "./sqliteAdapter";

describe("sqliteAdapter", () => {
  it("opens a database and runs basic statements", () => {
    const db = openSqliteDatabase(":memory:");
    db.exec("CREATE TABLE sample (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL);");

    const insertResult = db.prepare("INSERT INTO sample (value) VALUES (?);").run("hello") as {
      changes?: number;
      lastInsertRowid?: number;
    };
    expect(insertResult.changes).toBe(1);

    const row = db.prepare("SELECT value FROM sample WHERE id = ?;").get(1) as
      | { value?: string }
      | undefined;
    expect(row?.value).toBe("hello");

    const rows = db.prepare("SELECT value FROM sample ORDER BY id ASC;").all() as Array<{
      value?: string;
    }>;
    expect(rows.map((entry) => entry.value)).toEqual(["hello"]);

    db.close();
  });
});
