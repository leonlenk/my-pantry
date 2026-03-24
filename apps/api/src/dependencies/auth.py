from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from jwt import PyJWK
from src.config import settings
from loguru import logger
import json
import os
import time

# JWT_AUDIENCE is documented in .env as JWT_AUDIENCE (defaults to "authenticated").

security = HTTPBearer()

# Cache the public key with a 1-hour TTL so key rotations take effect without a restart.
_KEY_TTL = 3600
_key_cache: dict = {"key": None, "loaded_at": 0.0}


def get_supabase_public_key():
    """Loads and TTL-caches the public key used to verify Supabase JWTs."""
    now = time.monotonic()
    if _key_cache["key"] is not None and now - _key_cache["loaded_at"] < _KEY_TTL:
        return _key_cache["key"]

    possible_paths = [
        os.path.join(os.getcwd(), settings.supabase_pub_key_path),
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), settings.supabase_pub_key_path)
    ]

    key_path = None
    for path in possible_paths:
        if os.path.exists(path):
            key_path = path
            break

    if not key_path:
        logger.error(f"Supabase public key not found at any of: {possible_paths}")
        raise RuntimeError("Missing Supabase public key")

    logger.info(f"Loading Supabase public key from: {key_path}")
    with open(key_path, "r") as f:
        jwk_data = json.load(f)

    key = PyJWK(jwk_data).key
    _key_cache["key"] = key
    _key_cache["loaded_at"] = now
    return key


def _cache_clear():
    _key_cache["key"] = None
    _key_cache["loaded_at"] = 0.0


get_supabase_public_key.cache_clear = _cache_clear  # type: ignore[attr-defined]

def verify_jwt(credentials: HTTPAuthorizationCredentials = Security(security)) -> str:
    """Verifies the Supabase JWT using ES256 and returns the user ID."""
    token = credentials.credentials
    try:
        public_key = get_supabase_public_key()
        # Decode and verify the ES256 signature
        payload = jwt.decode(
            token,
            public_key,
            algorithms=["ES256"],
            audience=settings.jwt_audience,
        )
        return payload["sub"]
    except jwt.ExpiredSignatureError:
        logger.warning("Expired JWT token received")
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError as e:
        logger.warning(f"Invalid JWT token received: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")
