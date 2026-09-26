export interface SessionFlag {
  pinned?: boolean;
  archived?: boolean;
}

export const SIDEBAR_SESSION_FLAGS_KEY = "chihiro-sidebar-session-flags";

export function readSessionFlags(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined"
    ? null
    : localStorage,
): Record<string, SessionFlag> {
  try {
    const raw = storage?.getItem(SIDEBAR_SESSION_FLAGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, SessionFlag>;
  } catch {
    return {};
  }
}

export function writeSessionFlags(
  flags: Record<string, SessionFlag>,
  storage: Pick<Storage, "setItem"> | null = typeof localStorage === "undefined"
    ? null
    : localStorage,
) {
  storage?.setItem(SIDEBAR_SESSION_FLAGS_KEY, JSON.stringify(flags));
}

export function sessionPinned(flags: Record<string, SessionFlag>, sessionId: string) {
  return Boolean(flags[sessionId]?.pinned);
}

export function sessionArchived(flags: Record<string, SessionFlag>, sessionId: string) {
  return Boolean(flags[sessionId]?.archived);
}

export function withSessionFlag(
  flags: Record<string, SessionFlag>,
  sessionId: string,
  patch: SessionFlag,
): Record<string, SessionFlag> {
  const nextFlag = { ...(flags[sessionId] || {}), ...patch };
  const next = { ...flags };
  if (!nextFlag.pinned && !nextFlag.archived) {
    delete next[sessionId];
  } else {
    next[sessionId] = {
      pinned: Boolean(nextFlag.pinned),
      archived: Boolean(nextFlag.archived),
    };
  }
  return next;
}

export function arrangeSidebarSessions<T extends { session_id: string }>(
  sessions: T[],
  flags: Record<string, SessionFlag>,
): T[] {
  return sessions
    .filter((session) => !sessionArchived(flags, session.session_id))
    .sort(
      (left, right) =>
        Number(sessionPinned(flags, right.session_id)) -
        Number(sessionPinned(flags, left.session_id)),
    );
}
