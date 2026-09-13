/* ─────────────────────────────────────────────────────────────────────────────
   Ops Monitor — production deploy guide (Cloudflare Tunnel edition)

   Three behaviours:
     1. Live placeholder substitution — type your domain / tunnel name / VPS user
        once in the hero, and every command on the page rewrites itself so you can
        copy-paste without hand-editing. Persisted in localStorage.
     2. Copy buttons on every code block (copies the substituted text).
     3. TOC scroll-spy + a progress checklist that remembers what you've ticked.
   ───────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var STORE_KEY = 'om-deploy-vars';
  var CHECK_KEY = 'om-deploy-checks';

  // Placeholder name -> default value. Any element carrying data-var="domain"
  // (or {{domain}} inside a <pre>) is filled from here.
  var DEFAULTS = {
    domain: 'ops.example.com',
    tunnel: 'ops-monitor',
    user: 'deploy',
    dir: 'ops-monitor',
  };

  // ── storage helpers (never throw — private windows block localStorage) ─────
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? Object.assign({}, fallback, JSON.parse(raw)) : Object.assign({}, fallback);
    } catch (e) {
      return Object.assign({}, fallback);
    }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  var vars = load(STORE_KEY, DEFAULTS);

  // ── 1. placeholder substitution ───────────────────────────────────────────
  // Pass 1 (once, on load): turn every {{name}} inside <pre> into a real span so
  // later updates are a cheap textContent write instead of an innerHTML rebuild.
  function wrapPlaceholders() {
    document.querySelectorAll('pre').forEach(function (pre) {
      if (pre.dataset.wrapped === '1') return;
      var html = pre.innerHTML;
      if (html.indexOf('{{') === -1) { pre.dataset.wrapped = '1'; return; }
      pre.innerHTML = html.replace(/\{\{(\w+)\}\}/g, function (match, name) {
        if (!(name in DEFAULTS)) return match;   // unknown token: leave as-is
        return '<span class="v" data-var="' + name + '"></span>';
      });
      pre.dataset.wrapped = '1';
    });
  }

  function applyVars() {
    document.querySelectorAll('[data-var]').forEach(function (el) {
      var name = el.dataset.var;
      if (name in vars) el.textContent = vars[name];
    });
  }

  function bindInputs() {
    document.querySelectorAll('.configbar input[data-field]').forEach(function (input) {
      var name = input.dataset.field;
      input.value = vars[name] || '';
      input.addEventListener('input', function () {
        // Fall back to the default when the field is emptied, so commands never
        // end up with a blank hostname that would silently "work" but be wrong.
        vars[name] = input.value.trim() || DEFAULTS[name];
        applyVars();
        save(STORE_KEY, vars);
      });
    });
  }

  // ── 2. copy buttons ───────────────────────────────────────────────────────
  function bindCopy() {
    document.querySelectorAll('.code-card').forEach(function (card) {
      var btn = card.querySelector('.copy');
      var pre = card.querySelector('pre');
      if (!btn || !pre) return;
      btn.addEventListener('click', function () {
        // innerText, not textContent: keeps the rendered line breaks and picks
        // up the substituted values rather than the {{placeholders}}.
        var text = pre.innerText;
        var restore = function (label) {
          var original = btn.textContent;
          btn.textContent = label;
          setTimeout(function () { btn.textContent = original; }, 1400);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            function () { restore('Copied ✓'); },
            function () { restore('Press ⌘/Ctrl+C'); }
          );
        } else {
          restore('Press ⌘/Ctrl+C');
        }
      });
    });
  }

  // ── 3a. TOC scroll-spy ────────────────────────────────────────────────────
  function bindScrollSpy() {
    var links = Array.prototype.slice.call(document.querySelectorAll('#toc a'));
    if (!links.length || !('IntersectionObserver' in window)) return;

    var map = new Map(links.map(function (a) {
      return [a.getAttribute('href').slice(1), a];
    }));

    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (l) { l.classList.remove('active'); });
        var a = map.get(e.target.id);
        if (a) a.classList.add('active');
      });
    }, { rootMargin: '-10% 0px -80% 0px', threshold: 0 });

    document.querySelectorAll('section[id]').forEach(function (s) { obs.observe(s); });
  }

  // ── 3b. persistent checklist ──────────────────────────────────────────────
  function bindChecklist() {
    var checks = load(CHECK_KEY, {});
    document.querySelectorAll('.checklist li[data-check]').forEach(function (li) {
      var id = li.dataset.check;
      if (checks[id]) li.classList.add('done');
      li.setAttribute('role', 'checkbox');
      li.setAttribute('tabindex', '0');
      li.setAttribute('aria-checked', checks[id] ? 'true' : 'false');

      var toggle = function () {
        var done = li.classList.toggle('done');
        li.setAttribute('aria-checked', done ? 'true' : 'false');
        checks[id] = done;
        save(CHECK_KEY, checks);
      };
      li.addEventListener('click', toggle);
      li.addEventListener('keydown', function (e) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
      });
    });
  }

  // ── boot ──────────────────────────────────────────────────────────────────
  function init() {
    wrapPlaceholders();
    applyVars();
    bindInputs();
    bindCopy();
    bindScrollSpy();
    bindChecklist();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
