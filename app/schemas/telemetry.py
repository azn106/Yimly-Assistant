from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field, field_validator

class LocationUpdateData(BaseModel):
    latitude: float = Field(..., description="Latitude coordinate")
    longitude: float = Field(..., description="Longitude coordinate")
    gps_accuracy: Optional[float] = Field(default=None, description="GPS accuracy radius in meters")
    altitude: Optional[float] = Field(default=None, description="Altitude in meters")
    speed: Optional[float] = Field(default=None, description="Speed in meters per second")
    bearing: Optional[float] = Field(default=None, description="Bearing/heading in degrees")
    battery: Optional[float] = Field(default=None, description="Battery level percentage")
    trigger: Optional[str] = Field(default=None, description="What triggered the location update")
    vertical_accuracy: Optional[float] = Field(default=None, description="Vertical accuracy in meters")

    # Extra fields can be safely stored as raw attributes
    class Config:
        extra = "allow"

    @field_validator("latitude")
    @classmethod
    def validate_latitude(cls, v: float) -> float:
        if not (-90.0 <= v <= 90.0):
            raise ValueError("Latitude must be between -90 and 90")
        return v

    @field_validator("longitude")
    @classmethod
    def validate_longitude(cls, v: float) -> float:
        if not (-180.0 <= v <= 180.0):
            raise ValueError("Longitude must be between -180 and 180")
        return v

class SensorRegistrationData(BaseModel):
    unique_id: str = Field(..., description="Unique ID for the sensor")
    name: str = Field(..., description="Readable name of the sensor")
    type: str = Field(default="sensor", description="Type of entity: sensor, binary_sensor, etc.")
    unit_of_measurement: Optional[str] = Field(default=None, description="Unit of measurement")
    icon: Optional[str] = Field(default=None, description="Lucide or MDI icon")
    device_class: Optional[str] = Field(default=None, description="HA device class classification")
    state_class: Optional[str] = Field(default=None, description="HA state class")
    entity_category: Optional[str] = Field(default=None, description="HA entity category")
    disabled: bool = Field(default=False, description="Whether the sensor is disabled")

    class Config:
        extra = "allow"

class SensorStateUpdate(BaseModel):
    unique_id: str = Field(..., description="Unique ID of the registered sensor")
    state: Any = Field(..., description="The new state/value of the sensor")
    attributes: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Attributes for the sensor state")
    type: Optional[str] = Field(default=None, description="Optional entity type")

    class Config:
        extra = "allow"

class WebhookRequest(BaseModel):
    type: str = Field(..., description="Type of webhook payload: update_location, register_sensor, update_sensor_states")
    data: Union[LocationUpdateData, SensorRegistrationData, List[SensorStateUpdate], Dict[str, Any]] = Field(..., description="Payload data")
