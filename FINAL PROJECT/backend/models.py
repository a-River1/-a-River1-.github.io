"""Public intake and structured research contracts."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class Jurisdiction(Model):
    country: Literal['US'] = 'US'
    state: str = Field(default='', max_length=80)
    county: str = Field(default='', max_length=120)
    city: str = Field(default='', max_length=120)
    court: str = Field(default='', max_length=200)


class Event(Model):
    date: str = Field(max_length=80)
    description: str = Field(min_length=1, max_length=2000)


class Document(Model):
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=24000)


class Intake(Model):
    question: str = Field(min_length=12, max_length=4000)
    facts: str = Field(min_length=20, max_length=16000)
    jurisdiction: Jurisdiction
    legal_area: str = Field(default='', max_length=120)
    desired_outcome: str = Field(default='', max_length=2000)
    parties: list[str] = Field(default_factory=list, max_length=20)
    timeline: list[Event] = Field(default_factory=list, max_length=30)
    procedural_status: str = Field(default='', max_length=2000)
    deadlines: list[Event] = Field(default_factory=list, max_length=20)
    additional_context: str = Field(default='', max_length=8000)
    documents: list[Document] = Field(default_factory=list, max_length=5)
    pro_bono: bool = False


# Required fields avoid ambiguous defaults in OpenAI's strict JSON schema.
class Plan(Model):
    court_query: str
    federal_query: str
    state_query: str
    issues: list[str]
    missing_information: list[str]


class Finding(Model):
    statement: str
    source_ids: list[str]
    relationship: Literal['supporting', 'adverse', 'background', 'uncertain']


class Annotation(Model):
    source_id: str
    passage_id: str
    explanation: str


class SourceAnalysis(Model):
    source_id: str
    summary: str
    potential_use: str
    limitations: str


class Report(Model):
    source_analyses: list[SourceAnalysis]
    findings: list[Finding]
    annotations: list[Annotation]
    missing_information: list[str]
    next_steps: list[str]
    limitations: list[str]
