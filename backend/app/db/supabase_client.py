"""Supabase clients.

* service_client(): uses the service_role key. It bypasses RLS and is used for
  ALL database reads/writes in the service layer. Never expose it to the browser.
* new_anon_client(): a fresh client with the anon key, used only to sign users in
  with their password. A new instance per call, so one user's session can never
  leak into another request.

Both share one HTTP/1.1 connection pool. (With HTTP/2, Supabase's gateway closes
long-lived connections with GOAWAY and the next request on it fails; HTTP/1.1
connections are checked before reuse, and connect errors are retried.)
"""

from functools import lru_cache

import httpx
from supabase import Client, ClientOptions, create_client

from app.core.config import get_settings


@lru_cache
def _http() -> httpx.Client:
    return httpx.Client(
        http2=False,
        transport=httpx.HTTPTransport(retries=2),
        timeout=httpx.Timeout(20.0, connect=10.0),
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10, keepalive_expiry=30),
    )


def _options() -> ClientOptions:
    return ClientOptions(auto_refresh_token=False, persist_session=False, httpx_client=_http())


@lru_cache
def service_client() -> Client:
    s = get_settings()
    return create_client(s.SUPABASE_URL, s.SUPABASE_SERVICE_ROLE_KEY.get_secret_value(), options=_options())


def new_anon_client() -> Client:
    s = get_settings()
    return create_client(s.SUPABASE_URL, s.SUPABASE_ANON_KEY, options=_options())
