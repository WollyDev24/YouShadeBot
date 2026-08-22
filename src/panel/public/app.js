const $ = (sel) => document.querySelector(sel);

let guilds = [];
let selectedGuildId = null;

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (res.status === 401) {
    showLogin(true);
    throw new Error("unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "request failed");
  return data;
}

function toast(msg, isError = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("error", isError);
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3500);
}

function showLogin(show) {
  $("#login-screen").classList.toggle("hidden", !show);
  $("#app").classList.toggle("hidden", show);
}

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

async function loadStatus() {
  try {
    const st = await api("/api/status");
    $("#status-dot").className = `dot ${st.online ? "online" : "offline"}`;
    $("#status-text").textContent = st.online ? st.tag : "offline";
    $("#status-meta").textContent = st.online
      ? `Ping ${st.ping}ms · up ${fmtUptime(st.uptime)} · ${st.guildCount} servers · ${st.totalMembers} members`
      : "";
  } catch {}
}

async function loadGuilds() {
  guilds = await api("/api/guilds");
  const list = $("#guild-list");
  list.innerHTML = "";
  for (const g of guilds) {
    const li = document.createElement("li");
    li.className = "guild-item";
    li.dataset.id = g.id;

    const avatar = document.createElement("div");
    avatar.className = "g-avatar";
    if (g.icon) {
      const img = document.createElement("img");
      img.src = g.icon;
      img.alt = "";
      avatar.appendChild(img);
    } else {
      avatar.textContent = g.name.charAt(0).toUpperCase();
    }

    const name = document.createElement("span");
    name.className = "g-name";
    name.textContent = g.name;

    li.append(avatar, name);
    li.addEventListener("click", () => selectGuild(g.id));
    list.appendChild(li);
  }
  if (selectedGuildId && guilds.some((g) => g.id === selectedGuildId)) {
    selectGuild(selectedGuildId);
  } else if (guilds.length) {
    selectGuild(guilds[0].id);
  }
}

function selectGuild(id) {
  selectedGuildId = id;
  document.querySelectorAll(".guild-item").forEach((it) => it.classList.toggle("selected", it.dataset.id === id));
  $("#empty-state").classList.add("hidden");
  $("#guild-view").classList.remove("hidden");
  renderGuild(guilds.find((g) => g.id === id));
}

function renderGuild(g) {
  if (!g) return;
  const icon = $("#guild-icon");
  if (g.icon) {
    icon.src = g.icon;
    icon.style.display = "";
  } else {
    icon.style.display = "none";
  }
  $("#guild-name").textContent = g.name;
  $("#guild-meta").textContent = `${g.memberCount} members · ${g.channels.length} text/voice channels`;

  const select = $("#temp-channel");
  select.innerHTML = "";
  const voice = g.channels.filter((c) => c.type === 2).sort((a, b) => a.name.localeCompare(b.name));
  if (!voice.length) {
    const opt = document.createElement("option");
    opt.textContent = "No voice channels in this server";
    opt.disabled = true;
    select.appendChild(opt);
    $("#btn-temp-setup").disabled = true;
  } else {
    $("#btn-temp-setup").disabled = false;
    for (const c of voice) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      select.appendChild(opt);
    }
  }
  if (g.temp.triggerId) select.value = g.temp.triggerId;

  $("#temp-status").textContent = g.temp.enabled
    ? `Enabled — trigger: #${g.temp.triggerName ?? "(deleted)"}`
    : "Disabled — users won't get temporary channels.";
  $("#stats-status").textContent = g.stats.enabled
    ? "Enabled — live numbers are updated every 5 minutes."
    : "Disabled — create the stats channels to enable.";

  const textChannels = g.channels.filter((c) => c.type === 0);
  renderTickets(g, textChannels);
  renderWelcome(g, textChannels);
  renderEmbedSender(g, textChannels);
  renderAnnouncements(g, textChannels);
  renderCommands(g);
}

/* --- welcome --- */

const wcEls = {};

function currentGuild() {
  return guilds.find((g) => g.id === selectedGuildId);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderPreviewText(tpl, ctx) {
  let out = escapeHtml(tpl);
  out = out
    .replace(/\{(user|mention)\}/gi, `<span class="dc-mention">@${escapeHtml(ctx.username)}</span>`)
    .replace(/\{(username|name)\}/gi, escapeHtml(ctx.username))
    .replace(/\{(server|guild)\}/gi, escapeHtml(ctx.server))
    .replace(/\{membercount\}/gi, escapeHtml(ctx.memberCount));
  return out.replace(/\n/g, "<br>");
}

function updateWcPreview() {
  const g = currentGuild();
  if (!g || !wcEls.message) return;

  const ctx = {
    userId: "0",
    username: "TestUser",
    server: g.name,
    memberCount: g.memberCount
  };

  const mode = wcEls.mode.value;
  const title = wcEls.title.value.trim();
  const desc = renderPreviewText(wcEls.message.value || " ", ctx);

  wcEls.mixRow.hidden = mode !== "mix";
  wcEls.embedRow.hidden = mode === "text";

  const showEmbed = mode !== "text";
  wcEls.content.hidden = showEmbed;
  wcEls.content.innerHTML = showEmbed ? "" : desc;

  wcEls.embedBox.hidden = !showEmbed;
  if (showEmbed) {
    wcEls.embedBox.style.borderColor = wcEls.color.value;
    wcEls.embedTitle.textContent = title ? renderPreviewText(title, ctx) : "";
    wcEls.embedTitle.hidden = !title;
    wcEls.embedDesc.innerHTML = desc;
  }

  if (mode === "mix") {
    wcEls.content.hidden = false;
    wcEls.content.innerHTML = renderPreviewText(wcEls.mixText.value || " ", ctx);
  }
}

function collectWelcome() {
  return {
    enabled: wcEls.enabled.checked,
    channelId: wcEls.channel.value || null,
    message: wcEls.message.value,
    mode: wcEls.mode.value,
    mixText: wcEls.mixText.value,
    title: wcEls.title.value,
    embedColor: wcEls.color.value
  };
}

function renderWelcome(g, textChannels) {
  if (!wcEls.mode) {
    wcEls.enabled = $("#wc-enabled");
    wcEls.channel = $("#wc-channel");
    wcEls.message = $("#wc-message");
    wcEls.mode = $("#wc-mode");
    wcEls.mixText = $("#wc-mix-text");
    wcEls.mixRow = $("#wc-mix-row");
    wcEls.embedRow = $("#wc-embed-row");
    wcEls.title = $("#wc-title");
    wcEls.color = $("#wc-color");
    wcEls.content = $("#wc-prev-content");
    wcEls.embedBox = $("#wc-prev-embed");
    wcEls.embedTitle = $("#wc-prev-title");
    wcEls.embedDesc = $("#wc-prev-desc");

    for (const el of Object.values(wcEls)) {
      el.addEventListener("input", updateWcPreview);
      el.addEventListener("change", updateWcPreview);
    }

    $("#btn-wc-save").addEventListener("click", () => withGuild("welcome/save", collectWelcome()));
    $("#btn-wc-test").addEventListener("click", () => withGuild("welcome/test", collectWelcome()));
  }

  wcEls.enabled.checked = g.welcome.enabled;
  fillSelect(wcEls.channel, textChannels, g.welcome.channelId, "No text channels", false);
  wcEls.message.value = g.welcome.message;
  wcEls.mode.value = g.welcome.mode || "text";
  wcEls.mixText.value = g.welcome.mixText ?? "";
  wcEls.title.value = g.welcome.title;
  wcEls.color.value = g.welcome.embedColor || "#5865f2";

  updateWcPreview();
}

function renderTickets(g, textChannels) {
  $("#tk-status").textContent = `${g.tickets.openCount} open ticket(s).`;
  fillSelect($("#tk-combined-channel"), textChannels, g.tickets.combinedChannelId ?? "", "No text channels", false);

  const wrap = $("#tk-types");
  wrap.innerHTML = "";
  for (const t of g.tickets.types) {
    wrap.appendChild(buildTypeCard(g, t));
  }

  const box = $("#tk-combined-box");
  box.className = "check-grid";
  box.innerHTML = "";
  if (!g.tickets.types.length) {
    box.innerHTML = `<span class="muted small">Add a ticket type first.</span>`;
  }
  for (const t of g.tickets.types) {
    const label = document.createElement("label");
    label.className = "check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = t.id;
    cb.checked = t.enabled;
    label.append(cb, ` ${t.name}`);
    box.appendChild(label);
  }
}

function buildTypeCard(g, t) {
  const card = document.createElement("div");
  card.className = "subcard tk-type";

  const head = document.createElement("div");
  head.className = "field-row";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = t.name;
  nameInput.placeholder = "Panel name (e.g. Support)";
  nameInput.maxLength = 80;
  nameInput.className = "grow";
  head.append(nameInput);

  const enabledLabel = document.createElement("label");
  enabledLabel.className = "check";
  const enabledCb = document.createElement("input");
  enabledCb.type = "checkbox";
  enabledCb.checked = t.enabled;
  enabledLabel.append(enabledCb, " enabled");
  head.append(enabledLabel);
  card.append(head);

  const mkRow = (labelText, sel) => {
    const row = document.createElement("div");
    row.className = "field-row";
    const label = document.createElement("label");
    label.textContent = labelText;
    label.htmlFor = sel.id;
    row.append(label, sel);
    card.append(row);
    return sel;
  };

  const mkSel = (id, items, selected, optional) => {
    const sel = document.createElement("select");
    sel.id = id;
    fillSelect(sel, items, selected, "None available", optional);
    return sel;
  };

  const catSel = mkRow("Open category", mkSel(`tkc-${t.id}-cat`, g.categories, t.categoryId, false));
  const closedSel = mkRow(
    "Closed category",
    mkSel(`tkc-${t.id}-closed`, g.categories, t.closedCategoryId, true)
  );
  const roleSel = mkRow("Staff role", mkSel(`tkc-${t.id}-role`, g.roles, t.staffRoleId, false));
  const logSel = mkRow(
    "Transcript channel",
    mkSel(`tkc-${t.id}-log`, g.channels.filter((c) => c.type === 0), t.logChannelId, true)
  );
  const panelSel = mkRow(
    "Panel channel",
    mkSel(`tkc-${t.id}-panel`, g.channels.filter((c) => c.type === 0), t.panelChannelId, true)
  );

  const actions = document.createElement("div");
  actions.className = "field-row";

  const btnPost = document.createElement("button");
  btnPost.className = "btn primary";
  btnPost.textContent = "Save & post panel";

  const btnSave = document.createElement("button");
  btnSave.className = "btn";
  btnSave.textContent = "Save only";

  const btnDelete = document.createElement("button");
  btnDelete.className = "btn danger";
  btnDelete.textContent = "Delete type";

  actions.append(btnSave, btnPost, btnDelete);
  card.append(actions);

  const collect = () => ({
    id: t.id,
    name: nameInput.value.trim() || "New Panel",
    enabled: enabledCb.checked,
    categoryId: catSel.value || null,
    closedCategoryId: closedSel.value || null,
    staffRoleId: roleSel.value || null,
    logChannelId: logSel.value || null,
    panelChannelId: panelSel.value || null
  });

  const save = async () => withGuild("tickets/types/save", collect());
  btnSave.addEventListener("click", save);

  btnPost.addEventListener("click", async () => {
    const res = await withGuild("tickets/types/save", collect());
    await withGuild("tickets/post", { typeId: res?.savedId ?? t.id });
  });

  btnDelete.addEventListener("click", async () => {
    if (!confirm(`Delete the "${t.name}" ticket type?`)) return;
    await withGuild("tickets/types/delete", { id: t.id });
  });

  return card;
}

/* --- embed sender --- */

const esEls = {};

function collectEmbedSender() {
  return {
    channelId: esEls.channel.value || null,
    mode: esEls.mode.value,
    title: esEls.title.value,
    message: esEls.message.value,
    footer: esEls.footer.value,
    color: esEls.color.value
  };
}

function updateEsPreview() {
  const mode = esEls.mode.value;
  const title = esEls.title.value.trim();
  const msg = escapeHtml(esEls.message.value || " ").replace(/\n/g, "<br>");

  esEls.titleRow.hidden = mode !== "embed";
  esEls.styleRow.hidden = mode !== "embed";

  const showEmbed = mode === "embed";
  esEls.content.hidden = showEmbed;
  esEls.embedBox.hidden = !showEmbed;

  if (showEmbed) {
    esEls.embedBox.style.borderColor = esEls.color.value;
    esEls.embedTitle.textContent = title;
    esEls.embedTitle.hidden = !title;
    esEls.embedDesc.innerHTML = msg;
  } else {
    esEls.content.innerHTML = msg;
  }
}

function renderEmbedSender(g, textChannels) {
  if (!esEls.mode) {
    esEls.channel = $("#es-channel");
    esEls.mode = $("#es-mode");
    esEls.title = $("#es-title");
    esEls.titleRow = $("#es-title-row");
    esEls.message = $("#es-message");
    esEls.footer = $("#es-footer");
    esEls.styleRow = $("#es-style-row");
    esEls.color = $("#es-color");
    esEls.content = $("#es-prev-content");
    esEls.embedBox = $("#es-prev-embed");
    esEls.embedTitle = $("#es-prev-title");
    esEls.embedDesc = $("#es-prev-desc");

    for (const el of Object.values(esEls)) {
      el.addEventListener("input", updateEsPreview);
      el.addEventListener("change", updateEsPreview);
    }

    $("#btn-es-send").addEventListener("click", async () => {
      await withGuild("embeds/send", collectEmbedSender());
    });
  }

  fillSelect(esEls.channel, textChannels, esEls.channel.value || null, "No text channels", false);
  updateEsPreview();
}

/* --- scheduled announcements --- */

function fmtWhen(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderAnnouncements(g, textChannels) {
  const sel = $("#an-channel");
  fillSelect(sel, textChannels, sel.value || null, "No text channels", false);

  const whenInput = $("#an-when");
  if (!whenInput.value) {
    const soon = new Date(Date.now() + 60 * 60_000 - new Date().getTimezoneOffset() * 60_000);
    whenInput.value = soon.toISOString().slice(0, 16);
  }

  const list = $("#an-list");
  list.innerHTML = "";
  if (!g.announcements.length) {
    list.innerHTML = `<span class="muted small">Nothing scheduled.</span>`;
    return;
  }

  for (const a of g.announcements) {
    const chName = g.channels.find((c) => c.id === a.channelId)?.name ?? "(deleted)";
    const row = document.createElement("div");
    row.className = "ann-item";

    const info = document.createElement("div");
    info.className = "grow";
    const head = document.createElement("div");
    head.className = "ann-head";
    head.innerHTML = `<span class="dc-mention">#${escapeHtml(chName)}</span> <span class="muted small">${fmtWhen(a.at)} · ${a.mode}</span>`;
    const body = document.createElement("div");
    body.className = "small";
    body.textContent = a.title ? `${a.title} — ${a.message}` : a.message;
    info.append(head, body);

    const btnSendNow = document.createElement("button");
    btnSendNow.className = "btn small";
    btnSendNow.textContent = "Send now";
    btnSendNow.addEventListener("click", () => withGuild("announcements/send-now", { id: a.id }));

    const btnCancel = document.createElement("button");
    btnCancel.className = "btn danger small";
    btnCancel.textContent = "Cancel";
    btnCancel.addEventListener("click", () => withGuild("announcements/delete", { id: a.id }));

    row.append(info, btnSendNow, btnCancel);
    list.appendChild(row);
  }
}

$("#btn-an-schedule").addEventListener("click", async () => {
  const when = $("#an-when").value;
  if (!when) return toast("Pick a date and time first.", true);
  const at = new Date(when).getTime();
  if (!Number.isFinite(at) || at <= Date.now()) return toast("That time is in the past.", true);

  await withGuild("announcements/schedule", {
    ...collectEmbedSender(),
    channelId: $("#an-channel").value || null,
    at
  });
});

/* --- command toggles --- */

function renderCommands(g) {
  const grid = $("#cmd-grid");
  if (!grid.dataset.built || grid.dataset.guildId !== g.id) {
    grid.innerHTML = "";
    grid.dataset.built = "1";
    grid.dataset.guildId = g.id;
    for (const name of g.availableCommands) {
      const label = document.createElement("label");
      label.className = "check";
      label.dataset.cmd = name;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = name;
      label.append(cb, ` /${name}`);
      grid.appendChild(label);
    }
  }

  for (const label of grid.querySelectorAll("label.check")) {
    const cb = label.querySelector("input");
    cb.checked = !g.disabledCommands.includes(cb.value);
    label.classList.toggle("off", !cb.checked);
    cb.onchange = () => label.classList.toggle("off", !cb.checked);
  }

  $("#cmd-status").textContent = g.disabledCommands.length
    ? `${g.disabledCommands.length} command(s) disabled.`
    : "All commands enabled.";
}

$("#btn-cmd-save").addEventListener("click", () => {
  const disabled = [...document.querySelectorAll("#cmd-grid input:not(:checked)")].map((cb) => cb.value);
  withGuild("commands/toggles", { disabled });
});

function fillSelect(sel, items, selected, emptyLabel, optional) {
  sel.innerHTML = "";
  if (!items.length) {
    const o = document.createElement("option");
    o.textContent = emptyLabel;
    o.disabled = true;
    o.selected = true;
    sel.appendChild(o);
    return;
  }
  if (optional) {
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "(none)";
    sel.appendChild(none);
  }
  for (const item of items) {
    const o = document.createElement("option");
    o.value = item.id;
    o.textContent = item.name;
    sel.appendChild(o);
  }
  if (selected && items.some((i) => i.id === selected)) sel.value = selected;
  else if (optional) sel.value = "";
}

/* --- actions --- */

async function withGuild(action, body = {}) {
  if (!selectedGuildId) return;
  let payload;
  try {
    payload = await api(`/api/guilds/${selectedGuildId}/${action}`, {
      method: "POST",
      body
    });
  } catch (err) {
    toast(err.message, true);
    return payload;
  }
  if (payload.payload) {
    const idx = guilds.findIndex((g) => g.id === selectedGuildId);
    guilds[idx] = payload.payload;
    renderGuild(payload.payload);
  }
  toast(payload.note || "Done");
  await loadStatus();
  return payload;
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = $("#password").value;
  try {
    await api("/api/login", { method: "POST", body: { password } });
    $("#login-error").classList.add("hidden");
    showLogin(false);
    $("#password").value = "";
    await refreshAll();
  } catch (err) {
    $("#login-error").textContent = "Wrong password";
    $("#login-error").classList.remove("hidden");
  }
});

$("#btn-logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: {} });
  showLogin(true);
});

$("#btn-temp-setup").addEventListener("click", () =>
  withGuild("temp/setup", { channelId: $("#temp-channel").value })
);

$("#btn-temp-disable").addEventListener("click", () => withGuild("temp/disable"));
$("#btn-stats-setup").addEventListener("click", () => withGuild("stats/setup"));
$("#btn-stats-refresh").addEventListener("click", () => withGuild("stats/refresh"));
$("#btn-stats-disable").addEventListener("click", () => withGuild("stats/disable"));

$("#btn-tk-add").addEventListener("click", async () => {
  await withGuild("tickets/types/save", { name: "New Panel" });
});

$("#btn-tk-post-combined").addEventListener("click", () => {
  const ids = [...document.querySelectorAll("#tk-combined-box input:checked")].map((cb) => cb.value);
  withGuild("tickets/post-combined", {
    channelId: $("#tk-combined-channel").value || null,
    typeIds: ids
  });
});

$("#btn-commands").addEventListener("click", async () => {
  try {
    await api("/api/commands/register", { method: "POST", body: {} });
    toast("Commands re-registered");
  } catch (err) {
    toast(err.message, true);
  }
});

async function refreshAll() {
  await Promise.all([loadStatus(), loadGuilds()]);
}

(async function init() {
  try {
    await api("/api/status");
    showLogin(false);
    await refreshAll();
  } catch {
    showLogin(true);
  }
  setInterval(loadStatus, 30_000);
})();