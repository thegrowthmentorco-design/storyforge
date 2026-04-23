from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Brief(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: str
    tags: list[str] = Field(default_factory=list)


class UserStory(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    actor: str
    want: str
    so_that: str
    section: str = ""
    criteria: list[str] = Field(default_factory=list)


class NonFunctional(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: str
    value: str


class Gap(BaseModel):
    model_config = ConfigDict(extra="forbid")
    severity: Literal["high", "med", "low"]
    question: str
    section: str = ""
    context: str = ""


class ExtractionPayload(BaseModel):
    """Shape the model produces. Passed to messages.parse()."""
    model_config = ConfigDict(extra="forbid")
    brief: Brief
    actors: list[str]
    stories: list[UserStory]
    nfrs: list[NonFunctional]
    gaps: list[Gap]


class ExtractionResult(ExtractionPayload):
    """Shape the API returns. Adds server-side metadata."""
    filename: str
    raw_text: str
    live: bool  # True if Claude extracted; False if mock
