// D1-Ersatz auf node:sqlite: genau die Teile der D1-Schnittstelle, die der Worker nutzt
// (prepare().bind().first/all/run und batch als eine Transaktion), mit dem Schema aus migrations/.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const MIGRATION = new URL("../migrations/0001_init.sql", import.meta.url);
const READS = /^\s*(select|with)\b/i;

function execute(db, sql, params) {
  const statement = db.prepare(sql);
  if (READS.test(sql)) return { success: true, results: statement.all(...params).map((row) => ({ ...row })), meta: {} };
  return { success: true, results: [], meta: { changes: statement.run(...params).changes } };
}

/** `stats` zählt Anweisungen und Rundläufe (ein Aufruf oder ein Batch je Rundlauf), damit Tests Abläufe vergleichen können. */
export function createD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(MIGRATION, "utf8"));
  const stats = { statements: 0, roundTrips: 0 };

  const singleRoundTrip = (work) => async (...args) => {
    stats.statements += 1;
    stats.roundTrips += 1;
    return work(...args);
  };

  const prepare = (sql, params = []) => {
    const executeOnce = singleRoundTrip(() => execute(db, sql, params));
    return {
      sql,
      params,
      bind: (...bound) => prepare(sql, bound),
      all: executeOnce,
      run: executeOnce,
      first: singleRoundTrip((column) => {
        const row = db.prepare(sql).get(...params);
        return row === undefined ? null : column === undefined ? { ...row } : row[column];
      }),
    };
  };

  const batch = async (statements) => {
    stats.statements += statements.length;
    stats.roundTrips += 1;
    db.exec("BEGIN");
    try {
      const results = statements.map(({ sql, params }) => execute(db, sql, params));
      db.exec("COMMIT");
      return results;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  return { prepare, batch, stats, raw: db };
}
