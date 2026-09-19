// Audit evidence only. Runs current source in an isolated VM with explicit stubs.
// Does not load app configuration, connect to a database, or call external services.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const sourceHashes = {};
function loadSource(relative, stubs) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  sourceHashes[relative] = crypto.createHash('sha256').update(source).digest('hex');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: relative,
  }).outputText;
  const exports = {};
  const context = vm.createContext({
    exports,
    require(name) {
      if (!Object.hasOwn(stubs, name)) throw new Error(`Unapproved import: ${name}`);
      return stubs[name];
    },
  });
  vm.runInContext(compiled, context, { filename: relative, timeout: 3000 });
  return exports;
}

async function main() {
  const experienceDuration = loadSource('web/src/backend/scoring/domain/experience-duration.ts', {});
  const calculator = loadSource('web/src/backend/scoring/domain/automatic-match-calculator.ts', {
    './skill-evidence-extractor': {
      extractSkillEvidence: (_text, _required, preferred) => ({
        foundRequiredSkills: [], missingRequiredSkills: [], preferredSkills: preferred,
      }),
    },
    './experience-duration': experienceDuration,
  });
  const base = {
    applicationId: 'audit-only', cvVersion: 'audit', jdVersion: 'audit',
    configVersion: 'audit', parserVersion: 'audit',
    cvParse: { code: 'PARSED_SUCCESSFULLY' }, jdParse: { code: 'PARSED_SUCCESSFULLY' },
    requiredSkills: [], preferredSkills: [], minimumExperienceYears: 10,
    now: new Date('2026-09-05T00:00:00.000Z'),
  };
  const samples = [
    ['five_consecutive_roles', 'Work Experience\nCompany A 2014 - 2016\nCompany B 2016 - 2018\nCompany C 2018 - 2020\nCompany D 2020 - 2022\nCompany E 2022 - 2024', 10],
    ['single_ten_year_role', 'Work Experience\nCompany A 2014 - 2024', 10],
    ['explicit_total_with_five_roles', '10 years of experience\nWork Experience\nCompany A 2014 - 2016\nCompany B 2016 - 2018\nCompany C 2018 - 2020\nCompany D 2020 - 2022\nCompany E 2022 - 2024', 10],
    ['overlapping_roles', 'Work Experience\nCompany A 2014 - 2020\nCompany B 2018 - 2024', 10],
  ];
  const experience = samples.map(([id, cvText, expectedCurrentYears]) => {
    const value = calculator.calculateAutomaticMatch({ ...base, cvText });
    assert.equal(value.result.detectedExperience.years, expectedCurrentYears);
    return { id, cvText, detectedYears: value.result.detectedExperience.years,
      requiredSkillPoints: value.requiredSkillPoints, experiencePoints: value.experiencePoints,
      automaticScore: value.result.score };
  });
  const preferred = calculator.calculateAutomaticMatch({
    ...base, cvText: '10 years of experience', preferredSkills: [{ skillId: 'audit-skill' }],
  });
  assert.equal(preferred.preferredSkillBonus, 0);

  let memberships = [];
  const calls = [];
  const authorization = loadSource('web/src/backend/company-members/company-team-authorization.ts', {
    'server-only': {},
    '@/backend/database/prisma': { prisma: { companyMembership: {
      async findMany(query) {
        calls.push(query);
        return memberships.filter(row => !query.where.companyId || row.companyId === query.where.companyId)
          .slice(0, query.take);
      },
    } } },
  });
  const ownerCases = [];
  for (const [id, count, companyId, expected] of [
    ['one_owner_no_scope', 1, undefined, 'company-1'],
    ['two_owners_no_scope', 2, undefined, 'TEAM_FORBIDDEN'],
    ['two_owners_explicit_scope', 2, 'company-2', 'company-2'],
    ['two_owners_foreign_scope', 2, 'company-3', 'TEAM_FORBIDDEN'],
  ]) {
    memberships = Array.from({ length: count }, (_, index) => ({
      companyId: `company-${index + 1}`, company: { displayName: `Audit ${index + 1}` },
    }));
    let observed;
    try { observed = (await authorization.requireActiveCompanyOwner('audit-user', companyId)).companyId; }
    catch (error) { observed = error.code ?? error.message; }
    assert.equal(observed, expected);
    ownerCases.push({ id, memberships: count, companyId: companyId ?? null, observed });
  }
  const inputs = ['docs/audits/system-audit.md', 'docs/audit-report.md',
    'docs/audits/verification.json'];
  for (const relative of [
    'web/src/backend/services/home/get-home-page-context.ts',
    'web/src/shared/contracts/jobs/career-paths.ts',
    'web/src/app/page.tsx',
    'web/src/frontend/components/ui/modal.tsx',
    'web/src/app/recruiter/company-settings/team/page.tsx',
    'web/src/app/recruiter/company-settings/team/applications/page.tsx',
    'web/src/app/api/recruiter/company/team/route.ts',
    'web/src/frontend/features/recruiter-workspace/company-settings-screen.tsx',
    'spec-kit/specs/015-candidate-hybrid-ranking/spec.md',
    'spec-kit/specs/015-candidate-hybrid-ranking/data-model.md',
  ]) {
    sourceHashes[relative] = crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(root, relative))).digest('hex');
  }
  const reportHashes = Object.fromEntries(inputs.map(relative => [relative,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex')]));
  console.log(JSON.stringify({
    recordedAt: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    nodeVersion: process.version,
    scope: 'Supplemental source-isolated probes; original audit checks were not rerun.',
    sourceHashes, reportHashes,
    stubs: ['Skill evidence extractor returns empty required evidence and supplied preferred entries.',
      'Prisma membership query uses a synthetic in-memory list of already eligible memberships.'],
    experience,
    preferredSkills: { observedBonus: preferred.preferredSkillBonus,
      interpretation: 'Neutral preferred skills are required by feature 015 FR-002; not classified as a defect.' },
    ownerCases, ownerQueries: calls,
    limitations: ['No real document parser, database, HTTP session, browser, AI, or email exercised.',
      'Score fixture has no required skills; the calculator assigns the existing default 75 points.',
      'Assertions reproduce the audited implementation; update evidence after code changes.'],
  }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
