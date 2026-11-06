"""Validated tool inputs and normalized outputs. Times are integer milliseconds."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class TranscriptionRequest(StrictModel):
    source: Literal["file", "url", "object_storage"]
    location: str = Field(min_length=1, max_length=4096)
    language: Literal["ko-KR", "en-US", "enko", "ja", "zh-cn", "zh-tw"] = "ko-KR"
    diarization: bool = True
    completion: Literal["sync", "async"] = "sync"
    result_to_obs: bool = False

    @model_validator(mode="after")
    def async_sink(self) -> "TranscriptionRequest":
        if (self.completion == "async") != self.result_to_obs:
            raise ValueError("async requires result_to_obs=true; sync requires false")
        return self


class Word(StrictModel):
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    text: str

    @model_validator(mode="after")
    def ordered(self) -> "Word":
        if self.end_ms < self.start_ms:
            raise ValueError("end precedes start")
        return self


class Segment(Word):
    speaker: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    words: list[Word] = Field(default_factory=list)


class Transcript(StrictModel):
    status: Literal["SUCCEEDED", "WAITING", "PROCESSING", "FAILED", "COMPLETED", "TIMEOUT"]
    token: str | None = None
    text: str = ""
    segments: list[Segment] = Field(default_factory=list)
