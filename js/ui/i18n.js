/* =====================================================================
   HALDANE — internationalization (UI chrome + tooltips)
   ---------------------------------------------------------------------
   Zero-dependency UMD IIFE (same pattern as the rest of the app): attaches
   window.I18N in the browser and module.exports under Node for testing.

   Scope: box titles, field labels, buttons, dropdown options and tooltips.
   Engine warnings/errors and numeric unit suffixes stay in English by design
   (translating dynamic engine output is out of scope and error-prone).

   Translation is applied by app.js, which walks elements carrying:
     data-i18n      -> sets textContent to t(key)
     data-i18n-title-> sets the title attribute (tooltip) to t(key)
     data-i18n-ph   -> sets the placeholder attribute to t(key)
   Keys missing in a language fall back to English, then to the raw key.
   ===================================================================== */
(function () {
  'use strict';

  var LANGS = ['en', 'es', 'fr', 'de', 'zh'];
  var LANG_LABELS = { en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', zh: '中文' };

  // English is the source of truth and the fallback for any missing key.
  var DICT = {
    en: {
      'brand.sub': 'Decompression Planner',
      'topbar.reset': 'RESET',
      'units.metric': 'METRIC',
      'units.imperial': 'IMPERIAL',
      'lang.label': 'Language',

      'box.dive': 'Dive',
      'box.gases': 'Gases',
      'box.deco': 'Deco Settings',
      'box.gasplan': 'Gas Planning',
      'box.dives': 'Saved Dives',
      'box.profile': 'Dive profile',
      'box.table': 'Runtime table',
      'box.tissue': 'Tissue loading',
      'box.gasreq': 'Gas requirements',
      'box.advisories': 'Advisories',
      'box.errors': 'Plan rejected',

      // Tooltips (one per box) — explain what the box is for.
      'tip.dive': 'The depth/time profile of your dive — each level is a depth held for a number of minutes on a chosen gas.',
      'tip.gases': 'The breathing gases you carry: O₂/He mix, role (bottom or deco), cylinder and fill pressure. Deco gases switch in automatically at their MOD.',
      'tip.deco': 'Decompression model and environment: algorithm and gradient factors, ascent/descent rates, last stop depth, water type, surface pressure and max deco ppO₂.',
      'tip.gasplan': 'Gas-supply planning: your breathing rate (SAC), reserve rule and a fixed extra reserve. These size your cylinders; they do not affect the deco schedule.',
      'tip.dives': 'Save the current dive (profile + settings) under a name, reload it later, or export/import your dives as a JSON file.',
      'tip.profile': 'Depth-vs-time graph of the planned dive, including the ceiling you must stay below.',
      'tip.table': 'Minute-by-minute runtime: every level, gas switch and decompression stop, with running time and ppO₂.',
      'tip.tissue': 'Inert-gas loading of the 16 tissue compartments at the end of the dive, relative to their limits.',
      'tip.gasreq': 'How much of each gas the dive needs versus what your cylinders hold, including the reserve.',
      'tipf.coefficients': "ZHL-16 coefficient set. ZHL-16C is the modern default; ZHL-16B is slightly more conservative in the mid/slow tissues. Hidden under VPM-B.",
      'tipf.gfLow': "Gradient factor at the first (deepest) stop. Lower = deeper, longer first stop (more conservative deep).",
      'tipf.gfHigh': "Gradient factor at the surface. Lower = longer shallow stops / more conservative on surfacing.",
      'tipf.conservatism': "VPM-B conservatism +0…+5. Higher = larger critical bubble radii, longer deco.",
      'tipf.descent': "Descent rate, used to compute travel time down to each level.",
      'tipf.ascent': "Ascent rate, used between levels and stops and to size deco time.",
      'tipf.lastStop': "Shallowest decompression stop depth — 6 m (recommended) or 3 m.",
      'tipf.water': "Water type. Salt = 10 m/bar, fresh = 10.3 m/bar; changes the depth↔pressure conversion.",
      'tipf.surface': "Surface (atmospheric) pressure in bar — lower it for altitude diving.",
      'tipf.ppo2deco': "Maximum ppO₂ allowed on deco gas; sets each deco gas’s switch depth (MOD).",
      'tipf.inclTravel': "When on, a level’s time counts the descent/ascent travel into that level; when off, it is pure bottom time at depth.",
      'tipf.sacBottom': "Surface air consumption on the bottom phase (L/min at 1 bar) — sizes bottom-gas need.",
      'tipf.sacDeco': "Surface air consumption during stops/ascent (L/min at 1 bar) — sizes deco-gas need.",
      'tipf.extraReserve': "Fixed reserve added on top of the reserve rule, on every gas (bar).",
      'tipf.reserveRule': "How much gas to hold back: thirds, half, min-gas (rock-bottom), or none.",

      // Dive box
      'col.depth': 'DEPTH',
      'col.time': 'TIME',
      'col.gas': 'GAS',
      'col.dur': 'DUR',
      'col.run': 'RUN',
      'btn.addLevel': '+ ADD LEVEL',
      'a11y.remove': 'Remove',

      // Gases box
      'a11y.gasPreset': 'Gas preset',
      'btn.addGas': '+ ADD GAS',

      // Deco settings
      'algo.buhlmann': 'BÜHLMANN + GF',
      'algo.vpm': 'VPM-B',
      'field.coefficients': 'COEFFICIENTS',
      'field.gfLow': 'GF LOW',
      'field.gfHigh': 'GF HIGH',
      'field.conservatism': 'CONSERVATISM',
      'field.descent': 'DESCENT',
      'field.ascent': 'ASCENT',
      'field.lastStop': 'LAST STOP',
      'field.water': 'WATER',
      'field.salt': 'SALT',
      'field.fresh': 'FRESH',
      'field.surface': 'SURFACE',
      'field.ppo2deco': 'ppO₂ DECO',
      'field.inclTravel': 'LEVEL TIME INCLUDES TRAVEL',

      // Gas planning
      'field.sacBottom': 'SAC BOTTOM',
      'field.sacDeco': 'SAC DECO',
      'field.extraReserve': 'EXTRA RESERVE',
      'field.reserveRule': 'RESERVE RULE',
      'reserve.thirds': 'Rule of thirds',
      'reserve.half': 'Half + half',
      'reserve.mingas': 'Min gas (bottom→switch ×2)',
      'reserve.none': 'No reserve',

      // Saved dives
      'dives.namePlaceholder': 'Name this dive',
      'btn.save': 'SAVE',
      'btn.export': 'EXPORT',
      'btn.import': 'IMPORT',

      // Runtime table tools
      'btn.travel': 'TRAVEL',
      'btn.copy': 'COPY',
      'col.ppo2': 'ppO₂',
      'tip.travel': 'Show ascent/descent travel legs in the table',
      'tip.copy': 'Copy plan as text',

      // Metrics tiles
      'tile.runtime': 'RUNTIME',
      'tile.decoTime': 'DECO TIME',
      'tile.firstStop': 'FIRST STOP',
      'tile.cns': 'CNS',
      'tile.otu': 'OTU',
      'tile.maxEnd': 'MAX END',
      'tile.maxPpo2': 'MAX ppO₂',

      // Plan dock + footer
      'btn.planDive': 'PLAN DIVE',
      'foot.internalMath': 'INTERNAL MATH: METRIC · msw / min / bar'
    },

    es: {
      'brand.sub': 'Planificador de Descompresión',
      'topbar.reset': 'REINICIAR',
      'units.metric': 'MÉTRICO',
      'units.imperial': 'IMPERIAL',
      'lang.label': 'Idioma',

      'box.dive': 'Inmersión',
      'box.gases': 'Gases',
      'box.deco': 'Ajustes de Deco',
      'box.gasplan': 'Planificación de Gas',
      'box.dives': 'Inmersiones Guardadas',
      'box.profile': 'Perfil de inmersión',
      'box.table': 'Tabla de tiempos',
      'box.tissue': 'Carga de tejidos',
      'box.gasreq': 'Requisitos de gas',
      'box.advisories': 'Advertencias',
      'box.errors': 'Plan rechazado',

      'tip.dive': 'El perfil de profundidad/tiempo de tu inmersión: cada nivel es una profundidad mantenida durante unos minutos con un gas elegido.',
      'tip.gases': 'Los gases que llevas: mezcla O₂/He, función (fondo o deco), cilindro y presión de llenado. Los gases de deco se activan automáticamente a su MOD.',
      'tip.deco': 'Modelo de descompresión y entorno: algoritmo y factores de gradiente, velocidades de ascenso/descenso, última parada, tipo de agua, presión en superficie y ppO₂ máx. de deco.',
      'tip.gasplan': 'Planificación del suministro de gas: tu consumo (SAC), regla de reserva y una reserva extra fija. Dimensionan tus cilindros; no afectan al plan de deco.',
      'tip.dives': 'Guarda la inmersión actual (perfil + ajustes) con un nombre, recárgala después, o exporta/importa tus inmersiones como archivo JSON.',
      'tip.profile': 'Gráfico de profundidad frente a tiempo de la inmersión planificada, incluido el techo que debes respetar.',
      'tip.table': 'Tiempo minuto a minuto: cada nivel, cambio de gas y parada de descompresión, con tiempo acumulado y ppO₂.',
      'tip.tissue': 'Carga de gas inerte de los 16 compartimentos tisulares al final de la inmersión, respecto a sus límites.',
      'tip.gasreq': 'Cuánto de cada gas necesita la inmersión frente a lo que contienen tus cilindros, incluida la reserva.',
      'tipf.coefficients': "Conjunto de coeficientes ZHL-16. ZHL-16C es el predeterminado moderno; ZHL-16B es algo más conservador en los tejidos medios/lentos. Oculto con VPM-B.",
      'tipf.gfLow': "Factor de gradiente en la primera parada (más profunda). Más bajo = primera parada más profunda y larga (más conservador en profundidad).",
      'tipf.gfHigh': "Factor de gradiente en superficie. Más bajo = paradas someras más largas / más conservador al salir.",
      'tipf.conservatism': "Conservadurismo VPM-B +0…+5. Mayor = radios de burbuja críticos mayores, más deco.",
      'tipf.descent': "Velocidad de descenso, usada para calcular el tiempo de bajada a cada nivel.",
      'tipf.ascent': "Velocidad de ascenso, usada entre niveles y paradas y para dimensionar el tiempo de deco.",
      'tipf.lastStop': "Profundidad de la parada de deco más somera: 6 m (recomendado) o 3 m.",
      'tipf.water': "Tipo de agua. Salada = 10 m/bar, dulce = 10,3 m/bar; cambia la conversión profundidad↔presión.",
      'tipf.surface': "Presión en superficie (atmosférica) en bar; redúcela para buceo en altitud.",
      'tipf.ppo2deco': "ppO₂ máxima permitida en gas de deco; fija la profundidad de cambio (MOD) de cada gas de deco.",
      'tipf.inclTravel': "Si está activado, el tiempo de un nivel incluye el desplazamiento de descenso/ascenso; si no, es tiempo de fondo puro a profundidad.",
      'tipf.sacBottom': "Consumo en superficie en la fase de fondo (L/min a 1 bar): dimensiona el gas de fondo.",
      'tipf.sacDeco': "Consumo en superficie durante paradas/ascenso (L/min a 1 bar): dimensiona el gas de deco.",
      'tipf.extraReserve': "Reserva fija añadida sobre la regla de reserva, en cada gas (bar).",
      'tipf.reserveRule': "Cuánto gas reservar: tercios, mitad, gas mínimo (rock-bottom) o ninguno.",

      'col.depth': 'PROF.',
      'col.time': 'TIEMPO',
      'col.gas': 'GAS',
      'col.dur': 'DUR',
      'col.run': 'ACUM',
      'btn.addLevel': '+ AÑADIR NIVEL',
      'a11y.remove': 'Eliminar',

      'a11y.gasPreset': 'Gas predefinido',
      'btn.addGas': '+ AÑADIR GAS',

      'algo.buhlmann': 'BÜHLMANN + GF',
      'algo.vpm': 'VPM-B',
      'field.coefficients': 'COEFICIENTES',
      'field.gfLow': 'GF BAJO',
      'field.gfHigh': 'GF ALTO',
      'field.conservatism': 'CONSERVADURISMO',
      'field.descent': 'DESCENSO',
      'field.ascent': 'ASCENSO',
      'field.lastStop': 'ÚLTIMA PARADA',
      'field.water': 'AGUA',
      'field.salt': 'SALADA',
      'field.fresh': 'DULCE',
      'field.surface': 'SUPERFICIE',
      'field.ppo2deco': 'ppO₂ DECO',
      'field.inclTravel': 'TIEMPO DE NIVEL INCLUYE TRÁNSITO',

      'field.sacBottom': 'SAC FONDO',
      'field.sacDeco': 'SAC DECO',
      'field.extraReserve': 'RESERVA EXTRA',
      'field.reserveRule': 'REGLA DE RESERVA',
      'reserve.thirds': 'Regla de tercios',
      'reserve.half': 'Mitad + mitad',
      'reserve.mingas': 'Gas mínimo (fondo→cambio ×2)',
      'reserve.none': 'Sin reserva',

      'dives.namePlaceholder': 'Nombra esta inmersión',
      'btn.save': 'GUARDAR',
      'btn.export': 'EXPORTAR',
      'btn.import': 'IMPORTAR',

      'btn.travel': 'TRÁNSITO',
      'btn.copy': 'COPIAR',
      'col.ppo2': 'ppO₂',
      'tip.travel': 'Mostrar los tramos de ascenso/descenso en la tabla',
      'tip.copy': 'Copiar el plan como texto',

      'tile.runtime': 'T. TOTAL',
      'tile.decoTime': 'T. DECO',
      'tile.firstStop': 'PRIMERA PARADA',
      'tile.cns': 'SNC',
      'tile.otu': 'OTU',
      'tile.maxEnd': 'END MÁX',
      'tile.maxPpo2': 'ppO₂ MÁX',

      'btn.planDive': 'PLANIFICAR',
      'foot.internalMath': 'CÁLCULO INTERNO: MÉTRICO · msw / min / bar'
    },

    fr: {
      'brand.sub': 'Planificateur de Décompression',
      'topbar.reset': 'RÉINIT.',
      'units.metric': 'MÉTRIQUE',
      'units.imperial': 'IMPÉRIAL',
      'lang.label': 'Langue',

      'box.dive': 'Plongée',
      'box.gases': 'Gaz',
      'box.deco': 'Réglages Déco',
      'box.gasplan': 'Planification du Gaz',
      'box.dives': 'Plongées Enregistrées',
      'box.profile': 'Profil de plongée',
      'box.table': 'Table de temps',
      'box.tissue': 'Charge tissulaire',
      'box.gasreq': 'Besoins en gaz',
      'box.advisories': 'Avertissements',
      'box.errors': 'Plan rejeté',

      'tip.dive': 'Le profil profondeur/temps de votre plongée : chaque palier est une profondeur maintenue quelques minutes sur un gaz choisi.',
      'tip.gases': 'Les gaz que vous emportez : mélange O₂/He, rôle (fond ou déco), bloc et pression de gonflage. Les gaz déco s’activent automatiquement à leur PMU.',
      'tip.deco': 'Modèle de décompression et environnement : algorithme et facteurs de gradient, vitesses de descente/remontée, dernier palier, type d’eau, pression de surface et ppO₂ déco max.',
      'tip.gasplan': 'Planification de l’approvisionnement en gaz : votre consommation (SAC), règle de réserve et une réserve fixe supplémentaire. Elles dimensionnent vos blocs ; sans effet sur la déco.',
      'tip.dives': 'Enregistrez la plongée actuelle (profil + réglages) sous un nom, rechargez-la plus tard, ou exportez/importez vos plongées en fichier JSON.',
      'tip.profile': 'Graphe profondeur/temps de la plongée planifiée, avec le plafond à ne pas dépasser.',
      'tip.table': 'Déroulé minute par minute : chaque palier, changement de gaz et arrêt de décompression, avec temps cumulé et ppO₂.',
      'tip.tissue': 'Charge en gaz inerte des 16 compartiments tissulaires en fin de plongée, par rapport à leurs limites.',
      'tip.gasreq': 'Quantité de chaque gaz nécessaire à la plongée par rapport au contenu de vos blocs, réserve comprise.',
      'tipf.coefficients': "Jeu de coefficients ZHL-16. ZHL-16C est le défaut moderne ; ZHL-16B est un peu plus conservateur sur les tissus moyens/lents. Masqué en VPM-B.",
      'tipf.gfLow': "Facteur de gradient au premier palier (le plus profond). Plus bas = premier palier plus profond et long (plus conservateur en profondeur).",
      'tipf.gfHigh': "Facteur de gradient en surface. Plus bas = paliers peu profonds plus longs / plus conservateur à la sortie.",
      'tipf.conservatism': "Conservatisme VPM-B +0…+5. Plus élevé = rayons de bulle critiques plus grands, plus de déco.",
      'tipf.descent': "Vitesse de descente, utilisée pour calculer le temps de descente vers chaque palier.",
      'tipf.ascent': "Vitesse de remontée, utilisée entre les niveaux et paliers et pour dimensionner la déco.",
      'tipf.lastStop': "Profondeur du palier de déco le moins profond : 6 m (recommandé) ou 3 m.",
      'tipf.water': "Type d’eau. Salée = 10 m/bar, douce = 10,3 m/bar ; modifie la conversion profondeur↔pression.",
      'tipf.surface': "Pression de surface (atmosphérique) en bar ; à réduire pour la plongée en altitude.",
      'tipf.ppo2deco': "ppO₂ maximale autorisée sur gaz déco ; définit la profondeur de bascule (PMU) de chaque gaz déco.",
      'tipf.inclTravel': "Si activé, le temps d’un niveau inclut le trajet de descente/remontée ; sinon c’est du temps de fond pur à la profondeur.",
      'tipf.sacBottom': "Consommation en surface en phase fond (L/min à 1 bar) — dimensionne le gaz fond.",
      'tipf.sacDeco': "Consommation en surface pendant paliers/remontée (L/min à 1 bar) — dimensionne le gaz déco.",
      'tipf.extraReserve': "Réserve fixe ajoutée à la règle de réserve, sur chaque gaz (bar).",
      'tipf.reserveRule': "Quantité de gaz à garder : tiers, moitié, gaz minimum (rock-bottom) ou aucune.",

      'col.depth': 'PROF.',
      'col.time': 'TEMPS',
      'col.gas': 'GAZ',
      'col.dur': 'DUR',
      'col.run': 'CUM',
      'btn.addLevel': '+ AJOUTER PALIER',
      'a11y.remove': 'Supprimer',

      'a11y.gasPreset': 'Gaz prédéfini',
      'btn.addGas': '+ AJOUTER GAZ',

      'algo.buhlmann': 'BÜHLMANN + GF',
      'algo.vpm': 'VPM-B',
      'field.coefficients': 'COEFFICIENTS',
      'field.gfLow': 'GF BAS',
      'field.gfHigh': 'GF HAUT',
      'field.conservatism': 'CONSERVATISME',
      'field.descent': 'DESCENTE',
      'field.ascent': 'REMONTÉE',
      'field.lastStop': 'DERNIER PALIER',
      'field.water': 'EAU',
      'field.salt': 'SALÉE',
      'field.fresh': 'DOUCE',
      'field.surface': 'SURFACE',
      'field.ppo2deco': 'ppO₂ DÉCO',
      'field.inclTravel': 'TEMPS DE PALIER INCLUT LE TRAJET',

      'field.sacBottom': 'SAC FOND',
      'field.sacDeco': 'SAC DÉCO',
      'field.extraReserve': 'RÉSERVE SUPP.',
      'field.reserveRule': 'RÈGLE DE RÉSERVE',
      'reserve.thirds': 'Règle des tiers',
      'reserve.half': 'Moitié + moitié',
      'reserve.mingas': 'Gaz minimum (fond→bascule ×2)',
      'reserve.none': 'Sans réserve',

      'dives.namePlaceholder': 'Nommer cette plongée',
      'btn.save': 'ENREGISTRER',
      'btn.export': 'EXPORTER',
      'btn.import': 'IMPORTER',

      'btn.travel': 'TRAJET',
      'btn.copy': 'COPIER',
      'col.ppo2': 'ppO₂',
      'tip.travel': 'Afficher les phases de descente/remontée dans la table',
      'tip.copy': 'Copier le plan en texte',

      'tile.runtime': 'TEMPS TOT.',
      'tile.decoTime': 'TEMPS DÉCO',
      'tile.firstStop': 'PREMIER PALIER',
      'tile.cns': 'SNC',
      'tile.otu': 'OTU',
      'tile.maxEnd': 'END MAX',
      'tile.maxPpo2': 'ppO₂ MAX',

      'btn.planDive': 'PLANIFIER',
      'foot.internalMath': 'CALCUL INTERNE : MÉTRIQUE · msw / min / bar'
    },

    de: {
      'brand.sub': 'Dekompressionsplaner',
      'topbar.reset': 'ZURÜCKS.',
      'units.metric': 'METRISCH',
      'units.imperial': 'IMPERIAL',
      'lang.label': 'Sprache',

      'box.dive': 'Tauchgang',
      'box.gases': 'Gase',
      'box.deco': 'Deko-Einstellungen',
      'box.gasplan': 'Gasplanung',
      'box.dives': 'Gespeicherte Tauchgänge',
      'box.profile': 'Tauchprofil',
      'box.table': 'Laufzeittabelle',
      'box.tissue': 'Gewebesättigung',
      'box.gasreq': 'Gasbedarf',
      'box.advisories': 'Hinweise',
      'box.errors': 'Plan abgelehnt',

      'tip.dive': 'Das Tiefen-/Zeitprofil deines Tauchgangs — jede Stufe ist eine Tiefe, die einige Minuten auf einem gewählten Gas gehalten wird.',
      'tip.gases': 'Die mitgeführten Atemgase: O₂/He-Gemisch, Rolle (Grund- oder Dekogas), Flasche und Fülldruck. Dekogase werden bei ihrer MOD automatisch gewechselt.',
      'tip.deco': 'Dekompressionsmodell und Umgebung: Algorithmus und Gradientenfaktoren, Ab-/Aufstiegsraten, letzter Stopp, Wassertyp, Oberflächendruck und max. Deko-ppO₂.',
      'tip.gasplan': 'Gasversorgungsplanung: dein Verbrauch (SAC), Reserveregel und ein fester Zusatzvorrat. Sie dimensionieren die Flaschen; ohne Einfluss auf die Deko.',
      'tip.dives': 'Speichere den aktuellen Tauchgang (Profil + Einstellungen) unter einem Namen, lade ihn später, oder exportiere/importiere deine Tauchgänge als JSON-Datei.',
      'tip.profile': 'Tiefe-Zeit-Diagramm des geplanten Tauchgangs, einschließlich der einzuhaltenden Decke.',
      'tip.table': 'Minutengenauer Ablauf: jede Stufe, jeder Gaswechsel und Dekostopp, mit Laufzeit und ppO₂.',
      'tip.tissue': 'Inertgassättigung der 16 Gewebekompartimente am Tauchgangsende, bezogen auf ihre Grenzwerte.',
      'tip.gasreq': 'Wie viel von jedem Gas der Tauchgang braucht gegenüber dem Inhalt deiner Flaschen, inklusive Reserve.',
      'tipf.coefficients': "ZHL-16-Koeffizientensatz. ZHL-16C ist der moderne Standard; ZHL-16B ist in mittleren/langsamen Geweben etwas konservativer. Bei VPM-B ausgeblendet.",
      'tipf.gfLow': "Gradientenfaktor am ersten (tiefsten) Stopp. Niedriger = tieferer, längerer erster Stopp (tief konservativer).",
      'tipf.gfHigh': "Gradientenfaktor an der Oberfläche. Niedriger = längere flache Stopps / konservativer beim Auftauchen.",
      'tipf.conservatism': "VPM-B-Konservativität +0…+5. Höher = größere kritische Blasenradien, mehr Deko.",
      'tipf.descent': "Abstiegsrate, zur Berechnung der Abstiegszeit zu jeder Stufe.",
      'tipf.ascent': "Aufstiegsrate, zwischen Stufen und Stopps und zur Bemessung der Dekozeit.",
      'tipf.lastStop': "Tiefe des flachsten Dekostopps – 6 m (empfohlen) oder 3 m.",
      'tipf.water': "Wasserart. Salz = 10 m/bar, süß = 10,3 m/bar; ändert die Tiefe↔Druck-Umrechnung.",
      'tipf.surface': "Oberflächendruck (atmosphärisch) in bar – für Höhentauchen verringern.",
      'tipf.ppo2deco': "Maximaler ppO₂ auf Dekogas; legt die Wechseltiefe (MOD) jedes Dekogases fest.",
      'tipf.inclTravel': "Wenn aktiv, zählt die Stufenzeit die Ab-/Aufstiegszeit mit; sonst reine Grundzeit auf Tiefe.",
      'tipf.sacBottom': "Oberflächenverbrauch in der Grundphase (L/min bei 1 bar) – bemisst den Grundgasbedarf.",
      'tipf.sacDeco': "Oberflächenverbrauch bei Stopps/Aufstieg (L/min bei 1 bar) – bemisst den Dekogasbedarf.",
      'tipf.extraReserve': "Feste Reserve zusätzlich zur Reserveregel, auf jedem Gas (bar).",
      'tipf.reserveRule': "Wie viel Gas zurückhalten: Drittel, Hälfte, Min-Gas (Rock-Bottom) oder keine.",

      'col.depth': 'TIEFE',
      'col.time': 'ZEIT',
      'col.gas': 'GAS',
      'col.dur': 'DAUER',
      'col.run': 'LAUF',
      'btn.addLevel': '+ STUFE',
      'a11y.remove': 'Entfernen',

      'a11y.gasPreset': 'Gasvorlage',
      'btn.addGas': '+ GAS',

      'algo.buhlmann': 'BÜHLMANN + GF',
      'algo.vpm': 'VPM-B',
      'field.coefficients': 'KOEFFIZIENTEN',
      'field.gfLow': 'GF NIEDRIG',
      'field.gfHigh': 'GF HOCH',
      'field.conservatism': 'KONSERVATISMUS',
      'field.descent': 'ABSTIEG',
      'field.ascent': 'AUFSTIEG',
      'field.lastStop': 'LETZTER STOPP',
      'field.water': 'WASSER',
      'field.salt': 'SALZ',
      'field.fresh': 'SÜSS',
      'field.surface': 'OBERFLÄCHE',
      'field.ppo2deco': 'ppO₂ DEKO',
      'field.inclTravel': 'STUFENZEIT INKL. WEGZEIT',

      'field.sacBottom': 'SAC GRUND',
      'field.sacDeco': 'SAC DEKO',
      'field.extraReserve': 'ZUSATZRESERVE',
      'field.reserveRule': 'RESERVEREGEL',
      'reserve.thirds': 'Drittelregel',
      'reserve.half': 'Hälfte + Hälfte',
      'reserve.mingas': 'Mindestgas (Grund→Wechsel ×2)',
      'reserve.none': 'Keine Reserve',

      'dives.namePlaceholder': 'Tauchgang benennen',
      'btn.save': 'SPEICHERN',
      'btn.export': 'EXPORT',
      'btn.import': 'IMPORT',

      'btn.travel': 'WEGZEIT',
      'btn.copy': 'KOPIEREN',
      'col.ppo2': 'ppO₂',
      'tip.travel': 'Ab-/Aufstiegsphasen in der Tabelle anzeigen',
      'tip.copy': 'Plan als Text kopieren',

      'tile.runtime': 'LAUFZEIT',
      'tile.decoTime': 'DEKOZEIT',
      'tile.firstStop': 'ERSTER STOPP',
      'tile.cns': 'ZNS',
      'tile.otu': 'OTU',
      'tile.maxEnd': 'MAX END',
      'tile.maxPpo2': 'MAX ppO₂',

      'btn.planDive': 'PLANEN',
      'foot.internalMath': 'INTERNE BERECHNUNG: METRISCH · msw / min / bar'
    },

    zh: {
      'brand.sub': '减压计划器',
      'topbar.reset': '重置',
      'units.metric': '公制',
      'units.imperial': '英制',
      'lang.label': '语言',

      'box.dive': '潜水',
      'box.gases': '气体',
      'box.deco': '减压设置',
      'box.gasplan': '气体规划',
      'box.dives': '已保存潜水',
      'box.profile': '潜水剖面',
      'box.table': '运行时间表',
      'box.tissue': '组织负荷',
      'box.gasreq': '气体需求',
      'box.advisories': '提示',
      'box.errors': '计划被拒绝',

      'tip.dive': '潜水的深度/时间剖面——每个层级是在选定气体上保持若干分钟的某一深度。',
      'tip.gases': '携带的呼吸气体：O₂/He 配比、用途（底层或减压）、气瓶和充气压力。减压气体在其 MOD 处自动切换。',
      'tip.deco': '减压模型与环境：算法和梯度因子、上升/下降速率、最后停留、水类型、水面压力和最大减压 ppO₂。',
      'tip.gasplan': '供气规划：你的耗气量（SAC）、储备规则和固定附加储备。它们决定气瓶规格，不影响减压计划。',
      'tip.dives': '将当前潜水（剖面 + 设置）命名保存、稍后重新载入，或以 JSON 文件导出/导入你的潜水。',
      'tip.profile': '计划潜水的深度-时间图，含必须保持在其下方的天花板。',
      'tip.table': '逐分钟运行：每个层级、换气和减压停留，附累计时间与 ppO₂。',
      'tip.tissue': '潜水结束时 16 个组织舱的惰性气体负荷，相对于各自的极限。',
      'tip.gasreq': '本次潜水所需的各气体量与气瓶容量（含储备）的对比。',
      'tipf.coefficients': "ZHL-16 系数组。ZHL-16C 为现代默认；ZHL-16B 在中/慢组织上略保守。VPM-B 下隐藏。",
      'tipf.gfLow': "第一个（最深）停留处的梯度因子。越低 = 第一停留越深越长（深处更保守）。",
      'tipf.gfHigh': "水面处的梯度因子。越低 = 浅停更长／上浮更保守。",
      'tipf.conservatism': "VPM-B 保守度 +0…+5。越高 = 临界气泡半径越大、减压越长。",
      'tipf.descent': "下潜速率，用于计算到每个深度的下潜时间。",
      'tipf.ascent': "上升速率，用于各层与停留之间，并决定减压时长。",
      'tipf.lastStop': "最浅减压停留深度——6 米（推荐）或 3 米。",
      'tipf.water': "水类型。海水 = 10 米/巴，淡水 = 10.3 米/巴；改变深度↔压力换算。",
      'tipf.surface': "水面（大气）压力（巴）——高海拔潜水时调低。",
      'tipf.ppo2deco': "减压气体允许的最大 ppO₂；决定每种减压气体的切换深度（MOD）。",
      'tipf.inclTravel': "开启时，某层的时间包含下潜/上升行程；关闭时为该深度的纯底时。",
      'tipf.sacBottom': "底部阶段的水面耗气量（1 巴下 L/分）——决定底气需求。",
      'tipf.sacDeco': "停留/上升阶段的水面耗气量（1 巴下 L/分）——决定减压气需求。",
      'tipf.extraReserve': "在储备规则之上、对每种气体额外增加的固定储备（巴）。",
      'tipf.reserveRule': "保留多少气体：三分法、一半、最小气量（rock-bottom）或不保留。",

      'col.depth': '深度',
      'col.time': '时间',
      'col.gas': '气体',
      'col.dur': '时长',
      'col.run': '累计',
      'btn.addLevel': '+ 添加层级',
      'a11y.remove': '删除',

      'a11y.gasPreset': '预设气体',
      'btn.addGas': '+ 添加气体',

      'algo.buhlmann': 'BÜHLMANN + GF',
      'algo.vpm': 'VPM-B',
      'field.coefficients': '系数',
      'field.gfLow': 'GF 低',
      'field.gfHigh': 'GF 高',
      'field.conservatism': '保守度',
      'field.descent': '下降',
      'field.ascent': '上升',
      'field.lastStop': '最后停留',
      'field.water': '水',
      'field.salt': '海水',
      'field.fresh': '淡水',
      'field.surface': '水面',
      'field.ppo2deco': 'ppO₂ 减压',
      'field.inclTravel': '层级时间含行程',

      'field.sacBottom': '底层 SAC',
      'field.sacDeco': '减压 SAC',
      'field.extraReserve': '附加储备',
      'field.reserveRule': '储备规则',
      'reserve.thirds': '三分法',
      'reserve.half': '一半 + 一半',
      'reserve.mingas': '最小气量（底层→换气 ×2）',
      'reserve.none': '无储备',

      'dives.namePlaceholder': '为此潜水命名',
      'btn.save': '保存',
      'btn.export': '导出',
      'btn.import': '导入',

      'btn.travel': '行程',
      'btn.copy': '复制',
      'col.ppo2': 'ppO₂',
      'tip.travel': '在表中显示上升/下降行程段',
      'tip.copy': '将计划复制为文本',

      'tile.runtime': '总时间',
      'tile.decoTime': '减压时间',
      'tile.firstStop': '首停',
      'tile.cns': 'CNS',
      'tile.otu': 'OTU',
      'tile.maxEnd': '最大 END',
      'tile.maxPpo2': '最大 ppO₂',

      'btn.planDive': '生成计划',
      'foot.internalMath': '内部计算：公制 · msw / min / bar'
    }
  };

  var current = 'en';

  function has(lang) { return DICT.hasOwnProperty(lang); }

  // Pick a default language from the browser, falling back to English.
  function detect() {
    var langs = [];
    try {
      if (navigator.languages && navigator.languages.length) langs = navigator.languages.slice();
      else if (navigator.language) langs = [navigator.language];
    } catch (e) { /* non-browser */ }
    for (var i = 0; i < langs.length; i++) {
      var two = String(langs[i]).slice(0, 2).toLowerCase();
      if (has(two)) return two;
    }
    return 'en';
  }

  function setLang(lang) { current = has(lang) ? lang : 'en'; return current; }
  function getLang() { return current; }

  // Translate a key in the current language; fall back to English, then key.
  function t(key) {
    var d = DICT[current];
    if (d && d.hasOwnProperty(key)) return d[key];
    if (DICT.en.hasOwnProperty(key)) return DICT.en[key];
    return key;
  }

  var I18N = {
    LANGS: LANGS,
    LANG_LABELS: LANG_LABELS,
    detect: detect,
    setLang: setLang,
    getLang: getLang,
    has: has,
    t: t,
    _dict: DICT
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = I18N;
  if (typeof window !== 'undefined') window.I18N = I18N;
})();
