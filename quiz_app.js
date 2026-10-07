/* 中级经济师精品课 · 刷题题库
   数据：data/quiz-basic.js / data/quiz-hr.js（build_quiz_data.py 生成，全局变量注入）
   进度：localStorage 'rljpk_quiz_v1'；云同步：同仓库 quiz.json（复用 rljpk_sync 配置，GitHub 后端）
   入口参数：?tab=mix|real|random|wrong|stats  ?ch=基础-14  ?paper=Pxxxx  ?mode=practice|recite|exam  ?n=20 */
(function () {
  'use strict';
  var QKEY = 'rljpk_quiz_v1';
  var LETTERS = 'ABCDEFG';
  var STREAK_GRAD = 4;                 // 连续答对 4 次毕业
  var BOX_DAYS = [0, 1, 3, 7];         // 间隔重复 0/1/3/7 天

  /* ---------- 存储层 ---------- */
  function loadStore() {
    try { var d = JSON.parse(localStorage.getItem(QKEY)); if (d && d.a) return d; } catch (e) {}
    return { a: {}, w: {}, f: {}, e: [] };
  }
  var store = loadStore();
  var saveTimer = null;
  function saveStore() {
    localStorage.setItem(QKEY, JSON.stringify(store));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { quizPush(); }, 3000);
  }

  /* ---------- 数据层 ---------- */
  var loaded = {};
  function ensureSubject(subj, cb) {
    if (window.QUIZ_DB && window.QUIZ_DB[subj]) { loaded[subj] = true; cb(); return; }
    if (loaded[subj]) return;          // 加载中
    loaded[subj] = true;
    var s = document.createElement('script');
    s.src = 'data/quiz-' + (subj === '基础' ? 'basic' : 'hr') + '.js';
    s.onload = function () { loaded[subj] = true; cb(); };
    s.onerror = function () { loaded[subj] = false; cb(); };
    document.body.appendChild(s);
  }
  function allQuestions() {
    var out = [];
    ['基础', '人力'].forEach(function (s) {
      var db = window.QUIZ_DB && window.QUIZ_DB[s];
      if (db) db.questions.forEach(function (q) { out.push(q); });
    });
    return out;
  }
  function papersOf(subj) {
    var db = window.QUIZ_DB && window.QUIZ_DB[subj];
    return db ? db.papers : [];
  }
  function qById(id) {
    var hit = null;
    ['基础', '人力'].forEach(function (s) {
      var db = window.QUIZ_DB && window.QUIZ_DB[s];
      if (!hit && db) { for (var i = 0; i < db.questions.length; i++) if (db.questions[i].id === id) { hit = db.questions[i]; break; } }
    });
    return hit;
  }
  function chaptersOf(subj) {
    var set = {};
    var db = window.QUIZ_DB && window.QUIZ_DB[subj];
    if (db) db.questions.forEach(function (q) { if (q.ch) set[q.ch] = 1; });
    return Object.keys(set).sort(function (a, b) {
      return (+a.split('-')[1] || 0) - (+b.split('-')[1] || 0);   // 按章号升序
    });
  }

  /* ---------- 视图状态 ---------- */
  var S = {
    tab: 'mix', subj: 'all', ch: '', type: '', src: '', year: '',
    mode: 'practice', n: 20, shuffleOpts: true,
    pool: [], pos: 0,                      // 做题会话
    exam: null                             // 考试会话 {pid,title,answers:{},end,timer}
  };

  /* ---------- 工具 ---------- */
  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function $(id) { return document.getElementById(id); }
  function todayStr(ts) { var d = new Date(ts || Date.now()); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

  /* 选项随机：返回 {omap(新位置→原位置), ans(新答案字母), map(全部字母 old→new 重映射)}。
     map 一经会话生成即固定存入 maps[qid]，保证判分/解析与展示用同一映射。 */
  function shuffleView(q, fixed) {
    if (fixed) return fixed;
    var idx = [];
    for (var i = 0; i < q.o.length; i++) idx.push(i);
    var omap = (S.shuffleOpts && q.o.length > 2) ? shuffle(idx) : idx;
    var map = {};
    for (var j = 0; j < q.o.length; j++) map[LETTERS[j]] = LETTERS[omap.indexOf(j)];
    var ans = q.a.split('').map(function (L) { return map[L]; }).sort().join('');
    return { omap: omap, ans: ans, map: map };
  }
  /* 解析中的独立选项字母重映射（前后非字母数字才替换） */
  function remapLetters(text, map) {
    if (!text || !map) return text || '';
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (/[A-E]/.test(c) && map[c]) {
        var prev = text[i - 1] || '', next = text[i + 1] || '';
        if (!/[A-Za-z0-9]/.test(prev) && !/[A-Za-z0-9]/.test(next)) { out += map[c]; continue; }
      }
      out += c;
    }
    return out;
  }

  /* ---------- 筛选与组池 ---------- */
  function filteredQuestions() {
    var qs = allQuestions().filter(function (q) {
      if (S.subj !== 'all') {
        var qsSubj = q.ch ? q.ch.split('-')[0] : guessSubject(q);
        if (qsSubj !== S.subj) return false;
      }
      if (S.ch && q.ch !== S.ch) return false;
      if (S.type && q.t !== S.type) return false;
      if (S.src && q.src !== S.src) return false;
      if (S.year && q.y !== S.year) return false;
      return true;
    });
    return qs;
  }
  function guessSubject(q) { return q.id.charAt(0) === 'z' ? '人力' : '基础'; }  // 无章节的兜底（人力题全部带章节）

  function startSession(pool, mode) {
    if (!pool.length) { alert('没有符合条件的题目'); return; }
    S.mode = mode || S.mode;
    S.pool = shuffle(pool);
    if (S.n > 0 && S.mode !== 'exam') S.pool = S.pool.slice(0, Math.min(S.n, S.pool.length));
    S.pos = 0;
    S.maps = {};                       // qid → 固定选项映射（会话内不变）
    renderQuiz();
  }

  /* ---------- 记录作答 ---------- */
  function recordAnswer(q, correct) {
    var now = Date.now();
    var a = store.a[q.id] || { ok: 0, t: 0, c: 0, r: 0 };
    a.c++; a.t = now; a.ok = correct ? 1 : 0;
    if (correct) a.r++;
    store.a[q.id] = a;
    var w = store.w[q.id];
    if (!correct) {
      store.w[q.id] = { box: 0, streak: 0, t: now, due: now };
    } else if (w) {
      w.streak = (w.streak || 0) + 1;
      if (w.streak >= STREAK_GRAD) {
        delete store.w[q.id];           // 毕业
      } else {
        w.box = Math.min(w.streak, BOX_DAYS.length - 1);
        w.t = now;
        w.due = now + BOX_DAYS[Math.min(w.box, BOX_DAYS.length - 1)] * 86400000;
      }
    }
    saveStore();
  }

  /* ================= 渲染：首页 ================= */
  function renderHome() {
    var main = $('quiz-main');
    if (S.tab === 'mix') return renderTabMix(main);
    if (S.tab === 'real') return renderTabReal(main);
    if (S.tab === 'random') return renderTabRandom(main);
    if (S.tab === 'wrong') return renderTabWrong(main);
    if (S.tab === 'stats') return renderTabStats(main);
  }

  function tabBtn(id, label) {
    return '<button class="qt' + (S.tab === id ? ' active' : '') + '" data-tab="' + id + '">' + label + '</button>';
  }
  function renderTabs() {
    var el = $('quiz-tabs');
    el.innerHTML = [tabBtn('mix', '📖 混合题库'), tabBtn('real', '🏆 真题'), tabBtn('random', '🎲 随机题库'),
      tabBtn('wrong', '🔴 错题本' + wrongDueBadge()), tabBtn('stats', '📊 统计')].join('');
    el.querySelectorAll('.qt').forEach(function (b) {
      b.addEventListener('click', function () {
        if (S.exam) return;                       // 考试中不允许切 tab（先交卷）
        S.tab = b.dataset.tab;
        renderTabs(); renderHome();
      });
    });
  }
  function wrongDueBadge() {
    var n = 0, now = Date.now();
    Object.keys(store.w).forEach(function (id) { if ((store.w[id].due || 0) <= now) n++; });
    return n ? ' <span class="qt-badge">' + n + '</span>' : '';
  }

  function filterBar(withYear) {
    var chs = S.subj === 'all' ? [] : chaptersOf(S.subj);
    var years = [];
    allQuestions().forEach(function (q) { if (q.y && years.indexOf(q.y) < 0) years.push(q.y); });
    years.sort().reverse();
    var chOpts = '<option value="">全部章节</option>' + (S.subj === 'all' ? '' : chs.map(function (c) {
      return '<option value="' + esc(c) + '"' + (S.ch === c ? ' selected' : '') + '>' + esc(chLabel(c)) + '</option>';
    }).join(''));
    return '<div class="qfilter">'
      + '<select id="f-subj"><option value="all"' + (S.subj === 'all' ? ' selected' : '') + '>全部科目</option>'
      + '<option value="基础"' + (S.subj === '基础' ? ' selected' : '') + '>经济基础</option>'
      + '<option value="人力"' + (S.subj === '人力' ? ' selected' : '') + '>人力资源</option></select>'
      + '<select id="f-ch"' + (S.subj === 'all' ? ' disabled' : '') + '>' + chOpts + '</select>'
      + '<select id="f-type"><option value="">全部题型</option><option value="s">单选</option><option value="m">多选</option></select>'
      + '<select id="f-src"><option value="">全部来源</option><option value="真题">真题</option><option value="模拟">模拟题</option><option value="习题">习题</option></select>'
      + (withYear ? '<select id="f-year"><option value="">全部年份</option>' + years.map(function (y) {
          return '<option value="' + y + '"' + (S.year === y ? ' selected' : '') + '>' + y + ' 年</option>';
        }).join('') + '</select>' : '')
      + '<label class="qcheck"><input type="checkbox" id="f-shuffle"' + (S.shuffleOpts ? ' checked' : '') + '> 选项随机</label>'
      + '</div>';
  }
  function chLabel(ch) {
    var p = ch.split('-');
    var name = (window.QUIZ_CHAPTERS && window.QUIZ_CHAPTERS[ch]) || '';
    return '第' + (+p[1]) + '章 ' + name;
  }
  function wireFilter(withYear, onChange) {
    ['f-subj', 'f-ch', 'f-type', 'f-src', 'f-year'].forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener('change', function () {
        if (id === 'f-subj') { S.subj = el.value; S.ch = ''; renderHome(); return; }
        if (id === 'f-ch') S.ch = el.value;
        if (id === 'f-type') S.type = el.value;
        if (id === 'f-src') S.src = el.value;
        if (id === 'f-year') S.year = el.value;
        onChange && onChange();
      });
    });
    var sh = $('f-shuffle');
    if (sh) sh.addEventListener('change', function () { S.shuffleOpts = sh.checked; });
  }
  function countText(qs) {
    var s = qs.filter(function (q) { return q.t === 's'; }).length, m = qs.length - s;
    return '共 ' + qs.length + ' 题（单选 ' + s + ' · 多选 ' + m + '）';
  }
  function modeBtns() {
    return '<div class="qmode">'
      + '<button data-mode="practice"' + (S.mode === 'practice' ? ' class="on"' : '') + '>✏️ 练习模式<small>逐题作答即出解析</small></button>'
      + '<button data-mode="recite"' + (S.mode === 'recite' ? ' class="on"' : '') + '>📖 背题模式<small>直接看答案解析</small></button>'
      + '<button data-mode="exam"' + (S.mode === 'exam' ? ' class="on"' : '') + '>⏱ 考试模式<small>计时答题 交卷评分</small></button>'
      + '</div>';
  }

  /* --- 混合题库 --- */
  function renderTabMix(main) {
    main.innerHTML = '<div class="section"><h2>📖 混合题库</h2>'
      + '<p class="qhint">全题库（真题 + 模拟题 + 习题），可按科目、章节、题型、来源筛选。</p>'
      + filterBar(false) + modeBtns()
      + '<div class="qcount" id="mix-count">统计中…</div>'
      + '<div class="qstart"><button class="qbtn primary" id="btn-start">开始刷题</button>'
      + '<label class="qcheck">每次题量 <select id="f-n"><option>20</option><option>50</option><option>100</option><option value="0">不限</option></select></label></div></div>';
    wireFilter(false, function () { renderTabMix(main); updateMixCount(); });
    $('f-n').value = String(S.n);
    $('f-n').addEventListener('change', function () { S.n = +$('f-n').value; });
    $('btn-start').addEventListener('click', function () { startSession(filteredQuestions()); });
    updateMixCount();
  }
  function updateMixCount() {
    var el = $('mix-count'); if (!el) return;
    if (S.subj === 'all' && !(window.QUIZ_DB && window.QUIZ_DB['人力'])) {
      el.textContent = '统计中…'; setTimeout(updateMixCount, 300); return;
    }
    el.textContent = countText(filteredQuestions());
  }

  /* --- 真题 --- */
  function renderTabReal(main) {
    main.innerHTML = '<div class="section"><h2>🏆 真题题库</h2>'
      + '<p class="qhint">只出历年真题，可按年份筛选乱序刷，或选择整卷模拟。</p>'
      + filterBar(true) + modeBtns()
      + '<div class="qcount" id="mix-count">统计中…</div>'
      + '<div class="qstart"><button class="qbtn primary" id="btn-start">按筛选刷真题</button>'
      + '<label class="qcheck">每次题量 <select id="f-n"><option>20</option><option>50</option><option>100</option><option value="0">不限</option></select></label></div></div>'
      + '<div class="section"><h2>📋 整卷模拟</h2><p class="qhint">整卷计时（90 分钟），交卷按官方规则评分：单选 1 分、多选 2 分（错选不得分、少选每选对一项得 0.5 分），满分 140、合格 84。</p>'
      + '<div id="paper-list"><p class="qhint">卷目加载中…</p></div></div>';
    wireFilter(true, function () { renderTabReal(main); updateMixCount(); });
    $('f-n').value = String(S.n);
    $('f-n').addEventListener('change', function () { S.n = +$('f-n').value; });
    $('btn-start').addEventListener('click', function () { startSession(filteredQuestions()); });
    updateMixCount();
    renderPaperList();
  }
  function renderPaperList() {
    var el = $('paper-list'); if (!el) return;
    if (!(window.QUIZ_DB && window.QUIZ_DB['人力'])) {
      setTimeout(function () {
        ensureSubject('人力', function () { renderPaperList(); });
      }, 0);
      return;
    }
    var html = '';
    ['基础', '人力'].forEach(function (subj) {
      var ps = papersOf(subj);
      if (!ps.length) return;
      html += '<div class="paper-subj">' + (subj === '基础' ? '经济基础' : '人力资源') + '</div>';
      ps.forEach(function (p) {
        var badge = p.cat === '真题' ? 'q-tag real' : 'q-tag mock';
        var done = store.e.filter(function (x) { return x.pid === p.id; }).length;
        html += '<div class="paper-row"><span class="' + badge + '">' + (p.cat === '真题' ? '真题' : '模拟') + '</span>'
          + '<span class="paper-title">' + esc(p.t) + '</span>'
          + '<span class="paper-meta">' + (p.y ? p.y + '年 · ' : '') + p.n + '题' + (p.dur ? ' · ' + p.dur + '分钟' : '') + (done ? ' · 已考 ' + done + ' 次' : '') + '</span>'
          + '<button class="qbtn small" data-paper="' + p.id + '" data-subj="' + subj + '">整卷模拟</button></div>';
      });
    });
    el.innerHTML = html || '<p class="qhint">暂无卷目</p>';
    el.querySelectorAll('button[data-paper]').forEach(function (b) {
      b.addEventListener('click', function () { startExam(b.getAttribute('data-paper'), b.getAttribute('data-subj')); });
    });
  }

  /* --- 随机题库 --- */
  function renderTabRandom(main) {
    main.innerHTML = '<div class="section"><h2>🎲 随机题库</h2>'
      + '<p class="qhint">从全题库随机抽题，选项顺序随机打乱（解析中的选项字母同步重映射，选项后标注原卷字母，可对照）。题目顺序随机、每次不同。</p>'
      + filterBar(false) + modeBtns()
      + '<div class="qstart"><button class="qbtn primary" id="btn-start">随机抽 ' + (S.n || 100) + ' 题</button>'
      + '<label class="qcheck">抽题数量 <select id="f-n"><option>10</option><option selected>20</option><option>50</option><option>100</option><option value="0">不限</option></select></label></div></div>';
    wireFilter(false, function () { renderTabRandom(main); });
    $('f-n').value = String(S.n);
    $('f-n').addEventListener('change', function () { S.n = +$('f-n').value; $('btn-start').textContent = '随机抽 ' + (S.n || '全部') + ' 题'; });
    $('btn-start').addEventListener('click', function () { startSession(filteredQuestions()); });
  }

  /* --- 错题本 --- */
  function renderTabWrong(main) {
    var now = Date.now();
    var dueIds = [], allIds = [];
    Object.keys(store.w).forEach(function (id) {
      allIds.push(id);
      if ((store.w[id].due || 0) <= now) dueIds.push(id);
    });
    // 按章分布
    var chDist = {};
    allIds.forEach(function (id) {
      var q = qById(id);
      var k = (q && q.ch) ? q.ch : '未分类';
      chDist[k] = (chDist[k] || 0) + 1;
    });
    var chRows = Object.keys(chDist).sort(function (a, b) { return chDist[b] - chDist[a]; }).map(function (c) {
      return '<div class="wr-row"><span>' + esc(c === '未分类' ? '未分类' : chLabel(c)) + '</span><span class="wr-n">' + chDist[c] + '</span></div>';
    }).slice(0, 8).join('');
    main.innerHTML = '<div class="section"><h2>🔴 错题本</h2>'
      + '<p class="qhint">间隔重复：今日待复习 ' + dueIds.length + ' 题 · 错题总数 ' + allIds.length + '。答对升盒（0→1→3→7 天），连续答对 ' + STREAK_GRAD + ' 次毕业移出。</p>'
      + '<div class="qstart"><button class="qbtn primary" id="btn-due"' + (dueIds.length ? '' : ' disabled') + '>复习今日到期（' + dueIds.length + '）</button>'
      + '<button class="qbtn" id="btn-all"' + (allIds.length ? '' : ' disabled') + '>全部错题重刷（' + allIds.length + '）</button></div></div>'
      + (allIds.length ? '<div class="section"><h2>薄弱章节（错题最多的章）</h2>' + chRows + '</div>' : '');
    $('btn-due') && $('btn-due').addEventListener('click', function () { startSession(dueIds.map(qById).filter(Boolean)); });
    $('btn-all') && $('btn-all').addEventListener('click', function () { startSession(allIds.map(qById).filter(Boolean)); });
  }

  /* --- 统计 --- */
  function renderTabStats(main) {
    var answered = Object.keys(store.a), now = Date.now();
    var total = 0, right = 0, today = 0;
    answered.forEach(function (id) {
      var a = store.a[id];
      total += a.c; right += a.r;
      if (todayStr(a.t) === todayStr()) today += a.c;
    });
    var favIds = Object.keys(store.f);
    // 按章正确率
    var chAgg = {};
    answered.forEach(function (id) {
      var q = qById(id), a = store.a[id];
      var k = (q && q.ch) ? q.ch : '未分类';
      var g = chAgg[k] = chAgg[k] || { c: 0, r: 0 };
      g.c += a.c; g.r += a.r;
    });
    var rows = Object.keys(chAgg).sort(function (a, b) {
      var pa = chAgg[a].c ? chAgg[a].r / chAgg[a].c : 1, pb = chAgg[b].c ? chAgg[b].r / chAgg[b].c : 1;
      return pa - pb;
    })
      .map(function (c) {
        var g = chAgg[c], pct = g.c ? Math.round(g.r * 100 / g.c) : 0;
        return '<div class="wr-row"><span>' + esc(c === '未分类' ? '未分类' : chLabel(c)) + '</span>'
          + '<div class="wr-bar"><div class="fill" style="width:' + pct + '%"></div></div>'
          + '<span class="wr-n">' + pct + '% · ' + g.c + ' 次</span></div>';
      }).join('');
    var examRows = store.e.slice(-10).reverse().map(function (x) {
      return '<div class="wr-row"><span>' + esc(x.title || '整卷') + '</span><span class="wr-n">' + x.score + ' 分 / ' + (x.right || 0) + '/' + (x.total || 0) + ' 对</span></div>';
    }).join('');
    main.innerHTML = '<div class="section"><h2>📊 刷题统计</h2>'
      + '<div class="stat-cards">'
      + '<div class="stat"><b>' + answered.length + '</b><small>已刷题数（去重）</small></div>'
      + '<div class="stat"><b>' + (total ? Math.round(right * 100 / total) : 0) + '%</b><small>累计正确率</small></div>'
      + '<div class="stat"><b>' + today + '</b><small>今日做题</small></div>'
      + '<div class="stat"><b>' + Object.keys(store.w).length + '</b><small>错题在册</small></div>'
      + '<div class="stat"><b>' + favIds.length + '</b><small>收藏</small></div>'
      + '</div></div>'
      + '<div class="section"><h2>各章正确率（低→高）</h2>' + (rows || '<p class="qhint">还没有做题记录</p>') + '</div>'
      + '<div class="section"><h2>最近考试成绩</h2>' + (examRows || '<p class="qhint">还没有整卷模考记录</p>') + '</div>'
      + '<div class="section"><h2>⭐ 收藏夹</h2>'
      + '<div class="qstart"><button class="qbtn" id="btn-fav"' + (favIds.length ? '' : ' disabled') + '>刷收藏题（' + favIds.length + '）</button></div></div>';
    $('btn-fav') && $('btn-fav').addEventListener('click', function () { startSession(favIds.map(qById).filter(Boolean)); });
  }

  /* ================= 渲染：做题视图 ================= */
  function sessionHead() {
    return '<div class="quiz-session-head"><button class="qbtn ghost small" id="btn-exit">← 退出</button>'
      + '<span class="q-pos" id="q-pos"></span><span id="q-head-extra"></span></div>'
      + '<div class="progress-bar"><div class="fill" id="q-fill" style="width:0%"></div></div>';
  }
  function renderQuiz() {
    var main = $('quiz-main');
    if (S.mode === 'exam') return startExamFromPool();
    main.innerHTML = sessionHead() + '<div id="q-card"></div>'
      + '<div class="quiz-nav"><button class="qbtn" id="btn-prev">上一题</button>'
      + '<button class="qbtn primary" id="btn-next">下一题</button></div>';
    $('btn-exit').addEventListener('click', exitSession);
    $('btn-prev').addEventListener('click', function () { if (S.pos > 0) { S.pos--; drawQuestion(); } });
    $('btn-next').addEventListener('click', function () {
      if (S.pos < S.pool.length - 1) { S.pos++; drawQuestion(); }
      else finishPool();
    });
    drawQuestion();
  }
  function finishPool() {
    var total = S.pool.length, right = 0;
    S.pool.forEach(function (q) { var a = store.a[q.id]; if (a && a.ok) right++; });
    var done = S.pool.filter(function (q) { return store.a[q.id]; }).length;
    var rOk = S.pool.filter(function (q) { return store.a[q.id] && store.a[q.id].ok; }).length;
    $('quiz-main').innerHTML = '<div class="section result"><h2>🎉 本轮完成</h2>'
      + '<div class="stat-cards">'
      + '<div class="stat"><b>' + done + '/' + total + '</b><small>已作答</small></div>'
      + '<div class="stat"><b>' + (done ? Math.round(rOk * 100 / done) : 0) + '%</b><small>本轮正确率</small></div>'
      + '</div><div class="qstart"><button class="qbtn primary" id="btn-again">再来一轮</button>'
      + '<button class="qbtn" id="btn-home">返回题库</button></div></div>';
    $('btn-again').addEventListener('click', function () { startSession(S.pool.slice()); });
    $('btn-home').addEventListener('click', function () { S.tab = 'mix'; renderTabs(); renderHome(); });
  }
  function exitSession() {
    S.pool = []; S.exam = null;
    renderTabs(); renderHome();
  }

  function drawQuestion() {
    var q = S.pool[S.pos]; if (!q) return;
    if (!S.maps) S.maps = {};
    var v = S.maps[q.id] || (S.maps[q.id] = shuffleView(q));
    var recite = S.mode === 'recite';
    var card = $('q-card');
    var tags = '<span class="q-tag">' + (q.t === 's' ? '单选' : '多选') + '</span>'
      + '<span class="q-tag' + (q.src === '真题' ? ' real' : '') + '">' + esc(q.src) + (q.y ? ' ' + q.y : '') + '</span>'
      + (q.ch ? '<span class="q-tag">' + esc(chLabel(q.ch)) + '</span>' : '')
      + '<span class="q-fav" id="q-fav">' + (store.f[q.id] ? '★' : '☆') + '</span>';
    card.innerHTML = '<div class="quiz-item big"><div class="q-tags">' + tags + '</div>'
      + '<div class="q-stem">' + esc(q.q) + '</div>'
      + '<div class="q-opts" id="q-opts"></div>'
      + '<div id="q-actions"></div>'
      + '<div id="q-exp"></div></div>';
    $('q-pos').textContent = '第 ' + (S.pos + 1) + ' / ' + S.pool.length + ' 题';
    $('q-fill').style.width = Math.round((S.pos) * 100 / S.pool.length) + '%';
    $('q-fav').addEventListener('click', function () {
      if (store.f[q.id]) delete store.f[q.id]; else store.f[q.id] = Date.now();
      $('q-fav').textContent = store.f[q.id] ? '★' : '☆';
      saveStore();
    });
    var picked = {};   // 本题已选（新字母 -> true）
    var submitted = false;
    var omap = v.omap, map = v.map;
    var optsEl = $('q-opts');
    q.o.forEach(function (text, oldPos) {
      var newPos = omap.indexOf(oldPos);
      var btn = document.createElement('button');
      btn.className = 'qopt';
      btn.innerHTML = '<b>' + LETTERS[newPos] + '.</b> ' + esc(text)
        + (S.shuffleOpts && q.o.length > 2 ? ' <span class="orig-letter">（原' + LETTERS[oldPos] + '）</span>' : '');
      btn.setAttribute('data-new', LETTERS[newPos]);
      btn.addEventListener('click', function () {
        if (submitted || recite) return;
        if (q.t === 's') {
          picked = {}; picked[LETTERS[newPos]] = true;
          optsEl.querySelectorAll('.qopt').forEach(function (b) { b.classList.remove('picked'); });
          btn.classList.add('picked');
          submitAnswer();
        } else {
          var L = LETTERS[newPos];
          if (picked[L]) { delete picked[L]; btn.classList.remove('picked'); }
          else { picked[L] = true; btn.classList.add('picked'); }
        }
      });
      optsEl.appendChild(btn);
    });
    var origAnsText = v.ans;
    function showExplanation(pickedStr) {
      var correct = pickedStr === origAnsText;
      optsEl.querySelectorAll('.qopt').forEach(function (b) {
        var L = b.getAttribute('data-new');
        b.disabled = true;
        if (origAnsText.indexOf(L) >= 0) b.classList.add('correct');
        else if (pickedStr.indexOf(L) >= 0) b.classList.add('wrong');
      });
      var expHtml = remapLetters(q.e, map);
      $('q-exp').innerHTML = '<div class="q-feedback ' + (correct ? 'ok' : 'no') + '">'
        + (correct ? '✓ 回答正确' : (q.t === 's' ? '✗ 回答错误，正确答案：' : '✗ 未全对，正确答案：') + origAnsText) + '</div>'
        + (expHtml ? '<details open><summary>解析</summary><div class="q-exp-body">' + esc(expHtml) + '</div></details>'
          : '<div class="q-exp-body muted">暂无解析</div>');
      $('q-actions').innerHTML = '';
      return correct;
    }
    function submitAnswer() {
      var pickedStr = Object.keys(picked).sort().join('');
      if (!pickedStr) return;
      submitted = true;
      var correct = showExplanation(pickedStr);
      recordAnswer(q, correct);
    }
    if (recite) {
      // 背题模式：直接展示正确选项与解析
      optsEl.querySelectorAll('.qopt').forEach(function (b) {
        var L = b.getAttribute('data-new');
        if (origAnsText.indexOf(L) >= 0) b.classList.add('correct');
        b.disabled = true;
      });
      var expHtml2 = remapLetters(q.e, map);
      $('q-exp').innerHTML = '<div class="q-feedback ok">答案：' + origAnsText + '</div>'
        + (expHtml2 ? '<details open><summary>解析</summary><div class="q-exp-body">' + esc(expHtml2) + '</div></details>'
          : '<div class="q-exp-body muted">暂无解析</div>');
    } else if (q.t === 's') {
      $('q-actions').innerHTML = '<div class="q-keyhint">点选即判 · 快捷键 1-' + q.o.length + ' 选选项，Enter 下一题</div>';
    } else {
      $('q-actions').innerHTML = '<button class="qbtn primary" id="btn-submit">提交答案</button><div class="q-keyhint">勾选后提交（可多选）· 快捷键 1-' + q.o.length + ' 勾选，Enter 提交/下一题</div>';
      $('btn-submit').addEventListener('click', submitAnswer);
    }
    // 键盘
    card.onkeydown = function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); $('btn-next') && $('btn-next').click(); return; }
      var nIdx = '12345'.indexOf(ev.key);
      if (nIdx >= 0 && nIdx < q.o.length) {
        var btns = optsEl.querySelectorAll('.qopt');
        btns[nIdx] && btns[nIdx].click();
      }
    };
  }

  /* ================= 整卷考试 ================= */
  function startExam(pid, subj) {
    ensureSubject(subj, function () {
      var p = papersOf(subj).filter(function (x) { return x.id === pid; })[0];
      if (!p) { alert('找不到卷目'); return; }
      var db = window.QUIZ_DB[subj];
      var qs = db.questions.filter(function (q) { return q.p === pid; }).sort(function (a, b) { return (a.n || 0) - (b.n || 0); });
      if (!qs.length) { alert('该卷暂无可刷题目'); return; }
      S.exam = { pid: pid, title: p.t, subj: subj, qs: qs, answers: {}, started: Date.now(), end: Date.now() + 90 * 60000, cur: 0 };
      renderExam();
    });
  }
  function startExamFromPool() {
    S.exam = { pid: null, title: '自由组卷', subj: 'all', qs: S.pool, answers: {}, started: Date.now(), end: Date.now() + Math.max(30, S.pool.length) * 60000, cur: 0 };
    renderExam();
  }
  function renderExam() {
    var ex = S.exam;
    $('quiz-main').innerHTML = '<div class="exam-head"><button class="qbtn ghost small" id="btn-exit">← 交卷/退出</button>'
      + '<b>' + esc(ex.title) + '</b><span class="exam-timer" id="exam-timer">90:00</span>'
      + '<button class="qbtn small" id="btn-card">答题卡</button>'
      + '<button class="qbtn primary small" id="btn-handin">交卷</button></div>'
      + '<div class="progress-bar"><div class="fill" id="q-fill" style="width:0%"></div></div>'
      + '<div id="exam-card"></div><div id="exam-sheet"></div>'
      + '<div class="quiz-nav"><button class="qbtn" id="btn-prev">上一题</button><button class="qbtn primary" id="btn-next">下一题</button></div>';
    $('btn-exit').addEventListener('click', function () { if (confirm('确认交卷评分？（取消=继续作答，再按一次可放弃）')) { clearInterval(ex.timer); handIn(); } });
    $('btn-card').addEventListener('click', toggleSheet);
    $('btn-handin').addEventListener('click', function () { if (confirm('确认交卷评分？')) { clearInterval(ex.timer); handIn(); } });
    $('btn-prev').addEventListener('click', function () { if (ex.cur > 0) { ex.cur--; drawExamQ(); } });
    $('btn-next').addEventListener('click', function () { if (ex.cur < ex.qs.length - 1) { ex.cur++; drawExamQ(); } else toggleSheet(); });
    drawExamQ();
    ex.timer = setInterval(function () {
      var left = Math.max(0, ex.end - Date.now());
      var mm = Math.floor(left / 60000), ss = Math.floor(left % 60000 / 1000);
      var el = $('exam-timer');
      if (el) { el.textContent = (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss; if (left < 5 * 60000) el.classList.add('danger'); }
      if (left <= 0) { clearInterval(ex.timer); alert('时间到，自动交卷'); handIn(); }
    }, 500);
  }
  function drawExamQ() {
    var ex = S.exam, q = ex.qs[ex.cur];
    ex.maps = ex.maps || {};
    var v = ex.maps[q.id] || (ex.maps[q.id] = shuffleView(q));
    var sheet = $('exam-sheet'); sheet.innerHTML = '';
    $('q-pos') && ($('q-pos').textContent = '');
    $('q-fill').style.width = Math.round((ex.cur + 1) * 100 / ex.qs.length) + '%';
    var card = $('exam-card');
    card.innerHTML = '<div class="quiz-item big"><div class="q-tags">'
      + '<span class="q-tag">第 ' + (ex.cur + 1) + ' / ' + ex.qs.length + ' 题</span>'
      + '<span class="q-tag">' + (q.t === 's' ? '单选 1分' : '多选 2分') + '</span>'
      + '<span class="q-fav" id="q-fav">' + (store.f[q.id] ? '★' : '☆') + '</span></div>'
      + '<div class="q-stem">' + esc(q.q) + '</div><div class="q-opts" id="q-opts"></div></div>';
    $('q-fav').addEventListener('click', function () {
      if (store.f[q.id]) delete store.f[q.id]; else store.f[q.id] = Date.now();
      $('q-fav').textContent = store.f[q.id] ? '★' : '☆';
      saveStore();
    });
    var omap = v.omap;
    var optsEl = $('q-opts');
    q.o.forEach(function (text, oldPos) {
      var newPos = omap.indexOf(oldPos);
      var L = LETTERS[newPos];
      var btn = document.createElement('button');
      btn.className = 'qopt' + (ex.answers[q.id] && ex.answers[q.id].indexOf(L) >= 0 ? ' picked' : '');
      btn.innerHTML = '<b>' + L + '.</b> ' + esc(text)
        + (S.shuffleOpts && q.o.length > 2 ? ' <span class="orig-letter">（原' + LETTERS[oldPos] + '）</span>' : '');
      btn.addEventListener('click', function () {
        var cur = (ex.answers[q.id] || '').split('');
        var at = cur.indexOf(L);
        if (q.t === 's') cur = [L];
        else if (at >= 0) cur.splice(at, 1); else { cur.push(L); cur.sort(); }
        ex.answers[q.id] = cur.join('');
        drawExamQ();
      });
      optsEl.appendChild(btn);
    });
    card.onkeydown = function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); $('btn-next').click(); return; }
      var nIdx = '12345'.indexOf(ev.key);
      if (nIdx >= 0 && nIdx < q.o.length) {
        optsEl.querySelectorAll('.qopt')[nIdx].click();
      }
    };
  }
  function toggleSheet() {
    var ex = S.exam, sheet = $('exam-sheet');
    if (sheet.innerHTML) { sheet.innerHTML = ''; return; }
    var cells = ex.qs.map(function (q, i) {
      var done = ex.answers[q.id] ? ' done' : '';
      var cur = i === ex.cur ? ' cur' : '';
      return '<span class="sheet-cell' + done + cur + '" data-i="' + i + '">' + (i + 1) + '</span>';
    }).join('');
    sheet.innerHTML = '<div class="section sheet"><h3>答题卡（已答 ' + ex.qs.filter(function (q) { return ex.answers[q.id]; }).length + '/' + ex.qs.length + '）</h3>' + cells + '</div>';
    sheet.querySelectorAll('.sheet-cell').forEach(function (c) {
      c.addEventListener('click', function () { ex.cur = +c.getAttribute('data-i'); drawExamQ(); sheet.innerHTML = ''; });
    });
  }
  function handIn() {
    var ex = S.exam;
    var score = 0, right = 0, wrongIds = [];
    ex.qs.forEach(function (q) {
      var picked = ex.answers[q.id] || '';
      if (!picked) { wrongIds.push(q.id); return; }
      var origAns = ex.maps[q.id].ans;
      var full = picked === origAns, part = false;
      if (q.t === 's') {
        if (full) { score += 1; right++; } else wrongIds.push(q.id);
      } else {
        var ok = true, miss = false;
        for (var i = 0; i < picked.length; i++) if (origAns.indexOf(picked[i]) < 0) { ok = false; break; }
        if (ok && picked.length < origAns.length) { miss = true; score += picked.length * 0.5; }
        else if (ok) { score += 2; right++; }
        else { ok = false; }
        if (!ok || miss) wrongIds.push(q.id);
      }
    });
    // 记录
    var now = Date.now();
    wrongIds.forEach(function (id) {
      var q = qById(id);
      if (q) { store.w[id] = { box: 0, streak: 0, t: now, due: now }; }
    });
    store.e.push({ t: now, pid: ex.pid, title: ex.title, score: Math.round(score * 10) / 10, total: ex.qs.length, right: right });
    if (store.e.length > 50) store.e = store.e.slice(-50);
    saveStore();
    S.exam = null;
    // 结果页
    $('quiz-main').innerHTML = '<div class="section result"><h2>' + (score >= 84 ? '🎉 恭喜，达到合格线！' : '📚 继续加油！') + '</h2>'
      + '<div class="stat-cards">'
      + '<div class="stat"><b>' + Math.round(score * 10) / 10 + '</b><small>得分 / 满分140</small></div>'
      + '<div class="stat"><b>' + (score >= 84 ? '通过' : '未过') + '</b><small>合格线 84</small></div>'
      + '<div class="stat"><b>' + right + '/' + ex.qs.length + '</b><small>全对题数</small></div>'
      + '<div class="stat"><b>' + wrongIds.length + '</b><small>错题（已入错题本）</small></div>'
      + '</div><div class="qstart"><button class="qbtn primary" id="btn-review">逐题回顾</button>'
      + '<button class="qbtn" id="btn-home2">返回题库</button></div></div>';
    S.pool = ex.qs; S._reviewWrong = wrongIds;
    $('btn-review').addEventListener('click', function () { S.mode = 'recite'; S.pos = 0; renderQuiz(); });
    $('btn-home2').addEventListener('click', exitSession);
  }

  /* ================= 云同步（quiz.json，复用 rljpk_sync 配置） ================= */
  var qsyncing = false, qsha = null, qfail = 0, qpaused = 0;
  function quizSyncCfg() {
    try { var c = JSON.parse(localStorage.getItem('rljpk_sync')) || {}; return (c.repo && c.token) ? c : null; } catch (e) { return null; }
  }
  function b64e(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64d(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function mergeStore(remote) {
    ['a'].forEach(function (k) {
      Object.keys(remote[k] || {}).forEach(function (id) {
        var a = store.a[id], b = remote.a[id];
        if (!a) store.a[id] = b;
        else { store.a[id] = { ok: Math.max(a.ok || 0, b.ok || 0), t: Math.max(a.t || 0, b.t || 0), c: Math.max(a.c || 0, b.c || 0), r: Math.max(a.r || 0, b.r || 0) }; }
      });
    });
    Object.keys(remote.w || {}).forEach(function (id) {
      var a = store.w[id], b = remote.w[id];
      if (!a) store.w[id] = b;
      else {
        var best = (b.streak || 0) > (a.streak || 0) ? b : a;
        store.w[id] = { box: best.box, streak: best.streak, t: Math.max(a.t || 0, b.t || 0), due: best.due };
      }
    });
    Object.keys(remote.f || {}).forEach(function (id) {
      if (!store.f[id]) store.f[id] = remote.f[id];
    });
    (remote.e || []).forEach(function (x) {
      var dup = store.e.some(function (y) { return y.t === x.t && y.pid === x.pid; });
      if (!dup) store.e.push(x);
    });
    store.e.sort(function (x, y) { return x.t - y.t; });
  }
  function quizPush() {
    var cfg = quizSyncCfg();
    if (!cfg || qsyncing || Date.now() < qpaused) return;
    if (cfg.backend === 'gitee') return;   // 仅 GitHub（用户当前后端）
    qsyncing = true;
    var body = { message: 'quiz sync', content: b64e(JSON.stringify(store)) };
    if (qsha) body.sha = qsha;
    fetch('https://api.github.com/repos/' + cfg.repo + '/contents/quiz.json', {
      method: 'PUT', signal: abortSignal(),
      headers: { 'Authorization': 'Bearer ' + cfg.token, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) { return { s: r.status, j: j }; });
    }).then(function (res) {
      qsyncing = false;
      if (res.s === 200 || res.s === 201) { qsha = res.j.content && res.j.content.sha; qfail = 0; }
      else if (res.s === 409) { quizPull(true); }
      else if (++qfail >= 3) qpaused = Date.now() + 5 * 60000;
    }).catch(function () { qsyncing = false; if (++qfail >= 3) qpaused = Date.now() + 5 * 60000; });
  }
  function quizPull(thenPush) {
    var cfg = quizSyncCfg();
    if (!cfg || qsyncing || cfg.backend === 'gitee') return;
    qsyncing = true;
    fetch('https://api.github.com/repos/' + cfg.repo + '/contents/quiz.json', {
      method: 'GET', signal: abortSignal(),
      headers: { 'Authorization': 'Bearer ' + cfg.token, 'Accept': 'application/vnd.github+json' }
    }).then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (res) {
        qsyncing = false;
        if (res.s === 200 && res.j.content) {
          qsha = res.j.sha;
          try { mergeStore(JSON.parse(b64d(res.j.content))); } catch (e) {}
          localStorage.setItem(QKEY, JSON.stringify(store));
        } else if (Array.isArray(res.j) || res.s === 404) { qsha = null; }   // 文件不存在
        if (thenPush) quizPush();
      }).catch(function () { qsyncing = false; });
  }
  function abortSignal() {
    if (typeof AbortController === 'undefined') return undefined;
    var ac = new AbortController();
    setTimeout(function () { ac.abort(); }, 9000);
    return ac.signal;
  }

  /* ================= 启动 ================= */
  function initFromUrl() {
    var params = new URLSearchParams(location.search);
    if (params.get('tab')) S.tab = params.get('tab');
    if (params.get('ch')) { S.ch = params.get('ch'); S.subj = S.ch.split('-')[0]; }
    if (params.get('mode')) S.mode = params.get('mode');
    if (params.get('n')) S.n = +params.get('n') || 20;
    var paper = params.get('paper');
    return paper;
  }
  function boot() {
    var paper = initFromUrl();
    var autoStart = !!S.ch;
    renderTabs();
    var subjNeeded = S.subj !== 'all' ? [S.subj] : ['基础', '人力'];
    var pending = subjNeeded.length;
    subjNeeded.forEach(function (s) { ensureSubject(s, function () { if (--pending === 0) afterLoad(); }); });
    function afterLoad() {
      renderTabs();
      if (paper) { startExam(paper, S.subj === 'all' ? '基础' : S.subj); return; }
      if (autoStart) { startSession(filteredQuestions()); return; }
      renderHome();
    }
    // 同步：配置存在则拉取合并（延后 1.5s 避免抢首屏）
    setTimeout(function () { quizPull(false); }, 1500);
    window.addEventListener('focus', function () { quizPull(false); });
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
