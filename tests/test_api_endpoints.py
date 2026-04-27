"""
test_api_endpoints.py — HTTP endpoint smoke tests.

Boots the full ASGI app in-process (no network, no real audio).
Tests that all key routes are reachable and return expected status codes.
"""
import pytest
from httpx import AsyncClient, ASGITransport


@pytest.fixture(scope="module")
def app():
    # conftest.py puts apps/ielts/backend on sys.path, so `main` resolves correctly.
    from main import app as _app  #type: ignore[import]
    return _app


@pytest.fixture
async def client(app):
    """Async ASGI client — required because ASGITransport is async-only."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


# ── Engine routes ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", ["/health", "/capabilities", "/ice-servers"])
async def test_engine_routes_return_200(client, path):
    r = await client.get(path)
    assert r.status_code == 200, f"{path} → {r.status_code}: {r.text[:200]}"


# ── App routes ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", [
    "/interview-types",
    "/programs",
    "/flows",
])
async def test_app_routes_return_200(client, path):
    r = await client.get(path)
    assert r.status_code == 200, f"{path} → {r.status_code}: {r.text[:200]}"


async def test_interview_types_shape(client):
    r = await client.get("/interview-types")
    data = r.json()
    assert "types" in data
    assert isinstance(data["types"], list)
    assert len(data["types"]) > 0
    ids = [t["id"] for t in data["types"]]
    assert "part1" in ids


async def test_flows_shape(client):
    r = await client.get("/flows")
    data = r.json()
    assert "flows" in data
    assert isinstance(data["flows"], list)
    assert "onboarding" in data["flows"]


async def test_programs_shape(client):
    r = await client.get("/programs")
    data = r.json()
    assert "programs" in data
    assert isinstance(data["programs"], list)


async def test_individual_flow_returns_dict(client):
    """GET /flows/{name} should return the YAML as a dict."""
    r = await client.get("/flows/onboarding")
    assert r.status_code == 200
    data = r.json()
    assert "id" in data
    assert "states" in data


async def test_unknown_flow_returns_404(client):
    r = await client.get("/flows/does_not_exist_xyz")
    assert r.status_code == 404


async def test_config_endpoint_returns_200(client):
    """Public /config endpoint (remote config flags for client SDK)."""
    r = await client.get("/config")
    assert r.status_code == 200


# ── Offer endpoint basic validation ───────────────────────────────────────────

async def test_offer_missing_body_returns_422(client):
    """POST /offer with no body → 422 Unprocessable Entity."""
    r = await client.post("/offer", json={})
    assert r.status_code == 422
