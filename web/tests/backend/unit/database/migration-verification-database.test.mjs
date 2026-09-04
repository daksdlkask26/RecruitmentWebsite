import { describe, expect, it } from "vitest";
import {
  databaseUrlFor,
  parseEnvironment,
  quoteIdentifier,
  selectDatabaseConnectionString,
} from "../../../../../scripts/lib/migration-verification-database.mjs";

describe("migration verification database configuration", () => {
  it("prefers CI process environment URLs over local files", () => {
    expect(
      selectDatabaseConnectionString(
        {
          DIRECT_URL: "postgresql://ci:ci@localhost:5432/ci_database",
          DATABASE_URL: "postgresql://ci:ci@localhost:5432/ci_pool",
        },
        { DIRECT_URL: "postgresql://local:local@localhost:5432/local" },
      ),
    ).toBe("postgresql://ci:ci@localhost:5432/ci_database");
  });

  it("falls back to the optional local application environment", () => {
    expect(
      selectDatabaseConnectionString(
        {},
        { DATABASE_URL: "postgres://local:local@localhost:5432/smarthire" },
      ),
    ).toBe("postgres://local:local@localhost:5432/smarthire");
  });

  it("rejects missing and non-PostgreSQL connection URLs", () => {
    expect(() => selectDatabaseConnectionString({})).toThrow(
      "db:verify requires DIRECT_URL or DATABASE_URL",
    );
    expect(() =>
      selectDatabaseConnectionString({ DIRECT_URL: "https://example.test" }),
    ).toThrow("db:verify requires a PostgreSQL connection URL");
  });

  it("retargets the database while preserving connection options", () => {
    expect(
      databaseUrlFor(
        "postgresql://ci:ci@localhost:5432/smarthire_test?schema=public",
        "smarthire_migration_verify",
      ).toString(),
    ).toBe(
      "postgresql://ci:ci@localhost:5432/smarthire_migration_verify?schema=public",
    );
  });

  it("parses quoted environment values and safely quotes identifiers", () => {
    expect(
      parseEnvironment(
        '# ignored\nDIRECT_URL="postgresql://user:pass@localhost:5432/app"\n',
      ),
    ).toEqual({
      DIRECT_URL: "postgresql://user:pass@localhost:5432/app",
    });
    expect(quoteIdentifier('database"name')).toBe('"database""name"');
  });
});
