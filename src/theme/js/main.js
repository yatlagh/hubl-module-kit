/*
  Northwind theme script.

  Progressive enhancement only: accordion and tabs render as readable,
  linkable HTML without JavaScript. This file adds keyboard interaction and
  state management following the WAI-ARIA Authoring Practices patterns.
*/
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- Accordion ---------- */

  function initAccordion(root) {
    var allowMultiple = root.getAttribute('data-allow-multiple') === 'true';
    var triggers = Array.prototype.slice.call(root.querySelectorAll('.nw-accordion__trigger'));

    function setOpen(trigger, open) {
      var panel = document.getElementById(trigger.getAttribute('aria-controls'));
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!panel) return;
      if (open) {
        panel.hidden = false;
        if (reduceMotion.matches) {
          panel.style.height = 'auto';
        } else {
          panel.style.height = '0px';
          // Force a frame so the height transition runs from 0.
          void panel.offsetHeight;
          panel.style.height = panel.scrollHeight + 'px';
          panel.addEventListener('transitionend', function onEnd() {
            panel.style.height = 'auto';
            panel.removeEventListener('transitionend', onEnd);
          });
        }
      } else {
        if (reduceMotion.matches) {
          panel.hidden = true;
          panel.style.height = '';
        } else {
          panel.style.height = panel.scrollHeight + 'px';
          void panel.offsetHeight;
          panel.style.height = '0px';
          panel.addEventListener('transitionend', function onEnd() {
            panel.hidden = true;
            panel.style.height = '';
            panel.removeEventListener('transitionend', onEnd);
          });
        }
      }
    }

    triggers.forEach(function (trigger) {
      var panel = document.getElementById(trigger.getAttribute('aria-controls'));
      var startsOpen = trigger.getAttribute('aria-expanded') === 'true';
      if (panel) {
        panel.hidden = !startsOpen;
        panel.style.height = startsOpen ? 'auto' : '';
      }

      trigger.addEventListener('click', function () {
        var isOpen = trigger.getAttribute('aria-expanded') === 'true';
        if (!allowMultiple && !isOpen) {
          triggers.forEach(function (other) {
            if (other !== trigger && other.getAttribute('aria-expanded') === 'true') setOpen(other, false);
          });
        }
        setOpen(trigger, !isOpen);
      });

      trigger.addEventListener('keydown', function (event) {
        var index = triggers.indexOf(trigger);
        var next;
        switch (event.key) {
          case 'ArrowDown': next = triggers[(index + 1) % triggers.length]; break;
          case 'ArrowUp': next = triggers[(index - 1 + triggers.length) % triggers.length]; break;
          case 'Home': next = triggers[0]; break;
          case 'End': next = triggers[triggers.length - 1]; break;
          default: return;
        }
        event.preventDefault();
        next.focus();
      });
    });
  }

  /* ---------- Tabs ---------- */

  function initTabs(root) {
    var tablist = root.querySelector('[role="tablist"]');
    if (!tablist) return;
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
    var panels = tabs.map(function (tab) {
      return document.getElementById(tab.getAttribute('aria-controls'));
    });
    var activation = root.getAttribute('data-activation') || 'automatic';

    function select(tab, focus) {
      tabs.forEach(function (t, i) {
        var selected = t === tab;
        t.setAttribute('aria-selected', selected ? 'true' : 'false');
        t.tabIndex = selected ? 0 : -1;
        if (panels[i]) panels[i].hidden = !selected;
      });
      if (focus) tab.focus();
    }

    tabs.forEach(function (tab, i) {
      // Without JS every panel is visible; JS collapses all but the selected one.
      var selected = tab.getAttribute('aria-selected') === 'true';
      tab.tabIndex = selected ? 0 : -1;
      if (panels[i]) {
        panels[i].hidden = !selected;
        panels[i].tabIndex = 0;
      }

      tab.addEventListener('click', function () { select(tab, false); });

      tab.addEventListener('keydown', function (event) {
        var index = tabs.indexOf(tab);
        var next;
        switch (event.key) {
          case 'ArrowRight': next = tabs[(index + 1) % tabs.length]; break;
          case 'ArrowLeft': next = tabs[(index - 1 + tabs.length) % tabs.length]; break;
          case 'Home': next = tabs[0]; break;
          case 'End': next = tabs[tabs.length - 1]; break;
          case 'Enter':
          case ' ':
            if (activation === 'manual') { event.preventDefault(); select(tab, false); }
            return;
          default: return;
        }
        event.preventDefault();
        if (activation === 'automatic') select(next, true); else next.focus();
      });
    });

    // Honour a hash that targets a panel (deep link into a tab).
    if (location.hash) {
      var target = panels.indexOf(document.getElementById(location.hash.slice(1)));
      if (target > -1) select(tabs[target], false);
    }
  }

  function init() {
    document.querySelectorAll('[data-nw-accordion]').forEach(initAccordion);
    document.querySelectorAll('[data-nw-tabs]').forEach(initTabs);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
