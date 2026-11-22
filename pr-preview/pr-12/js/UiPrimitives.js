(function () {
    'use strict';
    if (window.WatchbackUi) return;
    var panelTransitions = new WeakMap();
    var panelDuration = 200;
    function reducedMotion() {
        return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    }
    function setExpanded(body, expanded, trigger, options) {
        if (!body) return;
        var before = options?.before || (options ? panelFrame(body) : null);
        cancelPanelTransition(body);
        if (!expanded && body.contains(document.activeElement)) trigger?.focus({ preventScroll: true });
        options?.update?.();
        body.hidden = false;
        body.toggleAttribute('inert', !expanded);
        body.setAttribute('aria-hidden', String(!expanded));
        if (trigger) trigger.setAttribute('aria-expanded', String(expanded));
        if (before && options.animate !== false && !reducedMotion() && !document.hidden && typeof body.animate === 'function') {
            startPanelTransition(body, expanded, before, options);
        } else {
            body.hidden = !expanded;
            if (!expanded) options?.onClosed?.();
        }
    }

    function panelFrame(body) {
        var height = body.getBoundingClientRect().height;
        var style = getComputedStyle(body);
        var frame = {
            height: height + 'px',
            opacity: height === 0 ? '0' : style.opacity,
            visibility: 'visible',
            boxSizing: 'border-box',
            overflow: 'hidden',
            minHeight: '0px',
            maxHeight: 'none'
        };
        for (var property of ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'marginTop', 'marginBottom',
            'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth', 'borderColor', 'borderStyle', 'backgroundColor']) {
            frame[property] = style[property];
        }
        return height === 0 ? collapsedPanelFrame(frame) : frame;
    }

    function collapsedPanelFrame(frame) {
        return { ...frame, height: '0px', opacity: '0', paddingTop: '0px', paddingBottom: '0px',
            marginTop: '0px', marginBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px' };
    }

    function isExpanded(body) {
        if (!body) return false;
        var hidden = body.getAttribute('aria-hidden');
        return hidden === null ? !body.hidden && getComputedStyle(body).display !== 'none' : hidden === 'false';
    }

    function cancelPanelTransition(body) {
        var state = panelTransitions.get(body);
        if (!state) return;
        panelTransitions.delete(body);
        clearTimeout(state.timer);
        state.observer?.disconnect();
        window.removeEventListener('resize', state.retarget);
        state.motionQuery?.removeEventListener?.('change', state.motionChanged);
        cancelPanelEffect(state);
    }

    function cancelPanelEffect(state) {
        if (!state.animation) return;
        state.animation.onfinish = null;
        state.animation.oncancel = null;
        state.animation.cancel();
        state.animation = null;
    }

    function finishPanelTransition(body, state) {
        if (panelTransitions.get(body) !== state) return;
        body.hidden = !state.expanded;
        cancelPanelTransition(body);
        if (!state.expanded) state.onClosed?.();
    }

    // Presentation values preserve continuity on reversal without retaining inline styles.
    function animatePanelFrames(body, state, before) {
        cancelPanelEffect(state);
        var duration = Math.max(0, state.deadline - Date.now());
        if (duration < 16 || !body.isConnected) {
            finishPanelTransition(body, state);
            return;
        }
        var after = state.expanded ? panelFrame(body) : collapsedPanelFrame(before);
        var from = { ...before, paddingLeft: after.paddingLeft, paddingRight: after.paddingRight,
            borderLeftWidth: after.borderLeftWidth, borderRightWidth: after.borderRightWidth,
            borderColor: after.borderColor, borderStyle: after.borderStyle, backgroundColor: after.backgroundColor };
        if (from.height === after.height && from.opacity === after.opacity) {
            finishPanelTransition(body, state);
            return;
        }
        try {
            state.animation = body.animate([from, after], { duration: duration, easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)', fill: 'both' });
            state.animation.onfinish = function () { finishPanelTransition(body, state); };
            state.animation.oncancel = function () { finishPanelTransition(body, state); };
        } catch {
            finishPanelTransition(body, state);
        }
    }

    function startPanelTransition(body, expanded, before, options) {
        var state = { expanded: expanded, onClosed: options.onClosed, deadline: Date.now() + (options.duration || panelDuration), animation: null };
        panelTransitions.set(body, state);
        state.retarget = function () {
            if (panelTransitions.get(body) === state) animatePanelFrames(body, state, panelFrame(body));
        };
        state.timer = setTimeout(function () { finishPanelTransition(body, state); }, (options.duration || panelDuration) + 50);
        if (expanded) {
            state.observer = new MutationObserver(state.retarget);
            state.observer.observe(body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
            window.addEventListener('resize', state.retarget);
        }
        state.motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        state.motionChanged = function (event) {
            if (event.matches) finishPanelTransition(body, state);
        };
        state.motionQuery?.addEventListener?.('change', state.motionChanged);
        animatePanelFrames(body, state, before);
    }

    window.WatchbackUi = {setExpanded: setExpanded, isExpanded: isExpanded, measurePanel: panelFrame};
})();
