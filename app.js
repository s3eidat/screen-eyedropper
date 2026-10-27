/* Screen Eyedropper — EyeDropper API on click (Chromium), or pick from a pasted screenshot. Nothing is uploaded. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$, h = S3.h;

  // ---------- colour maths (tested in S3_SELFTEST) ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hex2(n) { return (n < 16 ? "0" : "") + n.toString(16); }
  function toHex(c) { return ("#" + hex2(c.r) + hex2(c.g) + hex2(c.b)).toUpperCase(); }
  function parseHex(s) {
    var m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(s).trim()); if (!m) return null;
    var x = m[1]; if (x.length <= 4) x = x.split("").map(function (ch) { return ch + ch; }).join("");
    return { r: parseInt(x.slice(0, 2), 16), g: parseInt(x.slice(2, 4), 16), b: parseInt(x.slice(4, 6), 16) };
  }
  function hslToRgb(hh, s, l) {
    hh = ((hh % 360) + 360) % 360; s /= 100; l /= 100;
    var k = function (n) { return (n + hh / 30) % 12; }, a = s * Math.min(l, 1 - l);
    var f = function (n) { return Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))); };
    return { r: f(0), g: f(8), b: f(4) };
  }
  // hex, rgb()/rgba() with commas or spaces (numbers or %), hsl()/hsla(); anything else falls back to the browser's own parser.
  function parseColor(s) {
    s = String(s || "").trim(); if (!s) return null;
    var c = parseHex(s); if (c) return c;
    var m = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i.exec(s);
    if (m) { var v = [m[1], m[2], m[3]].map(function (p) { return clamp(Math.round(/%$/.test(p) ? parseFloat(p) * 2.55 : parseFloat(p)), 0, 255); }); return { r: v[0], g: v[1], b: v[2] }; }
    m = /^hsla?\(\s*(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i.exec(s);
    if (m) return hslToRgb(+m[1], clamp(+m[2], 0, 100), clamp(+m[3], 0, 100));
    var g = document.createElement("canvas").getContext("2d");
    g.fillStyle = "#010203"; g.fillStyle = s;
    var out = g.fillStyle;
    if (out === "#010203" && !/^#?010203$/i.test(s)) return null;
    if (out.charAt(0) === "#") return parseHex(out);
    g.fillRect(0, 0, 1, 1); var d = g.getImageData(0, 0, 1, 1).data; // e.g. oklch() or color(): let the canvas resolve it
    return { r: d[0], g: d[1], b: d[2] };
  }
  function toHsl(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, hh = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      hh = (hh * 60 + 360) % 360;
    }
    return { h: hh, s: s * 100, l: l * 100 };
  }
  function lin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function toOklch(c) { // Björn Ottosson's OKLab
    var r = lin(c.r), g = lin(c.g), b = lin(c.b);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    var L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    var A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    var B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    var C = Math.sqrt(A * A + B * B), H = C < 2e-4 ? 0 : (Math.atan2(B, A) * 180 / Math.PI + 360) % 360;
    return { l: L, c: C < 2e-4 ? 0 : C, h: H };
  }
  function luminance(c) { return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b); }
  function contrast(a, b) { var x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function grade(r) { return r >= 7 ? "AAA" : r >= 4.5 ? "AA" : r >= 3 ? "AA large" : "Fail"; }
  function trim(n, d) { return String(+n.toFixed(d)); }
  function formats(c) {
    var hs = toHsl(c), ok = toOklch(c);
    return [
      ["HEX", toHex(c)],
      ["RGB", "rgb(" + c.r + ", " + c.g + ", " + c.b + ")"],
      ["HSL", "hsl(" + Math.round(hs.h) % 360 + ", " + Math.round(hs.s) + "%, " + Math.round(hs.l) + "%)"],
      ["OKLCH", "oklch(" + trim(ok.l * 100, 1) + "% " + trim(ok.c, 3) + " " + trim(ok.h, 1) + ")"],
      ["Float", [c.r, c.g, c.b].map(function (v) { return (v / 255).toFixed(3); }).join(", ")]
    ];
  }
  // fallback picker maths: screen point -> image pixel, and where to put the loupe so it stays inside the box
  function pixelAt(cx, cy, rect, w, hh) {
    return { x: clamp(Math.floor((cx - rect.left) / rect.width * w), 0, w - 1), y: clamp(Math.floor((cy - rect.top) / rect.height * hh), 0, hh - 1) };
  }
  function loupePos(px, py, boxW, boxH, size, gap) {
    var x = px + gap, y = py + gap;
    if (x + size > boxW) x = px - gap - size;
    if (y + size > boxH) y = py - gap - size;
    return { x: clamp(x, 0, Math.max(0, boxW - size)), y: clamp(y, 0, Math.max(0, boxH - size)) };
  }
  var ZOOM_N = 11; // pixels across the loupe
  function sampleAt(g, x, y) { var d = g.getImageData(x, y, 1, 1).data; return { r: d[0], g: d[1], b: d[2] }; }

  // ---------- current colour + palette ----------
  var cur = parseHex(S3.store("eyedrop.cur") || "#14B8A6");
  var pal = (S3.store("eyedrop.pal") || []).filter(function (x) { return parseHex(x); }).slice(0, 64);
  function setColor(c, keep) {
    cur = c; S3.store("eyedrop.cur", toHex(c));
    if (keep) { var hx = toHex(c); pal = [hx].concat(pal.filter(function (x) { return x !== hx; })).slice(0, 64); S3.store("eyedrop.pal", pal); }
    paint();
  }
  function paint() {
    var hx = toHex(cur), white = { r: 255, g: 255, b: 255 }, black = { r: 0, g: 0, b: 0 };
    var cw = contrast(cur, white), cb = contrast(cur, black);
    var sw = $("#swatch"); sw.style.background = hx; sw.style.color = cw >= cb ? "#fff" : "#000";
    $("#swHex").textContent = hx;
    var box = $("#formats"); box.textContent = "";
    formats(cur).forEach(function (f) {
      box.appendChild(h("div", { "class": "ed-fmt" }, [
        h("span", { "class": "ed-fl", text: f[0] }), h("code", { "class": "mono", text: f[1] }),
        h("button", { "class": "btn small", type: "button", "aria-label": "Copy " + f[0], onclick: function () { S3.copy(f[1], f[0] + " copied"); S3.done(); } }, [svgUse("i-copy"), h("span", { "class": "ed-ct", text: "Copy" })])
      ]));
    });
    var con = $("#contrast"); con.textContent = "";
    [["#fff", cw, "White text"], ["#000", cb, "Black text"]].forEach(function (p) {
      var g = grade(p[1]);
      con.appendChild(h("div", { "class": "ed-con", style: "background:" + hx + ";color:" + p[0] }, [
        h("b", { text: "Aa" }), h("span", { text: p[2] }),
        h("span", { "class": "chip " + (g === "Fail" ? "bad" : g === "AA large" ? "warn" : "ok"), text: p[1].toFixed(2) + ":1 · " + g })
      ]));
    });
    paintPalette();
  }
  function svgUse(id) { var s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("class", "i"); var u = document.createElementNS("http://www.w3.org/2000/svg", "use"); u.setAttribute("href", "#" + id); s.appendChild(u); return s; }
  function paintPalette() {
    var box = $("#palette"); box.textContent = "";
    pal.forEach(function (hx) {
      var c = parseHex(hx), dark = contrast(c, { r: 255, g: 255, b: 255 }) >= contrast(c, { r: 0, g: 0, b: 0 });
      box.appendChild(h("div", { "class": "ed-chip" + (hx === toHex(cur) ? " is-on" : "") }, [
        h("button", { "class": "ed-chip-sw", type: "button", style: "background:" + hx + ";color:" + (dark ? "#fff" : "#000"), title: "Use " + hx, onclick: function () { setColor(c); } }, [hx]),
        h("button", { "class": "ed-chip-x", type: "button", "aria-label": "Remove " + hx, title: "Remove", onclick: function () { pal = pal.filter(function (x) { return x !== hx; }); S3.store("eyedrop.pal", pal); paintPalette(); } }, ["×"])
      ]));
    });
    $("#palEmpty").hidden = pal.length > 0;
    $("#palCount").textContent = pal.length ? pal.length + (pal.length === 1 ? " colour" : " colours") : "";
    ["copyCss", "dlCss", "dlJson", "palClear"].forEach(function (id) { $("#" + id).disabled = !pal.length; });
  }
  function paletteCss() { return ":root {\n" + pal.map(function (hx, i) { return "  --color-" + (i + 1) + ": " + hx + ";"; }).join("\n") + "\n}\n"; }
  function paletteJson() {
    return JSON.stringify(pal.map(function (hx) { var c = parseHex(hx), f = formats(c); return { hex: hx, rgb: [c.r, c.g, c.b], hsl: f[2][1], oklch: f[3][1] }; }), null, 2) + "\n";
  }
  $("#copyCss").addEventListener("click", function () { S3.copy(paletteCss(), "CSS copied"); S3.done(); });
  $("#dlCss").addEventListener("click", function () { S3.download(paletteCss(), "palette.css", "text/css"); S3.done(); });
  $("#dlJson").addEventListener("click", function () { S3.download(paletteJson(), "palette.json", "application/json"); S3.done(); });
  $("#palClear").addEventListener("click", function () { pal = []; S3.store("eyedrop.pal", pal); paintPalette(); });

  // ---------- the EyeDropper (only ever opened by a click) ----------
  var hasED = "EyeDropper" in window;
  $("#support").textContent = hasED
    ? "Click the button, then click anywhere on your screen, even outside the browser. Esc cancels."
    : "This browser can't pick from the screen (it works in Chrome, Edge and Opera on desktop). Use a screenshot below instead.";
  $("#pick").addEventListener("click", async function () {
    if (!hasED) { $("#fallback").scrollIntoView({ behavior: "smooth", block: "start" }); $("#fbDrop").focus(); return; }
    try {
      var res = await new window.EyeDropper().open();
      var c = parseColor(res.sRGBHex);
      if (c) { setColor(c, true); S3.copy(toHex(c), toHex(c) + " picked and copied"); S3.done(); }
    } catch (e) { if (!e || e.name !== "AbortError") S3.toast("Couldn't pick a colour", "error"); }
  });
  $("#manual").addEventListener("keydown", function (e) { if (e.key === "Enter") applyManual(); });
  $("#manual").addEventListener("change", applyManual);
  function applyManual() {
    var v = $("#manual").value; if (!v.trim()) return;
    var c = parseColor(v); if (!c) { S3.toast("That isn't a colour I can read", "error"); return; }
    setColor(c, true); $("#manual").value = "";
  }

  // ---------- fallback: pick from a screenshot with a magnifier ----------
  var fb = { c: $("#fbCanvas"), g: null, w: 0, h: 0, x: 0, y: 0 }, loupe = $("#loupe"), lg = loupe.getContext("2d");
  var fbInput = S3.drop($("#fbDrop"), function (f) { openImage(f[0]); }, { accept: "image/*", multiple: false });
  $("#fbOpen").addEventListener("click", function () { fbInput.click(); });
  $("#fbClear").addEventListener("click", function () { $("#fbWrap").hidden = true; $("#fbInfo").hidden = true; $("#fbDrop").hidden = false; $("#fbClear").hidden = true; });
  document.addEventListener("paste", function (e) {
    var it = Array.from((e.clipboardData && e.clipboardData.items) || []).find(function (i) { return i.kind === "file" && /^image\//.test(i.type); });
    if (it) { e.preventDefault(); openImage(it.getAsFile()); return; }
    if (e.target === $("#manual")) return;
    var t = e.clipboardData && e.clipboardData.getData("text"), c = t && parseColor(t);
    if (c && !/INPUT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); setColor(c, true); S3.toast(toHex(c) + " added"); }
  });
  async function openImage(file) {
    var bmp; try { bmp = await createImageBitmap(file); } catch (e) { S3.toast("This browser can't open that image", "error"); return; }
    useSource(bmp, bmp.width, bmp.height); if (bmp.close) bmp.close();
  }
  function useSource(src, w, hh) {
    var k = Math.min(1, Math.sqrt(16e6 / (w * hh)));
    fb.w = fb.c.width = Math.round(w * k); fb.h = fb.c.height = Math.round(hh * k);
    fb.g = fb.c.getContext("2d", { willReadFrequently: true }); fb.g.drawImage(src, 0, 0, fb.w, fb.h);
    fb.x = fb.w >> 1; fb.y = fb.h >> 1;
    $("#fbDrop").hidden = true; $("#fbWrap").hidden = false; $("#fbClear").hidden = false; $("#fbInfo").hidden = false;
    $("#fbInfo").textContent = fb.w + " × " + fb.h + " px. Move over the image to magnify, click to pick. Keyboard: arrows move (Shift = 10 px), Enter picks.";
    loupe.hidden = true;
  }
  function showLoupe(x, y) {
    fb.x = x; fb.y = y;
    var r = fb.c.getBoundingClientRect(), wr = $("#fbWrap").getBoundingClientRect(), S = loupe.width, cell = S / ZOOM_N, half = ZOOM_N >> 1;
    lg.imageSmoothingEnabled = false;
    lg.fillStyle = "#808080"; lg.fillRect(0, 0, S, S);
    lg.drawImage(fb.c, x - half, y - half, ZOOM_N, ZOOM_N, 0, 0, S, S);
    var c = sampleAt(fb.g, x, y);
    lg.lineWidth = 2; lg.strokeStyle = luminance(c) > 0.4 ? "#000" : "#fff";
    lg.strokeRect(half * cell + 1, half * cell + 1, cell - 2, cell - 2);
    var px = r.left - wr.left + (x + 0.5) / fb.w * r.width, py = r.top - wr.top + (y + 0.5) / fb.h * r.height;
    var p = loupePos(px, py, wr.width, wr.height, loupe.offsetWidth || S, 18);
    loupe.style.left = p.x + "px"; loupe.style.top = p.y + "px"; loupe.hidden = false;
    loupe.style.borderColor = toHex(c);
    $("#fbInfo").textContent = "x " + x + ", y " + y + " · " + toHex(c) + " · click or Enter to pick";
    return c;
  }
  function pickAt(x, y) { var c = sampleAt(fb.g, x, y); setColor(c, true); S3.copy(toHex(c), toHex(c) + " picked and copied"); S3.done(); }
  fb.c.addEventListener("pointermove", function (e) { var p = pixelAt(e.clientX, e.clientY, fb.c.getBoundingClientRect(), fb.w, fb.h); showLoupe(p.x, p.y); });
  fb.c.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") loupe.hidden = true; });
  fb.c.addEventListener("pointerup", function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    var p = pixelAt(e.clientX, e.clientY, fb.c.getBoundingClientRect(), fb.w, fb.h); showLoupe(p.x, p.y); pickAt(p.x, p.y);
  });
  fb.c.addEventListener("keydown", function (e) {
    var st = e.shiftKey ? 10 : 1, dx = { ArrowLeft: -st, ArrowRight: st }[e.key] || 0, dy = { ArrowUp: -st, ArrowDown: st }[e.key] || 0;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickAt(fb.x, fb.y); return; }
    if (!dx && !dy) return;
    e.preventDefault(); showLoupe(clamp(fb.x + dx, 0, fb.w - 1), clamp(fb.y + dy, 0, fb.h - 1));
  });
  window.addEventListener("resize", function () { loupe.hidden = true; });
  fb.c.addEventListener("focus", function () { showLoupe(fb.x, fb.y); });
  fb.c.addEventListener("blur", function () { loupe.hidden = true; });
  paint();

  // ---------- demo + self-test ----------
  function demoShot() {
    var W = 960, H = 400, c = document.createElement("canvas"); c.width = W; c.height = H;
    var g = c.getContext("2d"), gr = g.createLinearGradient(0, 0, W, H);
    gr.addColorStop(0, "#0f172a"); gr.addColorStop(1, "#1e293b"); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    var cols = ["#F43F5E", "#F59E0B", "#10B981", "#0EA5E9", "#8B5CF6", "#EC4899"];
    cols.forEach(function (col, i) { g.fillStyle = col; g.beginPath(); g.arc(110 + i * 150, 150, 58, 0, 7); g.fill(); });
    g.fillStyle = "#e2e8f0"; g.font = "600 30px Arial, sans-serif"; g.fillText("Brand palette — Autumn release", 60, 290);
    g.fillStyle = "#94a3b8"; g.font = "20px Arial, sans-serif"; g.fillText("Paste any screenshot and pick colours from it", 60, 330);
    return c;
  }
  window.S3_DEMO = function () {
    pal = ["#0EA5E9", "#F43F5E", "#F59E0B", "#10B981", "#8B5CF6", "#EC4899", "#0F172A", "#E2E8F0"];
    cur = parseHex("#0EA5E9"); paint();
    var d = demoShot(); useSource(d, d.width, d.height);
    showLoupe(560, 150);
  };
  window.S3_SELFTEST = function () {
    function near(a, b, e) { return Math.abs(a - b) <= e; }
    var ok = toHex({ r: 30, g: 144, b: 255 }) === "#1E90FF";
    var p = parseColor("#abc"); ok = ok && p.r === 170 && p.g === 187 && p.b === 204;
    p = parseColor("rgb(30 144 255)"); ok = ok && toHex(p) === "#1E90FF";
    p = parseColor("rgba(30, 144, 255, .5)"); ok = ok && toHex(p) === "#1E90FF";
    p = parseColor("hsl(210, 100%, 56%)"); ok = ok && toHex(p) === "#1F8FFF";
    ok = ok && toHex(parseColor("rebeccapurple")) === "#663399" && parseColor("notacolour") === null && parseColor("") === null;
    var hs = toHsl({ r: 255, g: 0, b: 0 }); ok = ok && hs.h === 0 && hs.s === 100 && hs.l === 50;
    hs = toHsl({ r: 0, g: 128, b: 0 }); ok = ok && near(hs.h, 120, 1e-9) && near(hs.l, 25.1, 0.05);
    // OKLCH reference values (Ottosson / CSS Color 4)
    var o1 = toOklch({ r: 255, g: 0, b: 0 }); ok = ok && near(o1.l, 0.62796, 5e-4) && near(o1.c, 0.25768, 5e-4) && near(o1.h, 29.23, 0.05);
    var o2 = toOklch({ r: 0, g: 0, b: 255 }); ok = ok && near(o2.l, 0.45201, 5e-4) && near(o2.c, 0.31321, 5e-4) && near(o2.h, 264.05, 0.05);
    var o3 = toOklch({ r: 255, g: 255, b: 255 }); ok = ok && near(o3.l, 1, 1e-3) && o3.c === 0 && o3.h === 0;
    ok = ok && formats({ r: 255, g: 0, b: 0 })[3][1] === "oklch(62.8% 0.258 29.2)" && formats({ r: 255, g: 0, b: 0 })[2][1] === "hsl(0, 100%, 50%)";
    ok = ok && near(contrast({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }), 21, 1e-9) && near(contrast({ r: 118, g: 118, b: 118 }, { r: 255, g: 255, b: 255 }), 4.54, 0.01) && grade(4.54) === "AA" && grade(3.2) === "AA large";
    // fallback picker: a 400x200 image shown at 200x100 starting at (50, 20)
    var rect = { left: 50, top: 20, width: 200, height: 100 };
    var a = pixelAt(150, 70, rect, 400, 200), b = pixelAt(10, 999, rect, 400, 200), e = pixelAt(249.9, 20, rect, 400, 200);
    ok = ok && a.x === 200 && a.y === 100 && b.x === 0 && b.y === 199 && e.x === 399 && e.y === 0;
    var l1 = loupePos(10, 10, 500, 300, 154, 18), l2 = loupePos(480, 290, 500, 300, 154, 18);
    ok = ok && l1.x === 28 && l1.y === 28 && l2.x === 308 && l2.y === 118;
    // sampling real pixels, including the last column
    var c = document.createElement("canvas"); c.width = 3; c.height = 2; var g = c.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#123456"; g.fillRect(0, 0, 3, 2); g.fillStyle = "#ABCDEF"; g.fillRect(2, 1, 1, 1);
    ok = ok && toHex(sampleAt(g, 2, 1)) === "#ABCDEF" && toHex(sampleAt(g, 0, 0)) === "#123456";
    return ok;
  };
})();
