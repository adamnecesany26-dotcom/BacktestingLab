"""Fáze 6 — API stav artefaktů (bez celého buildu)."""

from app.services.artifact_api_service import artifact_status_payload


def test_artifact_status_missing_data_file():
    out = artifact_status_payload(data_file="___not_a_valid___/file.parquet", years=1.0)
    assert out.get("ok") is False
    assert out.get("overall") == "error"
