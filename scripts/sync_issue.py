import json
import os
import re
from pathlib import Path

DATA_FILE = Path("data.json")
MAX_POINTS = {"Потные": 10, "Мега": 50, "Сломанные": 500}

TRUSTED_ACTIONS = {"opened", "labeled", "unlabeled"}

issue = json.loads(os.environ["ISSUE_JSON"])
action = os.environ.get("EVENT_ACTION", "")
issue_number = issue["number"]
body = issue.get("body") or ""

labels = {
    label["name"].strip().casefold()
    for label in issue.get("labels", [])
}


def get_field(name):
    pattern = rf"^### {re.escape(name)}\s*\n+([\s\S]*?)(?=\n### |\Z)"
    match = re.search(pattern, body, re.MULTILINE)

    if not match:
        return ""

    value = match.group(1).strip()
    return "" if value == "_No response_" else value


# Поле "Описание" нужно только при рассмотрении и в data.json не попадает.
nickname = get_field("Ник")
game = get_field("Игра")
requirement = get_field("Требование")
points = get_field("Кол-во баллов")
category = get_field("Категория")

if not nickname or not game or not requirement or not points:
    raise SystemExit(
        "Не удалось прочитать поля Issue. Проверьте форму и заголовки полей."
    )

if category not in MAX_POINTS:
    raise SystemExit(f"Неизвестная категория: {category}")

try:
    points = int(points)
except ValueError:
    raise SystemExit(f"Кол-во баллов должно быть целым числом: {points}")

if not 1 <= points <= MAX_POINTS[category]:
    raise SystemExit(
        f"Кол-во баллов для категории '{category}' должно быть "
        f"от 1 до {MAX_POINTS[category]}, указано: {points}"
    )


def get_steam_check():
    appid = get_field("Steam appid")
    if not appid:
        return None

    # isdigit() пропускает "²" и "٣", на которых int() падает.
    if not re.fullmatch(r"[0-9]+", appid):
        raise SystemExit(f"Steam appid должен быть числом: {appid}")

    # Без ведущих нулей, чтобы ключ ачивок совпадал с appid в apps.
    appid = str(int(appid))
    check = {"apps": [int(appid)]}

    achievements = re.findall(
        r"^- `([^`]+)`", get_field("Достижения Steam"), re.MULTILINE
    )
    if achievements:
        check["achievements"] = {appid: achievements}
        check["mode"] = "all"

    for name, key in [("Процент достижений", "percent"), ("Часы в игре", "hours")]:
        value = get_field(name)
        if not value:
            continue
        if not re.fullmatch(r"[0-9]+", value):
            raise SystemExit(f"Поле '{name}' должно быть числом: {value}")
        check[key] = int(value)

    return check if len(check) > 1 else None


steam_check = get_steam_check()

if "принято" in labels:
    status = "принято"
elif "отказано" in labels:
    status = "отказано"
else:
    status = "на рассмотрении"

if status == "принято" and action not in TRUSTED_ACTIONS:
    print(
        f"Issue #{issue_number} уже принят, событие '{action}' игнорируется. "
        "Чтобы применить правки, снимите и снова поставьте метку 'принято'."
    )
    raise SystemExit(0)

if DATA_FILE.exists():
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
else:
    data = {}

for name in ["Потные", "Мега", "Сломанные", "Предложения"]:
    data.setdefault(name, [])

for name in ["Потные", "Мега", "Сломанные", "Предложения"]:
    data[name] = [
        item for item in data[name]
        if str(item.get("issue")) != str(issue_number)
    ]

entry = {
    "issue": issue_number,
    "nickname": nickname,
    "game": game,
    "requirement": requirement,
    "points": points
}

proposal_entry = {**entry, "status": status}
data["Предложения"].append(proposal_entry)


if status == "принято":
    if steam_check:
        entry = {**entry, "check": steam_check}
    data[category].append(entry)

DATA_FILE.write_text(
    json.dumps(data, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8"
)
