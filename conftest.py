"""Fixture condivise: il workbook si genera una volta sola per tutta la sessione."""

import subprocess
import sys
from pathlib import Path

import pytest
from openpyxl import load_workbook

ANNO = 2026
RADICE = Path(__file__).parent


@pytest.fixture(scope="session")
def wb(tmp_path_factory):
    """Genera il workbook in una cartella temporanea e lo rilegge con le formule."""
    out = tmp_path_factory.mktemp("xlsx") / "Presenze_test.xlsx"
    subprocess.run(
        [sys.executable, "genera_presenze.py", str(ANNO), str(out)],
        cwd=RADICE, check=True, capture_output=True,
    )
    return load_workbook(out)
