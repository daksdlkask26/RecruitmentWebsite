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
  Typography,
} from "@mui/material";
import { useRef, useState } from "react";
import { useRecordContext, useRefresh } from "react-admin";
import {
  adminDataProvider,
  searchCatalogVersionCommandPath,
} from "../app/data-provider";
import { StepUpDialog } from "../auth/step-up-dialog";
import { createAdminOperationIdController } from "../shared/admin-operation-id";
import {
  adminReasonLabel,
  privilegedReasonCategories,
} from "../shared/admin-reason-label";
import { StaleConflictPanel } from "../shared/stale-conflict-panel";

type Action = "publish" | "rollback" | "retire";

function errorCode(error: unknown) {
  const value = error as { body?: { code?: unknown }; code?: unknown } | null;
  return typeof value?.body?.code === "string"
    ? value.body.code
    : typeof value?.code === "string"
      ? value.code
      : undefined;
}

export function SearchCatalogVersionActionPanel() {
  const record = useRecordContext<{
    id: string;
    status: string;
    isActive: boolean;
    revision: number;
    version: string;
  }>();
  const refresh = useRefresh();
  const operation = useRef(createAdminOperationIdController());
  const [action, setAction] = useState<Action>();
  const [reasonCategory, setReasonCategory] = useState("");
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  const [stepUp, setStepUp] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (!record) return null;
  const currentRecord = record;

  function open(next: Action) {
    operation.current.begin();
    setAction(next);
    setReasonCategory("");
    setExplanation("");
    setFailure(null);
    setConflict(false);
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
    try {
      await adminDataProvider.command(
        searchCatalogVersionCommandPath(currentRecord.id, action),
        {
          command: action.toUpperCase(),
          confirmation: true,
          reasonCategory,
          explanation,
        },
        currentRecord.revision,
        operation.current.current(),
      );
      operation.current.complete();
      close(true);
      refresh();
    } catch (error) {
      if (errorCode(error) === "STEP_UP_REQUIRED") setStepUp(true);
      else if ((error as { status?: number }).status === 409) setConflict(true);
      else setFailure("The catalog lifecycle action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const explanationLength = Array.from(
    explanation.normalize("NFC").trim(),
  ).length;
  const disabled =
    busy ||
    !reasonCategory ||
    explanationLength < 10 ||
    explanationLength > 1000;
  return (
    <>
      <Stack spacing={1.5}>
        <Typography component="h2" variant="h6" fontWeight={700}>
          Catalog lifecycle
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Published contents are immutable. Lifecycle changes keep prior
          versions for rollback and require a version match.
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          {record.status === "DRAFT" ? (
            <Button
              variant="contained"
              color="success"
              onClick={() => open("publish")}
            >
              Publish
            </Button>
          ) : null}
          {!record.isActive && record.status !== "DRAFT" ? (
            <Button variant="outlined" onClick={() => open("rollback")}>
              Make active
            </Button>
          ) : null}
          {record.status === "PUBLISHED" && !record.isActive ? (
            <Button
              variant="outlined"
              color="error"
              onClick={() => open("retire")}
            >
              Retire
            </Button>
          ) : null}
          {record.isActive ? (
            <Alert severity="info">This is the active catalog version.</Alert>
          ) : null}
        </Stack>
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
            {action === "publish"
              ? "Publish catalog version"
              : action === "rollback"
                ? "Activate previous catalog version"
                : "Retire catalog version"}
          </DialogTitle>
          <DialogContent
            sx={{ display: "grid", gap: 2, pt: "12px !important" }}
          >
            <Alert severity={action === "retire" ? "warning" : "info"}>
              Version: {record.version}. This action is recorded in the
              immutable administrator audit trail.
            </Alert>
            <FormControl required>
              <InputLabel id="search-catalog-reason-category">
                Reason category
              </InputLabel>
              <Select
                labelId="search-catalog-reason-category"
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
              color={action === "retire" ? "error" : "success"}
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
        id={`search-catalog-version-${record.id}`}
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
