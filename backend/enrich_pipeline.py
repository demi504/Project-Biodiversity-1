"""
Core taxonomic enrichment module for the UNIBEN biodiversity pipeline.

This module sends raw plant image bytes to the Pl@ntNet identification API and
normalizes the top result into fields that can be merged into the project's
38-parameter Darwin Core-style observation schema.

Environment:
    PLANTNET_API_KEY=<your Pl@ntNet API key>

Example:
    from pathlib import Path
    from enrich_pipeline import enrich_plant_image

    image_bytes = Path("sample_leaf.jpg").read_bytes()
    taxonomy = enrich_plant_image(image_bytes)
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

import requests
from dotenv import load_dotenv


load_dotenv()


PLANTNET_API_KEY = os.getenv("PLANTNET_API_KEY")
PLANTNET_IDENTIFY_URL = "https://my.plantnet.org/api/v2/identify/all"
REQUEST_TIMEOUT_SECONDS = 30


UNKNOWN_TAXONOMY: Dict[str, Any] = {
    "category": "Flora",
    "kingdom": "Plantae",
    "phylum": "Tracheophyta",
    "class": "Magnoliopsida",
    "order": "Unknown",
    "family": "Unknown",
    "genus": "Unknown",
    "species": "Unknown",
    "annotation_confidence_score": 1,
    "plantnet_score": 0.0,
    "enrichment_status": "failed",
    "enrichment_error": None,
}


def enrich_plant_image(image_bytes: bytes) -> Dict[str, Any]:
    """
    Identify a plant image with Pl@ntNet and return observation-ready taxonomy.

    The returned dictionary intentionally uses the same key names expected by
    the backend ObservationCreate schema for taxonomy and ML confidence fields.
    Any failure returns safe fallback values rather than raising into callers.
    """

    fallback = UNKNOWN_TAXONOMY.copy()

    try:
        assert isinstance(image_bytes, bytes), "image_bytes must be bytes"
        assert image_bytes, "image_bytes cannot be empty"

        if not PLANTNET_API_KEY:
            fallback["enrichment_error"] = "Missing PLANTNET_API_KEY environment variable."
            return fallback

        response_payload = _call_plantnet_api(image_bytes)
        top_match = _extract_top_match(response_payload)

        if top_match is None:
            fallback["enrichment_error"] = "Pl@ntNet returned no identifiable plant candidates."
            return fallback

        taxonomy = _build_taxonomy_profile(top_match)
        taxonomy["enrichment_status"] = "enriched"
        taxonomy["enrichment_error"] = None
        return taxonomy

    except requests.exceptions.Timeout:
        fallback["enrichment_error"] = "Pl@ntNet request timed out."
    except requests.exceptions.ConnectionError:
        fallback["enrichment_error"] = "Could not connect to Pl@ntNet."
    except requests.exceptions.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else "unknown"
        fallback["enrichment_error"] = f"Pl@ntNet HTTP error: {status_code}."
    except requests.exceptions.RequestException as exc:
        fallback["enrichment_error"] = f"Pl@ntNet request failed: {exc}."
    except AssertionError as exc:
        fallback["enrichment_error"] = str(exc)
    except (KeyError, TypeError, ValueError) as exc:
        fallback["enrichment_error"] = f"Unexpected Pl@ntNet response shape: {exc}."
    except Exception as exc:
        fallback["enrichment_error"] = f"Unexpected enrichment failure: {exc}."

    return fallback


def _call_plantnet_api(image_bytes: bytes) -> Dict[str, Any]:
    """
    Submit multipart image bytes to Pl@ntNet.

    Pl@ntNet expects the API key as a URL query string parameter and image data
    as multipart form-data. The organ hint improves matching while remaining a
    safe default for field images where the exact plant organ may vary.
    """

    params = {"api-key": PLANTNET_API_KEY}
    files = {
        "images": (
            "field_observation.jpg",
            image_bytes,
            "image/jpeg",
        )
    }
    data = {"organs": "auto"}

    response = requests.post(
        PLANTNET_IDENTIFY_URL,
        params=params,
        files=files,
        data=data,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()


def _extract_top_match(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Return the highest scoring Pl@ntNet candidate from a response payload."""

    results = payload.get("results")
    if not isinstance(results, list) or not results:
        return None

    return max(results, key=lambda candidate: float(candidate.get("score") or 0.0))


def _build_taxonomy_profile(top_match: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert Pl@ntNet's top candidate into the project's 8-rank taxonomy profile.

    Pl@ntNet commonly returns family and genus beneath the species object. Some
    response variants include order/class fields; this parser attempts those
    first and falls back to stable Darwin Core-compatible defaults.
    """

    species = top_match.get("species") or {}
    genus = species.get("genus") or {}
    family = species.get("family") or {}
    order = species.get("order") or {}
    plant_class = species.get("class") or {}
    score = float(top_match.get("score") or 0.0)

    return {
        "category": "Flora",
        "kingdom": "Plantae",
        "phylum": "Tracheophyta",
        "class": _taxon_name(plant_class, default="Magnoliopsida"),
        "order": _taxon_name(order, default="Unknown"),
        "family": _taxon_name(family, default="Unknown"),
        "genus": _taxon_name(genus, default="Unknown"),
        "species": _species_name(species),
        "annotation_confidence_score": _scale_confidence_to_five(score),
        "plantnet_score": score,
    }


def _taxon_name(taxon: Any, default: str) -> str:
    """Extract a scientific taxon name from common Pl@ntNet object shapes."""

    if isinstance(taxon, dict):
        return (
            taxon.get("scientificNameWithoutAuthor")
            or taxon.get("scientificName")
            or taxon.get("name")
            or default
        )

    if isinstance(taxon, str) and taxon.strip():
        return taxon.strip()

    return default


def _species_name(species: Dict[str, Any]) -> str:
    """Extract species scientific name with safe Unknown fallback."""

    return (
        species.get("scientificNameWithoutAuthor")
        or species.get("scientificName")
        or species.get("name")
        or "Unknown"
    )


def _scale_confidence_to_five(score: float) -> int:
    """
    Convert Pl@ntNet's 0.0-1.0 score into the proposal's 1-5 integer scale.

    The lower bound remains 1 so uncertain or fallback records still satisfy the
    backend schema while clearly signaling low annotation confidence.
    """

    bounded_score = max(0.0, min(1.0, score))
    return max(1, min(5, round(bounded_score * 5)))


if __name__ == "__main__":
    print(
        "enrich_pipeline.py is a reusable module. Import enrich_plant_image() "
        "and pass raw image bytes from your FastAPI or batch workflow."
    )
