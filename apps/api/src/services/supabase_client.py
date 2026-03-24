from functools import lru_cache
from supabase import create_client, Client, ClientOptions
from src.config import settings
from loguru import logger


@lru_cache(maxsize=1)
def get_supabase_client() -> Client:
    """
    Returns a cached Supabase client authenticated with the service-role key.

    We deliberately use the service-role key (not the anon key) so the backend
    can bypass Row Level Security and write on behalf of any user_id it extracts
    from the already-verified JWT.  User ownership is enforced by passing
    user_id into every query — NOT by relying on RLS auth.uid() here.
    """
    # Defense-in-depth: Settings already validates this at startup, but guard
    # here too so tests that mock settings directly get a clear error message.
    if not settings.supabase_service_role_key:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY is not set. "
            "Add it to apps/api/.env to enable cloud sync."
        )

    client: Client = create_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
        options=ClientOptions(
            postgrest_client_timeout=settings.supabase_request_timeout,
            storage_client_timeout=settings.supabase_request_timeout,
        ),
    )
    logger.info(
        f"Supabase client initialised (service-role, timeout={settings.supabase_request_timeout}s)."
    )
    return client
