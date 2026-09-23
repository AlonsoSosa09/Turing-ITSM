"""Encryption utilities for Jira credentials using pgp_sym."""

import os
import secrets
from typing import Optional
from uuid import UUID

from app.core.config import get_settings


def get_encryption_key() -> str:
    """Get the encryption key from environment or generate a development key."""
    key = os.getenv("JIRA_CREDENTIALS_ENCRYPTION_KEY")
    if key:
        return key

    # Development fallback - in production this MUST be set
    dev_key = os.getenv("JIRA_DEV_ENCRYPTION_KEY", "dev-only-insecure-key-change-in-production")
    if not os.getenv("JIRA_CREDENTIALS_ENCRYPTION_KEY"):
        # Warn only once per process
        if not hasattr(get_encryption_key, "_warned"):
            print(
                "WARNING: JIRA_CREDENTIALS_ENCRYPTION_KEY not set. "
                "Using development fallback. DO NOT USE IN PRODUCTION."
            )
            get_encryption_key._warned = True
    return dev_key


def generate_encryption_key() -> str:
    """Generate a secure random encryption key for production use."""
    return secrets.token_urlsafe(32)


def encrypt_credential(plaintext: str) -> bytes:
    """
    Encrypt a credential using pgp_sym_encrypt.

    This calls the database RPC `encrypt_jira_credential(plaintext text) -> bytea`.
    The actual encryption is performed by the database using pgp_sym_encrypt
    with the key stored in the database's encryption key configuration.
    """
    # The actual encryption is done via the database RPC.
    # This function is a placeholder for when encryption is done at the application level.
    # For now, we delegate to the database RPC.
    raise NotImplementedError("Use database RPC encrypt_jira_credential")


def decrypt_credential(ciphertext: bytes) -> str:
    """
    Decrypt a credential using pgp_sym_decrypt.

    This calls the database RPC `decrypt_jira_credential(ciphertext bytea) -> text`.
    """
    # The actual decryption is done via the database RPC.
    raise NotImplementedError("Use database RPC decrypt_jira_credential")


def encrypt_credential_local(plaintext: str, key: Optional[str] = None) -> bytes:
    """
    Local encryption fallback using pgcrypto-compatible format.

    This is a fallback for local development when database RPC is unavailable.
    Uses pgcrypto's pgp_sym_encrypt format: \x01 + cipher + md5(key)
    """
    from pgpy import PGPMessage
    from pgpy.constants import CompressionAlgorithm

    key = key or get_encryption_key()

    # Using pgpy for PGP symmetric encryption (compatible with pgp_sym_encrypt)
    message = PGPMessage.new(plaintext.encode("utf-8"))
    encrypted = message.encrypt(key, compression=CompressionAlgorithm.ZLIB)

    # Convert to bytea-like format (hex string prefixed with \x)
    return bytes(str(encrypted), "utf-8")


def decrypt_credential_local(ciphertext: bytes, key: Optional[str] = None) -> str:
    """
    Local decryption fallback.

    Decrypts pgcrypto-compatible ciphertext.
    """
    from pgpy import PGPMessage

    key = key or get_encryption_key()

    try:
        message = PGPMessage.from_blob(ciphertext.decode("utf-8"))
        decrypted = message.decrypt(key)
        return str(decrypted)
    except Exception as e:
        raise ValueError(f"Failed to decrypt credential: {e}")


# Key rotation support (future enhancement)

class EncryptionKeyManager:
    """Manages encryption keys with rotation support."""

    def __init__(self):
        self._keys: dict[int, str] = {}
        self._current_key_id: int = 1

    def add_key(self, key: str, key_id: Optional[int] = None) -> int:
        """Add a new encryption key."""
        if key_id is None:
            key_id = max(self._keys.keys(), default=0) + 1
        self._keys[key_id] = key
        return key_id

    def get_key(self, key_id: int) -> str:
        """Get encryption key by ID."""
        if key_id not in self._keys:
            raise ValueError(f"Encryption key {key_id} not found")
        return self._keys[key_id]

    def get_current_key(self) -> tuple[int, str]:
        """Get current encryption key and its ID."""
        if self._current_key_id not in self._keys:
            # Fallback to environment
            return 1, get_encryption_key()
        return self._current_key_id, self._keys[self._current_key_id]

    def rotate_key(self, new_key: str) -> int:
        """Rotate to a new encryption key."""
        new_id = self.add_key(new_key)
        self._current_key_id = new_id
        return new_id


# Global key manager instance
key_manager = EncryptionKeyManager()


def get_current_encryption_context() -> tuple[int, str]:
    """Get current encryption key ID and key."""
    return key_manager.get_current_key()