/* Anchor Protocol
   Change the treasury address in config.json (treasuryWallet).
   That single string drives live balance + the 50/20/30 split. */

const ADMIN_PASSWORD = "atunatun";
const STORAGE_KEY = "anchor_protocol_state_v2";
const VOTE_KEY = "anchor_protocol_voted_round";

const RULES = {
  minSol: 15,
  winnerPct: 50,
  buybackPct: 20,
  reservePct: 30,
};

const DEFAULT_STATE = {
  treasuryWallet: "",
  officialCa: "",
  narrative: "",
  roundId: 1,
  votingOpen: false,
  voteStartedAt: 0,
  voteEndedAt: 0,
  overrideThreshold: false,
  suggestions: [],
  tokens: [
    { id: "a", ticker: "", name: "", ca: "", pumpUrl: "", image: "", votes: 0 },
    { id: "b", ticker: "", name: "", ca: "", pumpUrl: "", image: "", votes: 0 },
  ],
};

let remoteConfig = null;
let lastSol = 0;
let lastLive = false;
let tickerTimer = null;

async function loadRemoteConfig() {
  try {
    const res = await fetch("config.json", { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function loadState() {
  const base = remoteConfig
    ? { ...structuredClone(DEFAULT_STATE), ...remoteConfig }
    : structuredClone(DEFAULT_STATE);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const local = JSON.parse(raw);
    return { ...base, ...local };
  } catch {
    return base;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function $(sel, root = document) {
  return root.querySelector(sel);
}
function $all(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

function cleanWallet(addr) {
  return String(addr || "").replace(/\s+/g, "").trim();
}

function isRealWallet(addr) {
  const a = cleanWallet(addr);
  if (a.length < 32 || a.length > 48) return false;
  if (/replace|example|yourwallet|paste/i.test(a)) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(a);
}

function shortAddr(a) {
  if (!a || a.length < 12) return a || "—";
  return a.slice(0, 4) + "…" + a.slice(-4);
}

function toast(msg) {
  const el = $("#toast");
  if (!el) return alert(msg);
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => (el.style.display = "none"), 2200);
}

function fmtSol(n) {
  return (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 }) + " SOL";
}

const RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://rpc.ankr.com/solana",
];

async function fetchSolBalance(address) {
  const pubkey = cleanWallet(address);
  if (!isRealWallet(pubkey)) return { sol: 0, live: false };
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "getBalance",
    params: [pubkey],
  };
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.error) continue;
      const lamports = json?.result?.value;
      if (typeof lamports !== "number") continue;
      return { sol: lamports / 1e9, live: true };
    } catch {
      continue;
    }
  }
  return { sol: 0, live: false, error: true };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function placeholderLogo(ticker) {
  const letter = (ticker || "?").slice(0, 1).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="176" height="176"><circle cx="88" cy="88" r="88" fill="#123044"/><text x="50%" y="55%" text-anchor="middle" font-family="Arial" font-size="72" fill="#d7eef6">${letter}</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function thresholdMet(sol) {
  return sol >= RULES.minSol;
}

function voteOpenNow(state, sol = lastSol) {
  if (!state.votingOpen) return false;
  if (state.overrideThreshold) return true;
  return thresholdMet(sol);
}

function alreadyVoted(roundId) {
  return localStorage.getItem(VOTE_KEY) === String(roundId);
}

function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

async function renderPublic() {
  const state = loadState();
  const bal = await fetchSolBalance(state.treasuryWallet);
  lastSol = bal.sol;
  lastLive = bal.live;
  const open = voteOpenNow(state, bal.sol);
  renderRoundMeta(state, bal.sol, open);
  renderTimer(state, open);
  renderArena(state, open);
  renderTreasury(state, bal);
  bindVoteButtons();
  bindSuggestForm();
  renderSuggestions(state);
  renderOfficialCa(state);

  const menuBtn = $("#menu-btn");
  const mobile = $("#mobile-menu");
  if (menuBtn && mobile) menuBtn.onclick = () => mobile.classList.toggle("open");

  if (tickerTimer) clearInterval(tickerTimer);
  tickerTimer = setInterval(() => {
    const s = loadState();
    const openNow = voteOpenNow(s, lastSol);
    renderRoundMeta(s, lastSol, openNow);
    renderTimer(s, openNow);
  }, 1000);
}

function renderRoundMeta(state, sol, open) {
  const box = $("#round-meta");
  if (!box) return;
  const pills = [];
  pills.push(`<span class="pill">Round #${state.roundId || 1}</span>`);
  if (open) {
    pills.push(`<span class="pill ok">Voting live</span>`);
    if (state.overrideThreshold && !thresholdMet(sol)) {
      pills.push(`<span class="pill wait">Started under 15 SOL</span>`);
    }
  } else if (state.voteEndedAt) {
    pills.push(`<span class="pill">Vote closed</span>`);
  } else if (!isRealWallet(state.treasuryWallet)) {
    pills.push(`<span class="pill wait">Treasury wallet pending</span>`);
  } else if (!thresholdMet(sol)) {
    pills.push(`<span class="pill lock">Need ${RULES.minSol} SOL unless overridden</span>`);
  } else {
    pills.push(`<span class="pill wait">Waiting to start</span>`);
  }
  box.innerHTML = pills.join("");

  const nar = $("#narrative-text");
  if (nar) nar.textContent = state.narrative || "";
}

function renderTimer(state, open) {
  const row = $("#timer-row");
  if (!row) return;
  if (!state.voteStartedAt) {
    row.innerHTML = "";
    return;
  }
  const end = open ? Date.now() : (state.voteEndedAt || Date.now());
  const elapsed = Math.max(0, end - state.voteStartedAt);
  row.innerHTML = `
    <article class="card timer-card">
      <div class="k" style="font-size:0.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600">${open ? "Vote live for" : "Last vote lasted"}</div>
      <div class="clock">${clock(elapsed)}</div>
    </article>`;
}

function renderArena(state, open) {
  const arena = $("#vote-arena");
  if (!arena) return;
  const tokens = state.tokens && state.tokens.length === 2
    ? state.tokens
    : DEFAULT_STATE.tokens;
  const [a, b] = tokens;
  const total = (a.votes || 0) + (b.votes || 0);
  const pa = total ? Math.round((a.votes / total) * 100) : 50;
  const pb = 100 - pa;
  const voted = alreadyVoted(state.roundId);
  const canVote = open && !voted;
  arena.innerHTML =
    tokenCard(a, pa, canVote, voted) +
    `<div class="vs">VS</div>` +
    tokenCard(b, pb, canVote, voted);
}

function tokenCard(t, pct, canVote, voted) {
  const label = voted ? "Voted" : canVote ? "Vote" : "Vote";
  const disabled = canVote ? "" : "disabled";
  return `
    <article class="card token-card">
      <img class="token-logo" alt="" src="${t.image || placeholderLogo(t.ticker)}">
      <div class="ticker">$${escapeHtml(t.ticker || "TOKEN")}</div>
      <div class="token-name">${escapeHtml(t.name || "Waiting for listing")}</div>
      <div class="ca">${t.ca ? escapeHtml(shortAddr(t.ca)) : "CA pending"}</div>
      <div class="votes-num">${t.votes || 0}</div>
      <div class="votes-label">votes</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <button class="btn btn-primary" data-vote="${t.id}" ${disabled}>${label}</button>
      ${t.pumpUrl ? `<p style="margin-top:10px"><a href="${escapeAttr(t.pumpUrl)}" target="_blank" rel="noopener">Pump</a></p>` : ""}
    </article>`;
}

function bindVoteButtons() {
  $all("[data-vote]").forEach((btn) => {
    btn.addEventListener("click", () => castVote(btn.dataset.vote));
  });
}

function bindSuggestForm() {
  const form = $("#suggest-form");
  if (!form || form.dataset.bound === "1") return;
  form.dataset.bound = "1";
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const a = ($("#suggest-a")?.value || "").trim().replace(/^\$/, "");
    const b = ($("#suggest-b")?.value || "").trim().replace(/^\$/, "");
    if (!a || !b) return toast("Enter both tickers.");
    const state = loadState();
    state.suggestions = state.suggestions || [];
    state.suggestions.unshift({
      a: a.toUpperCase(),
      b: b.toUpperCase(),
      at: Date.now(),
    });
    state.suggestions = state.suggestions.slice(0, 20);
    saveState(state);
    $("#suggest-a").value = "";
    $("#suggest-b").value = "";
    renderSuggestions(state);
    toast("Suggestion saved.");
  });
}

function renderSuggestions(state) {
  const list = $("#suggest-list");
  const adminList = $("#admin-suggest-list");
  const items = state.suggestions || [];
  const html = items.length
    ? items
        .map(
          (s) =>
            `<div class="pill" style="margin:0 8px 8px 0">$${escapeHtml(s.a)} vs $${escapeHtml(s.b)}</div>`
        )
        .join("")
    : `<p style="color:var(--muted);font-size:0.9rem">No suggestions yet.</p>`;
  if (list) list.innerHTML = html;
  if (adminList) adminList.innerHTML = html;
}

function castVote(side) {
  const state = loadState();
  if (!voteOpenNow(state, lastSol)) return toast("Voting is not live. Treasury needs 15 SOL unless override is on.");
  if (alreadyVoted(state.roundId)) return toast("Already voted this round.");
  const token = state.tokens.find((t) => t.id === side);
  if (!token) return;
  token.votes = (token.votes || 0) + 1;
  saveState(state);
  localStorage.setItem(VOTE_KEY, String(state.roundId));
  toast("Vote recorded. One vote per round.");
  renderArena(state, true);
  bindVoteButtons();
}

function renderTreasury(state, bal) {
  const wallet = state.treasuryWallet || "";
  const addrEl = $("#treasury-wallet");
  if (addrEl) addrEl.textContent = wallet || "No wallet set — add it in config.json or admin.";

  const link = $("#solscan-link");
  if (link) {
    link.href = isRealWallet(wallet)
      ? "https://solscan.io/account/" + wallet
      : "https://solscan.io";
  }

  const sol = bal.sol || 0;
  const buy = sol * (RULES.winnerPct / 100);
  const lock = sol * (RULES.buybackPct / 100);
  const reserve = sol * (RULES.reservePct / 100);

  setText("#treasury-sol", fmtSol(sol));
  setText("#treasury-buy", fmtSol(buy));
  setText("#split-buy", fmtSol(buy));
  setText("#split-lock", fmtSol(lock));
  setText("#split-reserve", fmtSol(reserve));

  const status = $("#treasury-status");
  if (status) {
    if (!isRealWallet(wallet)) status.textContent = "Waiting for a real wallet string.";
    else if (!bal.live) status.textContent = "Could not read chain. Check the address.";
    else status.textContent = "Live from Solana mainnet.";
  }

  const pct = Math.min(100, (sol / RULES.minSol) * 100);
  const bar = $("#threshold-bar");
  if (bar) bar.style.width = pct + "%";
  const copy = $("#threshold-copy");
  if (copy) {
    copy.textContent = thresholdMet(sol)
      ? "Threshold cleared. A 5-minute vote can start."
      : `${fmtSol(sol)} of ${RULES.minSol} SOL required to open the next round.`;
  }
  const th = $("#threshold-label");
  if (th) th.textContent = thresholdMet(sol) ? "Ready" : "Not reached";
}

function setText(sel, value) {
  const el = $(sel);
  if (el) el.textContent = value;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function escapeAttr(s) {
  return escapeHtml(s).replaceAll("'", "&#39;");
}

function renderOfficialCa(state) {
  const wrap = $("#official-ca-wrap");
  const el = $("#official-ca");
  if (!el || !wrap) return;
  const ca = (state.officialCa || "").trim();
  wrap.style.display = "block";
  el.textContent = ca || "CA pending — drops at launch";
  const pump = $("#official-pump");
  if (pump) pump.href = ca ? "https://pump.fun/coin/" + ca : "https://pump.fun";
}

function copyOfficialCa() {
  const state = loadState();
  if (!state.officialCa) return toast("No CA set yet.");
  navigator.clipboard.writeText(state.officialCa).then(
    () => toast("CA copied"),
    () => toast("Copy failed")
  );
}

function copyWallet() {
  const state = loadState();
  if (!state.treasuryWallet) return toast("No wallet set.");
  navigator.clipboard.writeText(state.treasuryWallet).then(
    () => toast("Wallet copied"),
    () => toast("Copy failed")
  );
}

/* Admin */
function adminLoggedIn() {
  return sessionStorage.getItem("anchor_admin") === "1";
}

function setupAdmin() {
  const login = $("#admin-login");
  const panel = $("#admin-panel");
  if (!login || !panel) return;

  if (adminLoggedIn()) {
    login.style.display = "none";
    panel.style.display = "block";
    fillAdminForm();
    renderSuggestions(loadState());
  }

  $("#login-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if ($("#admin-pw").value === ADMIN_PASSWORD) {
      sessionStorage.setItem("anchor_admin", "1");
      login.style.display = "none";
      panel.style.display = "block";
      fillAdminForm();
    } else {
      const m = $("#login-msg");
      m.textContent = "Wrong password.";
      m.className = "msg err";
    }
  });

  $("#save-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveAdminForm();
  });

  $("#start-round")?.addEventListener("click", async () => {
    const override = !!$("#override-threshold")?.checked;
    const state = loadState();
    const bal = await fetchSolBalance(state.treasuryWallet);
    lastSol = bal.sol;
    if (!override && !thresholdMet(bal.sol)) {
      toast("Need 15 SOL in the treasury, or tick the override.");
      return;
    }
    state.tokens.forEach((t) => (t.votes = 0));
    state.roundId = (state.roundId || 1) + 1;
    state.votingOpen = true;
    state.overrideThreshold = override;
    state.voteStartedAt = Date.now();
    state.voteEndedAt = 0;
    saveState(state);
    localStorage.removeItem(VOTE_KEY);
    fillAdminForm();
    toast(override && !thresholdMet(bal.sol) ? "Vote started with override." : "Vote started.");
  });

  $("#close-round")?.addEventListener("click", () => {
    const state = loadState();
    state.votingOpen = false;
    state.voteEndedAt = Date.now();
    saveState(state);
    fillAdminForm();
    toast("Vote ended.");
  });

  $("#reset-round")?.addEventListener("click", () => {
    if (!confirm("Reset round count, both coins, images, votes, and the live timer?")) return;
    const state = loadState();
    const wallet = state.treasuryWallet || "";
    const next = structuredClone(DEFAULT_STATE);
    next.treasuryWallet = wallet;
    next.officialCa = state.officialCa || "";
    saveState(next);
    localStorage.removeItem(VOTE_KEY);
    ["a", "b"].forEach((side) => {
      const prev = $(`#prev-${side}`);
      if (prev) {
        prev.removeAttribute("src");
        prev.style.display = "none";
        delete prev.dataset.dataurl;
      }
      const file = $(`#img-${side}`);
      if (file) file.value = "";
    });
    fillAdminForm();
    toast("Round and coin data reset.");
  });

  $("#clear-suggestions")?.addEventListener("click", () => {
    if (!confirm("Delete every suggestion?")) return;
    const state = loadState();
    state.suggestions = [];
    saveState(state);
    renderSuggestions(state);
    toast("Suggestions cleared.");
  });

  $("#logout-btn")?.addEventListener("click", () => {
    sessionStorage.removeItem("anchor_admin");
    location.reload();
  });

  ["a", "b"].forEach((side) => {
    $(`#img-${side}`)?.addEventListener("change", async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
      const url = await fileToDataUrl(file);
      const prev = $(`#prev-${side}`);
      prev.src = url;
      prev.style.display = "block";
      prev.dataset.dataurl = url;
    });
  });
}

function fillAdminForm() {
  const s = loadState();
  const [a, b] = s.tokens;
  $("#ticker-a").value = a.ticker || "";
  $("#name-a").value = a.name || "";
  $("#ca-a").value = a.ca || "";
  $("#pump-a").value = a.pumpUrl || "";
  $("#ticker-b").value = b.ticker || "";
  $("#name-b").value = b.name || "";
  $("#ca-b").value = b.ca || "";
  $("#pump-b").value = b.pumpUrl || "";
  $("#narrative").value = s.narrative || "";
  $("#wallet").value = s.treasuryWallet || "";
  if ($("#official-ca-input")) $("#official-ca-input").value = s.officialCa || "";
  if ($("#override-threshold")) $("#override-threshold").checked = !!s.overrideThreshold;
  if (a.image) {
    $("#prev-a").src = a.image;
    $("#prev-a").style.display = "block";
    $("#prev-a").dataset.dataurl = a.image;
  } else if ($("#prev-a")) {
    $("#prev-a").removeAttribute("src");
    $("#prev-a").style.display = "none";
    delete $("#prev-a").dataset.dataurl;
  }
  if (b.image) {
    $("#prev-b").src = b.image;
    $("#prev-b").style.display = "block";
    $("#prev-b").dataset.dataurl = b.image;
  } else if ($("#prev-b")) {
    $("#prev-b").removeAttribute("src");
    $("#prev-b").style.display = "none";
    delete $("#prev-b").dataset.dataurl;
  }
}

async function saveAdminForm() {
  const state = loadState();
  const wallet = cleanWallet($("#wallet").value);
  const bal = await fetchSolBalance(wallet);
  lastSol = bal.sol;
  const next = {
    ...state,
    treasuryWallet: wallet,
    officialCa: cleanWallet($("#official-ca-input")?.value || ""),
    narrative: $("#narrative").value.trim(),
    overrideThreshold: !!$("#override-threshold")?.checked,
    tokens: [
      {
        id: "a",
        ticker: $("#ticker-a").value.trim().replace(/^\$/, ""),
        name: $("#name-a").value.trim(),
        ca: $("#ca-a").value.trim(),
        pumpUrl: $("#pump-a").value.trim(),
        image: $("#prev-a")?.dataset.dataurl || state.tokens[0].image || "",
        votes: state.tokens[0]?.votes || 0,
      },
      {
        id: "b",
        ticker: $("#ticker-b").value.trim().replace(/^\$/, ""),
        name: $("#name-b").value.trim(),
        ca: $("#ca-b").value.trim(),
        pumpUrl: $("#pump-b").value.trim(),
        image: $("#prev-b")?.dataset.dataurl || state.tokens[1].image || "",
        votes: state.tokens[1]?.votes || 0,
      },
    ],
  };
  if (!next.overrideThreshold && next.votingOpen && !thresholdMet(lastSol)) {
    next.votingOpen = false;
    next.voteEndedAt = Date.now();
  }
  saveState(next);
  const m = $("#save-msg");
  if (m) {
    m.textContent = "Saved. Wallet + pair update on the public page.";
    m.className = "msg ok";
  }
  toast("Saved.");
}

function spawnBubbles() {
  const box = document.querySelector(".bubbles");
  if (!box) return;
  for (let i = 0; i < 14; i++) {
    const s = document.createElement("span");
    const size = 3 + Math.random() * 8;
    s.style.width = size + "px";
    s.style.height = size + "px";
    s.style.left = Math.random() * 100 + "%";
    s.style.animationDuration = 10 + Math.random() * 14 + "s";
    s.style.animationDelay = Math.random() * 8 + "s";
    box.appendChild(s);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  spawnBubbles();
  remoteConfig = await loadRemoteConfig();
  if (document.body.dataset.page === "admin") setupAdmin();
  else await renderPublic();
});
