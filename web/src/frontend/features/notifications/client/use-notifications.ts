"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  notificationPageSchema,
  notificationReadMutationResultSchema,
  notificationUnreadCountSchema,
  type NotificationContextType,
} from "@/shared/contracts/notifications";
import { useEffect, useRef } from "react";
import { NOTIFICATION_CHANGED_EVENT } from "./use-notification-context-read";

const REFRESH_INTERVAL_MS = 30_000;

const visibleInterval = () =>
  typeof document === "undefined" || document.visibilityState === "visible"
    ? REFRESH_INTERVAL_MS
    : false;

async function readJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      typeof body?.code === "string"
        ? body.code
        : "NOTIFICATION_REQUEST_FAILED",
    );
  return body;
}

export type NotificationMutationAuth = {
  csrfProof?: string;
  getCsrfProof?: () => string | null;
};

const tokenFor = (auth: NotificationMutationAuth) =>
  auth.getCsrfProof?.() ?? auth.csrfProof ?? "";

function useNotificationRefreshEvents() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () =>
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    window.addEventListener(NOTIFICATION_CHANGED_EVENT, refresh);
    return () =>
      window.removeEventListener(NOTIFICATION_CHANGED_EVENT, refresh);
  }, [queryClient]);
}

type MutationInput = {
  notificationId?: string;
  contextType?: NotificationContextType;
  contextId?: string;
};

function useNotificationMutation(
  request: (input: MutationInput) => Promise<Response>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: MutationInput) =>
      notificationReadMutationResultSchema.parse(
        await readJson(await request(input)),
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useNotificationUnreadCount() {
  useNotificationRefreshEvents();
  const query = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: async () =>
      notificationUnreadCountSchema.parse(
        await readJson(
          await fetch("/api/notifications/unread-count", {
            cache: "no-store",
            credentials: "same-origin",
          }),
        ),
      ),
    staleTime: REFRESH_INTERVAL_MS,
    refetchInterval: visibleInterval,
  });
  const previousUnreadCount = useRef<number | null>(null);
  useEffect(() => {
    const nextUnreadCount = query.data?.unreadCount;
    if (nextUnreadCount === undefined) return;
    const previous = previousUnreadCount.current;
    previousUnreadCount.current = nextUnreadCount;
    if (previous !== null && nextUnreadCount > previous) {
      // Let application pages revalidate as soon as a new in-app notification
      // is observed, rather than waiting for their normal polling interval.
      window.dispatchEvent(new Event(NOTIFICATION_CHANGED_EVENT));
    }
  }, [query.data?.unreadCount]);
  return query;
}

export function useNotificationPages(input: {
  enabled: boolean;
  limit?: number;
  state?: "all" | "unread" | "read";
}) {
  useNotificationRefreshEvents();
  return useInfiniteQuery({
    queryKey: [
      "notifications",
      "pages",
      input.limit ?? 20,
      input.state ?? "all",
    ],
    enabled: input.enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const query = new URLSearchParams({
        limit: String(input.limit ?? 20),
        state: input.state ?? "all",
      });
      if (pageParam) query.set("cursor", pageParam);
      return notificationPageSchema.parse(
        await readJson(
          await fetch(`/api/notifications?${query}`, {
            cache: "no-store",
            credentials: "same-origin",
          }),
        ),
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: REFRESH_INTERVAL_MS,
    refetchInterval: visibleInterval,
  });
}

export function useNotificationMutations(auth: NotificationMutationAuth) {
  const headers = () => ({ "x-csrf-token": tokenFor(auth) });
  const markRead = useNotificationMutation(({ notificationId }) =>
    fetch(
      `/api/notifications/${encodeURIComponent(notificationId ?? "")}/read`,
      {
        method: "PATCH",
        credentials: "same-origin",
        headers: headers(),
      },
    ),
  );
  const markAllRead = useNotificationMutation(() =>
    fetch("/api/notifications/read-all", {
      method: "POST",
      credentials: "same-origin",
      headers: headers(),
    }),
  );
  const markContextRead = useNotificationMutation(
    ({ contextType, contextId }) =>
      fetch("/api/notifications/contexts/read", {
        method: "POST",
        credentials: "same-origin",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify({ contextType, contextId }),
      }),
  );
  return { markRead, markAllRead, markContextRead };
}
