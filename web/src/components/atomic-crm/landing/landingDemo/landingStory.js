/**
 * The landing page's interactive story: the problem toggle, the how-it-works player, and the working
 * Gatherly demo with its auto-playing tour. Lifted from the approved mockup (artifact v7); the markup is
 * landingStory.html and the data comes from deriveDemoData(snapshot.json).
 *
 * The demo never writes: every action changes in-memory state only, and it makes no network requests.
 * `document`, timers and IntersectionObserver are shadowed below so the code stays scoped to `root` and
 * stops completely on unmount (the landing unmounts when a visitor opens the app).
 */
export function mountLandingStory(root, DATA) {
  var alive = true, timeouts = new Set(), intervals = new Set(), observers = [];
  function setTimeout(fn, ms) {
    var id = window.setTimeout(function () { timeouts.delete(id); if (alive) fn(); }, ms);
    timeouts.add(id);
    return id;
  }
  function clearTimeout(id) { window.clearTimeout(id); timeouts.delete(id); }
  function setInterval(fn, ms) {
    var id = window.setInterval(function () { if (alive) fn(); }, ms);
    intervals.add(id);
    return id;
  }
  function IntersectionObserver(cb, opts) {
    var o = new window.IntersectionObserver(function (entries) { if (alive) cb(entries); }, opts);
    observers.push(o);
    return o;
  }
  var document = {
    getElementById: function (id) { return root.querySelector("#" + id); },
    querySelector: function (s) { return root.querySelector(s); },
    querySelectorAll: function (s) { return root.querySelectorAll(s); },
    createElement: function (tag) { return window.document.createElement(tag); },
    get hidden() { return window.document.hidden; },
  };
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Problem toggle
  var ba = document.getElementById("ba"), segBtns = [].slice.call(document.querySelectorAll(".seg [data-mode]")), heldUntil = 0;
  function setMode(m) {
    ba.dataset.mode = m;
    segBtns.forEach(function (o) { o.setAttribute("aria-pressed", String(o.dataset.mode === m)); });
  }
  segBtns.forEach(function (b) {
    b.addEventListener("click", function () { setMode(b.dataset.mode); heldUntil = Date.now() + 8000; });
  });
  setInterval(function () {
    if (Date.now() < heldUntil || document.hidden) return;
    setMode(ba.dataset.mode === "before" ? "after" : "before");
  }, 2000);

  // How-it-works player
  var player = document.getElementById("player"), tabs = [].slice.call(document.querySelectorAll(".tab")), idx = 0, timer;
  function show(i) {
    idx = i;
    tabs.forEach(function (t, j) {
      t.setAttribute("aria-selected", String(j === i));
      document.getElementById(t.getAttribute("aria-controls")).hidden = j !== i;
      var bar = t.querySelector(".bar"); bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = "";
    });
  }
  function schedule() { clearTimeout(timer); if (reduce || player.classList.contains("held")) return; timer = setTimeout(function () { show((idx + 1) % tabs.length); schedule(); }, 4500); }
  tabs.forEach(function (t, j) { t.addEventListener("click", function () { player.classList.add("held"); clearTimeout(timer); show(j); }); });
  player.addEventListener("mouseenter", function () { player.classList.add("held"); clearTimeout(timer); });
  player.addEventListener("mouseleave", function () { player.classList.remove("held"); schedule(); });
  show(0); schedule();

  if (!DATA) {
    // No sample data (the file didn't load): keep the window, offer the sample workspace instead.
    document.getElementById("app").innerHTML =
      '<div class="demo-fallback"><p>The demo couldn’t load here.</p><a class="open-app" href="#/dashboard">Open the sample workspace →</a></div>';
    document.getElementById("tour-btn").hidden = true;
    document.getElementById("reset").hidden = true;
  } else {
  /* ================= The working demo ================= */
  var D = DATA;
  var byId = {}; D.donors.forEach(function (d) { byId[d.id] = d; });
  var main = document.getElementById("main"), addr = document.getElementById("addr");
  var S;
  function fresh() {
    return { view: "home", filter: "all", q: "", open: null, dupI: 0, dupDone: {}, lastDup: null, taskDone: {}, reached: D.home.reached_today,
             invites: "pending", showInvites: false, ask: null, drafts: {}, week: 0, askMsg: "", thread: [], task: null, intro: "day" };
  }
  S = fresh();

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(n) { if (n == null) return "—"; if (n >= 1000000) return "$" + (n / 1e6).toFixed(n % 1e6 ? 2 : 0).replace(/\.?0+$/, "") + "M"; if (n >= 10000) return "$" + (n / 1000).toFixed(1).replace(/\.0$/, "") + "k"; return "$" + Math.round(n).toLocaleString("en-US"); }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fdate(s) { if (!s) return "—"; var p = s.split("-"); return MONTHS[+p[1] - 1] + " " + (+p[2]) + ", " + p[0]; }
  function sdate(s) { var p = s.split("-"); return MONTHS[+p[1] - 1] + " " + (+p[2]); }
  function dupsLeft() { return D.dups.filter(function (u) { return !S.dupDone[u.id]; }).length; }
  function tasksLeft() { return D.tasks.filter(function (t) { return !S.taskDone[t.id]; }); }
  var ATTN = D.attention.slice(0, D.home.gifts_at_risk);
  function statusPills(d) {
    var out = [];
    var a = D.attention.filter(function (x) { return x.id === d.id; })[0];
    if (a && a.badge === "failed") out.push('<span class="pill bad">Gift failed</span>');
    if (d.status === "lapsing" || d.status === "lapsed") { out.push('<span class="pill bad">Needs a call</span>'); out.push('<span class="pill late">Late</span>'); }
    else if (d.status === "on_track") out.push('<span class="pill ok">On track</span>');
    else out.push('<span class="pill none">No gifts yet</span>');
    return out.join("");
  }
  function subline(d) {
    if (d.cadence && d.days != null) return "gives about every " + Math.round(d.cadence / 30) + " mo · " + d.days + " days since last gift";
    return d.next || (d.org ? "Organization" : "Individual");
  }
  function greeting() { var h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }

  function setView(v) { S.view = v; S.open = null; S.task = null; render(); main.scrollTop = 0; }

  function render() {
    var names = { home: "Home", donors: "Donors", dups: "Duplicates", calendar: "Calendar", ask: "Ask" };
    addr.textContent = "gatherly · " + names[S.view];
    document.querySelectorAll(".navb").forEach(function (b) { if (b.dataset.view === S.view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    var n = dupsLeft(); var nd = document.getElementById("nav-dups"); nd.textContent = n; nd.hidden = !n;
    main.innerHTML = ({ home: vHome, donors: vDonors, dups: vDups, calendar: vCalendar, ask: vAsk })[S.view]();
    document.getElementById("drawer-host").innerHTML = S.task ? vTask(S.task) : S.open ? vDrawer(byId[S.open]) : "";
  }

  var SCRIPTS = {}; D.scripts.forEach(function (x) { SCRIPTS[x.id] = x; });
  var gen = 0;   // bumps on reset, so pending timers from an old run do nothing
  function scrollThread() { setTimeout(function () { var t = document.getElementById("thread"); if (t && S.view === "home") main.scrollTop = main.scrollHeight; }, 30); }
  function startRun(id) {
    var sc = SCRIPTS[id], run = { kind: "run", id: id, shown: 0, done: false, decided: null, saved: false, call: null }, g = gen;
    S.thread.push(run); render(); scrollThread();
    (function tick() {
      setTimeout(function () {
        if (g !== gen) return;
        run.shown++; if (run.shown > sc.steps.length) { run.done = true; } render(); scrollThread();
        if (!run.done) tick();
      }, reduce ? 0 : 700);
    })();
  }
  function startCall(run) {
    var sc = SCRIPTS[run.id], g = gen; run.call = { lines: 0, ended: false, secs: 0 }; render(); scrollThread();
    (function next() {
      setTimeout(function () {
        if (g !== gen || !run.call || run.call.ended) return;
        run.call.lines++; run.call.secs += 2;
        if (run.call.lines >= sc.call.lines.length) run.call.ended = true;
        render(); scrollThread(); if (!run.call.ended) next();
      }, reduce ? 0 : 1500);
    })();
  }
  function stepsHtml(steps, shown) {
    return '<ul class="steps">' + steps.map(function (st, i) {
      if (i >= shown + 1) return "";
      var running = i === shown;
      return '<li class="' + (running ? "running" : "") + '"><span class="tick">' + (running ? "…" : "✓") + '</span><span><b>' + esc(st.tool) + '</b> · ' + esc(st.summary) + '</span></li>';
    }).join("") + '</ul>';
  }
  function sheetCard(c) {
    return '<div class="acard"><span class="lbl">' + esc(c.title) + '</span><h5>' + esc(c.name) + '</h5>' +
      '<span class="lbl">Giving</span><ul><li>' + c.gifts + ' gifts · ' + money(c.total) + ' in all</li>' +
      (c.first ? '<li>First: ' + money(c.first.amount) + ' on ' + esc(c.first.date) + '</li>' : '') +
      (c.last ? '<li>Last: ' + money(c.last.amount) + ' on ' + esc(c.last.date) + '</li>' : '') + '</ul>' +
      c.declined.map(function (x) { return '<div class="warnline">Not a gift: ' + money(x.amount) + ' charge on ' + esc(x.date) + ' was ' + esc(x.status) + '.</div>'; }).join("") +
      (c.tasks.length ? '<span class="lbl">Open tasks</span><ul>' + c.tasks.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join("") + '</ul>' : '') +
      '<span class="lbl">Talking points</span><ul>' + c.talking.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join("") + '</ul>' +
      '<div class="acts"><button class="btn" type="button" data-person="' + c.person + '">Open profile</button></div></div>';
  }
  function runHtml(run, idx) {
    var sc = SCRIPTS[run.id], out = '<p class="bubble">' + esc(sc.text) + '</p><div class="reply">';
    out += stepsHtml(sc.steps, Math.min(run.shown, sc.steps.length));
    if (!run.done) return out + '<span class="thinking">Thinking…</span></div>';
    var c = sc.card;
    if (c.kind === "lookup") {
      out += '<div class="acard"><span class="lbl">Look up</span><h5>' + esc(c.name) + (c.org ? ' · ' + esc(c.org) : '') + '</h5>' +
        '<span class="lbl">From your CRM</span><ul>' + c.crm.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>' +
        '<span class="lbl">Found on the web <span class="illus">illustrative</span></span><ul>' + c.web.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>' +
        '<span class="lbl">Suggested next step</span><p style="font-size:13px">' + esc(c.next) + '</p>' +
        '<div class="acts"><button class="btn solid" type="button" data-save="' + idx + '"' + (run.saved ? " disabled" : "") + '>' + (run.saved ? "Saved" : "Save to profile") + '</button><button class="btn" type="button" data-person="' + c.person + '">Open profile</button></div></div>';
      if (run.saved) out += stepsHtml([sc.followUp], 1);
    }
    if (c.kind === "call_sheet") {
      out += sheetCard(c);
      if (sc.call) {
        if (!run.call) out += '<div class="acts"><button class="btn solid" type="button" data-callstart="' + idx + '">Call</button></div>';
        else {
          var k = run.call;
          out += '<div class="callbox"><span class="live">Sample call: no phone was dialed · ' + Math.floor(k.secs / 60) + ':' + String(k.secs % 60).padStart(2, "0") + '</span><span class="lbl" style="font-size:11px;color:var(--muted)">Transcript</span>' +
            sc.call.lines.slice(0, k.lines).map(function (l) { return '<p class="line"><b>' + (l[0] === "you" ? "You" : esc(sc.card.name.split(" ")[0])) + '</b>' + esc(l[1]) + '</p>'; }).join("") +
            (k.ended ? '' : '<div class="acts"><button class="btn" type="button" data-hangup="' + idx + '">Hang up</button></div>') + '</div>';
          if (k.ended) out += '<div class="acard"><span class="lbl">Summary</span><p style="font-size:13px">' + esc(sc.call.summary) + '</p><span class="lbl">Next steps</span><ul>' + sc.call.next.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul></div>' + stepsHtml([sc.followUp], 1);
        }
      }
    }
    if (c.kind === "email_prep") {
      out += '<div class="acard"><span class="lbl">Email prep · ' + esc(c.topic) + ' · ' + c.count + ' people</span><h5>' + esc(c.names.join(", ")) + (c.count > c.names.length ? ' +' + (c.count - c.names.length) + ' more' : '') + '</h5>' +
        '<span class="lbl">What we did since</span><ul>' + c.since.map(function (x) { return '<li>' + esc(x.fact) + (x.date ? ' <span class="muted">(' + esc(x.date) + ')</span>' : '') + '</li>'; }).join("") + '</ul>' +
        '<span class="lbl">Coming up</span><ul>' + c.coming.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>' +
        '<span class="lbl">The angle</span><p style="font-size:13px">' + esc(c.angle) + '</p></div>';
      var ap = sc.approval;
      out += '<div class="acard approval"><span class="lbl">Needs your approval</span><h5>' + esc(ap.summary) + '</h5>' +
        '<div class="mail"><b>To: ' + esc(ap.preview[0].to) + '</b><b>' + esc(ap.preview[0].subject) + '</b>' + esc(ap.preview[0].body) + '</div>' +
        '<p class="muted small">+ ' + (ap.preview.length - 1) + ' more personal emails</p>' +
        (run.decided ? '' : '<div class="acts"><button class="btn solid" type="button" data-send="' + idx + '">Send</button><button class="btn" type="button" data-nosend="' + idx + '">Don\'t send</button></div>') + '</div>';
      if (run.decided) out += stepsHtml([run.decided === "sent" ? ap.approved : ap.declined], 1);
    }
    return out + '<span class="run-pill">Sample run · nothing was searched, sent or dialed</span></div>';
  }
  function qaHtml(item) {
    return '<p class="bubble">' + esc(item.q) + '</p><div class="reply">' +
      (item.list ? '<ul class="answer-list">' + item.list.map(function (x) { return '<li><b>' + esc(x.name) + '</b> · <span class="muted">' + esc(x.line) + '</span></li>'; }).join("") + '</ul>' : '<p style="font-size:13px">' + esc(item.text) + '</p>') +
      '<span class="run-pill">Answered from the sample data</span></div>';
  }

  function vHome() {
    var g = D.goal, pct = Math.round(g.pct), open = tasksLeft(), first = open[0];
    var r = 34, c = Math.PI * r, off = c * (1 - g.pct / 100);
    var tasksHtml = D.tasks.slice(0, 7).map(function (t) {
      var done = !!S.taskDone[t.id];
      return '<li class="' + (done ? "done" : "") + '"><button class="chk" type="button" data-task="' + t.id + '" aria-label="Mark ' + esc(t.title) + ' done">' + (done ? "✓" : "") + '</button><span data-opentask="' + t.id + '" title="' + esc(t.why) + '">' + esc(t.title) + '</span></li>';
    }).join("");
    var nd = dupsLeft(), ev = D.nextEvent;
    return '<div class="home"><div class="left">' +
      '<div class="card"><h4>' + esc(g.label) + ' outreach</h4><div class="gauge"><svg width="84" height="50" viewBox="0 0 84 50" aria-hidden="true"><path d="M8 44 A34 34 0 0 1 76 44" fill="none" stroke="#e6e3d8" stroke-width="8" stroke-linecap="round"/><path d="M8 44 A34 34 0 0 1 76 44" fill="none" stroke="#e1c64a" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/></svg><div><strong>' + money(g.raised) + '</strong><div class="muted small">' + pct + '% of ' + money(g.goal) + '</div></div></div></div>' +
      '<div class="card"><h4>Tasks · ' + open.length + ' left</h4><ul class="tasklist">' + tasksHtml + '</ul></div>' +
      '</div><div>' +
      '<p class="greet">' + greeting() + ', <b>Sharif.</b></p>' +
      '<div class="intro"><div class="intro-head"><p class="ttl"><small>Agent</small><b>' + (S.intro === "day" ? "Here\u2019s your day." : 'Try the agent</b> <span class="sample-tag">Sample run</span><b>') + '</b></p>' +
      '<span class="switch" role="group" aria-label="Home intro"><button type="button" data-intro="day" aria-pressed="' + (S.intro === "day") + '">Your day</button><button type="button" data-intro="try" aria-pressed="' + (S.intro === "try") + '">Try the agent</button></span></div>' +
      (S.intro === "day" ? '<div class="brief">' +
      (first ? '<div class="brow"><p>' + open.length + ' tasks today. First up: ' + esc(first.title) + '</p><button class="btn soft" type="button" data-act="start">Start →</button></div>' : '<div class="brow"><p>All tasks done for today.</p></div>') +
      '<div class="brow"><p>' + D.lateAnswer.length + ' usual gifts look late.</p><button class="btn soft" type="button" data-act="late">Show me →</button></div>' +
      (nd ? '<div class="brow"><p>' + nd + ' possible duplicates to review.</p><button class="btn soft" type="button" data-view="dups">Review →</button></div>' : '<div class="brow"><p>No duplicates left to review.</p></div>') +
      '<div class="brow"><p>Next event: ' + esc(ev.title) + ', in ' + ev.days + ' days (' + sdate(ev.date) + ').</p><button class="btn soft" type="button" data-view="calendar">Open calendar →</button></div>' +
      '<div class="brow"><p>You\'ve reached ' + S.reached + ' people today.</p></div>' +
      '</div>' : '<div class="brief">' +
      D.scripts.map(function (x) { return '<div class="brow"><p>' + esc(x.text) + '</p><button class="btn soft" type="button" data-run="' + x.id + '">' + esc(x.button) + ' →</button></div>'; }).join("") +
      '</div>') + '</div><div class="thread" id="thread">' + S.thread.map(function (it, i) { return it.kind === "run" ? runHtml(it, i) : qaHtml(it); }).join("") + '</div>' +
      '<form class="composer" id="homeform"><input type="text" placeholder="Ask the agent…" aria-label="Ask the agent" id="home-ask"><button class="btn solid" type="submit">Ask</button></form>' +
      '</div></div>';
  }
  function vTask(t) {
    return '<aside class="drawer" aria-label="Task"><button class="x" type="button" data-close aria-label="Close">×</button>' +
      '<p class="agent-label">Task · due today</p><h4>' + esc(t.title) + '</h4><p style="margin-top:10px">' + esc(t.why || "") + '</p>' +
      '<div class="pills" style="margin-top:10px">' + (t.chips || []).map(function (c) { return '<span class="pill none">' + esc(c) + '</span>'; }).join("") + '</div>' +
      '<div class="acts" style="display:flex;gap:8px;margin-top:16px"><button class="btn solid" type="button" data-taskdone="' + t.id + '">' + (S.taskDone[t.id] ? "Done ✓" : "Mark done") + '</button>' +
      (t.person && byId[t.person] ? '<button class="btn" type="button" data-person="' + t.person + '">Open donor</button>' : '') + '</div>' +
      '<p class="muted small" style="margin-top:14px">On the laptop, Start hands this task to the agent.</p></aside>';
  }

  function filtered() {
    var list = D.donors.slice();
    if (S.filter === "call") list = list.filter(function (d) { return d.status === "lapsing" || d.status === "lapsed"; });
    if (S.filter === "ok") list = list.filter(function (d) { return d.status === "on_track"; });
    if (S.filter === "late") { var ids = ATTN.map(function (a) { return a.id; }); list = list.filter(function (d) { return ids.indexOf(d.id) >= 0; }); }
    if (S.q) { var q = S.q.toLowerCase(); list = list.filter(function (d) { return d.name.toLowerCase().indexOf(q) >= 0 || (d.email || "").toLowerCase().indexOf(q) >= 0; }); }
    return list.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
  }
  function vDonors() {
    var list = filtered(), nd = dupsLeft();
    var f = function (k, label) { return '<button type="button" data-filter="' + k + '" aria-pressed="' + (S.filter === k) + '">' + label + '</button>'; };
    var rows = list.map(function (d) {
      return '<button class="drow" type="button" data-person="' + d.id + '"><span class="who"><span class="av">' + esc(d.ini) + '</span><div><b>' + esc(d.name) + '</b><small>' + esc(subline(d)) + '</small></div></span>' +
        '<span class="pills c-status">' + statusPills(d) + '</span><span class="c-last">' + (d.last ? money(d.last.amount) + '<div class="muted small">' + fdate(d.last.date) + '</div>' : '<span class="muted">—</span>') + '</span>' +
        '<span class="num c-life">' + money(d.lifetime) + '</span><span class="score">' + (d.score == null ? "—" : d.score) + '</span></button>';
    }).join("");
    return '<h3>Donors <span class="muted" style="font-size:15px;font-weight:400">' + D.donors.length + ' donors</span></h3>' +
      (nd ? '<div class="banner"><span class="warn">!</span><p>' + nd + ' possible duplicates found</p><button class="btn" type="button" data-view="dups">Review merges →</button></div>' : '') +
      '<div class="toolbar"><label class="search"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" type="search" placeholder="Search by name or email" value="' + esc(S.q) + '" aria-label="Search donors"></label>' +
      '<div class="filters" role="group" aria-label="Filter">' + f("all", "All") + f("late", "Gifts look late") + f("call", "Needs a call") + f("ok", "On track") + '</div></div>' +
      '<div class="dtable"><div class="thead"><span>Donor</span><span>Status</span><span class="c-last">Last gift</span><span class="num c-life">Lifetime</span><span class="num">Score</span></div>' +
      (rows || '<div class="empty">No donors match. Try another search.</div>') + '</div>';
  }

  function vDrawer(d) {
    if (!d) return "";
    var max = Math.max.apply(null, d.gifts.map(function (g) { return g.amount; }).concat([1]));
    var bars = d.gifts.map(function (g) { return '<i class="' + (g.ok ? "" : "failed") + '" style="height:' + Math.max(8, g.amount / max * 100).toFixed(0) + '%" title="' + money(g.amount) + ' · ' + fdate(g.date) + (g.ok ? "" : " · failed") + '"></i>'; }).join("");
    var ds = S.drafts[d.id], first = d.org ? "team" : (d.name.split(" ")[0]);
    var draft = !ds ? '<button class="btn solid" type="button" data-draft="' + d.id + '" style="margin-top:14px">Draft a thank-you</button>' :
      '<div class="draft"><span class="muted small">To ' + esc(d.name) + ' · drafted by the agent</span><p>Hi ' + esc(first) + ', thank you for standing with us' + (d.last ? ' — your gift of ' + money(d.last.amount) + ' in ' + fdate(d.last.date).split(",")[0].split(" ")[0] + ' made a real difference' : '') + '. We would love to share what it made possible.</p>' +
      (ds === "draft" ? '<div class="acts"><button class="btn solid" type="button" data-approve="' + d.id + '">Send</button><button class="btn" type="button" data-skip="' + d.id + '">Don\'t send</button><span class="status-note">Waiting for your approval</span></div>' :
        '<div class="status-note">' + (ds === "sent" ? "Approved. In the demo nothing is actually sent." : "Not sent. Kept as a draft.") + '</div>') + '</div>';
    return '<aside class="drawer" aria-label="' + esc(d.name) + '"><button class="x" type="button" data-close aria-label="Close">×</button>' +
      '<h4>' + esc(d.name) + '</h4><div class="pills" style="margin-top:8px">' + statusPills(d) + '</div>' +
      '<div class="stats"><div><b>' + money(d.lifetime) + '</b><small>Lifetime</small></div><div><b>' + (d.last ? money(d.last.amount) : "—") + '</b><small>Last gift</small></div><div><b>' + (d.score == null ? "—" : d.score) + '</b><small>Priority</small></div></div>' +
      (d.gifts.length ? '<p class="muted small">Gift history</p><div class="bars">' + bars + '</div>' : '<p class="muted small">No gifts recorded yet.</p>') +
      (d.next ? '<div class="next"><b>Next step:</b> ' + esc(d.next) + '</div>' : '') + draft + '</aside>';
  }

  function vDups() {
    var pending = D.dups.filter(function (u) { return !S.dupDone[u.id]; }), total = D.dups.length, doneN = total - pending.length;
    var notice = S.lastDup ? '<div class="notice">' + esc(S.lastDup.msg) + '<button class="btn" type="button" data-undo>Undo</button></div>' : "";
    if (!pending.length) return '<h3>Duplicates</h3>' + notice + '<div class="done-state"><span class="big">✓</span><b>All ' + total + ' reviewed.</b><p class="muted">Your donor list has one record per person.</p><button class="btn solid" type="button" data-view="donors">Back to donors</button></div>';
    var u = pending[0];
    function card(p, n) { return '<div class="who-card"><div class="top"><span class="av">' + esc(p.name.split(" ").map(function (w) { return w[0]; }).join("").slice(0, 2)) + '</span><b>' + esc(p.name) + '</b></div><div class="kv"><span>Email</span><span>' + esc(p.email || "—") + '</span><span>Phone</span><span>' + esc(p.phone || "—") + '</span><span>Gifts</span><span>' + (n == null ? "—" : n) + '</span><span>From</span><span>' + esc(p.src || "—") + '</span></div></div>'; }
    return '<h3>We found this donor twice</h3><p class="muted" style="margin-top:4px">' + (doneN + 1) + ' of ' + total + ' · ' + Math.round(u.conf * 100) + '% match</p>' +
      '<div class="progress"><i style="width:' + (doneN / total * 100) + '%"></i></div>' + notice +
      '<div class="pair">' + card(u.a, u.ag) + card(u.b, u.bg) + '</div>' +
      '<ul class="reasons">' + u.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join("") + '</ul>' +
      '<div class="dup-acts"><button class="btn solid" type="button" data-merge="' + u.id + '">Merge ✓</button><button class="btn" type="button" data-keep="' + u.id + '">Keep separate</button><span class="muted small">Gift history moves to the record you keep.</span></div>';
  }

  function vCalendar() {
    var start = new Date(2026, 10, 8 + S.week * 7), days = [], dn = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (var i = 0; i < 7; i++) { var dt = new Date(start); dt.setDate(start.getDate() + i); days.push(dt); }
    function iso(dt) { return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0"); }
    var cells = days.map(function (dt) {
      var k = iso(dt), evs = D.events.filter(function (e) { return e.date === k; }), tks = D.calendar.filter(function (c) { return c.date === k && c.kind === "task"; });
      return '<div class="day' + (k === D.asOf ? " today" : "") + '"><span class="dn">' + dn[dt.getDay()] + '</span><span class="dd">' + dt.getDate() + '</span>' +
        evs.map(function (e) { return '<span class="ev">' + esc(e.title) + (e.time ? " · " + e.time : "") + '</span>'; }).join("") +
        (tks.length ? '<span class="tk">' + tks.length + ' task' + (tks.length > 1 ? "s" : "") + '</span>' : "") + '</div>';
    }).join("");
    var label = sdate(iso(days[0])) + " – " + sdate(iso(days[6])).split(" ")[1];
    var inviteList = D.donors.filter(function (d) { return d.status === "on_track"; }).slice(0, 12);
    var sug = S.invites === "pending" ?
      '<div class="suggest"><p><small>Suggested by the agent</small><b>Review 12 drafted invites for Give Miami Day — Early Giving opens</b></p><button class="btn" type="button" data-invites="toggle">' + (S.showInvites ? "Hide" : "Review") + '</button><button class="btn solid" type="button" data-invites="approve">Approve all</button></div>' +
      (S.showInvites ? '<div class="invites">' + inviteList.map(function (d) { return '<div><span class="av" style="width:24px;height:24px;font-size:10px">' + esc(d.ini) + '</span><span>' + esc(d.name) + '</span></div>'; }).join("") + '</div>' : "") :
      '<div class="notice">12 invites approved. In the demo nothing is actually sent.<button class="btn" type="button" data-invites="undo">Undo</button></div>';
    return '<h3>Calendar</h3><div class="toolbar" style="justify-content:space-between"><b>November 2026 · ' + label + '</b><span style="display:flex;gap:6px"><button class="btn" type="button" data-week="-1" ' + (S.week <= 0 ? "disabled" : "") + '>‹</button><button class="btn" type="button" data-week="0">This week</button><button class="btn" type="button" data-week="1" ' + (S.week >= 1 ? "disabled" : "") + '>›</button></span></div>' +
      '<div class="week">' + cells + '</div>' + sug;
  }

  function vAsk() {
    var a = S.ask != null ? D.ask[S.ask] : null;
    var ans = "";
    if (a) {
      var people = a.ids.map(function (id) { return byId[id]; }).filter(Boolean);
      ans = '<div class="answer"><div class="understood"><b>Gatherly understood</b>' + esc(a.interp) + '</div><p class="muted small">' + people.length + ' donors · answered from your own records</p>' +
        people.slice(0, 10).map(function (d) { return '<button class="res" type="button" data-person="' + d.id + '"><span class="who"><span class="av">' + esc(d.ini) + '</span><div><b>' + esc(d.name) + '</b><small>' + (d.last ? "Last gift " + money(d.last.amount) + " · " + fdate(d.last.date) : "No gifts yet") + '</small></div></span><span class="num">' + money(d.lifetime) + '</span></button>'; }).join("") +
        (people.length > 10 ? '<p class="muted small">+ ' + (people.length - 10) + ' more</p>' : "") + '</div>';
    } else if (S.askMsg) ans = '<div class="answer"><div class="understood"><b>In this demo</b>' + esc(S.askMsg) + '</div></div>';
    return '<div class="ask-hero"><p class="eyebrow">Ask Gatherly</p><h3>What would you like to know about your donors?</h3></div>' +
      '<form class="askbox" id="askform"><input id="askq" type="text" placeholder="Who gave this quarter and hasn\'t been thanked yet?" aria-label="Ask a question" value="' + (a ? esc(a.q) : "") + '"><button class="btn solid" type="submit">Ask</button></form>' +
      '<div class="examples">' + D.ask.map(function (x, i) { return '<button type="button" data-ask="' + i + '">' + esc(x.q.split("?")[0]) + '?</button>'; }).join("") + '</div>' + ans;
  }

  // Events (delegated inside the app)
  var app = document.getElementById("app");
  app.addEventListener("click", function (e) {
    var t = e.target.closest("button, [data-person]"); if (!t || !app.contains(t)) return;
    var ds = t.dataset;
    if (ds.view) return setView(ds.view);
    if (ds.task) { var id = +ds.task; if (S.taskDone[id]) { delete S.taskDone[id]; S.reached--; } else { S.taskDone[id] = 1; S.reached++; } return render(); }
    if (ds.act === "start") { var f = tasksLeft()[0]; if (f) { S.open = null; S.task = f; } return render(); }
    if (ds.opentask) { S.open = null; S.task = D.tasks.filter(function (x) { return x.id === +ds.opentask; })[0]; return render(); }
    if (ds.taskdone) { var tid = +ds.taskdone; if (!S.taskDone[tid]) { S.taskDone[tid] = 1; S.reached++; } return render(); }
    if (ds.act === "late") { S.thread.push({ kind: "qa", q: "Who’s late on a usual gift?", list: D.lateAnswer }); render(); return scrollThread(); }
    if (ds.intro) { S.intro = ds.intro; return render(); }
    if (ds.run) return startRun(ds.run);
    if (ds.save) { S.thread[+ds.save].saved = true; return render(); }
    if (ds.send) { S.thread[+ds.send].decided = "sent"; render(); return scrollThread(); }
    if (ds.nosend) { S.thread[+ds.nosend].decided = "kept"; render(); return scrollThread(); }
    if (ds.callstart) return startCall(S.thread[+ds.callstart]);
    if (ds.hangup) { var cr = S.thread[+ds.hangup]; cr.call.lines = SCRIPTS[cr.id].call.lines.length; cr.call.ended = true; render(); return scrollThread(); }
    if (ds.filter) { S.filter = ds.filter; return render(); }
    if (ds.person && ds.person !== "") { S.task = null; S.open = +ds.person; return render(); }
    if (ds.close !== undefined) { S.open = null; S.task = null; return render(); }
    if (ds.draft) { S.drafts[+ds.draft] = "draft"; return render(); }
    if (ds.approve) { S.drafts[+ds.approve] = "sent"; return render(); }
    if (ds.skip) { S.drafts[+ds.skip] = "skipped"; return render(); }
    if (ds.merge || ds.keep) {
      var uid = +(ds.merge || ds.keep), u = D.dups.filter(function (x) { return x.id === uid; })[0];
      var keepRec = (u.bg || 0) >= (u.ag || 0) ? u.b : u.a;
      S.dupDone[uid] = ds.merge ? "merged" : "kept";
      S.lastDup = { id: uid, msg: ds.merge ? "Merged. Gift history moved to " + keepRec.name + "." : "Kept as two separate donors." };
      return render();
    }
    if (ds.undo !== undefined && S.lastDup) { delete S.dupDone[S.lastDup.id]; S.lastDup = null; return render(); }
    if (ds.invites === "toggle") { S.showInvites = !S.showInvites; return render(); }
    if (ds.invites === "approve") { S.invites = "approved"; return render(); }
    if (ds.invites === "undo") { S.invites = "pending"; return render(); }
    if (ds.week) { S.week = +ds.week; return render(); }
    if (ds.ask) { S.ask = +ds.ask; S.askMsg = ""; return render(); }
  });
  app.addEventListener("input", function (e) {
    if (e.target.id === "q") { S.q = e.target.value; var pos = e.target.selectionStart; render(); var q = document.getElementById("q"); q.focus(); q.setSelectionRange(pos, pos); }
  });
  app.addEventListener("submit", function (e) {
    if (e.target.id === "homeform") {
      e.preventDefault();
      var hv = document.getElementById("home-ask").value.trim(); if (!hv) return;
      var hk = D.ask.findIndex(function (x) { return x.q.toLowerCase().indexOf(hv.toLowerCase()) === 0 && hv.length > 3; });
      if (hk >= 0) S.thread.push({ kind: "qa", q: hv, list: D.ask[hk].ids.slice(0, 8).map(function (id) { var dn = byId[id]; return { name: dn ? dn.name : "#" + id, line: dn && dn.last ? "Last gift " + money(dn.last.amount) + " · " + fdate(dn.last.date) : "No gifts yet" }; }) });
      else S.thread.push({ kind: "qa", q: hv, text: "This preview answers questions about your sample data, like who's late on a usual gift, who gave this quarter, or who needs a call. Try one of the Try the agent rows above to watch the agent work." });
      render(); return scrollThread();
    }
    if (e.target.id !== "askform") return; e.preventDefault();
    var v = document.getElementById("askq").value.trim().toLowerCase();
    var hit = D.ask.findIndex(function (x) { return x.q.toLowerCase().indexOf(v) === 0 && v.length > 3; });
    if (hit >= 0) { S.ask = hit; S.askMsg = ""; } else { S.ask = null; S.askMsg = "This demo answers the example questions. The full app's agent answers anything about your donors."; }
    render();
  });
  app.addEventListener("keydown", function (e) { if (e.key === "Escape" && (S.open || S.task)) { S.open = null; S.task = null; render(); } });
  document.getElementById("reset").addEventListener("click", function () { gen++; S = fresh(); render(); main.scrollTop = 0; });
  render();

  /* ---------- Auto tour: a cursor that clicks through the demo ---------- */
  var cursor = document.getElementById("cursor"), tourBtn = document.getElementById("tour-btn"), side = document.querySelector(".side");
  var STEPS = [
    ["[data-intro=try]", 1200], ["[data-run=batch_email]", 3600], ["[data-send]", 2200], ["[data-run=call]", 2600], ["[data-callstart]", 12800],
    ["[data-intro=day]", 1200], ["[data-act=late]", 2600], [".brow [data-view=dups]", 1500], ["[data-merge]", 1600], ["[data-merge]", 1600],
    [".navb[data-view=calendar]", 1300], ["[data-invites=approve]", 1800], [".navb[data-view=ask]", 1100],
    ["[data-ask='1']", 2800], [".navb[data-view=home]", 1200], ["#reset", 1500]
  ];
  var tour = { on: true, token: 0, step: 0, visible: false, left: false, pos: { x: 40, y: 40 }, idle: null };
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function ensureVisible(el) {
    if (side.contains(el)) { side.scrollLeft = Math.max(0, el.offsetLeft - 40); return; }
    var host = el.closest(".main, .drawer"); if (!host) return;
    if (host === main && el.closest(".thread")) { main.scrollTop = main.scrollHeight; return; }
    var r = el.getBoundingClientRect(), hr = host.getBoundingClientRect();
    if (r.top < hr.top + 20 || r.bottom > hr.bottom - 20) host.scrollTop += r.top - hr.top - hr.height / 3;
  }
  function moveTo(el) {
    var ar = app.getBoundingClientRect(), r = el.getBoundingClientRect();
    tour.pos = { x: r.left - ar.left + Math.min(r.width / 2, 60), y: r.top - ar.top + r.height / 2 };
    cursor.style.transform = "translate(" + tour.pos.x + "px," + tour.pos.y + "px)";
  }
  function ripple() { var d = document.createElement("span"); d.className = "ripple"; d.style.left = tour.pos.x + 4 + "px"; d.style.top = tour.pos.y + 3 + "px"; app.appendChild(d); setTimeout(function () { d.remove(); }, 600); }
  async function run(token) {
    var ok = function () { return tour.on && tour.visible && token === tour.token; };
    while (ok()) {
      var st = STEPS[tour.step % STEPS.length]; tour.step++;
      if (st[0] === "#reset") { await wait(st[1]); if (!ok()) return; gen++; S = fresh(); render(); main.scrollTop = 0; continue; }
      var el = app.querySelector(st[0]);
      if (!el) continue;
      ensureVisible(el); await wait(60); if (!ok()) return;
      moveTo(el); await wait(850); if (!ok()) return;
      cursor.classList.add("press"); ripple(); await wait(140); cursor.classList.remove("press");
      if (!ok()) return;
      el.click(); await wait(st[1]);
    }
  }
  function setBtn() { tourBtn.textContent = tour.on ? "Pause tour" : "Play tour"; tourBtn.setAttribute("aria-pressed", String(tour.on)); }
  function startTour() { if (!tour.on || !tour.visible) return; cursor.hidden = false; tour.token++; run(tour.token); }
  function pauseTour() { tour.on = false; tour.token++; cursor.hidden = true; setBtn(); }
  function playTour() { tour.on = true; setBtn(); startTour(); }
  setBtn();
  tourBtn.addEventListener("click", function () { clearTimeout(tour.idle); if (tour.on) pauseTour(); else playTour(); });
  // A real click or key press inside the app hands control to the visitor (scrolling the page does not).
  // After 15 s without one, the tour picks up again.
  ["pointerdown", "keydown"].forEach(function (ev) {
    app.addEventListener(ev, function (e) {
      if (!e.isTrusted) return;
      if (tour.on) pauseTour();
      clearTimeout(tour.idle);
      tour.idle = setTimeout(playTour, 15000);
    });
  });
  new IntersectionObserver(function (entries) {
    tour.visible = entries[0].isIntersecting;
    if (tour.visible) {
      // Back in view while the tour owns the demo: start over, so every visit opens with the agent's runs.
      if (tour.on && tour.left) { tour.step = 0; gen++; S = fresh(); render(); main.scrollTop = 0; }
      tour.left = false;
      startTour();
    } else {
      tour.token++;
      if (tour.on) tour.left = true;
    }
  }, { threshold: 0.25 }).observe(app);

  }

  return function unmount() {
    alive = false;
    timeouts.forEach(function (id) { window.clearTimeout(id); });
    intervals.forEach(function (id) { window.clearInterval(id); });
    observers.forEach(function (o) { o.disconnect(); });
  };
}
