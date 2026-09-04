"use client";

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from "@mui/material";
import { useRef, useState } from "react";
import { useRecordContext, useRefresh } from "react-admin";
import {
  adminDataProvider,
  searchMappingReviewCommandPath,
} from "../app/data-provider";
import { StepUpDialog } from "../auth/step-up-dialog";
import { createAdminOperationIdController } from "../shared/admin-operation-id";
import {
  adminReasonLabel,
  privilegedReasonCategories,
} from "../shared/admin-reason-label";
import { StaleConflictPanel } from "../shared/stale-conflict-panel";

export type SearchMappingReviewRecord = {
  id: string;
  catalogVersionId?: string;
  resultCatalogVersionId?: string | null;
  originalTitle: string;
  normalizedTitle?: string;
  context?: unknown;
  suggestedTitleId: string | null;
  suggestedTranslationVi: string | null;
  suggestedTranslationEn: string | null;
  suggestedOccupationId: string | null;
  suggestedFacetIds: string[];
  confidence: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "MERGED" | "DEDUPLICATED";
  version: number;
};

type Action = "approve" | "reject" | "merge" | "intentional-untranslated";

function errorCode(error: unknown) {
  const value = error as { body?: { code?: unknown }; code?: unknown } | null;
  return typeof value?.body?.code === "string"
    ? value.body.code
    : typeof value?.code === "string"
      ? value.code
      : undefined;
}

export function SearchMappingReviewActionPanel() {
  const record = useRecordContext<SearchMappingReviewRecord>();
  const refresh = useRefresh();
  const [action, setAction] = useState<Action>();
  const [reasonCategory, setReasonCategory] = useState("");
  const [explanation, setExplanation] = useState("");
  const [translationVi, setTranslationVi] = useState("");
  const [translationEn, setTranslationEn] = useState("");
  const [titleId, setTitleId] = useState("");
  const [occupationId, setOccupationId] = useState("");
  const [facetIdsText, setFacetIdsText] = useState("");
  const [targetTitleId, setTargetTitleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [stepUp, setStepUp] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const operation = useRef(createAdminOperationIdController());

  if (!record) return null;
  const currentRecord = record;
  const explanationLength = Array.from(
    explanation.normalize("NFC").trim(),
  ).length;

  function openAction(nextAction: Action) {
    operation.current.begin();
    setAction(nextAction);
    setFailure(null);
    setConflict(false);
    setReasonCategory("");
    setExplanation("");
    setTranslationVi(currentRecord.suggestedTranslationVi ?? "");
    setTranslationEn(currentRecord.suggestedTranslationEn ?? "");
    setTitleId(currentRecord.suggestedTitleId ?? "");
    setOccupationId(currentRecord.suggestedOccupationId ?? "");
    setFacetIdsText(currentRecord.suggestedFacetIds.join(", "));
    setTargetTitleId("");
  }

  function close(force = false) {
    if (busy && !force) return;
    operation.current.cancel();
    setAction(undefined);
    setFailure(null);
    setConflict(false);
  }

  async function submit() {
    if (!action) return;
    setBusy(true);
    setFailure(null);
    const base = {
      confirmation: true as const,
      reasonCategory,
      explanation,
    };
    const facetIds = facetIdsText
      .split(/[\n,]/u)
      .map((value) => value.trim())
      .filter(Boolean);
    const command =
      action === "approve"
        ? {
            command: "APPROVE" as const,
            ...base,
            ...(titleId.trim() ? { titleId: titleId.trim() } : {}),
            ...(translationVi.trim()
              ? { translationVi: translationVi.trim() }
              : {}),
            ...(translationEn.trim()
              ? { translationEn: translationEn.trim() }
              : {}),
            ...(occupationId.trim()
              ? { occupationId: occupationId.trim() }
              : {}),
            facetIds,
          }
        : action === "intentional-untranslated"
          ? {
              command: "INTENTIONAL_UNTRANSLATED" as const,
              ...base,
              ...(titleId.trim() ? { titleId: titleId.trim() } : {}),
              ...(translationEn.trim()
                ? { translationEn: translationEn.trim() }
                : {}),
              ...(occupationId.trim()
                ? { occupationId: occupationId.trim() }
                : {}),
              facetIds,
            }
          : action === "merge"
            ? {
                command: "MERGE" as const,
                ...base,
                targetTitleId: targetTitleId.trim(),
              }
            : { command: "REJECT" as const, ...base };
    try {
      await adminDataProvider.command(
        searchMappingReviewCommandPath(currentRecord.id, action),
        command,
        currentRecord.version,
        operation.current.current(),
      );
      operation.current.complete();
      close(true);
      refresh();
    } catch (error) {
      if (errorCode(error) === "STEP_UP_REQUIRED") {
        setStepUp(true);
        return;
      }
      operation.current.complete();
      if ((error as { status?: number }).status === 409) setConflict(true);
      else setFailure("The search mapping action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const disabled =
    busy ||
    !reasonCategory ||
    explanationLength < 10 ||
    explanationLength > 1000 ||
    (occupationId.trim().length > 0 &&
      !/^occ-[a-z0-9-]+$/u.test(occupationId.trim())) ||
    facetIdsText
      .split(/[\n,]/u)
      .map((value) => value.trim())
      .filter(Boolean)
      .some((value) => value.length > 128) ||
    (action === "merge" && !/^title-[a-z0-9-]+$/u.test(targetTitleId.trim()));

  return (
    <>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        {currentRecord.status === "PENDING" ? (
          <>
            <Button
              variant="contained"
              color="success"
              onClick={() => openAction("approve")}
            >
              Approve mapping
            </Button>
            <Button
              variant="outlined"
              color="warning"
              onClick={() => openAction("intentional-untranslated")}
            >
              Keep English intentionally
            </Button>
            <Button variant="outlined" onClick={() => openAction("merge")}>
              Merge into title
            </Button>
            <Button
              variant="outlined"
              color="error"
              onClick={() => openAction("reject")}
            >
              Reject
            </Button>
          </>
        ) : (
          <Alert severity="info">This review has already been decided.</Alert>
        )}
      </Stack>
      {conflict ? (
        <StaleConflictPanel
          onRefresh={() => {
            setConflict(false);
            refresh();
          }}
        />
      ) : null}
      {action ? (
        <Dialog open onClose={() => close()} fullWidth maxWidth="sm">
          <DialogTitle>
            {action === "approve"
              ? "Approve search mapping"
              : action === "intentional-untranslated"
                ? "Keep English title intentionally"
                : action === "merge"
                  ? "Merge search mapping"
                  : "Reject search mapping"}
          </DialogTitle>
          <DialogContent
            sx={{ display: "grid", gap: 2, pt: "12px !important" }}
          >
            <Alert
              severity={
                action === "reject" || action === "intentional-untranslated"
                  ? "warning"
                  : "info"
              }
            >
              Original title: {currentRecord.originalTitle}. Confidence:{" "}
              {Math.round(currentRecord.confidence * 100)}%.
              {action === "approve"
                ? " Approval creates a new draft catalog; the published version is never mutated in place."
                : action === "intentional-untranslated"
                  ? " This preserves the English title and records an explicit intentional-untranslated rationale; it never claims HUMAN_VERIFIED."
                  : " The decision is recorded in the immutable admin audit trail."}
            </Alert>
            {action !== "reject" && action !== "intentional-untranslated" ? (
              <Alert severity="warning" role="status">
                {action === "approve"
                  ? "Impact preview: one title and its VI/EN translation rows will be updated in a new draft. The server will stop the action if the mapping is ambiguous or collides with another title."
                  : `Impact preview: the phrase “${currentRecord.originalTitle}” will be added as an alias of the target title in a new draft. The server will stop the action if the target is missing or the alias collides.`}
              </Alert>
            ) : null}
            {action === "intentional-untranslated" ? (
              <Alert severity="warning" role="status">
                Impact preview: the title remains literal in both locale rows,
                with no Vietnamese aliases added. The server records the
                rationale and keeps the catalog in draft.
              </Alert>
            ) : null}
            {action === "approve" || action === "intentional-untranslated" ? (
              <>
                <TextField
                  label="Title ID"
                  value={titleId}
                  onChange={(event) => setTitleId(event.target.value)}
                  helperText="Use an existing title ID from the catalog."
                />
                {action === "approve" ? (
                  <TextField
                    label="Vietnamese title"
                    value={translationVi}
                    onChange={(event) => setTranslationVi(event.target.value)}
                  />
                ) : null}
                <TextField
                  label="English title"
                  value={translationEn}
                  onChange={(event) => setTranslationEn(event.target.value)}
                />
                <TextField
                  label="Occupation ID"
                  value={occupationId}
                  onChange={(event) => setOccupationId(event.target.value)}
                  helperText="Verify this against the job context; static rows may contain a stale suggested taxonomy."
                />
                <TextField
                  label="Facet IDs"
                  value={facetIdsText}
                  onChange={(event) => setFacetIdsText(event.target.value)}
                  helperText="Optional; separate multiple facet IDs with commas. Clearing the field records an empty facet list."
                />
              </>
            ) : null}
            {action === "merge" ? (
              <TextField
                label="Target title ID"
                value={targetTitleId}
                onChange={(event) => setTargetTitleId(event.target.value)}
                helperText="Example: title-seospecialist-occ-r02-marketing-communications"
              />
            ) : null}
            <FormControl required>
              <InputLabel id="search-review-reason-category">
                Reason category
              </InputLabel>
              <Select
                labelId="search-review-reason-category"
                label="Reason category"
                value={reasonCategory}
                onChange={(event) => setReasonCategory(event.target.value)}
              >
                {privilegedReasonCategories.map((value) => (
                  <MenuItem key={value} value={value}>
                    {adminReasonLabel(value)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Private administrator rationale"
              multiline
              minRows={4}
              required
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
              helperText={`${explanationLength}/1000 characters; minimum 10`}
              inputProps={{ maxLength: 1000 }}
            />
            {failure ? <Alert severity="error">{failure}</Alert> : null}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => close()} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="contained"
              color={
                action === "reject"
                  ? "error"
                  : action === "intentional-untranslated"
                    ? "warning"
                    : "success"
              }
              onClick={() => void submit()}
              disabled={disabled}
            >
              Confirm
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
      <StepUpDialog
        open={stepUp}
        id={`search-mapping-review-${currentRecord.id}`}
        onCancel={() => {
          setStepUp(false);
          close();
        }}
        onVerified={() => {
          setStepUp(false);
          void submit();
        }}
      />
    </>
  );
}
