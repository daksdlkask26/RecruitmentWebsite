"use client";

import { Chip, Stack, Typography } from "@mui/material";
import {
  Datagrid,
  List,
  NumberInput,
  Pagination,
  SelectInput,
  TextInput,
  useRecordContext,
} from "react-admin";
import { Link as RouterLink } from "react-router-dom";
import { CurrentListSnapshotDifference } from "../dashboard/snapshot-difference-notice";

type ModerationReportRecord = {
  id: string;
  reporterAccountId: string;
  reporterDisplayName: string;
  targetType: "JOB" | "COMPANY" | "MEMBERSHIP" | "CANDIDATE";
  targetReference: string;
  companyReference: string | null;
  jobReference: string | null;
  applicationReference: string | null;
  category: string;
  state: "PENDING_REVIEW" | "RESOLVED" | "DISMISSED";
  priority: "NORMAL" | "HIGH" | "CRITICAL";
  assignedAdministratorId: string | null;
  createdAt: string;
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

function ageSince(value: string) {
  const date = new Date(value);
  const seconds = Number.isNaN(date.valueOf())
    ? 0
    : Math.max(0, Math.floor((Date.now() - date.getTime()) / 1_000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return "Just now";
}

const choices = (values: string[]) =>
  values.map((id) => ({ id, name: sentenceCase(id) }));

function targetPath(record: ModerationReportRecord) {
  const resource =
    record.targetType === "JOB"
      ? "job-postings"
      : record.targetType === "COMPANY"
        ? "companies"
        : record.targetType === "MEMBERSHIP"
          ? "company-memberships"
          : "accounts";
  return `/${resource}/${encodeURIComponent(record.targetReference)}/show`;
}

function PriorityChip({
  priority,
}: {
  priority: ModerationReportRecord["priority"];
}) {
  return (
    <Chip
      label={`${sentenceCase(priority)} priority`}
      color={
        priority === "CRITICAL"
          ? "error"
          : priority === "HIGH"
            ? "warning"
            : "default"
      }
      size="small"
    />
  );
}

function StateChip({ state }: { state: ModerationReportRecord["state"] }) {
  const label =
    state === "PENDING_REVIEW" ? "Needs review" : sentenceCase(state);
  return (
    <Chip
      label={label}
      color={
        state === "PENDING_REVIEW"
          ? "warning"
          : state === "RESOLVED"
            ? "success"
            : "default"
      }
      size="small"
      variant={state === "DISMISSED" ? "outlined" : "filled"}
    />
  );
}

function ReporterField({ label }: { label?: string }) {
  const record = useRecordContext<ModerationReportRecord>();
  if (!record) return null;
  return (
    <Stack spacing={0.25} sx={{ minWidth: 175 }} aria-label={label}>
      <RouterLink
        to={`/accounts/${encodeURIComponent(record.reporterAccountId)}/show`}
        onClick={(event) => event.stopPropagation()}
        style={{ color: "inherit", fontWeight: 700, textDecoration: "none" }}
      >
        {record.reporterDisplayName}
      </RouterLink>
      <Typography variant="caption" color="text.secondary">
        Reporter {record.reporterAccountId}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Report {record.id}
      </Typography>
    </Stack>
  );
}

function TargetField({ label }: { label?: string }) {
  const record = useRecordContext<ModerationReportRecord>();
  if (!record) return null;
  return (
    <Stack
      spacing={0.5}
      alignItems="flex-start"
      sx={{ minWidth: 200 }}
      aria-label={label}
    >
      <RouterLink
        to={targetPath(record)}
        onClick={(event) => event.stopPropagation()}
        style={{ color: "inherit", fontWeight: 700, textDecoration: "none" }}
      >
        {sentenceCase(record.targetType)} {record.targetReference}
      </RouterLink>
      <Chip
        label={sentenceCase(record.category)}
        size="small"
        variant="outlined"
      />
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
        {record.companyReference && record.targetType !== "COMPANY" && (
          <RouterLink
            to={`/companies/${encodeURIComponent(record.companyReference)}/show`}
            onClick={(event) => event.stopPropagation()}
            style={{ color: "inherit", fontSize: "0.75rem" }}
          >
            Company context
          </RouterLink>
        )}
        {record.jobReference && record.targetType !== "JOB" && (
          <RouterLink
            to={`/job-postings/${encodeURIComponent(record.jobReference)}/show`}
            onClick={(event) => event.stopPropagation()}
            style={{ color: "inherit", fontSize: "0.75rem" }}
          >
            Job context
          </RouterLink>
        )}
        {record.applicationReference && (
          <Typography variant="caption" color="text.secondary">
            Application {record.applicationReference}
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}

function QueueField({ label }: { label?: string }) {
  const record = useRecordContext<ModerationReportRecord>();
  if (!record) return null;
  return (
    <Stack
      spacing={0.75}
      alignItems="flex-start"
      sx={{ minWidth: 165 }}
      aria-label={label}
    >
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        <PriorityChip priority={record.priority} />
        <StateChip state={record.state} />
      </Stack>
      <Chip
        label={record.assignedAdministratorId ? "Assigned" : "Unassigned"}
        color={record.assignedAdministratorId ? "success" : "warning"}
        size="small"
        variant="outlined"
      />
      {record.assignedAdministratorId && (
        <Typography variant="caption" color="text.secondary">
          Admin {record.assignedAdministratorId}
        </Typography>
      )}
    </Stack>
  );
}

function ActivityField({ label }: { label?: string }) {
  const record = useRecordContext<ModerationReportRecord>();
  if (!record) return null;
  return (
    <Stack spacing={0.25} sx={{ minWidth: 170 }} aria-label={label}>
      <Typography variant="body2">
        Reported {dateTime(record.createdAt)}
      </Typography>
      <Chip
        label={`Age ${ageSince(record.createdAt)}`}
        size="small"
        variant="outlined"
        sx={{ alignSelf: "flex-start" }}
      />
    </Stack>
  );
}

export function ModerationReportList() {
  return (
    <List
      title="Moderation Reports"
      perPage={25}
      pagination={<Pagination rowsPerPageOptions={[25, 50, 100]} />}
      sort={{ field: "priority", order: "ASC" }}
      filters={[
        <TextInput
          key="q"
          source="q"
          label="Search report, target, reporter, company, or job ID"
          alwaysOn
        />,
        <SelectInput
          key="targetType"
          source="targetType"
          label="Target type"
          choices={choices(["JOB", "COMPANY", "MEMBERSHIP", "CANDIDATE"])}
          emptyText="All target types"
        />,
        <SelectInput
          key="category"
          source="category"
          label="Report category"
          choices={choices([
            "FRAUD_OR_IMPERSONATION",
            "MISLEADING_CONTENT",
            "DISCRIMINATION_OR_HARASSMENT",
            "ABUSE_OR_THREATS",
            "SPAM_OR_DUPLICATE",
            "PRIVACY_OR_DATA_MISUSE",
            "OTHER",
          ])}
          emptyText="All categories"
        />,
        <SelectInput
          key="priority"
          source="priority"
          label="Priority"
          choices={choices(["CRITICAL", "HIGH", "NORMAL"])}
          emptyText="All priorities"
        />,
        <SelectInput
          key="state"
          source="state"
          label="Review state"
          choices={choices(["PENDING_REVIEW", "RESOLVED", "DISMISSED"])}
          emptyText="All states"
        />,
        <TextInput key="company" source="company" label="Company ID" />,
        <NumberInput
          key="age"
          source="age"
          label="Minimum age (hours)"
          min={0}
        />,
        <TextInput
          key="assigneeId"
          source="assigneeId"
          label="Assignee account ID"
          helperText="Use UNASSIGNED to find reports awaiting ownership."
        />,
      ]}
    >
      <CurrentListSnapshotDifference />
      <Datagrid
        bulkActionButtons={false}
        rowClick="show"
        rowSx={(record: ModerationReportRecord) => ({
          bgcolor:
            record.priority === "CRITICAL" && record.state === "PENDING_REVIEW"
              ? "error.50"
              : record.priority === "HIGH" && record.state === "PENDING_REVIEW"
                ? "warning.50"
                : record.state === "PENDING_REVIEW" &&
                    !record.assignedAdministratorId
                  ? "grey.50"
                  : "transparent",
          "&:hover": { bgcolor: "action.hover" },
        })}
      >
        <ReporterField label="Reporter" />
        <TargetField label="Reported target" />
        <QueueField label="Review queue" />
        <ActivityField label="Reported" />
      </Datagrid>
    </List>
  );
}
