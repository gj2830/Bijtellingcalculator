// Controle van een Excel-lijst met auto's van de zaak tegen de RDW en de bijtellingsregels.
// Gebruikt SheetJS (XLSX) voor het lezen en schrijven van Excel-bestanden.

// Kolomkoppen in de Excel-lijst (genormaliseerd: kleine letters, alleen letters en cijfers).
const KOLOMMEN = {
  werknemer: "werknemer",
  naam: "naam",
  werkgever: "naamwerkgever",
  kenteken: "kenteken",
  startDatum: "startdatum",
  einddatum: "einddatum",
  afgifteNL: "afgiftenl",
  eersteToelating: "1etoelating",
  catalogus: "cataloguswaarde",
  pct: "bijtelling", // "% Bijtelling"
  redenGeen: "redengeenbijtelling",
  brandstof: "brandstof",
  brandstof2: "brandstof2",
};

const NIVEAUS = { fout: 3, "let op": 2, info: 1 };

// Waarschuw als de 60-maandstermijn binnen zoveel maanden na de controlemaand afloopt.
const VOORUITKIJKEN_MAANDEN = 3;

let controleRijen = null; // { kop, index, rijen, resultaten, bestandsnaam, werkboek }

const normaliseerKop = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// ---------- Inlezen ----------

function leesWerkboek(buffer) {
  const wb = XLSX.read(buffer, { type: "array", cellNF: true, cellStyles: true });
  const blad = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(blad, { header: 1, raw: true, defval: null });

  // Kopregel = de eerste regel met minstens 3 bekende kolomnamen.
  const bekend = new Set(Object.values(KOLOMMEN));
  const kopIndex = data.findIndex((rij) => rij.filter((c) => bekend.has(normaliseerKop(c))).length >= 3);
  if (kopIndex < 0) throw new Error("Geen kopregel gevonden (verwacht o.a. Kenteken, 1e Toelating, Cataloguswaarde, % Bijtelling).");

  const kop = data[kopIndex].map((c) => (c == null ? "" : String(c)));
  const genormaliseerd = kop.map(normaliseerKop);
  const index = {};
  for (const [sleutel, naam] of Object.entries(KOLOMMEN)) {
    const i = genormaliseerd.indexOf(naam);
    if (i >= 0) index[sleutel] = i;
  }

  // Bewaar per rij het regelnummer in het werkblad, zodat de controle ernaast kan worden gezet.
  const rijen = [];
  data.slice(kopIndex + 1).forEach((rij, i) => {
    if (rij.some((c) => c != null && c !== "")) rijen.push(Object.assign(rij, { bladRij: kopIndex + 1 + i }));
  });

  // Geen kolom "Kenteken"? Neem de kolom waarin de meeste waarden op een kenteken lijken.
  if (index.kenteken == null) {
    const lijktOpKenteken = (c) => c != null && /^[A-Z0-9]{1,3}-[A-Z0-9]{1,3}-[A-Z0-9]{1,3}$|^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{6}$/i.test(String(c).trim());
    const scores = kop.map((_, k) => rijen.filter((r) => lijktOpKenteken(r[k])).length);
    const beste = scores.indexOf(Math.max(...scores));
    if (scores[beste] === 0) throw new Error("Geen kolom met kentekens gevonden.");
    index.kenteken = beste;
  }
  return { kop, index, rijen, werkboek: wb, blad, kopIndex };
}

// Excel-datum (serieel getal), jjjjmmdd, dd-mm-jjjj, jjjj-mm-dd of Date → lokale Date.
function parseDatum(w) {
  if (w == null || w === "") return null;
  if (w instanceof Date) return new Date(w.getFullYear(), w.getMonth(), w.getDate());
  if (typeof w === "number") {
    if (w > 19000000 && w < 21000000) return parseRdwDatum(String(w));
    if (w > 1 && w < 100000) {
      const d = XLSX.SSF.parse_date_code(w);
      return new Date(d.y, d.m - 1, d.d);
    }
    return null;
  }
  const s = String(w).trim();
  let m;
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) return new Date(+m[3], +m[2] - 1, +m[1]);
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return new Date(+m[1], +m[2] - 1, +m[3]);
  if (/^\d{8}$/.test(s)) return parseRdwDatum(s);
  return null;
}

function parseGetal(w) {
  if (w == null || w === "") return null;
  if (typeof w === "number") return w;
  const s = String(w).replace(/[€%\s]/g, "");
  // Nederlandse notatie: "58.349" en "1.234,50"; punten zijn dan duizendtallen.
  const nl = s.includes(",") || /^-?\d{1,3}(\.\d{3})+$/.test(s);
  const n = Number(nl ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}

// 0,22 en 22 betekenen allebei 22%.
function parsePercentage(w) {
  const n = parseGetal(w);
  if (n == null) return null;
  return typeof w === "number" && n > 0 && n <= 1 ? n * 100 : n;
}

const YOUNGTIMER_TEKST = /jaar en ouder|youngtimer/i;

// "% Bijtelling" uit de export. Alleen de getallen tellen, de formulering niet:
// getallen met % zijn percentages, overige getallen vanaf 10.000 zijn het capbedrag (jaartallen tellen dus niet mee). Bijv.:
//   "22,00% / 22%"                              → 22%
//   "17% tot en met 30000, 22% vanaf 30000"     → 17% en 22%, cap 30.000
//   "Auto s 15 jaar en ouder (35%)"             → youngtimer, 35%
// Een regel met de youngtimertekst (of alleen 35%) wordt apart gehouden.
// Geeft { regime, youngtimer }: elk { pcts, bedragen } of null.
function parseBijtellingCel(w) {
  if (w == null || w === "") return null;
  if (typeof w === "number") return { regime: { pcts: [parsePercentage(w)], bedragen: [] }, youngtimer: null };
  const regels = String(w).split(/\r?\n/).map((r) => r.replace(/"/g, "").trim()).filter(Boolean).map(leesGetallen);
  const isYoungtimer = (r) => YOUNGTIMER_TEKST.test(r.tekst) || (r.pcts.length === 1 && r.pcts[0] === YOUNGTIMER.pct);
  const samen = (lijst) => (lijst.length ? { pcts: uniek(lijst.flatMap((r) => r.pcts)), bedragen: uniek(lijst.flatMap((r) => r.bedragen)) } : null);
  return { regime: samen(regels.filter((r) => !isYoungtimer(r))), youngtimer: samen(regels.filter(isYoungtimer)) };
}

function leesGetallen(tekst) {
  const pcts = [];
  const bedragen = [];
  for (const [, getal, procent] of tekst.matchAll(/(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(%)?/g)) {
    const n = parseGetal(getal);
    if (procent) pcts.push(n);
    else if (n >= 10000) bedragen.push(n);
  }
  return { tekst, pcts: uniek(pcts), bedragen: uniek(bedragen) };
}

const uniek = (getallen) => [...new Set(getallen.map((n) => Math.round(n * 100) / 100))];

// Bijtelling per jaar volgens de getallen in de cel: zonder bedrag één percentage over alles;
// met bedrag het laagste percentage tot dat bedrag en het hoogste daarboven.
function bijtellingVolgensCel({ pcts, bedragen }, basis) {
  if (pcts.length === 0) return null;
  if (bedragen.length === 0) return pcts.length === 1 ? (basis * pcts[0]) / 100 : null;
  const cap = Math.min(...bedragen);
  const laag = Math.min(...pcts);
  const hoog = Math.max(...pcts);
  return (Math.min(basis, cap) * laag + Math.max(0, basis - cap) * hoog) / 100;
}

const getalTekst = (n) => Number(n.toFixed(2)).toLocaleString("nl-NL");

// Bijv. "16% t/m € 30.000, 22% daarboven" of "22%".
function regimeTekst({ pct, cap, boven }) {
  return cap == null ? `${getalTekst(pct)}%` : `${getalTekst(pct)}% t/m ${euroHeel.format(cap)}, ${getalTekst(boven)}% daarboven`;
}

// "Nvt", "-", "0" e.d. in Reden geen bijtelling betekenen: er is wél bijtelling.
const isLeeg = (w) => w == null || /^\s*(nvt|n\.v\.t\.?|-|0|geen)?\s*$/i.test(String(w));

function categorieUitTekst(brandstof, brandstof2) {
  const lijst = [brandstof, brandstof2].filter((b) => b != null && String(b).trim() !== "").map(String);
  if (lijst.length === 0) return null;
  return bepaalCategorie(lijst.map((b) => (/elektr/i.test(b) ? "Elektriciteit" : /waterstof/i.test(b) ? "Waterstof" : b)));
}

// ---------- Controle per rij ----------

function zelfdeDag(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const kortDatum = (d) => (d ? d.toLocaleDateString("nl-NL") : "–");

function controleerRij(rij, index, rdwMap, controleMaand) {
  const cel = (sleutel) => (index[sleutel] == null ? null : rij[index[sleutel]]);
  const bevindingen = [];
  const meld = (niveau, tekst) => bevindingen.push({ niveau, tekst });

  const kenteken = normaliseerKenteken(String(cel("kenteken") ?? ""));
  const uitkomst = { kenteken, bevindingen, maand: null, rdw: null, verwacht: null };
  if (!kenteken) {
    meld("info", "Geen kenteken ingevuld; rij overgeslagen.");
    return uitkomst;
  }

  let maand = controleMaand;
  const eindeMaand = new Date(maand.getFullYear(), maand.getMonth() + 1, 0);

  // Valt de maand buiten StartDatum/Einddatum, controleer dan de eerste/laatste maand dat de auto er wel was.
  const start = parseDatum(cel("startDatum"));
  const eind = parseDatum(cel("einddatum"));
  if (start && start > eindeMaand) {
    meld("info", `Auto pas ter beschikking vanaf ${kortDatum(start)}; gecontroleerd voor ${maandFmt.format(start)}.`);
    maand = new Date(start.getFullYear(), start.getMonth(), 1);
  } else if (eind && eind < maand) {
    meld("info", `Auto ingeleverd op ${kortDatum(eind)}; gecontroleerd voor ${maandFmt.format(eind)}.`);
    maand = new Date(eind.getFullYear(), eind.getMonth(), 1);
  }
  uitkomst.maand = maand;

  const rdw = rdwMap.get(kenteken);
  uitkomst.rdw = rdw ?? null;
  if (!rdw) {
    meld("fout", `Kenteken ${kenteken} niet gevonden bij de RDW.`);
    return uitkomst;
  }

  // Gegevens vergelijken met de RDW.
  const toelatingExcel = parseDatum(cel("eersteToelating"));
  if (!toelatingExcel) meld("fout", `1e toelating ontbreekt (RDW: ${kortDatum(rdw.eersteToelating)}).`);
  else if (!zelfdeDag(toelatingExcel, rdw.eersteToelating)) {
    meld("fout", `1e toelating ${kortDatum(toelatingExcel)} wijkt af van RDW ${kortDatum(rdw.eersteToelating)}.`);
  }

  const afgifte = parseDatum(cel("afgifteNL"));
  if (afgifte && rdw.eersteTenaamstellingNL && !zelfdeDag(afgifte, rdw.eersteTenaamstellingNL)) {
    // Bij een nulemissieauto van vóór 2017 bepaalt deze datum de termijn en dus de korting.
    const bepalend = rdw.eersteToelating && rdw.eersteToelating <= OUD_REGIME.totEnMet && bepaalCategorie(rdw.brandstoffen) !== "standaard";
    meld(bepalend ? "fout" : "let op", `Afgifte NL ${kortDatum(afgifte)} wijkt af van RDW ${kortDatum(rdw.eersteTenaamstellingNL)}${bepalend ? " (bepalend voor de korting bij een elektrische auto van vóór 2017)" : ""}.`);
  }

  // Bij een youngtimer staat in Cataloguswaarde de dagwaarde; die is niet met de RDW te vergelijken.
  const toelatingVoorLeeftijd = rdw.eersteToelating ?? toelatingExcel;
  const youngtimer = toelatingVoorLeeftijd != null && isYoungtimer(toelatingVoorLeeftijd, maand);
  const catalogusExcel = parseGetal(cel("catalogus"));
  if (youngtimer) {
    // Geen controle op de cataloguswaarde.
  } else if (catalogusExcel == null) {
    meld("fout", `Cataloguswaarde ontbreekt${rdw.catalogusprijs ? ` (RDW: ${euroHeel.format(rdw.catalogusprijs)})` : ""}.`);
  } else if (rdw.catalogusprijs && Math.abs(catalogusExcel - rdw.catalogusprijs) > 1) {
    meld("fout", `Cataloguswaarde ${euroHeel.format(catalogusExcel)} wijkt af van RDW ${euroHeel.format(rdw.catalogusprijs)}.`);
  } else if (!rdw.catalogusprijs) {
    meld("info", "RDW heeft geen catalogusprijs; cataloguswaarde uit Excel niet te controleren.");
  }

  const categorie = bepaalCategorie(rdw.brandstoffen);
  const categorieExcel = categorieUitTekst(cel("brandstof"), cel("brandstof2"));
  if (categorieExcel && categorieExcel !== categorie) {
    meld("let op", `Brandstof in Excel (${[cel("brandstof"), cel("brandstof2")].filter(Boolean).join(" + ")}) past niet bij RDW (${rdw.brandstoffen.join(" + ") || "onbekend"}).`);
  }

  const reden = cel("redenGeen");
  if (!isLeeg(reden)) {
    meld("info", `Geen bijtelling: ${reden}.`);
    return uitkomst;
  }

  // Verwachte bijtelling voor deze maand.
  const eersteToelating = rdw.eersteToelating ?? toelatingExcel;
  if (!eersteToelating) return uitkomst;
  const eersteTenaamstelling = rdw.eersteTenaamstellingNL ?? afgifte;
  const invoer = { eersteToelating, eersteTenaamstelling, catalogusprijs: catalogusExcel ?? rdw.catalogusprijs, categorie, dagwaarde: catalogusExcel };
  const r = berekenBijtelling({ ...invoer, maand });
  const standaard = r.youngtimer ? null : r.standaard;
  const verwacht = { pct: r.pct, cap: r.cap, boven: r.cap == null ? null : standaard };
  uitkomst.verwacht = { ...verwacht, tekst: regimeTekst(verwacht), perMaand: r.perMaand, youngtimer: r.youngtimer };

  // Percentage, cap en percentage boven de cap moeten overeenkomen met de regels voor deze maand.
  const excel = parseBijtellingCel(cel("pct"));
  const toelichtingFout = r.youngtimer
    ? "youngtimer: 35% van de dagwaarde"
    : `RDW-brandstof ${rdw.brandstoffen.join(" + ") || "onbekend"}` +
      (categorie === "standaard" ? "" : `, korting volgens regels van ${r.termijn.peiljaar}`) +
      (eersteToelating <= OUD_REGIME.totEnMet ? `, toelating vóór 2017: standaard ${OUD_REGIME.standaard}%` : "");
  const leeftijdJaren = Math.floor(maandenTussen(eersteToelating, maand) / 12);
  // Bij een youngtimer telt de youngtimerregel in de cel, anders de overige tekst.
  const regime = r.youngtimer ? excel?.youngtimer ?? excel?.regime : excel?.regime;
  const celTekst = String(cel("pct") ?? "").replace(/\s+/g, " ").trim();
  if (!excel || (!excel.regime && !excel.youngtimer)) {
    meld("fout", `% bijtelling ontbreekt (verwacht ${uitkomst.verwacht.tekst}).`);
  } else if (!r.youngtimer && !excel.regime) {
    const grens = youngtimerGrens(maand.getFullYear());
    meld("fout", `% bijtelling "${celTekst}", maar de auto is ${leeftijdJaren} jaar en geen youngtimer (vanaf ${maand.getFullYear()}: ouder dan ${grens} jaar); verwacht ${uitkomst.verwacht.tekst}.`);
  } else {
    // Vergelijk het bedrag dat de getallen in de cel opleveren met de verwachte bijtelling.
    const volgensCel = regime ? bijtellingVolgensCel(regime, r.basis) : null;
    const melding = `% bijtelling "${celTekst}", verwacht ${uitkomst.verwacht.tekst} (${toelichtingFout}).`;
    if (volgensCel == null) {
      meld("fout", `${melding} De getallen in de cel zijn niet eenduidig.`);
    } else if (Math.abs(volgensCel - r.perJaar) > 1) {
      const verschil = (volgensCel - r.perJaar) / 12;
      meld("fout", `${melding} Bijtelling volgens Excel ${euro.format(Math.abs(verschil))} per maand te ${verschil > 0 ? "hoog" : "laag"}.`);
    } else {
      // Bedrag klopt; meld het als de getallen toch afwijken (bijv. een andere cap onder de cataloguswaarde).
      const verwachtePcts = uniek([verwacht.pct, verwacht.boven].filter((p) => p != null));
      const zelfde = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
      const capGoed = verwacht.cap == null ? regime.bedragen.length === 0 : zelfde(regime.bedragen, [verwacht.cap]);
      const pctsGoed = regime.pcts.every((p) => verwachtePcts.includes(p)) && regime.pcts.includes(verwacht.pct);
      if (!capGoed || !pctsGoed) meld("let op", `${melding} Bij deze cataloguswaarde komt het bedrag wel uit.`);
    }
  }
  if (!r.youngtimer && excel?.regime && excel.youngtimer) {
    meld("info", `De cel noemt ook de youngtimerregel; niet van toepassing, de auto is ${leeftijdJaren} jaar.`);
  }
  // Wijzigt het percentage binnenkort doordat de 60-maandstermijn afloopt?
  if (r.termijn?.binnenTermijn) {
    const tot = maandenTussen(maand, r.termijn.eind);
    if (tot >= 1 && tot <= VOORUITKIJKEN_MAANDEN) {
      const na = berekenBijtelling({ ...invoer, maand: r.termijn.eind });
      if (na.pct !== r.pct || na.cap !== r.cap) {
        const naStandaard = na.standaard;
        meld("let op", `60-maandstermijn loopt af: vanaf ${maandFmt.format(r.termijn.eind)} ${regimeTekst({ pct: na.pct, cap: na.cap, boven: naStandaard })}.`);
      }
    }
  }
  return uitkomst;
}

function status(uitkomst) {
  const hoogste = Math.max(0, ...uitkomst.bevindingen.map((b) => NIVEAUS[b.niveau]));
  return hoogste === 3 ? "fout" : hoogste === 2 ? "let op" : "ok";
}

// ---------- UI ----------

async function startControle(e) {
  e.preventDefault();
  const bestand = $("excelBestand").files[0];
  if (!bestand) return;
  const [j, m] = $("controleMaand").value.split("-").map(Number);
  const controleMaand = new Date(j, m - 1, 1);

  $("controleMelding").hidden = true;
  $("controleResultaat").hidden = true;
  $("controleStart").disabled = true;
  try {
    const gelezen = leesWerkboek(await bestand.arrayBuffer());
    const { index, rijen } = gelezen;
    const kentekens = rijen.map((r) => normaliseerKenteken(String(r[index.kenteken] ?? "")));
    const rdwMap = await haalVoertuigenOp(kentekens, (klaar, totaal) => {
      $("controleVoortgang").textContent = `RDW-gegevens ophalen: ${klaar} van ${totaal} kentekens…`;
    });
    const resultaten = rijen.map((rij) => controleerRij(rij, index, rdwMap, controleMaand));
    controleRijen = { ...gelezen, resultaten, bestandsnaam: bestand.name };

    const nodig = { eersteToelating: "1e Toelating", catalogus: "Cataloguswaarde", pct: "% Bijtelling" };
    const ontbrekend = Object.keys(nodig).filter((k) => index[k] == null);
    if (ontbrekend.length) {
      toonControleMelding(`Kolommen niet gevonden: ${ontbrekend.map((k) => nodig[k]).join(", ")}. Controles op deze kolommen zijn overgeslagen.`);
    }
    toonControleResultaat();
  } catch (err) {
    toonControleMelding(`Controle mislukt: ${err.message}`);
  } finally {
    $("controleStart").disabled = false;
    $("controleVoortgang").textContent = "";
  }
}

function toonControleMelding(tekst) {
  $("controleMelding").textContent = tekst;
  $("controleMelding").hidden = false;
}

function toonControleResultaat() {
  const { rijen, index, resultaten } = controleRijen;
  const statussen = resultaten.map(status);
  const telling = { fout: 0, "let op": 0, ok: 0 };
  statussen.forEach((s) => telling[s]++);
  $("controleSamenvatting").innerHTML =
    `<span class="teller fout">${telling.fout} fout</span>` +
    `<span class="teller letop">${telling["let op"]} let op</span>` +
    `<span class="teller ok">${telling.ok} ok</span>` +
    `<span class="klein">${rijen.length} regels</span>`;

  const alleenAfwijkingen = $("alleenAfwijkingen").checked;
  const cel = (rij, k) => (index[k] == null ? "" : rij[index[k]] ?? "");
  const html = resultaten
    .map((u, i) => ({ u, i, s: statussen[i] }))
    .filter(({ s }) => !alleenAfwijkingen || s !== "ok")
    .map(({ u, i, s }) => {
      const rij = rijen[i];
      return `<tr class="status-${s.replace(" ", "")}">` +
        `<td>${i + 1}</td>` +
        `<td>${escape(cel(rij, "werknemer"))} ${escape(cel(rij, "naam"))}</td>` +
        `<td class="nowrap">${u.kenteken ? escape(formatteerKenteken(u.kenteken)) : ""}</td>` +
        `<td class="nowrap">${u.maand ? escape(maandFmt.format(u.maand)) : ""}</td>` +
        `<td>${escape(cel(rij, "pct"))}</td>` +
        `<td>${u.verwacht ? escape(u.verwacht.tekst) : ""}</td>` +
        `<td><span class="label-status ${s.replace(" ", "")}">${s}</span></td>` +
        `<td>${u.bevindingen.map((b) => `<div class="bev-${b.niveau.replace(" ", "")}">${escape(b.tekst)}</div>`).join("")}</td>` +
        `</tr>`;
    });
  $("controleTabel").innerHTML =
    `<tr><th>#</th><th>Werknemer</th><th>Kenteken</th><th>Maand</th><th>% Excel</th><th>% verwacht</th><th>Status</th><th>Bevindingen</th></tr>` +
    (html.join("") || `<tr><td colspan="8">Geen afwijkingen gevonden.</td></tr>`);
  $("controleResultaat").hidden = false;
}

// Zet de controlekolommen rechts naast het oorspronkelijke werkblad; bestaande cellen blijven ongewijzigd.
function downloadControle() {
  const { rijen, resultaten, bestandsnaam, werkboek, blad, kopIndex } = controleRijen;
  const eersteKolom = XLSX.utils.decode_range(blad["!ref"]).e.c + 1;
  const extraKop = ["Controle status", "Controle maand", "% verwacht", "Bijtelling p/m verwacht", "RDW 1e toelating", "RDW catalogusprijs", "RDW brandstof", "Bevindingen"];
  XLSX.utils.sheet_add_aoa(blad, [extraKop], { origin: { r: kopIndex, c: eersteKolom } });
  rijen.forEach((rij, i) => {
    const u = resultaten[i];
    const waarden = [
      status(u),
      u.maand ? maandFmt.format(u.maand) : null,
      u.verwacht?.tekst ?? null,
      u.verwacht ? Math.round(u.verwacht.perMaand * 100) / 100 : null,
      u.rdw?.eersteToelating ? kortDatum(u.rdw.eersteToelating) : null,
      u.rdw?.catalogusprijs ?? null,
      u.rdw ? u.rdw.brandstoffen.join(" + ") : null,
      u.bevindingen.map((b) => `[${b.niveau}] ${b.tekst}`).join("\n"),
    ];
    XLSX.utils.sheet_add_aoa(blad, [waarden], { origin: { r: rij.bladRij, c: eersteKolom } });
  });
  blad["!cols"] = [...(blad["!cols"] ?? []).slice(0, eersteKolom)];
  blad["!cols"][eersteKolom + extraKop.length - 1] = { wch: 80 };
  XLSX.writeFile(werkboek, bestandsnaam.replace(/\.[^.]+$/, "") + " - controle.xlsx");
}

function initControle() {
  const nu = new Date();
  $("controleMaand").value = `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, "0")}`;
  $("controleForm").addEventListener("submit", startControle);
  $("alleenAfwijkingen").addEventListener("change", () => controleRijen && toonControleResultaat());
  $("controleDownload").addEventListener("click", downloadControle);
  toonTarieventabel();
}

initControle();
