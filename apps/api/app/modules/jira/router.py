"""Jira integration API routes."""

import hashlib
import hmac
import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.modules.jira.models import (
    JiraBoardResponse,
    JiraIntegrationCreate,
    JiraIntegrationResponse,
    JiraIntegrationUpdate,
    JiraIntegrationWithCredentials,
    JiraIssueResponse,
    JiraSprintResponse,
    JiraSyncRunResponse,
    JiraSyncStatus,
    JiraSyncTrigger,
    TriggerJiraSyncRequest,
    WebhookPayload,
)
from app.modules.jira.service import (
    JiraCredentialService,
    JiraSyncService,
    JiraWebhookService,
    CredentialsNotFoundError,
    SyncLockError,
    WebhookSignatureError,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jira", tags=["jira"])

# Dependency injection


def get_credential_service(supabase_client=Depends(lambda: None)):
    """Get Jira credential service."""
    # In real implementation, this would inject the actual supabase client
    # For now, return the service class
    return JiraCredentialService


def get_sync_service(supabase_client=Depends(lambda: None)):
    """Get Jira sync service."""
    return JiraSyncService


def get_webhook_service(supabase_client=Depends(lambda: None)):
    """Get Jira webhook service."""
    return JiraWebhookService


# Feature flag check
from app.modules.jira.features import is_jira_v2_enabled, require_jira_v2


async def check_feature_flag():
    """Check if Jira v2 feature flag is enabled."""
    if not is_jira_v2_enabled():
        from fastapi import HTTPException, status
        raise HTTPException(
            status_code=503,
            detail="Jira integration v2 is not enabled. Set JIRA_INTEGRATION_V2=true to enable.",
        )


# Credential endpoints


@router.post(
    "/integrations",
    response_model=JiraIntegrationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new Jira integration",
)
async def create_integration(
    data: JiraIntegrationCreate,
    tenant_id: UUID = Depends(lambda: UUID("00000000-0000-0000-0000-000000000000")),  # Placeholder
    user_id: UUID = Depends(lambda: UUID("00000000-0000-0000-0000-000000000000")),  # Placeholder
    feature_enabled: bool = Depends(check_feature_flag),
):
    """Create a new Jira integration with encrypted credentials."""
    if not feature_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Jira integration v2 is not enabled",
        )

    service = JiraCredentialService(None)  # Would inject real supabase client
    try:
        result = await service.create_integration(tenant_id, UUID("00000000-0000-0000-0000-000000000000"), data)
        if not result:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create integration",
            )
        return result
    except Exception as e:
        logger.error(f"Failed to create integration: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create integration",
        )


@router.get(
    "/integrations",
    response_model=List[JiraIntegrationResponse],
    summary="List all Jira integrations for the tenant",
)
async def list_integrations(
    tenant_id: UUID = Depends(lambda: UUID("00000000-0000-0000-0000-000000000000")),
    feature_enabled: bool = Depends(check_feature_flag),
):
    """List all Jira integrations for the current tenant."""
    if not feature_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Jira integration v2 is not enabled",
        )

    service = JiraCredentialService(None)
    try:
        return await service.list_integrations(UUID("00000000-0000-0000-0000-000000000000"))
    except Exception as e:
        logger.error(f"Failed to list integrations: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list integrations",
        )


@router.get(
    "/integrations/{integration_id}",
    response_model=JiraIntegrationResponse,
    summary="Get a Jira integration by ID",
)
async def get_integration(
    integration_id: UUID,
    tenant_id: UUID = Depends(lambda: UUID("00000000-0000-0000-0000-000000000000")),
    feature_enabled: bool = Depends(check_feature_flag),
):
    """Get a Jira integration by ID (without credentials)."""
    if not feature_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Jira integration v2 is not enabled",
        )

    service = JiraCredentialService(None)
    try:
        result = await service.get_integration(
            UUID("00000000-0000-0000-0000-000000000000"), integration_id
        )
        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Integration not found",
            )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get integration: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get integration",
        )


@router.get(
    "/integrations/{integration_id}/credentials",
    response_model=JiraIntegrationWithCredentials,
    summary="Get a Jira integration with decrypted credentials (admin only)",
)
async def get_integration_with_credentials(
    integration_id: UUID,
    tenant_id: UUID = Depends(lambda: UUID("00000000-0000-0000-0000-000000000000")),
    feature_enabled: bool = Depends(check_feature_flag),
):
    """Get a Jira integration with decrypted credentials (admin only)."""
    if not feature_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Jira integration v2 is not enabled",
        )

    service = JiraCredentialService(None)
    try:
        result = await service.get_integration_with_credentials(
            UUID("00000000-0000-0000-0000-000000000000"), integration_id
        )
        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Integration not found or access denied",
            )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get integration credentials: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get integration credentials",
        )


@router.patch(
    "/integrations/{integration_id}",
    response_model=JiraIntegrationResponse,
    summary="Update a Jira integration",
)
async def update_integration(
    integration_id: UUID,
    data: JiraIntegrationUpdate,
    tenant_id: UUID = Depends(lambda: UUID("00000000-0000-0000-0000-000000000000")),
    feature_enabled: bool = Depends(check_feature_flag),
):
    """Update a Jira integration (re-encrypting credentials if provided)."""
    if not feature_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Jira integration v2 is not enabled",
        )

    service = JiraCredentialService(None)
    try:
        result = await service.update_integration(
            UUID("00000000-0000-0000-0000-000000000000"), integration_id, data
        )
        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Integration not found",
            )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update integration: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update integration",
        )


@router.delete(
    "/integrations/{integration_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a Jira integration",
)
async def delete_integration(
    integration_id: UUID,
    tenant_id: UUID = Depends(lambda: UUID("00000000-0000-0000-0000-000000000000")),
    feature_enabled: bool = Depends(check_feature_flag),
):
    """Delete a Jira integration and all related data."""
    if not feature_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Jira integration v2 is not enabled",
        )

    service = JiraCredentialService(None)
    try:
        deleted = await service.delete_integration(
            UUID("00000000-0000-0000-0000-000000000000"), integration_id
        )
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Integration not found",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete integration: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete integration",
        )


# Sync endpoints


@router.post(
    "/integrations/{integration_id}/sync",
    response_model=dict,
    summary="Trigger a Jira sync (full or incremental)",
)
async def trigger_sync(
    integration_id: UUID,
    request: TriggerJiraSyncRequest,
    tenant_id: UUID = Depends(lambda: UUID("00000000-0000-0000-0000-000000000000")),
    user_id: UUID = Depends(lambda: UUID("00000000-0000-0000-0000-000000000000")),
    feature_enabled: bool = Depends(check_feature_flag),
):
    """Trigger a Jira sync (full or incremental) with advisory locking."""
    if not feature_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Jira integration v2 is not enabled",
        )

    sync_service = JiraSyncService(None)
    try:
        if request.mode == "full":
            result = await sync_service.run_full_sync(
                UUID("00000000-0000-0000-0000-000000000000"),
                integration_id,
                UUID("00000000-0000-0000-0000-000000000000"),
            )
        else:
            result = await sync_service.run_incremental_sync(
                UUID("00000000-0000-0000-0000-000000000000"),
                integration_id,
                UUID("00000000-0000-0000-0000-000000000000"),
                request.board_ids,
            )
        return result
    except SyncLockError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        )
    except CredentialsNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integration credentials not found or inaccessible",
        )
    except Exception as e:
        logger.error(f"Sync failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Sync failed",
        )


@router.get(
    "/integrations/{integration_id}/sync-runs",
    response_model=List[JiraSyncRunResponse],
    summary="List sync runs for an integration",
)
async def list_sync_runs(
    integration_id: UUID,
    limit: int = 20,
    offset: int = 0,
    tenant_id: UUID = Depends(lambda: UUID("00000000-0000-0000-0000-000000000000")),
    feature_enabled: bool = Depends(check_feature_flag),
):
    """List sync runs for an integration."""
    # This would query the jira_sync_runs table
    # Placeholder implementation
    return []


# Data endpoints


@router.get(
    "/integrations/{integration_id}/boards",
    response_model=List[JiraBoardResponse],
    summary="List Jira boards for an integration",
)
async def list_boards(
    integration_id: UUID,
    tenant_id: UUID = Depends(lambda: UUID("00000000-0000-0000-0000-000000000000")),
    feature_enabled: bool = Depends(check_feature_flag),
):
    """List Jira boards for an integration."""
    # Placeholder - would query jira_boards table
    return []


@router.get(
    "/integrations/{integration_id}/sprints",
    response_model=List[JiraSprintResponse],
    summary="List sprints for an integration",
)
async def list_sprints(
    integration_id: UUID,
    board_id: Optional[int] = None,
    state: Optional[str] = None,
    tenant_id: UUID = Depends(lambda: UUID("00000000-0000-0000-0000-000000000000")),
    feature_enabled: bool = Depends(check_feature_flag),
):
    """List sprints for an integration, optionally filtered by board and state."""
    # Placeholder - would query jira_sprints table
    return []


@router.get(
    "/integrations/{integration_id}/issues",
    response_model=List[JiraIssueResponse],
    summary="List issues for an integration",
)
async def list_issues(
    integration_id: UUID,
    sprint_id: Optional[int] = None,
    board_id: Optional[int] = None,
    assignee_email: Optional[str] = None,
    status: Optional[str] = None,
    resolved: Optional[bool] = None,
    limit: int = 50,
    offset: int = 0,
    tenant_id: UUID = Depends(lambda: UUID("00000000-0000-0000-0000-000000000000")),
    feature_enabled: bool = Depends(check_feature_flag),
):
    """List issues for an integration with optional filters."""
    # Placeholder - would query jira_issues table
    return []


# Webhook endpoint


@router.post(
    "/webhook",
    summary="Jira webhook endpoint",
)
async def jira_webhook(
    request: Request,
    x_hub_signature: str = Header(..., alias="X-Hub-Signature"),
    x_hub_signature_256: Optional[str] = Header(None, alias="X-Hub-Signature-256"),
    feature_enabled: bool = Depends(check_feature_flag),
):
    """
    Jira webhook endpoint for real-time sync.

    Receives Jira events (issue updates, sprint changes, board changes)
    and processes them in real-time.
    """
    if not feature_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Jira integration v2 is not enabled",
        )

    # Get raw body for signature verification
    body = await request.body()

    # Get signature headers
    signature = x_hub_signature
    signature_256 = x_hub_signature_256

    # Parse payload
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON payload",
        )

    # Extract tenant and integration from payload or headers
    # In production, this would come from the webhook configuration
    # For now, we'll use a header or payload field
    tenant_id = request.headers.get("X-Tenant-ID")
    integration_id = request.headers.get("X-Integration-ID")

    if not tenant_id or not integration_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing tenant or integration identifier",
        )

    webhook_service = JiraWebhookService(None)
    try:
        result = await webhook_service.process_webhook(
            tenant_id=UUID(tenant_id),
            integration_id=UUID(integration_id),
            payload=payload,
            signature=x_hub_signature_256 or x_hub_signature,
        )
        return result
    except WebhookSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook signature",
        )
    except Exception as e:
        logger.error(f"Webhook processing failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Webhook processing failed",
        )


# Health check
@router.get("/health", tags=["system"])
def jira_health():
    """Jira module health check."""
    return {
        "status": "ok",
        "module": "jira",
        "feature_flag": FEATURE_FLAG,
    }