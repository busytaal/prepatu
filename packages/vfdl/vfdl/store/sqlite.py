"""
SQLite implementation of SessionStore.

All I/O is async via aiosqlite — each call borrows a connection from a module-
level pool lazily created on first use.  No ORM, no migrations tool — the
schema is created on startup in `initialize()`.

Database file: session_store.db (configurable via SESSION_DB_PATH env var).
"""

from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any

import aiosqlite

from .interface import E, SessionEvent, SessionRecord, SessionStore

_DB_PATH = os.getenv("SESSION_DB_PATH", "session_store.db")

_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS sessions (
    id             TEXT PRIMARY KEY,
    mode           TEXT NOT NULL,
    interview_type TEXT,
    started_at     REAL NOT NULL,
    ended_at       REAL,
    metadata       TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS session_events (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    event_type TEXT NOT NULL,
    ts         REAL NOT NULL,
    data       TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS device_flags (
    device_id  TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      INTEGER NOT NULL DEFAULT 0,
    updated_at REAL NOT NULL,
    PRIMARY KEY (device_id, key)
);

CREATE TABLE IF NOT EXISTS user_context (
    id         TEXT PRIMARY KEY,
    device_id  TEXT NOT NULL,
    event_type TEXT NOT NULL,
    data       TEXT NOT NULL DEFAULT '{}',
    ts         REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
    device_id      TEXT PRIMARY KEY,
    name           TEXT,
    target_band    REAL NOT NULL DEFAULT 7.0,
    active_program TEXT NOT NULL DEFAULT 'ielts_practice',
    created_at     REAL NOT NULL,
    updated_at     REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS session_scores (
    session_id          TEXT PRIMARY KEY REFERENCES sessions(id),
    program_id          TEXT NOT NULL,
    fluency_coherence   REAL,
    lexical_resource    REAL,
    grammatical_range   REAL,
    pronunciation       REAL,
    overall_band        REAL,
    filler_words        INTEGER,
    topics              TEXT NOT NULL DEFAULT '[]',
    feedback            TEXT NOT NULL DEFAULT '{}',
    evaluated_at        REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_ctx_device ON user_context(device_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_session  ON session_events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_type     ON session_events(event_type);
CREATE INDEX IF NOT EXISTS idx_sessions_mode   ON sessions(mode);
CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(id);
"""


class SqliteSessionStore(SessionStore):

    def __init__(self, db_path: str = _DB_PATH) -> None:
        self._db_path = db_path
        self._db: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        """Create tables if they don't exist.  Call once at app startup."""
        self._db = await aiosqlite.connect(self._db_path)
        self._db.row_factory = aiosqlite.Row
        await self._db.executescript(_CREATE_SQL)
        # ── Schema migrations for existing DBs ─────────────────────────────
        for col_sql in [
            "ALTER TABLE sessions ADD COLUMN device_id TEXT",
            "ALTER TABLE sessions ADD COLUMN program_id TEXT",
        ]:
            try:
                await self._db.execute(col_sql)
            except Exception:
                pass  # column already exists
        await self._db.commit()

    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None

    # ── SessionStore implementation ────────────────────────────────────────────

    async def create_session(
        self,
        session_id: str,
        mode: str,
        interview_type: str | None = None,
        metadata: dict | None = None,
    ) -> SessionRecord:
        rec = SessionRecord(
            id=session_id,
            mode=mode,
            interview_type=interview_type,
            started_at=time.time(),
            ended_at=None,
            metadata=metadata or {},
        )
        await self._db.execute(
            "INSERT INTO sessions(id, mode, interview_type, started_at, metadata) "
            "VALUES (?,?,?,?,?)",
            (rec.id, rec.mode, rec.interview_type, rec.started_at, json.dumps(rec.metadata)),
        )
        await self._db.commit()
        return rec

    async def end_session(self, session_id: str) -> None:
        await self._db.execute(
            "UPDATE sessions SET ended_at=? WHERE id=?",
            (time.time(), session_id),
        )
        await self._db.commit()

    async def append_event(self, event: SessionEvent) -> None:
        await self._db.execute(
            "INSERT INTO session_events(id, session_id, event_type, ts, data) "
            "VALUES (?,?,?,?,?)",
            (event.id, event.session_id, event.event_type, event.ts, json.dumps(event.data)),
        )
        await self._db.commit()

    async def get_session(self, session_id: str) -> SessionRecord | None:
        async with self._db.execute(
            "SELECT * FROM sessions WHERE id=?", (session_id,)
        ) as cur:
            row = await cur.fetchone()
        return _row_to_session(row) if row else None

    async def get_events(
        self,
        session_id: str,
        event_types: list[str] | None = None,
    ) -> list[SessionEvent]:
        if event_types:
            placeholders = ",".join("?" * len(event_types))
            sql = (
                f"SELECT * FROM session_events "
                f"WHERE session_id=? AND event_type IN ({placeholders}) "
                f"ORDER BY ts"
            )
            params = [session_id, *event_types]
        else:
            sql    = "SELECT * FROM session_events WHERE session_id=? ORDER BY ts"
            params = [session_id]

        async with self._db.execute(sql, params) as cur:
            rows = await cur.fetchall()
        return [_row_to_event(r) for r in rows]

    async def list_sessions(
        self,
        mode: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[SessionRecord]:
        if mode:
            sql    = "SELECT * FROM sessions WHERE mode=? ORDER BY started_at DESC LIMIT ? OFFSET ?"
            params: list[Any] = [mode, limit, offset]
        else:
            sql    = "SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?"
            params = [limit, offset]

        async with self._db.execute(sql, params) as cur:
            rows = await cur.fetchall()
        return [_row_to_session(r) for r in rows]

    async def get_device_flag(self, device_id: str, key: str) -> bool | None:
        async with self._db.execute(
            "SELECT value FROM device_flags WHERE device_id=? AND key=?",
            (device_id, key),
        ) as cur:
            row = await cur.fetchone()
        return bool(row["value"]) if row is not None else None

    async def set_device_flag(self, device_id: str, key: str, value: bool) -> None:
        await self._db.execute(
            "INSERT INTO device_flags(device_id, key, value, updated_at) VALUES(?,?,?,?) "
            "ON CONFLICT(device_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (device_id, key, int(value), time.time()),
        )
        await self._db.commit()

    async def append_user_event(
        self,
        device_id: str,
        event_type: str,
        data: dict,
    ) -> None:
        await self._db.execute(
            "INSERT INTO user_context(id, device_id, event_type, data, ts) VALUES(?,?,?,?,?)",
            (str(uuid.uuid4()), device_id, event_type, json.dumps(data), time.time()),
        )
        await self._db.commit()

    async def get_user_context(self, device_id: str, limit: int = 20) -> list[dict]:
        async with self._db.execute(
            "SELECT event_type, data, ts FROM user_context "
            "WHERE device_id=? ORDER BY ts DESC LIMIT ?",
            (device_id, limit),
        ) as cur:
            rows = await cur.fetchall()
        return [
            {"event_type": r["event_type"], "data": json.loads(r["data"]), "ts": r["ts"]}
            for r in rows
        ]

    # ── Profile ────────────────────────────────────────────────────────────────

    async def get_profile(self, device_id: str) -> dict | None:
        async with self._db.execute(
            "SELECT * FROM profiles WHERE device_id=?", (device_id,)
        ) as cur:
            row = await cur.fetchone()
        if row is None:
            return None
        return {
            "device_id":      row["device_id"],
            "name":           row["name"],
            "target_band":    row["target_band"],
            "active_program": row["active_program"],
            "created_at":     row["created_at"],
            "updated_at":     row["updated_at"],
        }

    async def upsert_profile(
        self,
        device_id: str,
        name: str | None = None,
        target_band: float | None = None,
        active_program: str | None = None,
    ) -> dict:
        now = time.time()
        existing = await self.get_profile(device_id)
        if existing is None:
            profile = {
                "device_id":      device_id,
                "name":           name,
                "target_band":    target_band if target_band is not None else 7.0,
                "active_program": active_program or "ielts_practice",
                "created_at":     now,
                "updated_at":     now,
            }
            await self._db.execute(
                "INSERT INTO profiles(device_id, name, target_band, active_program, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?)",
                (profile["device_id"], profile["name"], profile["target_band"],
                 profile["active_program"], profile["created_at"], profile["updated_at"]),
            )
        else:
            profile = dict(existing)
            if name is not None:
                profile["name"] = name
            if target_band is not None:
                profile["target_band"] = target_band
            if active_program is not None:
                profile["active_program"] = active_program
            profile["updated_at"] = now
            await self._db.execute(
                "UPDATE profiles SET name=?, target_band=?, active_program=?, updated_at=? "
                "WHERE device_id=?",
                (profile["name"], profile["target_band"], profile["active_program"],
                 profile["updated_at"], device_id),
            )
        await self._db.commit()
        return profile

    # ── Session scores ─────────────────────────────────────────────────────────

    async def save_session_scores(self, session_id: str, program_id: str, scores: dict) -> None:
        feedback = scores.get("feedback", {})
        metrics  = scores.get("metrics", {})
        topics   = metrics.get("topics_covered", [])
        await self._db.execute(
            """
            INSERT INTO session_scores(
                session_id, program_id, fluency_coherence, lexical_resource,
                grammatical_range, pronunciation, overall_band,
                filler_words, topics, feedback, evaluated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(session_id) DO UPDATE SET
                fluency_coherence=excluded.fluency_coherence,
                lexical_resource=excluded.lexical_resource,
                grammatical_range=excluded.grammatical_range,
                pronunciation=excluded.pronunciation,
                overall_band=excluded.overall_band,
                filler_words=excluded.filler_words,
                topics=excluded.topics,
                feedback=excluded.feedback,
                evaluated_at=excluded.evaluated_at
            """,
            (
                session_id,
                program_id,
                scores.get("fluency_coherence"),
                scores.get("lexical_resource"),
                scores.get("grammatical_range"),
                scores.get("pronunciation"),
                scores.get("overall_band"),
                metrics.get("filler_words"),
                json.dumps(topics),
                json.dumps(feedback),
                time.time(),
            ),
        )
        await self._db.commit()

    async def get_session_scores(self, session_id: str) -> dict | None:
        async with self._db.execute(
            "SELECT * FROM session_scores WHERE session_id=?", (session_id,)
        ) as cur:
            row = await cur.fetchone()
        if row is None:
            return None
        return {
            "session_id":        row["session_id"],
            "program_id":        row["program_id"],
            "fluency_coherence": row["fluency_coherence"],
            "lexical_resource":  row["lexical_resource"],
            "grammatical_range": row["grammatical_range"],
            "pronunciation":     row["pronunciation"],
            "overall_band":      row["overall_band"],
            "filler_words":      row["filler_words"],
            "topics":            json.loads(row["topics"]),
            "feedback":          json.loads(row["feedback"]),
            "evaluated_at":      row["evaluated_at"],
        }

    async def list_sessions_for_device(
        self,
        device_id: str,
        program_id: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        """Return sessions for a device, joined with scores where available."""
        if program_id:
            sql = """
                SELECT s.id, s.mode, s.program_id, s.started_at, s.ended_at, s.metadata,
                       sc.overall_band, sc.fluency_coherence, sc.lexical_resource,
                       sc.grammatical_range, sc.pronunciation, sc.topics, sc.feedback
                FROM sessions s
                LEFT JOIN session_scores sc ON sc.session_id = s.id
                WHERE s.device_id=? AND s.program_id=?
                ORDER BY s.started_at DESC LIMIT ?
            """
            params: list[Any] = [device_id, program_id, limit]
        else:
            sql = """
                SELECT s.id, s.mode, s.program_id, s.started_at, s.ended_at, s.metadata,
                       sc.overall_band, sc.fluency_coherence, sc.lexical_resource,
                       sc.grammatical_range, sc.pronunciation, sc.topics, sc.feedback
                FROM sessions s
                LEFT JOIN session_scores sc ON sc.session_id = s.id
                WHERE s.device_id=?
                ORDER BY s.started_at DESC LIMIT ?
            """
            params = [device_id, limit]

        async with self._db.execute(sql, params) as cur:
            rows = await cur.fetchall()

        result = []
        for r in rows:
            result.append({
                "id":                r["id"],
                "mode":              r["mode"],
                "program_id":        r["program_id"],
                "started_at":        r["started_at"],
                "ended_at":          r["ended_at"],
                "duration_secs":     round((r["ended_at"] or r["started_at"]) - r["started_at"]),
                "overall_band":      r["overall_band"],
                "fluency_coherence": r["fluency_coherence"],
                "lexical_resource":  r["lexical_resource"],
                "grammatical_range": r["grammatical_range"],
                "pronunciation":     r["pronunciation"],
                "topics":            json.loads(r["topics"]) if r["topics"] else [],
                "feedback":          json.loads(r["feedback"]) if r["feedback"] else {},
            })
        return result


# ── Row mappers ────────────────────────────────────────────────────────────────

def _row_to_session(row: aiosqlite.Row) -> SessionRecord:
    return SessionRecord(
        id=row["id"],
        mode=row["mode"],
        interview_type=row["interview_type"],
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        metadata=json.loads(row["metadata"]),
    )


def _row_to_event(row: aiosqlite.Row) -> SessionEvent:
    return SessionEvent(
        id=row["id"],
        session_id=row["session_id"],
        event_type=row["event_type"],
        ts=row["ts"],
        data=json.loads(row["data"]),
    )
