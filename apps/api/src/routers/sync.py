"""
/api/sync — Cloud recipe sync endpoints.

All endpoints are authenticated via verify_jwt (ES256 Supabase JWT).
The backend uses the service-role Supabase client to act on behalf of the
verified user_id, filtering every query by user_id explicitly.

Cloud sync is JSON-only backup/restore. Embeddings are computed client-side
and stored exclusively in IndexedDB — they are never sent to or returned from
the cloud, since Supabase is not used for vector search.

Endpoint summary:
  POST   /api/sync/save          — Upsert a recipe's JSON to the cloud.
  GET    /api/sync/latest        — Return just the newest updated_at timestamp.
  GET    /api/sync/list          — Return all (or delta) recipe JSON blobs.
  DELETE /api/sync/delete/{id}   — Delete a recipe by id for the user.
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator
from typing import Any
from datetime import datetime, timezone
import json
from loguru import logger
import traceback

from src.dependencies.auth import verify_jwt
from src.services.supabase_client import get_supabase_client

router = APIRouter(prefix="/sync", tags=["sync"])

TABLE = "recipes"

# Max serialised size of a single recipe payload (512 KB)
_MAX_RECIPE_BYTES = 512 * 1024
# Max number of recipes in a single batch import
_MAX_IMPORT_COUNT = 100
# Max total size of a batch import payload (5 MB)
_MAX_BATCH_BYTES = 5 * 1024 * 1024


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class SaveRecipeRequest(BaseModel):
    # The full Recipe object from the client (embedding field must be excluded
    # by the caller — it is not stored in the cloud).
    recipe: dict[str, Any]

    @field_validator("recipe")
    @classmethod
    def validate_recipe(cls, v: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(v.get("id"), str) or not v["id"]:
            raise ValueError("Recipe must have a non-empty string `id`")
        if len(json.dumps(v)) > _MAX_RECIPE_BYTES:
            raise ValueError(f"Recipe payload exceeds {_MAX_RECIPE_BYTES // 1024} KB limit")
        return v


class ImportRecipesRequest(BaseModel):
    # List of Recipe objects from the client (embedding field must be excluded
    # by the caller).
    recipes: list[dict[str, Any]]

    @field_validator("recipes")
    @classmethod
    def validate_recipes(cls, v: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if len(v) > _MAX_IMPORT_COUNT:
            raise ValueError(f"Batch import cannot exceed {_MAX_IMPORT_COUNT} recipes")
        total_bytes = len(json.dumps(v))
        if total_bytes > _MAX_BATCH_BYTES:
            raise ValueError(f"Total batch payload exceeds {_MAX_BATCH_BYTES // (1024 * 1024)} MB limit")
        return v


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/save")
def save_recipe(request: SaveRecipeRequest, user_id: str = Depends(verify_jwt)):
    """
    Upsert a recipe JSON blob for the authenticated user.
    The embedding is intentionally excluded — the cloud is a pure backup store.
    """
    recipe = request.recipe
    recipe_id = recipe["id"]  # validated non-empty by SaveRecipeRequest
    recipe_json = {k: v for k, v in recipe.items() if k != "embedding"}

    row = {
        "id": recipe_id,
        "user_id": user_id,
        "recipe_json": recipe_json,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        client = get_supabase_client()
        client.table(TABLE).upsert(row, on_conflict="id").execute()
        logger.info(f"[Sync] Upserted recipe '{recipe_id}' for user {user_id}")
        return {"success": True, "id": recipe_id}
    except Exception as e:
        logger.error(f"[Sync] Save failed: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Failed to save recipe.")


@router.post("/import")
def import_recipes(request: ImportRecipesRequest, user_id: str = Depends(verify_jwt)):
    """
    Batch upsert recipe JSON blobs for the authenticated user.
    """
    if not request.recipes:
        return {"success": True, "count": 0}

    rows = []
    skipped = 0
    for recipe in request.recipes:
        recipe_id = recipe.get("id")
        if not recipe_id:
            skipped += 1
            continue

        recipe_json = {k: v for k, v in recipe.items() if k != "embedding"}
        rows.append({
            "id": recipe_id,
            "user_id": user_id,
            "recipe_json": recipe_json,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    if not rows:
        return {"success": True, "count": 0, "skipped": skipped}

    try:
        client = get_supabase_client()
        # upsert takes a list of dicts for bulk operations
        client.table(TABLE).upsert(rows, on_conflict="id").execute()
        if skipped:
            logger.warning(f"[Sync] Skipped {skipped} recipe(s) missing `id` for user {user_id}")
        logger.info(f"[Sync] Bulk upserted {len(rows)} recipes for user {user_id}")
        return {"success": True, "count": len(rows), "skipped": skipped}
    except Exception as e:
        logger.error(f"[Sync] Import failed: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Failed to import recipes.")


@router.get("/latest")
def get_latest_timestamp(user_id: str = Depends(verify_jwt)):
    """
    Returns the most recent `updated_at` timestamp for the user.
    Used by the pantry dashboard on open for a cheap staleness check —
    only one row is fetched via the (user_id, updated_at desc) index.
    """
    try:
        client = get_supabase_client()
        result = (
            client.table(TABLE)
            .select("updated_at")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        latest = rows[0]["updated_at"] if rows else None
        return {"latest_updated_at": latest}
    except Exception as e:
        logger.error(f"[Sync] Latest timestamp query failed: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Failed to get latest timestamp.")


@router.get("/list")
def list_recipes(user_id: str = Depends(verify_jwt), since: str | None = None):
    if since is not None:
        try:
            datetime.fromisoformat(since)
        except ValueError:
            raise HTTPException(status_code=422, detail="'since' must be a valid ISO-8601 datetime string.")
    """
    Return recipe JSON blobs for the authenticated user, ordered newest-first.

    Streams the response using DB chunking to prevent Out-Of-Memory (OOM) 
    errors when parsing thousands of massive recipes on 256MB VMs, while 
    preserving the exact `{"recipes": [...]}` output payload syntax 
    expected by the Chrome extension.
    """
    def recipe_generator():
        yield b'{"recipes": ['
        
        chunk_size = 50
        offset = 0
        first_item = True
        
        try:
            client = get_supabase_client()
            while True:
                query = (
                    client.table(TABLE)
                    .select("id, recipe_json, updated_at")
                    .eq("user_id", user_id)
                    .order("updated_at", desc=True)
                )
                if since:
                    query = query.gt("updated_at", since)
                    
                result = query.range(offset, offset + chunk_size - 1).execute()
                recipes = result.data or []
                
                for r in recipes:
                    if not first_item:
                        yield b','
                    yield json.dumps(r).encode('utf-8')
                    first_item = False
                
                if len(recipes) < chunk_size:
                    break
                
                offset += chunk_size
                
        except Exception:
            logger.error(f"[Sync] List stream generator failed at offset {offset}: {traceback.format_exc()}")
            # Yield a well-formed error sentinel so the client receives valid JSON
            # and can distinguish a truncation error from an empty result set.
            if not first_item:
                yield b','
            yield json.dumps({"__error": "stream_failed"}).encode("utf-8")

        yield b']}'

    logger.info(f"[Sync] Streaming recipes for user {user_id} (since={since or 'all'})")
    return StreamingResponse(recipe_generator(), media_type="application/json")


@router.delete("/delete/{recipe_id}")
def delete_recipe(recipe_id: str, user_id: str = Depends(verify_jwt)):
    """
    Delete a recipe by id, scoped to the authenticated user.
    Filters by both id and user_id to prevent cross-user deletion.
    """
    try:
        client = get_supabase_client()
        client.table(TABLE).delete().eq("id", recipe_id).eq("user_id", user_id).execute()
        logger.info(f"[Sync] Deleted recipe '{recipe_id}' for user {user_id}")
        return {"success": True, "id": recipe_id}
    except Exception as e:
        logger.error(f"[Sync] Delete failed: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Failed to delete recipe.")
