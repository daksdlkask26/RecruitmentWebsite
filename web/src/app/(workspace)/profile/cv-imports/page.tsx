import { redirect } from "next/navigation";

import { cvConfiguration, cvParserAvailability } from "@/backend/cv/config";
import { getWorkspaceContext } from "@/backend/auth/get-workspace-context";
import { listCandidateCvLibrary } from "@/backend/services/profile/candidate-cv-library";
import { listCvImports } from "@/backend/services/cv-import/cv-import-projection";
import {
  StatCard,
  StepCard,
} from "@/frontend/components/ui/cv-import-primitives";
import { Panel } from "@/frontend/components/ui/design-system";
import { CvImportWorkspace } from "@/frontend/features/cv-import/components/cv-import-workspace";
import { ProfileNavigation } from "@/frontend/features/profile/components/profile-navigation";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CvImportsPage() {
  const context = await getWorkspaceContext();
  if (!context) redirect("/login?returnTo=%2Fprofile%2Fcv-imports");

  const [imports, candidateCvs] = await Promise.all([
    listCvImports(context.userId),
    listCandidateCvLibrary(context.userId),
  ]);
  const parserAvailability = cvParserAvailability(cvConfiguration);
  const vi = context.initialLocale === "vi";
  const maximumImports = imports.limits.maximumImports;

  return (
    <main className={styles.page}>
      <ProfileNavigation active="cv-imports" />
      <Panel
        as="header"
        accentBorder="blue"
        showDivider={false}
        eyebrow={vi ? "Tài khoản SmartHire của bạn" : "Your SmartHire account"}
        title={
          vi
            ? "Biến CV thành cập nhật hồ sơ"
            : "Turn your CV into profile updates"
        }
        titleAs="h1"
        titleId="workspace-page-title"
        className={styles.hero}
        headClassName={styles.heroHead}
        titleClassName={styles.heroTitle}
        bodyClassName={styles.heroBody}
        rightSlot={
          <StatCard
            value={imports.items.length}
            label={
              vi
                ? `trên ${maximumImports} lần nhập được lưu giữ`
                : `of ${maximumImports} imports retained`
            }
            sublabel={
              vi
                ? "PDF, DOC hoặc DOCX · tối đa 5 MB"
                : "PDF, DOC, or DOCX · up to 5 MB"
            }
          />
        }
      >
        <p className={styles.lede}>
          {vi
            ? "Tải lên PDF, DOC hoặc DOCX, để SmartHire xử lý riêng tư, sau đó xem xét từng đề xuất trước khi hồ sơ của bạn thay đổi."
            : "Upload a PDF, DOC, or DOCX, let SmartHire process it privately, then review every suggestion before anything changes on your profile."}
        </p>
      </Panel>

      <ol
        className={styles.workflow}
        aria-label={vi ? "Quy trình nhập CV" : "CV import workflow"}
      >
        <li>
          <StepCard
            number={1}
            title={vi ? "Tải lên" : "Upload"}
            subtitle={vi ? "Chọn CV được hỗ trợ" : "Choose a supported CV"}
          />
        </li>
        <li>
          <StepCard
            number={2}
            title={vi ? "Xử lý an toàn" : "Process securely"}
            subtitle={
              vi ? "Quét, trích xuất và phân tích" : "Scan, extract, and parse"
            }
          />
        </li>
        <li>
          <StepCard
            number={3}
            title={vi ? "Xem xét và áp dụng" : "Review and apply"}
            subtitle={
              vi ? "Bạn phê duyệt mọi thay đổi" : "You approve every change"
            }
          />
        </li>
      </ol>

      <CvImportWorkspace
        csrfProof={context.csrfProof}
        initialItems={imports.items}
        initialCandidateCvs={candidateCvs.items}
        parserAvailability={parserAvailability}
      />
    </main>
  );
}
