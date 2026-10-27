// Трекер спринт-ревью и бэклог-рефайнментов. Без сборщиков и внешних библиотек.
const KIND = { review: "Спринт-ревью", refinement: "Рефайнмент" };
const KIND_SHORT = { review: "Ревью", refinement: "Рефайнмент" };
const STATUS = { planned: "Запланирована", done: "Проведена", cancelled: "Отменена" };
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const app = document.getElementById("app");
const modal = document.getElementById("modal");
const modalBody = document.getElementById("modal-body");
const state = { month: startOfMonth(new Date()), teams: [], admin: false };
// Кнопки редактирования видит только преподаватель (после входа)
const adm = (html) => (state.admin ? html : "");

// ---------- утилиты ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function shortName(name) { const n = String(name).match(/\d+/); return n ? "№" + n[0] : String(name).slice(0, 3); }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function fmtDate(iso) { return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "short" }); }
function fmtTime(iso) { return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); }
function fmtDateTime(iso) { return iso ? `${fmtDate(iso)}, ${fmtTime(iso)}` : "-"; }
function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function toast(text) {
  const t = document.getElementById("toast");
  t.textContent = text; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => (t.hidden = true), 2500);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401 && !path.startsWith("/api/auth")) { closeModal(); location.hash = "#/login"; throw new Error("Нужно войти"); }
  if (!res.ok) {
    let msg = `Ошибка ${res.status}`;
    try { const data = await res.json(); msg = typeof data.detail === "string" ? data.detail : msg; } catch (e) { /* пусто */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

function openModal(html) { modalBody.innerHTML = html; modal.showModal(); }
function closeModal() { modal.close(); }

// ---------- вход ----------
async function showAuth(status) {
  const setup = !status.configured;
  app.innerHTML = `
    <div class="auth card">
      <h1>${setup ? "Первый запуск" : "Вход"}</h1>
      <p class="muted">${setup ? "Придумайте пароль преподавателя. Его нужно задать один раз, дальше вход только по нему." : "Введите пароль преподавателя."}</p>
      <form class="stack" id="auth-form">
        <label>Пароль<input type="password" name="password" minlength="8" maxlength="64" required autocomplete="${setup ? "new-password" : "current-password"}"></label>
        ${setup ? '<label>Повторите пароль<input type="password" name="password2" required autocomplete="new-password"></label>' : ""}
        <div class="error" id="auth-error"></div>
        <button>${setup ? "Сохранить и войти" : "Войти"}</button>
      </form>
    </div>`;
  document.getElementById("auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const err = document.getElementById("auth-error");
    if (setup && f.get("password") !== f.get("password2")) { err.textContent = "Пароли не совпадают"; return; }
    try {
      await api(setup ? "/api/auth/setup" : "/api/auth/login", { method: "POST", body: { password: f.get("password") } });
      location.hash = "#/calendar";
    } catch (ex) { err.textContent = ex.message; }
  };
}

document.getElementById("logout").onclick = async () => {
  await api("/api/auth/logout", { method: "POST" });
  toast("Вы вышли, режим просмотра");
  route();
};

// ---------- маршрутизация ----------
async function route() {
  const status = await api("/api/auth/status");
  state.admin = status.authenticated;
  document.getElementById("logout").hidden = !state.admin;
  document.getElementById("login-link").hidden = state.admin;
  const hash = location.hash || "#/calendar";
  if (hash === "#/login") {
    if (state.admin) { location.hash = "#/calendar"; return; }
    document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.id === "login-link"));
    return showAuth(status);
  }
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", hash.startsWith(a.getAttribute("href"))));
  state.teams = (await api("/api/teams")).sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
  const m = hash.match(/^#\/teams\/(\d+)/);
  if (m) return showTeam(Number(m[1]));
  if (hash.startsWith("#/teams")) return showTeams();
  return showCalendar();
}
window.addEventListener("hashchange", route);

// ---------- календарь ----------
async function showCalendar() {
  const first = state.month;
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const end = new Date(start); end.setDate(start.getDate() + 42);
  const now = new Date();
  const soonEnd = new Date(now); soonEnd.setDate(now.getDate() + 14);
  const [meetings, upcoming] = await Promise.all([
    api(`/api/meetings?date_from=${start.toISOString()}&date_to=${end.toISOString()}`),
    api(`/api/meetings?date_from=${new Date(now - 2 * 3600e3).toISOString()}&date_to=${soonEnd.toISOString()}`),
  ]);

  let cells = DOW.map((d) => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const day = new Date(start); day.setDate(start.getDate() + i);
    const items = meetings.filter((m) => sameDay(new Date(m.starts_at), day));
    cells += `<div class="day ${day.getMonth() !== first.getMonth() ? "other" : ""} ${sameDay(day, now) ? "today" : ""}">
      <span class="num">${day.getDate()}</span>
      ${items.map((m) => `<button class="chip ${m.kind} ${m.status}" data-meeting="${m.id}" title="${esc(KIND[m.kind])}: ${esc(m.team_name)}"><span class="full">${fmtTime(m.starts_at)} ${esc(m.team_name)}</span><span class="short">${esc(shortName(m.team_name))}</span></button>`).join("")}
    </div>`;
  }
  const planned = upcoming.filter((m) => m.status === "planned").slice(0, 12);

  app.innerHTML = `
    <div class="bar">
      <div class="cal-head">
        <button class="ghost small" id="prev" aria-label="Предыдущий месяц">‹</button>
        <h2>${MONTHS[first.getMonth()]} ${first.getFullYear()}</h2>
        <button class="ghost small" id="next" aria-label="Следующий месяц">›</button>
        <button class="ghost small" id="today">Сегодня</button>
      </div>
      ${adm(`<button id="add-meeting" ${state.teams.length ? "" : "disabled"}>+ Встреча</button>`)}
    </div>
    <div class="layout">
      <div>
        <div class="calendar">${cells}</div>
        <div class="legend"><span class="l-review">Спринт-ревью</span><span class="l-refine">Бэклог-рефайнмент</span><span>✓ проведена</span></div>
      </div>
      <aside class="card upcoming">
        <h3>Ближайшие 2 недели</h3>
        ${planned.length ? `<ul>${planned.map((m) => `<li><button data-meeting="${m.id}">
          <span class="badge ${m.kind}">${KIND_SHORT[m.kind]}</span> <b>${esc(m.team_name)}</b>${m.sprint != null ? ` · спринт ${m.sprint}` : ""}
          <div class="when">${fmtDateTime(m.starts_at)}</div></button></li>`).join("")}</ul>`
          : `<p class="muted">${state.teams.length ? "Запланированных встреч нет." : (state.admin ? "Сначала добавьте команды на вкладке «Команды»." : "Команд пока нет.")}</p>`}
      </aside>
    </div>`;

  document.getElementById("prev").onclick = () => { state.month = new Date(first.getFullYear(), first.getMonth() - 1, 1); showCalendar(); };
  document.getElementById("next").onclick = () => { state.month = new Date(first.getFullYear(), first.getMonth() + 1, 1); showCalendar(); };
  document.getElementById("today").onclick = () => { state.month = startOfMonth(new Date()); showCalendar(); };
  if (state.admin) document.getElementById("add-meeting").onclick = () => meetingForm();
  app.querySelectorAll("[data-meeting]").forEach((b) => (b.onclick = () => showMeeting(Number(b.dataset.meeting))));
}

// ---------- команды ----------
function showTeams() {
  app.innerHTML = `
    <div class="bar">
      <h1>Команды <span class="muted">(${state.teams.length})</span></h1>
      ${adm(`<div class="row">
        <button class="ghost" id="bulk">Добавить списком</button>
        <button id="add-team">+ Команда</button>
      </div>`)}
    </div>
    ${state.teams.length ? `<div class="teams">${state.teams.map((t) => `
      <article class="card team" data-team="${t.id}" tabindex="0">
        <h3>${esc(t.name)}</h3>
        ${t.project ? `<div class="muted">${esc(t.project)}</div>` : ""}
        <dl class="kv">
          <dt>Ревью</dt><dd>${t.next_review ? fmtDateTime(t.next_review) : "не запланировано"}</dd>
          <dt>Рефайнмент</dt><dd>${t.next_refinement ? fmtDateTime(t.next_refinement) : "не запланирован"}</dd>
          <dt>Проведено</dt><dd>${t.done_count}</dd>
        </dl>
        ${t.last_note ? `<div class="quote">${esc(t.last_note.length > 150 ? t.last_note.slice(0, 150) + "…" : t.last_note)}</div>` : ""}
      </article>`).join("")}</div>`
      : `<div class="card empty">Команд пока нет.${adm(" Добавьте их по одной или сразу списком.")}</div>`}`;
  if (state.admin) {
    document.getElementById("add-team").onclick = () => teamForm();
    document.getElementById("bulk").onclick = bulkForm;
  }
  app.querySelectorAll("[data-team]").forEach((el) => {
    el.onclick = () => (location.hash = `#/teams/${el.dataset.team}`);
    el.onkeydown = (e) => { if (e.key === "Enter") el.onclick(); };
  });
}

function teamForm(team) {
  openModal(`
    <h2>${team ? "Редактировать команду" : "Новая команда"}</h2>
    <form class="stack" id="team-form">
      <label>Название<input name="name" required maxlength="100" value="${esc(team?.name)}" placeholder="Команда 1"></label>
      <label>Проект<input name="project" maxlength="200" value="${esc(team?.project)}" placeholder="Агрегатор новостей"></label>
      <label>Состав и роли<textarea name="members" maxlength="2000" placeholder="[PO] Иванов&#10;[BE] Петров">${esc(team?.members)}</textarea></label>
      <div class="error" id="form-error"></div>
      <div class="row"><button>Сохранить</button>${team ? '<button type="button" class="danger" id="del-team">Удалить команду</button>' : ""}</div>
    </form>`);
  document.getElementById("team-form").onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      const saved = await api(team ? `/api/teams/${team.id}` : "/api/teams", { method: team ? "PUT" : "POST", body });
      closeModal(); toast("Сохранено");
      location.hash = `#/teams/${saved.id}`; route();
    } catch (ex) { document.getElementById("form-error").textContent = ex.message; }
  };
  if (team) document.getElementById("del-team").onclick = async () => {
    if (!confirm(`Удалить команду «${team.name}» вместе со всеми встречами и комментариями?`)) return;
    await api(`/api/teams/${team.id}`, { method: "DELETE" });
    closeModal(); toast("Команда удалена"); location.hash = "#/teams"; route();
  };
}

function bulkForm() {
  openModal(`
    <h2>Добавить команды списком</h2>
    <form class="stack" id="bulk-form">
      <label>Одна команда на строку<textarea name="names" rows="10" required placeholder="Команда 1&#10;Команда 2&#10;..."></textarea></label>
      <button type="button" class="ghost small" id="ten">Заполнить: Команда 1 … Команда 10</button>
      <button>Добавить</button>
    </form>`);
  const ta = modalBody.querySelector("textarea");
  document.getElementById("ten").onclick = () => (ta.value = Array.from({ length: 10 }, (_, i) => `Команда ${i + 1}`).join("\n"));
  document.getElementById("bulk-form").onsubmit = async (e) => {
    e.preventDefault();
    const names = ta.value.split("\n").map((s) => s.trim()).filter(Boolean);
    for (const name of names) await api("/api/teams", { method: "POST", body: { name } });
    closeModal(); toast(`Добавлено команд: ${names.length}`); route();
  };
}

async function showTeam(id) {
  let team;
  try { team = await api(`/api/teams/${id}`); } catch (e) { location.hash = "#/teams"; return; }
  const meetings = await api(`/api/meetings?team_id=${id}`);
  app.innerHTML = `
    <div class="bar">
      <div><a href="#/teams" class="muted">← Все команды</a><h1>${esc(team.name)}</h1>${team.project ? `<div class="muted">${esc(team.project)}</div>` : ""}</div>
      ${adm(`<div class="row"><button class="ghost" id="edit-team">Редактировать</button><button id="add-meeting">+ Встреча</button></div>`)}
    </div>
    ${team.members ? `<div class="card members">${esc(team.members)}</div>` : ""}
    ${meetings.length ? `<table>
      <thead><tr><th>Дата</th><th>Встреча</th><th class="hide-sm">Спринт</th><th>Статус</th><th class="hide-sm">Комментарии</th></tr></thead>
      <tbody>${meetings.map((m) => `<tr class="click" data-meeting="${m.id}">
        <td>${fmtDateTime(m.starts_at)}</td>
        <td><span class="badge ${m.kind}">${KIND[m.kind]}</span></td>
        <td class="hide-sm">${m.sprint ?? "-"}</td>
        <td><span class="badge ${m.status}">${STATUS[m.status]}</span></td>
        <td class="hide-sm">${m.notes_count}</td></tr>`).join("")}</tbody></table>`
      : `<div class="card empty">Встреч пока нет.${adm(" Запланируйте ревью и рефайнменты, можно сразу на несколько спринтов.")}</div>`}`;
  if (state.admin) {
    document.getElementById("edit-team").onclick = () => teamForm(team);
    document.getElementById("add-meeting").onclick = () => meetingForm(null, id);
  }
  app.querySelectorAll("[data-meeting]").forEach((r) => (r.onclick = () => showMeeting(Number(r.dataset.meeting))));
}

// ---------- встречи ----------
function meetingForm(meeting, teamId) {
  const options = state.teams.map((t) => `<option value="${t.id}" ${(meeting?.team_id ?? teamId) === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("");
  openModal(`
    <h2>${meeting ? "Изменить встречу" : "Новая встреча"}</h2>
    <form class="stack" id="meeting-form">
      ${meeting ? `<div><b>${esc(meeting.team_name)}</b></div>` : `<label>Команда<select name="team_id" required>${options}</select></label>`}
      <div class="grid2">
        <label>Тип<select name="kind">
          <option value="review" ${meeting?.kind === "review" ? "selected" : ""}>Спринт-ревью</option>
          <option value="refinement" ${meeting?.kind === "refinement" ? "selected" : ""}>Бэклог-рефайнмент</option></select></label>
        <label>Дата и время<input type="datetime-local" name="starts_at" required value="${toLocalInput(meeting?.starts_at)}"></label>
        <label>Номер спринта<input type="number" name="sprint" min="0" max="100" value="${meeting?.sprint ?? ""}"></label>
        ${meeting ? `<label>Статус<select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${meeting.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>`
          : `<label>Повторять<select name="repeat_weeks"><option value="0">Не повторять</option><option value="1">Каждую неделю</option><option value="2" selected>Каждые 2 недели</option><option value="3">Каждые 3 недели</option></select></label>`}
      </div>
      ${meeting ? "" : '<label>Сколько встреч создать<input type="number" name="repeat_count" min="1" max="20" value="1"></label>'}
      <div class="error" id="form-error"></div>
      <button>Сохранить</button>
    </form>`);
  document.getElementById("meeting-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const body = {
      kind: f.kind,
      starts_at: new Date(f.starts_at).toISOString(),
      sprint: f.sprint === "" ? null : Number(f.sprint),
    };
    try {
      if (meeting) {
        await api(`/api/meetings/${meeting.id}`, { method: "PUT", body: { ...body, status: f.status } });
        toast("Сохранено"); showMeeting(meeting.id);
      } else {
        const r = await api("/api/meetings", { method: "POST", body: { ...body, team_id: Number(f.team_id), repeat_weeks: Number(f.repeat_weeks), repeat_count: Number(f.repeat_count) } });
        closeModal(); toast(`Создано встреч: ${r.created.length}`);
      }
      route();
    } catch (ex) { document.getElementById("form-error").textContent = ex.message; }
  };
}

async function showMeeting(id) {
  const m = await api(`/api/meetings/${id}`);
  openModal(`
    <h2><span class="badge ${m.kind}">${KIND[m.kind]}</span> ${esc(m.team_name)}</h2>
    <dl class="kv">
      <dt>Когда</dt><dd>${fmtDateTime(m.starts_at)}</dd>
      <dt>Спринт</dt><dd>${m.sprint ?? "-"}</dd>
      <dt>Статус</dt><dd><span class="badge ${m.status}">${STATUS[m.status]}</span></dd>
    </dl>
    ${adm(`<div class="row actions">
      ${m.status !== "done" ? '<button class="small" id="mark-done">Отметить проведённой</button>' : ""}
      <button class="ghost small" id="edit">Изменить</button>
      <button class="danger small" id="delete">Удалить</button>
    </div>`)}
    <h3 class="section-title">Комментарии по итогам</h3>
    ${m.notes.length ? `<ul class="notes">${m.notes.map((n) => `<li><span class="when">${fmtDateTime(n.created_at)}</span>${esc(n.text)}
      ${adm(`<button class="del" data-note="${n.id}" title="Удалить комментарий">×</button>`)}</li>`).join("")}</ul>` : '<p class="muted">Комментариев пока нет.</p>'}
    ${adm(`<form class="stack" id="note-form">
      <textarea name="text" required maxlength="5000" placeholder="Что показали, что приняли, договорённости, что улучшить"></textarea>
      <button>Добавить комментарий</button>
    </form>`)}`);
  if (!state.admin) return;

  const update = (patch) => api(`/api/meetings/${id}`, { method: "PUT", body: { kind: m.kind, starts_at: m.starts_at, sprint: m.sprint, status: m.status, ...patch } });
  const markDone = document.getElementById("mark-done");
  if (markDone) markDone.onclick = async () => { await update({ status: "done" }); toast("Отмечено"); showMeeting(id); route(); };
  document.getElementById("edit").onclick = () => meetingForm(m);
  document.getElementById("delete").onclick = async () => {
    if (!confirm("Удалить встречу вместе с комментариями?")) return;
    await api(`/api/meetings/${id}`, { method: "DELETE" }); closeModal(); toast("Встреча удалена"); route();
  };
  modalBody.querySelectorAll("[data-note]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Удалить комментарий?")) return;
    await api(`/api/notes/${b.dataset.note}`, { method: "DELETE" }); showMeeting(id); route();
  }));
  document.getElementById("note-form").onsubmit = async (e) => {
    e.preventDefault();
    const text = new FormData(e.target).get("text");
    await api(`/api/meetings/${id}/notes`, { method: "POST", body: { text } });
    if (m.status === "planned" && new Date(m.starts_at) < new Date()) await update({ status: "done" });
    toast("Комментарий сохранён"); showMeeting(id); route();
  };
}

route().catch((e) => { app.innerHTML = `<div class="card empty">Не удалось загрузить: ${esc(e.message)}</div>`; });
