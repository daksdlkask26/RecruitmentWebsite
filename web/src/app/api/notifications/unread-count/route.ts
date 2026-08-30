import {
  requireAccountRequest,
  accountJson,
} from "@/backend/security/account-request-boundary";
import { createNotificationService } from "@/backend/notifications/notification-service-factory";
import { notificationRouteError } from "@/backend/notifications/notification-errors";
import { notificationUnreadCountSchema } from "@/shared/contracts/notifications";
import { withServerTiming } from "@/backend/observability/server-timing";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const actor = await requireAccountRequest(request);
    const authenticatedAt = performance.now();
    const response = accountJson(
      notificationUnreadCountSchema.parse(
        await createNotificationService().unreadCount(actor.userId),
      ),
    );
    return withServerTiming(response, [
      { name: "auth", durationMs: authenticatedAt - startedAt },
      { name: "app", durationMs: performance.now() - authenticatedAt },
      { name: "total", durationMs: performance.now() - startedAt },
    ]);
  } catch (error) {
    return withServerTiming(notificationRouteError(error), [
      { name: "total", durationMs: performance.now() - startedAt },
    ]);
  }
}
