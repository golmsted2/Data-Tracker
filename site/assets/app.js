const DATA = { history: "data/history.csv", status: "data/status.json" };

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i], next = text[i + 1];
    if (char === '"' && quoted && next === '"') { field += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(field); field = ""; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && next === '\n') i += 1; row.push(field); if (row.some(value => value !== "")) rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows.map(values => Object.fromEntries(header.map((key, i) => [key, values[i] ?? ""])));
}

function number(value) { return Number(value || 0); }
function latestDates(rows) { return [...new Set(rows.map(row => row.date))].sort(); }
function latestRows(rows) { const dates = latestDates(rows); return rows.filter(row => row.date === dates.at(-1)); }
function pct(value) { return `${(number(value) * 100).toFixed(1)}%`; }
function record(row) { return `${row.wins}-${row.losses}`; }

async function loadData() {
  const [historyResponse, statusResponse] = await Promise.all([fetch(DATA.history), fetch(DATA.status)]);
  const history = historyResponse.ok ? parseCSV(await historyResponse.text()) : [];
  const status = statusResponse.ok ? await statusResponse.json() : {};
  return { history, status };
}

function renderToday(rows, status) {
  const dates = latestDates(rows), latest = latestRows(rows), previous = dates.length > 1 ? rows.filter(row => row.date === dates.at(-2)) : [];
  const byId = Object.fromEntries(previous.map(row => [row.item_id, row]));
  const averageWin = latest.length ? latest.reduce((sum, row) => sum + number(row.win_pct), 0) / latest.length : 0;
  const leaders = [...latest].sort((a,b) => number(b.win_pct) - number(a.win_pct) || number(b.point_diff) - number(a.point_diff)).slice(0, 10);
  const movers = latest.map(row => ({ ...row, delta: number(row.point_diff) - number(byId[row.item_id]?.point_diff) })).filter(row => row.delta).sort((a,b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 8);
  document.querySelector("#run-status").textContent = status.run_time ? `Last pipeline run ${new Date(status.run_time).toLocaleString()}` : "No pipeline status available";
  document.querySelector("#latest-date").textContent = dates.at(-1) || "No data";
  document.querySelector("#metrics").innerHTML = [[latest.length,"Teams tracked"],[averageWin,"Average win %",true],[leaders[0]?.item || "—","Current leader"],[status.days_with_success || dates.length,"Days collected"]].map(([value,label,isPct]) => `<div class="metric"><strong>${isPct ? pct(value) : value}</strong><span>${label}</span></div>`).join("");
  document.querySelector("#leaders tbody").innerHTML = leaders.map(row => `<tr><td>${row.item}</td><td>${row.conference}</td><td>${record(row)}</td><td>${pct(row.win_pct)}</td><td>${number(row.point_diff).toFixed(0)}</td><td>${row.streak}</td></tr>`).join("");
  document.querySelector("#movers").innerHTML = movers.length ? movers.map(row => `<div class="stack-row"><span><strong>${row.item}</strong><br><small>${row.conference}</small></span><strong class="${row.delta > 0 ? "delta-positive" : "delta-negative"}">${row.delta > 0 ? "+" : ""}${row.delta.toFixed(0)} pts</strong></div>`).join("") : `<p class="muted">No completed games changed the snapshot.</p>`;
  const conferenceMap = {};
  latest.forEach(row => { conferenceMap[row.conference] ??= []; conferenceMap[row.conference].push(number(row.win_pct)); });
  document.querySelector("#conferences").innerHTML = Object.entries(conferenceMap).sort((a,b) => b[1].reduce((x,y) => x+y,0)/b[1].length - a[1].reduce((x,y) => x+y,0)/a[1].length).map(([conference, values]) => { const value = values.reduce((x,y) => x+y,0)/values.length; return `<div class="bar-row"><span>${conference}</span><strong>${pct(value)}</strong></div>`; }).join("");
}

function renderBrowse(rows) {
  const latest = latestRows(rows), conference = document.querySelector("#conference-filter"), search = document.querySelector("#team-search"), sort = document.querySelector("#sort-field");
  [...new Set(latest.map(row => row.conference))].sort().forEach(value => { conference.insertAdjacentHTML("beforeend", `<option value="${value}">${value}</option>`); });
  function paint() { const query = search.value.toLowerCase(), selected = conference.value, field = sort.value; const filtered = latest.filter(row => row.item.toLowerCase().includes(query) && (!selected || row.conference === selected)).sort((a,b) => field === "item" ? a.item.localeCompare(b.item) : number(b[field]) - number(a[field])); document.querySelector("#browse-table tbody").innerHTML = filtered.map(row => `<tr><td>${row.item}</td><td>${row.conference}</td><td>${row.games_played}</td><td>${record(row)}</td><td>${pct(row.win_pct)}</td><td>${number(row.points_for).toFixed(0)}</td><td>${number(row.points_against).toFixed(0)}</td><td>${number(row.point_diff).toFixed(0)}</td><td>${row.streak}</td></tr>`).join(""); }
  [search, conference, sort].forEach(element => element.addEventListener("input", paint)); paint();
}

function drawChart(canvas, points, color, formatter) {
  const context = canvas.getContext("2d"), width = canvas.clientWidth || 700, height = 240, ratio = window.devicePixelRatio || 1; canvas.width = width * ratio; canvas.height = height * ratio; context.scale(ratio, ratio); context.clearRect(0,0,width,height); if (!points.length) return; const min = Math.min(...points), max = Math.max(...points), spread = max - min || 1; context.strokeStyle = "#d9e2ec"; context.lineWidth = 1; context.beginPath(); context.moveTo(0,height-24); context.lineTo(width,height-24); context.stroke(); context.strokeStyle = color; context.lineWidth = 3; context.beginPath(); points.forEach((point,index) => { const x = points.length === 1 ? width/2 : index/(points.length-1)*width; const y = 16 + (max-point)/spread*(height-48); index ? context.lineTo(x,y) : context.moveTo(x,y); }); context.stroke(); context.fillStyle = color; context.font = "12px system-ui"; context.fillText(formatter(points.at(-1)), 8, 18); }

function renderTrends(rows) { const teams = [...new Map(rows.map(row => [row.item_id, row])).values()].sort((a,b) => a.item.localeCompare(b.item)), select = document.querySelector("#trend-team"); select.innerHTML = teams.map(team => `<option value="${team.item_id}">${team.item}</option>`).join(""); function paint() { const selected = select.value, timeline = rows.filter(row => row.item_id === selected).sort((a,b) => a.date.localeCompare(b.date)); const wins = timeline.map(row => number(row.win_pct)), diffs = timeline.map(row => number(row.point_diff)); document.querySelector("#trend-win-label").textContent = pct(wins.at(-1)); document.querySelector("#trend-diff-label").textContent = `${diffs.at(-1) >= 0 ? "+" : ""}${diffs.at(-1).toFixed(0)}`; drawChart(document.querySelector("#win-chart"), wins, "#2f80ed", pct); drawChart(document.querySelector("#diff-chart"), diffs, "#ef8354", value => value.toFixed(0)); } select.addEventListener("change", paint); paint(); }

loadData().then(({history, status}) => { const page = document.body.dataset.page; if (page === "today") renderToday(history, status); if (page === "browse") renderBrowse(history); if (page === "trends") renderTrends(history); }).catch(error => { document.querySelector("main").insertAdjacentHTML("afterbegin", `<section class="panel"><strong>Data unavailable.</strong><p class="muted">${error.message}</p></section>`); });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

