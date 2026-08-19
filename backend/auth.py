import hashlib
import secrets
import uuid
from typing import Optional

from fastapi import HTTPException, Header, Depends
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models import User, AuthSession, SessionLocal

import bcrypt
if not hasattr(bcrypt, "__about__"):
    bcrypt.__about__ = type("about", (), {"__version__": getattr(bcrypt, "__version__", "4.0.0")})()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _old_pbkdf2_verify(password: str, password_hash: str, password_salt: str) -> bool:
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), password_salt.encode("utf-8"), 100_000)
    return secrets.compare_digest(digest.hex(), password_hash)


class UserResponse(BaseModel):
    id: str
    username: str
    display_name: str
    role: str


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    display_name: str = Field(min_length=1, max_length=120)
    role: str = Field(default="analyst", max_length=64)


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    user: UserResponse


def _user_to_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        role=user.role,
    )


def seed_demo_users(db: Session) -> None:
    demos = [
        ("alice", "demo123", "Alice Chen", "compliance_officer"),
        ("bob", "demo123", "Bob Iyer", "analyst"),
        ("priya", "demo123", "Priya Reviewer", "reviewer"),
    ]
    for username, password, display_name, role in demos:
        existing = db.query(User).filter(User.username == username).first()
        if existing:
            existing.password_hash = pwd_context.hash(password)
            existing.password_salt = ""
            existing.display_name = display_name
            existing.role = role
        else:
            db.add(
                User(
                    id=str(uuid.uuid4()),
                    username=username,
                    password_hash=pwd_context.hash(password),
                    password_salt="",
                    display_name=display_name,
                    role=role,
                )
            )
    db.commit()


def _store_token(db: Session, user_id: str) -> str:
    token = secrets.token_hex(32)
    db.add(AuthSession(token=token, user_id=user_id))
    db.commit()
    return token


def register_user(request: RegisterRequest, db: Session) -> LoginResponse:
    username = request.username.strip().lower()
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=400, detail="Username already taken")

    user = User(
        id=str(uuid.uuid4()),
        username=username,
        password_hash=pwd_context.hash(request.password),
        display_name=request.display_name.strip(),
        role=request.role.strip() or "analyst",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = _store_token(db, user.id)
    return LoginResponse(token=token, user=_user_to_response(user))


def login_user(request: LoginRequest, db: Session) -> LoginResponse:
    username = request.username.strip().lower()
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")

    verified = False
    try:
        verified = pwd_context.verify(request.password, user.password_hash)
    except (ValueError, TypeError):
        pass

    if not verified and user.password_salt:
        verified = _old_pbkdf2_verify(request.password, user.password_hash, user.password_salt)
        if verified:
            user.password_hash = pwd_context.hash(request.password)

    if not verified:
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = _store_token(db, user.id)
    return LoginResponse(token=token, user=_user_to_response(user))


def resolve_user_from_authorization(
    authorization: Optional[str],
    db: Session,
) -> Optional[UserResponse]:
    if not authorization:
        return None

    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None

    session = db.query(AuthSession).filter(AuthSession.token == parts[1]).first()
    if not session:
        return None

    user = db.query(User).filter(User.id == session.user_id).first()
    if not user:
        return None

    return _user_to_response(user)


def get_current_user(
    authorization: Optional[str] = Header(None),
) -> UserResponse:
    db = SessionLocal()
    try:
        user = resolve_user_from_authorization(authorization, db)
        if not user:
            raise HTTPException(status_code=401, detail="Not authenticated")
        return user
    finally:
        db.close()


# Roles allowed to view / manage the org-wide audit trail
AUDIT_ACCESS_ROLES = frozenset({"compliance_officer", "reviewer"})


def user_can_access_audit(user: UserResponse) -> bool:
    return user.role in AUDIT_ACCESS_ROLES


def require_audit_access(
    current_user: UserResponse = Depends(get_current_user),
) -> UserResponse:
    if not user_can_access_audit(current_user):
        raise HTTPException(
            status_code=403,
            detail="Audit Trail access requires compliance officer or reviewer role",
        )
    return current_user
