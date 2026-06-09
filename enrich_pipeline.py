"""
Batch enrichment script for local biodiversity image classifications.

The script reads rows from the FastAPI app's SQLite database, finds image
classifications that have not been validated by external biodiversity APIs,
uploads the stored image to Pl@ntNet and iNaturalist-style endpoints, and writes
the best available taxonomic enrichment back to SQLite.

Run:
    python enrich_pipeline.py

Environment variables:
    BIODIVERSITY_DB_PATH       Optional path to SQLite database.
    PLANTNET_API_KEY           Placeholder API key for Pl@ntNet.
    PLANTNET_PROJECT           Pl@ntNet project; defaults to "all".
    INATURALIST_API_URL        Optional iNaturalist-compatible endpoint.
    ENRICHMENT_BATCH_LIMIT     Max rows per run; defaults to 25.
"""

from __future__ import annotations

import asyncio
import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import httpx


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("BIODIVERSITY_DB_PATH", BASE_DIR / "data" / "biodiversity.db"))

PLANTNET_API_KEY = os.getenv("PLANTNET_API_KEY", "PASTE_YOUR_PLANTNET_API_KEY_HERE")
PLANTNET_PROJECT = os.getenv("PLANTNET_PROJECT", "all")
PLANTNET_API_URL = (
    f"https://my-api.plantnet.org/v2/identify/{PLANTNET_PROJECT}"
)

# iNaturalist does not provide a general public computer-vision image upload API
# in the same shape as Pl@ntNet for arbitrary local files. Keep this configurable
# so teams can point it at an internal proxy or compatible validation service.
INATURALIST_API_URL = os.getenv(
    "INATURALIST_API_URL",
    "https://api.inaturalist.org/v1/computervision/score_image",
)

BATCH_LIMIT = int(os.getenv("ENRICHMENT_BATCH_LIMIT", "25"))
REQUEST_TIMEOUT_SECONDS = 30
MAX_CONCURRENT_REQUESTS = 3


ENRICHMENT_COLUMNS = {
    "external_validation_status": "TEXT NOT NULL DEFAULT 'pending'",
    "plantnet_scientific_name": "TEXT",
    "plantnet_common_name": "TEXT",
    "plantnet_family": "TEXT",
    "plantnet_confidence": "REAL",
    "inaturalist_scientific_name": "TEXT",
    "inaturalist_common_name": "TEXT",
    "inaturalist_family": "TEXT",
    "inaturalist_confidence": "REAL",
    "verified_scientific_name": "TEXT",
    "verified_common_name": "TEXT",
    "verified_family": "TEXT",
    "verified_confidence": "REAL",
    "external_validation_error": "TEXT",
    "external_validated_at": "TEXT",
}


@dataclass
class ImageRow:
    """A pending local image classification row from SQLite."""

    id: int
    stored_path: Path
    original_filename: str


@dataclass
class TaxonomyResult:
    """Normalized best taxonomic candidate returned by an external service."""

    provider: str
    scientific_name: Optional[str]
    common_name: Optional[str]
    family: Optional[str]
    confidence: Optional[float]
    error: Optional[str] = None

    @property
    def is_successful(self) -> bool:
        return bool(self.scientific_name) and self.error is None


def get_connection() -> sqlite3.Connection:
    """Open a SQLite connection with row-style access."""

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_enrichment_columns() -> None:
    """Add enrichment columns to the existing image_classifications table."""

    if not DB_PATH.exists():
        raise FileNotFoundError(f"SQLite database not found: {DB_PATH}")

    with get_connection() as conn:
        existing_columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(image_classifications)").fetchall()
        }

        if not existing_columns:
            raise RuntimeError("Table image_classifications does not exist.")

        for column_name, column_definition in ENRICHMENT_COLUMNS.items():
            if column_name not in existing_columns:
                conn.execute(
                    f"ALTER TABLE image_classifications "
                    f"ADD COLUMN {column_name} {column_definition}"
                )
        conn.commit()


def fetch_pending_rows(limit: int) -> List[ImageRow]:
    """Find rows where local inference exists but external validation is pending."""

    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, stored_path, original_filename
            FROM image_classifications
            WHERE status IN ('success', 'failed', 'model_unavailable')
              AND COALESCE(external_validation_status, 'pending') IN ('pending', 'retry')
            ORDER BY created_at ASC, id ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    return [
        ImageRow(
            id=row["id"],
            stored_path=Path(row["stored_path"]),
            original_filename=row["original_filename"],
        )
        for row in rows
    ]


async def call_plantnet(client: httpx.AsyncClient, row: ImageRow) -> TaxonomyResult:
    """Upload an image to Pl@ntNet and normalize its top taxonomic result."""

    if not PLANTNET_API_KEY or PLANTNET_API_KEY == "PASTE_YOUR_PLANTNET_API_KEY_HERE":
        return TaxonomyResult(
            provider="plantnet",
            scientific_name=None,
            common_name=None,
            family=None,
            confidence=None,
            error="Missing PLANTNET_API_KEY.",
        )

    try:
        image_bytes = row.stored_path.read_bytes()
        files = {
            "images": (
                row.original_filename or row.stored_path.name,
                image_bytes,
                "image/jpeg",
            )
        }
        data = {"organs": "leaf"}
        params = {"api-key": PLANTNET_API_KEY}

        response = await client.post(
            PLANTNET_API_URL,
            params=params,
            data=data,
            files=files,
        )
        response.raise_for_status()
        return parse_plantnet_response(response.json())
    except httpx.TimeoutException:
        return _error_result("plantnet", "Pl@ntNet request timed out.")
    except httpx.HTTPStatusError as exc:
        return _error_result(
            "plantnet",
            f"Pl@ntNet HTTP {exc.response.status_code}: {exc.response.text[:300]}",
        )
    except OSError as exc:
        return _error_result("plantnet", f"Could not read local image: {exc}")
    except Exception as exc:
        return _error_result("plantnet", f"Pl@ntNet validation failed: {exc}")


async def call_inaturalist(client: httpx.AsyncClient, row: ImageRow) -> TaxonomyResult:
    """
    Upload an image to an iNaturalist-compatible endpoint.

    This endpoint is intentionally configurable because production teams often
    use a proxy/service account for image scoring. If the public endpoint rejects
    the request, the error is recorded without stopping the batch.
    """

    try:
        image_bytes = row.stored_path.read_bytes()
        files = {
            "image": (
                row.original_filename or row.stored_path.name,
                image_bytes,
                "image/jpeg",
            )
        }
        response = await client.post(INATURALIST_API_URL, files=files)
        response.raise_for_status()
        return parse_inaturalist_response(response.json())
    except httpx.TimeoutException:
        return _error_result("inaturalist", "iNaturalist request timed out.")
    except httpx.HTTPStatusError as exc:
        return _error_result(
            "inaturalist",
            f"iNaturalist HTTP {exc.response.status_code}: {exc.response.text[:300]}",
        )
    except OSError as exc:
        return _error_result("inaturalist", f"Could not read local image: {exc}")
    except Exception as exc:
        return _error_result("inaturalist", f"iNaturalist validation failed: {exc}")


def parse_plantnet_response(payload: Dict[str, Any]) -> TaxonomyResult:
    """Extract the highest-confidence taxon from a Pl@ntNet response."""

    results = payload.get("results") or []
    if not results:
        return _error_result("plantnet", "Pl@ntNet returned no candidates.")

    best = max(results, key=lambda item: float(item.get("score") or 0.0))
    species = best.get("species") or {}
    family = species.get("family") or {}
    common_names = species.get("commonNames") or []

    return TaxonomyResult(
        provider="plantnet",
        scientific_name=species.get("scientificNameWithoutAuthor")
        or species.get("scientificName"),
        common_name=common_names[0] if common_names else None,
        family=family.get("scientificNameWithoutAuthor") or family.get("scientificName"),
        confidence=float(best.get("score") or 0.0),
    )


def parse_inaturalist_response(payload: Dict[str, Any]) -> TaxonomyResult:
    """Extract the highest-confidence taxon from an iNaturalist-like response."""

    results = payload.get("results") or payload.get("scores") or []
    if not results:
        return _error_result("inaturalist", "iNaturalist returned no candidates.")

    best = max(
        results,
        key=lambda item: float(item.get("score") or item.get("confidence") or 0.0),
    )
    taxon = best.get("taxon") or best

    return TaxonomyResult(
        provider="inaturalist",
        scientific_name=taxon.get("name") or taxon.get("scientific_name"),
        common_name=taxon.get("preferred_common_name") or taxon.get("common_name"),
        family=_extract_family_from_taxon(taxon),
        confidence=float(best.get("score") or best.get("confidence") or 0.0),
    )


def _extract_family_from_taxon(taxon: Dict[str, Any]) -> Optional[str]:
    """Find a family-level name in common iNaturalist taxon shapes."""

    if taxon.get("rank") == "family":
        return taxon.get("name")

    ancestors = taxon.get("ancestors") or []
    for ancestor in ancestors:
        if ancestor.get("rank") == "family":
            return ancestor.get("name") or ancestor.get("scientific_name")

    return taxon.get("family")


def _error_result(provider: str, message: str) -> TaxonomyResult:
    """Build a normalized failed provider result."""

    return TaxonomyResult(
        provider=provider,
        scientific_name=None,
        common_name=None,
        family=None,
        confidence=None,
        error=message,
    )


def choose_verified_result(results: Iterable[TaxonomyResult]) -> Optional[TaxonomyResult]:
    """Select the best successful external result across providers."""

    successful = [result for result in results if result.is_successful]
    if not successful:
        return None

    return max(successful, key=lambda result: result.confidence or 0.0)


def update_row(row_id: int, results: List[TaxonomyResult]) -> None:
    """Persist provider-specific results and final enrichment status."""

    plantnet = next((result for result in results if result.provider == "plantnet"), None)
    inaturalist = next((result for result in results if result.provider == "inaturalist"), None)
    verified = choose_verified_result(results)

    errors = "; ".join(result.error for result in results if result.error)
    status = "enriched" if verified else "enrichment_failed"

    with get_connection() as conn:
        conn.execute(
            """
            UPDATE image_classifications
            SET external_validation_status = ?,
                plantnet_scientific_name = ?,
                plantnet_common_name = ?,
                plantnet_family = ?,
                plantnet_confidence = ?,
                inaturalist_scientific_name = ?,
                inaturalist_common_name = ?,
                inaturalist_family = ?,
                inaturalist_confidence = ?,
                verified_scientific_name = ?,
                verified_common_name = ?,
                verified_family = ?,
                verified_confidence = ?,
                external_validation_error = ?,
                external_validated_at = datetime('now')
            WHERE id = ?
            """,
            (
                status,
                plantnet.scientific_name if plantnet else None,
                plantnet.common_name if plantnet else None,
                plantnet.family if plantnet else None,
                plantnet.confidence if plantnet else None,
                inaturalist.scientific_name if inaturalist else None,
                inaturalist.common_name if inaturalist else None,
                inaturalist.family if inaturalist else None,
                inaturalist.confidence if inaturalist else None,
                verified.scientific_name if verified else None,
                verified.common_name if verified else None,
                verified.family if verified else None,
                verified.confidence if verified else None,
                errors or None,
                row_id,
            ),
        )
        conn.commit()


async def enrich_one(
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    row: ImageRow,
) -> None:
    """Run external enrichment for one image row without crashing the batch."""

    async with semaphore:
        if not row.stored_path.exists():
            update_row(
                row.id,
                [
                    _error_result(
                        "local",
                        f"Stored image file does not exist: {row.stored_path}",
                    )
                ],
            )
            print(f"[{row.id}] missing local image")
            return

        plantnet_task = call_plantnet(client, row)
        inaturalist_task = call_inaturalist(client, row)
        results = await asyncio.gather(plantnet_task, inaturalist_task)
        update_row(row.id, list(results))

        verified = choose_verified_result(results)
        if verified:
            print(
                f"[{row.id}] enriched: {verified.scientific_name} "
                f"({verified.confidence:.4f}) via {verified.provider}"
            )
        else:
            print(f"[{row.id}] enrichment failed")


async def run_enrichment() -> None:
    """Main async batch loop."""

    ensure_enrichment_columns()
    pending_rows = fetch_pending_rows(BATCH_LIMIT)
    if not pending_rows:
        print("No pending image classifications to enrich.")
        return

    timeout = httpx.Timeout(REQUEST_TIMEOUT_SECONDS)
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)

    async with httpx.AsyncClient(timeout=timeout) as client:
        tasks = [enrich_one(client, semaphore, row) for row in pending_rows]
        await asyncio.gather(*tasks)

    print(f"Processed {len(pending_rows)} image classification row(s).")


if __name__ == "__main__":
    asyncio.run(run_enrichment())
