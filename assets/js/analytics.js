/* Voltix Studios — the studio's half of the site.
   main.js and doc.js are things the visitor gets; this file is a thing we get,
   so it is kept apart from them rather than folded in.

   Umami arrives from /analytics/script.js, which is a Pages Function and so only
   exists on Cloudflare. On the GitHub Pages mirror, behind a content blocker, or
   with the proxy down, window.umami is simply never defined, every call below is
   a no-op, and the page behaves exactly the same. Nothing here is load-bearing. */
(function () {
  "use strict";

  function track(name, data) {
    if (window.umami && typeof window.umami.track === "function") {
      try { window.umami.track(name, data); } catch (e) {}
    }
  }

  function bare(host) {
    return host.replace(/^www\./, "");
  }

  function socialNetwork(host) {
    switch (bare(host)) {
      case "x.com":
      case "twitter.com": return "x";
      case "youtube.com":
      case "youtu.be":    return "youtube";
      case "tiktok.com":  return "tiktok";
      case "github.com":  return "github";
      default:            return null;
    }
  }

  /* One listener for both, because a click is one event and dispatching it twice
     to ask two different questions is just more to keep in step. Nothing here
     ever calls preventDefault: every link it reports on either opens a new tab or
     is a mailto:, so the page never unloads and the POST always lands.

     Internal links are deliberately not tracked. The destination records its own
     pageview and Umami stitches the journey from those, so an event would add an
     unload race for information we already have. */
  document.addEventListener("click", function (event) {
    var from = event.target;
    if (!from || typeof from.closest !== "function") return;

    var button = from.closest("button[data-set-lang]");
    if (button) {
      /* Delegated, which is why doc.js needs no edit — its own handler on the
         same buttons keeps working untouched. */
      track("lang-switch", { to: button.getAttribute("data-set-lang") });
      return;
    }

    var link = from.closest("a[href]");
    if (!link) return;

    var href = link.getAttribute("href") || "";

    if (href.indexOf("mailto:") === 0) {
      /* With no form anywhere on the site, a mailto and the Play button are the
         only two things a visitor can actually act on. Matched on the subject
         rather than on merely having one, so a future mailto that happens to
         carry a subject is not silently counted as a deletion request. */
      track("email", {
        intent: /[?&]subject=(delete|eliminar)/i.test(href) ? "delete-data" : "contact"
      });
      return;
    }

    /* .hostname resolves a relative href against the current page, so every
       internal link matches here and falls out. */
    if (link.hostname === location.hostname) return;
    if (link.protocol !== "http:" && link.protocol !== "https:") return;

    /* Host alone is not enough: the legal pages link to Play's terms, which is
       the same host and emphatically not a pre-registration. */
    if (link.hostname === "play.google.com" && link.pathname.indexOf("/store/apps") === 0) {
      track("play-preregister");
      return;
    }

    var network = socialNetwork(link.hostname);
    if (network) {
      /* Which placement earns the click: the labelled pills in the contact
         section, or the icon row in every page's footer. */
      track("social", {
        network: network,
        placement: link.closest(".social--compact") ? "footer" : "contact"
      });
      return;
    }

    track("outbound", { host: bare(link.hostname) });
  });

  /* How far down the landing page a visit actually gets — did they reach
     Paper Squadron, or bounce off the hero? #top fires for essentially everyone
     and is the denominator the rest are read against.

     main.js already runs a scroll-spy observer, but only over the four sections
     the nav links to; #contact, the most interesting one to have reached, is not
     among them. A separate observer costs a few lines and keeps a nicety for the
     visitor and a measurement for us from growing into each other.

     The band is a margin rather than a threshold because a section taller than
     the viewport can never be 30% visible, and those are exactly the sections
     worth counting. */
  var sections = document.querySelectorAll("#main section[id], #main article[id]");
  if (sections.length && "IntersectionObserver" in window) {
    var depth = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        depth.unobserve(entry.target);   /* once a visit, not again on the way back up */
        track("section", { id: entry.target.id });
      });
    }, { rootMargin: "-25% 0px -25% 0px", threshold: 0 });

    Array.prototype.forEach.call(sections, function (el) { depth.observe(el); });
  }
})();
