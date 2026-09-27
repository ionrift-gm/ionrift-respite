/**
 * Click a food or water crumb to fill the first open slot.
 * Drag a crumb onto the pile or vessel to fill that day.
 */

const DRAG_THRESHOLD = 6;

export function sustenanceActorId(target, app) {
    const fromButton = target?.dataset?.actorId;
    if (fromButton) return fromButton;
    const fromPanel = target?.closest?.(".sust-diegetic")?.dataset?.sustenanceActor;
    if (fromPanel) return fromPanel;
    return app?._selectedCharacterId || "";
}

export function bindSustenanceMeters(app, root) {
    if (!root?.querySelectorAll) return;
    for (const panel of root.querySelectorAll(".sust-diegetic")) {
        bindPanel(app, panel);
    }
}

function bindPanel(app, panel) {
    if (panel.dataset.metersBound === "1") return;
    panel.dataset.metersBound = "1";

    let drag = null;

    const clearMarks = () => {
        panel.querySelectorAll(".drop-on").forEach(node => node.classList.remove("drop-on"));
    };

    const zoneUnder = (x, y, kind) => {
        const hit = document.elementFromPoint(x, y);
        let zone = hit?.closest?.("[data-drop]") ?? null;
        if (!zone) {
            const meter = hit?.closest?.(kind === "water" ? ".sust-vessel" : ".sust-pile");
            zone = meter?.querySelector?.(`[data-drop="${kind}"]`) ?? null;
        }
        if (!zone || !panel.contains(zone) || zone.dataset.drop !== kind) return null;
        return zone;
    };

    const moveGhost = (ghost, x, y) => {
        ghost.style.left = `${x}px`;
        ghost.style.top = `${y}px`;
    };

    const liftGhost = (crumb, x, y) => {
        const ghost = crumb.cloneNode(true);
        ghost.classList.remove("dragging");
        ghost.classList.add("sust-drag-ghost");
        ghost.removeAttribute("data-action");
        document.body.appendChild(ghost);
        moveGhost(ghost, x, y);
        return ghost;
    };

    const place = (kind, itemId, actorId, name, available, img, sources, zone) => {
        if (typeof app.applySustenanceChip !== "function") return;
        const target = { name, available, img, sources };
        if (zone) {
            if (kind === "water") {
                const day = Number(zone.dataset.wday);
                if (!Number.isNaN(day)) target.waterDay = day;
            } else {
                const slot = Number(zone.dataset.slot);
                if (!Number.isNaN(slot)) target.foodSlot = slot;
            }
        }
        app.applySustenanceChip(kind, itemId, actorId, target);
    };

    panel.addEventListener("pointerdown", (event) => {
        if (panel.dataset.mealsLocked === "1") return;
        const crumb = event.target.closest?.(".sust-crumb");
        if (!crumb || crumb.disabled || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        drag = {
            pointerId: event.pointerId,
            crumb,
            x: event.clientX,
            y: event.clientY,
            moved: false,
            kind: crumb.dataset.sust,
            itemId: crumb.dataset.item,
            name: crumb.dataset.name || crumb.textContent?.trim() || "",
            img: crumb.dataset.img || "",
            available: crumb.dataset.available,
            sources: crumb.dataset.sources,
            actorId: sustenanceActorId(crumb, app) || panel.dataset.sustenanceActor || "",
            zone: null
        };
        crumb.setPointerCapture?.(event.pointerId);
    });

    panel.addEventListener("pointermove", (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (!drag.moved) {
            const dx = event.clientX - drag.x;
            const dy = event.clientY - drag.y;
            if ((dx * dx) + (dy * dy) < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
            drag.moved = true;
            drag.crumb.classList.add("dragging");
            drag.ghost = liftGhost(drag.crumb, event.clientX, event.clientY);
        }
        if (drag.ghost) moveGhost(drag.ghost, event.clientX, event.clientY);
        const zone = zoneUnder(event.clientX, event.clientY, drag.kind);
        clearMarks();
        if (zone) zone.classList.add("drop-on");
        drag.zone = zone;
    });

    panel.addEventListener("pointerup", (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const current = drag;
        drag = null;
        current.crumb.classList.remove("dragging");
        current.ghost?.remove();
        clearMarks();
        event.preventDefault();
        event.stopPropagation();
        if (current.moved && !current.zone) return;
        place(
            current.kind,
            current.itemId,
            current.actorId,
            current.name,
            current.available,
            current.img,
            current.sources,
            current.moved ? current.zone : null
        );
    });

    panel.addEventListener("pointercancel", (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag.crumb.classList.remove("dragging");
        drag.ghost?.remove();
        clearMarks();
        drag = null;
    });
}
