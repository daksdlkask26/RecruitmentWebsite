"use client";

import { Chip } from "@mui/material";
import {
  Datagrid,
  DateField,
  FunctionField,
  List,
  Pagination,
  SelectInput,
  TextField,
  TextInput,
} from "react-admin";

const filters = [
  <TextInput key="q" source="q" label="Search title or title ID" alwaysOn />,
  <SelectInput
    key="status"
    source="status"
    label="Status"
    choices={[
      { id: "PENDING", name: "Pending" },
      { id: "APPROVED", name: "Approved" },
      { id: "REJECTED", name: "Rejected" },
      { id: "MERGED", name: "Merged" },
      { id: "DEDUPLICATED", name: "Deduplicated" },
    ]}
    emptyText="All statuses"
  />,
  <SelectInput
    key="catalogScope"
    source="catalogScope"
    label="Catalog"
    choices={[
      { id: "ACTIVE", name: "Active catalog" },
      { id: "ALL", name: "All catalog versions" },
    ]}
    defaultValue="ACTIVE"
  />,
];

function statusColor(status: string) {
  return status === "APPROVED" || status === "MERGED"
    ? "success"
    : status === "DEDUPLICATED"
      ? "default"
      : status === "REJECTED"
        ? "error"
        : "warning";
}

export function SearchMappingReviewList() {
  return (
    <List
      title="Search mapping reviews"
      perPage={25}
      pagination={<Pagination rowsPerPageOptions={[25, 50, 100]} />}
      sort={{ field: "createdAt", order: "ASC" }}
      filters={filters}
    >
      <Datagrid bulkActionButtons={false} rowClick="show">
        <TextField source="originalTitle" label="Original title" />
        <TextField source="suggestedTranslationVi" label="Vietnamese" />
        <TextField source="suggestedOccupationId" label="Occupation" />
        <FunctionField
          label="Confidence"
          render={(record) => `${Math.round(Number(record.confidence) * 100)}%`}
        />
        <FunctionField
          label="Status"
          render={(record) => (
            <Chip
              size="small"
              color={statusColor(String(record.status))}
              label={String(record.status).replaceAll("_", " ")}
            />
          )}
        />
        <DateField source="createdAt" label="Queued" showTime />
      </Datagrid>
    </List>
  );
}
