import { describe, expect, it } from "vitest";

import {
  assertPhase7DatabaseName,
  phase7DatabaseOwnershipMarker,
  quotePhase7DatabaseIdentifier,
} from "../../../scripts/phase7-isolated-db.mjs";

describe("Phase 7 isolated database helper", () => {
  it.each([
    "candidate_phase7_final_desktop_test",
    "candidate_phase7_public_overlay_spec",
    "candidate_phase7_zoom_e2e",
  ])("accepts the task-owned namespace %s", (name) => {
    expect(assertPhase7DatabaseName(name)).toBe(name);
    expect(quotePhase7DatabaseIdentifier(name)).toBe(`"${name}"`);
  });

  it.each([
    "smarthire",
    "smarthire_test",
    "candidate_phase7_test",
    "candidate_phase7_final",
    "candidate_phase7_final_test;drop_database_smarthire",
    'candidate_phase7_final_test"',
    "candidate-phase7-final-test",
  ])("rejects unsafe or unowned name %s", (name) => {
    expect(() => assertPhase7DatabaseName(name)).toThrow(
      "PHASE7_ISOLATED_DATABASE_NAME_INVALID",
    );
  });

  it("uses an explicit ownership marker before destructive cleanup", () => {
    expect(phase7DatabaseOwnershipMarker).toBe(
      "nextgen-careers:candidate-first:phase7:task-owned:v1",
    );
  });
});
