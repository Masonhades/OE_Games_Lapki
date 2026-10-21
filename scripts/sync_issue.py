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


nickname = get_field("Ник")
game = get_field("Игра")
requirement = get_field("Требование")
points = get_field("Кол-во баллов")
category = get_field("Категория")

if not nickname or not game or not requirement or not points:
    raise SystemExit(
        "Не удалось прочитать поля Issue. Проверьте форму и заголовки полей."
    )

if category not in VALID_CATEGORIES:
    raise SystemExit(f"Неизвестная категория: {category}")

try:
    points = int(points)
except ValueError:
    pass

if DATA_FILE.exists():
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
else:
    data = {}

for name in ["Потные", "Мега", "Сломанные", "Предложения"]:
    data.setdefault(name, [])

# Удаляем предыдущие копии этого Issue перед повторной синхронизацией.
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

if "принято" in labels:
    status = "принято"
elif "отказано" in labels:
    status = "отказано"
else:
    status = "на рассмотрении"

# Предложение остаётся во вкладке «Предложения» при любом статусе.
proposal_entry = {**entry, "status": status}
data["Предложения"].append(proposal_entry)

# Принятое предложение также появляется в выбранной категории.
if status == "принято":
    data[category].append(entry)

DATA_FILE.write_text(
    json.dumps(data, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8"
)
