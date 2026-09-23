from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.modules.jira.router import router as jira_router

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Modular monolith API for Turing ITSM MVP domains.",
)

origins = [origin.strip() for origin in settings.api_cors_origins.split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "turing-itsm-api"}


@app.get("/domains", tags=["system"])
def domains() -> dict[str, list[str]]:
    return {
        "domains": [
            "identity_access",
            "tenants",
            "tickets",
            "sla_management",
            "assets_cmdb",
            "notifications",
            "reports",
            "audit_log",
            "knowledge_base",
            "jira",
        ]
    }


# Include Jira integration router (feature-flagged)
if settings.jira_integration_v2:
    app.include_router(jira_router)
