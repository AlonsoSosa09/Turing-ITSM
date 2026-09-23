"""Feature flag utilities for Jira integration v2."""

from app.core.config import get_settings


def is_jira_v2_enabled() -> bool:
    """Check if Jira integration v2 is enabled."""
    settings = get_settings()
    return settings.jira_integration_v2


def require_jira_v2():
    """Dependency that raises 503 if Jira v2 is not enabled."""
    if not is_jira_v2_enabled():
        from fastapi import HTTPException, status
        raise HTTPException(
            status_code=503,
            detail="Jira integration v2 is not enabled. Set JIRA_INTEGRATION_V2=true to enable.",
        )


def get_jira_feature_flags() -> dict[str, bool]:
    """Get all Jira-related feature flags."""
    settings = get_settings()
    return {
        "jira_integration_v2": settings.jira_integration_v2,
    }