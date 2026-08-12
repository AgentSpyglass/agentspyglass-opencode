import {SessionHold} from "../model/definitions";

const SESSIONS = new Map<string, SessionHold>();

export function getSession(id: string): SessionHold | undefined {
    return SESSIONS.get(id);
}

export function saveSession(session: SessionHold) {
    SESSIONS.set(session.id, session);
}

export function clearSessions() {
    SESSIONS.clear();
}
