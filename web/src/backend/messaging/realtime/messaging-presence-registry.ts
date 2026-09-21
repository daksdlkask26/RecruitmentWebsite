import "server-only";

export type PresenceTransition = {
  userId: string;
  presence: "ONLINE" | "OFFLINE";
};

export class MessagingPresenceRegistry {
  private readonly socketsByUser = new Map<string, Set<string>>();
  private readonly userBySocket = new Map<string, string>();
  private readonly pendingOffline = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor(
    private readonly graceMs: number,
    private readonly onTransition: (
      event: PresenceTransition,
    ) => void | Promise<void>,
  ) {}

  private emitTransition(event: PresenceTransition) {
    // Presence is a best-effort side effect. A failed fan-out must never become
    // an unhandled rejection on the Socket.IO event loop.
    try {
      void Promise.resolve(this.onTransition(event)).catch(() => undefined);
    } catch {
      // Synchronous publisher failures are contained as well.
    }
  }

  register(socketId: string, userId: string) {
    const pending = this.pendingOffline.get(userId);
    if (pending) {
      clearTimeout(pending);
      this.pendingOffline.delete(userId);
    }
    const sockets = this.socketsByUser.get(userId) ?? new Set<string>();
    const wasOffline = sockets.size === 0;
    sockets.add(socketId);
    this.socketsByUser.set(userId, sockets);
    this.userBySocket.set(socketId, userId);
    if (wasOffline) this.emitTransition({ userId, presence: "ONLINE" });
  }

  unregister(socketId: string) {
    const userId = this.userBySocket.get(socketId);
    if (!userId) return;
    this.userBySocket.delete(socketId);
    const sockets = this.socketsByUser.get(userId);
    sockets?.delete(socketId);
    if ((sockets?.size ?? 0) > 0) return;
    this.socketsByUser.delete(userId);
    const timer = setTimeout(() => {
      this.pendingOffline.delete(userId);
      if (!this.isOnline(userId)) {
        this.emitTransition({ userId, presence: "OFFLINE" });
      }
    }, this.graceMs);
    this.pendingOffline.set(userId, timer);
  }

  isOnline(userId: string) {
    return (this.socketsByUser.get(userId)?.size ?? 0) > 0;
  }

  reset() {
    for (const timer of this.pendingOffline.values()) clearTimeout(timer);
    this.pendingOffline.clear();
    this.socketsByUser.clear();
    this.userBySocket.clear();
  }
}
