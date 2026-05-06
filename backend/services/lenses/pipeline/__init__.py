"""M14.17 — Pipeline lens module.

Public surface (used by /api/extract dispatcher):
  - run_pipeline(filename, raw_text, ...) → (PipelineResult, TokenUsage)
  - PipelineResult schema for type hints
"""

from services.lenses.pipeline.orchestrator import run_pipeline
from services.lenses.pipeline.schemas import PipelineResult

__all__ = ["run_pipeline", "PipelineResult"]
