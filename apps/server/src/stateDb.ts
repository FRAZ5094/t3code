import fs from "node:fs";
import path from "node:path";

import { openSqliteDatabase, type SqliteDatabase } from "./sqliteAdapter";
import { runStateMigrations } from "./stateMigrations";

export interface StateDbOptions {
  dbPath: string;
}

export class StateDb {
  readonly dbPath: string;
  readonly db: SqliteDatabase;

  constructor(options: StateDbOptions) {
    this.dbPath = path.resolve(options.dbPath);
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = openSqliteDatabase(this.dbPath);
    runStateMigrations(this.db);
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const result = fn();
      this.db.exec("COMMIT;");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }
}
