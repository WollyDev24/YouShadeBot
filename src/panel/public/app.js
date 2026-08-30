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

let panelRev = null;

async function loadStatus() {
  try {
    const st = await api("/api/status");
    if (st.frontendRev) {
      if (panelRev && panelRev !== st.frontendRev) {
        location.reload();
        return;
      }
      panelRev = st.frontendRev;
    }
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
  renderGiveaways(g, textChannels);
  renderCommands(g);
  renderFilters(g);
  renderAutoRoles(g);
  renderPanelRole(g);
  renderUpdates(g, textChannels);
  renderStarboard(g, textChannels);
  renderCountingEmojis(g);
  renderSurveys(g, textChannels);
  renderSticky(g, textChannels);
  renderPolls(g);
  renderReminders(g);
  renderAutomod(g);
  renderReactionRoles(g);
  renderLockdown(g);
  renderLeveling(g);
  renderRoleMenus(g);
  populateCustomEmojis(g);
  renderOverview(g);
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
      el.addEventListener("input", () => { wcEls.dirty = true; updateWcPreview(); });
      el.addEventListener("change", () => { wcEls.dirty = true; updateWcPreview(); });
    }

    $("#btn-wc-save").addEventListener("click", async (e) => {
      const r = await withGuild("welcome/save", collectWelcome(), e.currentTarget);
      if (r) wcEls.dirty = false;
    });
    $("#btn-wc-test").addEventListener("click", (e) =>
      withGuild("welcome/test", collectWelcome(), e.currentTarget)
    );
  }

  const fresh = wcEls.guildId !== g.id;
  wcEls.guildId = g.id;

  if (fresh || !wcEls.dirty) {
    wcEls.enabled.checked = g.welcome.enabled;
    fillSelect(wcEls.channel, textChannels, g.welcome.channelId, "No text channels", false);
    wcEls.message.value = g.welcome.message;
    wcEls.mode.value = g.welcome.mode || "text";
    wcEls.mixText.value = g.welcome.mixText ?? "";
    wcEls.title.value = g.welcome.title;
    wcEls.color.value = g.welcome.embedColor || "#5865f2";
    wcEls.dirty = false;
  } else {
    fillSelect(wcEls.channel, textChannels, wcEls.channel.value || null, "No text channels", false);
  }

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
    cb.checked = true;
    label.append(cb, ` ${t.name}${t.enabled ? "" : " (disabled)"}`);
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

  const save = async (btn) => withGuild("tickets/types/save", collect(), btn);
  btnSave.addEventListener("click", (e) => save(e.currentTarget));

  btnPost.addEventListener("click", async (e) => {
    const r = await withGuild("tickets/types/save", collect(), e.currentTarget);
    if (r) await withGuild("tickets/post", { typeId: r.savedId ?? t.id });
  });

  btnDelete.addEventListener("click", async (e) => {
    if (!confirm(`Delete the "${t.name}" ticket type?`)) return;
    await withGuild("tickets/types/delete", { id: t.id }, e.currentTarget);
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

    $("#btn-es-send").addEventListener("click", (e) => {
      withGuild("embeds/send", collectEmbedSender(), e.currentTarget);
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

$("#btn-an-schedule").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const when = $("#an-when").value;
  if (!when) return toast("Pick a date and time first.", true);
  const at = new Date(when).getTime();
  if (!Number.isFinite(at) || at <= Date.now()) return toast("That time is in the past.", true);

  await withGuild(
    "announcements/schedule",
    {
      ...collectEmbedSender(),
      channelId: $("#an-channel").value || null,
      at
    },
    btn
  );
});

/* --- command toggles --- */

function renderCommands(g) {
  const grid = $("#cmd-grid");
  if (grid.dataset.guildId !== g.id) {
    grid.innerHTML = "";
    grid.dataset.built = "1";
    grid.dataset.guildId = g.id;
    grid.dataset.dirty = "";
    for (const name of g.availableCommands) {
      const label = document.createElement("label");
      label.className = "check";
      label.dataset.cmd = name;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = name;
      cb.addEventListener("change", () => {
        grid.dataset.dirty = "1";
        label.classList.toggle("off", !cb.checked);
      });
      label.append(cb, ` /${name}`);
      grid.appendChild(label);
    }
  }

  if (!grid.dataset.dirty) {
    for (const label of grid.querySelectorAll("label.check")) {
      const cb = label.querySelector("input");
      cb.checked = !g.disabledCommands.includes(cb.value);
      label.classList.toggle("off", !cb.checked);
    }
  }

  $("#cmd-status").textContent = grid.dataset.dirty
    ? "Unsaved changes — click Save."
    : g.disabledCommands.length
      ? `${g.disabledCommands.length} command(s) disabled.`
      : "All commands enabled.";
}

$("#btn-cmd-save").addEventListener("click", async (e) => {
  const disabled = [...document.querySelectorAll("#cmd-grid input:not(:checked)")].map((cb) => cb.value);
  const r = await withGuild("commands/toggles", { disabled }, e.currentTarget);
  if (r) $("#cmd-grid").dataset.dirty = "";
});

/* --- auto-response filters --- */

function renderFilters(g) {
  const list = $("#fr-list");
  list.innerHTML = "";
  if (!g.filters.length) {
    list.innerHTML = `<span class="muted small">No rules yet.</span>`;
    return;
  }

  for (const r of g.filters) {
    const row = document.createElement("div");
    row.className = "ann-item";

    const info = document.createElement("div");
    info.className = "grow";
    const head = document.createElement("div");
    head.className = "ann-head";
    head.innerHTML = `<code>${escapeHtml(r.trigger)}</code> <span class="muted small">#${r.id} · ${r.match}</span>`;
    const body = document.createElement("div");
    body.className = "small";
    body.textContent = r.response;
    info.append(head, body);

    const btnDelete = document.createElement("button");
    btnDelete.className = "btn danger small";
    btnDelete.textContent = "Remove";
    btnDelete.addEventListener("click", () => withGuild("filters/remove", { id: r.id }));

    row.append(info, btnDelete);
    list.appendChild(row);
  }
}

$("#btn-fr-add").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const trigger = $("#fr-trigger").value.trim();
  const response = $("#fr-response").value.trim();
  if (!trigger || !response) return toast("Fill in trigger and response first.", true);
  await withGuild("filters/add", { trigger, response, match: $("#fr-match").value }, btn);
  $("#fr-trigger").value = "";
  $("#fr-response").value = "";
});

/* --- auto-join roles --- */

function renderAutoRoles(g) {
  const human = $("#ar-human");
  const bot = $("#ar-bot");
  fillSelect(human, g.roles, human.value || g.autoRoles.humanRoleId, "No roles available", true);
  fillSelect(bot, g.roles, bot.value || g.autoRoles.botRoleId, "No roles available", true);
  $("#ar-status").textContent =
    g.autoRoles.humanRoleId || g.autoRoles.botRoleId
      ? "Auto-roles are active for new members."
      : "Auto-roles are off — pick at least one role and save.";
}

$("#btn-ar-save").addEventListener("click", (e) => {
  withGuild(
    "autoroles/save",
    {
      humanRoleId: $("#ar-human").value || null,
      botRoleId: $("#ar-bot").value || null
    },
    e.currentTarget
  );
});

$("#btn-ar-disable").addEventListener("click", async (e) => {
  if (!confirm("Stop assigning auto-roles to new members?")) return;
  await withGuild("autoroles/disable", {}, e.currentTarget);
});

/* --- discord panel role --- */

function renderPanelRole(g) {
  const sel = $("#pn-role");
  fillSelect(sel, g.roles, g.panelRoleId, "No roles available", true);
  $("#pn-status").textContent = g.panelRoleId
    ? `Panel restricted to members with the <@&${g.panelRoleId}> role (plus Manage Server).`
    : "Panel is open to anyone with **Manage Server** permission.";
}

$("#btn-pn-save").addEventListener("click", (e) =>
  withGuild("panel/role", { roleId: $("#pn-role").value || null }, e.currentTarget)
);

/* --- auto-update --- */

function renderUpdates(g, textChannels) {
  const sel = $("#up-channel");
  fillSelect(sel, textChannels, sel.value || g.logChannelId, "No text channels", true);

  const chName = g.channels.find((c) => c.id === g.logChannelId)?.name;
  $("#up-status").textContent = chName
    ? `Updates and restarts are announced in #${chName}.`
    : "No logging channel set — updates happen silently.";
}

$("#btn-up-save").addEventListener("click", (e) =>
  withGuild("logging/save", { channelId: $("#up-channel").value || null }, e.currentTarget)
);

$("#btn-up-check").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = "Checking…";
  try {
    const r = await api("/api/update/check", { method: "POST", body: {} });
    if (r.status === "up-to-date") {
      toast(`Already on the latest commit (${r.sha})`);
      $("#up-status").textContent = `Checked just now — up to date (${r.sha}).`;
    } else if (r.status === "updating") {
      $("#up-status").textContent = `Update found (${r.commits} new commit(s)) — bot is restarting, page will reconnect shortly.`;
      setTimeout(loadStatus, 20_000);
    } else if (r.status === "dirty") {
      toast("Local file changes detected — auto-update skipped.", true);
    } else if (r.status === "diverged") {
      toast("Local history diverged from origin — manual fix needed.", true);
    } else if (r.status === "busy") {
      toast("An update check is already running.", true);
    } else {
      toast(r.error || "Update check failed.", true);
    }
  } catch (err) {
    toast(err.message, true);
    setTimeout(loadStatus, 20_000);
  } finally {
    btn.disabled = false;
    btn.textContent = "Check for updates now";
  }
});

/* --- starboard --- */

function renderStarboard(g, textChannels) {
  const sel = $("#sb-channel");
  fillSelect(sel, textChannels, sel.value || g.starboard.channelId, "No text channels", true);

  const thresholdInput = $("#sb-threshold");
  const emojiInput = $("#sb-emoji");
  const fresh = sel.dataset.guildId !== g.id;
  sel.dataset.guildId = g.id;
  if (fresh && !sel.value) {
    thresholdInput.value = g.starboard.threshold ?? 3;
    emojiInput.value = g.starboard.emoji ?? "⭐";
  }

  $("#sb-status").textContent = g.starboard.enabled
    ? `Starboard is on — ${g.starboard.threshold}+ ${g.starboard.emoji} reposts to the selected channel.`
    : g.starboard.channelId
      ? `Starboard is disabled — last channel was #${g.channels.find((c) => c.id === g.starboard.channelId)?.name ?? "(deleted)"}.`
      : "Starboard is off — pick a channel and save.";
}

$("#btn-sb-save").addEventListener("click", (e) =>
  withGuild(
    "starboard/save",
    {
      channelId: $("#sb-channel").value || null,
      threshold: Number($("#sb-threshold").value),
      emoji: $("#sb-emoji").value.trim() || "⭐"
    },
    e.currentTarget
  )
);

$("#btn-sb-disable").addEventListener("click", async (e) => {
  if (!confirm("Disable the starboard? Existing board posts are kept.")) return;
  await withGuild("starboard/disable", {}, e.currentTarget);
});

/* --- counting emojis --- */

function renderCountingEmojis(g) {
  const fresh = $("#ct-correct").dataset.guildId !== g.id;
  $("#ct-correct").dataset.guildId = g.id;
  if (fresh) {
    $("#ct-correct").value = g.counting.emojis.correct ?? "✅";
    $("#ct-milestone").value = g.counting.emojis.milestone ?? "🎉";
    $("#ct-69").value = g.counting.emojis.sixtyNine ?? "🔥";
  }

  $("#ct-status").textContent = g.counting.channelId
    ? `Counting game active in <#${g.counting.channelId}>.`
    : "No counting channel set up yet — use /counting setup in Discord first.";

  const rw = g.counting.rewardRoleId;
  $("#ct-reward").textContent = rw
    ? `Every correct count ending in a multiple of ${g.counting.rewardEvery} awards <@&${rw}> — best streak so far: ${g.counting.best}.`
    : "No reward configured yet — set a role and interval below.";

  const rSel = $("#ct-reward-role");
  fillSelect(rSel, g.roles, rSel.value || rw, "No roles available", true);
  const rEvery = $("#ct-reward-every");
  if (rEvery.dataset.guildId !== g.id) {
    rEvery.dataset.guildId = g.id;
    rEvery.value = g.counting.rewardEvery ?? 10;
  }
}

$("#btn-ct-reward-save").addEventListener("click", (e) =>
  withGuild(
    "counting/reward",
    { roleId: $("#ct-reward-role").value || null, every: $("#ct-reward-every").value },
    e.currentTarget
  )
);

$("#btn-ct-save").addEventListener("click", (e) =>
  withGuild(
    "counting/emojis",
    {
      correct: $("#ct-correct").value.trim() || "✅",
      milestone: $("#ct-milestone").value.trim() || "🎉",
      sixtyNine: $("#ct-69").value.trim() || "🔥"
    },
    e.currentTarget
  )
);

/* --- surveys --- */

function renderSurveys(g, textChannels) {
  fillSelect($("#sv-channel"), textChannels, $("#sv-channel").value || null, "No text channels", false);
  fillSelect($("#sv-response-channel"), textChannels, $("#sv-response-channel").value || null, "No text channels", false);

  const count = g.surveys.length;
  $("#sv-status").textContent = count
    ? `${count} survey(s) created.`
    : "No surveys yet — create one above.";

  const list = $("#sv-list");
  list.innerHTML = "";
  if (!g.surveys.length) {
    list.innerHTML = `<span class="muted small">No surveys yet.</span>`;
    return;
  }

  for (const s of g.surveys) {
    const row = document.createElement("div");
    row.className = "ann-item";

    const info = document.createElement("div");
    info.className = "grow";
    const head = document.createElement("div");
    head.className = "ann-head";
    head.innerHTML =
      `<strong>${escapeHtml(s.question)}</strong>` +
      ` <span class="muted small">#${s.id} · ${s.responseCount} response(s) · ${s.buttonEmoji} ${escapeHtml(s.buttonLabel)}</span>`;
    const body = document.createElement("div");
    body.className = "small muted";
    body.textContent = s.description
      ? s.description.slice(0, 100) + (s.description.length > 100 ? "..." : "")
      : (s.channelId ? `Posted in #${g.channels.find((c) => c.id === s.channelId)?.name ?? "(deleted)"}` : "Not posted yet");
    info.append(head, body);

    const btnPost = document.createElement("button");
    btnPost.className = "btn small";
    btnPost.textContent = s.messageId ? "Re-post" : "Post";
    btnPost.addEventListener("click", (e) => {
      withGuild("surveys/post", { id: s.id, channelId: $("#sv-channel").value || null }, e.currentTarget);
    });

    const btnDelete = document.createElement("button");
    btnDelete.className = "btn danger small";
    btnDelete.textContent = "Delete";
    btnDelete.addEventListener("click", async (e) => {
      if (!confirm(`Delete survey #${s.id} ("${s.question}")? ${s.responseCount} response(s) will be lost.`)) return;
      await withGuild("surveys/delete", { id: s.id }, e.currentTarget);
    });

    row.append(info, btnPost, btnDelete);
    list.appendChild(row);
  }
}

$("#btn-sv-create").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const question = $("#sv-question").value.trim();
  if (!question) return toast("Enter a question first.", true);

  await withGuild(
    "surveys/create",
    {
      question,
      description: $("#sv-description").value.trim(),
      channelId: $("#sv-channel").value || null,
      responseChannelId: $("#sv-response-channel").value || null,
      buttonLabel: $("#sv-label").value.trim() || "Take Survey",
      buttonEmoji: $("#sv-emoji").value.trim() || "📋",
      color: $("#sv-color").value
    },
    btn
  );
  $("#sv-question").value = "";
  $("#sv-description").value = "";
});

/* --- sticky messages --- */

function renderSticky(g, textChannels) {
  fillSelect($("#sk-channel"), textChannels, $("#sk-channel").value || null, "No text channels", false);

  const count = g.sticky.length;
  $("#sk-status").textContent = count
    ? `${count} active sticky message(s).`
    : "No sticky messages — set one above or use /sticky set in Discord.";

  const list = $("#sk-list");
  list.innerHTML = "";
  if (!g.sticky.length) {
    list.innerHTML = `<span class="muted small">No active sticky messages.</span>`;
    return;
  }

  for (const s of g.sticky) {
    const row = document.createElement("div");
    row.className = "ann-item";

    const info = document.createElement("div");
    info.className = "grow";
    const head = document.createElement("div");
    head.className = "ann-head";
    head.innerHTML =
      `<span class="dc-mention">#${escapeHtml(s.channelName)}</span>` +
      ` <span class="muted small">every ${s.interval}m · by ${escapeHtml(s.authorTag)}</span>`;
    const body = document.createElement("div");
    body.className = "small";
    body.textContent = s.content.slice(0, 100) + (s.content.length > 100 ? "..." : "");
    info.append(head, body);

    const btnRemove = document.createElement("button");
    btnRemove.className = "btn danger small";
    btnRemove.textContent = "Remove";
    btnRemove.addEventListener("click", (e) =>
      withGuild("sticky/remove", { channelId: s.channelId }, e.currentTarget)
    );

    row.append(info, btnRemove);
    list.appendChild(row);
  }
}

$("#btn-sk-set").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const channelId = $("#sk-channel").value;
  const content = $("#sk-content").value.trim();
  const interval = Number($("#sk-interval").value);
  if (!channelId) return toast("Pick a channel first.", true);
  if (!content) return toast("Enter message content.", true);
  if (!Number.isFinite(interval) || interval < 1) return toast("Interval must be at least 1 minute.", true);

  await withGuild("sticky/set", { channelId, content, interval }, btn);
  $("#sk-content").value = "";
});

/* --- polls --- */

function renderPolls(g) {
  const list = $("#poll-list");
  list.innerHTML = "";
  const polls = g.polls ?? [];
  if (!polls.length) {
    list.innerHTML = `<span class="muted small">No polls yet. Create one with <code>/poll create</code>.</span>`;
    return;
  }
  for (const p of polls) {
    const row = document.createElement("div");
    row.className = "ann-item";
    const info = document.createElement("div");
    info.className = "grow";
    const status = p.ended ? "ended" : "active";
    const ch = p.channelId ? `<#${p.channelId}>` : "(unknown)";
    info.innerHTML = `<strong>#${p.id}</strong> — ${escapeHtml(p.question)}<br><span class="muted small">${p.options.length} options · ${p.totalVotes} vote(s) · ${status} · ${ch}</span>`;
    row.appendChild(info);
    list.appendChild(row);
  }
}

function renderReminders(g) {
  const list = $("#reminder-list");
  list.innerHTML = "";
  const reminders = g.reminders ?? [];
  if (!reminders.length) {
    list.innerHTML = `<span class="muted small">No reminders set. Create one with <code>/reminder set</code>.</span>`;
    return;
  }
  for (const r of reminders) {
    const row = document.createElement("div");
    row.className = "ann-item";
    const info = document.createElement("div");
    info.className = "grow";
    const ch = r.channelId ? `<#${r.channelId}>` : "(unknown)";
    const target = r.target ? escapeHtml(r.target.replace(/[<>@&]/g, "")) : "(no target)";
    const repeat = r.repeatMs ? ` · every ${formatReminderDuration(r.repeatMs)}` : "";
    const due = r.at <= Date.now() ? "due" : `<t:${Math.floor(r.at / 1000)}:R>`;
    info.innerHTML = `<strong>#${r.id}</strong> — ${target} in ${ch} — ${due}${repeat}<br><span class="muted small">${escapeHtml(r.message)}</span>`;
    row.appendChild(info);
    list.appendChild(row);
  }
}

function formatReminderDuration(ms) {
  const secs = Math.round(ms / 1000);
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.join(" ") || "0s";
}

/* --- automod --- */

function renderAutomod(g) {
  const cfg = g.automod;
  $("#am-status").textContent = cfg.enabled
    ? "Automod is ON."
    : "Automod is OFF — enable it to start filtering.";
  $("#btn-am-toggle").textContent = cfg.enabled ? "Disable automod" : "Enable automod";
  $("#btn-am-toggle").className = cfg.enabled ? "btn danger" : "btn primary";

  fillSelect($("#am-log-channel"), g.channels.filter((c) => c.type === 0), cfg.logChannelId, "No text channels", true);

  $("#am-word-enabled").checked = cfg.wordFilter.enabled;
  $("#am-word-action").value = cfg.wordFilter.action;
  $("#am-spam-enabled").checked = cfg.spamDetection.enabled;
  $("#am-spam-count").value = cfg.spamDetection.messagesPerWindow ?? 5;
  $("#am-spam-window").value = cfg.spamDetection.windowSeconds ?? 10;
  $("#am-spam-action").value = cfg.spamDetection.action;
  $("#am-mention-enabled").checked = cfg.massMention.enabled;
  $("#am-mention-threshold").value = cfg.massMention.threshold ?? 5;
  $("#am-mention-action").value = cfg.massMention.action;
  $("#am-invite-enabled").checked = cfg.inviteBlocking.enabled;
  $("#am-invite-action").value = cfg.inviteBlocking.action;

  const wordList = $("#am-word-list");
  wordList.innerHTML = "";
  const words = cfg.wordFilter.words ?? [];
  if (!words.length) {
    wordList.innerHTML = `<span class="muted small">No blocked words.</span>`;
  } else {
    for (const w of words) {
      const label = document.createElement("label");
      label.className = "check";
      label.innerHTML = `<code>${escapeHtml(w)}</code>`;
      const btn = document.createElement("button");
      btn.className = "btn danger small";
      btn.textContent = "×";
      btn.style.marginLeft = "6px";
      btn.addEventListener("click", () => withGuild("automod/words/remove", { word: w }));
      label.appendChild(btn);
      wordList.appendChild(label);
    }
  }

  const caseList = $("#am-case-list");
  caseList.innerHTML = `<span class="muted small">${cfg.caseCount} case(s) logged.</span>`;
}

$("#btn-am-toggle").addEventListener("click", (e) => withGuild("automod/toggle", {}, e.currentTarget));

$("#btn-am-log-save").addEventListener("click", (e) =>
  withGuild("automod/config", { feature: "wordFilter", logChannelId: $("#am-log-channel").value || null }, e.currentTarget)
);

$("#btn-am-word-add").addEventListener("click", async (e) => {
  const word = $("#am-word-input").value.trim();
  if (!word) return;
  await withGuild("automod/words/add", { word }, e.currentTarget);
  $("#am-word-input").value = "";
});

$("#btn-am-word-save").addEventListener("click", (e) =>
  withGuild("automod/config", {
    feature: "wordFilter",
    enabled: $("#am-word-enabled").checked,
    action: $("#am-word-action").value
  }, e.currentTarget)
);

$("#btn-am-word-clear").addEventListener("click", async (e) => {
  if (!confirm("Clear all blocked words?")) return;
  await withGuild("automod/words/clear", {}, e.currentTarget);
});

$("#btn-am-spam-save").addEventListener("click", (e) =>
  withGuild("automod/config", {
    feature: "spamDetection",
    enabled: $("#am-spam-enabled").checked,
    messagesPerWindow: Number($("#am-spam-count").value),
    windowSeconds: Number($("#am-spam-window").value),
    action: $("#am-spam-action").value
  }, e.currentTarget)
);

$("#btn-am-mention-save").addEventListener("click", (e) =>
  withGuild("automod/config", {
    feature: "massMention",
    enabled: $("#am-mention-enabled").checked,
    threshold: Number($("#am-mention-threshold").value),
    action: $("#am-mention-action").value
  }, e.currentTarget)
);

$("#btn-am-invite-save").addEventListener("click", (e) =>
  withGuild("automod/config", {
    feature: "inviteBlocking",
    enabled: $("#am-invite-enabled").checked,
    action: $("#am-invite-action").value
  }, e.currentTarget)
);

$("#btn-am-cases-clear").addEventListener("click", async (e) => {
  if (!confirm("Clear all automod cases?")) return;
  await withGuild("automod/cases/clear", {}, e.currentTarget);
});

/* --- reaction roles --- */

function renderReactionRoles(g) {
  fillSelect($("#rr-role"), g.roles, null, "No roles available", false);

  const rr = g.reactionRoles?.length ? g.reactionRoles[g.reactionRoles.length - 1] : null;
  if (rr) {
    $("#rr-title").value = rr.title ?? "Pick your roles!";
    $("#rr-description").value = rr.description ?? "React to get a role.";
    $("#rr-color").value = rr.color ?? "#5865f2";
    $("#rr-status").textContent = `Active in <#${rr.channelId}> with ${rr.mappingCount} mapping(s).`;
  } else {
    $("#rr-status").textContent = "No reaction role message — create one below.";
  }

  const list = $("#rr-mapping-list");
  list.innerHTML = "";
  if (!rr || !rr.mappings?.length) {
    list.innerHTML = `<span class="muted small">No mappings yet.</span>`;
    return;
  }
  for (const m of rr.mappings) {
    const row = document.createElement("div");
    row.className = "ann-item";
    const info = document.createElement("div");
    info.className = "grow";
    info.innerHTML = `<strong>${escapeHtml(m.emoji)}</strong> → <span class="dc-mention">@${escapeHtml(m.roleName)}</span> ${m.label ? `<span class="muted small">(${escapeHtml(m.label)})</span>` : ""}`;
    const btn = document.createElement("button");
    btn.className = "btn danger small";
    btn.textContent = "Remove";
    btn.addEventListener("click", () => withGuild("reactionroles/remove-mapping", { emoji: m.emoji }));
    row.append(info, btn);
    list.appendChild(row);
  }
}

$("#btn-rr-add-mapping").addEventListener("click", (e) => {
  const emoji = $("#rr-emoji").value.trim();
  const roleId = $("#rr-role").value;
  if (!emoji || !roleId) return toast("Emoji and role required.", true);
  withGuild("reactionroles/add-mapping", { emoji, roleId, label: $("#rr-label").value.trim() }, e.currentTarget);
  $("#rr-emoji").value = "";
  $("#rr-label").value = "";
});

$("#btn-rr-delete").addEventListener("click", async (e) => {
  if (!confirm("Delete the reaction role message and all mappings?")) return;
  await withGuild("reactionroles/delete", {}, e.currentTarget);
});

/* --- leveling --- */

function renderLeveling(g) {
  const lv = g.leveling || { enabled: false, roles: [] };

  const ann = $("#lv-ann");
  fillSelect(ann, g.channels.filter((c) => c.type === 0), ann.value || lv.annChannelId, "No text channels", true);

  const cb = $("#lv-removelower");
  if (cb.dataset.guildId !== g.id) {
    cb.dataset.guildId = g.id;
    cb.checked = lv.removeLower !== false;
  }

  $("#lv-status").textContent = lv.enabled
    ? `Leveling is on — ${lv.userCount ? `${lv.userCount} member(s) earning XP` : "no activity yet"}${lv.annChannelId ? `, announcements in <#${lv.annChannelId}>` : ""}.`
    : "Leveling is off. Add a reward role below and save to enable it.";

  const roleSel = $("#lv-role");
  fillSelect(roleSel, g.roles, null, "No roles available", false);

  const list = $("#lv-rewards");
  list.innerHTML = "";
  const rewards = [...lv.roles].sort((a, b) => a.level - b.level);
  if (!rewards.length) {
    list.innerHTML = `<span class="muted small">No level reward roles yet — add one below.</span>`;
  }
  for (const r of rewards) {
    const row = document.createElement("div");
    row.className = "ann-item";
    const info = document.createElement("div");
    info.className = "grow";
    info.innerHTML = `Level <strong>${r.level}</strong> → <span class="dc-mention">@${escapeHtml(g.roles.find((x) => x.id === r.roleId)?.name ?? "(deleted role)")}</span>`;
    const btn = document.createElement("button");
    btn.className = "btn danger small";
    btn.textContent = "Remove";
    btn.addEventListener("click", () => withGuild("leveling/remove-role", { level: r.level }));
    row.append(info, btn);
    list.appendChild(row);
  }
}

$("#btn-lv-save").addEventListener("click", (e) =>
  withGuild(
    "leveling/save",
    {
      enabled: true,
      removeLower: $("#lv-removelower").checked,
      annChannelId: $("#lv-ann").value || null
    },
    e.currentTarget
  )
);

$("#btn-lv-add-role").addEventListener("click", (e) => {
  const roleId = $("#lv-role").value;
  const level = Number($("#lv-level").value);
  if (!roleId) return toast("Choose a role.", true);
  if (!Number.isInteger(level) || level < 1) return toast("Level must be a positive integer.", true);
  withGuild("leveling/set-role", { roleId, level }, e.currentTarget);
  withGuild("leveling/save", { enabled: true, removeLower: $("#lv-removelower").checked, annChannelId: $("#lv-ann").value || null });
});

/* --- role menus --- */

function renderRoleMenus(g) {
  const menus = g.roleMenus || [];

  const chSel = $("#rm-channel");
  fillSelect(chSel, g.channels.filter((c) => c.type === 0), null, "No text channels", false);

  const pick = $("#rm-pick");
  const current = pick.value;
  pick.innerHTML = "";
  if (!menus.length) {
    const o = document.createElement("option");
    o.textContent = "No menus yet";
    o.disabled = true;
    o.selected = true;
    pick.appendChild(o);
  } else {
    for (const m of menus) {
      const o = document.createElement("option");
      o.value = m.id;
      o.textContent = m.title;
      if (m.id === current) o.selected = true;
      pick.appendChild(o);
    }
  }

  const selected = menus.find((m) => m.id === pick.value) || menus[0] || null;
  if (selected) renderRoleMenuDetail(g, selected);
  else {
    $("#rm-current").textContent = "";
    $("#rm-roles").innerHTML = `<span class="muted small">No menus yet — create one above.</span>`;
  }

  const roleSel = $("#rm-role");
  fillSelect(roleSel, g.roles, null, "No roles available", false);
}

function renderRoleMenuDetail(g, m) {
  $("#rm-current").textContent = `"${m.title}" in <#${m.channelId}> · ${m.mode === "unique" ? "pick one" : "pick many"} · ${m.roles.length}/${25} roles`;

  const list = $("#rm-roles");
  list.innerHTML = "";
  if (!m.roles.length) {
    list.innerHTML = `<span class="muted small">No roles in this menu yet — add one below.${m.messageId ? "" : " The menu will post to the channel when the first role is added."}</span>`;
  }
  for (const r of m.roles) {
    const row = document.createElement("div");
    row.className = "ann-item";
    const info = document.createElement("div");
    info.className = "grow";
    info.innerHTML = `<span class="dc-mention">@${escapeHtml(g.roles.find((x) => x.id === r.roleId)?.name ?? "(deleted role)")}</span>` +
      (r.label ? ` <span class="muted small">(${escapeHtml(r.label)})</span>` : "");
    const btn = document.createElement("button");
    btn.className = "btn danger small";
    btn.textContent = "Remove";
    btn.addEventListener("click", () => withGuild("rolemenus/remove-role", { id: m.id, roleId: r.roleId }));
    row.append(info, btn);
    list.appendChild(row);
  }
}

$("#rm-pick").addEventListener("change", () => {
  const g = currentGuild();
  const m = (g?.roleMenus || []).find((x) => x.id === $("#rm-pick").value);
  if (m) renderRoleMenuDetail(g, m);
});

$("#btn-rm-create").addEventListener("click", (e) => {
  const channelId = $("#rm-channel").value;
  if (!channelId) return toast("Choose a channel.", true);
  withGuild(
    "rolemenus/create",
    {
      title: $("#rm-title").value.trim() || "Pick your roles!",
      description: $("#rm-description").value.trim() || "Select the roles you want.",
      color: $("#rm-color").value,
      mode: $("#rm-mode").value,
      channelId
    },
    e.currentTarget
  );
  $("#rm-description").value = "Select the roles you want.";
  $("#rm-title").value = "Pick your roles!";
});

$("#btn-rm-add-role").addEventListener("click", (e) => {
  const id = $("#rm-pick").value;
  const roleId = $("#rm-role").value;
  if (!id) return toast("Create a menu first.", true);
  if (!roleId) return toast("Choose a role.", true);
  withGuild("rolemenus/add-role", { id, roleId, label: $("#rm-label").value.trim() }, e.currentTarget);
  $("#rm-label").value = "";
});

$("#btn-rm-delete").addEventListener("click", async (e) => {
  const id = $("#rm-pick").value;
  if (!id) return toast("No menu to delete.", true);
  if (!confirm("Delete this role menu and remove its message?")) return;
  await withGuild("rolemenus/delete", { id }, e.currentTarget);
});

/* --- lockdown --- */

function renderLockdown(g) {
  fillSelect($("#ld-channel"), g.channels.filter((c) => c.type === 0), null, "No text channels", false);

  const list = $("#ld-list");
  list.innerHTML = "";
  const lockdowns = g.lockdowns ?? [];
  if (!lockdowns.length) {
    list.innerHTML = `<span class="muted small">No channels are currently locked.</span>`;
    return;
  }
  for (const l of lockdowns) {
    const row = document.createElement("div");
    row.className = "ann-item";
    const info = document.createElement("div");
    info.className = "grow";
    const age = Math.floor((Date.now() - l.lockedAt) / 60000);
    info.innerHTML = `<span class="dc-mention">#${escapeHtml(l.channelId)}</span> — locked by ${escapeHtml(l.lockedByName)} ${age}m ago`;
    const btn = document.createElement("button");
    btn.className = "btn primary small";
    btn.textContent = "Unlock";
    btn.addEventListener("click", () => withGuild("lockdown/unlock", { channelId: l.channelId }));
    row.append(info, btn);
    list.appendChild(row);
  }
}

$("#btn-ld-lock").addEventListener("click", (e) => {
  const channelId = $("#ld-channel").value;
  if (!channelId) return toast("Pick a channel first.", true);
  withGuild("lockdown/lock", { channelId }, e.currentTarget);
});

$("#btn-ld-unlock-all").addEventListener("click", async (e) => {
  const lockdowns = currentPayload?.lockdowns ?? [];
  if (!lockdowns.length) return toast("No channels are locked.");
  if (!confirm(`Unlock all ${lockdowns.length} locked channel(s)?`)) return;
  await withGuild("lockdown/unlock-all", {}, e.currentTarget);
});

/* --- giveaways --- */

function renderGiveaways(g, textChannels) {
  fillSelect($("#gw-channel"), textChannels, $("#gw-channel").value || null, "No text channels", false);

  const list = $("#gw-list");
  list.innerHTML = "";
  if (!g.giveaways.length) {
    list.innerHTML = `<span class="muted small">No giveaways yet.</span>`;
    return;
  }

  for (const gw of g.giveaways) {
    const chName = g.channels.find((c) => c.id === gw.channelId)?.name ?? "(deleted)";
    const row = document.createElement("div");
    row.className = "ann-item";

    const info = document.createElement("div");
    info.className = "grow";
    const head = document.createElement("div");
    head.className = "ann-head";
    head.innerHTML =
      `<span class="dc-mention">#${escapeHtml(chName)}</span> <strong>${escapeHtml(gw.title)}</strong>` +
      ` <span class="muted small">#${gw.id} · ${gw.winners} winner(s) · ${gw.entries} entries</span>`;
    const body = document.createElement("div");
    body.className = "small muted";
    body.textContent = gw.ended
      ? `Ended — winner(s): ${gw.winnerIds.length ? gw.winnerIds.join(", ") : "none"}`
      : `Ends ${fmtWhen(gw.endsAt)}`;
    info.append(head, body);

    const btnEnd = document.createElement("button");
    btnEnd.className = "btn danger small";
    btnEnd.textContent = "End now";
    btnEnd.addEventListener("click", (e) => withGuild("giveaways/end", { id: gw.id }, e.currentTarget));

    const btnReroll = document.createElement("button");
    btnReroll.className = "btn small";
    btnReroll.textContent = "Reroll";
    btnReroll.addEventListener("click", (e) => withGuild("giveaways/reroll", { id: gw.id }, e.currentTarget));

    if (!gw.ended) row.append(info, btnEnd);
    else row.append(info, btnReroll);
    list.appendChild(row);
  }
}

$("#btn-gw-create").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const title = $("#gw-title").value.trim();
  const description = $("#gw-description").value.trim();
  const duration = $("#gw-duration").value.trim();
  const winners = Number($("#gw-winners").value);
  if (!title || !description) return toast("Fill in title and description first.", true);
  if (!/^\d+\s*(?:min|[smhdw])(?:\d*\s*(?:min|[smhdw]))?$/i.test(duration))
    return toast("Couldn't parse the duration. Try something like 30s, 5m, 2h, 1d, or 1h30m.", true);

  await withGuild(
    "giveaways/create",
    {
      channelId: $("#gw-channel").value || null,
      title,
      description,
      link: $("#gw-link").value.trim(),
      code: $("#gw-code").value.trim(),
      duration,
      winners
    },
    btn
  );
  $("#gw-title").value = "";
  $("#gw-description").value = "";
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

/* --- emoji picker --- */

const COMMON_EMOJIS = [
  "⭐", "❤️", "🔥", "👍", "👎", "✅", "❌", "🎉", "😂", "😍",
  "🥳", "💯", "🚀", "💀", "👀", "🙌", "💪", "🫡", "⚡", "🏆"
];

let emojiPickerTarget = null;
let emojiPickerEl = null;

function createEmojiPicker() {
  if (emojiPickerEl) return emojiPickerEl;
  const picker = document.createElement("div");
  picker.className = "emoji-picker hidden";
  picker.id = "emoji-picker";

  const search = document.createElement("input");
  search.type = "text";
  search.placeholder = "Search emoji…";
  search.className = "emoji-picker-search";
  search.addEventListener("input", () => filterEmojiPicker(search.value));
  picker.appendChild(search);

  const sectionCommon = document.createElement("div");
  sectionCommon.className = "emoji-picker-section";
  const labelCommon = document.createElement("div");
  labelCommon.className = "emoji-picker-label";
  labelCommon.textContent = "Common";
  sectionCommon.appendChild(labelCommon);
  const gridCommon = document.createElement("div");
  gridCommon.className = "emoji-picker-grid";
  gridCommon.id = "ep-common";
  for (const e of COMMON_EMOJIS) {
    gridCommon.appendChild(makeEmojiBtn(e));
  }
  sectionCommon.appendChild(gridCommon);
  picker.appendChild(sectionCommon);

  const sectionCustom = document.createElement("div");
  sectionCustom.className = "emoji-picker-section";
  const labelCustom = document.createElement("div");
  labelCustom.className = "emoji-picker-label";
  labelCustom.textContent = "Server";
  sectionCustom.appendChild(labelCustom);
  const gridCustom = document.createElement("div");
  gridCustom.className = "emoji-picker-grid";
  gridCustom.id = "ep-custom";
  sectionCustom.appendChild(gridCustom);
  picker.appendChild(sectionCustom);

  document.body.appendChild(picker);
  emojiPickerEl = picker;

  document.addEventListener("click", (e) => {
    if (!picker.contains(e.target) && !e.target.classList.contains("emoji-picker-btn") && !e.target.classList.contains("emoji-trigger")) {
      picker.classList.add("hidden");
      emojiPickerTarget = null;
    }
  });

  return picker;
}

function makeEmojiBtn(emoji) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "emoji-picker-btn";
  btn.dataset.emoji = emoji;
  if (emoji.startsWith("<")) {
    const m = emoji.match(/^<a?:(\w+):(\d+)>$/);
    if (m) {
      const img = document.createElement("img");
      img.src = `https://cdn.discordapp.com/emojis/${m[2]}.webp?size=32`;
      img.alt = m[1];
      img.width = 24;
      img.height = 24;
      btn.appendChild(img);
    }
  } else {
    btn.textContent = emoji;
  }
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (emojiPickerTarget) {
      emojiPickerTarget.value = emoji;
      emojiPickerTarget.dispatchEvent(new Event("input"));
    }
    createEmojiPicker().classList.add("hidden");
    emojiPickerTarget = null;
  });
  return btn;
}

function populateCustomEmojis(guild) {
  const grid = document.getElementById("ep-custom");
  if (!grid) return;
  grid.innerHTML = "";
  const emojis = guild.customEmojis ?? [];
  if (!emojis.length) {
    const span = document.createElement("span");
    span.className = "muted small";
    span.textContent = "No custom emojis in this server";
    grid.appendChild(span);
    return;
  }
  for (const e of emojis) {
    const tag = e.animated ? "a" : "";
    grid.appendChild(makeEmojiBtn(`<${tag}:${e.name}:${e.id}>`));
  }
}

function filterEmojiPicker(query) {
  const q = query.toLowerCase().trim();
  const common = document.getElementById("ep-common");
  const custom = document.getElementById("ep-custom");
  if (common) {
    for (const btn of common.children) {
      btn.style.display = !q || btn.dataset.emoji.includes(q) ? "" : "none";
    }
  }
  if (custom) {
    for (const btn of custom.children) {
      btn.style.display = !q || btn.dataset.emoji.toLowerCase().includes(q) || (btn.querySelector("img")?.alt ?? "").toLowerCase().includes(q) ? "" : "none";
    }
  }
}

function openEmojiPicker(target) {
  const picker = createEmojiPicker();
  emojiPickerTarget = target;
  const g = currentGuild();
  if (g) {
    const grid = document.getElementById("ep-custom");
    if (grid) {
      grid.innerHTML = "";
      const emojis = g.customEmojis ?? [];
      if (!emojis.length) {
        const span = document.createElement("span");
        span.className = "muted small";
        span.textContent = "No custom emojis in this server";
        grid.appendChild(span);
      } else {
        for (const e of emojis) {
          const tag = e.animated ? "a" : "";
          grid.appendChild(makeEmojiBtn(`<${tag}:${e.name}:${e.id}>`));
        }
      }
    }
  }
  const rect = target.getBoundingClientRect();
  const pickerH = 340;
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < pickerH) {
    picker.style.top = `${Math.max(4, rect.top - pickerH - 4)}px`;
  } else {
    picker.style.top = `${rect.bottom + 4}px`;
  }
  picker.style.left = `${Math.min(rect.left, window.innerWidth - 330)}px`;
  picker.classList.remove("hidden");
  picker.querySelector("input").value = "";
  filterEmojiPicker("");
  picker.querySelector("input").focus();
}

document.querySelectorAll(".emoji-trigger").forEach((btn) => {
  const targetId = btn.dataset.target;
  const input = targetId && document.getElementById(targetId);
  if (input) btn.addEventListener("click", () => openEmojiPicker(input));
});

/* --- actions --- */

async function withGuild(action, body = {}, btn = null) {
  if (!selectedGuildId) return;
  const origLabel = btn ? btn.textContent : null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Working…";
  }
  let payload;
  try {
    payload = await api(`/api/guilds/${selectedGuildId}/${action}`, {
      method: "POST",
      body
    });
  } catch (err) {
    toast(err.message, true);
    return payload;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = origLabel;
    }
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

$("#btn-temp-setup").addEventListener("click", (e) =>
  withGuild("temp/setup", { channelId: $("#temp-channel").value }, e.currentTarget)
);

$("#btn-temp-disable").addEventListener("click", async (e) => {
  if (!confirm("Disable temporary channels? Existing temp channels will be left to expire on their own.")) return;
  await withGuild("temp/disable", {}, e.currentTarget);
});
$("#btn-stats-setup").addEventListener("click", (e) => withGuild("stats/setup", {}, e.currentTarget));
$("#btn-stats-refresh").addEventListener("click", (e) => withGuild("stats/refresh", {}, e.currentTarget));
$("#btn-stats-disable").addEventListener("click", async (e) => {
  if (!confirm("Remove the stats voice channels and stop updating them?")) return;
  await withGuild("stats/disable", {}, e.currentTarget);
});

$("#btn-tk-add").addEventListener("click", (e) =>
  withGuild("tickets/types/save", { name: "New Panel" }, e.currentTarget)
);

$("#btn-tk-post-combined").addEventListener("click", (e) => {
  const ids = [...document.querySelectorAll("#tk-combined-box input:checked")].map((cb) => cb.value);
  withGuild("tickets/post-combined", {
    channelId: $("#tk-combined-channel").value || null,
    typeIds: ids
  }, e.currentTarget);
});

$("#btn-commands").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "Registering…";
  try {
    await api("/api/commands/register", { method: "POST", body: {} });
    toast("Commands re-registered");
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});

/* --- tabs & search --- */

const TABS = ["overview", "channels", "messaging", "tickets", "roles", "automod", "moderation"];
let activeTab = null;

function tabSections() {
  return [...document.querySelectorAll("#guild-view section.card[data-tab]")];
}

function sectionSearchText(card) {
  if (!card.dataset.searchText) {
    card.dataset.searchText = (
      card.querySelector("h3")?.textContent +
      " " +
      (card.querySelector(".muted.small")?.textContent ?? "")
    ).toLowerCase();
  }
  return card.dataset.searchText;
}

function applyVisibility() {
  const q = $("#search").value.trim().toLowerCase();
  let count = 0;

  for (const card of tabSections()) {
    let visible;
    if (card.dataset.tab === "overview") {
      visible = q ? sectionSearchText(card).includes(q) : activeTab === "overview";
    } else if (q) {
      visible = sectionSearchText(card).includes(q);
    } else {
      visible = card.dataset.tab === activeTab;
    }
    card.classList.toggle("hidden", !visible);
    if (visible) count++;
  }

  const searching = q.length > 0;
  document.body.classList.toggle("searching", searching);
  const countEl = $("#search-count");
  if (searching) {
    countEl.textContent = `${count} match${count === 1 ? "" : "es"}`;
  } else {
    countEl.textContent = "";
  }
}

function applyTab(name) {
  if (!TABS.includes(name)) name = "overview";
  activeTab = name;
  try { localStorage.setItem("ys_tab", name); } catch {}
  document.querySelectorAll("#tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $("#search").value = "";
  applyVisibility();
}

function focusSearch() {
  $("#search").focus();
  $("#search").select();
}

$("#search").addEventListener("input", applyVisibility);

document.querySelectorAll("#tabs .tab").forEach((btn) =>
  btn.addEventListener("click", () => applyTab(btn.dataset.tab))
);

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    e.preventDefault();
    focusSearch();
  }
  if (e.key === "Escape") {
    $("#search").value = "";
    applyVisibility();
  }
});

applyTab((() => { try { return localStorage.getItem("ys_tab"); } catch { return null; } })());

/* --- overview --- */

function ovTile(icon, tab, targetId, name, state, stateClass = "") {
  const t = document.createElement("div");
  t.className = `ov-tile ${stateClass}`;
  t.innerHTML = `
    <div class="ov-tile-head"><span class="ov-tile-ico">${icon}</span><span class="ov-tile-name">${escapeHtml(name)}</span></div>
    <div class="ov-tile-foot"><span class="dot"></span><span>${escapeHtml(state)}</span></div>
  `;
  t.addEventListener("click", () => gotoFeature(tab, targetId));
  return t;
}

function gotoFeature(tab, targetId) {
  applyTab(tab);
  const card = document.getElementById(targetId);
  if (card) {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.remove("flash");
    void card.offsetWidth;
    card.classList.add("flash");
  }
}

function renderOverview(g) {
  const grid = $("#ov-grid");
  grid.innerHTML = "";
  const channelName = (id) => g.channels.find((c) => c.id === id)?.name ?? "";
  const tiles = [
    ovTile("🎟️", "tickets", "sec-tickets", "Tickets",
      `${g.tickets.types.length} type(s) · ${g.tickets.openCount} open`, g.tickets.types.length ? "on" : "off"),
    ovTile("💬", "messaging", "sec-welcome", "Welcome messages",
      g.welcome.enabled ? `On → ${channelName(g.welcome.channelId) || "(no channel)"}` : "Off",
      g.welcome.enabled ? "on" : "off"),
    ovTile("👋", "messaging", "sec-autoresponses", "Auto-responses",
      `${g.filters.length} rule(s)`, g.filters.length ? "on" : "off"),
    ovTile("🎁", "messaging", "sec-giveaways", "Giveaways",
      `${g.giveaways.filter((x) => !x.ended).length} running`, g.giveaways.some((x) => !x.ended) ? "on" : "off"),
    ovTile("📊", "messaging", "sec-polls", "Polls",
      `${g.polls.length} total`, g.polls.length ? "on" : "off"),
    ovTile("⏰", "messaging", "sec-reminders", "Reminders",
      `${g.reminders.length} set`, g.reminders.length ? "on" : "off"),
    ovTile("📣", "messaging", "sec-announcements", "Announcements",
      `${g.announcements.length} scheduled`, g.announcements.length ? "on" : "off"),
    ovTile("📨", "messaging", "sec-embedsender", "Embed sender",
      "Send a message or embed", "off"),
    ovTile("⭐", "messaging", "sec-starboard", "Starboard",
      g.starboard.enabled ? `On → ${channelName(g.starboard.channelId) || "(no channel)"}` : "Off",
      g.starboard.enabled ? "on" : "off"),
    ovTile("🔢", "messaging", "sec-counting", "Counting",
      g.counting.channelId ? `Active · reward: ${g.counting.rewardRoleId ? "set" : "none"}` : "Not set up",
      g.counting.channelId ? "on" : "off"),
    ovTile("📋", "messaging", "sec-surveys", "Surveys",
      `${g.surveys.length} created`, g.surveys.length ? "on" : "off"),
    ovTile("🔊", "channels", "sec-temp", "Temp channels",
      g.temp.enabled ? `On → ${channelName(g.temp.triggerId) || "(no trigger)"}` : "Off",
      g.temp.enabled ? "on" : "off"),
    ovTile("📈", "channels", "sec-stats", "Server stats",
      g.stats.enabled ? "Live channels on" : "Off", g.stats.enabled ? "on" : "off"),
    ovTile("📌", "channels", "sec-sticky", "Sticky messages",
      `${g.sticky.length} active`, g.sticky.length ? "on" : "off"),
    ovTile("🛡️", "automod", "sec-automod", "Automod",
      g.automod.enabled ? `On · ${g.automod.caseCount} case(s)` : "Off",
      g.automod.enabled ? "on" : "off"),
    ovTile("🚧", "moderation", "sec-lockdown", "Lockdown",
      `${g.lockdowns.length} locked`, g.lockdowns.length ? "warn" : "off"),
    ovTile("⚡", "moderation", "sec-update", "Auto-update",
      g.logChannelId ? `Logging → #${channelName(g.logChannelId) || "(deleted)"}` : "No logging channel",
      g.logChannelId ? "on" : "off"),
    ovTile("🎭", "roles", "sec-reactionroles", "Reaction roles",
      `${g.reactionRoles.length} message(s)`, g.reactionRoles.length ? "on" : "off"),
    ovTile("📚", "roles", "sec-rolemenus", "Role menus",
      `${g.roleMenus.length} menu(s)`, g.roleMenus.length ? "on" : "off"),
    ovTile("🧑‍🤝‍🧑", "roles", "sec-autoroles", "Auto-join roles",
      g.autoRoles.humanRoleId || g.autoRoles.botRoleId ? "Set" : "Off",
      g.autoRoles.humanRoleId || g.autoRoles.botRoleId ? "on" : "off"),
    ovTile("🏆", "roles", "sec-leveling", "Leveling",
      g.leveling.enabled ? `On · ${g.leveling.userCount} member(s)` : "Off",
      g.leveling.enabled ? "on" : "off"),
    ovTile("🧰", "moderation", "sec-commands", "Command toggles",
      g.disabledCommands.length ? `${g.disabledCommands.length} disabled` : "All enabled",
      g.disabledCommands.length ? "warn" : "on"),
    ovTile("🖥️", "moderation", "sec-panel", "Discord panel",
      g.panelRoleId ? "Role restricted" : "Manage Server only",
      g.panelRoleId ? "on" : "off")
  ];

  for (const t of tiles) grid.appendChild(t);
  $("#ov-empty").classList.toggle("hidden", tiles.length > 0);
}

async function refreshAll() {
  await Promise.all([loadStatus(), loadGuilds()]);
}

(async function init() {
  try {
    const st = await api("/api/status");
    if (st.frontendRev) panelRev = st.frontendRev;
    showLogin(false);
    await refreshAll();
  } catch {
    showLogin(true);
  }
  setInterval(loadStatus, 30_000);
})();