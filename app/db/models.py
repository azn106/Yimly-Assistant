from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy import (
    Column, Integer, String, Boolean, Float, DateTime, ForeignKey, Text, JSON, Index, Table
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.database import Base

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar_color: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    profile_picture_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    map_style: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, default="osm")
    map_selected_icon_size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, default=48)
    map_unselected_icon_size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, default=36)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    devices: Mapped[List["Device"]] = relationship("Device", back_populates="user", cascade="all, delete-orphan")
    entities: Mapped[List["EntityState"]] = relationship("EntityState", back_populates="user", cascade="all, delete-orphan")
    location_history: Mapped[List["LocationHistory"]] = relationship("LocationHistory", back_populates="user", cascade="all, delete-orphan")
    events: Mapped[List["EventRecord"]] = relationship("EventRecord", back_populates="user", cascade="all, delete-orphan")


class OAuthClient(Base):
    __tablename__ = "oauth_clients"

    client_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    allowed_redirect_uris: Mapped[str] = mapped_column(Text, nullable=False)  # Semicolon separated, or JSON list string


class AuthorizationCode(Base):
    __tablename__ = "authorization_codes"

    code_hash: Mapped[str] = mapped_column(String(255), primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    client_id: Mapped[str] = mapped_column(String(255), nullable=False)
    redirect_uri: Mapped[str] = mapped_column(String(1024), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    token_hash: Mapped[str] = mapped_column(String(255), primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    client_id: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    device_id: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    app_id: Mapped[str] = mapped_column(String(255), nullable=False)
    app_name: Mapped[str] = mapped_column(String(255), nullable=False)
    app_version: Mapped[str] = mapped_column(String(50), nullable=False)
    device_name: Mapped[str] = mapped_column(String(255), nullable=False)
    manufacturer: Mapped[str] = mapped_column(String(255), nullable=False)
    model: Mapped[str] = mapped_column(String(255), nullable=False)
    os_name: Mapped[str] = mapped_column(String(100), nullable=False)
    os_version: Mapped[str] = mapped_column(String(50), nullable=False)
    supports_encryption: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    app_data: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    webhook_id: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    webhook_secret_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="devices")
    entities: Mapped[List["EntityState"]] = relationship("EntityState", back_populates="device", cascade="all, delete-orphan")
    sensors: Mapped[List["SensorRegistration"]] = relationship("SensorRegistration", back_populates="device", cascade="all, delete-orphan")
    location_history: Mapped[List["LocationHistory"]] = relationship("LocationHistory", back_populates="device", cascade="all, delete-orphan")


class EntityState(Base):
    __tablename__ = "entities"

    entity_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    device_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("devices.id", ondelete="SET NULL"), nullable=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    domain: Mapped[str] = mapped_column(String(50), nullable=False)  # device_tracker, sensor, binary_sensor, etc.
    state: Mapped[str] = mapped_column(String(255), nullable=False)
    attributes: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    last_changed: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    last_updated: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="entities")
    device: Mapped[Optional["Device"]] = relationship("Device", back_populates="entities")

    __table_args__ = (
        Index("idx_entities_user_entity", "user_id", "entity_id"),
    )


class SensorRegistration(Base):
    __tablename__ = "sensor_registrations"

    unique_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    device_id: Mapped[int] = mapped_column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    unit_of_measurement: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    icon: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    device_class: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    state_class: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    entity_category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    disabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    device: Mapped["Device"] = relationship("Device", back_populates="sensors")


class LocationHistory(Base):
    __tablename__ = "location_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[int] = mapped_column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    accuracy: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    altitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    speed: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bearing: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    trigger: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    metadata_json: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="location_history")
    device: Mapped["Device"] = relationship("Device", back_populates="location_history")

    __table_args__ = (
        Index("idx_loc_hist_user_dev_time", "user_id", "device_id", "timestamp"),
    )


class EventRecord(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    event_data: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="events")


class Circle(Base):
    __tablename__ = "circles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    owner_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    invite_code: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    owner: Mapped["User"] = relationship("User", foreign_keys=[owner_id])
    members: Mapped[List["CircleMember"]] = relationship("CircleMember", back_populates="circle", cascade="all, delete-orphan")


class CircleMember(Base):
    __tablename__ = "circle_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    circle_id: Mapped[int] = mapped_column(Integer, ForeignKey("circles.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    circle: Mapped["Circle"] = relationship("Circle", back_populates="members")
    user: Mapped["User"] = relationship("User")

