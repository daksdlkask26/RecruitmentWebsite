"use client";

import { Chip, Stack, Typography } from "@mui/material";
import {
  Datagrid,
  List,
  Pagination,
  SelectInput,
  TextInput,
  useRecordContext,
} from "react-admin";
import { Link as RouterLink } from "react-router-dom";
import { CurrentListSnapshotDifference } from "../dashboard/snapshot-difference-notice";

type MembershipRecord = {
  id: string;
  company: {
    id: string;
    legalName: string;
    verificationState: "ACTIVE" | "INACTIVE" | "UNVERIFIED";
  };
  companyId: string;
  accountId: string;
  accountDisplayName: string;
  role: "OWNER" | "HR_MANAGER" | "RECRUITER" | "HIRING_MANAGER";
  state: "ACTIVE" | "SUSPENDED" | "REMOVED";
  accessState: "ACTIVE" | "SUSPENDED" | "REMOVED" | "COMPANY_BANNED";
  priorApprovedRole: string;
  createdAt: string;
  updatedAt: string;
};

function sentenceCase(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

const choices = (values: string[]) =>
  values.map((id) => ({ id, name: sentenceCase(id) }));

function MembershipStateChip({ state }: { state: MembershipRecord["state"] }) {
  return (
    <Chip
      label={sentenceCase(state)}
      color={
        state === "ACTIVE"
          ? "success"
          : state === "SUSPENDED"
            ? "warning"
            : "error"
      }
      size="small"
    />
  );
}

function EffectiveAccessChip({
  accessState,
}: {
  accessState: MembershipRecord["accessState"];
}) {
  return (
    <Chip
      label={
        accessState === "COMPANY_BANNED"
          ? "Company access blocked"
          : `Access ${sentenceCase(accessState)}`
      }
      color={
        accessState === "ACTIVE"
          ? "success"
          : accessState === "SUSPENDED"
            ? "warning"
            : "error"
      }
      size="small"
      variant="outlined"
    />
  );
}

function MemberField({ label }: { label?: string }) {
  const record = useRecordContext<MembershipRecord>();
  if (!record) return null;
  return (
    <Stack spacing={0.25} sx={{ minWidth: 175 }} aria-label={label}>
      <RouterLink
        to={`/accounts/${encodeURIComponent(record.accountId)}/show`}
        onClick={(event) => event.stopPropagation()}
        style={{ color: "inherit", fontWeight: 700, textDecoration: "none" }}
      >
        {record.accountDisplayName}
      </RouterLink>
      <Typography variant="caption" color="text.secondary">
        Account {record.accountId}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Membership {record.id}
      </Typography>
    </Stack>
  );
}

function CompanyField({ label }: { label?: string }) {
  const record = useRecordContext<MembershipRecord>();
  if (!record) return null;
  const verificationColor =
    record.company.verificationState === "ACTIVE"
      ? "success"
      : record.company.verificationState === "INACTIVE"
        ? "warning"
        : "default";
  return (
    <Stack
      spacing={0.5}
      alignItems="flex-start"
      sx={{ minWidth: 230 }}
      aria-label={label}
    >
      <RouterLink
        to={`/companies/${encodeURIComponent(record.companyId)}/show`}
        onClick={(event) => event.stopPropagation()}
        style={{ color: "inherit", fontWeight: 700, textDecoration: "none" }}
      >
        {record.company.legalName}
      </RouterLink>
      <Typography variant="caption" color="text.secondary">
        Company {record.companyId}
      </Typography>
      <Chip
        label={`Verification ${sentenceCase(record.company.verificationState)}`}
        color={verificationColor}
        size="small"
        variant="outlined"
      />
    </Stack>
  );
}

function AccessField({ label }: { label?: string }) {
  const record = useRecordContext<MembershipRecord>();
  if (!record) return null;
  return (
    <Stack
      spacing={0.75}
      alignItems="flex-start"
      sx={{ minWidth: 185 }}
      aria-label={label}
    >
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        <Chip
          label={sentenceCase(record.role)}
          color={record.role === "OWNER" ? "primary" : "default"}
          size="small"
        />
        <MembershipStateChip state={record.state} />
      </Stack>
      <EffectiveAccessChip accessState={record.accessState} />
      {record.priorApprovedRole !== record.role && (
        <Typography variant="caption" color="text.secondary">
          Previously approved as {sentenceCase(record.priorApprovedRole)}
        </Typography>
      )}
    </Stack>
  );
}

function ActivityField({ label }: { label?: string }) {
  const record = useRecordContext<MembershipRecord>();
  if (!record) return null;
  return (
    <Stack spacing={0.25} sx={{ minWidth: 180 }} aria-label={label}>
      <Typography variant="body2">
        Joined {dateTime(record.createdAt)}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Last changed {dateTime(record.updatedAt)}
      </Typography>
    </Stack>
  );
}

const filters = [
  <TextInput
    key="q"
    source="q"
    label="Search membership, company, member, or ID"
    alwaysOn
  />,
  <TextInput key="companyId" source="companyId" label="Company ID" />,
  <TextInput key="accountId" source="accountId" label="Account ID" />,
  <SelectInput
    key="role"
    source="role"
    label="Role"
    choices={choices(["OWNER", "HR_MANAGER", "RECRUITER", "HIRING_MANAGER"])}
    emptyText="All roles"
  />,
  <SelectInput
    key="state"
    source="state"
    label="Membership state"
    choices={choices(["ACTIVE", "SUSPENDED", "REMOVED"])}
    emptyText="All states"
  />,
];

export function CompanyMembershipList() {
  return (
    <List
      title="Company Memberships"
      perPage={25}
      pagination={<Pagination rowsPerPageOptions={[25, 50, 100]} />}
      sort={{ field: "createdAt", order: "DESC" }}
      filters={filters}
    >
      <CurrentListSnapshotDifference />
      <Datagrid
        bulkActionButtons={false}
        rowClick="show"
        rowSx={(record: MembershipRecord) => ({
          bgcolor:
            record.accessState === "COMPANY_BANNED"
              ? "error.50"
              : record.state === "SUSPENDED"
                ? "warning.50"
                : record.state === "REMOVED"
                  ? "grey.100"
                  : "transparent",
          "&:hover": { bgcolor: "action.hover" },
        })}
      >
        <MemberField label="Member" />
        <CompanyField label="Company" />
        <AccessField label="Role & access" />
        <ActivityField label="Activity" />
      </Datagrid>
    </List>
  );
}
