const categories = ["Потные", "Мега", "Сломанные", "Предложения"];

const tableHead = document.querySelector("#table-head");
const tableBody = document.querySelector("#table-body");
const searchInput = document.querySelector("#search");
const sortSelect = document.querySelector("#sort");
const emptyMessage = document.querySelector("#empty-message");
const tabs = [...document.querySelectorAll(".tab")];

let data = {};
let currentCategory = "Потные";

const completedKey = "lapki-table-completed";

function getCompleted() {
  try {
    return new Set(JSON.parse(localStorage.getItem(completedKey) || "[]"));
  } catch {
    return new Set();
  }
}

function saveCompleted(completed) {
  localStorage.setItem(completedKey, JSON.stringify([...completed]));
}

function render() {
  const isSuggestions = currentCategory === "Предложения";
  const completed = getCompleted();
  const query = searchInput.value.trim().toLocaleLowerCase("ru");
  const sortMode = sortSelect.value;

  tableHead.innerHTML = `
    <tr>
      <th>Игра</th>
      <th>Требование</th>
      <th>Кол-во баллов</th>
      ${isSuggestions ? "<th>Статус</th>" : ""}
    </tr>
  `;

  let rows = [...(data[currentCategory] || [])].filter(item =>
    String(item.game).toLocaleLowerCase("ru").includes(query)
  );

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

  rows.forEach((item, index) => {
    const id = `${currentCategory}:${item.game}:${item.requirement}`;
    const row = document.createElement("tr");

    if (completed.has(id)) row.classList.add("done");

    row.innerHTML = `
      <td>${escapeHtml(item.game)}</td>
      <td>${escapeHtml(item.requirement)}</td>
      <td>${escapeHtml(item.points)}</td>
      ${isSuggestions ? `<td>${escapeHtml(item.status || "на рассмотрении")}</td>` : ""}
    `;

    row.addEventListener("click", () => {
      const latest = getCompleted();
      if (latest.has(id)) {
        latest.delete(id);
        row.classList.remove("done");
      } else {
        latest.add(id);
        row.classList.add("done");
      }
      saveCompleted(latest);
    });

    tableBody.appendChild(row);
  });

  emptyMessage.hidden = rows.length > 0;
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

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    currentCategory = tab.dataset.category;
    tabs.forEach(item => item.classList.toggle("active", item === tab));
    render();
  });
});

searchInput.addEventListener("input", render);
sortSelect.addEventListener("change", render);

fetch("data.json")
  .then(response => {
    if (!response.ok) throw new Error("Не удалось загрузить data.json");
    return response.json();
  })
  .then(json => {
    data = json;
    categories.forEach(category => {
      if (!Array.isArray(data[category])) data[category] = [];
    });
    render();
  })
  .catch(error => {
    tableBody.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
  });
