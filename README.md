# Bijtellingcalculator

Twee losse HTML-bestanden die de bijtelling voor een auto van de zaak bepalen met gegevens van
[RDW Open Data](https://opendata.rdw.nl):

- **`bijtelling-kenteken.html`** – bijtelling voor één kenteken en één maand, met kopieerknop (opgemaakt voor Word/Outlook).
- **`bijtelling-excelcontrole.html`** – controleert een Excel-lijst met auto's van de zaak en levert een Excel met de bevindingen.

Online te gebruiken via GitHub Pages:
[kentekencheck](https://gj2830.github.io/Bijtellingcalculator/bijtelling-kenteken.html) en
[Excel-controle](https://gj2830.github.io/Bijtellingcalculator/bijtelling-excelcontrole.html).

Alleen deze twee bestanden verspreiden. Ze werken zelfstandig: dubbelklikken om te openen in de browser, geen installatie nodig.
De bestanden in `src/` zijn bronbestanden en werken niet los.
Wel is internet nodig voor de RDW-gegevens.

Privacy: het Excel-bestand wordt alleen in de browser gelezen. Alleen de kentekens worden naar RDW Open Data gestuurd.

## Bouwen

De twee bestanden worden gemaakt uit de bronbestanden in `src/`:

```bash
python build.py
```

Voor ontwikkelen kun je ook een lokale server starten (`python -m http.server 8765`) en `src/kenteken.html` of
`src/controle.html` openen. Met `?kenteken=AB123C` in de URL van de kentekencheck wordt direct gezocht.

## Bronbestanden (`src/`)

- `tarieven.js` – bijtellingspercentages en caps per jaar en categorie, regel voor auto's van vóór 2017, youngtimerregel. **Hier nieuwe jaren toevoegen.**
- `rekenen.js` – gedeeld: RDW-koppeling, berekening en hulpfuncties.
- `kenteken.js`, `kenteken.html` – kentekencheck.
- `controle.js`, `controle.html` – Excel-controle.
- `uitleg.html` – gedeelde uitleg en tarieventabel, door `build.py` in beide pagina's ingevoegd.
- `style.css` – opmaak.
- `vendor/xlsx.full.min.js` – [SheetJS](https://sheetjs.com) 0.18.5 (Apache 2.0) voor het lezen/schrijven van Excel.

## Rekenregels

- Gegevens uit RDW-datasets *Gekentekende voertuigen* (`m9d7-ebf2`: catalogusprijs, datum eerste toelating, datum eerste tenaamstelling in Nederland) en *Brandstof* (`8ys7-d773`).
- Categorie: alleen Elektriciteit → elektrisch; Waterstof → waterstof (geen cap); anders standaard (22%). Handmatig te overschrijven.
- Gedurende 60 maanden, gerekend vanaf de eerste dag van de maand na de datum eerste toelating, gelden de regels van het jaar van eerste toelating. Daarna gelden steeds de regels van het lopende kalenderjaar (art. 13bis Wet LB 1964).
- Datum eerste toelating t/m 31-12-2016: standaardpercentage blijft onbeperkt 25% (art. 36c Wet LB). De nulemissiekorting hangt af van de datum eerste tenaamstelling in NL: 60 maanden vanaf de 1e van de maand daarna de korting van dat jaar, daarna die van het lopende jaar (Handboek Loonheffingen 2026, par. 23.3.4).
- Youngtimer: 35% van de waarde in het economisch verkeer (handmatig invullen). Grens t/m 2025 meer dan 15 jaar, vanaf 2026 meer dan 16 jaar; een auto die op 31 december 2025 al ouder was dan 15 jaar blijft youngtimer.
- Excel-controle: in *% Bijtelling* tellen alleen de getallen (met % = percentage, vanaf 10.000 = cap); de daaruit berekende bijtelling wordt vergeleken met de verwachte bijtelling.
