"""
Per-account flow CRUD.

Flows are VFDL YAML documents stored in the cloud DB.
Each account can store multiple named flows and reference them by ID at session start.
"""

from __future__ import annotations

import time
import uuid

import asyncpg
import yaml as _yaml
from fastapi import HTTPException

from cloud.models import FlowCreate, FlowDetail, FlowSummary


async def create_flow(user_id: str, body: FlowCreate, db: asyncpg.Connection) -> FlowDetail:
    try:
        _yaml.safe_load(body.yaml_content)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid YAML: {exc}")

    flow_id    = str(uuid.uuid4())
    created_at = time.time()

    await db.execute(
        "INSERT INTO flows (id, user_id, name, yaml_content, created_at) VALUES ($1, $2, $3, $4, $5)",
        flow_id, user_id, body.name, body.yaml_content, created_at,
    )
    return FlowDetail(id=flow_id, name=body.name, yaml_content=body.yaml_content, created_at=created_at)


async def list_flows(user_id: str, db: asyncpg.Connection) -> list[FlowSummary]:
    rows = await db.fetch(
        "SELECT id, name, created_at FROM flows WHERE user_id = $1 ORDER BY created_at DESC",
        user_id,
    )
    return [FlowSummary(id=r["id"], name=r["name"], created_at=r["created_at"]) for r in rows]


async def get_flow(user_id: str, flow_id: str, db: asyncpg.Connection) -> FlowDetail:
    row = await db.fetchrow(
        "SELECT id, name, yaml_content, created_at FROM flows WHERE id = $1 AND user_id = $2",
        flow_id, user_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Flow not found")
    return FlowDetail(
        id=row["id"],
        name=row["name"],
        yaml_content=row["yaml_content"],
        created_at=row["created_at"],
    )


async def get_flow_yaml(user_id: str, flow_id: str, db: asyncpg.Connection) -> str:
    """Returns just the raw YAML string for use by the voice handler."""
    detail = await get_flow(user_id, flow_id, db)
    return detail.yaml_content


async def delete_flow(user_id: str, flow_id: str, db: asyncpg.Connection) -> None:
    row = await db.fetchrow(
        "SELECT id FROM flows WHERE id = $1 AND user_id = $2", flow_id, user_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Flow not found")
    await db.execute("DELETE FROM flows WHERE id = $1", flow_id)


async def get_flow_as_json(user_id: str, flow_id: str, db: asyncpg.Connection) -> dict:
    """Return the flow parsed from YAML into a plain dict (for the visual editor)."""
    detail = await get_flow(user_id, flow_id, db)
    try:
        return _yaml.safe_load(detail.yaml_content) or {}
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Stored YAML is invalid: {exc}")


async def update_flow_from_json(
    user_id: str, flow_id: str, data: dict, db: asyncpg.Connection
) -> None:
    """Persist a flow edited as JSON in the visual editor (serialized back to YAML)."""
    row = await db.fetchrow(
        "SELECT id FROM flows WHERE id = $1 AND user_id = $2", flow_id, user_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Flow not found")
    yaml_content = _yaml.dump(data, allow_unicode=True, sort_keys=False)
    await db.execute(
        "UPDATE flows SET yaml_content = $1 WHERE id = $2",
        yaml_content, flow_id,
    )

