"use client";

import { Box, Chip, Divider, Paper, Stack, Typography } from "@mui/material";
import { Show, useRecordContext } from "react-admin";
import {
  SearchMappingReviewActionPanel,
  type SearchMappingReviewRecord,
} from "./search-mapping-review-action-panel";

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

function boundedContext(value: unknown) {
  if (value === null || value === undefined) return "Not available";
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) return "Not available";
    return serialized.length > 2000
      ? `${serialized.slice(0, 2000)}…`
      : serialized;
  } catch {
    return "Not available";
  }
}

function contextValue(context: unknown, key: string) {
  if (!context || typeof context !== "object" || Array.isArray(context))
    return undefined;
  return (context as Record<string, unknown>)[key];
}

function Content() {
  const record = useRecordContext<SearchMappingReviewRecord>();
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
                  Search mapping review
                </Typography>
                <Typography component="h1" variant="h4" fontWeight={750}>
                  {record.originalTitle}
                </Typography>
              </Box>
              <Chip
                label={record.status.replaceAll("_", " ")}
                color={record.status === "PENDING" ? "warning" : "success"}
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
              <Detail
                label="Suggested title ID"
                value={record.suggestedTitleId ?? "Not mapped"}
              />
              <Detail
                label="Catalog version ID"
                value={record.catalogVersionId ?? "Not available"}
              />
              <Detail
                label="Normalized title"
                value={record.normalizedTitle ?? "Not available"}
              />
              <Detail
                label="Suggested Vietnamese"
                value={record.suggestedTranslationVi ?? "Not available"}
              />
              <Detail
                label="Suggested English"
                value={record.suggestedTranslationEn ?? "Not available"}
              />
              <Detail
                label="Occupation"
                value={record.suggestedOccupationId ?? "Not mapped"}
              />
              <Detail
                label="Confidence"
                value={`${Math.round(record.confidence * 100)}%`}
              />
              <Detail label="Review version" value={record.version} />
              <Detail
                label="Context source"
                value={
                  Array.isArray(contextValue(record.context, "sampleJobIds"))
                    ? "Static JobPosting context"
                    : "Search profile"
                }
              />
            </Box>
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
          <Stack spacing={1.5}>
            <Typography component="h2" variant="h6" fontWeight={700}>
              Mapping context
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Facet IDs:{" "}
              {record.suggestedFacetIds.length
                ? record.suggestedFacetIds.join(", ")
                : "None"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Sample JobPosting IDs:{" "}
              {Array.isArray(contextValue(record.context, "sampleJobIds")) &&
              (contextValue(record.context, "sampleJobIds") as unknown[]).length
                ? (
                    contextValue(record.context, "sampleJobIds") as string[]
                  ).join(", ")
                : "None"}
            </Typography>
            <Typography
              component="pre"
              variant="body2"
              color="text.secondary"
              sx={{
                m: 0,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                maxHeight: 240,
                overflow: "auto",
              }}
            >
              Context sample: {boundedContext(record.context)}
            </Typography>
            <SearchMappingReviewActionPanel />
          </Stack>
        </Paper>
      </Stack>
    </Box>
  );
}

export function SearchMappingReviewShow() {
  return (
    <Show title="Search mapping review" component="div">
      <Content />
    </Show>
  );
}
