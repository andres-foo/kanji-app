
// kanji image: click or tap to see it larger; the old card layout also caps it to the card width
(function () {
  var overlay = null;
  function close() { if (overlay) { overlay.remove(); overlay = null; } }
  document.addEventListener("click", function (e) {
    if (overlay) { close(); return; }
    var img = e.target.closest(".pic img");
    if (!img) return;
    var card = img.closest(".kanji-card");
    var big = document.createElement("img");
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    if (card) {
      var width = Math.min(card.getBoundingClientRect().width, img.naturalWidth || Infinity, window.innerWidth - 32);
      if (isFinite(width)) big.style.width = Math.floor(width) + "px";
    }
    overlay = document.createElement("div");
    overlay.className = "lightbox";
    overlay.appendChild(big);
    document.body.appendChild(overlay);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
    var el = document.activeElement;
    if ((e.key === "Enter" || e.key === " ") && !overlay && el && el.matches && el.matches(".pic img")) { e.preventDefault(); el.click(); }
  });
})();
// lists dropdown: click or tap the label to open it, click anywhere else (or press Escape) to close it
(function () {
  var dd = document.querySelector(".dd");
  if (!dd) return;
  var label = dd.querySelector(".ddlabel");
  function setOpen(open) {
    dd.classList.toggle("open", open);
    label.setAttribute("aria-expanded", open ? "true" : "false");
  }
  document.addEventListener("click", function (e) {
    if (e.target.closest(".ddlabel")) setOpen(!dd.classList.contains("open"));
    else if (!e.target.closest(".ddmenu")) setOpen(false);
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") setOpen(false); });
})();
// touch screens (no hover): tapping an example word only opens its popover; the word inside the popover is the search link
document.addEventListener("click", function (e) {
  if (!matchMedia("(hover: none)").matches) return;
  var open = document.querySelector(".exw.open");
  var link = e.target.closest(".exw > a.ex");
  if (link) {
    e.preventDefault();
    var word = link.parentNode;
    if (open && open !== word) open.classList.remove("open");
    word.classList.toggle("open");
  } else if (open && !e.target.closest(".exw.open .tip")) {
    open.classList.remove("open");
  }
});
