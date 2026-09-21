import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlockParticipantDialog } from "@/frontend/features/messaging/components/block-participant-dialog";

beforeEach(() => vi.restoreAllMocks());

describe("BlockParticipantDialog", () => {
  it("confirms an idempotent block and restores focus", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ targetUserId: "user-b", blocked: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const changed = vi.fn();
    render(
      <BlockParticipantDialog
        locale="vi"
        csrfProof="csrf"
        targetUserId="user-b"
        targetName="Recruiter B"
        blocked={false}
        onChanged={changed}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Chặn Recruiter B" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toHaveTextContent(
      /lịch sử tin nhắn vẫn được lưu/i,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /hủy|huỷ/i })).toHaveFocus(),
    );
    fireEvent.click(screen.getByRole("button", { name: /xác nhận chặn/i }));
    await waitFor(() => expect(changed).toHaveBeenCalledWith(true));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
