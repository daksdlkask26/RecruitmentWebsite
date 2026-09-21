import { afterEach, describe, expect, it, vi } from "vitest";
import { MessagingPresenceRegistry } from "@/backend/messaging/realtime/messaging-presence-registry";

afterEach(() => vi.useRealTimers());

describe("MessagingPresenceRegistry", () => {
  it("counts multiple tabs and emits offline only after the grace period", async () => {
    vi.useFakeTimers();
    const events: Array<{ userId: string; presence: "ONLINE" | "OFFLINE" }> =
      [];
    const registry = new MessagingPresenceRegistry(2_000, (event) => {
      events.push(event);
    });
    registry.register("socket-1", "user-a");
    registry.register("socket-2", "user-a");
    expect(events).toEqual([{ userId: "user-a", presence: "ONLINE" }]);
    registry.unregister("socket-1");
    await vi.advanceTimersByTimeAsync(2_500);
    expect(events).toHaveLength(1);
    registry.unregister("socket-2");
    await vi.advanceTimersByTimeAsync(1_999);
    expect(events).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(events.at(-1)).toEqual({ userId: "user-a", presence: "OFFLINE" });
  });

  it("cancels a pending offline transition on reconnect and resets memory", async () => {
    vi.useFakeTimers();
    const events = vi.fn();
    const registry = new MessagingPresenceRegistry(2_000, events);
    registry.register("socket-1", "user-a");
    registry.unregister("socket-1");
    registry.register("socket-2", "user-a");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(events).toHaveBeenCalledTimes(2);
    expect(events).toHaveBeenLastCalledWith({
      userId: "user-a",
      presence: "ONLINE",
    });
    registry.reset();
    expect(registry.isOnline("user-a")).toBe(false);
  });

  it("contains a rejected transition without an unhandled promise", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const registry = new MessagingPresenceRegistry(0, async () => {
        throw new Error("PRESENCE_PUBLISH_FAILED");
      });
      registry.register("socket-1", "user-a");
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off("unhandledRejection", unhandled);
    }
    expect(unhandled).not.toHaveBeenCalled();
  });
});
