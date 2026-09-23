"""Jira integration models for API requests and responses."""

from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field, EmailStr, field_validator
import re


class JiraSyncTrigger(str, Enum):
    """Sync trigger types."""
    WEBHOOK = "webhook"
    SCHEDULED = "scheduled"
    MANUAL = "manual"


class JiraSyncStatus(str, Enum):
    """Sync execution status."""
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"


class JiraSprintState(str, Enum):
    """Jira sprint state."""
    ACTIVE = "active"
    CLOSED = "closed"
    FUTURE = "future"


# Request Models

class JiraIntegrationCreate(BaseModel):
    """Create a new Jira integration."""
    jira_domain: str = Field(..., min_length=4, max_length=253)
    jira_email: EmailStr
    jira_api_token: str = Field(..., min_length=8, max_length=512)
    default_board_id: Optional[int] = None
    story_points_field: str = Field(default="customfield_10016", min_length=1, max_length=80)

    @field_validator("jira_domain")
    @classmethod
    def validate_domain(cls, v: str) -> str:
        v = v.strip()
        if not re.match(r"^[a-zA-Z0-9][a-zA-Z0-9\-\.]*[a-zA-Z0-9]$", v):
            raise ValueError("Invalid domain format")
        return v

    @field_validator("story_points_field")
    @classmethod
    def validate_story_points_field(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Story points field cannot be empty")
        return v


class JiraIntegrationUpdate(BaseModel):
    """Update an existing Jira integration."""
    jira_domain: Optional[str] = Field(default=None, min_length=4, max_length=253)
    jira_email: Optional[EmailStr] = None
    jira_api_token: Optional[str] = Field(default=None, min_length=8, max_length=512)
    default_board_id: Optional[int] = None
    story_points_field: Optional[str] = Field(default=None, min_length=1, max_length=80)


class JiraIntegrationResponse(BaseModel):
    """Jira integration response (encrypted fields omitted)."""
    id: UUID
    tenant_id: UUID
    jira_domain: str
    default_board_id: Optional[int] = None
    story_points_field: str
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
    last_synced_at: Optional[datetime] = None
    sync_status: JiraSyncStatus


class JiraIntegrationWithCredentials(JiraIntegrationResponse):
    """Jira integration with decrypted credentials (admin only)."""
    jira_email: str
    jira_api_token: str


class JiraTeamMappingCreate(BaseModel):
    """Map a team to a Jira integration."""
    team_id: UUID
    jira_integration_id: UUID
    display_name: Optional[str] = Field(default=None, max_length=255)


class JiraTeamMappingResponse(BaseModel):
    """Jira team mapping response."""
    id: UUID
    tenant_id: UUID
    team_id: UUID
    jira_integration_id: UUID
    jira_domain: str
    display_name: Optional[str] = None
    created_at: datetime


class TriggerJiraSyncRequest(BaseModel):
    """Request to trigger a Jira sync."""
    integration_id: UUID
    mode: str = Field(default="incremental", pattern="^(full|incremental)$")
    board_ids: Optional[List[int]] = None


class JiraSyncRunResponse(BaseModel):
    """Sync run response."""
    id: UUID
    tenant_id: UUID
    jira_integration_id: UUID
    trigger_type: JiraSyncTrigger
    started_at: datetime
    finished_at: Optional[datetime] = None
    status: JiraSyncStatus
    issues_fetched: Optional[int] = None
    error_message: Optional[str] = None


class JiraBoardResponse(BaseModel):
    """Jira board response."""
    jira_id: int
    tenant_id: UUID
    jira_integration_id: UUID
    name: str
    type: Optional[str] = None
    location_project_key: Optional[str] = None
    last_synced_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class JiraSprintResponse(BaseModel):
    """Jira sprint response."""
    jira_id: int
    jira_board_id: int
    tenant_id: UUID
    name: str
    state: JiraSprintState
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    complete_date: Optional[datetime] = None
    goal: Optional[str] = None
    last_synced_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class JiraIssueResponse(BaseModel):
    """Jira issue response."""
    jira_key: str
    jira_sprint_id: int
    tenant_id: UUID
    summary: str
    status: str
    issuetype: str
    assignee_display_name: Optional[str] = None
    assignee_email: Optional[str] = None
    story_points: Optional[float] = None
    created_at: datetime
    resolution_date: Optional[datetime] = None
    resolved: bool
    parent_key: Optional[str] = None
    raw_fields: Optional[Dict[str, Any]] = None
    last_synced_at: Optional[datetime] = None


class JiraChangelogEntryResponse(BaseModel):
    """Jira changelog entry response."""
    id: UUID
    jira_issue_key: str
    tenant_id: UUID
    changed_at: datetime
    from_status: Optional[str] = None
    to_status: Optional[str] = None
    jira_author_display_name: Optional[str] = None
    created_at: datetime


class WebhookPayload(BaseModel):
    """Jira webhook payload structure."""
    webhookEvent: str
    issue: Optional[Dict[str, Any]] = None
    changelog: Optional[Dict[str, Any]] = None
    sprint: Optional[Dict[str, Any]] = None
    board: Optional[Dict[str, Any]] = None
    timestamp: int


class JiraWebhookHeader(BaseModel):
    """Jira webhook signature headers."""
    x_hub_signature: str
    x_hub_signature_256: Optional[str] = None