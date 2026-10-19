import json
import os
import re
from pathlib import Path

DATA_FILE = Path("data.json")
VALID_CATEGORIES = {"Потные", "Мега", "Сломанные"}

issue = json.loads(os.environ["ISSUE_JSON"])
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


game = get_field("Игра")
requirement = get_field("Требование")
points = get_field("Кол-во баллов")
category = get_field("Категория")

if not game or not requirement or not points or category not in VALID_CATEGORIES:
    raise SystemExit(
        "Не удалось прочитать поля Issue. Проверьте названия полей в шаблоне формы."
    )

# Сохраняем баллы числом, если пользователь ввёл целое число.
try:
    points = int(points)
except ValueError:
    pass

if DATA_FILE.exists():
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
else:
    data = {}

for name in ["Потные", "Мега", "Трудные", "Предложения"]:
    data.setdefault(name, [])

# Удаляем прежнюю запись этого Issue из всех вкладок.
# Это позволяет менять статус или категорию без дубликатов.
for name in ["Потные", "Мега", "Трудные", "Предложения"]:
    data[name] = [
        item for item in data[name]
        if str(item.get("issue")) != str(issue_number)
    ]

entry = {
    "issue": issue_number,
    "game": game,
    "requirement": requirement,
    "points": points
}

if "принято" in labels:
    data[category].append(entry)
elif "отказано" in labels:
    entry["status"] = "отказано"
    data["Предложения"].append(entry)
else:
    entry["status"] = "на рассмотрении"
    data["Предложения"].append(entry)

DATA_FILE.write_text(
    json.dumps(data, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8"
)
