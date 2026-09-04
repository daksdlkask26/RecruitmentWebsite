"use client";
import { Admin, Resource, memoryStore } from "react-admin";
import { createTheme, ScopedCssBaseline } from "@mui/material";
import NotificationsOutlinedIcon from "@mui/icons-material/NotificationsOutlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import { adminAuthProvider } from "./auth-provider";
import { adminDataProvider } from "./data-provider";
import { createAdminQueryClient } from "./query-client";
import { AdminLayout } from "../layout/admin-layout";
import { AdminDashboard } from "../dashboard/admin-dashboard";
import { AccountList } from "../accounts/account-list";
import { AccountDetailShow } from "../accounts/account-detail-show";
import { AdminLoginPage } from "../auth/admin-login-page";
import { CompanyMembershipList } from "../memberships/company-membership-list";
import { MembershipLifecyclePanel } from "../memberships/membership-lifecycle-panel";
import { VerificationRequestList } from "../verification/verification-request-list";
import { VerificationReviewShow } from "../verification/verification-review-show";
import { ModerationReportList } from "../moderation/moderation-report-list";
import { ModerationReviewShow } from "../moderation/moderation-review-show";
import { MessagingReportList } from "../messaging-reports/messaging-report-list";
import { MessagingReportReviewShow } from "../messaging-reports/messaging-report-review-show";
import { SupportCaseList } from "../support/support-case-list";
import { SupportCaseShow } from "../support/support-case-show";
import { ProfessionalConnectionProposalList } from "../professional-connections/professional-connection-proposal-list";
import { ProfessionalConnectionProposalShow } from "../professional-connections/professional-connection-proposal-show";
import { AdminNotificationList } from "../notifications/admin-notification-list";
import { JobPostReviewList } from "../job-post-reviews/job-post-review-list";
import { JobPostReviewShow } from "../job-post-reviews/job-post-review-show";
import { JobPostManagementList } from "../job-post-management/job-post-management-list";
import { JobPostManagementShow } from "../job-post-management/job-post-management-show";
import { CompanyDetailShow } from "../companies/company-detail-show";
import { CompanyList } from "../companies/company-list";
import { BackupSettings } from "../backup/backup-settings";
import { JobTaxonomyList } from "../job-taxonomy/job-taxonomy-list";
import { JobTaxonomyShow } from "../job-taxonomy/job-taxonomy-show";
import { SearchMappingReviewList } from "../search-mapping-reviews/search-mapping-review-list";
import { SearchMappingReviewShow } from "../search-mapping-reviews/search-mapping-review-show";
import { SearchCatalogVersionList } from "../search-catalog-versions/search-catalog-version-list";
import { SearchCatalogVersionShow } from "../search-catalog-versions/search-catalog-version-show";

const theme = createTheme({
  palette: { mode: "light", primary: { main: "#155eef" } },
  components: {
    MuiInputBase: {
      styleOverrides: {
        input: {
          "&&:focus-visible": {
            outline: "none",
            outlineOffset: 0,
            boxShadow: "none",
          },
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        select: {
          "&&:focus-visible": {
            outline: "none",
            outlineOffset: 0,
            boxShadow: "none",
          },
        },
      },
    },
  },
});
const store = memoryStore();
const queryClient = createAdminQueryClient();

export function AdminApp() {
  return (
    <ScopedCssBaseline enableColorScheme>
      <main id="admin-main">
        <Admin
          authProvider={adminAuthProvider}
          dataProvider={adminDataProvider}
          queryClient={queryClient}
          store={store}
          layout={AdminLayout}
          theme={theme}
          loginPage={AdminLoginPage}
          dashboard={AdminDashboard}
          requireAuth
        >
          <Resource
            name="notifications"
            options={{ label: "Notifications" }}
            icon={NotificationsOutlinedIcon}
            list={AdminNotificationList}
          />
          <Resource
            name="job-post-reviews"
            options={{ label: "Job Post Reviews" }}
            icon={FactCheckOutlinedIcon}
            list={JobPostReviewList}
            show={JobPostReviewShow}
          />
          <Resource
            name="job-postings"
            options={{ label: "Job Post Management" }}
            icon={FactCheckOutlinedIcon}
            list={JobPostManagementList}
            show={JobPostManagementShow}
          />
          <Resource
            name="job-taxonomy"
            options={{ label: "Shared Taxonomy" }}
            icon={AccountTreeOutlinedIcon}
            list={JobTaxonomyList}
            show={JobTaxonomyShow}
          />
          <Resource
            name="search-mapping-reviews"
            options={{ label: "Search Mapping Reviews" }}
            icon={FactCheckOutlinedIcon}
            list={SearchMappingReviewList}
            show={SearchMappingReviewShow}
          />
          <Resource
            name="search-catalog-versions"
            options={{ label: "Search Catalog Versions" }}
            icon={AccountTreeOutlinedIcon}
            list={SearchCatalogVersionList}
            show={SearchCatalogVersionShow}
          />
          <Resource
            name="accounts"
            list={AccountList}
            show={AccountDetailShow}
          />
          <Resource
            name="companies"
            list={CompanyList}
            show={CompanyDetailShow}
          />
          <Resource
            name="company-memberships"
            list={CompanyMembershipList}
            show={MembershipLifecyclePanel}
          />
          <Resource
            name="verification-requests"
            list={VerificationRequestList}
            show={VerificationReviewShow}
          />
          <Resource
            name="moderation-reports"
            list={ModerationReportList}
            show={ModerationReviewShow}
          />
          <Resource
            name="messaging-reports"
            options={{ label: "Messaging Reports" }}
            list={MessagingReportList}
            show={MessagingReportReviewShow}
          />
          <Resource
            name="support-cases"
            list={SupportCaseList}
            show={SupportCaseShow}
          />
          <Resource
            name="professional-connection-proposals"
            options={{ label: "Connection Proposals" }}
            list={ProfessionalConnectionProposalList}
            show={ProfessionalConnectionProposalShow}
          />
          <Resource
            name="backup-settings"
            options={{ label: "Backup settings" }}
            list={BackupSettings}
          />
        </Admin>
      </main>
    </ScopedCssBaseline>
  );
}
