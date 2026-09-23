# jira

Jira integration domain for Turing ITSM modular monolith.

## Features

- Credential management with pgp_sym encryption
- Sync pipeline with advisory locking (full / incremental)
- Webhook endpoint with signature verification
- Scheduler with concurrent-execution protection
- Feature-flagged behind `jira_integration_v2`

## Tables (from migration 20260902023428)

- `jira_integrations` - Credentials and config per tenant (encrypted)
- `jira_teams` - Team ↔ integration mapping
- `jira_boards` - Jira boards per integration
- `jira_sprints` - Sprints per board
- `jira_issues` - Issues with normalized story points
- `jira_changelog_entries` - Status transitions
- `jira_sync_runs` - Pipeline execution log

## RPCs

- `encrypt_jira_credential(text) -> bytea` - pgp_sym_encrypt
- `decrypt_jira_credential(bytea) -> text` - pgp_sym_decrypt
- `get_decrypted_jira_integration(uuid) -> record` - Admin-only decryption for sync