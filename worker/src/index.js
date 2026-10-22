// Посредник между сайтом и Steam Web API: хранит ключ и отдаёт сайту
// только данные об играх из таблицы.
//
// GET /profile?user=<ник, SteamID или ссылка на профиль>
//   → { steamid, name, avatar, games: { appid: минуты в игре },
//       names: { appid: название } }
//   Кроме игр из таблицы в games попадают игры, наигранные достаточно
//   для строки "любая игра" (check.anyGame); их названия - в names.
// GET /games?user=<ник, SteamID или ссылка на профиль>
//   → { steamid, games: [{ appid, name, minutes, icon }] } - все игры,
//     сначала самые наигранные.
// GET /achievements?steamid=<id>&appids=1,2,3
//   → { achievements: { appid: { total, unlocked: [apiname] } | { error } } }
// GET /search?term=<название>
//   → { games: [{ appid, name, image }] }
// GET /schema?appid=<id>
//   → { achievements: [{ name, displayName, description, icon }] }
// POST /suggest { nickname, game, requirement, points, category,
//                 appid?, achievements?, percent?, hours? }
//   → { number, url } - создаёт Issue в том же виде, что и форма на GitHub.

const STEAM = "https://api.steampowered.com";
const MAX_POINTS = { "Потные": 10, "Мега": 50, "Сломанные": 500 };

// Бесплатный план Cloudflare разрешает 50 запросов из одного вызова Worker.
const MAX_APPS_PER_REQUEST = 40;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isAllowedOrigin(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(item => item.trim());
  return allowed.includes(origin);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";

  return isAllowedOrigin(origin, env)
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin"
      }
    : {};
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

async function steam(env, path, params) {
  const url = new URL(STEAM + path);
  url.searchParams.set("key", env.STEAM_API_KEY);

  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }

  const response = await fetch(url);
  const body = await response.json().catch(() => null);
  return { ok: response.ok, body };
}

// appid всех игр, для которых в таблице есть автоматическая проверка,
// и сколько часов нужно для строки "любая игра" (null, если её нет).
async function getTable(env) {
  const response = await fetch(env.DATA_URL, {
    cf: { cacheTtl: 300, cacheEverything: true }
  });

  if (!response.ok) {
    throw new HttpError(502, "Не удалось загрузить таблицу");
  }

  const data = await response.json();
  const apps = new Set();
  let anyGameHours = null;

  for (const rows of Object.values(data)) {
    for (const row of rows) {
      for (const appid of row.check?.apps || []) {
        apps.add(String(appid));
      }

      if (row.check?.anyGame) {
        const hours = row.check.hours || 0;
        anyGameHours = anyGameHours === null ? hours : Math.min(anyGameHours, hours);
      }
    }
  }

  return { apps, anyGameHours };
}

function isAnyGame(table, minutes) {
  return table.anyGameHours !== null && minutes >= table.anyGameHours * 60;
}

async function getOwnedGames(env, steamid) {
  const { body } = await steam(env, "/IPlayerService/GetOwnedGames/v1/", {
    steamid,
    include_appinfo: "1",
    include_played_free_games: "1"
  });
  return body?.response?.games;
}

async function resolveSteamId(env, user) {
  const value = user.trim();
  const profileMatch = value.match(/steamcommunity\.com\/profiles\/(\d{17})/);
  if (profileMatch) return profileMatch[1];

  if (/^\d{17}$/.test(value)) return value;

  const vanityMatch = value.match(/steamcommunity\.com\/id\/([^/?#]+)/);
  const vanity = vanityMatch ? vanityMatch[1] : value;

  const { body } = await steam(env, "/ISteamUser/ResolveVanityURL/v1/", {
    vanityurl: vanity
  });

  if (body?.response?.success !== 1) {
    throw new HttpError(404, "Профиль Steam не найден");
  }

  return body.response.steamid;
}

const HIDDEN_GAMES =
  "Список игр скрыт. Откройте 'Сведения об играх' в настройках приватности Steam.";

async function handleGames(env, params) {
  const user = params.get("user");
  if (!user) throw new HttpError(400, "Укажите ник или SteamID");

  const steamid = await resolveSteamId(env, user);
  const ownedGames = await getOwnedGames(env, steamid);
  if (!ownedGames) throw new HttpError(403, HIDDEN_GAMES);

  return {
    steamid,
    games: ownedGames
      .sort((a, b) => b.playtime_forever - a.playtime_forever)
      .map(game => ({
        appid: game.appid,
        name: game.name,
        minutes: game.playtime_forever,
        icon: game.img_icon_url
          ? `https://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_icon_url}.jpg`
          : null
      }))
  };
}

async function handleProfile(env, params) {
  const user = params.get("user");
  if (!user) throw new HttpError(400, "Укажите ник или SteamID");

  const steamid = await resolveSteamId(env, user);

  const [summary, ownedGames, table] = await Promise.all([
    steam(env, "/ISteamUser/GetPlayerSummaries/v2/", { steamids: steamid }),
    getOwnedGames(env, steamid),
    getTable(env)
  ]);

  const player = summary.body?.response?.players?.[0];
  if (!player) throw new HttpError(404, "Профиль Steam не найден");

  if (!ownedGames) throw new HttpError(403, HIDDEN_GAMES);

  const games = {};
  const names = {};
  for (const game of ownedGames) {
    if (table.apps.has(String(game.appid))) {
      games[game.appid] = game.playtime_forever;
    } else if (isAnyGame(table, game.playtime_forever)) {
      games[game.appid] = game.playtime_forever;
      names[game.appid] = game.name;
    }
  }

  return {
    steamid,
    name: player.personaname,
    avatar: player.avatarmedium,
    games,
    names
  };
}

async function handleAchievements(env, params) {
  const steamid = params.get("steamid") || "";
  if (!/^\d{17}$/.test(steamid)) throw new HttpError(400, "Неверный SteamID");

  const appids = (params.get("appids") || "").split(",").filter(Boolean);
  if (appids.length > MAX_APPS_PER_REQUEST) {
    throw new HttpError(400, `Не больше ${MAX_APPS_PER_REQUEST} игр за запрос`);
  }

  const table = await getTable(env);
  const otherApps = appids.filter(appid => !table.apps.has(appid));

  // Игры не из таблицы разрешены, только если у игрока в них хватает
  // часов для строки "любая игра".
  if (otherApps.length) {
    const ownedGames = table.anyGameHours === null
      ? []
      : await getOwnedGames(env, steamid) || [];
    const minutes = Object.fromEntries(
      ownedGames.map(game => [String(game.appid), game.playtime_forever])
    );

    if (otherApps.some(appid => !isAnyGame(table, minutes[appid] ?? -1))) {
      throw new HttpError(400, "Игры нет в таблице");
    }
  }

  const results = await Promise.all(appids.map(async appid => {
    const { body } = await steam(env, "/ISteamUserStats/GetPlayerAchievements/v1/", {
      steamid,
      appid
    });
    const stats = body?.playerstats;

    if (!stats?.success || !Array.isArray(stats.achievements)) {
      return [appid, { error: stats?.error || "Нет данных" }];
    }

    return [appid, {
      total: stats.achievements.length,
      unlocked: stats.achievements
        .filter(item => item.achieved === 1)
        .map(item => item.apiname)
    }];
  }));

  return { achievements: Object.fromEntries(results) };
}

async function handleSearch(params) {
  const term = (params.get("term") || "").trim();
  if (term.length < 2) return { games: [] };

  const url = new URL("https://store.steampowered.com/api/storesearch/");
  url.searchParams.set("term", term);
  url.searchParams.set("cc", "us");
  url.searchParams.set("l", "english");

  const response = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
  const body = await response.json().catch(() => null);
  if (!body) throw new HttpError(502, "Поиск Steam не ответил");

  return {
    games: (body.items || [])
      .filter(item => item.type === "app")
      .slice(0, 8)
      .map(item => ({ appid: item.id, name: item.name, image: item.tiny_image }))
  };
}

async function getSchema(env, appid) {
  const { body } = await steam(env, "/ISteamUserStats/GetSchemaForGame/v2/", {
    appid,
    l: "russian"
  });

  return (body?.game?.availableGameStats?.achievements || []).map(item => ({
    name: item.name,
    displayName: item.displayName,
    description: item.description || "",
    icon: item.icon
  }));
}

async function handleSchema(env, params) {
  const appid = params.get("appid") || "";
  if (!/^\d+$/.test(appid)) throw new HttpError(400, "Неверный appid");

  return { achievements: await getSchema(env, appid) };
}

function textField(value, label, max, multiline = false) {
  let text = typeof value === "string" ? value.trim() : "";
  if (!multiline) text = text.replace(/\s+/g, " ");

  // Строки с ### сломали бы разбор полей Issue в sync_issue.py.
  text = text.replace(/^#+\s*/gm, "");

  if (!text) throw new HttpError(400, `Заполните поле "${label}"`);
  if (text.length > max) {
    throw new HttpError(400, `Поле "${label}" длиннее ${max} символов`);
  }
  return text;
}

function numberField(value, label, min, max) {
  if (value === undefined || value === null || value === "") return null;

  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new HttpError(400, `Поле "${label}" должно быть числом от ${min} до ${max}`);
  }
  return number;
}

// Поля Steam необязательны: без appid требование проверяется вручную.
async function readSteamFields(env, input) {
  const appid = numberField(input.appid, "Steam appid", 1, 1e9);
  if (appid === null) return null;

  const wanted = Array.isArray(input.achievements) ? input.achievements : [];
  const schema = wanted.length ? await getSchema(env, appid) : [];
  const byName = new Map(schema.map(item => [item.name, item]));

  if (wanted.some(name => !byName.has(name))) {
    throw new HttpError(400, "Таких достижений у игры нет");
  }

  return {
    appid,
    achievements: [...new Set(wanted)].map(name => byName.get(name)),
    percent: numberField(input.percent, "% достижений", 1, 100),
    hours: numberField(input.hours, "Часов в игре", 1, 100000)
  };
}

// Тот же формат, что у формы .github/ISSUE_TEMPLATE/suggestion.yml.
function issueBody(fields) {
  const section = (title, value) =>
    `### ${title}\n\n${value === null || value === "" ? "_No response_" : value}`;

  const parts = [
    "_Отправлено через форму на сайте._",
    section("Ник", fields.nickname),
    section("Игра", fields.game),
    section("Требование", fields.requirement),
    section("Описание", fields.description),
    section("Кол-во баллов", fields.points),
    section("Категория", fields.category)
  ];

  if (fields.steam) {
    const achievements = fields.steam.achievements
      .map(item => `- \`${item.name}\` - ${item.displayName.replace(/\s+/g, " ")}`)
      .join("\n");

    parts.push(
      section("Steam appid", fields.steam.appid),
      section("Достижения Steam", achievements),
      section("Процент достижений", fields.steam.percent),
      section("Часы в игре", fields.steam.hours)
    );
  }

  return parts.join("\n\n");
}

async function handleSuggest(env, request) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    throw new HttpError(503, "Предложения через сайт ещё не настроены");
  }

  // CORS ограничивает только браузеры, поэтому запросы не с сайта
  // отсекаем отдельно. Origin можно подделать, от этого спасает лимит ниже.
  if (!isAllowedOrigin(request.headers.get("Origin") || "", env)) {
    throw new HttpError(403, "Запрос не с сайта");
  }

  // Лимит на один IP (настраивается в wrangler.toml, [[ratelimits]]).
  if (env.SUGGEST_LIMITER) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const { success } = await env.SUGGEST_LIMITER.limit({ key: ip });
    if (!success) throw new HttpError(429, "Слишком много предложений, попробуйте через минуту");
  }

  const input = await request.json().catch(() => null);
  if (!input || typeof input !== "object") throw new HttpError(400, "Неверный запрос");

  const category = input.category;
  if (!Object.hasOwn(MAX_POINTS, category)) throw new HttpError(400, "Неизвестная категория");

  const fields = {
    nickname: textField(input.nickname, "Ник", 40),
    game: textField(input.game, "Игра", 100),
    requirement: textField(input.requirement, "Требование", 500, true),
    // Необязательное: читают при рассмотрении, в data.json не попадает.
    description: typeof input.description === "string" && input.description.trim()
      ? textField(input.description, "Описание", 2000, true)
      : null,
    points: numberField(input.points, "Кол-во баллов", 1, MAX_POINTS[category]),
    category,
    steam: await readSteamFields(env, input)
  };

  if (fields.points === null) throw new HttpError(400, "Заполните поле 'Кол-во баллов'");

  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "lapki-steam",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({
      title: `Предложение: ${fields.game}`,
      body: issueBody(fields),
      labels: ["предложение"]
    })
  });

  if (!response.ok) throw new HttpError(502, "GitHub не принял предложение");

  const issue = await response.json();
  return { number: issue.number, url: issue.html_url };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;

    try {
      if (route === "GET /profile") {
        return json(await handleProfile(env, url.searchParams), 200, cors);
      }

      if (route === "GET /games") {
        return json(await handleGames(env, url.searchParams), 200, cors);
      }

      if (route === "GET /achievements") {
        return json(await handleAchievements(env, url.searchParams), 200, cors);
      }

      if (route === "GET /search") {
        return json(await handleSearch(url.searchParams), 200, cors);
      }

      if (route === "GET /schema") {
        return json(await handleSchema(env, url.searchParams), 200, cors);
      }

      if (route === "POST /suggest") {
        return json(await handleSuggest(env, request), 200, cors);
      }

      return json({ error: "Не найдено" }, 404, cors);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 502;
      const message = error instanceof HttpError ? error.message : "Ошибка запроса к Steam";
      return json({ error: message }, status, cors);
    }
  }
};
