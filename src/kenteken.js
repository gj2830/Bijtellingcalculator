// Kentekencheck: bijtelling voor één kenteken en één maand.

let voertuig = null;

// ---------- UI ----------

function geselecteerdeMaand() {
  const [j, m] = $("maand").value.split("-").map(Number);
  return new Date(j, m - 1, 1);
}

function toonVoertuig(v) {
  $("voertuigNaam").textContent = `${v.merk ?? ""} ${v.model ?? ""}`.trim() || v.kenteken;
  $("dToelating").textContent = v.eersteToelating ? datumFmt.format(v.eersteToelating) : "onbekend";
  $("dTenaamstelling").textContent = v.eersteTenaamstellingNL ? datumFmt.format(v.eersteTenaamstellingNL) : "onbekend";
  $("dBrandstof").textContent = v.brandstoffen.length ? v.brandstoffen.join(" + ") : "onbekend";
  $("dCatalogus").textContent = v.catalogusprijs ? euroHeel.format(v.catalogusprijs) : "niet geregistreerd";
  $("catalogusprijs").value = v.catalogusprijs ?? "";
  $("categorie").value = bepaalCategorie(v.brandstoffen);
  $("dagwaarde").value = "";
  $("resultaat").hidden = false;
}

function herbereken() {
  if (!voertuig?.eersteToelating) return;
  const maand = geselecteerdeMaand();
  // Volle maanden tussen de datum eerste toelating en de 1e van de gekozen maand.
  const maanden = maandenTussen(voertuig.eersteToelating, maand) - (voertuig.eersteToelating.getDate() > 1 ? 1 : 0);
  $("dLeeftijd").textContent = maanden < 0 ? "nog niet toegelaten" : `${maanden} ${maanden === 1 ? "maand" : "maanden"}`;

  const youngtimer = isYoungtimer(voertuig.eersteToelating, maand);
  $("dagwaardeLabel").hidden = !youngtimer;

  const r = berekenBijtelling({
    eersteToelating: voertuig.eersteToelating,
    eersteTenaamstelling: voertuig.eersteTenaamstellingNL,
    maand,
    catalogusprijs: numOfNull($("catalogusprijs").value),
    categorie: $("categorie").value,
    dagwaarde: numOfNull($("dagwaarde").value),
  });

  $("maandLabel").textContent = maandFmt.format(maand);
  $("perMaand").textContent = euro.format(r.perMaand);

  const rijen = r.regels.map((x) => rij(x.omschrijving, euro.format(x.jaar), euro.format(x.jaar / 12)));
  rijen.unshift(`<tr><th></th><th class="num">Per jaar</th><th class="num">Per maand</th></tr>`);
  rijen.push(rij("Bijtelling", euro.format(r.perJaar), euro.format(r.perMaand), "som"));
  $("opbouw").innerHTML = rijen.join("");

  $("toelichting").innerHTML = [
    ...r.waarschuwingen.map((t) => `<li class="waarschuwing">${escape(t)}</li>`),
    ...r.toelichting.map((t) => `<li>${escape(t)}</li>`),
  ].join("");

  laatsteBerekening = { maand, maanden, r };
}

// ---------- Kopiëren ----------

let laatsteBerekening = null;

function kopieerGegevens() {
  const { maand, maanden, r } = laatsteBerekening;
  const v = voertuig;
  const titel = `Bijtelling ${maandFmt.format(maand)} – ${formatteerKenteken(v.kenteken)}`;
  const gegevens = [
    ["Kenteken", formatteerKenteken(v.kenteken)],
    ["Auto", `${v.merk ?? ""} ${v.model ?? ""}`.trim()],
    ["Datum eerste toelating", datumFmt.format(v.eersteToelating)],
    ["Eerste tenaamstelling NL", v.eersteTenaamstellingNL ? datumFmt.format(v.eersteTenaamstellingNL) : "onbekend"],
    ["Leeftijd op 1e van de maand", `${maanden} maanden`],
    ["Brandstof", v.brandstoffen.join(" + ") || "onbekend"],
    ["Categorie", $("categorie").selectedOptions[0].text],
    r.youngtimer
      ? ["Waarde in het economisch verkeer", euroHeel.format(numOfNull($("dagwaarde").value) ?? 0)]
      : ["Catalogusprijs", euroHeel.format(numOfNull($("catalogusprijs").value) ?? 0)],
  ];
  const opbouw = [
    ...r.regels.map((x) => [x.omschrijving, euro.format(x.jaar), euro.format(x.jaar / 12)]),
    ["Bijtelling", euro.format(r.perJaar), euro.format(r.perMaand)],
  ];
  const notities = [...r.waarschuwingen, ...r.toelichting];
  const voet = `Berekend op ${datumFmt.format(new Date())} met gegevens van RDW Open Data.`;

  const font = "font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#222222;";
  const cel = `${font}border:1px solid #bfbfbf;padding:4px 8px;`;
  const num = `${cel}text-align:right;`;
  const html =
    `<div style="${font}">` +
    `<h2 style="font-family:Calibri,Arial,sans-serif;font-size:14pt;color:#1f3864;margin:0 0 8pt;">${escape(titel)}</h2>` +
    `<table style="border-collapse:collapse;margin-bottom:10pt;">` +
    gegevens.map(([k, w]) => `<tr><td style="${cel}background:#f2f2f2;">${escape(k)}</td><td style="${cel}">${escape(w)}</td></tr>`).join("") +
    `</table>` +
    `<table style="border-collapse:collapse;margin-bottom:10pt;">` +
    `<tr><th style="${cel}background:#1f3864;color:#fff;text-align:left;">Opbouw</th>` +
    `<th style="${num}background:#1f3864;color:#fff;">Per jaar</th><th style="${num}background:#1f3864;color:#fff;">Per maand</th></tr>` +
    opbouw.map(([o, j, m], i) => {
      const vet = i === opbouw.length - 1 ? "font-weight:bold;background:#f2f2f2;" : "";
      return `<tr><td style="${cel}${vet}">${escape(o)}</td><td style="${num}${vet}">${j}</td><td style="${num}${vet}">${m}</td></tr>`;
    }).join("") +
    `</table>` +
    notities.map((t) => `<p style="${font}margin:0 0 4pt;">${escape(t)}</p>`).join("") +
    `<p style="${font}color:#7f7f7f;font-size:9pt;margin:6pt 0 0;">${escape(voet)}</p>` +
    `</div>`;

  const tekst = [
    titel,
    "",
    ...gegevens.map(([k, w]) => `${k}:\t${w}`),
    "",
    "Opbouw\tPer jaar\tPer maand",
    ...opbouw.map((x) => x.join("\t")),
    "",
    ...notities,
    "",
    voet,
  ].join("\n");

  return schrijfKlembord(html, tekst);
}

async function schrijfKlembord(html, tekst) {
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([tekst], { type: "text/plain" }),
        }),
      ]);
      return true;
    } catch {
      // Valt terug op execCommand hieronder.
    }
  }
  const tijdelijk = document.createElement("div");
  tijdelijk.contentEditable = "true";
  tijdelijk.style.cssText = "position:fixed;left:-9999px;top:0;";
  tijdelijk.innerHTML = html;
  document.body.append(tijdelijk);
  const selectie = getSelection();
  selectie.removeAllRanges();
  const bereik = document.createRange();
  bereik.selectNodeContents(tijdelijk);
  selectie.addRange(bereik);
  const gelukt = document.execCommand("copy");
  selectie.removeAllRanges();
  tijdelijk.remove();
  return gelukt;
}

async function kopieer() {
  if (!laatsteBerekening) return;
  const knop = $("kopieer");
  const gelukt = await kopieerGegevens();
  knop.textContent = gelukt ? "Gekopieerd ✓" : "Kopiëren mislukt";
  clearTimeout(knop._timer);
  knop._timer = setTimeout(() => (knop.textContent = "Kopiëren"), 2000);
}

function rij(omschrijving, jaar, maand, cls = "") {
  return `<tr class="${cls}"><td>${escape(omschrijving)}</td><td class="num">${jaar}</td><td class="num">${maand}</td></tr>`;
}

function toonMelding(tekst) {
  $("melding").textContent = tekst;
  $("melding").hidden = !tekst;
}

async function zoek(e) {
  e.preventDefault();
  const kenteken = normaliseerKenteken($("kenteken").value);
  if (!kenteken) return;

  toonMelding("");
  $("ophalen").disabled = true;
  try {
    const v = await haalVoertuigOp(kenteken);
    if (!v) {
      toonMelding(`Kenteken ${kenteken} niet gevonden bij de RDW.`);
      return;
    }
    if (!v.eersteToelating) {
      toonMelding("De RDW geeft geen datum eerste toelating voor dit voertuig; berekenen is niet mogelijk.");
      return;
    }
    voertuig = v;
    toonVoertuig(v);
    herbereken();
  } catch (err) {
    toonMelding(`Ophalen mislukt: ${err.message}`);
  } finally {
    $("ophalen").disabled = false;
  }
}

function init() {
  const nu = new Date();
  $("maand").value = `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, "0")}`;
  toonTarieventabel();

  $("zoek").addEventListener("submit", zoek);
  $("kopieer").addEventListener("click", kopieer);
  $("maand").addEventListener("change", herbereken);
  for (const id of ["catalogusprijs", "categorie", "dagwaarde"]) {
    $(id).addEventListener("input", herbereken);
  }

  const kenteken = new URLSearchParams(location.search).get("kenteken");
  if (kenteken) {
    $("kenteken").value = kenteken;
    $("zoek").requestSubmit();
  }
}

init();
