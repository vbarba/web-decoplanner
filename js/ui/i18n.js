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
      'btn.fixDeco': 'FIX DECO',
      'btn.editDeco': 'EDIT DECO',
      'btn.copy': 'COPY',
      'col.ppo2': 'ppO₂',
      'tip.travel': 'Show ascent/descent travel legs in the table',
      'tip.fixDeco': 'Add the deco stops needed to clear the ceiling',
      'tip.editDeco': 'Edit deco stops and verify safety',
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
      'btn.fixDeco': 'CORREGIR DECO',
      'btn.editDeco': 'EDITAR DECO',
      'btn.copy': 'COPIAR',
      'col.ppo2': 'ppO₂',
      'tip.travel': 'Mostrar los tramos de ascenso/descenso en la tabla',
      'tip.fixDeco': 'Añadir las paradas de deco necesarias para respetar el techo',
      'tip.editDeco': 'Editar las paradas de deco y verificar la seguridad',
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
      'btn.fixDeco': 'CORRIGER DÉCO',
      'btn.editDeco': 'ÉDITER DÉCO',
      'btn.copy': 'COPIER',
      'col.ppo2': 'ppO₂',
      'tip.travel': 'Afficher les phases de descente/remontée dans la table',
      'tip.fixDeco': 'Ajouter les paliers de déco nécessaires pour respecter le plafond',
      'tip.editDeco': 'Éditer les paliers de déco et vérifier la sécurité',
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
      'btn.fixDeco': 'DEKO KORR.',
      'btn.editDeco': 'DEKO BEARB.',
      'btn.copy': 'KOPIEREN',
      'col.ppo2': 'ppO₂',
      'tip.travel': 'Ab-/Aufstiegsphasen in der Tabelle anzeigen',
      'tip.fixDeco': 'Die nötigen Dekostopps hinzufügen, um die Decke einzuhalten',
      'tip.editDeco': 'Dekostopps bearbeiten und Sicherheit prüfen',
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
      'btn.fixDeco': '修复减压',
      'btn.editDeco': '编辑减压',
      'btn.copy': '复制',
      'col.ppo2': 'ppO₂',
      'tip.travel': '在表中显示上升/下降行程段',
      'tip.fixDeco': '添加清除天花板所需的减压停留',
      'tip.editDeco': '编辑减压停留并验证安全性',
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
