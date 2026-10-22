const categories = ["Потные", "Мега", "Сломанные", "Предложения"];

const tableHead = document.querySelector("#table-head");
const tableBody = document.querySelector("#table-body");
const searchInput = document.querySelector("#search");
const sortSelect = document.querySelector("#sort");
const proposalStatusFilter = document.querySelector("#proposal-status-filter");
const statusSelect = document.querySelector("#status-filter");
const emptyMessage = document.querySelector("#empty-message");
const tableHint = document.querySelector("#table-hint");
const tabs = [...document.querySelectorAll(".tab")];

let data = {};
let currentCategory = "Потные";

// Отметки выполненного. Пока профиль Steam не проверялся, это простой
// чек-лист в браузере. После проверки отметки хранятся для профиля:
//   auto    - строки, выполненные по данным Steam;
//   added   - строки, добавленные вручную;
//   removed - строки из auto, которые человек убрал из подсчёта.
const completedKey = "lapki-table-completed";
const profileKey = "lapki-profile";

function loadStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function saveStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

let currentProfile = loadStorage(profileKey, null);

function marksKey() {
  return `lapki-marks:${currentProfile.steamid}`;
}

function getMarks() {
  const saved = currentProfile && loadStorage(marksKey(), null);

  if (saved) {
    return {
      auto: new Set(saved.auto),
      added: new Set(saved.added),
      removed: new Set(saved.removed)
    };
  }

  // Старые отметки таблицы становятся ручными отметками первого профиля.
  return {
    auto: new Set(),
    added: new Set(loadStorage(completedKey, [])),
    removed: new Set()
  };
}

function saveMarks(marks) {
  if (!currentProfile) {
    saveStorage(completedKey, [...marks.added]);
    return;
  }

  saveStorage(marksKey(), {
    auto: [...marks.auto],
    added: [...marks.added],
    removed: [...marks.removed]
  });

  // Старые отметки уже перешли к этому профилю - другим они не достаются.
  try {
    localStorage.removeItem(completedKey);
  } catch {}
}

function isDone(marks, rowId) {
  return marks.added.has(rowId) || (marks.auto.has(rowId) && !marks.removed.has(rowId));
}

function toggleMark(rowId) {
  const marks = getMarks();

  if (isDone(marks, rowId)) {
    marks.added.delete(rowId);
    if (marks.auto.has(rowId)) marks.removed.add(rowId);
  } else {
    marks.removed.delete(rowId);
    if (!marks.auto.has(rowId)) marks.added.add(rowId);
  }

  saveMarks(marks);
  onMarksChange();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function getRowId(category, item) {
  return item.issue
    ? `issue:${item.issue}`
    : `${category}:${item.game}:${item.requirement}`;
}

function render() {
  const isSuggestions = currentCategory === "Предложения";
  proposalStatusFilter.hidden = !isSuggestions;

  const marks = getMarks();
  const query = searchInput.value.trim().toLocaleLowerCase("ru");

  // Строки предложений делят отметку с принятой строкой в категории
  // (общий issue:N), поэтому здесь они только для просмотра.
  tableHint.textContent = isSuggestions
    ? "Отметить выполненным можно принятое предложение - во вкладке его категории."
    : currentProfile
    ? `Отметки профиля ${currentProfile.name}. Нажмите на строку, чтобы добавить её в подсчёт баллов или убрать из него.`
    : "Нажмите на строку, чтобы отметить её выполненной. Отметка сохраняется в этом браузере.";
  const sortMode = sortSelect.value;

  tableHead.innerHTML = `
    <tr>
      ${isSuggestions ? "<th>Ник</th>" : ""}
      <th>Игра</th>
      <th>Требование</th>
      <th>Кол-во баллов</th>
      ${isSuggestions ? "<th>Статус</th>" : ""}
    </tr>
  `;

  let rows = [...(data[currentCategory] || [])].filter(item =>
    String(item.game).toLocaleLowerCase("ru").includes(query)
  );

  if (isSuggestions && statusSelect.value) {
    rows = rows.filter(item =>
      String(item.status || "на рассмотрении")
        .toLocaleLowerCase("ru") === statusSelect.value
    );
  }

  rows.sort((a, b) => {
    if (sortMode === "name-asc") {
      return String(a.game).localeCompare(String(b.game), "ru", { numeric: true });
    }

    if (sortMode === "name-desc") {
      return String(b.game).localeCompare(String(a.game), "ru", { numeric: true });
    }

    if (sortMode === "points-asc") {
      return Number(a.points) - Number(b.points);
    }

    return Number(b.points) - Number(a.points);
  });

  tableBody.innerHTML = "";

  rows.forEach(item => {
    const rowId = getRowId(currentCategory, item);

    const row = document.createElement("tr");

    if (isDone(marks, rowId)) {
      row.classList.add("done");
    }

    // В обычных категориях ник виден при наведении на строку.
    if (!isSuggestions && item.nickname) {
      row.title = `Предложил(а): ${item.nickname}`;
    }

    row.innerHTML = `
      ${isSuggestions ? `<td>${escapeHtml(item.nickname || "-")}</td>` : ""}
      <td>${escapeHtml(item.game)}</td>
      <td>${escapeHtml(item.requirement)}</td>
      <td>${escapeHtml(item.points)}</td>
      ${isSuggestions
        ? `<td>${escapeHtml(item.status || "на рассмотрении")}</td>`
        : ""}
    `;

    if (isSuggestions) {
      row.classList.add("readonly");
    } else {
      row.addEventListener("click", () => toggleMark(rowId));
    }

    tableBody.appendChild(row);
  });

  emptyMessage.hidden = rows.length > 0;
}

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    currentCategory = tab.dataset.category;

    tabs.forEach(item => {
      item.classList.toggle("active", item === tab);
    });

    render();
  });
});

searchInput.addEventListener("input", render);
sortSelect.addEventListener("change", render);
statusSelect.addEventListener("change", render);

fetch("data.json")
  .then(response => {
    if (!response.ok) {
      throw new Error("Не удалось загрузить data.json");
    }
    return response.json();
  })
  .then(json => {
    data = json;

    categories.forEach(category => {
      if (!Array.isArray(data[category])) {
        data[category] = [];
      }
    });

    render();
  })
  .catch(error => {
    tableBody.innerHTML =
      `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
  });

// Проверка лапок по Steam. Адрес Worker появится после `wrangler deploy`.
const steamApiUrl = "https://lapki-steam.masonhades.workers.dev";
const categoryRank = ["Сломанные", "Мега", "Потные"];
const appsPerRequest = 40;

const steamForm = document.querySelector("#steam-form");
const steamUserInput = document.querySelector("#steam-user");
const steamResult = document.querySelector("#steam-result");

// С payload отправляет POST с JSON, без него - обычный GET.
async function steamRequest(path, params, payload) {
  const url = new URL(path, steamApiUrl);
  Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, value));

  const response = await fetch(url, payload && {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || "Не удалось получить данные из Steam");
  }

  return body;
}

// Проверяет требование строки для одной игры. Возвращает, выполнено ли
// оно, и текст с прогрессом по каждому условию.
function evaluateApp(check, appid, minutes, stats) {
  const progress = [];
  let done = true;

  if (check.hours) {
    const hours = Math.floor(minutes / 60);
    progress.push(`${hours} из ${check.hours} ч`);
    done &&= hours >= check.hours;
  }

  const needsAchievements =
    check.percent || check.count || check.achievements || check.pick;
  if (!needsAchievements) {
    return { done, progress };
  }

  if (!stats || stats.error || !stats.total) {
    return { done: false, progress: [...progress, "нет данных об ачивках"] };
  }

  const unlocked = new Set(stats.unlocked);

  if (check.percent) {
    // Сначала умножаем: 57 / 100 * 100 даёт 56.99999999999999.
    const percent = Math.floor(unlocked.size * 100 / stats.total);
    progress.push(`${percent}% из ${check.percent}%`);
    done &&= percent >= check.percent;
  }

  if (check.count) {
    progress.push(`${unlocked.size} из ${check.count} ачивок`);
    done &&= unlocked.size >= check.count;
  }

  if (check.achievements) {
    const required = check.achievements[appid] || [];
    const got = required.filter(name => unlocked.has(name)).length;
    const enough = check.mode === "any" ? got > 0 : got === required.length;

    progress.push(`нужные ачивки: ${got} из ${check.mode === "any" ? 1 : required.length}`);
    done &&= required.length > 0 && enough;
  }

  // Нужно pick.count любых ачивок из списка, например 2 коллекции War Thunder.
  if (check.pick) {
    const options = check.pick.achievements[appid] || [];
    const got = options.filter(name => unlocked.has(name)).length;

    progress.push(`ачивки на выбор: ${got} из ${check.pick.count}`);
    done &&= got >= check.pick.count;
  }

  return { done, progress };
}

// appid всех игр из таблицы - они не подходят для строки "любая игра".
function getListedApps() {
  const listed = new Set();

  categoryRank.forEach(category => {
    (data[category] || []).forEach(item => {
      [...(item.check?.apps || []), ...(item.check?.exclude || [])]
        .forEach(appid => listed.add(appid));
    });
  });

  return listed;
}

// Строка "любая игра" засчитывается за каждую подходящую игру отдельно.
function evaluateAnyGame(category, item, games, achievements, names, listed) {
  const completed = [];
  const inProgress = [];

  Object.keys(games).map(Number)
    .filter(appid => !listed.has(appid))
    .forEach(appid => {
      const result = evaluateApp(item.check, appid, games[appid], achievements[appid]);
      const title = `${item.game}: ${names[appid] || appid}`;

      if (result.done) {
        completed.push({ category, item, title, doneApps: [appid] });
      } else {
        inProgress.push({ category, item, title, progress: result.progress });
      }
    });

  return { completed, inProgress };
}

// Что выполнено по данным Steam, без учёта ручных отметок.
function evaluateSteam(games, achievements, names) {
  const completed = [];
  const inProgress = [];
  const listed = getListedApps();

  categoryRank.forEach(category => {
    (data[category] || []).forEach(item => {
      if (!item.check) return;

      if (item.check.anyGame) {
        const result = evaluateAnyGame(category, item, games, achievements, names, listed);
        completed.push(...result.completed);
        inProgress.push(...result.inProgress);
        return;
      }

      const results = item.check.apps
        .filter(appid => appid in games)
        .map(appid => ({
          appid,
          ...evaluateApp(item.check, appid, games[appid], achievements[appid])
        }));

      if (!results.length) return;

      const doneApps = results.filter(result => result.done).map(result => result.appid);

      if (doneApps.length) {
        completed.push({ category, item, doneApps });
      } else {
        inProgress.push({ category, item, progress: results[0].progress });
      }
    });
  });

  return { completed, inProgress };
}

function gameKey(item) {
  return String(item.game).toLocaleLowerCase("ru").replace(/\s+/g, " ").trim();
}

// Игра засчитывается один раз - в самой высокой категории, где она выполнена.
// Строки Steam сравниваются по appid, как раньше. У ручных строк appid часто
// нет, поэтому с ними одна и та же игра определяется по названию.
function countPoints(steam, marks) {
  const rowId = entry => getRowId(entry.category, entry.item);
  const autoIds = new Set(steam.completed.map(rowId));

  const entries = steam.completed.filter(entry => !marks.removed.has(rowId(entry)));
  const removed = steam.completed.filter(entry => marks.removed.has(rowId(entry)));
  let manualLeft = 0;

  categoryRank.forEach(category => {
    (data[category] || []).forEach(item => {
      const id = getRowId(category, item);

      if (marks.added.has(id) && !autoIds.has(id)) {
        entries.push({ category, item, manual: true });
      } else if (!item.check && !marks.added.has(id)) {
        manualLeft += 1;
      }
    });
  });

  entries.sort((a, b) =>
    categoryRank.indexOf(a.category) - categoryRank.indexOf(b.category) ||
    Number(b.item.points) - Number(a.item.points)
  );

  const usedApps = new Set();
  const autoGames = new Set();
  const manualGames = new Set();
  const counted = [];
  const skipped = [];

  entries.forEach(entry => {
    // Строка "любая игра" - это разные игры, по названию её не сравниваем.
    const game = entry.item.check?.anyGame ? null : gameKey(entry.item);

    if (entry.manual) {
      if (game && (autoGames.has(game) || manualGames.has(game))) {
        skipped.push(entry);
        return;
      }

      if (game) manualGames.add(game);
      counted.push(entry);
      return;
    }

    const appid = entry.doneApps.find(id => !usedApps.has(id));

    if (appid === undefined || (game && manualGames.has(game))) {
      skipped.push(entry);
      return;
    }

    usedApps.add(appid);
    if (game) autoGames.add(game);
    counted.push(entry);
  });

  const inProgress = steam.inProgress.filter(entry => !marks.added.has(rowId(entry)));
  const total = counted.reduce((sum, entry) => sum + Number(entry.item.points), 0);
  return { total, counted, skipped, removed, inProgress, manualLeft };
}

function rowsTable(entries, extraColumn) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Категория</th>
            <th>Игра</th>
            <th>Требование</th>
            <th>${extraColumn}</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map(entry => `
            <tr>
              <td>${escapeHtml(entry.category)}</td>
              <td>
                ${escapeHtml(entry.title || entry.item.game)}
                ${entry.manual ? `<span class="badge">вручную</span>` : ""}
              </td>
              <td>${escapeHtml(entry.item.requirement)}</td>
              <td>${escapeHtml(entry.progress ? entry.progress.join(", ") : entry.item.points)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// Результат последней проверки - чтобы пересчитывать баллы при ручных отметках.
let lastCheck = null;

function renderSteamResult() {
  const { profile, steam } = lastCheck;
  const result = countPoints(steam, getMarks());

  // При пересчёте списки остаются раскрытыми или свёрнутыми, как были.
  // Впервые показанный список засчитанных раскрыт, остальные свёрнуты.
  const wasOpen = new Map(
    [...steamResult.querySelectorAll("details[data-key]")]
      .map(details => [details.dataset.key, details.open])
  );
  const details = (key, summary, entries, column) => entries.length ? `
    <details data-key="${key}" ${wasOpen.get(key) ?? key === "counted" ? "open" : ""}>
      <summary>${summary} (${entries.length})</summary>
      ${rowsTable(entries, column)}
    </details>
  ` : "";

  steamResult.innerHTML = `
    <div class="steam-profile">
      ${profile.avatar ? `<img src="${escapeHtml(profile.avatar)}" alt="">` : ""}
      <span>${escapeHtml(profile.name)}</span>
    </div>

    <p class="steam-total">Итого: <strong>${result.total}</strong> баллов</p>

    ${result.counted.length
      ? details("counted", "Засчитано", result.counted, "Баллы")
      : "<p>Пока нет выполненных требований.</p>"}

    ${details("skipped", "Не засчитано - игра уже засчитана в более высокой категории", result.skipped, "Баллы")}
    ${details("removed", "Убрано вручную", result.removed, "Баллы")}
    ${details("progress", "В процессе", result.inProgress, "Прогресс")}

    <button id="manual-open" class="button" type="button">Добавить вручную</button>

    <p class="steam-note">
      Ещё ${result.manualLeft} требований (ранги, рекорды, записи) не проверяются через Steam.
      Если что-то из них выполнено, добавьте вручную - или нажмите на строку в таблице ниже.
    </p>
  `;

  steamResult.querySelector("#manual-open").addEventListener("click", openManualDialog);
  return result;
}

function onMarksChange() {
  render();

  if (lastCheck) {
    const result = renderSteamResult();
    manualTotal.innerHTML = `Итого: <strong>${result.total}</strong> баллов`;
  }
}

// Окно ручных отметок: те же отметки, что и клик по строке в таблице.
const manualDialog = document.querySelector("#manual-dialog");
const manualSearch = document.querySelector("#manual-search");
const manualList = document.querySelector("#manual-list");
const manualTotal = document.querySelector("#manual-total");

function renderManualList() {
  const marks = getMarks();
  const query = manualSearch.value.trim().toLocaleLowerCase("ru");
  const rows = [];

  categoryRank.forEach(category => {
    (data[category] || [])
      .filter(item => String(item.game).toLocaleLowerCase("ru").includes(query))
      .sort((a, b) => String(a.game).localeCompare(String(b.game), "ru", { numeric: true }))
      .forEach(item => rows.push({ category, item, id: getRowId(category, item) }));
  });

  manualList.innerHTML = rows.map(({ category, item, id }) => `
    <label class="manual-item">
      <input type="checkbox" data-id="${escapeHtml(id)}" ${isDone(marks, id) ? "checked" : ""}>
      <span>
        <strong>${escapeHtml(item.game)}</strong> - ${escapeHtml(item.requirement)}
        <small>
          ${escapeHtml(category)} · ${escapeHtml(item.points)} б.
          ${marks.auto.has(id) ? " · выполнено по Steam" : ""}
        </small>
      </span>
    </label>
  `).join("") || `<p class="steam-note">Ничего не найдено.</p>`;
}

function openManualDialog() {
  manualSearch.value = "";
  renderManualList();
  onMarksChange();
  manualDialog.showModal();
}

manualSearch.addEventListener("input", renderManualList);

// Галочка уже показывает новое состояние, поэтому список не перерисовываем.
manualList.addEventListener("change", event => toggleMark(event.target.dataset.id));

manualDialog.addEventListener("click", event => {
  if (event.target === manualDialog || event.target.closest("[data-close]")) {
    manualDialog.close();
  }
});

steamForm.addEventListener("submit", async event => {
  event.preventDefault();
  steamResult.hidden = false;

  if (!steamApiUrl) {
    steamResult.innerHTML = "<p>Проверка по Steam ещё не настроена.</p>";
    return;
  }

  const button = steamForm.querySelector("button");
  button.disabled = true;
  steamResult.innerHTML = "<p>Проверяем профиль…</p>";

  try {
    const profile = await steamRequest("/profile", { user: steamUserInput.value });
    const appids = Object.keys(profile.games);
    const achievements = {};

    // Пачки по appsPerRequest игр запрашиваются одновременно.
    const batches = [];
    for (let start = 0; start < appids.length; start += appsPerRequest) {
      batches.push(appids.slice(start, start + appsPerRequest));
    }

    let checked = 0;
    steamResult.innerHTML = `<p>Проверяем ачивки: 0 из ${appids.length} игр…</p>`;

    await Promise.all(batches.map(async batch => {
      const result = await steamRequest("/achievements", {
        steamid: profile.steamid,
        appids: batch.join(",")
      });
      Object.assign(achievements, result.achievements);

      checked += batch.length;
      steamResult.innerHTML =
        `<p>Проверяем ачивки: ${checked} из ${appids.length} игр…</p>`;
    }));

    // В data.json appid - числа, а в ответах Worker - ключи-строки.
    const games = Object.fromEntries(
      Object.entries(profile.games).map(([appid, minutes]) => [Number(appid), minutes])
    );
    const stats = Object.fromEntries(
      Object.entries(achievements).map(([appid, value]) => [Number(appid), value])
    );

    const steam = evaluateSteam(games, stats, profile.names || {});

    currentProfile = { steamid: profile.steamid, name: profile.name };
    saveStorage(profileKey, currentProfile);

    const marks = getMarks();
    marks.auto = new Set(steam.completed.map(entry => getRowId(entry.category, entry.item)));
    saveMarks(marks);

    lastCheck = { profile, steam };
    onMarksChange();
  } catch (error) {
    steamResult.innerHTML = `<p class="steam-error">${escapeHtml(error.message)}</p>`;
  } finally {
    button.disabled = false;
  }
});

// Форма предложения: Worker создаёт Issue, дальше всё как раньше.
const maxPoints = { "Потные": 10, "Мега": 50, "Сломанные": 500 };
const nicknameKey = "lapki-nickname";
const gameNoteText =
  "Выберите игру из списка Steam, чтобы требование проверялось автоматически. " +
  "Игру не из Steam просто впишите.";

const suggestDialog = document.querySelector("#suggest-dialog");
const suggestForm = document.querySelector("#suggest-form");
const suggestGameInput = document.querySelector("#suggest-game");
const suggestGames = document.querySelector("#suggest-games");
const suggestGameNote = document.querySelector("#suggest-game-note");
const suggestSteam = document.querySelector("#suggest-steam");
const suggestAchNote = document.querySelector("#suggest-ach-note");
const suggestAchFilter = document.querySelector("#suggest-ach-filter");
const suggestAchievements = document.querySelector("#suggest-achievements");
const suggestStatus = document.querySelector("#suggest-status");
const suggestFields = suggestForm.elements;

let selectedApp = null;
let appAchievements = [];
let selectedAchievements = new Set();
let generatedRequirement = "";
let searchTimer = null;
let searchCounter = 0;

function showSuggestStatus(html, type) {
  suggestStatus.hidden = !html;
  suggestStatus.className = `suggest-status ${type || ""}`;
  suggestStatus.innerHTML = html;
}

// Требование подставляется из выбранного в Steam, пока его не изменили вручную.
function updateRequirement() {
  const parts = [];
  const names = appAchievements
    .filter(achievement => selectedAchievements.has(achievement.name))
    .map(achievement => `"${achievement.displayName}"`);

  if (names.length) {
    parts.push(`${names.length > 1 ? "Достижения" : "Достижение"} ${names.join(", ")}`);
  }
  if (suggestFields.percent.value) parts.push(`${suggestFields.percent.value}% достижений`);
  if (suggestFields.hours.value) parts.push(`${suggestFields.hours.value}+ часов`);

  const text = parts.join(", ");
  const requirement = suggestFields.requirement;

  if (!requirement.value.trim() || requirement.value === generatedRequirement) {
    requirement.value = text;
  }
  generatedRequirement = text;
}

function renderAchievements() {
  const query = suggestAchFilter.value.trim().toLocaleLowerCase("ru");
  const shown = appAchievements.filter(achievement =>
    `${achievement.displayName} ${achievement.description}`
      .toLocaleLowerCase("ru").includes(query)
  );

  suggestAchievements.innerHTML = shown.map(achievement => `
    <label class="suggest-achievement">
      <input type="checkbox" value="${escapeHtml(achievement.name)}"
        ${selectedAchievements.has(achievement.name) ? "checked" : ""}>
      <img src="${escapeHtml(achievement.icon)}" alt="" loading="lazy">
      <span>
        ${escapeHtml(achievement.displayName)}
        ${achievement.description ? `<small>${escapeHtml(achievement.description)}</small>` : ""}
      </span>
    </label>
  `).join("") || `<p class="steam-note">Ничего не найдено.</p>`;
}

function updateAchievementNote() {
  suggestAchNote.textContent = selectedAchievements.size
    ? `Выбрано достижений: ${selectedAchievements.size}. Нужно будет получить все.`
    : "Отметьте достижения, которые обязательно нужно получить, если такие есть.";
}

function resetSteam() {
  selectedApp = null;
  appAchievements = [];
  selectedAchievements = new Set();
  suggestSteam.hidden = true;
  suggestFields.percent.value = "";
  suggestFields.hours.value = "";
  suggestAchFilter.value = "";
  suggestGameNote.textContent = gameNoteText;
  updateRequirement();
}

async function selectGame(game) {
  suggestGames.hidden = true;
  suggestGameInput.value = game.name;
  resetSteam();
  selectedApp = game;

  suggestSteam.hidden = false;
  suggestAchFilter.hidden = true;
  suggestAchievements.hidden = true;
  suggestAchNote.textContent = "Загружаем достижения…";
  suggestGameNote.textContent = `Steam appid: ${game.appid}`;

  try {
    const { achievements } = await steamRequest("/schema", { appid: game.appid });
    if (selectedApp !== game) return;

    appAchievements = achievements;
    if (!achievements.length) {
      suggestAchNote.textContent = "У игры нет достижений в Steam - проверить можно только часы.";
      return;
    }

    suggestAchFilter.hidden = achievements.length < 10;
    suggestAchievements.hidden = false;
    updateAchievementNote();
    renderAchievements();
  } catch (error) {
    if (selectedApp === game) suggestAchNote.textContent = error.message;
  }
}

async function searchGames(term) {
  const counter = ++searchCounter;

  try {
    const { games } = await steamRequest("/search", { term });
    if (counter !== searchCounter) return;

    suggestGames.innerHTML = games.map((game, index) => `
      <li>
        <button type="button" data-index="${index}">
          ${game.image ? `<img src="${escapeHtml(game.image)}" alt="">` : ""}
          <span>${escapeHtml(game.name)}</span>
        </button>
      </li>
    `).join("");

    suggestGames.querySelectorAll("button").forEach(button => {
      button.addEventListener("click", () => selectGame(games[button.dataset.index]));
    });
    suggestGames.hidden = !games.length;
  } catch {
    if (counter === searchCounter) suggestGames.hidden = true;
  }
}

function updatePointsLimit() {
  const limit = maxPoints[suggestFields.category.value];
  suggestFields.points.max = limit;
  suggestFields.points.placeholder = `1–${limit}`;
}

document.querySelector("#suggest-open").addEventListener("click", () => {
  try {
    suggestFields.nickname.value ||= localStorage.getItem(nicknameKey) || "";
  } catch {}
  suggestDialog.showModal();
});

suggestDialog.addEventListener("click", event => {
  if (event.target === suggestDialog || event.target.closest("[data-close]")) {
    suggestDialog.close();
  }
});

suggestGameInput.addEventListener("input", () => {
  if (selectedApp) resetSteam();

  clearTimeout(searchTimer);
  const term = suggestGameInput.value.trim();

  if (term.length < 2 || !steamApiUrl) {
    searchCounter += 1;
    suggestGames.hidden = true;
    return;
  }

  searchTimer = setTimeout(() => searchGames(term), 300);
});

// Список закрывается, когда фокус уходит и с поля, и со списка.
suggestGameInput.parentElement.addEventListener("focusout", event => {
  if (!suggestGameInput.parentElement.contains(event.relatedTarget)) {
    suggestGames.hidden = true;
  }
});

suggestAchFilter.addEventListener("input", renderAchievements);

suggestAchievements.addEventListener("change", event => {
  const name = event.target.value;
  if (event.target.checked) {
    selectedAchievements.add(name);
  } else {
    selectedAchievements.delete(name);
  }
  updateAchievementNote();
  updateRequirement();
});

suggestFields.percent.addEventListener("input", updateRequirement);
suggestFields.hours.addEventListener("input", updateRequirement);
suggestFields.category.addEventListener("change", updatePointsLimit);

suggestForm.addEventListener("submit", async event => {
  event.preventDefault();

  if (!suggestForm.checkValidity()) {
    suggestForm.reportValidity();
    return;
  }

  const button = suggestForm.querySelector("button[type=submit]");
  button.disabled = true;
  showSuggestStatus("Отправляем…");

  const payload = {
    nickname: suggestFields.nickname.value,
    game: suggestFields.game.value,
    requirement: suggestFields.requirement.value,
    description: suggestFields.description.value,
    points: Number(suggestFields.points.value),
    category: suggestFields.category.value
  };

  if (selectedApp) {
    Object.assign(payload, {
      appid: selectedApp.appid,
      achievements: [...selectedAchievements],
      percent: suggestFields.percent.value,
      hours: suggestFields.hours.value
    });
  }

  try {
    const issue = await steamRequest("/suggest", {}, payload);

    try {
      localStorage.setItem(nicknameKey, payload.nickname.trim());
    } catch {}

    suggestForm.reset();
    resetSteam();
    updatePointsLimit();
    suggestFields.nickname.value = payload.nickname;

    showSuggestStatus(
      "Готово! Предложение появится во вкладке 'Предложения' через пару минут. " +
      `<a href="${escapeHtml(issue.url)}" target="_blank" rel="noopener">Issue #${issue.number}</a>`,
      "success"
    );
  } catch (error) {
    showSuggestStatus(escapeHtml(error.message), "error");
  } finally {
    button.disabled = false;
  }
});
