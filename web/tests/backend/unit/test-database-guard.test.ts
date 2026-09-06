import { afterEach, describe, expect, it } from "vitest";
import {
  assertTestDatabaseEnvironment,
  parseTestDatabaseEndpoint,
  TestDatabaseGuardError,
} from "../../helpers/test-database-guard";

const savedHosts = process.env.SMART_HIRE_TEST_DB_HOSTS;
const savedSchema = process.env.SMART_HIRE_TEST_DB_SCHEMA;

afterEach(() => {
  if (savedHosts === undefined) delete process.env.SMART_HIRE_TEST_DB_HOSTS;
  else process.env.SMART_HIRE_TEST_DB_HOSTS = savedHosts;
  if (savedSchema === undefined) delete process.env.SMART_HIRE_TEST_DB_SCHEMA;
  else process.env.SMART_HIRE_TEST_DB_SCHEMA = savedSchema;
});

describe("test database safety guard", () => {
  it("accepts an isolated loopback test database and matching direct URL", () => {
    expect(
      assertTestDatabaseEnvironment({
        databaseUrl:
          "postgresql://tester:secret@localhost:55432/smarthire_test?schema=public",
        directUrl:
          "postgresql://tester:secret@localhost:55432/smarthire_test?schema=public",
      }),
    ).toEqual({
      database: {
        host: "localhost",
        port: "55432",
        database: "smarthire_test",
        schema: "public",
      },
      direct: {
        host: "localhost",
        port: "55432",
        database: "smarthire_test",
        schema: "public",
      },
    });
  });

  it("accepts IPv6 loopback URLs after normalizing URL brackets", () => {
    expect(
      parseTestDatabaseEndpoint(
        "postgresql://tester:secret@[::1]:55432/smarthire_test",
        { allowedHosts: ["[::1]"] },
      ),
    ).toMatchObject({
      host: "::1",
      port: "55432",
      database: "smarthire_test",
      schema: "public",
    });
  });

  it.each([
    [
      "development database name",
      "TEST_DATABASE_NAME_UNSAFE",
      "postgresql://tester:secret@localhost:55432/smarthire",
    ],
    [
      "non-loopback host",
      "TEST_DATABASE_HOST_UNSAFE",
      "postgresql://tester:secret@db.example.test:5432/smarthire_test",
    ],
    [
      "reserved schema",
      "TEST_DATABASE_SCHEMA_UNSAFE",
      "postgresql://tester:secret@localhost:55432/smarthire_test?schema=production",
    ],
  ])("rejects %s before any connection", (_label, code, url) => {
    expect(() => parseTestDatabaseEndpoint(url)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it("rejects mismatched direct and pooled endpoints", () => {
    expect(() =>
      assertTestDatabaseEnvironment({
        databaseUrl:
          "postgresql://tester:secret@localhost:55432/smarthire_test?schema=public",
        directUrl:
          "postgresql://tester:secret@localhost:55432/smarthire_test?schema=test_run",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "TEST_DATABASE_ENDPOINT_MISMATCH",
      } satisfies Partial<TestDatabaseGuardError>),
    );
  });

  it("rejects a missing direct URL before any connection", () => {
    expect(() =>
      assertTestDatabaseEnvironment({
        databaseUrl:
          "postgresql://tester:secret@localhost:55432/smarthire_test?schema=public",
        directUrl: "",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "TEST_DATABASE_URL_MISSING" }),
    );
  });

  it("rejects malformed percent encoding before any connection", () => {
    expect(() =>
      parseTestDatabaseEndpoint(
        "postgresql://tester:secret@localhost:55432/smarthire_%ZZ_test",
      ),
    ).toThrowError(
      expect.objectContaining({ code: "TEST_DATABASE_URL_INVALID" }),
    );
  });

  it("supports an explicitly configured isolated host and schema", () => {
    process.env.SMART_HIRE_TEST_DB_HOSTS = "db.example.test";
    process.env.SMART_HIRE_TEST_DB_SCHEMA = "test_run";
    expect(
      parseTestDatabaseEndpoint(
        "postgresql://tester:secret@db.example.test:5432/smarthire_test?schema=test_run",
      ),
    ).toMatchObject({
      host: "db.example.test",
      database: "smarthire_test",
      schema: "test_run",
    });
  });
});
