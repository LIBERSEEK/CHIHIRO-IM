import { ref } from "vue";
import {
  arrangeSidebarSessions,
  readSessionFlags,
  sessionPinned,
  withSessionFlag,
  writeSessionFlags,
  type SessionFlag,
} from "./sidebar-session-flags";

const flags = ref<Record<string, SessionFlag>>(readSessionFlags());

function persist(next: Record<string, SessionFlag>) {
  flags.value = next;
  try {
    writeSessionFlags(next);
  } catch {
    /* keep the in-memory choice when storage is unavailable */
  }
}

export function useSidebarSessionFlags() {
  function togglePin(sessionId: string) {
    persist(
      withSessionFlag(flags.value, sessionId, {
        pinned: !sessionPinned(flags.value, sessionId),
      }),
    );
  }

  function archiveSession(sessionId: string) {
    persist(
      withSessionFlag(flags.value, sessionId, {
        archived: true,
        pinned: false,
      }),
    );
  }

  function isPinned(sessionId: string) {
    return sessionPinned(flags.value, sessionId);
  }

  function arrange<T extends { session_id: string }>(sessions: T[]) {
    return arrangeSidebarSessions(sessions, flags.value);
  }

  return { flags, togglePin, archiveSession, isPinned, arrange };
}
