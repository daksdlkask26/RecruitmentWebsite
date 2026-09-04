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
  <TextInput key="q" source="q" label="Search version" alwaysOn />,
  <SelectInput
    key="status"
    source="status"
    label="Status"
    choices={[
      { id: "DRAFT", name: "Draft" },
      { id: "PUBLISHED", name: "Published" },
      { id: "RETIRED", name: "Retired" },
    ]}
    emptyText="All statuses"
  />,
];

function color(status: string) {
  return status === "PUBLISHED"
    ? "success"
    : status === "DRAFT"
      ? "warning"
      : "default";
}

export function SearchCatalogVersionList() {
  return (
    <List
      title="Search catalog versions"
      perPage={25}
      pagination={<Pagination rowsPerPageOptions={[25, 50, 100]} />}
      sort={{ field: "createdAt", order: "DESC" }}
      filters={filters}
    >
      <Datagrid bulkActionButtons={false} rowClick="show">
        <TextField source="version" label="Version" />
        <FunctionField
          label="Status"
          render={(record) => (
            <Chip
              size="small"
              color={color(String(record.status))}
              label={record.isActive ? "ACTIVE" : String(record.status)}
            />
          )}
        />
        <FunctionField
          label="Titles"
          render={(record) => String(record.counts?.titles ?? 0)}
        />
        <FunctionField
          label="Reviews"
          render={(record) => String(record.counts?.reviews ?? 0)}
        />
        <FunctionField
          label="Runtime"
          render={(record) => (record.runtimeSupported ? "Loaded" : "Fallback")}
        />
        <DateField source="createdAt" label="Created" showTime />
      </Datagrid>
    </List>
  );
}
