"""Jira integration service with sync pipeline, encryption, and webhooks."""

import asyncio
import hashlib
import hmac
import json
import logging
from datetime import datetime, timedelta
from typing import Any, Optional
from uuid import UUID, uuid4

import httpx
from postgrest import APIError

from app.core.config import get_settings
from app.modules.jira.encryption import get_encryption_key
from app.modules.jira.models import (
    JiraIntegrationCreate,
    JiraIntegrationResponse,
    JiraIntegrationWithCredentials,
    JiraIntegrationUpdate,
    JiraIssueResponse,
    JiraSprintResponse,
    JiraBoardResponse,
    JiraSprintState,
    JiraSyncStatus,
    JiraSyncTrigger,
    TriggerJiraSyncRequest,
    WebhookPayload,
)

logger = logging.getLogger(__name__)


class JiraIntegrationError(Exception):
    """Base exception for Jira integration errors."""
    pass


class CredentialsNotFoundError(JiraIntegrationError):
    """Raised when credentials are not found or cannot be decrypted."""
    pass


class SyncLockError(JiraIntegrationError):
    """Raised when sync advisory lock cannot be acquired."""
    pass


class WebhookSignatureError(JiraIntegrationError):
    """Raised when webhook signature verification fails."""
    pass


class JiraSyncService:
    """
    Jira integration sync service with advisory locking and idempotency.
    """

    def __init__(self, supabase_client):
        self.supabase = supabase_client
        self.settings = get_settings()
        self.jira_base_url: Optional[str] = None
        self._jira_client: Optional[httpx.AsyncClient] = None

    async def _get_jira_client(self, integration: dict) -> httpx.AsyncClient:
        """Get or create Jira API client for an integration."""
        if self._jira_client is None:
            self._jira_client = httpx.AsyncClient(
                base_url=f"https://{integration['jira_domain']}",
                auth=(integration["jira_email"], integration["jira_api_token"]),
                timeout=30.0,
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
            )
        return self._jira_client

    async def _get_decrypted_integration(self, integration_id: UUID, tenant_id: UUID) -> dict:
        """Get integration with decrypted credentials via RPC."""
        # Call the database RPC to decrypt credentials
        result = self.supabase.rpc(
            "get_decrypted_jira_integration",
            {"p_integration_id": str(integration_id), "p_tenant_id": str(tenant_id)}
        ).execute()

        if not result.data:
            raise CredentialsNotFoundError(f"Integration {integration_id} not found or access denied")

        return result.data

    async def _acquire_sync_lock(self, tenant_id: UUID, integration_id: UUID, logical_date: str) -> bool:
        """Acquire advisory lock for sync to prevent concurrent runs."""
        lock_key = hashlib.md5(
            f"{tenant_id}:{integration_id}:{logical_date}".encode()
        ).hexdigest()[:16]

        lock_int = int(lock_key, 16) % (2**31)

        result = self.supabase.rpc(
            "pg_try_advisory_xact_lock",
            {"lock_key": lock_int}
        ).execute()

        if not result.data or result.data is not True:
            raise SyncLockError(
                f"Another sync is already running for integration {integration_id} on {logical_date}"
            )
        return True

    async def _create_sync_run(
        self,
        tenant_id: UUID,
        integration_id: UUID,
        trigger_type: str,
        user_id: str
    ) -> UUID:
        """Create a new sync run record."""
        run_id = uuid4()
        self.supabase.table("jira_sync_runs").insert({
            "id": str(run_id),
            "tenant_id": str(tenant_id),
            "jira_integration_id": str(integration_id),
            "trigger_type": "manual",
            "started_at": datetime.utcnow().isoformat(),
            "status": "running",
        }).execute()
        return run_id

    async def _update_sync_run(
        self,
        run_id: UUID,
        status: str,
        issues_fetched: Optional[int] = None,
        error_message: Optional[str] = None
    ):
        """Update sync run record."""
        update_data = {
            "status": status,
            "finished_at": datetime.utcnow().isoformat() if status in ("success", "failed") else None,
        }
        if issues_fetched is not None:
            update_data["issues_fetched"] = issues_fetched
        if error_message is not None:
            update_data["error_message"] = error_message[:1000]  # Truncate long errors

        self.supabase.table("jira_sync_runs").update(update_data).eq("id", str(run_id)).execute()

    async def sync_boards(self, client: httpx.AsyncClient, integration_id: UUID, tenant_id: UUID) -> int:
        """Sync Jira boards for an integration."""
        # Get all boards from Jira
        response = await client.get("/rest/api/3/board", params={"maxResults": 100})
        response.raise_for_status()
        boards_data = response.json().get("values", [])

        synced = 0
        for board in boards_data:
            self.supabase.table("jira_boards").upsert({
                "jira_id": board["id"],
                "tenant_id": str(tenant_id),
                "jira_integration_id": str(integration_id),
                "name": board["name"],
                "type": board.get("type"),
                "location_project_key": board.get("location", {}).get("projectKey"),
                "last_synced_at": datetime.utcnow().isoformat(),
            }, on_conflict="jira_id,tenant_id").execute()
            synced += 1
        return synced

    async def sync_sprints(self, client: httpx.AsyncClient, integration_id: UUID, tenant_id: UUID) -> int:
        """Sync sprints for all boards in an integration."""
        # Get boards for this integration
        boards_result = self.supabase.table("jira_boards").select("jira_id").eq(
            "jira_integration_id", str(integration_id)
        ).eq("tenant_id", str(tenant_id)).execute()

        board_ids = [b["jira_id"] for b in boards_result.data]
        if not board_ids:
            return 0

        synced = 0
        for board_id in board_ids:
            response = await client.get(
                f"/rest/api/3/board/{board_id}/sprint",
                params={"maxResults": 100, "state": "active,closed,future"}
            )
            response.raise_for_status()
            sprints_data = response.json().get("values", [])

            for sprint in sprints_data:
                state = sprint.get("state", "future")
                if state not in ("active", "closed", "future"):
                    state = "future"

                self.supabase.table("jira_sprints").upsert({
                    "jira_id": sprint["id"],
                    "jira_board_id": board_id,
                    "tenant_id": str(tenant_id),
                    "name": sprint["name"],
                    "state": state,
                    "start_date": sprint.get("startDate"),
                    "end_date": sprint.get("endDate"),
                    "complete_date": sprint.get("completeDate"),
                    "goal": sprint.get("goal"),
                    "last_synced_at": datetime.utcnow().isoformat(),
                }, on_conflict="jira_id,tenant_id").execute()
                synced += 1
        return synced

    async def sync_issues(self, client: httpx.AsyncClient, integration_id: UUID, tenant_id: UUID,
                          board_ids: Optional[list[int]] = None, incremental: bool = True) -> int:
        """Sync issues for boards, with optional incremental sync."""
        # Get sprints to sync
        sprints_query = self.supabase.table("jira_sprints").select("jira_id").eq("tenant_id", str(tenant_id))
        if board_ids:
            sprints_query = sprints_query.in_("jira_board_id", board_ids)

        sprints_result = sprints_query.execute()
        sprint_ids = [s["jira_id"] for s in sprints_result.data]

        if not sprint_ids:
            return 0

        synced = 0
        for sprint_id in sprint_ids:
            # Build JQL for issues in this sprint
            jql = f"sprint = {sprint_id}"
            if incremental:
                # For incremental, only fetch issues updated since last sync
                # This would need last_synced_at from jira_integrations
                pass

            response = await client.get(
                "/rest/api/3/search/jql",
                params={
                    "jql": jql,
                    "maxResults": 100,
                    "fields": "key,summary,status,issuetype,assignee,customfield_10016,created,resolutiondate,parent",
                    "expand": "changelog",
                }
            )
            response.raise_for_status()
            issues_data = response.json().get("issues", [])

            for issue in issues_data:
                fields = issue["fields"]
                assignee = fields.get("assignee")
                story_points = fields.get("customfield_10016")

                self.supabase.table("jira_issues").upsert({
                    "jira_key": issue["key"],
                    "jira_sprint_id": sprint_id,
                    "tenant_id": str(tenant_id),
                    "summary": fields["summary"],
                    "status": fields["status"]["name"],
                    "issuetype": fields["issuetype"]["name"],
                    "assignee_display_name": assignee.get("displayName") if assignee else None,
                    "assignee_email": assignee.get("emailAddress") if assignee else None,
                    "story_points": float(story_points) if story_points is not None else None,
                    "created_at": fields["created"],
                    "resolution_date": fields.get("resolutiondate"),
                    "resolved": fields.get("resolutiondate") is not None,
                    "parent_key": fields.get("parent", {}).get("key") if fields.get("parent") else None,
                    "raw_fields": fields,
                    "last_synced_at": datetime.utcnow().isoformat(),
                }, on_conflict="jira_key,tenant_id").execute()
                synced += 1

                # Sync changelog for status transitions
                changelog = fields.get("changelog", {}).get("histories", [])
                for history in changelog:
                    for item in history.get("items", []):
                        if item.get("field") == "status":
                            self.supabase.table("jira_changelog_entries").upsert({
                                "jira_issue_key": issue["key"],
                                "tenant_id": str(tenant_id),
                                "changed_at": history["created"],
                                "from_status": item.get("fromString"),
                                "to_status": item.get("toString"),
                                "jira_author_display_name": history.get("author", {}).get("displayName"),
                            }, on_conflict="tenant_id,jira_issue_key,changed_at,from_status,to_status").execute()

        return synced

    async def run_full_sync(
        self,
        tenant_id: UUID,
        integration_id: UUID,
        user_id: UUID
    ) -> dict:
        """Run a full Jira sync for an integration."""
        logical_date = datetime.utcnow().date().isoformat()

        # Acquire advisory lock
        await self._acquire_sync_lock(tenant_id, integration_id, logical_date)

        # Get decrypted integration
        integration = await self._get_decrypted_integration(integration_id, tenant_id)

        # Create sync run record
        run_id = await self._create_sync_run(tenant_id, integration_id, "manual", str(user_id))

        try:
            # Create Jira API client
            async with httpx.AsyncClient(
                base_url=f"https://{integration['jira_domain']}",
                auth=(integration["jira_email"], integration["jira_api_token"]),
                timeout=60.0,
                headers={"Accept": "application/json"},
            ) as client:
                # Full sync: boards, sprints, issues
                boards_count = await self.sync_boards(client, integration_id, tenant_id)
                sprints_count = await self.sync_sprints(client, integration_id, tenant_id)
                issues_count = await self.sync_issues(client, integration_id, tenant_id, incremental=False)

                # Update integration last_synced_at
                self.supabase.table("jira_integrations").update({
                    "last_synced_at": datetime.utcnow().isoformat(),
                    "sync_status": "success",
                }).eq("id", str(integration_id)).eq("tenant_id", str(tenant_id)).execute()

                # Update sync run
                await self._update_sync_run(
                    run_id, "success",
                    issues_fetched=issues_count
                )

                return {
                    "run_id": str(run_id),
                    "status": "success",
                    "boards_synced": boards_count,
                    "sprints_synced": sprints_count,
                    "issues_synced": issues_count,
                }

        except Exception as e:
            logger.error(f"Sync failed: {e}")
            await self._update_sync_run(run_id, "failed", error_message=str(e))

            self.supabase.table("jira_integrations").update({
                "sync_status": "failed",
            }).eq("id", str(integration_id)).eq("tenant_id", str(tenant_id)).execute()

            raise

    async def run_incremental_sync(
        self,
        tenant_id: UUID,
        integration_id: UUID,
        user_id: UUID,
        board_ids: Optional[list[int]] = None
    ) -> dict:
        """Run an incremental Jira sync."""
        logical_date = datetime.utcnow().date().isoformat()

        await self._acquire_sync_lock(tenant_id, integration_id, logical_date)

        integration = await self._get_decrypted_integration(integration_id, tenant_id)
        run_id = await self._create_sync_run(tenant_id, integration_id, "incremental", str(user_id))

        try:
            async with httpx.AsyncClient(
                base_url=f"https://{integration['jira_domain']}",
                auth=(integration["jira_email"], integration["jira_api_token"]),
                timeout=60.0,
                headers={"Accept": "application/json"},
            ) as client:
                issues_count = await self.sync_issues(
                    client, integration_id, tenant_id, board_ids, incremental=True
                )

                self.supabase.table("jira_integrations").update({
                    "last_synced_at": datetime.utcnow().isoformat(),
                    "sync_status": "success",
                }).eq("id", str(integration_id)).eq("tenant_id", str(tenant_id)).execute()

                await self._update_sync_run(
                    run_id, "success", issues_fetched=issues_count
                )

                return {
                    "run_id": str(run_id),
                    "status": "success",
                    "issues_synced": issues_count,
                }

        except Exception as e:
            logger.error(f"Incremental sync failed: {e}")
            await self._update_sync_run(run_id, "failed", error_message=str(e))
            self.supabase.table("jira_integrations").update({
                "sync_status": "failed",
            }).eq("id", str(integration_id)).eq("tenant_id", str(tenant_id)).execute()
            raise


class JiraCredentialService:
    """Service for managing Jira integration credentials."""

    def __init__(self, supabase_client):
        self.supabase = supabase_client

    async def create_integration(
        self,
        tenant_id: UUID,
        user_id: UUID,
        data: "JiraIntegrationCreate"
    ) -> dict:
        """Create a new Jira integration with encrypted credentials."""
        # Encrypt credentials using database RPC
        email_encrypted_result = self.supabase.rpc(
            "encrypt_jira_credential",
            {"p_plaintext": data.jira_email}
        ).execute()

        token_encrypted_result = self.supabase.rpc(
            "encrypt_jira_credential",
            {"p_plaintext": data.jira_api_token}
        ).execute()

        result = self.supabase.table("jira_integrations").insert({
            "tenant_id": str(tenant_id),
            "jira_domain": data.jira_domain,
            "jira_email_encrypted": email_encrypted_result.data,
            "jira_api_token_encrypted": token_encrypted_result.data,
            "default_board_id": data.default_board_id,
            "story_points_field": data.story_points_field,
            "created_by": str(user_id),
            "sync_status": "pending",
        }).execute()

        return result.data[0] if result.data else None

    async def get_integration(self, tenant_id: UUID, integration_id: UUID) -> Optional[dict]:
        """Get integration (without credentials)."""
        result = self.supabase.table("jira_integrations").select("*").eq(
            "id", str(integration_id)
        ).eq("tenant_id", str(tenant_id)).single().execute()
        return result.data

    async def get_integration_with_credentials(
        self,
        tenant_id: UUID,
        integration_id: UUID
    ) -> Optional[dict]:
        """Get integration with decrypted credentials (admin only)."""
        result = self.supabase.rpc(
            "get_decrypted_jira_integration",
            {"p_integration_id": str(integration_id), "p_tenant_id": str(tenant_id)}
        ).execute()
        return result.data if result.data else None

    async def list_integrations(self, tenant_id: UUID) -> list[dict]:
        """List all integrations for a tenant."""
        result = self.supabase.table("jira_integrations").select("*").eq(
            "tenant_id", str(tenant_id)
        ).order("created_at", desc=True).execute()
        return result.data or []

    async def update_integration(
        self,
        tenant_id: UUID,
        integration_id: UUID,
        data: "JiraIntegrationUpdate"
    ) -> Optional[dict]:
        """Update integration, re-encrypting credentials if provided."""
        update_data = {}

        if data.jira_domain is not None:
            update_data["jira_domain"] = data.jira_domain
        if data.story_points_field is not None:
            update_data["story_points_field"] = data.story_points_field
        if data.default_board_id is not None:
            update_data["default_board_id"] = data.default_board_id

        if data.jira_email is not None:
            email_encrypted = self.supabase.rpc(
                "encrypt_jira_credential",
                {"p_plaintext": data.jira_email}
            ).execute()
            update_data["jira_email_encrypted"] = email_encrypted.data

        if data.jira_api_token is not None:
            token_encrypted = self.supabase.rpc(
                "encrypt_jira_credential",
                {"p_plaintext": data.jira_api_token}
            ).execute()
            update_data["jira_api_token_encrypted"] = token_encrypted.data

        if not update_data:
            return None

        result = self.supabase.table("jira_integrations").update(update_data).eq(
            "id", str(integration_id)
        ).eq("tenant_id", str(tenant_id)).execute()

        return result.data[0] if result.data else None

    async def delete_integration(self, tenant_id: UUID, integration_id: UUID) -> bool:
        """Delete an integration and all related data."""
        result = self.supabase.table("jira_integrations").delete().eq(
            "id", str(integration_id)
        ).eq("tenant_id", str(tenant_id)).execute()
        return len(result.data) > 0


class JiraWebhookService:
    """Service for handling Jira webhooks."""

    def __init__(self, supabase_client):
        self.supabase = supabase_client

    def verify_signature(
        self,
        payload: bytes,
        signature: str,
        secret: str
    ) -> bool:
        """Verify Jira webhook signature."""
        # Jira uses HMAC-SHA256 for webhook signatures
        expected = hmac.new(
            secret.encode("utf-8"),
            payload,
            hashlib.sha256
        ).hexdigest()

        # Compare using constant-time comparison
        return hmac.compare_digest(expected, signature)

    async def process_webhook(
        self,
        tenant_id: UUID,
        integration_id: UUID,
        payload: dict,
        signature: str
    ) -> dict:
        """Process incoming Jira webhook."""
        # Get integration to verify signature
        integration = await self._get_decrypted_integration(integration_id, tenant_id)

        # Verify signature
        payload_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        secret = integration.get("webhook_secret", "")  # Would need to be stored
        if secret and not self.verify_signature(payload_bytes, signature, secret):
            raise WebhookSignatureError("Invalid webhook signature")

        # Process webhook event
        event = payload.get("webhookEvent", "")
        logger.info(f"Received Jira webhook: {event}")

        # Route to appropriate handler
        if event.startswith("jira:issue_"):
            await self._handle_issue_event(tenant_id, integration_id, payload)
        elif event.startswith("sprint_"):
            await self._handle_sprint_event(tenant_id, integration_id, payload)
        elif event.startswith("board_"):
            await self._handle_board_event(tenant_id, integration_id, payload)

        return {"status": "processed", "event": event}

    async def _handle_issue_event(self, tenant_id: UUID, integration_id: UUID, payload: dict):
        """Handle issue created/updated/deleted events."""
        issue = payload.get("issue", {})
        changelog = payload.get("changelog", {})

        # Extract issue data
        issue_key = issue.get("key")
        fields = issue.get("fields", {})

        # Upsert issue
        self.supabase.table("jira_issues").upsert({
            "jira_key": issue_key,
            "jira_sprint_id": fields.get("customfield_10020"),  # Sprint custom field
            "tenant_id": str(self.supabase.postgrest.session.auth.get("tenant_id", "")),
            "summary": fields.get("summary"),
            "status": fields.get("status", {}).get("name"),
            "issuetype": fields.get("issuetype", {}).get("name"),
            "assignee_display_name": fields.get("assignee", {}).get("displayName"),
            "assignee_email": fields.get("assignee", {}).get("emailAddress"),
            "story_points": fields.get("customfield_10016"),
            "created_at": fields.get("created"),
            "resolution_date": fields.get("resolutiondate"),
            "resolved": fields.get("resolutiondate") is not None,
            "parent_key": fields.get("parent", {}).get("key") if fields.get("parent") else None,
            "raw_fields": fields,
            "last_synced_at": datetime.utcnow().isoformat(),
        }, on_conflict="jira_key,tenant_id").execute()

        # Process changelog for status transitions
        for history in changelog.get("histories", []):
            for item in history.get("items", []):
                if item.get("field") == "status":
                    self.supabase.table("jira_changelog_entries").upsert({
                        "jira_issue_key": issue_key,
                        "tenant_id": str(tenant_id),
                        "changed_at": history["created"],
                        "from_status": item.get("fromString"),
                        "to_status": item.get("toString"),
                        "jira_author_display_name": history.get("author", {}).get("displayName"),
                    }, on_conflict="tenant_id,jira_issue_key,changed_at,from_status,to_status").execute()

    async def _handle_sprint_event(self, tenant_id: UUID, integration_id: UUID, payload: dict):
        """Handle sprint created/updated/deleted events."""
        sprint = payload.get("sprint", {})
        board_id = sprint.get("originBoardId")

        self.supabase.table("jira_sprints").upsert({
            "jira_id": sprint["id"],
            "jira_board_id": board_id,
            "tenant_id": str(self.supabase.postgrest.session.auth.get("tenant_id", "")),
            "name": sprint["name"],
            "state": sprint.get("state", "future"),
            "start_date": sprint.get("startDate"),
            "end_date": sprint.get("endDate"),
            "complete_date": sprint.get("completeDate"),
            "goal": sprint.get("goal"),
            "last_synced_at": datetime.utcnow().isoformat(),
        }, on_conflict="jira_id,tenant_id").execute()

    async def _handle_board_event(self, tenant_id: UUID, integration_id: UUID, payload: dict):
        """Handle board created/updated/deleted events."""
        board = payload.get("board", {})

        self.supabase.table("jira_boards").upsert({
            "jira_id": board["id"],
            "tenant_id": str(self.supabase.postgrest.session.auth.get("tenant_id", "")),
            "jira_integration_id": str(integration_id),
            "name": board["name"],
            "type": board.get("type"),
            "location_project_key": board.get("location", {}).get("projectKey"),
            "last_synced_at": datetime.utcnow().isoformat(),
        }, on_conflict="jira_id,tenant_id").execute()

    async def _get_decrypted_integration(self, integration_id: UUID, tenant_id: UUID) -> dict:
        """Get integration with decrypted credentials via RPC."""
        # This would call the database RPC
        # For now, return minimal data
        return {
            "jira_domain": "example.atlassian.net",
            "jira_email": "user@example.com",
            "jira_api_token": "token",
        }