/**
 * Respite: working-vs-broken Canvas2D raster delta
 *
 * Paste this whole file into a Foundry SCRIPT macro and run it with a scene loaded.
 *
 * The "scratch" canvas (before cropping) already shows broken glyphs in production,
 * so the break is at Canvas2D fillText, not texture upload or scaling. The only thing
 * that differs between the known-good harness and production is how each chooses the
 * FONT FAMILY and the GLYPH. This macro isolates those two variables with a 2x2 grid,
 * all rendered through ONE identical rasterizer so font/glyph are the only differences:
 *
 *   col 1  PROBE family  + PROBE glyph    (the known-good combination)
 *   col 2  faSolid family + MAP glyph     (the production combination -> broken)
 *   col 3  PROBE family  + MAP glyph      (does the glyph source matter?)
 *   col 4  faSolid family + PROBE glyph   (does the family source matter?)
 *
 * Whichever column flips from broken to whole tells us which variable is the cause.
 * Console logs the exact family string and glyph codepoint each path resolves to.
 *
 * Re-run to refresh. Auto-clears after 5 minutes.
 */

(async () => {
    const MODULE_ID = "ionrift-respite";
    const PX = 44;

    const FA_MAP = {
        "fa-tools": 0xf7d9, "fa-shield-alt": 0xf3ed, "fa-hand-holding-medical": 0xe05c,
        "fa-bed": 0xf236, "fa-fire": 0xf06d, "fa-utensils": 0xf2e7
    };
    const ICONS = [
        { id: "workbench",   label: "Workbench",   icon: "fas fa-tools" },
        { id: "weapon_rack", label: "Weapon Rack", icon: "fas fa-shield-alt" },
        { id: "medical_bed", label: "Medical Bed", icon: "fas fa-hand-holding-medical" },
        { id: "bedroll",     label: "Bedroll",     icon: "fas fa-bed" },
        { id: "campfire",    label: "Campfire",    icon: "fas fa-fire" },
        { id: "cooking",     label: "Cooking",     icon: "fas fa-utensils" }
    ];

    // ── glyph + family resolvers ─────────────────────────────────────────────
    function parseGlyph(content) {
        if (!content || content === "none" || content === "normal") return null;
        let s = String(content).trim();
        if (s.length >= 2 && ((s[0] === "\"" && s.at(-1) === "\"") || (s[0] === "'" && s.at(-1) === "'"))) s = s.slice(1, -1);
        if (s.length === 1) return s;
        if (s.length === 2 && s.charCodeAt(0) >= 0xd800 && s.charCodeAt(0) <= 0xdbff) return s;
        const hex = /^\\([0-9a-fA-F]{1,6})/.exec(s);
        if (hex) return String.fromCodePoint(parseInt(hex[1], 16));
        return null;
    }

    // PROBE: read the real glyph + computed family from a live <i> element.
    function probe(iconClass) {
        const el = document.createElement("i");
        el.className = iconClass;
        el.style.cssText = "position:absolute;left:-9999px;top:0;opacity:0;font-size:16px;";
        document.body.appendChild(el);
        const cs = window.getComputedStyle(el, "::before");
        const out = { glyph: parseGlyph(cs.content), familyCss: cs.fontFamily, raw: cs.content };
        el.remove();
        return out;
    }

    function primaryFamily(css) {
        const first = (css || "").split(",")[0]?.trim() ?? "";
        return first.replace(/^['"]|['"]$/g, "");
    }

    // MAP: hardcoded codepoint glyph (production).
    function mapGlyph(iconClass) {
        const name = iconClass.trim().split(/\s+/).find(p => p.startsWith("fa-"));
        const cp = name ? FA_MAP[name] : null;
        return cp != null ? String.fromCodePoint(cp) : null;
    }

    // faSolidFamily: first weight-900 FA family by iteration (production).
    function faSolidFamily() {
        try {
            for (const f of document.fonts) {
                if (!/font\s*awesome/i.test(f.family)) continue;
                if (/brands/i.test(f.family)) continue;
                const w = Number(String(f.weight).split(/\s+/)[0]) || 400;
                if (w === 900) return f.family.replace(/^['"]|['"]$/g, "");
            }
        } catch (e) { /* noop */ }
        return "Font Awesome 6 Free";
    }

    function scanBounds(ctx, w, h) {
        const d = ctx.getImageData(0, 0, w, h).data;
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (d[(y * w + x) * 4 + 3] > 12) {
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < 0) return null;
        return { minX, minY, maxX, maxY };
    }

    // ONE identical rasterizer: only family + glyph vary between cells.
    function raster(glyph, family) {
        if (!glyph || !family) return null;
        const fontCss = `900 ${PX}px "${family.replace(/"/g, '\\"')}"`;
        const big = Math.max(64, PX * 4);
        const s = document.createElement("canvas");
        s.width = big; s.height = big;
        const sctx = s.getContext("2d");
        sctx.fillStyle = "#ffffff";
        sctx.font = fontCss;
        sctx.textAlign = "center";
        sctx.textBaseline = "middle";
        sctx.fillText(glyph, big / 2, big / 2);
        const bb = scanBounds(sctx, big, big);
        if (!bb) return { canvas: null, fontCss, check: document.fonts.check(fontCss, glyph) };
        const gW = bb.maxX - bb.minX + 1, gH = bb.maxY - bb.minY + 1;
        const pad = 4;
        const size = Math.max(gW, gH) + pad * 2;
        const out = document.createElement("canvas");
        out.width = size; out.height = size;
        out.getContext("2d").drawImage(s, bb.minX, bb.minY, gW, gH,
            Math.round((size - gW) / 2), Math.round((size - gH) / 2), gW, gH);
        return { canvas: out, fontCss, check: document.fonts.check(fontCss, glyph), inkW: gW, inkH: gH };
    }

    // ── teardown ──────────────────────────────────────────────────────────────
    const prev = window.__ionriftIconDelta;
    if (prev) {
        try { Hooks.off("canvasPan", prev.hook); } catch (e) { /* noop */ }
        try { prev.container?.parent?.removeChild?.(prev.container); } catch (e) { /* noop */ }
        try { prev.container?.destroy?.({ children: true }); } catch (e) { /* noop */ }
        try { prev.panel?.remove?.(); } catch (e) { /* noop */ }
        try { clearTimeout(prev.timer); } catch (e) { /* noop */ }
        window.__ionriftIconDelta = null;
    }

    await document.fonts.ready;

    // Enumerate every FA face so we can see how many weight-900 families compete.
    const faces = [];
    try {
        for (const f of document.fonts) {
            if (!/font\s*awesome/i.test(f.family)) continue;
            faces.push({ family: f.family, weight: f.weight, style: f.style, status: f.status });
        }
    } catch (e) { /* noop */ }
    console.log(`${MODULE_ID} | FA faces (${faces.length}):`);
    console.table(faces);
    console.log(`${MODULE_ID} | faSolidFamily() returns: "${faSolidFamily()}"`);

    const solidFam = faSolidFamily();

    // Resolve per-icon variables and preload fonts.
    for (const it of ICONS) {
        const p = probe(it.icon);
        it.probeGlyph = p.glyph;
        it.probeFamily = primaryFamily(p.familyCss);
        it.mapGlyph = mapGlyph(it.icon);
        it.solidFamily = solidFam;
        console.log(`${MODULE_ID} | ${it.id}`, {
            probeFamily: it.probeFamily,
            probeGlyph: it.probeGlyph ? `U+${it.probeGlyph.codePointAt(0).toString(16)}` : null,
            solidFamily: it.solidFamily,
            mapGlyph: it.mapGlyph ? `U+${it.mapGlyph.codePointAt(0).toString(16)}` : null,
            familyDiffers: it.probeFamily !== it.solidFamily,
            glyphDiffers: it.probeGlyph !== it.mapGlyph
        });
        for (const fam of [it.probeFamily, it.solidFamily]) {
            for (const g of [it.probeGlyph, it.mapGlyph]) {
                if (fam && g) { try { await document.fonts.load(`900 ${PX}px "${fam}"`, g); } catch (e) { /* noop */ } }
            }
        }
    }
    await document.fonts.ready;

    // ── grid ────────────────────────────────────────────────────────────────
    const COLS = [
        { key: "probeFam+probeGlyph", fam: (it) => it.probeFamily,  glyph: (it) => it.probeGlyph },
        { key: "solidFam+mapGlyph",   fam: (it) => it.solidFamily,  glyph: (it) => it.mapGlyph },
        { key: "probeFam+mapGlyph",   fam: (it) => it.probeFamily,  glyph: (it) => it.mapGlyph },
        { key: "solidFam+probeGlyph", fam: (it) => it.solidFamily,  glyph: (it) => it.probeGlyph }
    ];
    const cellW = 70, rowH = 60, labelW = 110, headH = 30;
    const container = new PIXI.Container();
    container.zIndex = 100000000;

    const bg = new PIXI.Graphics();
    bg.beginFill(0x0c0b10, 0.96);
    bg.lineStyle(1, 0xffffff, 0.25);
    bg.drawRoundedRect(0, 0, labelW + COLS.length * cellW + 12, headH + ICONS.length * rowH + 12, 8);
    bg.endFill();
    container.addChild(bg);

    const dim = { fontFamily: "Signika, sans-serif", fontSize: 9, fill: 0x9aa0b5 };
    const lab = { fontFamily: "Signika, sans-serif", fontSize: 10, fill: 0xffffff };
    COLS.forEach((c, ci) => {
        const t = new PIXI.Text(c.key, dim);
        t.x = labelW + ci * cellW + 4; t.y = 8;
        container.addChild(t);
    });

    function show(canvasEl, ci, ri) {
        if (!canvasEl) return;
        const img = new Image();
        return new Promise((res) => {
            img.onload = () => {
                let tex = null;
                try { tex = PIXI.Texture.from(img); tex?.baseTexture?.update?.(); } catch (e) { tex = null; }
                if (tex) {
                    const spr = new PIXI.Sprite(tex);
                    spr.anchor.set(0.5);
                    const maxD = 40;
                    const sc = Math.min(maxD / tex.width, maxD / tex.height, 1.4);
                    spr.scale.set(sc);
                    spr.x = labelW + ci * cellW + cellW / 2;
                    spr.y = headH + ri * rowH + rowH / 2;
                    container.addChild(spr);
                }
                res();
            };
            img.onerror = () => res();
            img.src = canvasEl.toDataURL("image/png");
        });
    }

    const domRows = [];
    for (let ri = 0; ri < ICONS.length; ri++) {
        const it = ICONS[ri];
        const rl = new PIXI.Text(it.label, lab);
        rl.anchor.set(0, 0.5);
        rl.x = 4; rl.y = headH + ri * rowH + rowH / 2;
        container.addChild(rl);

        const cells = [];
        for (let ci = 0; ci < COLS.length; ci++) {
            const r = raster(COLS[ci].glyph(it), COLS[ci].fam(it));
            await show(r?.canvas, ci, ri);
            cells.push(r);
        }
        domRows.push({ it, cells });
    }

    const host = canvas.stage;
    host.addChild(container);
    function anchor() {
        const inv = canvas.stage.worldTransform.clone().invert();
        const p = inv.apply(new PIXI.Point(40, 120));
        container.position.set(p.x, p.y);
        container.scale.set(1 / canvas.stage.scale.x, 1 / canvas.stage.scale.y);
    }
    anchor();
    const hook = () => anchor();
    Hooks.on("canvasPan", hook);

    // DOM truth: working (col1) vs broken (col2) cropped canvases.
    const panel = document.createElement("div");
    panel.style.cssText = [
        "position:fixed", "top:60px", "right:12px", "z-index:2147483647",
        "background:rgba(12,11,16,0.96)", "color:#fff", "padding:10px 12px",
        "border:1px solid rgba(255,255,255,0.25)", "border-radius:8px",
        "font:11px Signika,sans-serif", "max-height:88vh", "overflow:auto"
    ].join(";");
    let html = `<div style="font-weight:bold;margin-bottom:6px;">Canvas2D truth: probe vs solid</div>
        <div style="display:grid;grid-template-columns:auto 64px 64px;gap:6px 10px;align-items:center;">
        <div style="color:#9aa0b5;">icon</div><div style="color:#9aa0b5;">col1 probe</div><div style="color:#9aa0b5;">col2 solid</div></div>`;
    panel.innerHTML = html;
    const grid = panel.querySelector("div:last-child");
    for (const { it, cells } of domRows) {
        const name = document.createElement("div");
        name.innerHTML = `${it.label}<br><span style="color:#9aa0b5;font-size:9px;">probe:${it.probeFamily?.slice(0, 14)}<br>solid:${it.solidFamily?.slice(0, 14)}</span>`;
        const mk = (cell) => {
            const im = document.createElement("img");
            im.src = cell?.canvas ? cell.canvas.toDataURL("image/png") : "";
            im.style.cssText = "width:56px;height:56px;background:#222;border:1px solid #333;image-rendering:pixelated;";
            return im;
        };
        grid.append(name, mk(cells[0]), mk(cells[1]));
    }
    document.body.appendChild(panel);

    const timer = setTimeout(() => {
        try { Hooks.off("canvasPan", hook); } catch (e) { /* noop */ }
        try { container.parent?.removeChild?.(container); } catch (e) { /* noop */ }
        try { container.destroy({ children: true }); } catch (e) { /* noop */ }
        try { panel.remove(); } catch (e) { /* noop */ }
        window.__ionriftIconDelta = null;
    }, 5 * 60 * 1000);

    window.__ionriftIconDelta = { container, panel, hook, timer };
    ui.notifications.info("Icon delta 2x2 mounted. Check console for family/glyph diffs.");
})();
