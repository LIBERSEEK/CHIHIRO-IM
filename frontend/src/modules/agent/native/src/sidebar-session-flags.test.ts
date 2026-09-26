import { describe, expect, it } from "vitest";
import {
  arrangeSidebarSessions,
  readSessionFlags,
  withSessionFlag,
  writeSessionFlags,
} from "./sidebar-session-flags";

describe("sidebar session flags", () => {
  it("keeps pinned chats first and hides archived ones", () => {
    const flags = {
      a: { pinned: true },
      b: { archived: true },
    };
    expect(
      arrangeSidebarSessions(
        [{ session_id: "c" }, { session_id: "a" }, { session_id: "b" }],
        flags,
      ).map((session) => session.session_id),
    ).toEqual(["a", "c"]);
  });

  it("drops a flag once it is neither pinned nor archived", () => {
    const pinned = withSessionFlag({}, "a", { pinned: true });
    expect(withSessionFlag(pinned, "a", { pinned: false })).toEqual({});
  });

  it("round-trips flags through storage", () => {
    const bag = new Map<string, string>();
    const storage = {
      getItem: (key: string) => bag.get(key) ?? null,
      setItem: (key: string, value: string) => bag.set(key, value),
    };
    writeSessionFlags({ a: { pinned: true, archived: false } }, storage);
    expect(readSessionFlags(storage).a?.pinned).toBe(true);
  });
});
