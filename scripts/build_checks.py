"""Размечает строки data.json данными для автоматической проверки через Steam.

К каждой строке основных категорий добавляется поле "check":
  {
    "apps": [427520],                       # подходит любая из этих игр
    "achievements": {"427520": ["nuclear-power"]},
    "mode": "all" | "any",                  # нужны все ачивки или любая
    "percent": 75,                          # доля полученных ачивок
    "count": 125,                           # количество полученных ачивок
    "hours": 20                             # часы в игре
  }
или "check": null, если требование проверяется только вручную.

Строка "любая игра из стима" размечается вручную и --force её не трогает:
  {
    "anyGame": true,                        # любая игра не из таблицы,
    "exclude": [730],                       # не из apps других строк и не из exclude
    "hours": 150,
    "percent": 75
  }
Баллы за неё начисляются за каждую подходящую игру.

Условие "N ачивок из списка" тоже пишется вручную, и такие строки --force
не трогает:
    "pick": {"count": 2, "achievements": {"236390": ["a", "b", "c"]}}

Строки, где поле "check" уже есть, не трогаются, поэтому ручные правки
сохраняются. Флаг --force пересобирает всё заново.

Запуск: STEAM_API_KEY=... python scripts/build_checks.py [--force]
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

DATA_FILE = Path("data.json")
CACHE_DIR = Path(__file__).parent / ".cache"
CATEGORIES = ["Потные", "Мега", "Сломанные"]

# Игры, которые поиск Steam находит неправильно или которые состоят
# из нескольких частей. Ключ - название из таблицы в нижнем регистре.
APP_HINTS = {
    # "hollow knight / silksong": [367520, 1030300],
}

QUOTED = re.compile(r'[""“]([^""”]+)[""”]\s*(?:\(([^)]*)\))?')
PERCENT = re.compile(
    r"(\d+)\s*%\s*(?:всех\s+)?(?:достижений|триумфов)?", re.IGNORECASE
)
HOURS = re.compile(r"(\d+)\s*\+?\s*час\w*", re.IGNORECASE)
COUNT = re.compile(r"(\d+)\s+достижений", re.IGNORECASE)
FILLER = re.compile(
    r"\b(?:достижени[еяй]|доститижение|обязательн\w*|выполнить|иметь"
    r"|всех|и|или|триумфов)\b|[+,.:;()\-–/]",
    re.IGNORECASE,
)
ACHIEVEMENT_PREFIX = re.compile(r"^\s*достижени[еяй]\s+", re.IGNORECASE)


def normalize(text):
    text = text.casefold().replace("ё", "е")
    text = re.sub(r"[^\w\s]", " ", text)
    return " ".join(text.split())


def fetch_json(url, cache_name):
    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / cache_name

    if cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))

    request = urllib.request.Request(url, headers={"User-Agent": "lapki"})
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.loads(response.read().decode("utf-8"))

    cache_file.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    time.sleep(0.3)
    return result


def parse_requirement(text):
    """Возвращает разобранное требование или None, если его не разобрать."""
    names = []
    rest = text

    for match in QUOTED.finditer(text):
        variants = [match.group(1)]
        inner = re.match(r"^(.*?)\s*\(([^)]*)\)\s*$", match.group(1))
        if inner:
            variants += [inner.group(1), inner.group(2)]
        if match.group(2):
            variants.append(match.group(2))
        names.append([v.strip() for v in variants if v.strip()])
    rest = QUOTED.sub(" ", rest)

    result = {}

    if not names and ACHIEVEMENT_PREFIX.match(rest):
        tail = ACHIEVEMENT_PREFIX.sub("", rest).strip(" .")
        names = [[part.strip()] for part in re.split(r"\s+и\s+", tail)]
        rest = ""

    for pattern, key in [(HOURS, "hours"), (COUNT, "count"), (PERCENT, "percent")]:
        found = pattern.findall(rest)
        if len(found) > 1:
            return None
        if found:
            result[key] = int(found[0])
            rest = pattern.sub(" ", rest)

    # "или" ищем без названий в кавычках: "Пан или пропал" - это одна ачивка.
    unquoted = QUOTED.sub(" ", text)
    mode = "any" if re.search(r"\bили\b", unquoted, re.IGNORECASE) else "all"

    if FILLER.sub(" ", rest).strip():
        return None

    if not names and not result:
        return None

    result["names"] = names
    result["mode"] = mode
    return result


def find_apps(game):
    hint = APP_HINTS.get(game.casefold())
    if hint is not None:
        return hint, "подсказка"

    term = urllib.parse.quote(game)
    url = f"https://store.steampowered.com/api/storesearch/?term={term}&cc=us&l=english"
    items = [
        item for item in fetch_json(url, f"search-{normalize(game)}.json").get("items", [])
        if item.get("type") == "app"
    ]

    if not items:
        return [], "не найдено"

    for item in items:
        if normalize(item["name"]) == normalize(game):
            return [item["id"]], item["name"]

    return [items[0]["id"]], f"≈ {items[0]['name']}"


def load_schema(appid, key):
    names = {}

    for language in ["russian", "english"]:
        url = (
            "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/"
            f"?key={key}&appid={appid}&l={language}"
        )
        game = fetch_json(url, f"schema-{appid}-{language}.json").get("game", {})
        achievements = game.get("availableGameStats", {}).get("achievements", [])

        for achievement in achievements:
            names.setdefault(normalize(achievement["displayName"]), achievement["name"])

    return names


def match_achievement(variants, schema):
    for variant in variants:
        wanted = normalize(variant)
        if wanted in schema:
            return schema[wanted]

    for variant in variants:
        wanted = normalize(variant)
        if not wanted:
            continue
        found = {api for name, api in schema.items() if wanted in name}
        if len(found) == 1:
            return found.pop()

    return None


# Строка с проблемой остаётся без "check", чтобы следующий запуск попробовал снова.
RETRY = object()


def build_check(item, key, report):
    label = f"{item['game']} - {item['requirement']}"
    parsed = parse_requirement(item["requirement"])

    if parsed is None:
        report["manual"].append(label)
        return None

    apps, found_as = find_apps(item["game"])
    if not apps:
        report["problems"].append(f"{label}: игра не найдена в Steam")
        return RETRY

    check = {"apps": apps}

    if parsed["names"]:
        achievements = {}
        for variants in parsed["names"]:
            matched = False
            for appid in apps:
                api_name = match_achievement(variants, load_schema(appid, key))
                if api_name:
                    achievements.setdefault(str(appid), []).append(api_name)
                    matched = True
            if not matched:
                report["problems"].append(
                    f"{label}: ачивка '{variants[0]}' не найдена ({found_as})"
                )
                return RETRY
        check["achievements"] = achievements
        check["mode"] = parsed["mode"]

    for field in ["percent", "count", "hours"]:
        if field in parsed:
            check[field] = parsed[field]

    report["auto"].append(f"{label}  →  {found_as} {apps}")
    return check


def main():
    key = os.environ.get("STEAM_API_KEY")
    if not key:
        raise SystemExit("Нужна переменная окружения STEAM_API_KEY")

    force = "--force" in sys.argv
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    report = {"auto": [], "manual": [], "problems": []}

    for category in CATEGORIES:
        for item in data.get(category, []):
            if "check" in item and not force:
                continue
            # Строки "любая игра" и "N из списка" поиск Steam не разберёт -
            # они размечены вручную.
            manual = item.get("check") or {}
            if manual.get("anyGame") or manual.get("pick"):
                continue
            check = build_check(item, key, report)
            if check is not RETRY:
                item["check"] = check

    DATA_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8"
    )

    for title, key_name in [
        ("Размечено автоматически", "auto"),
        ("Только ручная проверка", "manual"),
        ("Требуют внимания", "problems"),
    ]:
        print(f"\n== {title}: {len(report[key_name])}")
        for line in report[key_name]:
            print("  ", line)


if __name__ == "__main__":
    main()
