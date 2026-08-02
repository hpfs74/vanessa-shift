"""Shared fixtures: the workbook is generated once for the whole session."""

import subprocess
import sys
from pathlib import Path

import pytest
from openpyxl import load_workbook

YEAR = 2026
ROOT = Path(__file__).parent


@pytest.fixture(scope="session")
def wb(tmp_path_factory):
    """Generates the workbook in a temp folder and reads it back with formulas."""
    out = tmp_path_factory.mktemp("xlsx") / "Presenze_test.xlsx"
    subprocess.run(
        [sys.executable, "generate_rota.py", str(YEAR), str(out)],
        cwd=ROOT, check=True, capture_output=True,
    )
    return load_workbook(out)
