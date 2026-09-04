"use client";

import { useCallback } from "react";
import { Chip, Stack, Typography } from "@mui/material";
import {
  Datagrid,
  List,
  NumberInput,
  Pagination,
  SelectInput,
  TextInput,
  useRecordContext,
  useRefresh,
} from "react-admin";
import { Link as RouterLink } from "react-router-dom";
import { useSupportInvalidation } from "@/frontend/features/support/client/use-support-invalidation";

type SupportCaseRecord = {
  id: string;
  requesterUserId: string;
  requesterDisplayName: string;
  requesterMaskedEmail: string;
  category: string;
  subject: string;
  state: string;
  currentAssigneeUserId: string | null;
  lastMessageAt: string | null;
  updatedAt: string;
  contentAvailable: boolean;
};

const choices = (values: string[]) =>
  values.map((id) => ({ id, name: sentenceCase(id) }));

function sentenceCase(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function dateTime(value: string | null) {
  if (!value) return "No messages yet";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function StateChip({ state }: { state: string }) {
  const label =
    state === "WAITING_FOR_SUPPORT"
      ? "Needs support reply"
      : state === "WAITING_FOR_USER"
        ? "Waiting for requester"
        : sentenceCase(state);
  const color =
    state === "WAITING_FOR_SUPPORT"
      ? "warning"
      : state === "OPEN"
        ? "info"
        : state === "RESOLVED"
          ? "success"
          : "default";
  return <Chip label={label} color={color} size="small" />;
}

function AssigneeChip({ assigneeId }: { assigneeId: string | null }) {
  return assigneeId ? (
    <Chip label="Assigned" color="success" size="small" variant="outlined" />
  ) : (
    <Chip label="Unassigned" color="warning" size="small" variant="outlined" />
  );
}

function CaseField({ label }: { label?: string }) {
  const record = useRecordContext<SupportCaseRecord>();
  if (!record) return null;
  return (
    <Stack spacing={0.25} sx={{ minWidth: 220 }} aria-label={label}>
      <Typography fontWeight={700} sx={{ overflowWrap: "anywhere" }}>
        {record.subject}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Case {record.id}
      </Typography>
      {!record.contentAvailable && (
        <Chip
          label="Content unavailable"
          color="default"
          size="small"
          variant="outlined"
          sx={{ alignSelf: "flex-start", mt: 0.25 }}
        />
      )}
    </Stack>
  );
}

function RequesterField({ label }: { label?: string }) {
  const record = useRecordContext<SupportCaseRecord>();
  if (!record) return null;
  return (
    <Stack spacing={0.25} sx={{ minWidth: 170 }} aria-label={label}>
      <RouterLink
        to={`/accounts/${encodeURIComponent(record.requesterUserId)}/show`}
        onClick={(event) => event.stopPropagation()}
        style={{ color: "inherit", fontWeight: 700, textDecoration: "none" }}
      >
        {record.requesterDisplayName}
      </RouterLink>
      <Typography variant="body2" color="text.secondary">
        {record.requesterMaskedEmail}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Account {record.requesterUserId}
      </Typography>
    </Stack>
  );
}

function TopicField({ label }: { label?: string }) {
  const record = useRecordContext<SupportCaseRecord>();
  if (!record) return null;
  return (
    <Chip
      label={sentenceCase(record.category)}
      size="small"
      aria-label={label}
    />
  );
}

function QueueField({ label }: { label?: string }) {
  const record = useRecordContext<SupportCaseRecord>();
  if (!record) return null;
  return (
    <Stack
      spacing={0.75}
      alignItems="flex-start"
      sx={{ minWidth: 165 }}
      aria-label={label}
    >
      <StateChip state={record.state} />
      <AssigneeChip assigneeId={record.currentAssigneeUserId} />
      {record.currentAssigneeUserId && (
        <Typography variant="caption" color="text.secondary">
          Admin {record.currentAssigneeUserId}
        </Typography>
      )}
    </Stack>
  );
}

function ActivityField({ label }: { label?: string }) {
  const record = useRecordContext<SupportCaseRecord>();
  if (!record) return null;
  return (
    <Stack spacing={0.25} sx={{ minWidth: 185 }} aria-label={label}>
      <Typography variant="body2">
        Updated {dateTime(record.updatedAt)}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Last message {dateTime(record.lastMessageAt)}
      </Typography>
    </Stack>
  );
}

function SupportInboxRealtime() {
  const refresh = useRefresh();
  useSupportInvalidation(useCallback(() => refresh(), [refresh]));
  return null;
}

export function SupportCaseList() {
  return (
    <List
      title="Support Inbox"
      perPage={25}
      pagination={<Pagination rowsPerPageOptions={[25, 50, 100]} />}
      filters={[
        <TextInput
          key="q"
          source="q"
          label="Search case, requester, subject, or account ID"
          alwaysOn
        />,
        <SelectInput
          key="state"
          source="state"
          label="Queue state"
          choices={choices([
            "OPEN",
            "WAITING_FOR_USER",
            "WAITING_FOR_SUPPORT",
            "RESOLVED",
            "CLOSED",
          ])}
          emptyText="All states"
        />,
        <SelectInput
          key="category"
          source="category"
          label="Topic"
          choices={choices([
            "ACCOUNT_ACCESS",
            "PROFILE",
            "JOBS_APPLICATIONS",
            "RECRUITER",
            "MESSAGING",
            "PRIVACY_SAFETY",
            "OTHER",
          ])}
          emptyText="All topics"
        />,
        <TextInput
          key="assigneeId"
          source="assigneeId"
          label="Assignee account ID"
          helperText="Use UNASSIGNED to find cases awaiting ownership."
        />,
        <NumberInput
          key="age"
          source="age"
          label="Minimum age (hours)"
          min={0}
        />,
      ]}
    >
      <SupportInboxRealtime />
      <Datagrid
        bulkActionButtons={false}
        rowClick="show"
        rowSx={(record: SupportCaseRecord) => ({
          bgcolor:
            record.state === "WAITING_FOR_SUPPORT"
              ? "warning.50"
              : record.currentAssigneeUserId === null &&
                  record.state !== "CLOSED"
                ? "grey.50"
                : "transparent",
          "&:hover": { bgcolor: "action.hover" },
        })}
      >
        <CaseField label="Case" />
        <RequesterField label="Requester" />
        <TopicField label="Topic" />
        <QueueField label="Work queue" />
        <ActivityField label="Activity" />
      </Datagrid>
    </List>
  );
}
