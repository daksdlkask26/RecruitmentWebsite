import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnvironment } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../src/backend/generated/prisma/client";
import { normalizeSearchText } from "../src/backend/services/jobs/search-normalization";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnvironment({ path: resolve(webRoot, ".env.local"), quiet: true });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const prisma = new PrismaClient({
    adapter: new PrismaPg(process.env.DATABASE_URL),
  });
  const jobs = await prisma.jobPosting.findMany({
    select: {
      id: true,
      title: true,
      normalizedTitle: true,
      normalizedLocation: true,
      searchDocumentNormalized: true,
      summary: true,
      description: true,
      responsibilities: true,
      requirements: true,
      benefits: true,
      education: true,
      age: true,
      location: true,
      company: { select: { displayName: true, industry: true, publicLocation: true } },
      skills: { select: { displayName: true } },
    },
  });
  let updated = 0;
  for (const job of jobs) {
    const normalizedTitle = normalizeSearchText(job.title, 200);
    const normalizedLocation = normalizeSearchText(job.location, 160);
    const searchDocumentNormalized = normalizeSearchText(
      [
        job.title,
        job.summary,
        job.description,
        job.responsibilities,
        job.requirements,
        job.benefits ?? "",
        job.education ?? "",
        job.age ?? "",
        job.location,
        job.company.displayName,
        job.company.industry ?? "",
        job.company.publicLocation ?? "",
        ...job.skills.map((skill) => skill.displayName),
      ].join(" "),
      60_000,
    );
    if (
      job.normalizedTitle === normalizedTitle &&
      job.normalizedLocation === normalizedLocation &&
      job.searchDocumentNormalized === searchDocumentNormalized
    ) {
      continue;
    }
    await prisma.jobPosting.update({
      where: { id: job.id },
      data: { normalizedTitle, normalizedLocation, searchDocumentNormalized },
    });
    updated += 1;
  }
  console.log(`Checked ${jobs.length} jobs; updated ${updated} search projections.`);
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
