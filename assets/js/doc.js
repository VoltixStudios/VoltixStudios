/* Voltix Studios — language switch for the bilingual document pages.
   The choice itself is made by the inline snippet in each page's <head>, so
   the right language is already painted on first frame; this file only wires
   the buttons. With the file blocked the page shows both languages in full,
   which is the correct fallback for a document a store has to be able to read.

   Nothing is stored. The choice lives in the URL (?lang=es) and nowhere else —
   a page whose whole subject is what the app keeps about you should not be
   quietly keeping something about you. */
(function () {
  "use strict";

  var root = document.documentElement;
  var group = document.querySelector(".lang");
  if (!group) return;

  var buttons = Array.prototype.slice.call(group.querySelectorAll("button[data-set-lang]"));
  if (!buttons.length) return;

  function apply(lang) {
    root.setAttribute("data-doclang", lang);
    root.setAttribute("lang", lang);
    buttons.forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-set-lang") === lang));
    });

    /* Keep the URL honest so the page can be linked in either language. */
    if (window.history && history.replaceState) {
      var url = location.pathname + (lang === "en" ? "" : "?lang=" + lang) + location.hash;
      history.replaceState(null, "", url);
    }
  }

  apply(root.getAttribute("data-doclang") === "es" ? "es" : "en");

  buttons.forEach(function (b) {
    b.addEventListener("click", function () {
      apply(b.getAttribute("data-set-lang"));
    });
  });
})();
