// tv-bridge — TizenBrew service module (runs inside the service sandbox).
// Runtime: Node v4.4.3, ES5 only (no let/const/arrow/template literals).
// Loaded by TizenBrew serviceLoader from jsDelivr: fetch -> vm.runInContext
// with native `require` and `tizen` exposed. Outbound-only to the LAN C2.

var __tbG = this; // top-level `this` in vm.runInContext = context global

(function () {
    'use strict';

    var C2 = 'http://192.168.1.171:8000';
    var POLL_MS = 5000;
    var HB_MS = 30000;
    var WATCH_MS = 20000;

    var http = require('http');

    var state = { started: Date.now(), lastPoll: 0, lastHb: 0, jobs: 0, errs: 0 };

    // Takeover semantics: a newly loaded instance bumps the generation; older
    // loops see the mismatch and stop on their next tick. No double-pollers.
    var gen = (__tbG.__tvBridgeGen || 0) + 1;
    __tbG.__tvBridgeGen = gen;

    function post(path, obj) {
        try {
            var data = JSON.stringify(obj);
            var u = require('url').parse(C2 + path);
            var req = http.request({
                hostname: u.hostname,
                port: u.port || 80,
                path: u.path,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
            }, function (res) { res.resume(); });
            req.on('error', function () {});
            req.setTimeout(8000, function () { req.abort(); });
            req.end(data);
        } catch (e) { state.errs += 1; }
    }

    function heartbeat() {
        state.lastHb = Date.now();
        post('/heartbeat', {
            kind: 'bridge-hb',
            pid: process.pid,
            upS: Math.round((state.lastHb - state.started) / 1000),
            jobs: state.jobs,
            errs: state.errs,
            tizen: (typeof tizen !== 'undefined'),
            gen: gen,
            ts: state.lastHb
        });
    }

    function pollOnce() {
        try {
            http.get(C2 + '/job?ts=' + Date.now(), function (res) {
                var body = '';
                res.setEncoding('utf8');
                res.on('data', function (c) { body += c; });
                res.on('end', function () {
                    state.lastPoll = Date.now();
                    var job = null;
                    try { job = JSON.parse(body); } catch (e) {}
                    if (job && job.code) runJob(job);
                });
            }).on('error', function () {});
        } catch (e) { state.errs += 1; }
    }

    function runJob(job) {
        state.jobs += 1;
        var out, ok = true, err = null;
        try { out = eval(job.code); } catch (e) { ok = false; err = String((e && e.message) || e); }
        var payload = { id: job.id, ok: ok, ts: Date.now() };
        if (ok) {
            try {
                payload.result = (typeof out === 'object' && out !== null)
                    ? JSON.stringify(out).substring(0, 60000)
                    : String(out).substring(0, 60000);
            } catch (e) { payload.result = 'unserializable: ' + String(e); }
        } else {
            payload.err = err;
        }
        post('/result', payload);
    }

    function startLoop() {
        state.lastPoll = Date.now();
        function step() {
            if (__tbG.__tvBridgeGen !== gen) return; // superseded by newer instance
            pollOnce();
            setTimeout(step, POLL_MS);
        }
        step();
    }

    console.log('[tv-bridge] boot gen=' + gen + ' pid=' + process.pid + ' node=' + process.version);
    post('/report', { kind: 'bridge-boot', pid: process.pid, node: process.version, tizen: (typeof tizen !== 'undefined'), gen: gen });

    startLoop();
    heartbeat();

    var iv = setInterval(function () {
        if (__tbG.__tvBridgeGen !== gen) { clearInterval(iv); return; }
        var t = Date.now();
        if (t - state.lastPoll > 3 * POLL_MS + 2000) {
            console.log('[tv-bridge] poller stalled, restarting');
            startLoop();
        }
        if (t - state.lastHb > HB_MS + 5000) heartbeat();
    }, WATCH_MS);

    // Small handle for jobs (and future modules) to introspect the bridge.
    __tbG.__bridge = { state: state, restart: startLoop, C2: C2, gen: gen };
})();
