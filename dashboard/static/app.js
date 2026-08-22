const fmtPct = (v) => {
  if (v === null || v === undefined) return `<span class="chip flat">—</span>`;
  const cls = v > 0 ? "pos" : v < 0 ? "neg" : "flat";
  const sign = v > 0 ? "+" : "";
  return `<span class="chip ${cls}">${sign}${v.toFixed(2)}%</span>`;
};

const fmtMoney = (v) =>
  v === null || v === undefined
    ? "—"
    : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtNum = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString());

const fmtCompactMoney = (v) => {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return fmtMoney(n);
};

const truncCell = (text, max = 22) => {
  const s = String(text || "");
  const short = s.length > max ? s.slice(0, max - 1) + "…" : s;
  return `<span title="${s.replace(/"/g, "&quot;")}">${short}</span>`;
};

function sparklineSvg(values) {
  if (!values || values.length < 2) return `<span class="muted">—</span>`;
  const w = 90, h = 28, pad = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const step = (w - pad * 2) / (values.length - 1);
  const points = values.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const rising = values[values.length - 1] >= values[0];
  const color = rising ? "var(--green)" : "var(--red)";
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polyline points="${points.join(" ")}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

let accountHashes = [];

async function loadAccountHashes() {
  const res = await fetch("/api/accounts/hashes");
  accountHashes = await res.json();
  const sel = document.getElementById("buy-account");
  sel.innerHTML = accountHashes
    .map((a) => `<option value="${a.hashValue}">${a.accountNumber}</option>`)
    .join("");
}

async function loadPortfolio() {
  const res = await fetch("/api/portfolio");
  const accounts = await res.json();

  const accountsEl = document.getElementById("accounts");
  accountsEl.innerHTML = accounts
    .map(
      (a) => `
    <div class="account-card">
      <div class="label">${a.type} · ${a.accountNumber.slice(-4).padStart(a.accountNumber.length, "•")}</div>
      <div class="value mono">${fmtMoney(a.buyingPower)}</div>
      <div class="sub"><span>Buying power</span><span class="mono">${fmtMoney(a.liquidationValue)} total</span></div>
    </div>`
    )
    .join("");

  const rows = accounts.flatMap((a) =>
    a.positions.map(
      (p) => `
    <tr>
      <td class="al">
        <div class="ticker clickable" onclick="openBuyModal('${p.symbol}', ${p.currentPrice || "null"})">${p.symbol}</div>
        <div class="cell-sub">${p.description || ""}</div>
      </td>
      <td class="mono">${fmtNum(p.qty)}</td>
      <td class="mono">${fmtMoney(p.avgPrice)}</td>
      <td class="mono">${fmtMoney(p.currentPrice)}</td>
      <td>${sparklineSvg(p.sparkline)}</td>
      <td>${fmtPct(p.change1D)}</td>
      <td>${fmtPct(p.change3D)}</td>
      <td>${fmtPct(p.change5D)}</td>
      <td>${fmtPct(p.change1M)}</td>
      <td>${fmtPct(p.changeAllTime)}</td>
      <td class="mono">${fmtMoney(p.marketValue)}</td>
      <td>${p.assetType === "EQUITY" ? `<button class="protect-btn" onclick="openProtectModal('${p.symbol}', ${p.qty}, ${p.currentPrice || "null"}, '${a.accountNumber}')">Protect</button>` : ""}</td>
    </tr>`
    )
  );
  document.querySelector("#positions-table tbody").innerHTML =
    rows.join("") || `<tr><td colspan="12" class="muted" style="text-align:center;padding:24px">No positions</td></tr>`;

  document.getElementById("last-updated").textContent =
    "Updated " + new Date().toLocaleTimeString();
}

function currentFilterParams() {
  return new URLSearchParams({
    max_price: document.getElementById("f-max-price").value,
    min_qty: document.getElementById("f-min-qty").value,
    titles: document.getElementById("f-titles").value,
  });
}

function setFilterStatus(msg, isError) {
  const el = document.getElementById("filter-status");
  el.textContent = msg;
  el.style.color = isError ? "var(--red)" : "var(--muted)";
}

async function loadInsiders() {
  const tbody = document.querySelector("#insider-table tbody");
  try {
    const res = await fetch(`/api/insiders?${currentFilterParams()}`);
    const data = await res.json();

    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="9" class="muted" style="text-align:center;padding:24px">${data.error || "Request failed"}</td></tr>`;
      setFilterStatus(data.error || "Request failed", true);
      return;
    }

    tbody.innerHTML =
      data
        .map(
          (r) => `
    <tr>
      <td class="al ticker clickable" onclick="openBuyModal('${r["Ticker"]}', ${r["Price"]})">${r["Ticker"]}</td>
      <td class="al trunc">${truncCell(r["Company Name"], 20)}</td>
      <td class="al trunc">${truncCell(r["Insider Name"], 16)}</td>
      <td class="al muted trunc">${truncCell(r["Title"], 14)}</td>
      <td class="mono">${fmtMoney(r["Price"])}</td>
      <td class="mono">${fmtNum(r["Qty"])}</td>
      <td class="mono chip pos" style="background:none;padding:0">${fmtCompactMoney(r["Value"])}</td>
      <td class="muted">${r["Filing Date"].split(" ")[0]}</td>
      <td><button class="buy-btn" onclick="openBuyModal('${r["Ticker"]}', ${r["Price"]})">Buy</button></td>
    </tr>`
        )
        .join("") || `<tr><td colspan="9" class="muted" style="text-align:center;padding:24px">No matches for these filters</td></tr>`;
    setFilterStatus(`${data.length} match${data.length === 1 ? "" : "es"}`, false);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" class="muted" style="text-align:center;padding:24px">Couldn't load: ${e}</td></tr>`;
    setFilterStatus("Couldn't load insiders", true);
  }
}

function scoreClass(score) {
  if (score >= 65) return "high";
  if (score >= 40) return "mid";
  return "low";
}

async function loadRankedPicks() {
  const grid = document.getElementById("ranked-picks");
  const params = currentFilterParams();
  params.set("top_n", 6);

  let picks;
  try {
    const res = await fetch(`/api/insiders/ranked?${params}`);
    picks = await res.json();
    if (!res.ok) {
      grid.innerHTML = `<div class="muted">${picks.error || "Request failed"}</div>`;
      return;
    }
  } catch (e) {
    grid.innerHTML = `<div class="muted">Couldn't load picks: ${e}</div>`;
    return;
  }

  grid.innerHTML =
    picks
      .map((p, i) => {
        const b = p.breakdown;
        const segs = [
          ["var(--accent)", b.cluster, 25],
          ["var(--accent-2)", b.size, 25],
          ["var(--green)", b.role, 25],
          ["#f2c14e", b.conviction, 15],
          ["var(--muted)", b.recency, 10],
        ]
          .map(([color, val, max]) => `<div class="pick-bar-seg" style="flex:${max};opacity:${(val / max).toFixed(2)};background:${color}"></div>`)
          .join("");

        return `
      <div class="pick-card">
        <div class="pick-head">
          <div>
            <div class="ticker clickable" onclick="openBuyModal('${p.ticker}', ${p.avgPrice})">${p.ticker}</div>
            <div class="pick-company">${p.company}</div>
          </div>
          <div>
            <div class="pick-score ${scoreClass(p.score)}">${p.score}</div>
            <div class="pick-score-label">score</div>
          </div>
        </div>
        <div class="pick-bars">${segs}</div>
        <div class="pick-meta">
          <div>Insiders <b>${p.clusterCount}</b></div>
          <div>Buys <b>${p.buyCount}</b></div>
          <div>Total $ <b>${fmtCompactMoney(p.totalValue)}</b></div>
          <div>Avg price <b>${fmtMoney(p.avgPrice)}</b></div>
          <div>Stake &Delta; <b>${p.avgDeltaOwnPct !== null ? p.avgDeltaOwnPct + "%" : "—"}</b></div>
          <div>Role <b>${p.topRole}</b></div>
        </div>
        <div class="pick-actions">
          <button class="news-btn" onclick="toggleNews(this, '${p.ticker}')">News</button>
          <button class="buy-btn" style="flex:1" onclick="openBuyModal('${p.ticker}', ${p.avgPrice})">Buy</button>
        </div>
        <div class="news-list hidden" data-ticker="${p.ticker}"></div>
      </div>`;
      })
      .join("") || `<div class="muted">No matches to score.</div>`;
}

async function toggleNews(btn, ticker) {
  const card = btn.closest(".pick-card");
  const list = card.querySelector(".news-list");

  if (!list.classList.contains("hidden")) {
    list.classList.add("hidden");
    return;
  }
  list.classList.remove("hidden");
  if (list.dataset.loaded) return;

  list.innerHTML = `<span class="muted">Loading...</span>`;
  try {
    const res = await fetch(`/api/news/${ticker}`);
    const items = await res.json();
    list.innerHTML =
      items
        .map(
          (n) => `
      <div class="news-item">
        <a href="${n.link}" target="_blank" rel="noopener">${n.title}</a>
        <div class="news-source">${n.source} · ${new Date(n.pubDate).toLocaleDateString()}</div>
      </div>`
        )
        .join("") || `<span class="muted">No recent headlines.</span>`;
    list.dataset.loaded = "1";
  } catch (e) {
    list.innerHTML = `<span class="muted">Couldn't load news.</span>`;
  }
}

function statusClass(status) {
  if (status === "Pullback") return "rot-pullback";
  if (status === "Extended") return "rot-extended";
  if (status === "Fade") return "rot-fade";
  return "rot-consolidate";
}

function setRotationStatus(msg, isError) {
  const el = document.getElementById("rotation-status");
  el.textContent = msg;
  el.style.color = isError ? "var(--red)" : "var(--muted)";
}

async function loadRotation(forceRefresh) {
  const tbody = document.querySelector("#rotation-table tbody");
  setRotationStatus(forceRefresh ? "Refreshing..." : "Loading...", false);

  try {
    const params = forceRefresh ? new URLSearchParams({ refresh: "1" }) : new URLSearchParams();
    const res = await fetch(`/api/rotation?${params}`);
    const data = await res.json();

    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="9" class="muted" style="text-align:center;padding:24px">${data.error || "Request failed"}</td></tr>`;
      setRotationStatus(data.error || "Request failed", true);
      return;
    }

    tbody.innerHTML =
      data
        .map(
          (r) => `
    <tr class="sector-row" onclick="toggleSectorInsiders('${r["Ticker"]}')">
      <td class="al mono">${r["Rank"]}</td>
      <td class="al ticker clickable" onclick="event.stopPropagation();openBuyModal('${r["Ticker"]}', ${r["Last"]})">${r["Ticker"]}</td>
      <td class="al muted"><span class="sector-caret">&#9656;</span>${r["Sector"]}</td>
      <td class="mono">${fmtMoney(r["Last"])}</td>
      <td>${fmtPct(r["10d %"])}</td>
      <td>${fmtPct(r["% from 10d High"])}</td>
      <td class="mono">${r["RSI14"]}</td>
      <td class="mono">${r["Rel Vol (10d)"] ?? "—"}x</td>
      <td class="al"><span class="chip sig ${statusClass(r["Status"])}">${r["Status"]}</span></td>
    </tr>
    <tr class="sector-insiders hidden" data-etf="${r["Ticker"]}" data-sector="${r["Sector"]}">
      <td colspan="9"><div class="sector-insiders-box"></div></td>
    </tr>`
        )
        .join("") || `<tr><td colspan="9" class="muted" style="text-align:center;padding:24px">No data</td></tr>`;

    // the 2-minute auto-refresh rewrites tbody; restore any open dropdowns
    expandedSectors.forEach((etf) => {
      const row = tbody.querySelector(`tr.sector-insiders[data-etf="${etf}"]`);
      if (row) {
        row.classList.remove("hidden");
        row.previousElementSibling.classList.add("expanded");
        renderSectorInsiders(row);
      } else {
        expandedSectors.delete(etf);
      }
    });

    const counts = { Pullback: 0, Extended: 0, Fade: 0, Consolidate: 0 };
    data.forEach((r) => { counts[r["Status"]] = (counts[r["Status"]] || 0) + 1; });
    document.getElementById("rotation-summary").innerHTML = `
      <div class="rotation-stat"><div class="label">Pullback</div><div class="value rot-pullback-text">${counts.Pullback}</div></div>
      <div class="rotation-stat"><div class="label">Extended</div><div class="value rot-extended-text">${counts.Extended}</div></div>
      <div class="rotation-stat"><div class="label">Fade</div><div class="value rot-fade-text">${counts.Fade}</div></div>
      <div class="rotation-stat"><div class="label">Consolidate</div><div class="value">${counts.Consolidate}</div></div>
    `;

    setRotationStatus(`Updated ${new Date().toLocaleTimeString()}`, false);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" class="muted" style="text-align:center;padding:24px">Couldn't load: ${e}</td></tr>`;
    setRotationStatus("Couldn't load rotation tracker", true);
  }
}

document.getElementById("r-refresh").addEventListener("click", () => loadRotation(true));

const sectorInsidersCache = new Map(); // etf -> /api/rotation/insiders payload
const expandedSectors = new Set();

async function toggleSectorInsiders(etf) {
  const row = document.querySelector(`#rotation-table tr.sector-insiders[data-etf="${etf}"]`);
  if (!row) return;
  if (!row.classList.contains("hidden")) {
    row.classList.add("hidden");
    row.previousElementSibling.classList.remove("expanded");
    expandedSectors.delete(etf);
    return;
  }
  row.classList.remove("hidden");
  row.previousElementSibling.classList.add("expanded");
  expandedSectors.add(etf);
  await renderSectorInsiders(row);
}

async function renderSectorInsiders(row) {
  const etf = row.dataset.etf;
  const box = row.querySelector(".sector-insiders-box");
  let data = sectorInsidersCache.get(etf);
  if (!data) {
    box.innerHTML = `<span class="muted">Loading last 24h insider buys...</span>`;
    try {
      const res = await fetch(`/api/rotation/insiders?etf=${etf}`);
      data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      sectorInsidersCache.set(etf, data);
    } catch (e) {
      const raw = e.message || String(e);
      // connection-failure messages are multi-line urllib3 dumps; don't wallpaper the table with them
      const msg = raw.length > 90 ? "openinsider.com isn't responding right now — try again in a bit." : raw;
      box.innerHTML = `<span class="muted">Couldn't load insider buys: ${msg}</span>`;
      return;
    }
  }

  const sector = row.dataset.sector;
  const label = data.marketWide
    ? `Last 24h insider buys &mdash; market-wide (${sector} is broad beta)`
    : `Last 24h insider buys in ${sector}`;
  if (!data.buys.length) {
    box.innerHTML = `
      <div class="sector-insiders-head">${label} <span class="muted">&middot; via openinsider.com</span></div>
      <span class="muted">No insider buys filed in the last 24 hours.</span>`;
    return;
  }
  box.innerHTML = `
    <div class="sector-insiders-head">${label} <span class="muted">&middot; via openinsider.com</span></div>
    <table class="mini-table">
      <thead><tr>
        <th class="al">Ticker</th><th class="al">Company</th><th class="al">Insider</th><th class="al">Title</th>
        <th>Price</th><th>Qty</th><th>Value</th><th class="al">Filed</th><th></th>
      </tr></thead>
      <tbody>
        ${data.buys
          .map(
            (b) => `
        <tr>
          <td class="al ticker clickable" onclick="openBuyModal('${b.ticker}', ${b.price})">${b.ticker}</td>
          <td class="al trunc">${truncCell(b.company || "", 22)}</td>
          <td class="al trunc">${truncCell(b.insider || "", 16)}</td>
          <td class="al muted trunc">${truncCell(b.title || "", 14)}</td>
          <td class="mono">${fmtMoney(b.price)}</td>
          <td class="mono">${fmtNum(b.qty)}</td>
          <td class="mono chip pos" style="background:none;padding:0">${fmtCompactMoney(b.value)}</td>
          <td class="al muted">${(b.filingDate || "").split(" ")[0]}</td>
          <td><button class="buy-btn" onclick="openBuyModal('${b.ticker}', ${b.price})">Buy</button></td>
        </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

function partyClass(partyShort) {
  if (partyShort === "D") return "party-d";
  if (partyShort === "R") return "party-r";
  if (partyShort === "I") return "party-i";
  return "party-unknown";
}

function setPoliticiansStatus(msg, isError) {
  const el = document.getElementById("politicians-status");
  el.textContent = msg;
  el.style.color = isError ? "var(--red)" : "var(--muted)";
}

async function loadPoliticians(forceRefresh) {
  const tbody = document.querySelector("#politicians-table tbody");
  setPoliticiansStatus(forceRefresh ? "Refreshing..." : "Loading...", false);

  try {
    const params = new URLSearchParams({
      ticker: document.getElementById("p-ticker").value.trim(),
      chamber: document.getElementById("p-chamber").value,
      party: document.getElementById("p-party").value,
    });
    if (forceRefresh) params.set("refresh", "1");
    const res = await fetch(`/api/politicians?${params}`);
    const data = await res.json();

    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="10" class="muted" style="text-align:center;padding:24px">${data.error || "Request failed"}</td></tr>`;
      document.getElementById("politicians-summary").innerHTML = "";
      setPoliticiansStatus(data.error || "Request failed", true);
      return;
    }

    tbody.innerHTML =
      data
        .map(
          (r) => `
    <tr>
      <td class="al">${truncCell(r["Name"], 20)}</td>
      <td class="al"><span class="chip sig ${partyClass(r["PartyShort"])}">${r["Party"]}</span></td>
      <td class="al muted">${r["Chamber"]}</td>
      <td class="al ticker">${r["Ticker"] || "&mdash;"}</td>
      <td class="al trunc">${truncCell(r["Company"], 30)}</td>
      <td class="al muted">${r["Type"] || ""}</td>
      <td class="al mono">${r["Amount"]}</td>
      <td class="mono">${r["TxnDate"] || "—"}</td>
      <td class="mono">${r["FiledDate"] || "—"}</td>
      <td class="mono">${r["LagDays"] ?? "—"}</td>
    </tr>`
        )
        .join("") || `<tr><td colspan="10" class="muted" style="text-align:center;padding:24px">No matches for these filters</td></tr>`;

    const dem = data.filter((r) => r["PartyShort"] === "D").length;
    const rep = data.filter((r) => r["PartyShort"] === "R").length;
    document.getElementById("politicians-summary").innerHTML = `
      <div class="rotation-stat"><div class="label">Trades shown</div><div class="value">${data.length}</div><div class="sub">most recently filed first</div></div>
      <div class="rotation-stat"><div class="label">Democrat</div><div class="value party-d-text">${dem}</div></div>
      <div class="rotation-stat"><div class="label">Republican</div><div class="value party-r-text">${rep}</div></div>
    `;

    setPoliticiansStatus(`Updated ${new Date().toLocaleTimeString()}`, false);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="10" class="muted" style="text-align:center;padding:24px">Couldn't load: ${e}</td></tr>`;
    setPoliticiansStatus("Couldn't load politicians tracker", true);
  }
}

document.getElementById("p-apply").addEventListener("click", () => loadPoliticians(false));
document.getElementById("p-refresh").addEventListener("click", () => loadPoliticians(true));

function openBuyModal(symbol, price) {
  document.getElementById("buy-symbol").value = symbol;
  document.getElementById("buy-qty").value = 1;
  document.getElementById("buy-result").textContent = "";
  updateEstimate(price);
  document.getElementById("buy-modal").classList.remove("hidden");
}

function closeBuyModal() {
  document.getElementById("buy-modal").classList.add("hidden");
}

function describeOrderOutcome(data) {
  if (data.orderStatus === "REJECTED") {
    return `Rejected: ${data.statusDescription || "Schwab did not accept this order."}`;
  }
  if (!data.orderStatus) {
    return `Submitted (status unknown — check your Schwab account to confirm).`;
  }
  if (data.orderStatus === "FILLED") return `Filled.`;
  return `Submitted — currently ${data.orderStatus.replaceAll("_", " ").toLowerCase()}.`;
}

function updateEstimate(price) {
  const qty = Number(document.getElementById("buy-qty").value || 0);
  const est = document.getElementById("buy-estimate");
  est.textContent = price ? `Est. cost ~ ${fmtMoney(price * qty)} at ${fmtMoney(price)}/share` : "";
}

let protectContext = { symbol: null, qty: null, accountHash: null };

function accountHashFor(accountNumber) {
  const match = accountHashes.find((a) => a.accountNumber === accountNumber);
  return match ? match.hashValue : null;
}

async function openProtectModal(symbol, qty, price, accountNumber) {
  protectContext = { symbol, qty, accountHash: accountHashFor(accountNumber) };
  document.getElementById("protect-qty-label").textContent = `${qty} share${qty === 1 ? "" : "s"} of ${symbol}`;
  document.getElementById("protect-max-loss").value = "";
  document.getElementById("protect-sell-target").value = "";
  document.getElementById("protect-result").textContent = "";
  document.getElementById("protect-active").innerHTML = "";
  document.getElementById("protect-modal").classList.remove("hidden");
  loadActiveProtection();
}

function closeProtectModal() {
  document.getElementById("protect-modal").classList.add("hidden");
}

async function loadActiveProtection() {
  const box = document.getElementById("protect-active");
  if (!protectContext.accountHash) return;
  try {
    const res = await fetch(`/api/orders/protective?accountHash=${protectContext.accountHash}`);
    const orders = await res.json();
    if (!res.ok) return;
    const mine = orders.filter((o) => o.symbol === protectContext.symbol);
    if (!mine.length) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML =
      `<div class="muted" style="margin:10px 0 6px">Currently active</div>` +
      mine
        .map((o) => {
          const label = o.kind === "maxLoss" ? "Maximum loss" : "Sell target";
          return `<div class="protect-active-row">
            <span>${label} @ ${fmtMoney(o.price)} &middot; ${o.qty} sh</span>
            <button class="btn-secondary" style="padding:4px 10px;font-size:11px" onclick="cancelProtectiveOrder(${o.orderId})">Cancel</button>
          </div>`;
        })
        .join("");
  } catch (e) {
    // non-fatal, active-protection list is best-effort
  }
}

async function cancelProtectiveOrder(orderId) {
  if (!confirm("Cancel this protective order?")) return;
  try {
    await fetch(`/api/orders/${orderId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountHash: protectContext.accountHash }),
    });
    loadActiveProtection();
  } catch (e) {
    alert("Couldn't cancel: " + e);
  }
}

document.getElementById("protect-cancel").addEventListener("click", closeProtectModal);
document.getElementById("protect-close").addEventListener("click", closeProtectModal);
document.getElementById("protect-modal").addEventListener("click", (e) => {
  if (e.target.id === "protect-modal") closeProtectModal();
});

document.getElementById("protect-confirm").addEventListener("click", async () => {
  const maxLossPrice = document.getElementById("protect-max-loss").value.trim();
  const sellTargetPrice = document.getElementById("protect-sell-target").value.trim();
  const resultEl = document.getElementById("protect-result");

  if (!maxLossPrice && !sellTargetPrice) {
    resultEl.textContent = "Enter at least one price.";
    return;
  }
  if (!protectContext.accountHash) {
    resultEl.textContent = "Couldn't find the account for this position.";
    return;
  }

  const parts = [];
  if (maxLossPrice) parts.push(`sell if it drops to $${maxLossPrice}`);
  if (sellTargetPrice) parts.push(`sell if it rises to $${sellTargetPrice}`);
  if (!confirm(`Set protection on ${protectContext.qty} share(s) of ${protectContext.symbol}: ${parts.join(" and ")}?`)) return;

  resultEl.textContent = "Setting protection...";
  try {
    const res = await fetch("/api/orders/protect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountHash: protectContext.accountHash,
        symbol: protectContext.symbol,
        qty: protectContext.qty,
        maxLossPrice: maxLossPrice || null,
        sellTargetPrice: sellTargetPrice || null,
      }),
    });
    const data = await res.json();
    resultEl.textContent = res.ok ? describeOrderOutcome(data) : `Failed: ${data.error || JSON.stringify(data)}`;
    resultEl.style.color = res.ok && data.orderStatus === "REJECTED" ? "var(--red)" : "var(--muted)";
    if (res.ok && data.orderStatus !== "REJECTED") {
      document.getElementById("protect-max-loss").value = "";
      document.getElementById("protect-sell-target").value = "";
      loadActiveProtection();
    }
  } catch (e) {
    resultEl.textContent = "Error: " + e;
  }
});

const FILTER_STORAGE_KEY = "dashboard-insider-filters";

function saveFilters() {
  localStorage.setItem(
    FILTER_STORAGE_KEY,
    JSON.stringify({
      maxPrice: document.getElementById("f-max-price").value,
      minQty: document.getElementById("f-min-qty").value,
      titles: document.getElementById("f-titles").value,
    })
  );
}

function restoreFilters() {
  const saved = localStorage.getItem(FILTER_STORAGE_KEY);
  if (!saved) return;
  try {
    const { maxPrice, minQty, titles } = JSON.parse(saved);
    document.getElementById("f-max-price").value = maxPrice ?? "";
    document.getElementById("f-min-qty").value = minQty ?? "";
    document.getElementById("f-titles").value = titles ?? "";
  } catch (e) {
    // ignore corrupt storage, fall back to whatever's in the HTML
  }
}

document.getElementById("f-apply").addEventListener("click", () => {
  saveFilters();
  loadInsiders();
  loadRankedPicks();
});
document.getElementById("f-clear").addEventListener("click", () => {
  document.getElementById("f-max-price").value = "";
  document.getElementById("f-min-qty").value = "";
  document.getElementById("f-titles").value = "";
  saveFilters();
  loadInsiders();
  loadRankedPicks();
});
document.getElementById("buy-cancel").addEventListener("click", closeBuyModal);
document.getElementById("buy-close").addEventListener("click", closeBuyModal);
document.getElementById("buy-modal").addEventListener("click", (e) => {
  if (e.target.id === "buy-modal") closeBuyModal();
});

document.getElementById("buy-confirm").addEventListener("click", async () => {
  const symbol = document.getElementById("buy-symbol").value.trim().toUpperCase();
  const qty = Number(document.getElementById("buy-qty").value);
  const accountHash = document.getElementById("buy-account").value;

  if (!symbol || qty < 1) return;
  if (!confirm(`Place a MARKET BUY order for ${qty} share(s) of ${symbol}?`)) return;

  const resultEl = document.getElementById("buy-result");
  resultEl.textContent = "Placing order...";

  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, qty, accountHash }),
    });
    const data = await res.json();
    resultEl.textContent = res.ok ? describeOrderOutcome(data) : `Failed: ${JSON.stringify(data)}`;
    resultEl.style.color = res.ok && data.orderStatus === "REJECTED" ? "var(--red)" : "var(--muted)";
    loadPortfolio();
  } catch (e) {
    resultEl.textContent = "Error: " + e;
  }
});

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const debateHistories = {}; // ticker -> array of {role, text}
const debatedTickers = new Set(); // tickers that already have a cached debate today
let debateBusy = false;
let fight = null;

const MIN_FIGHT_MS = 9500; // user asked for a ~10 second bout
const POW_WORDS = ["POW!", "BAM!", "BOOM!", "WHAM!", "SOCK!", "JAB!"];

function debateRoleLabel(role) {
  return { user: "You", bull: "Bull analyst", bear: "Bear analyst", pm: "PM verdict", error: "Error" }[role] || role;
}

function renderDebateChat() {
  const ticker = document.getElementById("d-ticker").value.trim().toUpperCase();
  const chat = document.getElementById("debate-chat");
  const history = debateHistories[ticker] || [];
  chat.innerHTML = history
    .map(
      (m) => `
    <div class="debate-msg ${m.role}">
      <span class="debate-role">${debateRoleLabel(m.role)}</span>${escapeHtml(m.text)}
    </div>`
    )
    .join("");
  chat.scrollTop = chat.scrollHeight;
}

function setDebateStatus(msg, isError) {
  const el = document.getElementById("debate-status");
  el.textContent = msg;
  el.style.color = isError ? "var(--red)" : "var(--muted)";
}

// ---- retro fight engine ----

function startFight(ticker) {
  if (fight) clearInterval(fight.timer);
  const arena = document.getElementById("fight-arena");
  arena.classList.remove("hidden");
  arena.innerHTML = `
    <div class="fight-hud">
      <div class="fighter-hud"><div class="fighter-name">BEAR</div><div class="hp-bar"><div class="hp-fill" id="hp-bear"></div></div></div>
      <div class="fight-vs">${escapeHtml(ticker)}</div>
      <div class="fighter-hud right"><div class="fighter-name">BULL</div><div class="hp-bar"><div class="hp-fill" id="hp-bull"></div></div></div>
    </div>
    <div class="fighter bear" id="fighter-bear">🐻<span class="glove">🥊</span></div>
    <div class="fighter bull" id="fighter-bull">🐂<span class="glove">🥊</span></div>
    <div class="ref" id="fight-ref">🧑‍⚖️</div>
    <div class="fight-banner" id="fight-banner">FIGHT!</div>`;
  fight = { hp: { bull: 100, bear: 100 }, over: false, startedAt: Date.now(), timer: null };
  setTimeout(() => {
    const banner = document.getElementById("fight-banner");
    if (banner && fight && !fight.over) banner.classList.add("hidden");
  }, 900);
  fight.timer = setInterval(fightExchange, 750);
}

function updateHp() {
  const bullEl = document.getElementById("hp-bull");
  const bearEl = document.getElementById("hp-bear");
  if (bullEl) bullEl.style.width = `${fight.hp.bull}%`;
  if (bearEl) bearEl.style.width = `${fight.hp.bear}%`;
}

function spawnPow(defender, big) {
  const arena = document.getElementById("fight-arena");
  const pow = document.createElement("div");
  pow.className = big ? "pow big" : "pow";
  pow.textContent = big ? "K.O.!" : POW_WORDS[Math.floor(Math.random() * POW_WORDS.length)];
  const base = defender === "bear" ? 16 : 56; // % from left, near whoever got hit
  pow.style.left = `${base + Math.random() * 10}%`;
  pow.style.top = `${58 + Math.random() * 45}px`;
  arena.appendChild(pow);
  setTimeout(() => pow.remove(), 600);
}

function applyBruises(el, hp) {
  el.style.filter = `drop-shadow(0 0 ${((100 - hp) / 12).toFixed(1)}px rgba(242, 89, 107, 0.9))`;
  if (hp < 55 && !el.querySelector(".bandage")) {
    el.insertAdjacentHTML("beforeend", '<span class="bandage">🩹</span>');
  }
}

function fightExchange() {
  if (!fight || fight.over) return;
  const attacker = Math.random() < 0.5 ? "bull" : "bear";
  const defender = attacker === "bull" ? "bear" : "bull";
  const atkEl = document.getElementById(`fighter-${attacker}`);
  const defEl = document.getElementById(`fighter-${defender}`);
  if (!atkEl || !defEl) return;

  atkEl.classList.add("lunge");
  setTimeout(() => {
    if (!fight) return;
    defEl.classList.add("hit");
    spawnPow(defender);
    // keep both fighters standing until the real verdict lands
    fight.hp[defender] = Math.max(24, fight.hp[defender] - (5 + Math.random() * 11));
    updateHp();
    applyBruises(defEl, fight.hp[defender]);
    setTimeout(() => {
      atkEl.classList.remove("lunge");
      defEl.classList.remove("hit");
    }, 230);
  }, 150);
}

function finishFight(winnerSide) {
  if (!fight || fight.over) return;
  fight.over = true;
  clearInterval(fight.timer);
  const banner = document.getElementById("fight-banner");
  if (!banner) return;

  if (winnerSide !== "BULL" && winnerSide !== "BEAR") {
    banner.textContent = "DRAW";
    banner.classList.remove("hidden");
    banner.classList.add("draw");
    return;
  }

  const w = winnerSide.toLowerCase();
  const l = w === "bull" ? "bear" : "bull";
  fight.hp[l] = 0;
  updateHp();
  spawnPow(l, true);
  const loserEl = document.getElementById(`fighter-${l}`);
  const winnerEl = document.getElementById(`fighter-${w}`);
  loserEl.classList.add("ko");
  winnerEl.classList.add("champ");
  setTimeout(() => {
    winnerEl.insertAdjacentHTML("beforeend", '<span class="raised-hand">✋</span>');
    document.getElementById("fight-ref").classList.add(w === "bull" ? "at-bull" : "at-bear");
    banner.innerHTML = `WINNER!<span class="banner-sub">${w.toUpperCase()} TAKES IT</span>`;
    banner.classList.remove("hidden");
    banner.classList.add("gold");
  }, 750);
}

function abortFight() {
  if (fight) {
    clearInterval(fight.timer);
    fight = null;
  }
  const arena = document.getElementById("fight-arena");
  arena.classList.add("hidden");
  arena.innerHTML = "";
}

async function askDebate(forceRefresh) {
  if (debateBusy) return;
  const tickerEl = document.getElementById("d-ticker");
  const ticker = tickerEl.value.trim().toUpperCase();
  const questionEl = document.getElementById("d-question");
  const question = forceRefresh
    ? (questionEl.value.trim() || "What's your current read on this ticker right now?")
    : questionEl.value.trim();

  if (!ticker) {
    setDebateStatus("Enter a ticker first.", true);
    return;
  }
  if (!question) {
    setDebateStatus("Ask a question first.", true);
    return;
  }

  tickerEl.value = ticker;
  debateHistories[ticker] = debateHistories[ticker] || [];
  debateHistories[ticker].push({ role: "user", text: question });
  renderDebateChat();
  questionEl.value = "";

  debateBusy = true;
  document.getElementById("d-ask").disabled = true;

  const expectFight = forceRefresh || !debatedTickers.has(ticker);
  if (expectFight) {
    startFight(ticker);
    setDebateStatus("Live debate underway...", false);
  } else {
    setDebateStatus("Thinking...", false);
  }

  try {
    const res = await fetch("/api/debate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, question, forceRefresh }),
    });
    const data = await res.json();

    if (!res.ok) {
      abortFight();
      debateHistories[ticker].push({ role: "error", text: data.error || "Request failed" });
      renderDebateChat();
      setDebateStatus(data.error || "Request failed", true);
    } else {
      debatedTickers.add(ticker);
      const pushResults = () => {
        if (data.freshDebate) {
          debateHistories[ticker].push({ role: "bull", text: data.bull });
          debateHistories[ticker].push({ role: "bear", text: data.bear });
          debateHistories[ticker].push({ role: "pm", text: data.pmVerdict });
        } else {
          debateHistories[ticker].push({ role: "pm", text: data.answer });
        }
        renderDebateChat();
        setDebateStatus(data.freshDebate ? "Full debate below." : "Answered from today's cached debate.", false);
      };

      if (fight && !fight.over && data.freshDebate) {
        // let the bout run its ~10 seconds before the verdict lands
        const delay = Math.max(0, MIN_FIGHT_MS - (Date.now() - fight.startedAt));
        setTimeout(() => finishFight(data.winner || "DRAW"), delay);
        setTimeout(pushResults, delay + 2300);
      } else if (fight && !fight.over) {
        finishFight(data.winner || "DRAW");
        setTimeout(pushResults, 1800);
      } else {
        pushResults();
      }
    }
  } catch (e) {
    abortFight();
    debateHistories[ticker].push({ role: "error", text: String(e) });
    renderDebateChat();
    setDebateStatus("Couldn't reach the dashboard server.", true);
  } finally {
    debateBusy = false;
    document.getElementById("d-ask").disabled = false;
  }
}

document.getElementById("chat-fab").addEventListener("click", () => {
  document.getElementById("chat-widget").classList.remove("hidden");
  document.getElementById("chat-fab").classList.add("hidden");
  document.getElementById("d-ticker").focus();
});
document.getElementById("chat-close").addEventListener("click", () => {
  document.getElementById("chat-widget").classList.add("hidden");
  document.getElementById("chat-fab").classList.remove("hidden");
});
document.getElementById("d-ask").addEventListener("click", () => askDebate(false));
document.getElementById("d-question").addEventListener("keydown", (e) => {
  if (e.key === "Enter") askDebate(false);
});
document.getElementById("d-new-debate").addEventListener("click", () => askDebate(true));
document.getElementById("d-ticker").addEventListener("change", () => {
  document.getElementById("d-ticker").value = document.getElementById("d-ticker").value.trim().toUpperCase();
  renderDebateChat();
});

const fmtBigMoney = (v) => {
  if (v === null || v === undefined) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return fmtMoney(v);
};

const fmtShares = (v) => {
  if (v === null || v === undefined) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
};

function setTop20Status(msg, isError) {
  const el = document.getElementById("top20-status");
  el.textContent = msg;
  el.style.color = isError ? "var(--red)" : "var(--muted)";
}

const top20ErrRow = (cols, err) =>
  `<tr><td colspan="${cols}" class="muted" style="text-align:center;padding:24px">${err}</td></tr>`;

async function loadTop20() {
  const gBody = document.querySelector("#gainers-table tbody");
  const mBody = document.querySelector("#megacaps-table tbody");
  setTop20Status("Loading...", false);

  try {
    const res = await fetch("/api/top20");
    const data = await res.json();

    if (data.gainers) {
      gBody.innerHTML =
        data.gainers
          .map(
            (g, i) => `
      <tr>
        <td class="al mono">${i + 1}</td>
        <td class="al ticker clickable" onclick="openBuyModal('${g.symbol}', ${g.last ?? "null"})">${g.symbol}</td>
        <td class="al trunc">${truncCell(g.name, 26)}</td>
        <td class="mono">${fmtMoney(g.last)}</td>
        <td>${fmtPct(g.changePct)}</td>
        <td class="mono">${fmtShares(g.volume)}</td>
        <td class="mono">${fmtBigMoney(g.marketCap)}</td>
        <td><button class="buy-btn" onclick="openBuyModal('${g.symbol}', ${g.last ?? "null"})">Buy</button></td>
      </tr>`
          )
          .join("") || top20ErrRow(8, "No gainers returned");
    } else {
      gBody.innerHTML = top20ErrRow(8, data.gainersError || "Couldn't load gainers");
    }

    if (data.megaCaps) {
      mBody.innerHTML =
        data.megaCaps
          .map(
            (m) => `
      <tr>
        <td class="al mono">${m.rank}</td>
        <td class="al ticker clickable" onclick="openBuyModal('${m.symbol}', ${m.last ?? "null"})">${m.symbol}</td>
        <td class="al trunc">${truncCell(m.name, 26)}</td>
        <td class="mono">${fmtMoney(m.last)}</td>
        <td class="al">${sparklineSvg(m.sparkline)}</td>
        <td>${fmtPct(m.change1D)}</td>
        <td>${fmtPct(m.change5D)}</td>
        <td>${fmtPct(m.change1M)}</td>
        <td><button class="buy-btn" onclick="openBuyModal('${m.symbol}', ${m.last ?? "null"})">Buy</button></td>
      </tr>`
          )
          .join("") || top20ErrRow(9, "No data")
    } else {
      mBody.innerHTML = top20ErrRow(9, data.megaCapsError || "Couldn't load mega caps");
    }

    const anyError = data.gainersError || data.megaCapsError;
    setTop20Status(anyError ? "Partially loaded" : `Updated ${new Date().toLocaleTimeString()}`, !!anyError);
  } catch (e) {
    gBody.innerHTML = top20ErrRow(8, `Couldn't load: ${e}`);
    mBody.innerHTML = top20ErrRow(9, `Couldn't load: ${e}`);
    setTop20Status("Couldn't load Top 20", true);
  }
}

document.getElementById("t20-refresh").addEventListener("click", loadTop20);

const TAB_STORAGE_KEY = "dashboard-active-tab";

function switchTab(name) {
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${name}`));
  localStorage.setItem(TAB_STORAGE_KEY, name);
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

const savedTab = localStorage.getItem(TAB_STORAGE_KEY);
switchTab(document.querySelector(`.tab-btn[data-tab="${savedTab}"]`) ? savedTab : "insiders");

restoreFilters();
loadAccountHashes();
loadPortfolio();
loadInsiders();
loadRankedPicks();
loadRotation(false);
loadPoliticians(false);
loadTop20();
setInterval(loadPortfolio, 15000);
setInterval(loadTop20, 120000);
setInterval(loadInsiders, 120000);
setInterval(loadRankedPicks, 120000);
setInterval(() => loadRotation(false), 120000);
setInterval(() => loadPoliticians(false), 120000);
