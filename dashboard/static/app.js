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
    <tr>
      <td class="al mono">${r["Rank"]}</td>
      <td class="al ticker clickable" onclick="openBuyModal('${r["Ticker"]}', ${r["Last"]})">${r["Ticker"]}</td>
      <td class="al muted">${r["Sector"]}</td>
      <td class="mono">${fmtMoney(r["Last"])}</td>
      <td>${fmtPct(r["10d %"])}</td>
      <td>${fmtPct(r["% from 10d High"])}</td>
      <td class="mono">${r["RSI14"]}</td>
      <td class="mono">${r["Rel Vol (10d)"] ?? "—"}x</td>
      <td class="al"><span class="chip sig ${statusClass(r["Status"])}">${r["Status"]}</span></td>
    </tr>`
        )
        .join("") || `<tr><td colspan="9" class="muted" style="text-align:center;padding:24px">No data</td></tr>`;

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

const TAB_STORAGE_KEY = "dashboard-active-tab";

function switchTab(name) {
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${name}`));
  localStorage.setItem(TAB_STORAGE_KEY, name);
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

switchTab(localStorage.getItem(TAB_STORAGE_KEY) || "insiders");

restoreFilters();
loadAccountHashes();
loadPortfolio();
loadInsiders();
loadRankedPicks();
loadRotation(false);
loadPoliticians(false);
setInterval(loadPortfolio, 15000);
setInterval(loadInsiders, 120000);
setInterval(loadRankedPicks, 120000);
setInterval(() => loadRotation(false), 120000);
setInterval(() => loadPoliticians(false), 120000);
