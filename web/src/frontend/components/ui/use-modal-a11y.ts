"use client";

import { useEffect, useRef, type RefObject } from "react";

const focusableSelector =
  "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

export function useModalA11y<T extends HTMLElement = HTMLElement>({
  open,
  busy = false,
  onClose,
  initialFocusRef,
  returnFocusRef,
  lockBodyScroll = true,
  onKeyDown,
}: {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  lockBodyScroll?: boolean;
  onKeyDown?: (event: KeyboardEvent) => void;
}) {
  const dialogRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  const onKeyDownRef = useRef(onKeyDown);

  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
    onKeyDownRef.current = onKeyDown;
  }, [busy, onClose, onKeyDown]);

  useEffect(() => {
    if (!open) return;

    const returnTarget =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null;
    const explicitReturnTarget = returnFocusRef?.current;
    const previousOverflow = document.body.style.overflow;
    if (lockBodyScroll) document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      const preferred =
        initialFocusRef?.current ??
        dialogRef.current?.querySelector<HTMLElement>(
          `[data-autofocus], ${focusableSelector}`,
        );
      (preferred ?? dialogRef.current)?.focus();
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      onKeyDownRef.current?.(event);
      if (event.defaultPrevented || event.key !== "Tab" || !dialogRef.current)
        return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!dialogRef.current.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      if (lockBodyScroll) document.body.style.overflow = previousOverflow;
      (returnTarget ?? explicitReturnTarget)?.focus();
    };
  }, [initialFocusRef, lockBodyScroll, open, returnFocusRef]);

  return dialogRef;
}
