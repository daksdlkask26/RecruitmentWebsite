"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { currentAdminCsrfToken } from "../app/auth-provider";

type Settings = {
  enabled: boolean;
  intervalSeconds: number;
  updatedAt?: string | null;
};
type Run = {
  id: string;
  trigger: "MANUAL" | "SCHEDULED";
  status: "QUEUED" | "LEASED" | "SUCCEEDED" | "FAILED";
  requestedAt: string;
  completedAt?: string | null;
  byteCount?: number | null;
  checksum?: string | null;
  failureCode?: string | null;
};
type StatusFilter = "ALL" | Run["status"];
type TriggerFilter = "ALL" | Run["trigger"];

const stateLabel: Record<Run["status"], string> = {
  QUEUED: "Queued — waiting for worker",
  LEASED: "Backing up and uploading",
  SUCCEEDED: "Uploaded securely",
  FAILED: "Failed",
};

async function backupApi(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const csrf = currentAdminCsrfToken();
  headers.set("content-type", "application/json");
  if (init.method && init.method !== "GET" && csrf)
    headers.set("x-csrf-token", csrf);
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.code ?? "BACKUP_REQUEST_FAILED");
  return data;
}

function backupErrorMessage(error: unknown, fallback: string) {
  const code = error instanceof Error ? error.message : fallback;
  return code === "STEP_UP_REQUIRED"
    ? "Your two-factor verification has expired. Sign out, sign in again, and verify your authenticator code to access Backup Settings."
    : code;
}

function formatBytes(value?: number | null) {
  if (!value) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function BackupSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [interval, setIntervalValue] = useState("60");
  const [message, setMessage] = useState("");
  const [stepUpRequired, setStepUpRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>("ALL");

  const showError = (error: unknown, fallback: string) => {
    setStepUpRequired(
      error instanceof Error && error.message === "STEP_UP_REQUIRED",
    );
    setMessage(backupErrorMessage(error, fallback));
  };
  const load = useCallback(async () => {
    const [nextSettings, nextRuns] = await Promise.all([
      backupApi("/api/admin/backup"),
      backupApi("/api/admin/backup/runs"),
    ]);
    setSettings(nextSettings);
    setIntervalValue(String(nextSettings.intervalSeconds));
    setRuns(nextRuns);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        await load();
      } catch (error: unknown) {
        if (!cancelled) showError(error, "BACKUP_LOAD_FAILED");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [load]);
  useEffect(() => {
    if (!runs.some((run) => run.status === "QUEUED" || run.status === "LEASED"))
      return;
    const timer = window.setInterval(
      () => void load().catch(() => undefined),
      2_000,
    );
    return () => window.clearInterval(timer);
  }, [load, runs]);

  const save = async () => {
    if (!settings) return;
    setBusy(true);
    setMessage("");
    try {
      const saved = await backupApi("/api/admin/backup", {
        method: "PUT",
        body: JSON.stringify({
          enabled: settings.enabled,
          intervalSeconds: Number(interval),
        }),
      });
      setSettings(saved);
      setMessage("Backup settings saved.");
    } catch (error) {
      showError(error, "BACKUP_SAVE_FAILED");
    } finally {
      setBusy(false);
    }
  };
  const runNow = async () => {
    setBusy(true);
    setMessage("");
    try {
      await backupApi("/api/admin/backup/runs", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: "{}",
      });
      await load();
      setMessage("Backup queued. Its status is being updated automatically.");
    } catch (error) {
      showError(error, "BACKUP_QUEUE_FAILED");
    } finally {
      setBusy(false);
    }
  };
  const signOutForStepUp = async () => {
    const csrf = currentAdminCsrfToken();
    await fetch("/api/admin/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: csrf ? { "x-csrf-token": csrf } : undefined,
    }).catch(() => undefined);
    window.location.assign("/#/login");
  };
  const filteredRuns = useMemo(() => {
    const term = search.trim().toLowerCase();
    return runs.filter((run) => {
      if (statusFilter !== "ALL" && run.status !== statusFilter) return false;
      if (triggerFilter !== "ALL" && run.trigger !== triggerFilter)
        return false;
      return (
        !term ||
        [run.id, run.checksum, run.failureCode, run.status, run.trigger]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term))
      );
    });
  }, [runs, search, statusFilter, triggerFilter]);

  if (!settings)
    return (
      <Box sx={{ p: 3, maxWidth: 720 }}>
        <Typography component="h1" variant="h4" gutterBottom>
          Backup settings
        </Typography>
        {message ? (
          <Stack spacing={2}>
            <Alert severity="warning">{message}</Alert>
            {stepUpRequired ? (
              <Button
                variant="contained"
                sx={{ alignSelf: "flex-start" }}
                onClick={() => void signOutForStepUp()}
              >
                Sign out and verify again
              </Button>
            ) : (
              <Button
                variant="outlined"
                sx={{ alignSelf: "flex-start" }}
                onClick={() =>
                  void load().catch((error: unknown) =>
                    showError(error, "BACKUP_LOAD_FAILED"),
                  )
                }
              >
                Retry
              </Button>
            )}
          </Stack>
        ) : (
          <CircularProgress aria-label="Loading backup settings" />
        )}
      </Box>
    );

  const latest = runs.find((run) => run.status === "SUCCEEDED");
  const filtersActive = Boolean(
    search || statusFilter !== "ALL" || triggerFilter !== "ALL",
  );
  return (
    <Box sx={{ p: 3, maxWidth: 1200 }}>
      <Typography component="h1" variant="h4" gutterBottom>
        Backup settings
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Encrypted PostgreSQL backups are uploaded by the server worker to the
        configured private Google Drive folder.
      </Typography>
      {message ? (
        <Alert
          severity={
            message.includes("saved") || message.includes("queued")
              ? "success"
              : "error"
          }
          sx={{ mb: 2 }}
        >
          {message}
        </Alert>
      ) : null}
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
            >
              <Box>
                <Typography fontWeight={700}>Automatic backups</Typography>
                <Typography variant="body2" color="text.secondary">
                  Seconds are intended for local demonstration. Production
                  should use a longer interval.
                </Typography>
              </Box>
              <Switch
                checked={settings.enabled}
                onChange={(_, enabled) => setSettings({ ...settings, enabled })}
                inputProps={{ "aria-label": "Enable automatic backups" }}
              />
            </Stack>
            <TextField
              label="Backup interval (seconds)"
              type="number"
              value={interval}
              onChange={(event) => setIntervalValue(event.target.value)}
              inputProps={{ min: 10, max: 86400 }}
              helperText="Minimum 10 seconds, maximum 86,400 seconds."
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                disabled={busy}
                onClick={() => void save()}
              >
                Save settings
              </Button>
              <Button
                variant="outlined"
                disabled={busy}
                onClick={() => void runNow()}
              >
                Run backup now
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
      <Card variant="outlined" sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6">Latest successful backup</Typography>
          <Typography>
            {latest
              ? `${new Date(latest.completedAt ?? latest.requestedAt).toLocaleString()} · ${formatBytes(latest.byteCount)} · ${latest.checksum?.slice(0, 12) ?? ""}`
              : "No successful backup yet."}
          </Typography>
        </CardContent>
      </Card>
      <Card variant="outlined" sx={{ mt: 3 }}>
        <CardContent>
          <Stack spacing={2}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              alignItems={{ md: "center" }}
              justifyContent="space-between"
              spacing={1}
            >
              <Box>
                <Typography variant="h6">Backup history</Typography>
                <Typography variant="body2" color="text.secondary">
                  Showing {filteredRuns.length} of {runs.length} recent backup
                  requests.
                </Typography>
              </Box>
              {filtersActive ? (
                <Button
                  size="small"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("ALL");
                    setTriggerFilter("ALL");
                  }}
                >
                  Clear filters
                </Button>
              ) : null}
            </Stack>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <TextField
                fullWidth
                size="small"
                label="Search backup history"
                placeholder="ID, checksum, error, status"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchOutlinedIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel id="backup-status-filter-label">Status</InputLabel>
                <Select
                  labelId="backup-status-filter-label"
                  label="Status"
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as StatusFilter)
                  }
                >
                  <MenuItem value="ALL">All statuses</MenuItem>
                  <MenuItem value="QUEUED">Queued</MenuItem>
                  <MenuItem value="LEASED">In progress</MenuItem>
                  <MenuItem value="SUCCEEDED">Succeeded</MenuItem>
                  <MenuItem value="FAILED">Failed</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel id="backup-trigger-filter-label">
                  Trigger
                </InputLabel>
                <Select
                  labelId="backup-trigger-filter-label"
                  label="Trigger"
                  value={triggerFilter}
                  onChange={(event) =>
                    setTriggerFilter(event.target.value as TriggerFilter)
                  }
                >
                  <MenuItem value="ALL">All triggers</MenuItem>
                  <MenuItem value="MANUAL">Manual</MenuItem>
                  <MenuItem value="SCHEDULED">Scheduled</MenuItem>
                </Select>
              </FormControl>
            </Stack>
            <TableContainer>
              <Table size="small" aria-label="Backup history">
                <TableHead>
                  <TableRow>
                    <TableCell>Status</TableCell>
                    <TableCell>Trigger</TableCell>
                    <TableCell>Requested</TableCell>
                    <TableCell>Size</TableCell>
                    <TableCell>Integrity / issue</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredRuns.map((run) => (
                    <TableRow key={run.id} hover>
                      <TableCell>
                        <Chip
                          size="small"
                          label={stateLabel[run.status]}
                          color={
                            run.status === "SUCCEEDED"
                              ? "success"
                              : run.status === "FAILED"
                                ? "error"
                                : run.status === "LEASED"
                                  ? "info"
                                  : "default"
                          }
                        />
                      </TableCell>
                      <TableCell>
                        {run.trigger === "MANUAL" ? "Manual" : "Scheduled"}
                      </TableCell>
                      <TableCell>
                        {new Date(run.requestedAt).toLocaleString()}
                      </TableCell>
                      <TableCell>{formatBytes(run.byteCount)}</TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          color={
                            run.failureCode ? "error.main" : "text.secondary"
                          }
                        >
                          {run.failureCode ??
                            (run.checksum
                              ? `SHA-256 ${run.checksum.slice(0, 12)}…`
                              : "—")}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!filteredRuns.length ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Typography color="text.secondary">
                          No backup requests match these filters.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </TableContainer>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
