const DATA = {
  history: "data/history.csv",
  games: "data/games.csv",
  status: "data/status.json",
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
function latestDates(rows) { return [...new Set(rows.map(row => row.date))].sort(); }
function latestRows(rows) { const dates = latestDates(rows); return dates.length ? rows.filter(row => row.date === dates.at(-1)) : []; }
function pct(value) { return `${(number(value) * 100).toFixed(1)}%`; }
function record(row) { return `${row.wins}-${row.losses}`; }
function dateLabel(value) { return value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {month:"short", day:"numeric", year:"numeric"}) : "—"; }
function rankRows(rows) {
  return [...rows].sort((a, b) => number(b.win_pct) - number(a.win_pct) || number(b.point_diff) - number(a.point_diff) || number(b.wins) - number(a.wins) || a.item.localeCompare(b.item)).map((row, index) => ({...row, rank: index + 1}));
}
function teamMap(rows) { return Object.fromEntries(rows.map(row => [row.item_id, row])); }
function selectedTeamIds(games, itemId) { return games.filter(game => game.home_id === itemId || game.away_id === itemId); }
function gameOpponent(game, itemId) { return game.home_id === itemId ? game.away_id : game.home_id; }
function gameTeamName(game, itemId) { return game.home_id === itemId ? game.home_team : game.away_team; }
function gameScore(game, itemId) { return game.home_id === itemId ? number(game.home_score) : number(game.away_score); }
function opponentScore(game, itemId) { return game.home_id === itemId ? number(game.away_score) : number(game.home_score); }
function resultFor(game, itemId) { return game.winner_id === itemId ? "W" : "L"; }
function resultClass(result) { return result === "W" ? "winner" : "loser"; }
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

async function loadData() {
  const [historyResponse, gamesResponse, statusResponse] = await Promise.all([
    fetch(DATA.history), fetch(DATA.games), fetch(DATA.status),
  ]);
  const history = historyResponse.ok ? parseCSV(await historyResponse.text()) : [];
  const games = gamesResponse.ok ? parseCSV(await gamesResponse.text()) : [];
  const status = statusResponse.ok ? await statusResponse.json() : {};
  return {history, games, status};
}

function renderQuality(status) {
  const target = document.querySelector("#data-quality");
  if (!target) return;
  const quality = status.data_quality;
  target.textContent = quality?.ok === false ? `Data checks need attention · ${quality.issues?.length || 0} issue(s)` : `Data checks passed · ${status.games_logged || quality?.games_logged || 0} games logged`;
  target.className = quality?.ok === false ? "status-warn" : "status-good";
}

function renderToday(rows, games, status) {
  const dates = latestDates(rows), latest = rankRows(latestRows(rows)), previous = dates.length > 1 ? teamMap(rows.filter(row => row.date === dates.at(-2))) : {};
  const averageWin = latest.length ? latest.reduce((sum, row) => sum + number(row.win_pct), 0) / latest.length : 0;
  const movers = latest.map(row => ({...row, delta: number(row.win_pct) - number(previous[row.item_id]?.win_pct), pointDelta: number(row.point_diff) - number(previous[row.item_id]?.point_diff)})).filter(row => row.delta || row.pointDelta).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || Math.abs(b.pointDelta) - Math.abs(a.pointDelta)).slice(0, 8);
  document.querySelector("#run-status").textContent = status.run_time ? `Last pipeline run ${new Date(status.run_time).toLocaleString()}` : "No pipeline status available";
  document.querySelector("#latest-date").textContent = dateLabel(dates.at(-1));
  document.querySelector("#metrics").innerHTML = [[latest.length, "Teams tracked"], [averageWin, "Average win %", true], [latest[0]?.item || "—", "Current leader"], [status.games_logged || 0, "Games logged"]].map(([value, label, isPct]) => `<div class="metric"><strong>${isPct ? pct(value) : safe(value)}</strong><span>${label}</span></div>`).join("");
  document.querySelector("#leaders tbody").innerHTML = latest.slice(0, 12).map(row => `<tr><td><span class="rank-pill">${row.rank}</span>${safe(row.item)}</td><td>${safe(row.conference)}</td><td>${record(row)}</td><td>${pct(row.win_pct)}</td><td>${number(row.point_diff).toFixed(0)}</td><td>${safe(row.streak)}</td></tr>`).join("");
  document.querySelector("#movers").innerHTML = movers.length ? movers.map(row => `<div class="stack-row"><span><strong>${safe(row.item)}</strong><br><small>${safe(row.conference)}</small></span><strong class="${row.delta > 0 ? "delta-positive" : "delta-negative"}">${row.delta > 0 ? "+" : ""}${(row.delta * 100).toFixed(1)} pts<br><small>${row.pointDelta > 0 ? "+" : ""}${row.pointDelta.toFixed(0)} diff</small></strong></div>`).join("") : `<p class="muted">No completed games changed the snapshot.</p>`;
  const conferenceMap = {};
  latest.forEach(row => { conferenceMap[row.conference] ??= []; conferenceMap[row.conference].push(number(row.win_pct)); });
  document.querySelector("#conferences").innerHTML = Object.entries(conferenceMap).sort((a, b) => b[1].reduce((x, y) => x + y, 0) / b[1].length - a[1].reduce((x, y) => x + y, 0) / a[1].length).map(([conference, values]) => { const value = values.reduce((x, y) => x + y, 0) / values.length; return `<div class="bar-row"><span>${safe(conference)}</span><strong>${pct(value)}</strong></div>`; }).join("");

  const todayGames = games.filter(game => game.date === dates.at(-1));
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
  const latest = rankRows(latestRows(rows)), conference = document.querySelector("#conference-filter"), search = document.querySelector("#team-search"), sort = document.querySelector("#sort-field"), count = document.querySelector("#browse-count");
  [...new Set(latest.map(row => row.conference))].sort().forEach(value => conference.insertAdjacentHTML("beforeend", `<option value="${safe(value)}">${safe(value)}</option>`));
  function paint() {
    const query = search.value.toLowerCase(), selected = conference.value, field = sort.value;
    const filtered = latest.filter(row => row.item.toLowerCase().includes(query) && (!selected || row.conference === selected)).sort((a, b) => field === "item" ? a.item.localeCompare(b.item) : number(b[field]) - number(a[field]));
    count.textContent = `${filtered.length} teams shown`;
    document.querySelector("#browse-table tbody").innerHTML = filtered.map(row => `<tr><td><span class="rank-pill">${row.rank}</span>${safe(row.item)}</td><td>${safe(row.conference)}</td><td>${row.games_played}</td><td>${record(row)}</td><td>${pct(row.win_pct)}</td><td>${number(row.points_for).toFixed(0)}</td><td>${number(row.points_against).toFixed(0)}</td><td>${number(row.point_diff).toFixed(0)}</td><td>${safe(row.streak)}</td></tr>`).join("");
  }
  [search, conference, sort].forEach(element => element.addEventListener("input", paint)); paint();
}

function renderConferences(rows, games) {
  const latest = latestRows(rows), conferences = document.querySelector("#conference-filter"), title = document.querySelector("#conference-title");
  [...new Set(latest.map(row => row.conference))].sort().forEach(value => conferences.insertAdjacentHTML("beforeend", `<option value="${safe(value)}">${safe(value)}</option>`));
  function paint() {
    const selected = conferences.value, teams = latest.filter(row => !selected || row.conference === selected).map(row => ({...row, conferenceRecord: conferenceRecord(row.item_id, row.conference, games)})).sort((a, b) => b.conferenceRecord.wins / Math.max(b.conferenceRecord.total, 1) - a.conferenceRecord.wins / Math.max(a.conferenceRecord.total, 1) || number(b.win_pct) - number(a.win_pct) || number(b.point_diff) - number(a.point_diff));
    title.textContent = selected || "All conferences";
    document.querySelector("#conference-summary").innerHTML = selected ? `<div class="metric"><strong>${teams.length}</strong><span>Teams</span></div><div class="metric"><strong>${teams.filter(row => row.conferenceRecord.wins > row.conferenceRecord.losses).length}</strong><span>Teams above .500 in conference</span></div><div class="metric"><strong>${teams.length ? pct(teams.reduce((sum, row) => sum + number(row.win_pct), 0) / teams.length) : "0.0%"}</strong><span>Average overall win %</span></div>` : `<p class="muted">Choose a conference to see its table and conference records.</p>`;
    document.querySelector("#conference-table tbody").innerHTML = teams.map((row, index) => `<tr><td>${index + 1}</td><td>${safe(row.item)}</td><td>${safe(row.conference)}</td><td>${row.conferenceRecord.wins}-${row.conferenceRecord.losses}</td><td>${record(row)}</td><td>${pct(row.win_pct)}</td><td>${number(row.point_diff).toFixed(0)}</td></tr>`).join("");
  }
  conferences.addEventListener("input", paint); paint();
}

function renderCompare(rows, games) {
  const latest = rankRows(latestRows(rows)), map = teamMap(latest), selects = [document.querySelector("#compare-team-a"), document.querySelector("#compare-team-b")];
  selects.forEach(select => select.innerHTML = latest.map(row => `<option value="${row.item_id}">${safe(row.item)}</option>`).join(""));
  selects[0].value = latest[0]?.item_id || ""; selects[1].value = latest[1]?.item_id || latest[0]?.item_id || "";
  function form(itemId) {
    return selectedTeamIds(games, itemId).sort((a, b) => a.date.localeCompare(b.date)).slice(-5).map(game => `<span class="form-dot ${resultClass(resultFor(game, itemId))}" title="${dateLabel(game.date)}">${resultFor(game, itemId)}</span>`).join("") || `<span class="muted">No games</span>`;
  }
  function paint() {
    const a = map[selects[0].value], b = map[selects[1].value];
    if (!a || !b) return;
    const metrics = [["Win %", pct(a.win_pct), pct(b.win_pct), number(a.win_pct), number(b.win_pct)], ["Record", record(a), record(b), number(a.win_pct), number(b.win_pct)], ["Scoring avg", average(a.points_for, a.games_played), average(b.points_for, b.games_played), number(a.avg_points_for), number(b.avg_points_for)], ["Point diff", number(a.point_diff).toFixed(0), number(b.point_diff).toFixed(0), number(a.point_diff), number(b.point_diff)]];
    document.querySelector("#compare-cards").innerHTML = [a, b].map(row => `<div class="team-card"><span class="eyebrow">${safe(row.conference)}</span><h3>${safe(row.item)}</h3><strong>${record(row)}</strong><span>${pct(row.win_pct)} win rate · ${safe(row.streak)}</span><div class="form-strip">${form(row.item_id)}</div></div>`).join("");
    document.querySelector("#comparison-bars").innerHTML = metrics.map(([label, av, bv, an, bn]) => { const total = Math.max(Math.abs(an), Math.abs(bn), 1); return `<div class="comparison-row"><span>${label}</span><strong>${av}</strong><div class="compare-bar"><i style="width:${Math.min(100, Math.abs(an) / total * 100)}%"></i><em style="width:${Math.min(100, Math.abs(bn) / total * 100)}%"></em></div><strong>${bv}</strong></div>`; }).join("");
    const meetings = games.filter(game => (game.home_id === a.item_id && game.away_id === b.item_id) || (game.home_id === b.item_id && game.away_id === a.item_id)).sort((x, y) => y.date.localeCompare(x.date));
    document.querySelector("#head-to-head tbody").innerHTML = meetings.length ? meetings.map(game => `<tr><td>${dateLabel(game.date)}</td><td>${safe(game.home_team)} ${game.home_score}</td><td>${safe(game.away_team)} ${game.away_score}</td><td>${safe(game.winner_id === a.item_id ? a.item : b.item)}</td></tr>`).join("") : `<tr><td colspan="4" class="muted">No head-to-head games in the collected data.</td></tr>`;
  }
  selects.forEach(select => select.addEventListener("input", paint)); paint();
}

function renderSchedule(rows, games) {
  const latest = rankRows(latestRows(rows)), select = document.querySelector("#schedule-team"), count = document.querySelector("#schedule-count");
  select.innerHTML = latest.sort((a, b) => a.item.localeCompare(b.item)).map(row => `<option value="${row.item_id}">${safe(row.item)}</option>`).join("");
  function paint() {
    const itemId = select.value, team = latest.find(row => row.item_id === itemId), schedule = selectedTeamIds(games, itemId).sort((a, b) => b.date.localeCompare(a.date));
    count.textContent = `${schedule.length} completed games · ${team ? record(team) : ""}`;
    document.querySelector("#schedule-table tbody").innerHTML = schedule.length ? schedule.map(game => { const opponentId = gameOpponent(game, itemId), opponent = gameTeamName(game, opponentId), result = resultFor(game, itemId); return `<tr><td>${dateLabel(game.date)}</td><td><span class="badge ${resultClass(result)}">${result}</span></td><td>${safe(opponent)}</td><td>${gameScore(game, itemId)}-${opponentScore(game, itemId)}</td><td>${number(game.margin)}</td><td>${safe(game.home_conference === team?.conference && game.away_conference === team?.conference ? "Conference" : "Non-conference")}</td></tr>`; }).join("") : `<tr><td colspan="6" class="muted">No completed games logged for this team.</td></tr>`;
  }
  select.addEventListener("input", paint); paint();
}

function renderBubble(rows) {
  const latest = latestRows(rows).map(row => {
    const win = number(row.win_pct), avgDiff = number(row.games_played) ? number(row.point_diff) / number(row.games_played) : 0;
    const score = Math.round(win * 70 + Math.max(-10, Math.min(20, avgDiff)) * 1.5 + Math.min(20, number(row.games_played)) * 0.5);
    const tier = win >= 0.75 && avgDiff >= 5 ? "Projected field" : win >= 0.58 && avgDiff >= 0 ? "Bubble watch" : "Needs work";
    return {...row, score, tier, avgDiff};
  }).sort((a, b) => b.score - a.score);
  const filter = document.querySelector("#bubble-filter"), conference = document.querySelector("#bubble-conference"), conferences = [...new Set(latest.map(row => row.conference))].sort();
  conferences.forEach(value => conference.insertAdjacentHTML("beforeend", `<option value="${safe(value)}">${safe(value)}</option>`));
  function paint() {
    const filtered = latest.filter(row => (!filter.value || row.tier === filter.value) && (!conference.value || row.conference === conference.value));
    document.querySelector("#bubble-count").textContent = `${filtered.length} teams shown`;
    document.querySelector("#bubble-table tbody").innerHTML = filtered.map((row, index) => `<tr><td>${index + 1}</td><td><strong>${safe(row.item)}</strong></td><td>${safe(row.conference)}</td><td>${safe(row.tier)}</td><td>${row.score}</td><td>${record(row)}</td><td>${pct(row.win_pct)}</td><td>${row.avgDiff >= 0 ? "+" : ""}${row.avgDiff.toFixed(1)}</td></tr>`).join("");
  }
  [filter, conference].forEach(element => element.addEventListener("input", paint)); paint();
}

function drawChart(canvas, points, color, formatter) {
  const context = canvas.getContext("2d"), width = canvas.clientWidth || 700, height = 240, ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio; canvas.height = height * ratio; context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
  if (!points.length) return;
  const min = Math.min(...points), max = Math.max(...points), spread = max - min || 1;
  context.strokeStyle = "#d9e2ec"; context.lineWidth = 1; context.beginPath(); context.moveTo(0, height - 24); context.lineTo(width, height - 24); context.stroke();
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

loadData().then(({history, games, status}) => {
  renderQuality(status);
  const page = document.body.dataset.page;
  if (page === "today") renderToday(history, games, status);
  if (page === "browse") renderBrowse(history);
  if (page === "conferences") renderConferences(history, games);
  if (page === "compare") renderCompare(history, games);
  if (page === "schedule") renderSchedule(history, games);
  if (page === "bubble") renderBubble(history);
  if (page === "trends") renderTrends(history, games);
}).catch(error => {
  document.querySelector("main").insertAdjacentHTML("afterbegin", `<section class="panel"><strong>Data unavailable.</strong><p class="muted">${safe(error.message)}</p></section>`);
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
