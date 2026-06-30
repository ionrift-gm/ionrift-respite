/**
 * Respite: station badge icon diagnostics
 *
 * Paste this entire file into a Foundry SCRIPT macro and run it while a scene
 * is loaded. Results go to the browser console (F12) and a short chat whisper.
 *
 * Copy the console block starting with "=== Respite station icon diag ==="
 * back to the dev when reporting font issues.
 */

(async () => {
    const STATION_ICONS = [
        { id: "workbench", label: "Workbench", icon: "fas fa-tools" },
        { id: "weapon_rack", label: "Weapon Rack", icon: "fas fa-shield-alt" },
        { id: "medical_bed", label: "Medical Bed", icon: "fas fa-hand-holding-medical" },
        { id: "bedroll", label: "Bedroll", icon: "fas fa-bed" },
        { id: "campfire", label: "Campfire", icon: "fas fa-fire" },
        { id: "cooking_station", label: "Cooking", icon: "fas fa-utensils" }
    ];
    const PIXEL_SIZE = 22;

    function parseCssContent(content) {
        if (!content || content === "none" || content === "normal") return null;
        let s = String(content).trim();
        if (s.length >= 2 && ((s[0] === "\"" && s[s.length - 1] === "\"")
            || (s[0] === "'" && s[s.length - 1] === "'"))) {
            s = s.slice(1, -1);
        }
        if (s.length === 1) return s;
        if (s.length === 2 && s.charCodeAt(0) >= 0xd800) return s;
        const hexMatch = /^\\([0-9a-fA-F]{1,6})/i.exec(s);
        if (hexMatch) {
            const cp = parseInt(hexMatch[1], 16);
            if (cp > 0 && cp <= 0x10ffff) return String.fromCodePoint(cp);
        }
        return s.length ? s : null;
    }

    function primaryFamily(fontFamilyCss) {
        if (!fontFamilyCss) return "";
        const first = fontFamilyCss.split(",")[0]?.trim() ?? "";
        return first.replace(/^['"]|['"]$/g, "");
    }

    function canvasFontString(weight, px, fontFamilyCss) {
        const fam = primaryFamily(fontFamilyCss);
        if (!fam || /^sans-serif$/i.test(fam)) return `${weight} ${px}px sans-serif`;
        return `${weight} ${px}px "${fam.replace(/"/g, '\\"')}"`;
    }

    function probeIcon(iconClass) {
        const probe = document.createElement("i");
        probe.className = iconClass;
        probe.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden;font-size:16px;";
        document.body.appendChild(probe);
        const before = window.getComputedStyle(probe, "::before");
        const self = window.getComputedStyle(probe);
        const glyph = parseCssContent(before.content);
        const out = {
            iconClass,
            contentRaw: before.content,
            glyph: glyph ?? null,
            glyphCode: glyph ? `U+${glyph.codePointAt(0).toString(16).toUpperCase()}` : null,
            fontFamilyRaw: before.fontFamily,
            fontFamilyPrimary: primaryFamily(before.fontFamily),
            fontWeight: before.fontWeight,
            fontCss: canvasFontString(before.fontWeight || 900, PIXEL_SIZE, before.fontFamily),
            selfDisplay: self.display,
            selfFontFamily: self.fontFamily,
            rect: probe.getBoundingClientRect()
        };
        document.body.removeChild(probe);
        return out;
    }

    function rasterTest(glyph, fontCss) {
        const size = 30;
        const cvs = document.createElement("canvas");
        cvs.width = size;
        cvs.height = size;
        const ctx = cvs.getContext("2d");
        ctx.clearRect(0, 0, size, size);
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = fontCss;
        ctx.fillText(glyph, size / 2, size / 2);
        const data = ctx.getImageData(0, 0, size, size).data;
        let opaque = 0;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] > 12) opaque++;
        }
        const width = ctx.measureText(glyph).width;
        let checkNoGlyph = false;
        let checkWithGlyph = false;
        try {
            checkNoGlyph = !!document.fonts?.check?.(fontCss);
            checkWithGlyph = !!document.fonts?.check?.(fontCss, glyph);
        } catch (e) {
            checkNoGlyph = `err: ${e.message}`;
        }
        return {
            fontCss,
            measureWidth: width,
            inkPixels: opaque,
            fontsCheck: checkNoGlyph,
            fontsCheckGlyph: checkWithGlyph,
            previewDataUrl: cvs.toDataURL("image/png")
        };
    }

    console.group("=== Respite station icon diag ===");
    console.log("Foundry", {
        version: game.version,
        generation: game.release?.generation,
        build: game.release?.build
    });
    console.log("Respite", {
        restInterfaceMode: game.settings.get("ionrift-respite", "restInterfaceMode"),
        moduleVersion: game.modules.get("ionrift-respite")?.version
    });
    console.log("document.fonts.ready", document.fonts?.ready);
    await document.fonts.ready;

    const faFaces = [...document.fonts].filter(f => /font\s*awesome/i.test(f.family));
    console.log("Font Awesome FontFace entries", faFaces.map(f => ({
        family: f.family,
        weight: f.weight,
        style: f.style,
        status: f.status,
        stretch: f.stretch
    })));

    const loadAttempts = [];
    for (const face of faFaces) {
        try {
            await face.load();
            loadAttempts.push({ family: face.family, status: face.status, ok: true });
        } catch (e) {
            loadAttempts.push({ family: face.family, status: face.status, ok: false, err: e.message });
        }
    }
    console.log("FontFace.load() results", loadAttempts);

    const rows = [];
    for (const st of STATION_ICONS) {
        const p = probeIcon(st.icon);
        let raster = null;
        if (p.glyph && p.fontCss) {
            try { await document.fonts.load(p.fontCss, p.glyph); } catch { /* ok */ }
            raster = rasterTest(p.glyph, p.fontCss);
        }
        const row = { station: st.id, ...p, raster };
        rows.push(row);
        console.log(`Station: ${st.id}`, row);
        if (raster?.previewDataUrl) {
            console.log(`  preview ${st.id}`, raster.previewDataUrl);
        }
    }

    // Visible DOM sanity check: do FA icons render in normal HTML?
    const domPanel = document.createElement("div");
    domPanel.id = "ionrift-fa-diag-panel";
    domPanel.style.cssText = [
        "position:fixed",
        "top:48px",
        "right:12px",
        "z-index:99999",
        "background:rgba(12,11,16,0.92)",
        "color:#fff",
        "padding:10px 12px",
        "border:1px solid rgba(255,255,255,0.2)",
        "border-radius:8px",
        "font:12px Signika,sans-serif",
        "max-width:220px",
        "pointer-events:none"
    ].join(";");
    domPanel.innerHTML = `<div style="font-weight:bold;margin-bottom:6px;">Respite FA diag (DOM)</div>`
        + STATION_ICONS.map(st =>
            `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
                <i class="${st.icon}" style="font-size:22px;width:24px;text-align:center;"></i>
                <span>${st.label}</span>
            </div>`
        ).join("");
    const prev = document.getElementById("ionrift-fa-diag-panel");
    if (prev) prev.remove();
    document.body.appendChild(domPanel);
    setTimeout(() => domPanel.remove(), 15000);

    console.log("DOM panel added top-right for 15s. Icons should look correct there if FA CSS works.");
    console.table(rows.map(r => ({
        station: r.station,
        icon: r.iconClass,
        glyph: r.glyphCode,
        family: r.fontFamilyPrimary,
        ink: r.raster?.inkPixels,
        width: r.raster?.measureWidth,
        check: r.raster?.fontsCheckGlyph
    })));
    console.groupEnd();

    const bad = rows.filter(r => !r.glyph || !r.raster || r.raster.inkPixels < 8);
    const summary = bad.length
        ? `${bad.length}/${rows.length} station icon(s) failed canvas raster. See console (F12).`
        : `All ${rows.length} station icons rasterized on canvas. If badges still show boxes, the bug is in PIXI texture upload, not font load.`;

    ui.notifications.info(`Respite icon diag done. ${summary}`);
    ChatMessage.create({
        content: `<div class="respite-recovery-chat"><p><strong>Respite icon diagnostics</strong></p><p>${summary}</p><p>Open the browser console (F12) and copy the block starting with <code>=== Respite station icon diag ===</code>.</p></div>`,
        whisper: ChatMessage.getWhisperRecipients("GM")
    });
})();
