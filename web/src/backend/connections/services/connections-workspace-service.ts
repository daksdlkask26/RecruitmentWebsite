import "server-only";

import { ConnectionNotificationService } from "./connection-notification-service";
import { ConnectionService } from "./connection-service";
import { ParticipantProposalService } from "./participant-proposal-service";

export async function getConnectionsWorkspaceData(userId: string) {
  const proposals = new ParticipantProposalService();
  const connections = new ConnectionService();
  const notifications = new ConnectionNotificationService();
  const [proposalPage, connectionPage, notificationPage] = await Promise.all([
    proposals.list(userId, { limit: 50 }),
    connections.list(userId, { limit: 50 }),
    notifications.list(userId, { limit: 50 }),
  ]);
  return {
    proposals: proposalPage.items,
    connections: connectionPage.items,
    notifications: notificationPage.items,
  };
}
