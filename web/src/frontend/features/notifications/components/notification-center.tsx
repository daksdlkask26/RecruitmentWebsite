"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useNotificationMutations,
  useNotificationPages,
  useNotificationUnreadCount,
  type NotificationMutationAuth,
} from "../client/use-notifications";
import { notificationCopy, notificationTime } from "../notification-copy";
import type { NotificationItem } from "@/shared/contracts/notifications";
import { requestUnsavedChangesNavigation } from "@/frontend/features/profile/client/unsaved-changes";

export function NotificationCenter(
  props: NotificationMutationAuth & {
    locale?: "vi" | "en";
    viewAllHref?: string;
  },
) {
  return <NotificationCenterContent {...props} />;
}

function NotificationCenterContent({
  locale = "en",
  viewAllHref = "/notifications",
  ...auth
}: NotificationMutationAuth & {
  locale?: "vi" | "en";
  viewAllHref?: string;
}) {
  const [open, setOpen] = useState(false);
  const centerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const router = useRouter();
  const copy = notificationCopy[locale];
  const count = useNotificationUnreadCount();
  const pages = useNotificationPages({ enabled: open, limit: 8 });
  const { markRead, markAllRead } = useNotificationMutations(auth);
  const items = pages.data?.pages.flatMap((page) => page.items) ?? [];
  const unreadCount = count.data?.unreadCount ?? 0;

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !centerRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  async function openItem(item: NotificationItem) {
    if (!item.readAt)
      void markRead
        .mutateAsync({ notificationId: item.id })
        .catch(() => toast.error(copy.error));
    const href = item.href;
    if (!href) return;
    const current = `${window.location.pathname}${window.location.search}`;
    if (current === href) return;
    setOpen(false);
    requestUnsavedChangesNavigation(() => router.push(href));
  }

  function markItemRead(item: NotificationItem) {
    if (item.readAt) return;
    void markRead
      .mutateAsync({ notificationId: item.id })
      .catch(() => toast.error(copy.error));
  }

  return (
    <div ref={centerRef} className="notification-center">
      <button
        type="button"
        className="notification-bell"
        aria-label={`${copy.label}: ${unreadCount} ${copy.unread.toLowerCase()}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {unreadCount > 0 ? (
          <span className="notification-badge" aria-hidden="true">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <section
          id={panelId}
          className="notification-panel"
          aria-label={copy.title}
          aria-live="polite"
        >
          <header className="notification-panel__header">
            <h2>{copy.title}</h2>
            <button
              type="button"
              disabled={unreadCount === 0 || markAllRead.isPending}
              onClick={() =>
                markAllRead.mutateAsync({}).catch(() => toast.error(copy.error))
              }
            >
              {copy.markAll}
            </button>
          </header>
          {pages.isPending ? (
            <p className="notification-state" aria-busy="true">
              {copy.loading}
            </p>
          ) : pages.isError ? (
            <div className="notification-state" role="alert">
              <p>{copy.error}</p>
              <button type="button" onClick={() => void pages.refetch()}>
                {copy.retry}
              </button>
            </div>
          ) : items.length === 0 ? (
            <p className="notification-state">{copy.empty}</p>
          ) : (
            <ul className="notification-list">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="notification-item-wrapper"
                  data-read={Boolean(item.readAt)}
                  data-severity={item.severity}
                >
                  <div
                    className="notification-item"
                    data-read={Boolean(item.readAt)}
                    data-severity={item.severity}
                    onClick={() => void openItem(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void openItem(item);
                      }
                    }}
                  >
                    {!item.readAt ? (
                      <span
                        className="notification-item__accent"
                        aria-hidden="true"
                      />
                    ) : null}
                    <div className="notification-item__meta">
                      <span className="notification-item__severity">
                        {copy.severities[item.severity]}
                      </span>
                      <span className="notification-item__status">
                        {item.readAt ? copy.read : copy.unread}
                      </span>
                    </div>
                    <strong className="notification-item__title">
                      {item.title}
                    </strong>
                    <span className="notification-item__summary">
                      {item.summary}
                    </span>
                    <div className="notification-item__footer">
                      <time dateTime={item.lastOccurredAt}>
                        {notificationTime(item.lastOccurredAt, locale)}
                      </time>
                      {!item.readAt ? (
                        <button
                          type="button"
                          className="notification-item__mark-read"
                          onClick={(e) => {
                            e.stopPropagation();
                            markItemRead(item);
                          }}
                          aria-label={`${copy.markAsRead}: ${item.title}`}
                        >
                          {copy.markAsRead}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <footer className="notification-panel__footer">
            {viewAllHref.startsWith("#") ? (
              <a href={viewAllHref} onClick={() => setOpen(false)}>
                {copy.viewAll}
              </a>
            ) : (
              <Link href={viewAllHref} onClick={() => setOpen(false)}>
                {copy.viewAll}
              </Link>
            )}
          </footer>
        </section>
      ) : null}
    </div>
  );
}
