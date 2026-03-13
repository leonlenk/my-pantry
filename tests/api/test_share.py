"""
Tests for the recipe sharing endpoints.

POST /api/share  — authenticated; creates a single shareable link for a batch
                   of recipes (all stored in one DB row as a JSON array).
GET  /s/{id}     — public; returns an HTML recipe card (single recipe) or
                   a mini-pantry grid (multiple recipes), or 404.
"""

from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock
from tests.api.conftest import FAKE_USER_ID


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_share_mock(data=None):
    """Returns a mock Supabase client wired for the share router's query patterns."""
    mock_client = MagicMock()
    mock_result = MagicMock()
    mock_result.data = data or []

    chain = MagicMock()
    chain.execute.return_value = mock_result
    chain.eq.return_value = chain
    chain.gt.return_value = chain
    chain.limit.return_value = chain
    chain.select.return_value = chain
    chain.insert.return_value = chain   # share router uses insert, not upsert

    mock_client.table.return_value = chain
    return mock_client, chain, mock_result


def _share_patch(mock_client):
    """Context manager that patches get_supabase_client in the share router."""
    return patch("src.routers.share.get_supabase_client", return_value=mock_client)


def _future_expiry():
    return (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()


def _past_expiry():
    return (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()


# ---------------------------------------------------------------------------
# POST /api/share
# ---------------------------------------------------------------------------

class TestSharePost:

    def test_share_single_recipe_returns_url(self, client, mock_verify_jwt):
        """Sharing one recipe returns a single URL string."""
        mock_client, _, _ = _build_share_mock()
        with _share_patch(mock_client):
            resp = client.post(
                "/api/share",
                json={"recipes": [{"id": "recipe-001", "title": "Pancakes"}]},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert "url" in body
        assert "/s/" in body["url"]

    def test_share_batch_returns_one_url(self, client, mock_verify_jwt):
        """Multiple recipes in the batch produce a single shared URL (one DB row)."""
        mock_client, _, _ = _build_share_mock()
        recipes = [
            {"id": "r1", "title": "Pancakes"},
            {"id": "r2", "title": "Waffles"},
            {"id": "r3", "title": "French Toast"},
        ]
        with _share_patch(mock_client):
            resp = client.post("/api/share", json={"recipes": recipes})
        assert resp.status_code == 200
        body = resp.json()
        # Exactly one URL — all recipes are bundled into a single share link
        assert "url" in body
        assert isinstance(body["url"], str)
        assert "/s/" in body["url"]

    def test_share_url_uses_public_base_url(self, client, mock_verify_jwt):
        """The returned URL is built from settings.public_base_url."""
        mock_client, _, _ = _build_share_mock()
        # settings is a module-level singleton; patch the attribute directly.
        with _share_patch(mock_client), \
             patch("src.routers.share.settings") as mock_settings:
            mock_settings.public_base_url = "https://example.dev"
            mock_settings.share_expiry_days = 30
            resp = client.post(
                "/api/share",
                json={"recipes": [{"id": "r1", "title": "Test"}]},
            )
        assert resp.status_code == 200
        url = resp.json()["url"]
        assert url.startswith("https://example.dev/s/")

    def test_share_strips_embedding(self, client, mock_verify_jwt):
        """The embedding field is stripped before inserting into shared_recipes."""
        mock_client, chain, _ = _build_share_mock()
        recipe = {"id": "r1", "title": "Soup", "embedding": [0.1, 0.2, 0.3]}
        with _share_patch(mock_client):
            resp = client.post("/api/share", json={"recipes": [recipe]})
        assert resp.status_code == 200

        insert_call = chain.insert.call_args
        row = insert_call[0][0]  # single row dict
        for clean_recipe in row["recipe_json"]:
            assert "embedding" not in clean_recipe

    def test_share_strips_tags(self, client, mock_verify_jwt):
        """Personal tags are stripped before inserting into shared_recipes."""
        mock_client, chain, _ = _build_share_mock()
        recipe = {"id": "r1", "title": "Soup", "tags": ["dinner", "easy"]}
        with _share_patch(mock_client):
            resp = client.post("/api/share", json={"recipes": [recipe]})
        assert resp.status_code == 200

        insert_call = chain.insert.call_args
        row = insert_call[0][0]
        for clean_recipe in row["recipe_json"]:
            assert "tags" not in clean_recipe

    def test_share_recipe_json_is_array(self, client, mock_verify_jwt):
        """recipe_json stored in DB is always a JSON array (even for one recipe)."""
        mock_client, chain, _ = _build_share_mock()
        with _share_patch(mock_client):
            client.post(
                "/api/share",
                json={"recipes": [{"id": "r1", "title": "Tacos"}]},
            )
        insert_call = chain.insert.call_args
        row = insert_call[0][0]
        assert isinstance(row["recipe_json"], list)

    def test_share_empty_list_returns_400(self, client, mock_verify_jwt):
        """Empty recipes list is rejected with 400."""
        mock_client, _, _ = _build_share_mock()
        with _share_patch(mock_client):
            resp = client.post("/api/share", json={"recipes": []})
        assert resp.status_code == 400

    def test_share_unauthenticated_returns_401(self, client):
        """Request without auth header returns 401/403."""
        resp = client.post("/api/share", json={"recipes": [{"id": "r1"}]})
        assert resp.status_code in (401, 403)

    def test_share_supabase_error_returns_500(self, client, mock_verify_jwt):
        """Supabase failure returns 500."""
        mock_client = MagicMock()
        chain = MagicMock()
        chain.insert.return_value = chain
        chain.execute.side_effect = RuntimeError("DB down")
        mock_client.table.return_value = chain

        with _share_patch(mock_client):
            resp = client.post(
                "/api/share",
                json={"recipes": [{"id": "r1", "title": "Test"}]},
            )
        assert resp.status_code == 500

    def test_share_id_is_url_safe(self, client, mock_verify_jwt):
        """Generated share IDs contain only URL-safe characters."""
        import re
        mock_client, _, _ = _build_share_mock()
        with _share_patch(mock_client):
            resp = client.post(
                "/api/share",
                json={"recipes": [{"id": "r1", "title": "Test"}]},
            )
        assert resp.status_code == 200
        url = resp.json()["url"]
        share_id = url.split("/s/")[-1]
        # secrets.token_urlsafe produces only A-Z a-z 0-9 - _
        assert re.fullmatch(r"[A-Za-z0-9\-_]+", share_id), f"Non-URL-safe ID: {share_id!r}"


# ---------------------------------------------------------------------------
# GET /s/{id}
# ---------------------------------------------------------------------------

class TestShareGetView:

    def _valid_row(self, title="Pancakes"):
        """recipe_json is stored as a JSON array of recipe dicts."""
        return [{
            "recipe_json": [{
                "id": "r1",
                "title": title,
                "description": "Fluffy pancakes.",
                "ingredients": [{"rawText": "1 cup flour", "item": "flour"}],
                "instructions": [{"stepNumber": 1, "text": "Mix everything."}],
            }],
            "expires_at": _future_expiry(),
        }]

    def _valid_multi_row(self, titles=("Pancakes", "Waffles")):
        """A row with multiple recipes — rendered as a mini-pantry grid."""
        return [{
            "recipe_json": [
                {"id": f"r{i}", "title": t, "ingredients": [], "instructions": []}
                for i, t in enumerate(titles)
            ],
            "expires_at": _future_expiry(),
        }]

    def test_valid_id_returns_html(self, client):
        """A valid, non-expired share ID returns 200 HTML with the recipe title."""
        mock_client, _, mock_result = _build_share_mock()
        mock_result.data = self._valid_row("Pancakes")
        with _share_patch(mock_client):
            resp = client.get("/s/abc12345")
        assert resp.status_code == 200
        assert "text/html" in resp.headers["content-type"]
        assert "Pancakes" in resp.text

    def test_valid_id_embeds_recipe_json(self, client):
        """The HTML page embeds the recipe JSON in a <script> tag for extension import."""
        mock_client, _, mock_result = _build_share_mock()
        mock_result.data = self._valid_row("Waffles")
        with _share_patch(mock_client):
            resp = client.get("/s/abc12345")
        assert resp.status_code == 200
        assert 'id="recipe-data"' in resp.text
        assert "Waffles" in resp.text

    def test_valid_id_contains_save_button(self, client):
        """The HTML page includes the 'Save to MyPantry' button."""
        mock_client, _, mock_result = _build_share_mock()
        mock_result.data = self._valid_row()
        with _share_patch(mock_client):
            resp = client.get("/s/abc12345")
        assert resp.status_code == 200
        assert "save-btn" in resp.text
        assert "Save to MyPantry" in resp.text

    def test_multi_recipe_returns_mini_pantry(self, client):
        """Multiple recipes in one share link render as a grid, not a single card."""
        mock_client, _, mock_result = _build_share_mock()
        mock_result.data = self._valid_multi_row(("Pancakes", "Waffles"))
        with _share_patch(mock_client):
            resp = client.get("/s/abc12345")
        assert resp.status_code == 200
        assert "Pancakes" in resp.text
        assert "Waffles" in resp.text
        # Mini-pantry grid uses recipe-card elements and a Save All button
        assert "recipe-card" in resp.text
        assert "save-all-btn" in resp.text

    def test_unknown_id_returns_404(self, client):
        """A share ID that doesn't exist returns 404 HTML."""
        mock_client, _, mock_result = _build_share_mock()
        mock_result.data = []  # no rows found
        with _share_patch(mock_client):
            resp = client.get("/s/doesnotexist")
        assert resp.status_code == 404
        assert "text/html" in resp.headers["content-type"]

    def test_expired_id_returns_404(self, client):
        """
        The endpoint filters by expires_at > now() via .gt(); when the DB
        returns no rows (as it would for expired records), a 404 is served.
        """
        mock_client, _, mock_result = _build_share_mock()
        mock_result.data = []  # DB filtered out the expired row
        with _share_patch(mock_client):
            resp = client.get("/s/expiredid")
        assert resp.status_code == 404

    def test_expired_filter_is_applied(self, client):
        """Confirm .gt('expires_at', ...) is called on every GET /s/{id} request."""
        mock_client, chain, mock_result = _build_share_mock()
        mock_result.data = []
        with _share_patch(mock_client):
            client.get("/s/somerecipe")
        chain.gt.assert_called()
        call_args = chain.gt.call_args[0]
        assert call_args[0] == "expires_at"

    def test_supabase_error_returns_500(self, client):
        """A Supabase failure on GET returns 500."""
        mock_client = MagicMock()
        chain = MagicMock()
        chain.select.return_value = chain
        chain.eq.return_value = chain
        chain.gt.return_value = chain
        chain.limit.return_value = chain
        chain.execute.side_effect = RuntimeError("DB down")
        mock_client.table.return_value = chain

        with _share_patch(mock_client):
            resp = client.get("/s/errorcase")
        assert resp.status_code == 500
