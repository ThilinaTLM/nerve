import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeSqlRow,
  decodeSqlRows,
  sqlBytes,
  sqlEnum,
  sqlInteger,
  sqlNullableInteger,
  sqlString,
} from "../../../src/infrastructure/persistence/canonical-sqlite/sql-row-decoder.js";

describe("SQLite row decoding", () => {
  it("decodes valid driver values", () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const row = decodeSqlRow(
      {
        id: "record_1",
        revision: 2,
        optional: null,
        data: bytes,
        kind: "run",
      },
      "fixture",
    );

    assert.equal(sqlString(row, "id", "fixture"), "record_1");
    assert.equal(sqlInteger(row, "revision", "fixture"), 2);
    assert.equal(sqlNullableInteger(row, "optional", "fixture"), null);
    assert.equal(sqlBytes(row, "data", "fixture"), bytes);
    assert.equal(
      sqlEnum(row, "kind", ["message", "run"] as const, "fixture"),
      "run",
    );
  });

  it("identifies the query and field for malformed values", () => {
    assert.throws(
      () => sqlInteger({ revision: 1.5 }, "revision", "documents[3]"),
      /documents\[3\]\.revision: expected safe integer/,
    );
    assert.throws(
      () => sqlBytes({ data: null }, "data", "documents[3]"),
      /documents\[3\]\.data: expected text or bytes/,
    );
    assert.throws(
      () => sqlEnum({ kind: "other" }, "kind", ["run"] as const, "records"),
      /records\.kind: unknown value/,
    );
    assert.throws(() => decodeSqlRow(null, "documents"), /documents/);
  });

  it("decodes row arrays in stable order and reports the failing index", () => {
    assert.deepEqual(
      decodeSqlRows([{ value: 1 }, { value: 2 }], "values", (row, index) => ({
        index,
        value: sqlInteger(row, "value", `values[${index}]`),
      })),
      [
        { index: 0, value: 1 },
        { index: 1, value: 2 },
      ],
    );
    assert.throws(
      () =>
        decodeSqlRows([{}], "values", (row) =>
          sqlString(row, "id", "values[0]"),
        ),
      /values\[0\]\.id/,
    );
  });
});
