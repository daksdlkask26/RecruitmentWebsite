import { describe, expect, it } from "vitest";
import { calculateAutomaticMatch } from "@/backend/scoring/domain/automatic-match-calculator";
import { partitionJobSkillsForMatching } from "@/backend/scoring/domain/job-skill-requirement-policy";

const base = {
  applicationId: "app-1",
  cvVersion: "CV-v1",
  jdVersion: "JD-v3",
  configVersion: "HS-40/60-v1",
  parserVersion: "parser-v2.4",
  cvParse: {
    code: "PARSED_SUCCESSFULLY" as const,
    label: "Parsed successfully" as const,
    parserVersion: "parser-v2.4",
    processingMilliseconds: 12,
    snapshotVersion: "CV-v1",
  },
  jdParse: {
    code: "PARSED_SUCCESSFULLY" as const,
    label: "Parsed successfully" as const,
    parserVersion: "parser-v2.4",
    processingMilliseconds: 12,
    snapshotVersion: "JD-v3",
  },
  requiredSkills: [
    { code: "react", label: "React" },
    { code: "typescript", label: "TypeScript" },
  ],
  preferredSkills: [{ code: "docker", label: "Docker" }],
  minimumExperienceYears: 4,
  now: new Date("2026-08-18T12:00:00.000Z"),
};

describe("deterministic automatic matching", () => {
  it("is reproducible and keeps preferred skills neutral", () => {
    const input = {
      ...base,
      cvText: "React and TypeScript delivery for 5 years. Docker exposure.",
    };
    const first = calculateAutomaticMatch(input);
    const second = calculateAutomaticMatch(input);
    expect(first.result).toEqual(second.result);
    expect(first.result.score).toBe(100);
    expect(first.preferredSkillBonus).toBe(0);
  });

  it("separates missing skills and does not infer unmentioned experience", () => {
    const result = calculateAutomaticMatch({
      ...base,
      cvText: "Built React interfaces.",
    }).result;
    expect(
      result.missingRequiredSkills.map((skill) => skill.skillCode),
    ).toEqual(["typescript"]);
    expect(result.detectedExperience).toEqual({
      kind: "NOT_DETECTED",
      label: "Not detected",
    });
    expect(result.score).toBe(37.5);
  });

  it("reports absent technical skills as missing for a legacy all-preferred job", () => {
    const matchingSkills = partitionJobSkillsForMatching([
      { code: "cpp", label: "C++", required: false },
      { code: "java", label: "Java", required: false },
      { code: "typescript", label: "TypeScript", required: false },
    ]);
    const result = calculateAutomaticMatch({
      ...base,
      requiredSkills: matchingSkills.requiredSkills,
      preferredSkills: matchingSkills.preferredSkills,
      minimumExperienceYears: 0,
      cvText: "Built Python automation scripts and maintained SQL reports.",
    }).result;

    expect(result.foundRequiredSkills).toHaveLength(0);
    expect(result.missingRequiredSkills.map((skill) => skill.label)).toEqual([
      "C++",
      "Java",
      "TypeScript",
    ]);
    expect(result.preferredSkills).toHaveLength(0);
    expect(result.score).toBe(25);
  });

  it("marks parser warnings without removing deterministic evidence", () => {
    const result = calculateAutomaticMatch({
      ...base,
      cvText: "React for 4 years",
      cvParse: {
        ...base.cvParse,
        code: "PARSED_WITH_ERRORS",
        label: "Parsed with errors",
      },
    }).result;
    expect(result.mayBeIncomplete).toBe(true);
    expect(result.incompletenessLabel).toContain("parsing");
    expect(result.foundRequiredSkills[0]?.evidence[0]?.sectionLabel).toBe(
      "CV body",
    );
  });

  it("matches only controlled semantic aliases and keeps verbatim evidence", () => {
    const result = calculateAutomaticMatch({
      ...base,
      requiredSkills: [
        { code: "problem-solving", label: "Problem Solving" },
        { code: "teamwork", label: "Teamwork" },
      ],
      cvText:
        "Troubleshot production equipment and worked as a collaborative team player for 4 years.",
    }).result;
    expect(result.foundRequiredSkills.map((skill) => skill.skillCode)).toEqual([
      "problem-solving",
      "teamwork",
    ]);
    expect(result.foundRequiredSkills[0]?.evidence[0]?.excerpt).toContain(
      "Troubleshot production equipment",
    );
    expect(result.score).toBe(100);
  });

  it("does not treat a partial word as a skill match", () => {
    const result = calculateAutomaticMatch({
      ...base,
      requiredSkills: [{ code: "teamwork", label: "Teamwork" }],
      cvText: "The candidate completed paperwork for 4 years.",
    }).result;
    expect(result.foundRequiredSkills).toHaveLength(0);
    expect(
      result.missingRequiredSkills.map((skill) => skill.skillCode),
    ).toEqual(["teamwork"]);
  });

  it("does not promote weak or explicitly negative evidence", () => {
    const result = calculateAutomaticMatch({
      ...base,
      requiredSkills: [
        { code: "english", label: "English Proficiency" },
        { code: "planning", label: "Planning" },
        { code: "attention", label: "Attention to Detail" },
      ],
      cvText:
        "English - Elementary (self-study, no certificate). No professional experience with planning or attention-to-detail tasks required in a work setting.",
    }).result;
    expect(result.foundRequiredSkills).toHaveLength(0);
    expect(
      result.missingRequiredSkills.map((skill) => skill.skillCode),
    ).toEqual(["english", "planning", "attention"]);
  });

  it("keeps later positive evidence after an earlier negative mention", () => {
    const result = calculateAutomaticMatch({
      ...base,
      requiredSkills: [{ code: "planning", label: "Planning" }],
      cvText:
        "No professional experience with planning. Planned and delivered a training roadmap for 4 years.",
    }).result;
    expect(result.foundRequiredSkills.map((skill) => skill.skillCode)).toEqual([
      "planning",
    ]);
    expect(result.foundRequiredSkills[0]?.evidence[0]?.excerpt).toContain(
      "Planned and delivered",
    );
  });

  it("normalizes aliases for criteria containing punctuation", () => {
    const result = calculateAutomaticMatch({
      ...base,
      requiredSkills: [{ code: "transport", label: "Transport & Warehousing" }],
      cvText:
        "Handled inventory counting and warehouse stock control for 4 years.",
    }).result;
    expect(result.foundRequiredSkills.map((skill) => skill.skillCode)).toEqual([
      "transport",
    ]);
    expect(result.foundRequiredSkills[0]?.evidence[0]?.excerpt).toContain(
      "inventory counting",
    );
  });

  it("does not penalize a CV when the job has no minimum experience", () => {
    const result = calculateAutomaticMatch({
      ...base,
      minimumExperienceYears: 0,
      cvText: "React and TypeScript projects.",
    });
    expect(result.experiencePoints).toBe(25);
    expect(result.result.score).toBe(100);
  });

  it("treats an absent required-skill list as neutral rather than a zero", () => {
    const result = calculateAutomaticMatch({
      ...base,
      requiredSkills: [],
      minimumExperienceYears: 4,
      cvText: "No explicit duration was provided.",
    });
    expect(result.requiredSkillPoints).toBe(75);
    expect(result.result.score).toBe(75);
  });

  it("recognizes month-based experience without inventing a full year", () => {
    const result = calculateAutomaticMatch({
      ...base,
      cvText: "React and TypeScript delivery for 18 months.",
    });
    expect(result.result.detectedExperience).toEqual({
      kind: "DETECTED",
      years: 1.5,
      label: "1.5 years detected",
    });
    expect(result.experiencePoints).toBe(9.375);
  });

  it("recovers role duration from work-history date ranges without counting education dates", () => {
    const result = calculateAutomaticMatch({
      ...base,
      cvText:
        "WORK EXPERIENCE\nIT Comtor 06/2024 – Present\nEDUCATION\nBachelor 2019–2023",
    }).result;
    expect(result.detectedExperience.kind).toBe("DETECTED");
    expect(
      result.detectedExperience.kind === "DETECTED"
        ? result.detectedExperience.years
        : 0,
    ).toBeGreaterThan(1);
  });

  it("does not count flattened-PDF education dates as employment", () => {
    const result = calculateAutomaticMatch({
      ...base,
      cvText:
        "WORK EXPERIENCE IT Comtor 06/2024 – Present IT Project Support 03/2023 – 05/2024 EDUCATION Bachelor 2019 – 2023",
    }).result;
    expect(result.detectedExperience.kind).toBe("DETECTED");
    expect(
      result.detectedExperience.kind === "DETECTED"
        ? result.detectedExperience.years
        : 0,
    ).toBeLessThan(3);
  });

  it("unions overlapping work ranges instead of double-counting them", () => {
    const result = calculateAutomaticMatch({
      ...base,
      cvText:
        'WORK EXPERIENCE "startDate":"2020","endDate":"2022" "startDate":"2021","endDate":"2023"',
    }).result;
    expect(result.detectedExperience).toMatchObject({
      kind: "DETECTED",
      years: 3,
      mergedIntervals: [
        { startMonth: 2020 * 12, endMonthExclusive: 2023 * 12 },
      ],
    });
    expect(
      result.detectedExperience.kind === "DETECTED"
        ? result.detectedExperience.intervals
        : [],
    ).toHaveLength(2);
  });

  it("uses the injected clock for open-ended ranges", () => {
    const fixed = calculateAutomaticMatch({
      ...base,
      now: new Date("2024-08-18T12:00:00.000Z"),
      cvText: "WORK EXPERIENCE\n01/2023 – Present",
    }).result;
    const later = calculateAutomaticMatch({
      ...base,
      now: new Date("2026-08-18T12:00:00.000Z"),
      cvText: "WORK EXPERIENCE\n01/2023 – Present",
    }).result;
    expect(
      fixed.detectedExperience.kind === "DETECTED"
        ? fixed.detectedExperience.years
        : 0,
    ).toBe(20 / 12);
    expect(
      later.detectedExperience.kind === "DETECTED"
        ? later.detectedExperience.years
        : 0,
    ).toBe(44 / 12);
    expect(
      fixed.detectedExperience.kind === "DETECTED"
        ? fixed.detectedExperience.intervals?.[0]?.endToken
        : undefined,
    ).toBe("Present");
  });

  it("recognizes Vietnamese open-ended date tokens", () => {
    const result = calculateAutomaticMatch({
      ...base,
      cvText: "KINH NGHIỆM VIỆC LÀM\n01/2023 – Hiện tại",
    }).result;
    expect(result.detectedExperience.kind).toBe("DETECTED");
    expect(
      result.detectedExperience.kind === "DETECTED"
        ? result.detectedExperience.intervals?.[0]?.endToken
        : undefined,
    ).toBe("Hiện tại");
  });

  it("does not turn malformed or reversed dates into confident zero experience", () => {
    const result = calculateAutomaticMatch({
      ...base,
      cvText: "WORK EXPERIENCE\n2024 – 2022",
    }).result;
    expect(result.detectedExperience).toEqual({
      kind: "NOT_DETECTED",
      label: "Not detected",
      incomplete: true,
    });
    expect(result.mayBeIncomplete).toBe(true);
    expect(result.incompletenessLabel).toContain("employment dates");
  });

  it("keeps verbatim evidence for skills listed in a flattened CV and repeated in work bullets", () => {
    const result = calculateAutomaticMatch({
      ...base,
      requiredSkills: [
        { code: "data-analysis", label: "Data Analysis" },
        { code: "process-improvement", label: "Process Improvement" },
        { code: "problem-solving", label: "Problem Solving" },
      ],
      preferredSkills: [],
      cvText: [
        "SKILLS React Native TypeScript JavaScript (ES6+) REST API Integration Git Data Analysis Process Improvement Problem Solving Agile/Scrum",
        "WORK EXPERIENCE React Native Developer",
        "Performed data analysis on crash reports and performance metrics to prioritize technical debt and improve app stability.",
        "Contributed to process improvement by introducing code review checklists, cutting release regression issues by 25%.",
        "Practiced problem-solving skills by debugging cross-platform layout issues on iOS and Android.",
      ].join(" "),
    }).result;

    expect(result.foundRequiredSkills.map((skill) => skill.skillCode)).toEqual([
      "data-analysis",
      "process-improvement",
      "problem-solving",
    ]);
    expect(
      result.foundRequiredSkills.map((skill) => skill.evidence[0]?.excerpt),
    ).toEqual([
      expect.stringContaining("Performed data analysis"),
      expect.stringContaining("Contributed to process improvement"),
      expect.stringContaining("Practiced problem-solving"),
    ]);
  });

  it("matches Vietnamese evidence with or without diacritics", () => {
    const result = calculateAutomaticMatch({
      ...base,
      requiredSkills: [{ code: "communication", label: "Communication" }],
      cvText: "Có kỹ năng giao tiếp và làm việc với khách hàng trong 4 năm.",
    }).result;
    expect(result.foundRequiredSkills.map((skill) => skill.skillCode)).toEqual([
      "communication",
    ]);
    expect(result.foundRequiredSkills[0]?.evidence[0]?.excerpt).toContain(
      "giao tiếp",
    );

    const unaccented = calculateAutomaticMatch({
      ...base,
      requiredSkills: [{ code: "negotiation", label: "Negotiation" }],
      cvText: "Ky nang dam phan hop dong trong 4 nam.",
    }).result;
    expect(
      unaccented.foundRequiredSkills.map((skill) => skill.skillCode),
    ).toEqual(["negotiation"]);
  });
});
