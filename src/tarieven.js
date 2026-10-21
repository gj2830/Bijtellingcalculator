// Bijtellingspercentages per jaar en categorie.
//
// Het jaar is het "peiljaar": het jaar van de datum eerste toelating, of — na afloop
// van een periode van 60 maanden — het jaar waarin de nieuwe periode begint.
//
// Categorieën:
//   standaard   – alle auto's met uitstoot (benzine, diesel, hybride, plug-in hybride, LPG, ...)
//   elektrisch  – volledig elektrisch (geen CO2-uitstoot); verlaagd tarief tot de cap
//   waterstof   – waterstof- en zonnecelauto's; vanaf 2020 geen cap
//
// cap = maximale cataloguswaarde waarover het verlaagde percentage geldt (null = geen cap).
// Over het deel boven de cap geldt het standaardpercentage.
//
// Controleer nieuwe jaren altijd bij de Belastingdienst (tabel bijtelling auto van de zaak).
const BIJTELLING_TARIEVEN = {
  2017: { standaard: 22, elektrisch: { pct: 4, cap: null }, waterstof: { pct: 4, cap: null } },
  2018: { standaard: 22, elektrisch: { pct: 4, cap: null }, waterstof: { pct: 4, cap: null } },
  2019: { standaard: 22, elektrisch: { pct: 4, cap: 50000 }, waterstof: { pct: 4, cap: 50000 } },
  2020: { standaard: 22, elektrisch: { pct: 8, cap: 45000 }, waterstof: { pct: 8, cap: null } },
  2021: { standaard: 22, elektrisch: { pct: 12, cap: 40000 }, waterstof: { pct: 12, cap: null } },
  2022: { standaard: 22, elektrisch: { pct: 16, cap: 35000 }, waterstof: { pct: 16, cap: null } },
  2023: { standaard: 22, elektrisch: { pct: 16, cap: 30000 }, waterstof: { pct: 16, cap: null } },
  2024: { standaard: 22, elektrisch: { pct: 16, cap: 30000 }, waterstof: { pct: 16, cap: null } },
  2025: { standaard: 22, elektrisch: { pct: 17, cap: 30000 }, waterstof: { pct: 17, cap: null } },
  2026: { standaard: 22, elektrisch: { pct: 18, cap: 30000 }, waterstof: { pct: 18, cap: null } },
  2027: { standaard: 22, elektrisch: { pct: 20, cap: 30000 }, waterstof: { pct: 20, cap: null } },
  2028: { standaard: 22, elektrisch: { pct: 22, cap: null }, waterstof: { pct: 22, cap: null } },
};

// Art. 36c Wet LB: auto's met een datum eerste toelating t/m 31-12-2016 houden onbeperkt 25% als
// standaardpercentage. Een korting voor nulemissieauto's (standaard min verlaagd percentage, tot de cap)
// gaat daar vanaf. Youngtimers vallen hier niet onder.
const OUD_REGIME = { totEnMet: new Date(2016, 11, 31), standaard: 25 };

// Youngtimers:bijtelling over de waarde in het economisch verkeer.
// leeftijdVanaf = leeftijdsgrens ("meer dan X jaar geleden in gebruik genomen") vanaf dat jaar.
// Overgangsregel: een auto die op 31 december van het voorgaande jaar al youngtimer was, blijft dat.
const YOUNGTIMER = { pct: 35, leeftijdVanaf: { 2017: 15, 2026: 16 } };

// Termijn waarin de regels van het jaar van eerste toelating blijven gelden (art. 13bis Wet LB).
// Daarna gelden steeds de regels van het lopende kalenderjaar.
const PERIODE_MAANDEN = 60;
