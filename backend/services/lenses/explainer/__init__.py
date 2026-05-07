"""M14.18 — Document Explainer lens module."""

from services.lenses.explainer.extract import explain_document
from services.lenses.explainer.schemas import ExplainerOutput

__all__ = ["explain_document", "ExplainerOutput"]
