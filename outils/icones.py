"""Construit js/icons.js : icônes Lucide (version figée, copiées en local) + table emoji -> icône.
Lancer depuis touffu-gestion :  python outils/icones.py js/icons.js   (télécharge les dessins sur cdn.jsdelivr.net ; à relancer seulement pour ajouter une icône)."""
import re, sys, json, urllib.request
VER = "1.73.0"
out_path = sys.argv[1]
# emoji -> ([noms candidats, le premier qui existe gagne], ton éventuel)
MAP = {
 "⚠": (["triangle-alert", "alert-triangle"], "warn"), "🗑": (["trash-2"], ""), "🔗": (["link"], ""), "📦": (["package"], ""), "🐕": (["dog"], ""),
 "✅": (["circle-check", "check-circle"], "ok"), "📋": (["clipboard-list"], ""), "📏": (["ruler"], ""), "🎪": (["tent"], ""), "🥩": (["beef"], ""),
 "💶": (["euro"], ""), "🏷": (["tag"], ""), "✏": (["pencil"], ""), "🧾": (["receipt"], ""), "📥": (["arrow-down-to-line"], ""), "📤": (["arrow-up-from-line"], ""),
 "🚫": (["ban"], "bad"), "⬇": (["download"], ""), "🔄": (["refresh-cw"], ""), "🛠": (["wrench"], ""), "🧩": (["puzzle"], ""), "🏬": (["warehouse"], ""),
 "📐": (["triangle-right"], ""), "⏳": (["hourglass"], ""), "🔒": (["lock"], ""), "💳": (["credit-card"], ""), "🧵": (["spool", "scissors"], ""),
 "💵": (["banknote"], ""), "🛒": (["shopping-cart"], ""), "🤝": (["handshake"], ""), "🌐": (["globe"], ""), "🔀": (["shuffle"], ""), "🧺": (["shopping-basket"], ""),
 "💡": (["lightbulb"], ""), "🧮": (["calculator"], ""), "🖨": (["printer"], ""), "👤": (["user"], ""), "🎨": (["palette"], ""), "📚": (["library"], ""),
 "📊": (["chart-column", "bar-chart-3"], ""), "💾": (["save"], ""), "➕": (["plus"], ""), "ℹ": (["info"], ""), "🚩": (["flag"], ""), "📅": (["calendar"], ""),
 "🔍": (["search"], ""), "🔎": (["search"], ""), "🖼": (["image"], ""), "🏪": (["store"], ""), "❌": (["x"], "bad"), "📝": (["notebook-pen", "file-pen"], ""),
 "💰": (["coins"], ""), "✨": (["sparkles"], ""), "🏦": (["landmark"], ""), "🏢": (["building-2"], ""), "👥": (["users"], ""), "🚗": (["car"], ""),
 "💌": (["mail"], ""), "⚙": (["settings"], ""), "⛔": (["octagon-x", "ban"], "bad"), "📉": (["trending-down"], ""), "🔔": (["bell"], ""), "🐈": (["cat"], ""),
 "🧠": (["brain"], ""), "🧹": (["brush-cleaning", "paintbrush"], ""), "🧑‍💼": (["briefcase-business", "briefcase"], ""), "🔢": (["hash"], ""), "🛍": (["shopping-bag"], ""),
 "📈": (["trending-up"], ""), "🎁": (["gift"], ""), "🪪": (["id-card"], ""), "🔴": (["circle"], "bad fill"), "🟠": (["circle"], "warn fill"), "🟢": (["circle"], "ok fill"),
 "⚪": (["circle"], ""), "🎉": (["party-popper"], ""), "🆕": (["badge-plus"], ""), "📖": (["book-open"], ""), "🧊": (["snowflake"], ""), "🏠": (["house", "home"], ""),
 "📂": (["folder-open"], ""), "📁": (["folder"], ""), "🎞": (["film"], ""), "❤": (["heart"], ""), "🌿": (["leaf"], ""), "🎯": (["target"], ""), "🐾": (["paw-print"], ""),
 "🚚": (["truck"], ""), "📑": (["files"], ""), "⚖": (["scale"], ""), "🍽": (["utensils"], ""), "🛡": (["shield"], ""), "🔦": (["flashlight"], ""), "📒": (["notebook"], ""),
 "📓": (["notebook"], ""), "👁": (["eye"], ""), "🔩": (["bolt"], ""), "🍖": (["drumstick"], ""), "☀": (["sun"], ""), "🌙": (["moon"], ""), "♻": (["recycle"], ""),
 "🏆": (["trophy"], ""), "🦮": (["dog"], ""), "🐶": (["dog"], ""), "🚨": (["siren"], "bad"), "⭐": (["star"], ""), "❓": (["circle-question-mark", "circle-help", "help-circle"], ""),
 "🔧": (["wrench"], ""), "✂": (["scissors"], ""), "☁": (["cloud"], ""), "🙈": (["eye-off"], ""), "📎": (["paperclip"], ""), "🕒": (["clock"], ""), "⏸": (["pause"], ""),
 "🧭": (["compass"], ""), "📬": (["mailbox"], ""), "🦴": (["bone"], ""), "💪": (["biceps-flexed"], ""), "🎲": (["dices"], ""), "🔓": (["lock-open", "unlock"], ""),
 "👃": (["wind"], ""), "🫠": (["droplet", "droplets"], ""), "💤": (["bed", "moon"], ""),
 "🔠": (["case-upper"], ""), "🛟": (["life-buoy"], ""), "🏭": (["factory"], ""), "➖": (["minus"], ""), "🎚": (["sliders-horizontal"], ""), "✋": (["hand"], ""),
}
cache, icons, table, missing = {}, {}, {}, []
def fetch(name):
    if name in cache: return cache[name]
    try:
        raw = urllib.request.urlopen("https://cdn.jsdelivr.net/npm/lucide-static@%s/icons/%s.svg" % (VER, name), timeout=30).read().decode("utf-8")
        inner = re.search(r"<svg[^>]*>(.*)</svg>", raw, re.S).group(1)
        inner = re.sub(r"\s+", " ", inner).strip().replace("> <", "><")
        if re.search(r"<(script|foreignObject|image|use|a)\b|\son\w+=|href=", inner, re.I): raise ValueError("contenu inattendu dans " + name)
        cache[name] = inner
    except Exception as e:
        cache[name] = None
    return cache[name]
for emo, (cands, tone) in MAP.items():
    for n in cands:
        if fetch(n):
            icons[n] = cache[n]; table[emo] = [n, tone]; break
    else:
        missing.append(emo + " " + "/".join(cands))
js = ("/* ═══════════ Icônes de l'appli (audit 2026-11-16, design D1) ═══════════\n"
      "   Jeu unique : Lucide v%s (licence ISC, https://lucide.dev), copié ici en version figée — rien n'est chargé depuis Internet.\n"
      "   FICHIER GÉNÉRÉ : ne pas modifier à la main. `ICONS` = dessin de chaque icône (contenu du <svg>, trait 24 × 24) ;\n"
      "   `EMOJI_ICON` = emoji historique -> [icône, ton] (ton : ok / warn / bad / fill). Utilisation : `U.icon('nom')` et `U.iconize(élément)` (utils.js). */\n" % VER)
js += "const ICONS = " + json.dumps(dict(sorted(icons.items())), ensure_ascii=False, indent=0).replace("\n", "\n  ").replace("\n  }", "\n}") + ";\n"
js += "const EMOJI_ICON = " + json.dumps(table, ensure_ascii=False) + ";\n"
open(out_path, "w", encoding="utf-8", newline="\n").write(js)
print(len(icons), "icônes,", len(table), "emojis reliés ; introuvables :", missing)
