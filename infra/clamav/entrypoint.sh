#!/bin/sh
set -eu

readonly CLAMAV_UID="100"
readonly CLAMAV_GID="101"
readonly RUNTIME_DIR="/run/clamav"
readonly SOCKET_PATH="${RUNTIME_DIR}/clamd.sock"
readonly DATABASE_DIR="/var/lib/clamav"
readonly CLAMD_CONFIG="/etc/clamav/clamd.conf"
readonly FRESHCLAM_CONFIG="/etc/clamav/freshclam.conf"
readonly STARTUP_TIMEOUT="${CLAMD_STARTUP_TIMEOUT_SECONDS:-1800}"
readonly RESTART_DELAY="${CLAMD_RESTART_DELAY_SECONDS:-60}"
readonly FRESHCLAM_CHECKS="${FRESHCLAM_CHECKS_PER_DAY:-12}"

freshclam_pid=""
clamd_pid=""

if [ "$(id -u clamav)" != "${CLAMAV_UID}" ] || [ "$(id -g clamav)" != "${CLAMAV_GID}" ]; then
  echo "ClamAV image user/group IDs do not match the reviewed shared socket contract." >&2
  exit 1
fi

install -d -o clamav -g clamav -m 0770 "${RUNTIME_DIR}"
install -d -o clamav -g clamav -m 0750 "${DATABASE_DIR}"
rm -f "${SOCKET_PATH}"

is_running() {
  [ -n "$1" ] && kill -0 "$1" 2>/dev/null
}

stop_process() {
  process_pid="$1"
  if is_running "${process_pid}"; then
    kill -TERM "${process_pid}" 2>/dev/null || true
    wait "${process_pid}" 2>/dev/null || true
  fi
}

cleanup() {
  trap - INT TERM EXIT
  stop_process "${clamd_pid}"
  stop_process "${freshclam_pid}"
  rm -f "${SOCKET_PATH}"
}

shutdown() {
  cleanup
  exit 0
}

start_freshclam() {
  freshclam \
    --daemon \
    --foreground \
    --stdout \
    --user=clamav \
    --checks="${FRESHCLAM_CHECKS}" \
    --config-file="${FRESHCLAM_CONFIG}" &
  freshclam_pid=$!
}

has_signature_database() {
  [ -s "${DATABASE_DIR}/main.cvd" ] ||
    [ -s "${DATABASE_DIR}/main.cld" ] ||
    [ -s "${DATABASE_DIR}/daily.cvd" ] ||
    [ -s "${DATABASE_DIR}/daily.cld" ] ||
    [ -s "${DATABASE_DIR}/bytecode.cvd" ] ||
    [ -s "${DATABASE_DIR}/bytecode.cld" ]
}

ensure_freshclam() {
  if is_running "${freshclam_pid}"; then
    return
  fi

  if [ -n "${freshclam_pid}" ]; then
    wait "${freshclam_pid}" 2>/dev/null || true
  fi
  echo "FreshClam updater stopped; restarting in ${RESTART_DELAY} seconds." >&2
  sleep "${RESTART_DELAY}"
  start_freshclam
}

trap shutdown INT TERM
trap cleanup EXIT

if has_signature_database; then
  echo "ClamAV signatures already cached; skipping initial refresh."
else
  if ! freshclam \
    --stdout \
    --user=clamav \
    --config-file="${FRESHCLAM_CONFIG}"; then
    echo "Initial signature refresh failed; FreshClam will keep retrying in the background." >&2
  fi
fi

start_freshclam

while true; do
  ensure_freshclam
  rm -f "${SOCKET_PATH}"

  clamd --foreground --config-file="${CLAMD_CONFIG}" &
  clamd_pid=$!
  elapsed=0
  socket_ready="false"

  while is_running "${clamd_pid}"; do
    if [ -S "${SOCKET_PATH}" ]; then
      socket_ready="true"
      break
    fi

    if [ "${elapsed}" -ge "${STARTUP_TIMEOUT}" ]; then
      echo "clamd did not create its Unix socket before the startup timeout." >&2
      stop_process "${clamd_pid}"
      break
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done

  if [ "${socket_ready}" = "true" ]; then
    chmod 0660 "${SOCKET_PATH}"
    chown clamav:clamav "${SOCKET_PATH}"
    echo "clamd is ready on ${SOCKET_PATH}."

    while is_running "${clamd_pid}"; do
      ensure_freshclam
      sleep 5
    done
  fi

  if [ -n "${clamd_pid}" ]; then
    wait "${clamd_pid}" 2>/dev/null || true
  fi
  clamd_pid=""
  rm -f "${SOCKET_PATH}"

  echo "clamd is unavailable; signatures remain fail-closed and startup will retry in ${RESTART_DELAY} seconds." >&2
  sleep "${RESTART_DELAY}"
done
