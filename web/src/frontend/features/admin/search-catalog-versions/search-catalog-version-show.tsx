"use client";

import {
  Alert,
  Box,
  Chip,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { Show, useRecordContext } from "react-admin";
import { SearchCatalogVersionActionPanel } from "./search-catalog-version-action-panel";

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography sx={{ overflowWrap: "anywhere" }}>{value}</Typography>
    </Box>
  );
}

function Content() {
  const record = useRecordContext<{
    id: string;
    version: string;
    status: string;
    isActive: boolean;
    revision: number;
    parentVersion: string | null;
    runtimeSupported: boolean;
    runtimeCatalogVersion: string;
    counts?: { titles?: number; reviews?: number; translations?: number };
  }>();
  if (!record) return null;
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1200, mx: "auto" }}>
      <Stack spacing={2.5}>
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
          <Stack spacing={2}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              justifyContent="space-between"
              gap={1.5}
            >
              <Box>
                <Typography
                  variant="overline"
                  color="primary.main"
                  fontWeight={700}
                >
                  Search catalog lifecycle
                </Typography>
                <Typography component="h1" variant="h4" fontWeight={750}>
                  {record.version}
                </Typography>
              </Box>
              <Chip
                label={record.isActive ? "ACTIVE" : record.status}
                color={record.isActive ? "success" : "default"}
              />
            </Stack>
            <Divider />
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  sm: "repeat(3, minmax(0, 1fr))",
                },
                gap: 2,
              }}
            >
              <Detail label="Revision" value={record.revision} />
              <Detail
                label="Parent version"
                value={record.parentVersion ?? "Bootstrap"}
              />
              <Detail label="Titles" value={record.counts?.titles ?? 0} />
              <Detail
                label="Translations"
                value={record.counts?.translations ?? 0}
              />
              <Detail label="Review rows" value={record.counts?.reviews ?? 0} />
              <Detail
                label="Runtime"
                value={
                  record.runtimeSupported
                    ? "Loaded by resolver"
                    : `Fallback: ${record.runtimeCatalogVersion}`
                }
              />
            </Box>
            {!record.runtimeSupported ? (
              <Alert severity="warning">
                This catalog is stored for controlled rollout, but the current
                resolver is still serving the compiled runtime catalog. Publish
                does not silently switch search semantics.
              </Alert>
            ) : null}
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
          <SearchCatalogVersionActionPanel />
        </Paper>
      </Stack>
    </Box>
  );
}

export function SearchCatalogVersionShow() {
  return (
    <Show title="Search catalog version" component="div">
      <Content />
    </Show>
  );
}
