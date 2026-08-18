"""A PNG carrying a known string, built at test time test 2.

**Generated rather than committed as a fixture.** The acceptance test asserts
that a string visible ONLY in an image reaches the reformulated query, so the
string has to be chosen by the test. A checked-in screenshot fixes it forever,
and the day somebody wants to prove the same property for a different string
they add a second binary to the repo.

**Via `pdftoppm`, because there is no imaging library here.** Neither Pillow nor
ImageMagick is a dependency, and adding one to draw four words would be a real
dependency for a test helper. Poppler is already required — the OCR path
rasterises with exactly this binary — so a hand-written PDF rendered through it
costs nothing new.

The PDF is assembled by hand rather than with a PDF library, for the same
reason: it is five objects and an xref table, and it is the only thing here that
would need the library.
"""

from __future__ import annotations

import pathlib
import shutil
import subprocess
import tempfile

#: Enough to read at a glance, and enough for a model to read too. Verified by
#: running tesseract over the output — an image that no OCR can read would make
#: a failing acceptance test say "the model cannot see" when what it means is
#: "the fixture is illegible".
_POINT_SIZE = 36
_RENDER_DPI = 110


def poppler_available() -> bool:
    """Whether `pdftoppm` is on PATH, for skipping rather than failing."""
    return shutil.which("pdftoppm") is not None


def pdf_showing(text: str) -> bytes:
    """A one-page PDF whose only content is `text`, in Helvetica."""
    stream = f"BT /F1 {_POINT_SIZE} Tf 40 300 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 400] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"

    start_xref = len(out)
    out += b"xref\n0 %d\n" % (len(objects) + 1)
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % (
        len(objects) + 1,
        start_xref,
    )

    return bytes(out)


def png_showing(text: str) -> bytes:
    """A PNG whose only content is `text` — the screenshot a user would paste."""
    with tempfile.TemporaryDirectory() as directory:
        path = pathlib.Path(directory)
        (path / "in.pdf").write_bytes(pdf_showing(text))

        subprocess.run(
            [
                "pdftoppm",
                "-png",
                "-r",
                str(_RENDER_DPI),
                "-singlefile",
                str(path / "in.pdf"),
                str(path / "out"),
            ],
            check=True,
            capture_output=True,
        )

        return (path / "out.png").read_bytes()
