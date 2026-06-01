/**
 * DC badge pulse via Web Animations API (works when OS prefers-reduced-motion disables CSS).
 */

const RIPPLE_KEYFRAMES = Object.freeze([
    { transform: "scale(1)", opacity: 0.42 },
    { transform: "scale(1.85)", opacity: 0 }
]);

const BADGE_KEYFRAMES = Object.freeze([
    {
        transform: "scale(1)",
        boxShadow: "0 0 10px rgba(139, 92, 246, 0.35), 0 0 22px rgba(139, 92, 246, 0.15)",
        borderColor: "rgba(167, 139, 250, 0.55)"
    },
    {
        transform: "scale(1.08)",
        boxShadow: "0 0 18px rgba(167, 139, 250, 0.75), 0 0 36px rgba(139, 92, 246, 0.45)",
        borderColor: "rgba(221, 214, 254, 0.95)"
    },
    {
        transform: "scale(1)",
        boxShadow: "0 0 10px rgba(139, 92, 246, 0.35), 0 0 22px rgba(139, 92, 246, 0.15)",
        borderColor: "rgba(167, 139, 250, 0.55)"
    }
]);

const RIPPLE_TIMING = Object.freeze({
    duration: 3800,
    iterations: Infinity,
    easing: "cubic-bezier(0.33, 0, 0.2, 1)"
});

const BADGE_TIMING = Object.freeze({
    duration: 2400,
    iterations: Infinity,
    easing: "ease-in-out"
});

function resolveRoot(root) {
    if (root instanceof Element) return root;
    return document.querySelector("#ionrift-roll-request-preview")
        ?? document.querySelector(".ionrift-roll-request")
        ?? document;
}

function cssRulesFromSheet(sheet) {
    try {
        return [...sheet.cssRules];
    } catch {
        return [];
    }
}

function stylesheetHasKeyframe(name) {
    for (const sheet of document.styleSheets) {
        for (const rule of cssRulesFromSheet(sheet)) {
            if (rule.type === CSSRule.KEYFRAMES_RULE && rule.name === name) return true;
        }
    }
    return false;
}

function elementAnimationReport(el) {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const animations = el.getAnimations?.() ?? [];
    return {
        tag: el.tagName.toLowerCase(),
        className: el.className,
        animationName: cs.animationName,
        animationDuration: cs.animationDuration,
        animationPlayState: cs.animationPlayState,
        animationIterationCount: cs.animationIterationCount,
        transform: cs.transform,
        opacity: cs.opacity,
        webAnimations: animations.map((anim) => ({
            playState: anim.playState,
            currentTime: anim.currentTime,
            effect: anim.effect?.getTiming?.()?.duration ?? null
        }))
    };
}

function cancelStageAnimations(stage) {
    for (const el of stage.querySelectorAll(".ionrift-dc-ripple, .ionrift-dc-badge--live")) {
        for (const anim of el.getAnimations?.() ?? []) anim.cancel();
    }
}

function startWaapiPulse(stage) {
    cancelStageAnimations(stage);

    const ripples = stage.querySelectorAll(".ionrift-dc-ripple");
    for (const [index, ripple] of [...ripples].entries()) {
        ripple.animate(RIPPLE_KEYFRAMES, {
            ...RIPPLE_TIMING,
            delay: index * 1900
        });
    }

    const badge = stage.querySelector(".ionrift-dc-badge--live");
    badge?.animate(BADGE_KEYFRAMES, BADGE_TIMING);
}

function cssPulseRunning(stage) {
    const ripples = stage.querySelectorAll(".ionrift-dc-ripple");
    if (!ripples.length) return false;
    return [...ripples].some((ripple) => (ripple.getAnimations?.() ?? []).some((anim) => anim.playState === "running"));
}

function bootStagePulse(stage) {
    const live = stage.querySelector(".ionrift-dc-badge--live");
    if (!live) {
        cancelStageAnimations(stage);
        delete stage.dataset.dcPulseBooted;
        delete stage.dataset.dcPulseMode;
        return { ok: false, reason: "inactive" };
    }

    if (stage.dataset.dcPulseBooted === "1" && cssPulseRunning(stage)) {
        return { ok: true, mode: stage.dataset.dcPulseMode ?? "waapi", reused: true };
    }

    stage.dataset.dcPulseBooted = "1";
    startWaapiPulse(stage);
    stage.dataset.dcPulseMode = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "waapi-reduced-motion"
        : "waapi";

    return { ok: true, mode: stage.dataset.dcPulseMode };
}

/**
 * Ensure the DC badge pulse is running via WAAPI while a roll is still pending.
 * @param {ParentNode|null} root
 */
export function ensureDcPulseAnimation(root) {
    const scope = resolveRoot(root);
    const stages = scope.querySelectorAll?.(".ionrift-dc-stage") ?? [];
    if (!stages.length) return { ok: false, reason: "no-stage" };

    if (stages.length === 1) return bootStagePulse(stages[0]);

    const results = [...stages].map((stage) => bootStagePulse(stage));
    return {
        ok: results.some((entry) => entry.ok),
        stages: results
    };
}

/**
 * Console report for DC pulse markup, CSS, and runtime animation state.
 * @param {ParentNode|null} root
 */
export function inspectDcAnimation(root) {
    const scope = resolveRoot(root);
    const stage = scope.querySelector?.(".ionrift-dc-stage");
    const ripples = stage?.querySelectorAll(".ionrift-dc-ripple") ?? [];
    const badge = stage?.querySelector(".ionrift-dc-badge--live");

    const report = {
        stageFound: !!stage,
        rippleCount: ripples.length,
        badgeFound: !!badge,
        prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        stylesheetKeyframes: {
            ionriftDcRipple: stylesheetHasKeyframe("ionrift-dc-ripple"),
            ionriftDcBreathe: stylesheetHasKeyframe("ionrift-dc-breathe")
        },
        pulseMode: stage?.dataset.dcPulseMode ?? "(not booted)",
        elements: [
            elementAnimationReport(ripples[0]),
            elementAnimationReport(ripples[1]),
            elementAnimationReport(badge)
        ].filter(Boolean)
    };

    console.group("Ionrift roll-request DC animation");
    console.log(report);
    if (report.elements.length) console.table(report.elements);
    if (!report.stageFound) {
        console.warn("Open preview first: game.ionrift.respite.rollRequest.openPreview()");
    } else if (report.rippleCount === 0) {
        console.warn("Template missing .ionrift-dc-ripple spans. Hard reload the world (Ctrl+F5).");
    } else if (report.prefersReducedMotion) {
        console.info("prefers-reduced-motion is on (Windows Animation effects off). DC pulse uses WAAPI instead of CSS.");
    } else if (!report.stylesheetKeyframes.ionriftDcRipple) {
        console.warn("CSS @keyframes ionrift-dc-ripple not found in loaded stylesheets.");
    }
    console.groupEnd();

    return report;
}

/**
 * Sample transform/opacity for a few seconds to verify motion without screenshots.
 * @param {ParentNode|null} root
 * @param {number} [ms=4000]
 * @returns {() => void} cancel function
 */
export function watchDcAnimation(root, ms = 4000) {
    const scope = resolveRoot(root);
    const ripple = scope.querySelector?.(".ionrift-dc-ripple");
    if (!ripple) {
        console.warn("Ionrift DC watch: no .ionrift-dc-ripple found.");
        return () => {};
    }

    const samples = [];
    const started = performance.now();
    console.log(`Ionrift DC watch: sampling every 250ms for ${ms}ms...`);

    const timer = window.setInterval(() => {
        const cs = getComputedStyle(ripple);
        const waapi = ripple.getAnimations?.() ?? [];
        samples.push({
            ms: Math.round(performance.now() - started),
            transform: cs.transform,
            opacity: cs.opacity,
            waapiCount: waapi.length,
            waapi: waapi.map((anim) => anim.playState)
        });
    }, 250);

    window.setTimeout(() => {
        window.clearInterval(timer);
        const baseline = samples[0];
        const changing = samples.some((sample) =>
            sample.transform !== baseline.transform
            || sample.opacity !== baseline.opacity
            || sample.waapiCount !== baseline.waapiCount
        );
        console.group(`Ionrift DC watch (${changing ? "MOVING" : "STATIC"})`);
        console.table(samples);
        console.groupEnd();
    }, ms);

    return () => window.clearInterval(timer);
}

/**
 * Force an unmistakable green WAAPI pulse to validate the element can animate at all.
 * @param {ParentNode|null} root
 */
export function forceDcPulseTest(root) {
    const scope = resolveRoot(root);
    const stage = scope.querySelector?.(".ionrift-dc-stage");
    if (!stage) {
        console.warn("Ionrift DC test: no .ionrift-dc-stage found.");
        return null;
    }

    cancelStageAnimations(stage);
    stage.dataset.dcPulseMode = "debug-test";

    const ripples = stage.querySelectorAll(".ionrift-dc-ripple");
    for (const ripple of ripples) {
        ripple.style.borderColor = "rgba(74, 222, 128, 0.95)";
        ripple.animate(
            [
                { transform: "scale(1)", opacity: 1 },
                { transform: "scale(2.4)", opacity: 0 }
            ],
            { duration: 1200, iterations: Infinity, easing: "ease-out" }
        );
    }

    const badge = stage.querySelector(".ionrift-dc-badge--live");
    badge?.animate(
        [
            { transform: "scale(1)", borderColor: "rgba(74, 222, 128, 0.9)" },
            { transform: "scale(1.12)", borderColor: "rgba(134, 239, 172, 1)" },
            { transform: "scale(1)", borderColor: "rgba(74, 222, 128, 0.9)" }
        ],
        { duration: 1200, iterations: Infinity, easing: "ease-in-out" }
    );

    console.log("Ionrift DC test: green debug pulse running. Call inspectDcAnimation() to verify.");
    return stage;
}
