"""Source connector interfaces live here as the crawler grows."""
from __future__ import annotations

from typing import Protocol


class SourceConnector(Protocol):
    source_name: str
