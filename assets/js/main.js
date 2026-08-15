/* Voltix Studios — progressive enhancement only. The page is fully readable
   with this file blocked; everything here is a nicety. */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Current year in the footer, so the notice never goes stale. */
  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  /* Header gets a background once the page has scrolled off the top. */
  var nav = document.getElementById("nav");
  if (nav) {
    var onScroll = function () {
      nav.classList.toggle("is-stuck", window.scrollY > 12);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* Reveal-on-scroll. Without IntersectionObserver the elements are simply
     shown, which is why the class is removed rather than added by default. */
  var items = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window) || reduced) {
    items.forEach(function (el) { el.classList.add("is-in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  }

  /* Underline the nav link for whichever section is currently in view. The
     inner pages point their nav back at index.html, so only same-page hashes
     are considered — anything else is not a section this page can spy on. */
  var links = Array.prototype.slice
    .call(document.querySelectorAll(".nav__links a"))
    .filter(function (link) {
      var href = link.getAttribute("href") || "";
      return href.charAt(0) === "#" && href.length > 1;
    });
  var sections = links
    .map(function (link) { return document.querySelector(link.getAttribute("href")); })
    .filter(Boolean);

  if (sections.length && "IntersectionObserver" in window) {
    /* Several sections can straddle the band at once. Keep the set of them and
       always highlight the first in document order, so the result does not
       depend on which callback happened to fire last. */
    var visible = [];
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var at = visible.indexOf(entry.target);
        if (entry.isIntersecting && at === -1) visible.push(entry.target);
        else if (!entry.isIntersecting && at !== -1) visible.splice(at, 1);
      });

      var current = sections.filter(function (s) { return visible.indexOf(s) !== -1; })[0];
      links.forEach(function (link) {
        link.classList.toggle("is-current",
          !!current && link.getAttribute("href") === "#" + current.id);
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    sections.forEach(function (section) { spy.observe(section); });
  }
})();
