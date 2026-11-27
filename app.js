/* ============================================================
 * 背题助手 —— 应用逻辑
 * 说明：本文件是固定框架，一般不需要修改；换题库只改 questions.js
 * ============================================================ */
"use strict";

/* ---------- 常量 ---------- */
const LS_KEY = "beiti_state_v1";
const INTERVALS = [0, 1, 2, 4, 7, 15, 30]; // 记忆曲线复习间隔（天）
const LETTERS = "ABCDEF";
const TYPES = {
  single: "单选题",
  multiple: "多选题",
  judge: "判断题",
  fill: "填空题",
  short: "简答题",
};

/* ---------- 默认状态 ---------- */
function defaultState() {
  return {
    theme: "light",
    tts: false,
    currentBank: null,
    sessions: {},
    customQuestions: [],
    deletedIds: [],
    wrong: {},
    favorite: {},
    sr: {},
    stats: {},
    daily: {},
  };
}

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      // 迁移旧版单 session → 按题库的 sessions
      if (s.session && !s.sessions) {
        s.sessions = { [s.session.bank || "未分类"]: s.session };
      }
      delete s.session;
      return Object.assign(defaultState(), s);
    }
  } catch (e) { /* ignore */ }
  return defaultState();
}

function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (e) { /* ignore */ }
}

/* ---------- 工具函数 ---------- */
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

function uid() { return "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalizeText(s) {
  return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
}

function letter(i) { return LETTERS[i] || String(i); }

function fmtDate(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function speak(text) {
  if (!state.tts) return;
  try {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 1800);
}

/* ---------- 有效题库（基础题库 + 用户增删改） ---------- */
function effectiveBank() {
  const base = (window.QUESTION_BANK || []).filter((q) => !state.deletedIds.includes(q.id));
  const overrides = {};
  state.customQuestions.forEach((q) => { overrides[q.id] = q; });
  const merged = base.map((q) => overrides[q.id] || q);
  const baseIds = new Set(merged.map((q) => q.id));
  const additions = state.customQuestions.filter((q) => !baseIds.has(q.id));
  return merged.concat(additions);
}

function getQuestion(id) {
  return activeBank().find((q) => q.id === id);
}

function banks() {
  const set = new Set();
  effectiveBank().forEach((q) => { if (q.bank) set.add(q.bank); });
  return Array.from(set);
}

function activeBank() {
  if (!state.currentBank) return [];
  return effectiveBank().filter((q) => (q.bank || "") === state.currentBank);
}

function categories() {
  const set = new Set();
  activeBank().forEach((q) => { if (q.category) set.add(q.category); });
  return Array.from(set).sort();
}

/* ---------- 判分 ---------- */
function multipleAnswerArr(a) {
  if (Array.isArray(a)) return a.map((x) => String(x).trim().toUpperCase());
  return String(a).replace(/[,，\s]/g, "").split("").map((x) => x.toUpperCase());
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  const A = a.slice().sort(), B = b.slice().sort();
  return A.every((v, i) => v === B[i]);
}

function gradeQuestion(q, userAnswer) {
  switch (q.type) {
    case "single":
      return String(userAnswer).toUpperCase() === String(q.answer).toUpperCase();
    case "multiple":
      return arraysEqual(multipleAnswerArr(userAnswer), multipleAnswerArr(q.answer));
    case "judge":
      return normalizeText(userAnswer) === normalizeText(q.answer);
    case "fill": {
      const accepted = String(q.answer).split(/[|｜;；]/).map(normalizeText);
      const u = normalizeText(userAnswer);
      return accepted.some((a) => a && (u === a || u.includes(a)));
    }
    case "short":
      return null; // 简答题人工判断
    default:
      return false;
  }
}

function answerDisplay(q) {
  if (q.type === "single" || q.type === "multiple") {
    const arr = multipleAnswerArr(q.answer);
    return arr.map((l) => {
      const idx = LETTERS.indexOf(l);
      const opt = q.options[idx];
      return opt ? l + ". " + opt : l;
    }).join(q.type === "multiple" ? "　" : "　");
  }
  return String(q.answer).replace(/[|｜;；]/g, " / ");
}

/* ---------- 记忆曲线 ---------- */
function remember(id) {
  const cur = state.sr[id] || { level: 0 };
  const newLevel = Math.min(cur.level + 1, 6);
  state.sr[id] = {
    level: newLevel,
    nextReview: Date.now() + INTERVALS[newLevel] * 86400000,
    lastReview: Date.now(),
  };
  saveState();
}

function forget(id) {
  state.sr[id] = { level: 0, nextReview: Date.now(), lastReview: Date.now() };
  saveState();
}

function dueIds() {
  const now = Date.now();
  return Object.keys(state.sr).filter((id) => state.sr[id].nextReview && state.sr[id].nextReview <= now);
}

/* ---------- 统计记录 ---------- */
function record(id, correct) {
  if (!state.stats[id]) state.stats[id] = { attempts: 0, correct: 0 };
  state.stats[id].attempts += 1;
  if (correct) state.stats[id].correct += 1;
  if (!correct) {
    state.wrong[id] = (state.wrong[id] || 0) + 1;
  } else {
    // 连续答对则从错题本移除
    delete state.wrong[id];
  }
  // 每日学习记录（用于统计趋势）
  const day = todayStr();
  if (!state.daily[day]) state.daily[day] = { attempts: 0, correct: 0 };
  state.daily[day].attempts += 1;
  if (correct) state.daily[day].correct += 1;
  saveState();
}

/* ============================================================
 * 导航
 * ============================================================ */
let currentView = "home";

function showStage(view) {
  currentView = view;
  $all(".view").forEach((v) => v.classList.remove("active"));
  $all(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  const el = $("#view-" + view);
  if (el) el.classList.add("active");
  window.scrollTo({ top: 0 });
}

function switchView(view) {
  showStage(view);
  renderView(view);
}

function renderView(view) {
  switch (view) {
    case "home": renderHome(); break;
    case "flashcard": renderFlashcardSetup(); break;
    case "practice": renderPracticeSetup(); break;
    case "review": renderReview(); break;
    case "wrong": renderWrong(); break;
    case "favorite": renderFavorite(); break;
    case "bank": renderBank(); break;
  }
}

/* ============================================================
 * 首页
 * ============================================================ */
function renderHome() {
  const bankList = banks();

  // ========== 选择题库界面（全屏） ==========
  if (!state.currentBank) {
    $("#bankSelector").innerHTML = `
      <div style="text-align:center;padding:8px 0 4px">
        <div style="font-size:34px">📚</div>
        <h2 style="margin:6px 0 2px;font-size:20px">选择题库</h2>
        <p class="muted">选择一个题库开始学习，各题库进度独立保存</p>
      </div>
      <div class="bank-list">${bankList.map((b) => `
        <button class="bank-btn" onclick="setCurrentBank('${esc(b)}')">
          <span class="bank-name">${esc(b)}</span>
          <span class="bank-count">${effectiveBank().filter((q) => q.bank === b).length} 题</span>
        </button>`).join("")}
      </div>`;

    // 断点续刷（跨题库列出未完成的练习）
    const sessions = state.sessions || {};
    const sessionKeys = Object.keys(sessions).filter((k) => sessions[k] && sessions[k].ids && sessions[k].ids.length);
    if (sessionKeys.length) {
      const cards = sessionKeys.map((k) => {
        const s = sessions[k];
        const label = s.mode === "practice" ? "刷题" : "背题";
        return `<div class="card" style="border-color:var(--warn);margin-bottom:10px">
          <div class="card-title">🔁 继续上次未完成的${label}</div>
          <p class="muted">${esc(k)} · 进行到第 ${(s.index || 0) + 1} 题</p>
          <div class="row">
            <button class="btn primary" style="flex:1" onclick="resumeSession('${esc(k)}')">继续做</button>
            <button class="btn ghost" onclick="clearSession('${esc(k)}');renderHome()">放弃</button>
          </div>
        </div>`;
      }).join("");
      $("#bankSelector").insertAdjacentHTML("beforeend", `<div class="card-title" style="margin-top:18px">🔁 继续上次未完成</div>` + cards);
    }

    $("#statGrid").innerHTML = "";
    $("#categoryProgress").innerHTML = "";
    $("#quickStartCard").style.display = "none";
    $("#statsCard").style.display = "none";
    return;
  }

  // ========== 题库专属界面 ==========
  $("#bankSelector").innerHTML = "";
  $("#quickStartCard").style.display = "";
  $("#statsCard").style.display = "";

  const bank = activeBank();
  const total = bank.length;
  const practiced = Object.keys(state.stats).filter((id) => state.stats[id].attempts > 0 && getQuestion(id)).length;
  let attempts = 0, correct = 0;
  Object.keys(state.stats).forEach((id) => {
    if (!getQuestion(id)) return;
    attempts += state.stats[id].attempts;
    correct += state.stats[id].correct;
  });
  const acc = attempts ? Math.round((correct / attempts) * 100) : 0;
  const due = dueIds().filter((id) => getQuestion(id)).length;
  const wrongCount = Object.keys(state.wrong).filter((id) => getQuestion(id)).length;
  const favCount = Object.keys(state.favorite).filter((id) => getQuestion(id)).length;

  $("#statGrid").innerHTML = `
    <div class="stat-card accent"><div class="num">${total}</div><div class="label">题目总数</div></div>
    <div class="stat-card"><div class="num">${practiced}</div><div class="label">已刷题数</div></div>
    <div class="stat-card green"><div class="num">${acc}%</div><div class="label">正确率</div></div>
    <div class="stat-card amber"><div class="num">${due}</div><div class="label">今日待复习</div></div>
    <div class="stat-card red"><div class="num">${wrongCount}</div><div class="label">错题</div></div>
    <div class="stat-card"><div class="num">${favCount}</div><div class="label">收藏</div></div>
  `;

  // 学习统计：最近 14 天趋势 + 各章节正确率
  const trendDays = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    trendDays.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"));
  }
  const maxAttempts = Math.max(1, ...trendDays.map((d) => (state.daily[d] || {}).attempts || 0));
  const trendHTML = `<div class="trend-chart">${trendDays.map((d) => {
    const a = (state.daily[d] || {}).attempts || 0;
    const c = (state.daily[d] || {}).correct || 0;
    const h = Math.round((a / maxAttempts) * 64);
    return `<div class="trend-col" title="${d} · 刷 ${a} 题 · 对 ${c} 题">
      <div class="trend-num">${a || ""}</div>
      <div class="trend-bar"><i style="height:${Math.max(h, a ? 3 : 1)}px"></i></div>
      <div class="trend-day">${d.slice(5).replace("-", "/")}</div>
    </div>`;
  }).join("")}</div>`;

  const byCat = {};
  bank.forEach((q) => { byCat[q.category || "未分类"] = (byCat[q.category || "未分类"] || 0) + 1; });
  const catStats = {};
  bank.forEach((q) => {
    const c = q.category || "未分类";
    if (!catStats[c]) catStats[c] = { attempts: 0, correct: 0 };
    const s = state.stats[q.id];
    if (s) { catStats[c].attempts += s.attempts; catStats[c].correct += s.correct; }
  });
  const chapterHTML = Object.keys(byCat).map((c) => {
    const total = byCat[c];
    const st = catStats[c] || { attempts: 0, correct: 0 };
    const pct = st.attempts ? Math.round((st.correct / st.attempts) * 100) : 0;
    return `<div class="progress-row">
      <div class="top"><span>${esc(c)}</span><span>正确率 ${pct}% · 已刷 ${st.attempts}/${total}</span></div>
      <div class="progress-bar"><i style="width:${pct}%"></i></div>
    </div>`;
  }).join("") || '<p class="muted">暂无题目，去题库添加或导入吧。</p>';

  $("#categoryProgress").innerHTML = `
    <div class="card-title" style="margin-top:2px">📈 最近 14 天学习趋势</div>
    ${trendHTML}
    <div class="card-title" style="margin-top:16px">📚 各章节正确率</div>
    ${chapterHTML}`;
}

function setCurrentBank(name) {
  state.currentBank = name;
  saveState();
  applyBankMode();
  switchView("home");
}

function exitToBankSelect() {
  state.currentBank = null;
  saveState();
  applyBankMode();
  switchView("home");
}

function applyBankMode() {
  const hasBank = !!state.currentBank;
  document.body.classList.toggle("no-bank", !hasBank);
  const btn = $("#btnBanks");
  if (btn) btn.style.display = hasBank ? "" : "none";
}

/* ---------- 断点续刷（保存/恢复当前练习进度） ---------- */
function persistSession() {
  if (!state.sessions) state.sessions = {};
  const bank = state.currentBank || "未分类";
  let s = null;
  if (currentView === "practice" && practice.list && practice.list.length) {
    s = {
      mode: "practice",
      bank: bank,
      ids: practice.list.map((q) => q.id),
      index: practice.index,
      answers: practice.answers,
      results: practice.results,
    };
  } else if (currentView === "flashcard" && flash.list && flash.list.length) {
    s = {
      mode: "flashcard",
      bank: bank,
      ids: flash.list.map((q) => q.id),
      index: flash.index,
    };
  }
  if (s) state.sessions[bank] = s;
  else delete state.sessions[bank];
  saveState();
}

function clearSession(bank) {
  const key = bank || state.currentBank;
  if (state.sessions) delete state.sessions[key];
  saveState();
}

function resumeSession(bank) {
  const key = bank || state.currentBank;
  const s = state.sessions && state.sessions[key];
  if (!s) return;
  if (s.bank && s.bank !== state.currentBank) {
    state.currentBank = s.bank;
    saveState();
  }
  if (s.mode === "practice") {
    practice = {
      list: (s.ids || []).map(getQuestion).filter(Boolean),
      index: Math.min(s.index || 0, (s.ids || []).length - 1),
      answers: (s.answers || []).map((a) => (a === null ? undefined : a)),
      results: (s.results || []).map((r) => (r === null ? undefined : r)),
    };
    if (!practice.list.length) { clearSession(key); return; }
    showStage("practice");
    $("#practiceSetup").classList.add("hidden");
    $("#practiceStage").classList.remove("hidden");
    renderPracticeQuestion();
  } else if (s.mode === "flashcard") {
    flash = {
      list: (s.ids || []).map(getQuestion).filter(Boolean),
      index: Math.min(s.index || 0, (s.ids || []).length - 1),
      flipped: false,
    };
    if (!flash.list.length) { clearSession(key); return; }
    showStage("flashcard");
    $("#flashcardSetup").classList.add("hidden");
    $("#flashcardStage").classList.remove("hidden");
    renderFlashcard();
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============================================================
 * 通用：模式设置面板
 * ============================================================ */
function setupPanelHTML(mode) {
  const cats = categories();
  const catOpts = ["全部"].concat(cats).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  const typeOpts = '<option value="all">全部题型</option>' +
    Object.keys(TYPES).map((t) => `<option value="${t}">${TYPES[t]}</option>`).join("");
  return `
    <div class="card">
      <div class="card-title">${mode === "flashcard" ? "🃏 背题设置" : "✍️ 刷题设置"}</div>
      <div class="field"><label>分类 / 章节</label><select id="${mode}Cat">${catOpts}</select></div>
      <div class="field"><label>题型</label><select id="${mode}Type">${typeOpts}</select></div>
      <div class="field"><label>范围</label>
        <div class="chip-row" id="${mode}Scope">
          <button class="chip active" data-scope="all">全部</button>
          <button class="chip" data-scope="wrong">错题</button>
          <button class="chip" data-scope="favorite">收藏</button>
          <button class="chip" data-scope="new">未掌握</button>
        </div>
      </div>
      <div class="field"><label>顺序</label>
        <div class="chip-row" id="${mode}Order">
          <button class="chip active" data-order="seq">顺序</button>
          <button class="chip" data-order="rand">随机</button>
        </div>
      </div>
      <div class="field"><label>每次数量（0 = 全部）</label><input id="${mode}Count" type="number" min="0" value="0" /></div>
      <button class="btn primary" style="width:100%;padding:13px" id="${mode}Start">开始</button>
    </div>`;
}

function collectSetup(mode) {
  const cat = $("#" + mode + "Cat").value;
  const type = $("#" + mode + "Type").value;
  const scope = $all("#" + mode + "Scope .chip.active")[0].dataset.scope;
  const order = $all("#" + mode + "Order .chip.active")[0].dataset.order;
  const count = parseInt($("#" + mode + "Count").value, 10) || 0;
  return { cat, type, scope, order, count };
}

function filterBank(setup) {
  let list = activeBank();
  if (setup.cat !== "全部") list = list.filter((q) => q.category === setup.cat);
  if (setup.type !== "all") list = list.filter((q) => q.type === setup.type);
  if (setup.scope === "wrong") list = list.filter((q) => state.wrong[q.id]);
  if (setup.scope === "favorite") list = list.filter((q) => state.favorite[q.id]);
  if (setup.scope === "new") list = list.filter((q) => !state.sr[q.id] || state.sr[q.id].level < 2);
  if (setup.order === "rand") list = shuffle(list);
  if (setup.count > 0) list = list.slice(0, setup.count);
  return list;
}

/* ============================================================
 * 背题模式（翻卡）
 * ============================================================ */
let flash = { list: [], index: 0, flipped: false };

function renderFlashcardSetup() {
  flash = { list: [], index: 0, flipped: false };
  $("#flashcardSetup").classList.remove("hidden");
  $("#flashcardStage").classList.add("hidden");
  $("#flashcardSetup").innerHTML = setupPanelHTML("flashcard");
  bindChips("flashcard");
  $("#flashcardStart").onclick = () => {
    const list = filterBank(collectSetup("flashcard"));
    if (!list.length) { toast("没有符合条件的题目"); return; }
    flash.list = list; flash.index = 0;
    $("#flashcardSetup").classList.add("hidden");
    $("#flashcardStage").classList.remove("hidden");
    renderFlashcard();
  };
}

function renderFlashcard() {
  persistSession();
  const q = flash.list[flash.index];
  const total = flash.list.length;
  const idx = flash.index + 1;
  const typeName = TYPES[q.type] || q.type;
  $("#flashcardStage").innerHTML = `
    <div class="flash-top">
      <span>${idx} / ${total}</span>
      <span>${typeName}</span>
      <span class="muted">点击卡片翻面</span>
    </div>
    <div class="flip-card" id="flipCard" onclick="toggleFlip()">
      <div class="flip-inner">
        <div class="flip-face front">
          <span class="flip-type">${esc(typeName)}${q.category ? " · " + esc(q.category) : ""}</span>
          <div class="flip-question">${esc(q.question)}</div>
          ${q.type === "single" || q.type === "multiple" ? '<div class="flip-options">' + (q.options || []).map((o, i) => `<div class="opt-line">${letter(i)}. ${esc(o)}</div>`).join("") + '</div>' : ""}
          <span class="flip-hint">👆 点击翻面看答案</span>
        </div>
        <div class="flip-face back">
          <span class="flip-type">答案</span>
          <div class="flip-answer">${esc(answerDisplay(q))}</div>
          ${q.explanation ? '<div class="flip-explain">💡 ' + esc(q.explanation) + "</div>" : ""}
          <span class="flip-hint">🔊 <a href="javascript:void(0)" onclick="event.stopPropagation();speakCurrent()">朗读答案</a></span>
        </div>
      </div>
    </div>
    <div class="flash-actions">
      <button class="btn btn-forgot" onclick="flashAnswer(false)">😅 没记住</button>
      <button class="btn btn-remember" onclick="flashAnswer(true)">✅ 记住了</button>
    </div>
    <div class="flash-nav">
      <button class="btn" onclick="flashMove(-1)">← 上一题</button>
      <button class="btn" onclick="flashMove(1)">下一题 →</button>
    </div>`;
  flash.flipped = false;
  if (state.tts) speak(q.question);
}

function toggleFlip() {
  flash.flipped = !flash.flipped;
  $("#flipCard").classList.toggle("flipped", flash.flipped);
}

function speakCurrent() {
  const q = flash.list[flash.index];
  speak(q.question + "，答案，" + answerDisplay(q));
}

function flashAnswer(ok) {
  const q = flash.list[flash.index];
  if (ok) remember(q.id); else forget(q.id);
  record(q.id, ok);
  toast(ok ? "已记入复习计划" : "已标记为需复习");
  flashMove(1);
}

function flashMove(d) {
  flash.index += d;
  if (flash.index >= flash.list.length) {
    flash.index = flash.list.length - 1;
    toast("🎉 本轮背完啦！");
    renderFlashcard();
    return;
  }
  if (flash.index < 0) flash.index = 0;
  renderFlashcard();
}

/* ============================================================
 * 刷题模式
 * ============================================================ */
let practice = { list: [], index: 0, answers: [], results: [], done: false };

function renderPracticeSetup() {
  practice = { list: [], index: 0, answers: [], results: [], done: false };
  $("#practiceSetup").classList.remove("hidden");
  $("#practiceStage").classList.add("hidden");
  $("#practiceSetup").innerHTML = setupPanelHTML("practice");
  bindChips("practice");
  $("#practiceStart").onclick = () => {
    const list = filterBank(collectSetup("practice"));
    if (!list.length) { toast("没有符合条件的题目"); return; }
    practice.list = list;
    practice.index = 0;
    practice.answers = new Array(list.length).fill(undefined);
    practice.results = new Array(list.length).fill(undefined);
    $("#practiceSetup").classList.add("hidden");
    $("#practiceStage").classList.remove("hidden");
    renderPracticeQuestion();
  };
}

function renderPracticeQuestion() {
  persistSession();
  const q = practice.list[practice.index];
  const total = practice.list.length;
  const idx = practice.index + 1;
  const result = practice.results[practice.index];
  const answered = result !== undefined;
  let body = "";

  if (q.type === "single" || q.type === "judge") {
    const opts = q.type === "judge" && (!q.options || !q.options.length) ? ["正确", "错误"] : (q.options || []);
    body = opts.map((o, i) => {
      const ans = practice.answers[practice.index];
      const sel = q.type === "judge" ? (ans === o) : (ans === String(letter(i)));
      let cls = "option" + (sel ? " selected" : "");
      if (answered) {
        const correctOpt = gradeOptionLetter(q, i);
        if (correctOpt) cls += " correct";
        else if (sel) cls += " wrong";
      }
      return `<div class="${cls}" onclick="pickOption(${i})"><span class="letter">${letter(i)}</span><span>${esc(o)}</span></div>`;
    }).join("");
  } else if (q.type === "multiple") {
    body = (q.options || []).map((o, i) => {
      const cur = practice.answers[practice.index] || [];
      const sel = cur.includes(String(letter(i)));
      let cls = "option" + (sel ? " selected" : "");
      if (answered) {
        const correctOpt = multipleAnswerArr(q.answer).includes(String(letter(i)));
        if (correctOpt) cls += " correct";
        else if (sel) cls += " wrong";
      }
      return `<div class="${cls}" onclick="pickMulti(${i})"><span class="letter">${letter(i)}</span><span>${esc(o)}</span></div>`;
    }).join("");
  } else {
    // 填空 / 简答
    const val = practice.answers[practice.index] || "";
    body = `<input class="fill-input" id="fillInput" type="text" value="${esc(val)}" placeholder="请输入你的答案" ${answered ? "disabled" : ""} oninput="practice.answers[practice.index]=this.value" />`;
  }

  let resultBox = "";
  if (answered) {
    if (result === "pending") {
      resultBox = `<div class="result-box"><div>参考答案：<strong>${esc(answerDisplay(q))}</strong></div>${q.explanation ? '<div class="explain">💡 ' + esc(q.explanation) + "</div>" : ""}</div>`;
    } else if (result === true) {
      resultBox = `<div class="result-box ok">✅ 回答正确${q.explanation ? '<div class="explain">💡 ' + esc(q.explanation) + "</div>" : ""}</div>`;
    } else {
      resultBox = `<div class="result-box no">❌ 回答错误，正确答案：<strong>${esc(answerDisplay(q))}</strong>${q.explanation ? '<div class="explain">💡 ' + esc(q.explanation) + "</div>" : ""}</div>`;
    }
  }

  $("#practiceStage").innerHTML = `
    <div class="practice-top"><span>第 ${idx} / ${total} 题</span><span>${TYPES[q.type]}</span></div>
    <div class="card practice-card">
      ${q.category ? '<div class="muted" style="margin-bottom:6px">' + esc(q.category) + "</div>" : ""}
      <div class="practice-question">${esc(q.question)}</div>
      ${body}
      ${resultBox}
      <div class="practice-actions">
        ${!answered ? `<button class="btn primary" onclick="submitAnswer()">提交答案</button>` :
          result === "pending"
            ? `<button class="btn success" onclick="selfGrade(true)">我答对了</button><button class="btn danger" onclick="selfGrade(false)">我答错了</button>`
            : `<button class="btn primary" onclick="nextQuestion()">${practice.index + 1 < practice.list.length ? "下一题 →" : "查看成绩"}</button>`}
      </div>
    </div>`;

  if (q.type === "fill" || q.type === "short") {
    const inp = $("#fillInput");
    if (inp && !answered) inp.focus();
  }
  if (state.tts && !answered) speak(q.question);
}

function gradeOptionLetter(q, i) {
  if (q.type === "single") return String(letter(i)) === String(q.answer).toUpperCase();
  if (q.type === "judge") {
    const opts = (!q.options || !q.options.length) ? ["正确", "错误"] : q.options;
    return normalizeText(opts[i]) === normalizeText(q.answer);
  }
  return false;
}

function pickOption(i) {
  if (practice.results[practice.index] !== undefined) return;
  const q = practice.list[practice.index];
  if (q.type === "judge") {
    const opts = (!q.options || !q.options.length) ? ["正确", "错误"] : q.options;
    practice.answers[practice.index] = opts[i];
  } else {
    practice.answers[practice.index] = String(letter(i));
  }
  renderPracticeQuestion();
}

function pickMulti(i) {
  if (practice.results[practice.index] !== undefined) return;
  let cur = practice.answers[practice.index] || [];
  const l = String(letter(i));
  cur = cur.includes(l) ? cur.filter((x) => x !== l) : cur.concat(l);
  practice.answers[practice.index] = cur;
  renderPracticeQuestion();
}

function submitAnswer() {
  const q = practice.list[practice.index];
  const a = practice.answers[practice.index];
  if (a === undefined || a === "" || (Array.isArray(a) && !a.length)) {
    toast("请先作答");
    return;
  }
  const r = gradeQuestion(q, a);
  if (r === null) {
    // 简答：显示参考答案，人工判分
    practice.results[practice.index] = "pending";
    practice.answers[practice.index] = a;
    renderPracticeQuestion();
    return;
  }
  practice.results[practice.index] = r;
  record(q.id, r);
  renderPracticeQuestion();
}

function selfGrade(ok) {
  const q = practice.list[practice.index];
  practice.results[practice.index] = ok;
  record(q.id, ok);
  renderPracticeQuestion();
}

function nextQuestion() {
  practice.index += 1;
  if (practice.index >= practice.list.length) {
    renderPracticeSummary();
  } else {
    renderPracticeQuestion();
  }
}

function renderPracticeSummary() {
  clearSession();
  const total = practice.list.length;
  const correct = practice.results.filter((r) => r === true).length;
  const wrongList = practice.list.filter((q, i) => practice.results[i] === false);
  $("#practiceStage").innerHTML = `
    <div class="card score-circle">
      <div class="sub">本轮成绩</div>
      <div class="big">${correct} / ${total}</div>
      <div class="sub">正确率 ${total ? Math.round((correct / total) * 100) : 0}%</div>
      <div style="margin-top:14px">
        <button class="btn primary" onclick="switchView('practice')">再来一轮</button>
      </div>
    </div>
    ${wrongList.length ? `
    <div class="card">
      <div class="card-title">本轮错题（已自动加入错题本）</div>
      <div class="result-list">${wrongList.map((q) => `
        <div class="result-item">
          <div class="rq"><span class="tag" style="background:var(--danger-soft);color:var(--danger)">${TYPES[q.type]}</span>${esc(q.question)}</div>
          <div class="muted">正确答案：${esc(answerDisplay(q))}</div>
        </div>`).join("")}
      </div>
    </div>` : '<div class="card"><div class="card-title">🎉 全部答对，太棒了！</div></div>'}
  `;
}

/* ============================================================
 * 复习（记忆曲线）
 * ============================================================ */
function renderReview() {
  const ids = dueIds();
  const list = ids.map(getQuestion).filter(Boolean);
  if (!list.length) {
    $("#reviewStage").innerHTML = `
      <div class="card" style="text-align:center;padding:40px 20px">
        <div style="font-size:40px">🎉</div>
        <div class="card-title" style="margin-top:10px">今天没有需要复习的题目</div>
        <p class="muted">先去背题或刷题，系统会按记忆曲线自动安排复习。</p>
        <button class="btn primary" onclick="switchView('flashcard')">去背题</button>
      </div>`;
    return;
  }
  $("#reviewStage").innerHTML = `
    <div class="card">
      <div class="list-head">
        <div class="card-title" style="margin:0">🧠 今日复习（${list.length} 题）</div>
      </div>
      <p class="muted">根据艾宾浩斯记忆曲线安排，答对会延长下次复习间隔，答错会提前复习。</p>
      <button class="btn primary" style="width:100%" onclick="startReview()">开始复习</button>
    </div>
    <div class="card">
      <div class="card-title">待复习题目</div>
      ${list.map((q) => `
        <div class="list-item">
          <div class="li-meta">${TYPES[q.type]} · ${esc(q.category || "未分类")}</div>
          <div class="li-q">${esc(q.question)}</div>
        </div>`).join("")}
    </div>`;
}

let reviewSession = { list: [], index: 0, revealed: false };

function startReview() {
  const ids = dueIds();
  reviewSession.list = shuffle(ids.map(getQuestion).filter(Boolean));
  reviewSession.index = 0;
  renderReviewCard();
}

function renderReviewCard() {
  const q = reviewSession.list[reviewSession.index];
  const idx = reviewSession.index + 1;
  reviewSession.revealed = false;
  $("#reviewStage").innerHTML = `
    <div class="flash-top"><span>${idx} / ${reviewSession.list.length}</span><span>今日复习</span><span class="muted">先回忆，再翻面</span></div>
    <div class="flip-card" id="flipCard" onclick="revealReview()">
      <div class="flip-inner">
        <div class="flip-face front">
          <span class="flip-type">${TYPES[q.type]}</span>
          <div class="flip-question">${esc(q.question)}</div>
          ${q.type === "single" || q.type === "multiple" ? '<div class="flip-options">' + (q.options || []).map((o, i) => `<div class="opt-line">${letter(i)}. ${esc(o)}</div>`).join("") + '</div>' : ""}
          <span class="flip-hint">👆 点击看答案</span>
        </div>
        <div class="flip-face back">
          <span class="flip-type">答案</span>
          <div class="flip-answer">${esc(answerDisplay(q))}</div>
          ${q.explanation ? '<div class="flip-explain">💡 ' + esc(q.explanation) + "</div>" : ""}
        </div>
      </div>
    </div>
    <div class="flash-actions">
      <button class="btn btn-forgot" onclick="reviewAnswer(false)">😅 忘了</button>
      <button class="btn btn-remember" onclick="reviewAnswer(true)">✅ 记得</button>
    </div>`;
}

function revealReview() {
  if (reviewSession.revealed) return;
  reviewSession.revealed = true;
  $("#flipCard").classList.add("flipped");
}

function reviewAnswer(ok) {
  const q = reviewSession.list[reviewSession.index];
  if (ok) remember(q.id); else forget(q.id);
  reviewSession.index += 1;
  if (reviewSession.index >= reviewSession.list.length) {
    toast("🎉 今日复习完成！");
    renderReview();
  } else {
    renderReviewCard();
  }
}

/* ============================================================
 * 错题本
 * ============================================================ */
function renderWrong() {
  const list = Object.keys(state.wrong).map(getQuestion).filter(Boolean);
  if (!list.length) {
    $("#wrongStage").innerHTML = emptyHTML("❌", "暂无错题", "刷题时答错的题目会自动收集到这里。", "practice");
    return;
  }
  $("#wrongStage").innerHTML = `
    <div class="card">
      <div class="list-head">
        <div class="card-title" style="margin:0">❌ 错题本（${list.length} 题）</div>
      </div>
      <div class="quick-actions">
        <button class="quick-btn" onclick="practiceWrong()">✍️ 刷错题</button>
        <button class="quick-btn" onclick="flashcardWrong()">🃏 背错题</button>
        <button class="btn danger" style="width:100%;margin-top:8px" onclick="clearWrong()">清空错题本</button>
      </div>
    </div>
    ${list.map((q) => listItemHTML(q)).join("")}`;
}

function listItemHTML(q) {
  return `<div class="list-item">
    <div class="li-meta">${TYPES[q.type]} · ${esc(q.category || "未分类")}${q.tags && q.tags.length ? " · " + esc(q.tags.join("/")) : ""}</div>
    <div class="li-q">${esc(q.question)}</div>
    <div class="li-answer">答案：${esc(answerDisplay(q))}</div>
    <div class="li-actions">
      <button class="btn" onclick="toggleFavorite('${q.id}')">${state.favorite[q.id] ? "★ 取消收藏" : "☆ 收藏"}</button>
      <button class="btn" onclick="removeWrong('${q.id}')">移出错题本</button>
    </div>
  </div>`;
}

function practiceWrong() {
  const list = Object.keys(state.wrong).map(getQuestion).filter(Boolean);
  if (!list.length) { toast("暂无错题"); return; }
  practice = { list, index: 0, answers: new Array(list.length).fill(undefined), results: new Array(list.length).fill(undefined) };
  showStage("practice");
  $("#practiceSetup").classList.add("hidden");
  $("#practiceStage").classList.remove("hidden");
  renderPracticeQuestion();
}

function flashcardWrong() {
  const list = Object.keys(state.wrong).map(getQuestion).filter(Boolean);
  if (!list.length) { toast("暂无错题"); return; }
  flash = { list, index: 0, flipped: false };
  showStage("flashcard");
  $("#flashcardSetup").classList.add("hidden");
  $("#flashcardStage").classList.remove("hidden");
  renderFlashcard();
}

function removeWrong(id) {
  delete state.wrong[id];
  saveState();
  renderWrong();
}

function clearWrong() {
  if (!confirm("确定清空所有错题吗？")) return;
  state.wrong = {};
  saveState();
  renderWrong();
}

/* ============================================================
 * 收藏
 * ============================================================ */
function toggleFavorite(id) {
  if (state.favorite[id]) delete state.favorite[id];
  else state.favorite[id] = true;
  saveState();
  toast(state.favorite[id] ? "已收藏" : "已取消收藏");
  if (currentView === "favorite") renderFavorite();
  if (currentView === "wrong") renderWrong();
  if (currentView === "bank") renderBankList();
}

function renderFavorite() {
  const list = Object.keys(state.favorite).map(getQuestion).filter(Boolean);
  if (!list.length) {
    $("#favoriteStage").innerHTML = emptyHTML("⭐", "暂无收藏", "在错题本或题库里点击“收藏”即可加入。", "bank");
    return;
  }
  $("#favoriteStage").innerHTML = `
    <div class="card">
      <div class="list-head"><div class="card-title" style="margin:0">⭐ 收藏（${list.length} 题）</div></div>
      <div class="quick-actions">
        <button class="quick-btn" onclick="practiceFavorite()">✍️ 刷收藏题</button>
        <button class="quick-btn" onclick="flashcardFavorite()">🃏 背收藏题</button>
      </div>
    </div>
    ${list.map((q) => listItemHTML(q)).join("")}`;
}

function practiceFavorite() {
  const list = Object.keys(state.favorite).map(getQuestion).filter(Boolean);
  if (!list.length) { toast("暂无收藏"); return; }
  practice = { list, index: 0, answers: new Array(list.length).fill(undefined), results: new Array(list.length).fill(undefined) };
  showStage("practice");
  $("#practiceSetup").classList.add("hidden");
  $("#practiceStage").classList.remove("hidden");
  renderPracticeQuestion();
}

function flashcardFavorite() {
  const list = Object.keys(state.favorite).map(getQuestion).filter(Boolean);
  if (!list.length) { toast("暂无收藏"); return; }
  flash = { list, index: 0, flipped: false };
  showStage("flashcard");
  $("#flashcardSetup").classList.add("hidden");
  $("#flashcardStage").classList.remove("hidden");
  renderFlashcard();
}

/* ============================================================
 * 题库管理
 * ============================================================ */
function renderBank() {
  const cats = categories();
  $("#bankStage").innerHTML = `
    <div class="card">
      <div class="bank-toolbar">
        <input id="bankSearch" type="text" placeholder="🔍 搜索题目..." oninput="renderBankList()" />
        <select id="bankCat" onchange="renderBankList()"><option value="all">全部分类</option>${cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select>
        <select id="bankType" onchange="renderBankList()"><option value="all">全部题型</option>${Object.keys(TYPES).map((t) => `<option value="${t}">${TYPES[t]}</option>`).join("")}</select>
      </div>
      <button class="btn primary" style="width:100%" onclick="openAddQuestion()">＋ 添加题目</button>
    </div>
    <div id="bankList"></div>`;
  renderBankList();
}

function renderBankList() {
  const kw = normalizeText($("#bankSearch") ? $("#bankSearch").value : "");
  const cat = $("#bankCat") ? $("#bankCat").value : "all";
  const type = $("#bankType") ? $("#bankType").value : "all";
  let list = activeBank();
  if (cat !== "all") list = list.filter((q) => q.category === cat);
  if (type !== "all") list = list.filter((q) => q.type === type);
  if (kw) list = list.filter((q) => normalizeText(q.question + " " + (q.category || "") + " " + (q.tags || []).join(" ")).includes(kw));

  $("#bankList").innerHTML = list.length
    ? list.map((q) => `
      <div class="list-item">
        <div class="li-meta">${TYPES[q.type]} · ${esc(q.category || "未分类")}${state.favorite[q.id] ? " · ★已收藏" : ""}</div>
        <div class="li-q">${esc(q.question)}</div>
        <div class="li-answer">答案：${esc(answerDisplay(q))}</div>
        <div class="li-actions">
          <button class="btn" onclick="toggleFavorite('${q.id}')">${state.favorite[q.id] ? "★ 取消收藏" : "☆ 收藏"}</button>
          <button class="btn" onclick="openEditQuestion('${q.id}')">编辑</button>
          <button class="btn danger" onclick="deleteQuestion('${q.id}')">删除</button>
        </div>
      </div>`).join("")
    : '<div class="card" style="text-align:center"><p class="muted">没有符合条件的题目</p></div>';
}

function deleteQuestion(id) {
  if (!confirm("确定删除这道题吗？")) return;
  state.deletedIds.push(id);
  state.customQuestions = state.customQuestions.filter((q) => q.id !== id);
  saveState();
  toast("已删除");
  renderBank();
}

/* ============================================================
 * 添加/编辑题目
 * ============================================================ */
let editingId = null;

function openAddQuestion() {
  editingId = null;
  $("#qModalTitle").textContent = "添加题目";
  $("#qType").value = "single";
  $("#qCategory").value = "";
  $("#qTags").value = "";
  $("#qQuestion").value = "";
  $("#qOptions").value = "";
  $("#qAnswer").value = "";
  $("#qExplanation").value = "";
  $("#qDifficulty").value = 3;
  $("#diffVal").textContent = "3";
  updateAnswerHint();
  showModal("modal-question");
}

function openEditQuestion(id) {
  const q = getQuestion(id);
  if (!q) return;
  editingId = id;
  $("#qModalTitle").textContent = "编辑题目";
  $("#qType").value = q.type;
  $("#qCategory").value = q.category || "";
  $("#qTags").value = (q.tags || []).join(", ");
  $("#qQuestion").value = q.question || "";
  $("#qOptions").value = (q.options || []).join("\n");
  $("#qAnswer").value = Array.isArray(q.answer) ? q.answer.join("") : (q.answer || "");
  $("#qExplanation").value = q.explanation || "";
  $("#qDifficulty").value = q.difficulty || 3;
  $("#diffVal").textContent = q.difficulty || 3;
  updateAnswerHint();
  showModal("modal-question");
}

function updateAnswerHint() {
  const t = $("#qType").value;
  const map = {
    single: "答案：填选项字母，如 A",
    multiple: "答案：填多个字母，如 AC（或 A,C）",
    judge: "答案：填 正确 或 错误",
    fill: "答案：填文字，多个可接受答案用 | 分隔",
    short: "答案：填参考答案文字",
  };
  $("#qAnswerLabel").textContent = map[t];
  const needOptions = t === "single" || t === "multiple";
  $("#qOptionsWrap").style.display = needOptions ? "" : "none";
}

function saveQuestion() {
  const type = $("#qType").value;
  const category = $("#qCategory").value.trim();
  const tags = $("#qTags").value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
  const question = $("#qQuestion").value.trim();
  const options = $("#qOptions").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const answerRaw = $("#qAnswer").value.trim();
  const explanation = $("#qExplanation").value.trim();
  const difficulty = parseInt($("#qDifficulty").value, 10);

  if (!question) { toast("请填写题干"); return; }
  if ((type === "single" || type === "multiple") && options.length < 2) { toast("请至少填写 2 个选项"); return; }
  if (!answerRaw) { toast("请填写答案"); return; }

  let answer = answerRaw;
  if (type === "multiple") answer = multipleAnswerArr(answerRaw);

  const existing = editingId ? effectiveBank().find((x) => x.id === editingId) : null;
  const bank = (existing && existing.bank) || state.currentBank || (banks()[0] || "未分类");

  const q = {
    id: editingId || uid(),
    bank, type, category, tags, question, options, answer, explanation, difficulty,
  };

  // 更新 customQuestions
  state.customQuestions = state.customQuestions.filter((x) => x.id !== q.id);
  state.customQuestions.push(q);
  saveState();
  hideModal("modal-question");
  toast(editingId ? "已保存修改" : "已添加题目");
  renderBank();
}

/* ============================================================
 * 导入 / 导出
 * ============================================================ */
function parseQuestions(obj) {
  const arr = Array.isArray(obj) ? obj : (obj.QUESTION_BANK || obj.questions || []);
  return arr.filter((q) => q && q.question);
}

function exportJson() {
  const data = activeBank();
  const blob = new Blob([JSON.stringify({ SITE_CONFIG: window.SITE_CONFIG, QUESTION_BANK: data }, null, 2)], { type: "application/json" });
  downloadBlob(blob, "题库备份_" + todayStr() + ".json");
  toast("已导出 JSON");
}

function exportCsv() {
  const data = activeBank();
  const head = ["题型", "分类", "题干", "选项", "答案", "解析", "标签"];
  const rows = data.map((q) => [
    q.type || "",
    (q.category || ""),
    (q.question || ""),
    (q.options || []).join("||"),
    Array.isArray(q.answer) ? q.answer.join("") : (q.answer || ""),
    (q.explanation || ""),
    (q.tags || []).join(" "),
  ]);
  const csv = [head, ...rows].map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, "题库备份_" + todayStr() + ".csv");
  toast("已导出 CSV");
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = reader.result;
      let arr = [];
      if (/\.json$/i.test(file.name)) {
        arr = parseQuestions(JSON.parse(text));
      } else {
        arr = parseCsv(text);
      }
      if (!arr.length) { toast("未解析到题目"); return; }
      // 给每条题目生成新 id，避免覆盖
      const imported = arr.map((q, i) => {
        const nq = Object.assign({}, q);
        nq.id = "imp" + Date.now().toString(36) + i;
        if (!nq.bank) nq.bank = state.currentBank || (banks()[0] || "未分类");
        if (Array.isArray(nq.answer) === false && (nq.type === "multiple")) nq.answer = multipleAnswerArr(nq.answer);
        return nq;
      });
      state.customQuestions = state.customQuestions.concat(imported);
      saveState();
      toast("成功导入 " + imported.length + " 道题");
      renderBank();
    } catch (e) {
      toast("导入失败：文件格式错误");
      console.error(e);
    }
  };
  reader.readAsText(file);
}

function parseCsv(text) {
  // 简易 CSV 解析（支持引号）
  const lines = [];
  let cur = "", inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === "\n") { lines.push(cur); cur = ""; }
      else if (ch === "\r") { /* skip */ }
      else cur += ch;
    }
  }
  if (cur) lines.push(cur);

  const split = (line) => {
    const res = []; let c = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"') {
          if (line[i + 1] === '"') { c += '"'; i++; } else q = false;
        } else c += ch;
      } else {
        if (ch === '"') q = true;
        else if (ch === ",") { res.push(c); c = ""; }
        else c += ch;
      }
    }
    res.push(c);
    return res;
  };

  const rows = lines.map(split);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  const idx = (name) => header.findIndex((h) => h.includes(name));
  const iType = idx("题型"), iCat = idx("分类"), iQ = idx("题干"), iOpt = idx("选项"), iAns = idx("答案"), iExp = idx("解析"), iTag = idx("标签");

  return rows.slice(1).filter((r) => r[iQ] && r[iQ].trim()).map((r) => {
    const type = (r[iType] || "single").trim();
    const options = (r[iOpt] || "").split("||").map((s) => s.trim()).filter(Boolean);
    return {
      type: TYPES[type] ? type : "single",
      category: (r[iCat] || "").trim(),
      question: r[iQ].trim(),
      options: options,
      answer: (r[iAns] || "").trim(),
      explanation: (r[iExp] || "").trim(),
      tags: (r[iTag] || "").split(/\s+/).filter(Boolean),
    };
  });
}

/* ============================================================
 * 弹窗 / 主题 / TTS
 * ============================================================ */
function showModal(id) { $("#" + id).classList.add("show"); }
function hideModal(id) { $("#" + id).classList.remove("show"); }

function emptyHTML(icon, title, desc, gotoView) {
  return `<div class="card" style="text-align:center;padding:40px 20px">
    <div style="font-size:40px">${icon}</div>
    <div class="card-title" style="margin-top:10px">${title}</div>
    <p class="muted">${desc}</p>
    <button class="btn primary" onclick="switchView('${gotoView}')">去看看</button>
  </div>`;
}

const THEMES = [
  { key: "light", label: "默认", color: "#f5f6fa" },
  { key: "white", label: "纯白", color: "#ffffff" },
  { key: "beige", label: "米黄", color: "#f6f1e4" },
  { key: "green", label: "浅绿", color: "#eaf4ea" },
  { key: "blue",  label: "浅蓝", color: "#eaf1fc" },
  { key: "pink",  label: "浅粉", color: "#fbeff4" },
  { key: "dark",  label: "夜间", color: "#12141c" },
];

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme || "light");
  $("#btnTheme").textContent = state.theme === "dark" ? "☀️" : "🌙";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = state.theme === "dark" ? "#12141c" : "#4f6ef7";
  renderThemeSwatches();
}

function setTheme(key) {
  state.theme = key;
  saveState();
  applyTheme();
  toast("已切换背景颜色");
}

function toggleTheme() {
  setTheme(state.theme === "dark" ? "light" : "dark");
}

function renderThemeSwatches() {
  const el = $("#themeSwatches");
  if (!el) return;
  el.innerHTML = THEMES.map((t) => `
    <button class="swatch ${state.theme === t.key ? "active" : ""}" onclick="setTheme('${t.key}')">
      <span class="dot" style="background:${t.color}"></span>
      <span>${t.label}</span>
    </button>`).join("");
}

function toggleTts() {
  state.tts = !state.tts;
  saveState();
  $("#btnSpeak").textContent = state.tts ? "🔊" : "🔇";
  toast(state.tts ? "已开启语音朗读" : "已关闭语音朗读");
  if (state.tts) speak("语音朗读已开启");
}

/* ============================================================
 * 事件绑定 & 初始化
 * ============================================================ */
function bindChips(mode) {
  $all("#" + mode + "Scope .chip").forEach((c) => c.onclick = () => {
    $all("#" + mode + "Scope .chip").forEach((x) => x.classList.remove("active"));
    c.classList.add("active");
  });
  $all("#" + mode + "Order .chip").forEach((c) => c.onclick = () => {
    $all("#" + mode + "Order .chip").forEach((x) => x.classList.remove("active"));
    c.classList.add("active");
  });
}

function init() {
  // 站点信息
  const cfg = window.SITE_CONFIG || {};
  if (cfg.siteName) {
    $("#siteName").textContent = cfg.siteName;
    document.title = cfg.siteName;
  }
  if (cfg.subtitle) $("#siteSubtitle").textContent = cfg.subtitle;

  applyTheme();
  applyBankMode();
  $("#btnSpeak").textContent = state.tts ? "🔊" : "🔇";

  // 顶部按钮
  $("#btnBanks").onclick = exitToBankSelect;
  $("#btnTheme").onclick = toggleTheme;
  $("#btnSpeak").onclick = toggleTts;
  $("#btnData").onclick = () => {
    $("#dataTotal").textContent = activeBank().length;
    showModal("modal-data");
  };

  // 导航
  $all(".tab").forEach((t) => t.onclick = () => switchView(t.dataset.view));

  // 快速开始按钮
  $all(".quick-btn[data-goto]").forEach((b) => b.onclick = () => switchView(b.dataset.goto));

  // 弹窗关闭
  $all("[data-close]").forEach((b) => b.onclick = () => hideModal(b.dataset.close));
  $all(".modal").forEach((m) => m.addEventListener("click", (e) => {
    if (e.target === m) m.classList.remove("show");
  }));

  // 题目表单
  $("#qType").onchange = updateAnswerHint;
  $("#qDifficulty").oninput = (e) => { $("#diffVal").textContent = e.target.value; };
  $("#qSave").onclick = saveQuestion;

  // 数据弹窗
  $("#btnAddQuestion").onclick = () => { hideModal("modal-data"); openAddQuestion(); };
  $("#exportJson").onclick = exportJson;
  $("#exportCsv").onclick = exportCsv;
  $("#importFile").onchange = (e) => {
    if (e.target.files[0]) handleImportFile(e.target.files[0]);
  };

  switchView("home");
}

document.addEventListener("DOMContentLoaded", init);
