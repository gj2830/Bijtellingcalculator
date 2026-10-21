// Gedeeld rekenwerk: RDW-koppeling, bijtellingsregels en hulpfuncties.
// Wordt gebruikt door de kentekencheck (kenteken.js) en de Excel-controle (controle.js).

const RDW_VOERTUIGEN = "https://opendata.rdw.nl/resource/m9d7-ebf2.json";
const RDW_BRANDSTOF = "https://opendata.rdw.nl/resource/8ys7-d773.json";

const euro = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
const euroHeel = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const datumFmt = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric" });
const maandFmt = new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric" });

const $ = (id) => document.getElementById(id);


// ---------- RDW ----------

function normaliseerKenteken(invoer) {
  return invoer.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function haalVoertuigOp(kenteken) {
  return (await haalVoertuigenOp([kenteken])).get(kenteken) ?? null;
}

// Haalt kentekens in blokken op; geeft een Map kenteken → voertuig (onbekende kentekens ontbreken).
async function haalVoertuigenOp(kentekens, voortgang) {
  const uniek = [...new Set(kentekens)].filter(Boolean);
  const resultaat = new Map();
  const BLOK = 100;

  for (let i = 0; i < uniek.length; i += BLOK) {
    const deel = uniek.slice(i, i + BLOK);
    const query = `?$limit=5000&$where=${encodeURIComponent(`kenteken in(${deel.map((k) => `'${k}'`).join(",")})`)}`;
    const [voertuigen, brandstoffen] = await Promise.all([
      fetch(RDW_VOERTUIGEN + query).then(controleerResponse),
      fetch(RDW_BRANDSTOF + query).then(controleerResponse),
    ]);
    for (const v of voertuigen) {
      const eigen = brandstoffen
        .filter((b) => b.kenteken === v.kenteken)
        .sort((a, b) => Number(a.brandstof_volgnummer) - Number(b.brandstof_volgnummer));
      resultaat.set(v.kenteken, {
        kenteken: v.kenteken,
        merk: v.merk,
        model: v.handelsbenaming,
        voertuigsoort: v.voertuigsoort,
        eersteToelating: parseRdwDatum(v.datum_eerste_toelating),
        eersteTenaamstellingNL: parseRdwDatum(v.datum_eerste_tenaamstelling_in_nederland),
        catalogusprijs: v.catalogusprijs ? Number(v.catalogusprijs) : null,
        brandstoffen: eigen.map((b) => b.brandstof_omschrijving),
      });
    }
    voortgang?.(Math.min(i + BLOK, uniek.length), uniek.length);
  }
  return resultaat;
}

async function controleerResponse(res) {
  if (!res.ok) throw new Error(`RDW gaf foutcode ${res.status}`);
  return res.json();
}

function parseRdwDatum(s) {
  if (!s || !/^\d{8}$/.test(s)) return null;
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
}

function bepaalCategorie(brandstoffen) {
  if (brandstoffen.length === 0) return "standaard";
  const set = new Set(brandstoffen.map((b) => b.toLowerCase()));
  const alleenZeroEmissie = [...set].every((b) => b === "elektriciteit" || b === "waterstof");
  if (!alleenZeroEmissie) return "standaard";
  return set.has("waterstof") ? "waterstof" : "elektrisch";
}

// ---------- Berekening ----------

function maandenTussen(van, tot) {
  return (tot.getFullYear() - van.getFullYear()) * 12 + (tot.getMonth() - van.getMonth());
}

function plusMaanden(datum, n) {
  return new Date(datum.getFullYear(), datum.getMonth() + n, 1);
}

function tarievenVoorJaar(jaar) {
  const jaren = Object.keys(BIJTELLING_TARIEVEN).map(Number).sort((a, b) => a - b);
  const eerste = jaren[0];
  const laatste = jaren[jaren.length - 1];
  const gebruikt = Math.min(Math.max(jaar, eerste), laatste);
  return { jaar: gebruikt, tarief: BIJTELLING_TARIEVEN[gebruikt], buitenTabel: jaar !== gebruikt };
}

// Gedurende 60 maanden, te rekenen vanaf de eerste dag van de maand na de peildatum, gelden de
// regels van het jaar van de peildatum. Daarna gelden steeds de regels van het lopende kalenderjaar;
// er start geen nieuwe vaste termijn. Peildatum = datum eerste toelating; bij een eerste toelating
// vóór 2017 de datum eerste tenaamstelling in Nederland (Handboek Loonheffingen 2026, par. 23.3.4).
function bepaalTermijn(peildatum, maand) {
  const start = new Date(peildatum.getFullYear(), peildatum.getMonth() + 1, 1);
  const eind = plusMaanden(start, PERIODE_MAANDEN); // eerste maand na de termijn
  const binnenTermijn = maand < eind;
  return { start, eind, binnenTermijn, peiljaar: binnenTermijn ? peildatum.getFullYear() : maand.getFullYear() };
}

function youngtimerGrens(jaar) {
  const jaren = Object.keys(YOUNGTIMER.leeftijdVanaf).map(Number).filter((j) => j <= jaar);
  return jaren.length ? YOUNGTIMER.leeftijdVanaf[Math.max(...jaren)] : null;
}

// Ouder dan de grens van dat jaar, of op 31 december van het jaar ervoor al youngtimer (overgangsregel).
function isYoungtimer(eersteToelating, datum) {
  const grens = youngtimerGrens(datum.getFullYear());
  if (grens == null) return false;
  const verjaardag = new Date(eersteToelating.getFullYear() + grens, eersteToelating.getMonth(), eersteToelating.getDate());
  return datum > verjaardag || isYoungtimer(eersteToelating, new Date(datum.getFullYear() - 1, 11, 31));
}

/**
 * Berekent de bijtelling voor één kalendermaand.
 * Geeft regels (opbouw), totalen en toelichtingen terug.
 */
function berekenBijtelling({ eersteToelating, eersteTenaamstelling, maand, catalogusprijs, categorie, dagwaarde }) {
  const toelichting = [];
  const waarschuwingen = [];
  const regels = [];

  if (isYoungtimer(eersteToelating, maand)) {
    const basis = dagwaarde ?? 0;
    const jaar = basis * YOUNGTIMER.pct / 100;
    const grens = youngtimerGrens(maand.getFullYear());
    regels.push({ omschrijving: `${YOUNGTIMER.pct}% van waarde in het economisch verkeer (${euroHeel.format(basis)})`, jaar });
    toelichting.push(`Youngtimer: de bijtelling wordt berekend over de dagwaarde, niet over de catalogusprijs.`);
    const verjaardag = new Date(eersteToelating.getFullYear() + grens, eersteToelating.getMonth(), eersteToelating.getDate());
    if (!(maand > verjaardag)) {
      waarschuwingen.push(`De auto is nog geen ${grens} jaar oud; de youngtimerregeling geldt via de overgangsregel, alleen als de auto vorig jaar al ter beschikking stond.`);
    }
    if (!dagwaarde) waarschuwingen.push("Vul de waarde in het economisch verkeer (dagwaarde) in.");
    return afronden({ regels, toelichting, waarschuwingen, youngtimer: true, pct: YOUNGTIMER.pct, cap: null, basis });
  }

  // Auto van vóór 2017: de termijn loopt vanaf de eerste tenaamstelling in Nederland (bij import later).
  const oud = eersteToelating <= OUD_REGIME.totEnMet;
  const peildatum = oud && eersteTenaamstelling ? eersteTenaamstelling : eersteToelating;
  const peildatumNaam = peildatum === eersteToelating ? "eerste toelating" : "eerste tenaamstelling in Nederland";
  if (oud && !eersteTenaamstelling && categorie !== "standaard") {
    waarschuwingen.push("Geen datum eerste tenaamstelling bekend; bij een auto van vóór 2017 bepaalt die de termijn. Eerste toelating gebruikt.");
  }
  const termijn = bepaalTermijn(peildatum, maand);
  const { jaar: tabelJaar, tarief: tabelTarief, buitenTabel } = tarievenVoorJaar(termijn.peiljaar);
  if (buitenTabel) {
    waarschuwingen.push(`Geen tarieven voor ${termijn.peiljaar} vastgelegd; tarieven van ${tabelJaar} gebruikt. Vul de tarieventabel aan.`);
  }
  let tarief = tabelTarief;
  if (oud) {
    tarief = oudRegime(tabelTarief);
    toelichting.push(
      `Eerste toelating vóór 2017: standaardpercentage ${OUD_REGIME.standaard}% (art. 36c Wet LB)` +
        (categorie === "standaard" ? "." : "; de korting voor nulemissie gaat daarvan af.")
    );
  }

  const prijs = catalogusprijs ?? 0;
  // pct = het (verlaagde) percentage dat van toepassing is; boven de cap geldt het standaardpercentage.
  const { pct, cap } = categorie === "standaard" ? { pct: tarief.standaard, cap: null } : tarief[categorie];
  if (categorie === "standaard") {
    regels.push({ omschrijving: `${tarief.standaard}% over ${euroHeel.format(prijs)}`, jaar: prijs * tarief.standaard / 100 });
  } else {
    const laag = cap == null ? prijs : Math.min(prijs, cap);
    const hoog = prijs - laag;
    regels.push({ omschrijving: `${pct}% over ${euroHeel.format(laag)}${cap != null ? ` (cap ${euroHeel.format(cap)})` : ""}`, jaar: laag * pct / 100 });
    if (hoog > 0) {
      regels.push({ omschrijving: `${tarief.standaard}% over het meerdere (${euroHeel.format(hoog)})`, jaar: hoog * tarief.standaard / 100 });
    }
  }

  // De 60-maandstermijn gaat alleen over de korting voor nulemissie; bij brandstof/hybride speelt hij geen rol.
  const eindLaatsteMaand = new Date(termijn.eind.getFullYear(), termijn.eind.getMonth(), 0);
  if (categorie === "standaard") {
    toelichting.push("Brandstofauto of hybride: geen korting, dus de 60-maandstermijn speelt geen rol.");
  } else if (termijn.binnenTermijn) {
    toelichting.push(
      `Binnen de 60-maandstermijn (${maandFmt.format(termijn.start)} t/m ${maandFmt.format(eindLaatsteMaand)}): de regels van ${termijn.peiljaar}, het jaar van ${peildatumNaam}, gelden.`
    );
  } else {
    toelichting.push(
      `De 60-maandstermijn is verstreken (${maandFmt.format(eindLaatsteMaand)}): de regels van het lopende jaar ${termijn.peiljaar} gelden. Deze kunnen elk jaar wijzigen.`
    );
  }
  if (!catalogusprijs) waarschuwingen.push("Geen catalogusprijs bekend bij de RDW; vul deze handmatig in.");

  return afronden({ regels, toelichting, waarschuwingen, termijn, youngtimer: false, pct, cap, standaard: tarief.standaard, basis: prijs });
}

// Tarieven voor een auto van vóór 2017: hoger standaardpercentage, dezelfde korting en cap.
function oudRegime(t) {
  const verschuif = ({ pct, cap }) => ({ pct: OUD_REGIME.standaard - (t.standaard - pct), cap });
  return { standaard: OUD_REGIME.standaard, elektrisch: verschuif(t.elektrisch), waterstof: verschuif(t.waterstof) };
}

function afronden({ regels, ...rest }) {
  const perJaar = regels.reduce((s, r) => s + r.jaar, 0);
  return { regels, perJaar, perMaand: perJaar / 12, ...rest };
}

// ---------- Hulpfuncties ----------

// Kenteken met streepjes: splits op overgangen letter/cijfer, groepen van 4 in 2+2.
function formatteerKenteken(k) {
  return (k.match(/[A-Z]+|\d+/g) ?? [k])
    .flatMap((g) => (g.length === 4 ? [g.slice(0, 2), g.slice(2)] : [g]))
    .join("-");
}

function numOfNull(v) {
  return v === "" || v == null ? null : Number(v);
}

function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function toonTarieventabel() {
  const kop = `<tr><th>Peiljaar</th><th class="num">Standaard</th><th class="num">Elektrisch</th><th class="num">Cap</th><th class="num">Waterstof/zon</th></tr>`;
  const rijen = Object.entries(BIJTELLING_TARIEVEN).map(([jaar, t]) => {
    const cap = (c) => (c == null ? "–" : euroHeel.format(c));
    return `<tr><td>${jaar}</td><td class="num">${t.standaard}%</td><td class="num">${t.elektrisch.pct}%</td>` +
      `<td class="num">${cap(t.elektrisch.cap)}</td><td class="num">${t.waterstof.pct}%${t.waterstof.cap ? ` (cap ${cap(t.waterstof.cap)})` : ""}</td></tr>`;
  });
  $("tarieventabel").innerHTML = kop + rijen.join("");
}
