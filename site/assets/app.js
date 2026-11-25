const DATA = {
  history: "data/history.csv",
  games: "data/games.csv",
  status: "data/status.json",
  rankings: "data/rankings.json",
};

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i], next = text[i + 1];
    if (char === '"' && quoted && next === '"') { field += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(field); field = ""; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field);
      if (row.some(value => value !== "")) rows.push(row);
      row = []; field = "";
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows.map(values => Object.fromEntries(header.map((key, i) => [key, values[i] ?? ""])));
}

function number(value) { return Number(value || 0); }
function safe(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;"}[character]));
}
function initials(name) {
  const words = String(name || "?").replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map(word => word[0]) : [words[0]?.slice(0, 3) || "?"]).join("").toUpperCase();
}
const THEME_KEY = "power-hoops-theme";
const FAVORITES_KEY = "power-hoops-favorites";
const BRACKET_KEY = "power-hoops-bracket-picks";
let favoriteIds = new Set();
let rosterIds = new Set();
let bracketPicks = {};
function favoriteButton(team) {
  const itemId = String(team.item_id || "");
  if (!itemId) return "";
  const active = favoriteIds.has(itemId);
  return `<button class="favorite-button${active ? " is-favorite" : ""}" type="button" data-favorite-id="${safe(itemId)}" data-favorite-name="${safe(team.item)}" aria-label="${active ? "Remove" : "Add"} ${safe(team.item)} ${active ? "from" : "to"} favorites" aria-pressed="${active}" title="${active ? "Remove from favorites" : "Add to favorites"}">${active ? "★" : "☆"}</button>`;
}
const CONFERENCE_LOGOS = {
  "America East Conference": "america_east",
  "American Athletic Conference": "american",
  "Atlantic 10 Conference": "atlantic_10",
  "Atlantic Coast Conference": "acc",
  "Atlantic Sun Conference": "atlantic_sun",
  "Big 12 Conference": "big_12",
  "Big East Conference": "big_east",
  "Big Sky Conference": "big_sky",
  "Big South Conference": "big_south",
  "Big Ten Conference": "big_ten",
  "Big West Conference": "big_west",
  "Coastal Athletic Association": "coastal",
  "Conference USA": "conference_usa",
  "Horizon League": "horizon",
  "Ivy League": "ivy",
  "Metro Conference": "metro",
  "Mid-American Conference": "mid_american",
  "Mid-Eastern Athletic Conference": "meac",
  "Missouri Valley Conference": "missouri_valley",
  "Mountain West Conference": "mountain_west",
  "Northeast Conference": "northeast",
  "Ohio Valley Conference": "ohio_valley",
  "Pac-12 Conference": "pac_12",
  "Patriot League": "patriot_league",
  "Southeastern Conference": "sec",
  "Southern Conference": "southern",
  "Southland Conference": "southland",
  "Southwestern Athletic Conference": "swac",
  "Summit League": "summit_league",
  "Sun Belt Conference": "sun_belt",
  "United Athletic Conference": "uac",
  "West Coast Conference": "west_coast",
};
const CONFERENCE_SHORT = {
  "America East Conference": "AE", "American Athletic Conference": "AAC", "Atlantic 10 Conference": "A-10", "Atlantic Coast Conference": "ACC", "Atlantic Sun Conference": "ASUN", "Big 12 Conference": "XII", "Big East Conference": "BE", "Big Sky Conference": "BSKY", "Big South Conference": "BS", "Big Ten Conference": "B1G", "Big West Conference": "BW", "Coastal Athletic Association": "CAA", "Conference USA": "C-USA", "Horizon League": "HL", "Ivy League": "IVY", "Metro Conference": "METRO", "Mid-American Conference": "MAC", "Mid-Eastern Athletic Conference": "MEAC", "Missouri Valley Conference": "MVC", "Mountain West Conference": "MW", "Northeast Conference": "NEC", "Ohio Valley Conference": "OVC", "Pac-12 Conference": "PAC-12", "Patriot League": "PAT", "Southeastern Conference": "SEC", "Southern Conference": "SOCON", "Southland Conference": "SLC", "Southwestern Athletic Conference": "SWAC", "Summit League": "SUMMIT", "Sun Belt Conference": "SBC", "United Athletic Conference": "UAC", "West Coast Conference": "WCC",
};
function conferenceMark(conference, options = {}) {
  const slug = CONFERENCE_LOGOS[conference], fallback = CONFERENCE_SHORT[conference] || initials(conference);
  return `<span class="conference-mark${options.large ? " large" : ""}"><img class="conference-logo" src="https://a.espncdn.com/i/teamlogos/ncaa_conf/500/${slug || "missing"}.png" alt="" loading="lazy" onerror="this.style.display='none'"><span class="conference-logo-fallback">${safe(fallback)}</span></span>`;
}
function conferenceLabel(conference, options = {}) {
  return `<span class="conference-cell${options.large ? " conference-heading" : ""}">${conferenceMark(conference, options)}<span class="conference-name">${safe(conference)}</span></span>`;
}
function teamLogo(team, options = {}) {
  const itemId = String(team.item_id || "");
  const favorite = options.showFavorite === false ? "" : favoriteButton(team);
  const identity = `<span class="logo-frame"><img class="team-logo" src="https://a.espncdn.com/i/teamlogos/ncaa/500/${encodeURIComponent(itemId)}.png" alt="" loading="lazy" onerror="this.style.display='none'"><span class="logo-fallback">${initials(team.item)}</span></span><span class="team-name">${safe(team.item)}</span>`;
  const linkedIdentity = options.link === false || !itemId || (rosterIds.size && !rosterIds.has(itemId)) ? identity : `<a class="team-link" href="team.html?id=${encodeURIComponent(itemId)}">${identity}</a>`;
  return `<span class="team-cell">${linkedIdentity}${favorite}</span>`;
}
function rankMovement(itemId, currentRanks, previousRanks) {
  const current = currentRanks[itemId], previous = previousRanks[itemId];
  if (!current || !previous || current === previous) return `<span class="rank-move neutral" data-tooltip="No rank change since the previous snapshot" title="No rank change">—</span>`;
  const movement = previous - current, direction = movement > 0 ? "up" : "down", amount = Math.abs(movement), word = movement > 0 ? "up" : "down";
  return `<span class="rank-move ${direction}" data-tooltip="Moved ${word} ${amount} ${amount === 1 ? "spot" : "spots"} since the previous snapshot" title="Moved ${word} ${amount} ${amount === 1 ? "spot" : "spots"}">${movement > 0 ? "▲" : "▼"}${amount}</span>`;
}
function latestDates(rows) { return [...new Set(rows.map(row => row.date))].sort(); }
function latestRows(rows) { const dates = latestDates(rows); return dates.length ? rows.filter(row => row.date === dates.at(-1)) : []; }
function pct(value) { return `${(number(value) * 100).toFixed(1)}%`; }
function record(row) { return `${row.wins}-${row.losses}`; }
function dateLabel(value) { return value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {month:"short", day:"numeric", year:"numeric"}) : "—"; }
function rankRows(rows) {
  return [...rows].sort((a, b) => number(b.win_pct) - number(a.win_pct) || number(b.wins) - number(a.wins) || number(b.point_diff) - number(a.point_diff) || a.item.localeCompare(b.item)).map((row, index) => ({...row, rank: index + 1}));
}
function teamMap(rows) { return Object.fromEntries(rows.map(row => [row.item_id, row])); }
function selectedTeamIds(games, itemId) { return games.filter(game => game.home_id === itemId || game.away_id === itemId); }
function gameOpponent(game, itemId) { return game.home_id === itemId ? game.away_id : game.home_id; }
function gameTeamName(game, itemId) { return game.home_id === itemId ? game.home_team : game.away_team; }
function gameScore(game, itemId) { return game.home_id === itemId ? number(game.home_score) : number(game.away_score); }
function opponentScore(game, itemId) { return game.home_id === itemId ? number(game.away_score) : number(game.home_score); }
function resultFor(game, itemId) { return game.winner_id === itemId ? "W" : "L"; }
function resultClass(result) { return result === "W" ? "winner" : "loser"; }
function pollTrend(value) {
  const trend = String(value || "—"), direction = trend.startsWith("+") ? "up" : trend.startsWith("-") ? "down" : "neutral";
  return `<span class="poll-trend ${direction}">${safe(trend)}</span>`;
}
function conferenceRecord(itemId, conference, games) {
  let wins = 0, losses = 0;
  games.forEach(game => {
    if (game.home_id !== itemId && game.away_id !== itemId) return;
    const opponentConference = game.home_id === itemId ? game.away_conference : game.home_conference;
    if (opponentConference !== conference) return;
    if (game.winner_id === itemId) wins += 1; else losses += 1;
  });
  return {wins, losses, total: wins + losses};
}
function average(value, games) { return games ? (number(value) / games).toFixed(1) : "0.0"; }

function initPreferences() {
  try {
    favoriteIds = new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]").map(String));
  } catch { favoriteIds = new Set(); }
  try { bracketPicks = JSON.parse(localStorage.getItem(BRACKET_KEY) || "{}") || {}; } catch { bracketPicks = {}; }
  let storedTheme = "light";
  try { storedTheme = localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"; } catch {}
  document.documentElement.dataset.theme = storedTheme;
  const themeToggle = document.querySelector("#theme-toggle");
  function paintThemeToggle() {
    if (!themeToggle) return;
    const dark = document.documentElement.dataset.theme === "dark";
    themeToggle.textContent = dark ? "Light mode" : "Dark mode";
    themeToggle.setAttribute("aria-pressed", String(dark));
    themeToggle.title = dark ? "Switch to light mode" : "Switch to dark mode";
  }
  themeToggle?.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { localStorage.setItem(THEME_KEY, dark ? "dark" : "light"); } catch {}
    paintThemeToggle();
  });
  paintThemeToggle();
  document.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest("[data-favorite-id]") : null;
    if (!button) return;
    event.preventDefault(); event.stopPropagation();
    const itemId = button.dataset.favoriteId;
    if (favoriteIds.has(itemId)) favoriteIds.delete(itemId); else favoriteIds.add(itemId);
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favoriteIds])); } catch {}
    document.querySelectorAll("[data-favorite-id]").forEach(item => {
      const active = favoriteIds.has(item.dataset.favoriteId);
      item.classList.toggle("is-favorite", active);
      item.textContent = active ? "★" : "☆";
      item.setAttribute("aria-pressed", String(active));
      item.setAttribute("aria-label", `${active ? "Remove" : "Add"} ${item.dataset.favoriteName} ${active ? "from" : "to"} favorites`);
      item.title = active ? "Remove from favorites" : "Add to favorites";
    });
    document.dispatchEvent(new CustomEvent("favoriteschange", {detail: {itemId}}));
  });
}
function saveBracketPicks() {
  try { localStorage.setItem(BRACKET_KEY, JSON.stringify(bracketPicks)); } catch {}
}

function compareLeaderboard(a, b, field) {
  if (field === "item" || field === "conference") return String(a[field]).localeCompare(String(b[field]));
  if (field === "record") return number(a.wins) - number(b.wins) || number(a.losses) - number(b.losses);
  if (field === "win_pct") return number(a.win_pct) - number(b.win_pct) || number(a.wins) - number(b.wins) || number(a.point_diff) - number(b.point_diff);
  if (field === "streak") {
    const streakA = Number(String(a.streak).slice(1)) || 0, streakB = Number(String(b.streak).slice(1)) || 0;
    return streakA - streakB || String(a.streak).localeCompare(String(b.streak));
  }
  return number(a[field]) - number(b[field]);
}

function sortedLeaderboard(rows, field, direction) {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * compareLeaderboard(a, b, field)).map((row, index) => ({...row, rank: index + 1}));
}

async function loadData() {
  const [historyResponse, gamesResponse, statusResponse, rankingsResponse] = await Promise.all([
    fetch(DATA.history), fetch(DATA.games), fetch(DATA.status), fetch(DATA.rankings),
  ]);
  const history = historyResponse.ok ? parseCSV(await historyResponse.text()) : [];
  const games = gamesResponse.ok ? parseCSV(await gamesResponse.text()) : [];
  const status = statusResponse.ok ? await statusResponse.json() : {};
  const rankings = rankingsResponse.ok ? await rankingsResponse.json() : {};
  return {history, games, status, rankings};
}

function renderQuality(status) {
  const target = document.querySelector("#data-quality");
  document.querySelectorAll("#days-ran, [data-days-ran]").forEach(days => { days.textContent = `Days ran: ${status.days_with_success ?? "—"}`; });
  if (!target) return;
  const quality = status.data_quality;
  target.textContent = quality?.ok === false ? `Data checks need attention · ${quality.issues?.length || 0} issue(s)` : `Data checks passed · ${status.games_logged || quality?.games_logged || 0} games logged`;
  target.className = quality?.ok === false ? "status-warn" : "status-good";
}

function renderPolls(rankings) {
  const target = document.querySelector("#polls"), week = document.querySelector("#poll-week"), polls = rankings?.polls || [];
  if (!target) return;
  week.textContent = rankings?.week || "Latest poll";
  target.innerHTML = polls.length ? polls.map(poll => `<div class="poll-card"><div class="poll-card-heading"><div><p class="eyebrow">Weekly national poll</p><h3>${safe(poll.short_name || poll.name)}</h3></div><span class="pill">${poll.date ? dateLabel(poll.date.slice(0, 10)) : "Latest"}</span></div><div class="poll-list">${poll.ranks.map(entry => { const notes = [entry.record, entry.points ? `${Math.round(number(entry.points))} pts` : "", entry.first_place_votes ? `${entry.first_place_votes} first-place` : ""].filter(Boolean).join(" · "); return `<div class="poll-row"><span class="poll-rank">${safe(entry.rank)}</span>${teamLogo({item_id: entry.team_id, item: entry.team}, {showFavorite: false})}<span class="poll-meta">${safe(notes)}</span>${pollTrend(entry.trend)}</div>`; }).join("")}</div></div>`).join("") : `<p class="muted">AP and Coaches poll data is not available yet.</p>`;
}

function renderToday(rows, games, status, rankings) {
  const dates = latestDates(rows), latest = rankRows(latestRows(rows)), previous = dates.length > 1 ? teamMap(rows.filter(row => row.date === dates.at(-2))) : {};
  const currentRanks = Object.fromEntries(latest.map(row => [row.item_id, row.rank])), previousRanks = Object.fromEntries(rankRows(Object.values(previous)).map(row => [row.item_id, row.rank]));
  const averageWin = latest.length ? latest.reduce((sum, row) => sum + number(row.win_pct), 0) / latest.length : 0;
  const movers = latest.map(row => ({...row, delta: number(row.win_pct) - number(previous[row.item_id]?.win_pct), pointDelta: number(row.point_diff) - number(previous[row.item_id]?.point_diff)})).filter(row => row.delta || row.pointDelta).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || Math.abs(b.pointDelta) - Math.abs(a.pointDelta)).slice(0, 8);
  document.querySelector("#run-status").textContent = status.run_time ? `Last pipeline run ${new Date(status.run_time).toLocaleString()}` : "No pipeline status available";
  document.querySelector("#latest-date").textContent = dateLabel(dates.at(-1));
  document.querySelector("#metrics").innerHTML = [[latest.length, "Teams tracked"], [averageWin, "Average win %", true], [latest[0]?.item || "—", "Current leader"], [status.games_logged || 0, "Games logged"]].map(([value, label, isPct]) => `<div class="metric"><strong>${isPct ? pct(value) : safe(value)}</strong><span>${label}</span></div>`).join("");
  renderPolls(rankings);
  const leaderSnapshot = latestRows(rows);
  let leaderSortField = "win_pct", leaderSortDirection = "desc";
  const leaderHeaders = [...document.querySelectorAll("#leaders th[data-sort]")];
  function paintLeaderboard() {
    const sorted = sortedLeaderboard(leaderSnapshot, leaderSortField, leaderSortDirection);
    document.querySelector("#leaders tbody").innerHTML = sorted.slice(0, 12).map(row => `<tr><td class="rank-cell"><span class="rank-number">${row.rank}</span>${rankMovement(row.item_id, currentRanks, previousRanks)}</td><td>${teamLogo(row)}</td><td>${conferenceLabel(row.conference)}</td><td>${record(row)}</td><td>${pct(row.win_pct)}</td><td>${number(row.point_diff).toFixed(0)}</td><td>${safe(row.streak)}</td></tr>`).join("");
    leaderHeaders.forEach(header => {
      const active = header.dataset.sort === leaderSortField;
      header.classList.toggle("sort-active", active);
      header.dataset.order = active ? leaderSortDirection : "";
      header.setAttribute("aria-sort", active ? (leaderSortDirection === "asc" ? "ascending" : "descending") : "none");
    });
  }
  leaderHeaders.forEach(header => {
    const activate = () => {
      if (leaderSortField === header.dataset.sort) leaderSortDirection = leaderSortDirection === "asc" ? "desc" : "asc";
      else { leaderSortField = header.dataset.sort; leaderSortDirection = ["item", "conference"].includes(leaderSortField) ? "asc" : "desc"; }
      paintLeaderboard();
    };
    header.addEventListener("click", activate);
    header.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } });
  });
  paintLeaderboard();
  document.querySelector("#movers").innerHTML = movers.length ? movers.map(row => `<div class="stack-row"><span><strong>${safe(row.item)}</strong><br><small>${safe(row.conference)}</small></span><strong class="${row.delta > 0 ? "delta-positive" : "delta-negative"}">${row.delta > 0 ? "+" : ""}${(row.delta * 100).toFixed(1)} pts<br><small>${row.pointDelta > 0 ? "+" : ""}${row.pointDelta.toFixed(0)} diff</small></strong></div>`).join("") : `<p class="muted">No completed games changed the snapshot.</p>`;
  const conferenceMap = {};
  latest.forEach(row => { conferenceMap[row.conference] ??= []; conferenceMap[row.conference].push(number(row.win_pct)); });
  document.querySelector("#conferences").innerHTML = Object.entries(conferenceMap).sort((a, b) => b[1].reduce((x, y) => x + y, 0) / b[1].length - a[1].reduce((x, y) => x + y, 0) / a[1].length).map(([conference, values]) => { const value = values.reduce((x, y) => x + y, 0) / values.length; return `<div class="bar-row">${conferenceLabel(conference)}<strong>${pct(value)}</strong></div>`; }).join("");

  const todayGames = games.filter(game => game.date === dates.at(-1));
  const scoreboard = document.querySelector("#scoreboard");
  const scoreboardCount = document.querySelector("#scoreboard-count");
  if (scoreboard && scoreboardCount) {
    scoreboardCount.textContent = `${todayGames.length} ${todayGames.length === 1 ? "game" : "games"}`;
    scoreboard.innerHTML = todayGames.length ? todayGames.slice(0, 12).map(game => {
      const homeWon = game.winner_id === game.home_id, awayWon = game.winner_id === game.away_id;
      return `<article class="score-card"><div class="score-card-top"><span class="badge">FINAL</span><span>${String(game.neutral_site).toLowerCase() === "true" ? "Neutral" : ""}</span></div><div class="score-line ${homeWon ? "score-winner" : ""}">${teamLogo({item_id: game.home_id, item: game.home_team}, {showFavorite: false})}<strong>${number(game.home_score)}</strong></div><div class="score-line ${awayWon ? "score-winner" : ""}">${teamLogo({item_id: game.away_id, item: game.away_team}, {showFavorite: false})}<strong>${number(game.away_score)}</strong></div></article>`;
    }).join("") : `<p class="muted">No completed games logged for the latest date.</p>`;
  }
  const recap = [
    ["Biggest win", [...todayGames].sort((a, b) => number(b.margin) - number(a.margin))[0], game => game ? `${safe(game.winner_id === game.home_id ? game.home_team : game.away_team)} won by ${game.margin}` : "No games logged"],
    ["Closest game", [...todayGames].sort((a, b) => number(a.margin) - number(b.margin))[0], game => game ? `${safe(game.home_team)} ${game.home_score}, ${safe(game.away_team)} ${game.away_score}` : "No games logged"],
    ["Highest scoring", [...todayGames].sort((a, b) => number(b.total_points) - number(a.total_points))[0], game => game ? `${safe(game.home_team)} ${game.home_score}, ${safe(game.away_team)} ${game.away_score}` : "No games logged"],
  ];
  document.querySelector("#daily-recap").innerHTML = recap.map(([label, game, text]) => `<div class="recap-card"><span class="eyebrow">${label}</span><strong>${text(game)}</strong><small>${game ? dateLabel(game.date) : ""}</small></div>`).join("");
  const map = teamMap(latest), upsets = todayGames.map(game => ({game, winner: map[game.winner_id], loser: map[game.loser_id], gap: number(map[game.loser_id]?.win_pct) - number(map[game.winner_id]?.win_pct)})).filter(row => row.winner && row.loser && row.loser.games_played >= 3 && row.gap >= 0.15).sort((a, b) => b.gap - a.gap).slice(0, 6);
  document.querySelector("#upsets").innerHTML = upsets.length ? upsets.map(({game, winner, loser, gap}) => `<div class="alert-row"><span><strong>${safe(winner.item)}</strong> over ${safe(loser.item)}<br><small>${game.home_score}-${game.away_score} · ${pct(gap)} profile gap</small></span><span class="badge">UPSET</span></div>`).join("") : `<p class="muted">No large profile upsets in the latest game set.</p>`;
}

function renderBrowse(rows) {
  const dates = latestDates(rows), latest = rankRows(latestRows(rows)), previous = dates.length > 1 ? rankRows(rows.filter(row => row.date === dates.at(-2))) : [], currentRanks = Object.fromEntries(latest.map(row => [row.item_id, row.rank])), previousRanks = Object.fromEntries(previous.map(row => [row.item_id, row.rank])), conference = document.querySelector("#conference-filter"), search = document.querySelector("#team-search"), sort = document.querySelector("#sort-field"), favoritesOnly = document.querySelector("#favorites-only"), count = document.querySelector("#browse-count");
  [...new Set(latest.map(row => row.conference))].sort().forEach(value => conference.insertAdjacentHTML("beforeend", `<option value="${safe(value)}">${safe(value)}</option>`));
  function paint() {
    const query = search.value.toLowerCase(), selected = conference.value, field = sort.value;
    const filtered = latest.filter(row => row.item.toLowerCase().includes(query) && (!selected || row.conference === selected) && (!favoritesOnly?.checked || favoriteIds.has(String(row.item_id)))).sort((a, b) => field === "item" ? a.item.localeCompare(b.item) : number(b[field]) - number(a[field]));
    count.textContent = `${filtered.length} teams shown`;
    document.querySelector("#browse-table tbody").innerHTML = filtered.map(row => `<tr><td class="rank-cell"><span class="rank-number">${row.rank}</span>${rankMovement(row.item_id, currentRanks, previousRanks)}</td><td>${teamLogo(row)}</td><td>${conferenceLabel(row.conference)}</td><td>${row.games_played}</td><td>${record(row)}</td><td>${pct(row.win_pct)}</td><td>${number(row.points_for).toFixed(0)}</td><td>${number(row.points_against).toFixed(0)}</td><td>${number(row.point_diff).toFixed(0)}</td><td>${safe(row.streak)}</td></tr>`).join("");
  }
  [search, conference, sort, favoritesOnly].filter(Boolean).forEach(element => element.addEventListener("input", paint));
  document.addEventListener("favoriteschange", paint); paint();
}

function renderConferences(rows, games) {
  const latest = latestRows(rows), conferences = document.querySelector("#conference-filter"), title = document.querySelector("#conference-title");
  [...new Set(latest.map(row => row.conference))].sort().forEach(value => conferences.insertAdjacentHTML("beforeend", `<option value="${safe(value)}">${safe(value)}</option>`));
  function paint() {
    const selected = conferences.value, teams = latest.filter(row => !selected || row.conference === selected).map(row => ({...row, conferenceRecord: conferenceRecord(row.item_id, row.conference, games)})).sort((a, b) => b.conferenceRecord.wins / Math.max(b.conferenceRecord.total, 1) - a.conferenceRecord.wins / Math.max(a.conferenceRecord.total, 1) || number(b.win_pct) - number(a.win_pct) || number(b.point_diff) - number(a.point_diff));
    title.innerHTML = selected ? conferenceLabel(selected, {large: true}) : "All conferences";
    document.querySelector("#conference-summary").innerHTML = selected ? `<div class="metric"><strong>${teams.length}</strong><span>Teams</span></div><div class="metric"><strong>${teams.filter(row => row.conferenceRecord.wins > row.conferenceRecord.losses).length}</strong><span>Teams above .500 in conference</span></div><div class="metric"><strong>${teams.length ? pct(teams.reduce((sum, row) => sum + number(row.win_pct), 0) / teams.length) : "0.0%"}</strong><span>Average overall win %</span></div>` : `<p class="muted">Choose a conference to see its table and conference records.</p>`;
    document.querySelector("#conference-table tbody").innerHTML = teams.map((row, index) => `<tr><td>${index + 1}</td><td>${teamLogo(row)}</td><td>${conferenceLabel(row.conference)}</td><td>${row.conferenceRecord.wins}-${row.conferenceRecord.losses}</td><td>${record(row)}</td><td>${pct(row.win_pct)}</td><td>${number(row.point_diff).toFixed(0)}</td></tr>`).join("");
  }
  conferences.addEventListener("input", paint); paint();
}

function renderCompare(rows, games) {
  const latest = rankRows(latestRows(rows)), inputs = [document.querySelector("#compare-team-a"), document.querySelector("#compare-team-b")], lists = [document.querySelector("#compare-team-a-options"), document.querySelector("#compare-team-b-options")];
  function populateOptions(index) {
    const query = inputs[index].value.trim().toLowerCase(), choices = latest.filter(row => row.item.toLowerCase().includes(query));
    lists[index].innerHTML = choices.map(row => `<option value="${safe(row.item)}"></option>`).join("");
    paint();
  }
  function form(itemId) {
    return selectedTeamIds(games, itemId).sort((a, b) => a.date.localeCompare(b.date)).slice(-5).map(game => `<span class="form-dot ${resultClass(resultFor(game, itemId))}" title="${dateLabel(game.date)}">${resultFor(game, itemId)}</span>`).join("") || `<span class="muted">No games</span>`;
  }
  function paint() {
    const findTeam = input => latest.find(row => row.item.toLowerCase() === input.value.trim().toLowerCase());
    const a = findTeam(inputs[0]), b = findTeam(inputs[1]);
    if (!a || !b) {
      document.querySelector("#compare-cards").innerHTML = `<p class="muted">Choose a team from each searchable dropdown.</p>`;
      return;
    }
    const metrics = [["Win %", pct(a.win_pct), pct(b.win_pct), number(a.win_pct), number(b.win_pct)], ["Record", record(a), record(b), number(a.win_pct), number(b.win_pct)], ["Scoring avg", average(a.points_for, a.games_played), average(b.points_for, b.games_played), number(a.avg_points_for), number(b.avg_points_for)], ["Point diff", number(a.point_diff).toFixed(0), number(b.point_diff).toFixed(0), number(a.point_diff), number(b.point_diff)]];
    document.querySelector("#compare-cards").innerHTML = [a, b].map(row => `<div class="team-card"><span class="eyebrow">${safe(row.conference)}</span><h3>${teamLogo(row)}</h3><strong>${record(row)}</strong><span>${pct(row.win_pct)} win rate · ${safe(row.streak)}</span><div class="form-strip">${form(row.item_id)}</div></div>`).join("");
    document.querySelector("#comparison-bars").innerHTML = metrics.map(([label, av, bv, an, bn]) => { const total = Math.max(Math.abs(an), Math.abs(bn), 1); return `<div class="comparison-row"><span>${label}</span><strong>${av}</strong><div class="compare-bar"><i style="width:${Math.min(100, Math.abs(an) / total * 100)}%"></i><em style="width:${Math.min(100, Math.abs(bn) / total * 100)}%"></em></div><strong>${bv}</strong></div>`; }).join("");
    const meetings = games.filter(game => (game.home_id === a.item_id && game.away_id === b.item_id) || (game.home_id === b.item_id && game.away_id === a.item_id)).sort((x, y) => y.date.localeCompare(x.date));
    document.querySelector("#head-to-head tbody").innerHTML = meetings.length ? meetings.map(game => `<tr><td>${dateLabel(game.date)}</td><td>${safe(game.home_team)} ${game.home_score}</td><td>${safe(game.away_team)} ${game.away_score}</td><td>${safe(game.winner_id === a.item_id ? a.item : b.item)}</td></tr>`).join("") : `<tr><td colspan="4" class="muted">No head-to-head games in the collected data.</td></tr>`;
  }
  inputs[0].value = latest[0]?.item || ""; inputs[1].value = latest[1]?.item || latest[0]?.item || "";
  inputs.forEach((input, index) => input.addEventListener("input", () => populateOptions(index)));
  populateOptions(0); populateOptions(1);
}

function renderSchedule(rows, games) {
  const latest = rankRows(latestRows(rows)), select = document.querySelector("#schedule-team"), count = document.querySelector("#schedule-count");
  select.innerHTML = latest.sort((a, b) => a.item.localeCompare(b.item)).map(row => `<option value="${row.item_id}">${safe(row.item)}</option>`).join("");
  function paint() {
    const itemId = select.value, team = latest.find(row => row.item_id === itemId), schedule = selectedTeamIds(games, itemId).sort((a, b) => b.date.localeCompare(a.date));
    count.textContent = `${schedule.length} completed games · ${team ? record(team) : ""}`;
    document.querySelector("#schedule-table tbody").innerHTML = schedule.length ? schedule.map(game => { const opponentId = gameOpponent(game, itemId), opponent = gameTeamName(game, opponentId), result = resultFor(game, itemId); return `<tr><td>${dateLabel(game.date)}</td><td><span class="badge ${resultClass(result)}">${result}</span></td><td>${teamLogo({item_id: opponentId, item: opponent})}</td><td>${gameScore(game, itemId)}-${opponentScore(game, itemId)}</td><td>${number(game.margin)}</td><td>${safe(game.home_conference === team?.conference && game.away_conference === team?.conference ? "Conference" : "Non-conference")}</td></tr>`; }).join("") : `<tr><td colspan="6" class="muted">No completed games logged for this team.</td></tr>`;
  }
  select.addEventListener("input", paint); paint();
}

function bubbleLocation(game, itemId) {
  if (String(game.neutral_site).toLowerCase() === "true") return "neutral";
  return game.home_id === itemId ? "home" : "away";
}

function bubbleQuadrant(rank, location) {
  if (!rank) return "Q4";
  const limits = {home: [30, 75, 160], neutral: [50, 100, 200], away: [75, 135, 240]}[location] || [75, 135, 240];
  if (rank <= limits[0]) return "Q1";
  if (rank <= limits[1]) return "Q2";
  if (rank <= limits[2]) return "Q3";
  return "Q4";
}

function bubbleProfiles(rows, games) {
  const snapshot = latestRows(rows), ranked = rankRows(snapshot), teams = teamMap(snapshot), rankMap = Object.fromEntries(ranked.map(row => [row.item_id, row.rank]));
  const conferenceValues = {};
  snapshot.forEach(row => { conferenceValues[row.conference] ??= []; conferenceValues[row.conference].push(number(row.win_pct)); });
  const conferenceStrength = Object.fromEntries(Object.entries(conferenceValues).map(([conference, values]) => [conference, values.reduce((sum, value) => sum + value, 0) / values.length]));
  return snapshot.map(row => {
    const teamGames = selectedTeamIds(games, row.item_id).sort((a, b) => a.date.localeCompare(b.date));
    const quadrants = {Q1: {wins: 0, losses: 0}, Q2: {wins: 0, losses: 0}, Q3: {wins: 0, losses: 0}, Q4: {wins: 0, losses: 0}};
    let opponentStrength = 0, countedOpponents = 0;
    teamGames.forEach(game => {
      const opponent = teams[gameOpponent(game, row.item_id)];
      if (!opponent) return;
      opponentStrength += number(opponent.win_pct); countedOpponents += 1;
      const quadrant = bubbleQuadrant(rankMap[opponent.item_id], bubbleLocation(game, row.item_id));
      if (game.winner_id === row.item_id) quadrants[quadrant].wins += 1; else quadrants[quadrant].losses += 1;
    });
    const recent = teamGames.slice(-10), recentWins = recent.filter(game => game.winner_id === row.item_id).length, recentLosses = recent.length - recentWins, recentPct = recent.length ? recentWins / recent.length : 0;
    const avgDiff = number(row.games_played) ? number(row.point_diff) / number(row.games_played) : 0;
    const sos = countedOpponents ? opponentStrength / countedOpponents : 0;
    const qualityWins = quadrants.Q1.wins + quadrants.Q2.wins;
    const badLosses = quadrants.Q3.losses + quadrants.Q4.losses;
    const marginScore = (Math.max(-10, Math.min(20, avgDiff)) + 10) / 30 * 10;
    const score = Math.max(0, Math.min(100, Math.round(number(row.win_pct) * 45 + sos * 20 + number(conferenceStrength[row.conference]) * 5 + recentPct * 10 + marginScore + quadrants.Q1.wins * 2 + quadrants.Q2.wins * 0.75 - quadrants.Q1.losses * 1.5 - badLosses * 2)));
    const tier = score >= 70 && badLosses === 0 ? "Projected field" : score >= 55 && badLosses <= 2 ? "Bubble watch" : "Needs work";
    return {...row, score, tier, avgDiff, sos, recentPct, recentWins, recentLosses, qualityWins, badLosses, conferenceStrength: conferenceStrength[row.conference], quadrants};
  }).sort((a, b) => b.score - a.score || number(b.win_pct) - number(a.win_pct) || number(b.wins) - number(a.wins));
}

function renderBubble(rows, games) {
  const profiles = bubbleProfiles(rows, games);
  const filter = document.querySelector("#bubble-filter"), conference = document.querySelector("#bubble-conference"), conferences = [...new Set(profiles.map(row => row.conference))].sort();
  conferences.forEach(value => conference.insertAdjacentHTML("beforeend", `<option value="${safe(value)}">${safe(value)}</option>`));
  function paint() {
    const filtered = profiles.filter(row => (!filter.value || row.tier === filter.value) && (!conference.value || row.conference === conference.value));
    document.querySelector("#bubble-count").textContent = `${filtered.length} teams shown`;
    document.querySelector("#bubble-table tbody").innerHTML = filtered.map((row, index) => `<tr><td>${index + 1}</td><td>${teamLogo(row)}</td><td>${conferenceLabel(row.conference)}</td><td>${safe(row.tier)}</td><td>${row.score}</td><td>${pct(row.sos)}</td><td>${pct(row.conferenceStrength)}</td><td>${row.quadrants.Q1.wins}-${row.quadrants.Q1.losses}</td><td>${row.quadrants.Q2.wins}-${row.quadrants.Q2.losses}</td><td>${row.badLosses}</td><td>${row.recentWins}-${row.recentLosses}</td></tr>`).join("");
  }
  [filter, conference].forEach(element => element.addEventListener("input", paint)); paint();
}

function renderTeam(rows, games, rankings) {
  const itemId = new URLSearchParams(window.location.search).get("id"), latest = latestRows(rows), team = latest.find(row => row.item_id === itemId);
  const title = document.querySelector("#team-title"), subtitle = document.querySelector("#team-subtitle");
  if (!team) {
    title.textContent = "Team not found";
    subtitle.innerHTML = `Choose a team from <a class="text-link" href="browse.html">Browse</a> to open its profile.`;
    return;
  }
  const teamGames = selectedTeamIds(games, itemId).sort((a, b) => a.date.localeCompare(b.date));
  const rankEntries = Object.fromEntries((rankings?.polls || []).map(poll => [poll.key, poll.ranks.find(entry => String(entry.team_id) === String(itemId))]));
  const ap = rankEntries.ap, coaches = rankEntries.coaches;
  const conferenceGames = teamGames.filter(game => game.home_conference === team.conference && game.away_conference === team.conference);
  const conferenceWins = conferenceGames.filter(game => game.winner_id === itemId).length;
  const pointDiffPerGame = number(team.games_played) ? number(team.point_diff) / number(team.games_played) : 0;
  title.textContent = team.item;
  subtitle.innerHTML = `${conferenceLabel(team.conference)} <span class="muted">· ${record(team)} · ${dateLabel(team.date)}</span>`;
  document.querySelector("#team-hero-logo").innerHTML = teamLogo(team, {link: false});
  document.querySelector("#team-summary").innerHTML = [[record(team), "Overall record"], [pct(team.win_pct), "Win percentage"], [`${pointDiffPerGame >= 0 ? "+" : ""}${pointDiffPerGame.toFixed(1)}`, "Point diff. / game"], [`AP ${ap ? `#${ap.rank}` : "NR"}`, `Coaches ${coaches ? `#${coaches.rank}` : "NR"}`]].map(([value, label]) => `<div class="metric"><strong>${safe(value)}</strong><span>${safe(label)}</span></div>`).join("");
  document.querySelector("#team-polls").innerHTML = [["AP Top 25", ap], ["Coaches Poll", coaches]].map(([label, entry]) => `<div class="team-poll-row"><span>${label}</span><strong>${entry ? `#${entry.rank}` : "NR"}</strong><small>${entry ? `${safe(entry.record)} · ${pollTrend(entry.trend)}` : "Not ranked"}</small></div>`).join("");
  const recent = teamGames.slice(-10).reverse(), recentWins = recent.filter(game => game.winner_id === itemId).length;
  document.querySelector("#team-form-record").textContent = `${recentWins}-${recent.length - recentWins}`;
  document.querySelector("#team-form").innerHTML = recent.length ? recent.map(game => `<span class="form-dot ${resultClass(resultFor(game, itemId))}" title="${dateLabel(game.date)} vs ${safe(gameTeamName(game, gameOpponent(game, itemId)))}">${resultFor(game, itemId)}</span>`).join("") : `<span class="muted">No completed games</span>`;
  document.querySelector("#team-conference-record").textContent = `${conferenceWins}-${conferenceGames.length - conferenceWins} conference record`;
  document.querySelector("#team-games-count").textContent = `${teamGames.length} completed games`;
  const timeline = rows.filter(row => row.item_id === itemId).sort((a, b) => a.date.localeCompare(b.date));
  drawChart(document.querySelector("#team-win-chart"), timeline.map(row => number(row.win_pct)), "#2f80ed", pct);
  drawChart(document.querySelector("#team-diff-chart"), timeline.map(row => number(row.games_played) ? number(row.point_diff) / number(row.games_played) : 0), "#ef8354", value => `${value >= 0 ? "+" : ""}${value.toFixed(1)}`);
  document.querySelector("#team-schedule tbody").innerHTML = teamGames.slice().reverse().map(game => { const opponentId = gameOpponent(game, itemId), opponent = gameTeamName(game, opponentId), result = resultFor(game, itemId), type = game.home_conference === team.conference && game.away_conference === team.conference ? "Conference" : "Non-conference"; return `<tr><td>${dateLabel(game.date)}</td><td><span class="badge ${resultClass(result)}">${result}</span></td><td>${teamLogo({item_id: opponentId, item: opponent})}</td><td>${gameScore(game, itemId)}-${opponentScore(game, itemId)}</td><td>${number(game.margin)}</td><td>${type}</td></tr>`; }).join("") || `<tr><td colspan="6" class="muted">No completed games logged.</td></tr>`;
}

function renderBracket(rows, games) {
  const regionsTarget = document.querySelector("#bracket-regions"), finalTarget = document.querySelector("#bracket-final"), profiles = bubbleProfiles(rows, games).slice(0, 64);
  if (!regionsTarget || profiles.length < 64) {
    regionsTarget.innerHTML = `<p class="muted">The bracket needs at least 64 scored teams.</p>`;
    return;
  }
  const regionNames = ["East", "West", "South", "Midwest"], seedOrder = [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11], roundNames = ["Round of 64", "Round of 32", "Sweet 16", "Elite 8"];
  function createGame(region, round, index, teamA, teamB) {
    return {id: `${region}-${round}-${index}`, round, teamA, teamB, modelWinner: teamA.score >= teamB.score ? teamA : teamB};
  }
  function winnerOf(game) {
    const picked = bracketPicks[game.id];
    return [game.teamA, game.teamB].find(team => team.item_id === picked) || game.modelWinner;
  }
  function buildRegion(region, regionIndex) {
    const pool = profiles.slice(regionIndex * 16, regionIndex * 16 + 16), firstRound = [];
    for (let index = 0; index < 8; index += 1) {
      const seedA = seedOrder[index * 2], seedB = seedOrder[index * 2 + 1];
      firstRound.push(createGame(`${regionIndex}`, 1, index, {...pool[seedA - 1], seed: seedA}, {...pool[seedB - 1], seed: seedB}));
    }
    const rounds = [firstRound];
    for (let round = 2; round <= 4; round += 1) {
      const previous = rounds.at(-1), next = [];
      for (let index = 0; index < previous.length; index += 2) next.push(createGame(`${regionIndex}`, round, index / 2, winnerOf(previous[index]), winnerOf(previous[index + 1])));
      rounds.push(next);
    }
    return {name: region, rounds, champion: winnerOf(rounds[3][0])};
  }
  function gameCard(game) {
    const selected = bracketPicks[game.id] === game.teamA.item_id || bracketPicks[game.id] === game.teamB.item_id;
    const pickButton = team => `<button class="bracket-pick${bracketPicks[game.id] === team.item_id ? " selected" : ""}" type="button" data-bracket-game="${safe(game.id)}" data-bracket-team="${safe(team.item_id)}" aria-pressed="${bracketPicks[game.id] === team.item_id}"><span class="bracket-seed">${team.seed || ""}</span>${teamLogo(team, {link: false, showFavorite: false})}<strong class="bracket-score">${team.score}</strong></button>`;
    return `<div class="bracket-game"><div class="bracket-seed-label">${selected ? "Your pick" : "Score model"}</div>${pickButton(game.teamA)}${pickButton(game.teamB)}<small>Model: ${safe(game.modelWinner.item)}</small></div>`;
  }
  function paint() {
    const regionData = regionNames.map((name, index) => buildRegion(name, index));
    const semifinalA = createGame("final", 4, 0, regionData[0].champion, regionData[1].champion), semifinalB = createGame("final", 4, 1, regionData[2].champion, regionData[3].champion), championship = createGame("final", 5, 0, winnerOf(semifinalA), winnerOf(semifinalB));
    regionsTarget.innerHTML = regionData.map((region, index) => `<section class="panel bracket-region ${index % 2 ? "right" : "left"}"><div class="panel-heading"><div><p class="eyebrow">Score-seeded region</p><h2>${region.name}</h2></div><span class="pill">16 teams</span></div><div class="bracket-rounds">${region.rounds.map((round, roundIndex) => `<div class="bracket-round"><h3>${roundNames[roundIndex]}</h3><div class="bracket-games">${round.map(gameCard).join("")}</div></div>`).join("")}</div></section>`).join("");
    finalTarget.innerHTML = `<div class="final-four-board"><div class="final-four-game"><p class="eyebrow">East vs West</p>${gameCard(semifinalA)}</div><div class="final-four-game"><p class="eyebrow">South vs Midwest</p>${gameCard(semifinalB)}</div><div class="championship-game"><p class="eyebrow">National championship</p>${gameCard(championship)}</div></div>`;
    const allGames = [...regionData.flatMap(region => region.rounds.flat()), semifinalA, semifinalB, championship], validPicks = allGames.filter(game => bracketPicks[game.id] === game.teamA.item_id || bracketPicks[game.id] === game.teamB.item_id).length;
    document.querySelector("#bracket-field").textContent = `${profiles.length} teams`;
    document.querySelector("#bracket-picks").textContent = `${validPicks}/${allGames.length}`;
    document.querySelector("#bracket-model-champion").textContent = championship.modelWinner.item;
    document.querySelector("#bracket-your-champion").textContent = winnerOf(championship).item;
    document.querySelectorAll("[data-bracket-game][data-bracket-team]").forEach(button => button.addEventListener("click", () => { bracketPicks[button.dataset.bracketGame] = button.dataset.bracketTeam; saveBracketPicks(); paint(); }));
  }
  document.querySelector("#use-model-picks").onclick = () => { bracketPicks = {}; paint(); const regionData = regionNames.map((name, index) => buildRegion(name, index)); regionData.flatMap(region => region.rounds.flat()).forEach(game => { bracketPicks[game.id] = game.modelWinner.item_id; }); const semifinalA = createGame("final", 4, 0, regionData[0].champion, regionData[1].champion), semifinalB = createGame("final", 4, 1, regionData[2].champion, regionData[3].champion), championship = createGame("final", 5, 0, winnerOf(semifinalA), winnerOf(semifinalB)); [semifinalA, semifinalB, championship].forEach(game => { bracketPicks[game.id] = game.modelWinner.item_id; }); saveBracketPicks(); paint(); };
  document.querySelector("#clear-bracket-picks").onclick = () => { bracketPicks = {}; saveBracketPicks(); paint(); };
  paint();
}

function drawChart(canvas, points, color, formatter) {
  const context = canvas.getContext("2d"), width = canvas.clientWidth || 700, height = 240, ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio; canvas.height = height * ratio; context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
  if (!points.length) return;
  const min = Math.min(...points), max = Math.max(...points), spread = max - min || 1;
  context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--line").trim() || "#d9e2ec"; context.lineWidth = 1; context.beginPath(); context.moveTo(0, height - 24); context.lineTo(width, height - 24); context.stroke();
  context.strokeStyle = color; context.lineWidth = 3; context.beginPath(); points.forEach((point, index) => { const x = points.length === 1 ? width / 2 : index / (points.length - 1) * width; const y = 16 + (max - point) / spread * (height - 48); index ? context.lineTo(x, y) : context.moveTo(x, y); }); context.stroke();
  context.fillStyle = color; context.font = "12px system-ui"; context.fillText(formatter(points.at(-1)), 8, 18);
}

function renderTrends(rows, games) {
  const teams = [...new Map(rows.map(row => [row.item_id, row])).values()].sort((a, b) => a.item.localeCompare(b.item)), select = document.querySelector("#trend-team");
  select.innerHTML = teams.map(team => `<option value="${team.item_id}">${safe(team.item)}</option>`).join("");
  function paint() {
    const selected = select.value, timeline = rows.filter(row => row.item_id === selected).sort((a, b) => a.date.localeCompare(b.date)), teamGames = selectedTeamIds(games, selected).sort((a, b) => a.date.localeCompare(b.date));
    const wins = timeline.map(row => number(row.win_pct)), diffs = timeline.map(row => number(row.point_diff)), scoring = timeline.map(row => number(row.avg_points_for));
    document.querySelector("#trend-win-label").textContent = pct(wins.at(-1)); document.querySelector("#trend-diff-label").textContent = `${diffs.at(-1) >= 0 ? "+" : ""}${diffs.at(-1).toFixed(0)}`; document.querySelector("#trend-scoring-label").textContent = `${scoring.at(-1).toFixed(1)} PPG`;
    drawChart(document.querySelector("#win-chart"), wins, "#2f80ed", pct); drawChart(document.querySelector("#diff-chart"), diffs, "#ef8354", value => value.toFixed(0)); drawChart(document.querySelector("#scoring-chart"), scoring, "#2d9d78", value => value.toFixed(1));
    document.querySelector("#recent-form").innerHTML = teamGames.slice(-10).reverse().map(game => `<span class="form-dot ${resultClass(resultFor(game, selected))}" title="${dateLabel(game.date)} vs ${safe(gameTeamName(game, gameOpponent(game, selected)))}">${resultFor(game, selected)}</span>`).join("") || `<span class="muted">No games logged</span>`;
  }
  select.addEventListener("change", paint); paint();
}

initPreferences();
loadData().then(({history, games, status, rankings}) => {
  rosterIds = new Set(history.map(row => row.item_id));
  renderQuality(status);
  const page = document.body.dataset.page;
  if (page === "today") renderToday(history, games, status, rankings);
  if (page === "browse") renderBrowse(history);
  if (page === "conferences") renderConferences(history, games);
  if (page === "compare") renderCompare(history, games);
  if (page === "schedule") renderSchedule(history, games);
  if (page === "bubble") renderBubble(history, games);
  if (page === "trends") renderTrends(history, games);
  if (page === "team") renderTeam(history, games, rankings);
  if (page === "bracket") renderBracket(history, games);
}).catch(error => {
  document.querySelector("main").insertAdjacentHTML("afterbegin", `<section class="panel"><strong>Data unavailable.</strong><p class="muted">${safe(error.message)}</p></section>`);
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
