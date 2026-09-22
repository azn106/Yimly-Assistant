import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.db.models import AuthorizationCode, RefreshToken

class TokenService:
    @staticmethod
    def hash_value(value: str) -> str:
        return hashlib.sha256(value.encode('utf-8')).hexdigest()

    @staticmethod
    async def create_authorization_code(
        db: AsyncSession,
        user_id: int,
        client_id: str,
        redirect_uri: str
    ) -> str:
        raw_code = secrets.token_urlsafe(32)
        code_hash = TokenService.hash_value(raw_code)
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.AUTH_CODE_EXPIRE_SECONDS)

        auth_code = AuthorizationCode(
            code_hash=code_hash,
            user_id=user_id,
            client_id=client_id,
            redirect_uri=redirect_uri,
            expires_at=expires_at,
            created_at=datetime.now(timezone.utc)
        )
        db.add(auth_code)
        await db.commit()
        return raw_code

    @staticmethod
    async def redeem_authorization_code(
        db: AsyncSession,
        raw_code: str,
        client_id: str,
        redirect_uri: str
    ) -> Optional[int]:
        code_hash = TokenService.hash_value(raw_code)
        stmt = select(AuthorizationCode).where(
            AuthorizationCode.code_hash == code_hash,
            AuthorizationCode.client_id == client_id,
            AuthorizationCode.redirect_uri == redirect_uri
        )
        result = await db.execute(stmt)
        auth_code = result.scalar_one_or_none()

        if not auth_code:
            return None

        # Expired or already used
        now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
        if auth_code.used_at is not None or auth_code.expires_at < now_naive:
            return None

        # Consumed atomically
        auth_code.used_at = datetime.now(timezone.utc)
        await db.commit()

        return auth_code.user_id

    @staticmethod
    async def create_refresh_token(
        db: AsyncSession,
        user_id: int,
        client_id: str
    ) -> str:
        raw_token = secrets.token_urlsafe(40)
        token_hash = TokenService.hash_value(raw_token)
        expires_at = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

        refresh_token = RefreshToken(
            token_hash=token_hash,
            user_id=user_id,
            client_id=client_id,
            expires_at=expires_at,
            created_at=datetime.now(timezone.utc)
        )
        db.add(refresh_token)
        await db.commit()
        return raw_token

    @staticmethod
    async def redeem_refresh_token(
        db: AsyncSession,
        raw_token: str,
        client_id: str
    ) -> Optional[int]:
        token_hash = TokenService.hash_value(raw_token)
        stmt = select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.client_id == client_id
        )
        result = await db.execute(stmt)
        ref_token = result.scalar_one_or_none()

        if not ref_token:
            return None

        now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
        if ref_token.revoked_at is not None or ref_token.expires_at < now_naive:
            return None

        return ref_token.user_id

    @staticmethod
    async def revoke_refresh_token(
        db: AsyncSession,
        raw_token: str
    ) -> bool:
        token_hash = TokenService.hash_value(raw_token)
        stmt = select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        result = await db.execute(stmt)
        ref_token = result.scalar_one_or_none()

        if not ref_token:
            return False

        if ref_token.revoked_at is None:
            ref_token.revoked_at = datetime.now(timezone.utc)
            await db.commit()
            return True

        return False
