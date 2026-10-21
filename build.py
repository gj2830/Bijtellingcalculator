"""Maakt de twee te verspreiden bestanden, elk één zelfstandige HTML zonder externe bestanden:

  bijtelling-kenteken.html       (uit src/kenteken.html)
  bijtelling-excelcontrole.html  (uit src/controle.html)

Ingevoegd worden: <!-- deel: x.html -->, <link rel="stylesheet" href="x.css"> en <script src="x.js"></script>
(ook SheetJS uit src/vendor/). De bronbestanden in src/ zijn niet bedoeld om los te verspreiden.
"""
import re
from pathlib import Path

root = Path(__file__).parent
src = root / "src"
PAGINAS = {"kenteken.html": "bijtelling-kenteken.html", "controle.html": "bijtelling-excelcontrole.html"}


def lees(naam):
    return (src / naam).read_text(encoding="utf-8")


def bouw(bron):
    html = lees(bron)
    html = re.sub(r"<!-- deel: (\S+) -->", lambda m: lees(m.group(1)).strip(), html)
    html = re.sub(r'<link rel="stylesheet" href="([^":]+)">', lambda m: f"<style>\n{lees(m.group(1))}</style>", html)
    # Lambda als vervanging, zodat backslashes in de scripts niet als regex-escapes worden gelezen.
    html = re.sub(r'<script src="([^":]+)"></script>', lambda m: f"<script>\n{lees(m.group(1))}\n</script>", html)
    rest = re.findall(r'(?:src|href)="(?!https?:|#)[^"]+\.(?:js|css|html)"', html)
    assert not rest, f"niet ingevoegd in {bron}: {rest}"
    assert html.count("<style>") == 1, f"opmaak ontbreekt in {bron}"
    return html


for bron, doel in PAGINAS.items():
    (root / doel).write_text(bouw(bron), encoding="utf-8")
    print(f"{doel} bijgewerkt")
