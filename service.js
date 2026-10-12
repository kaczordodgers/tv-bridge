// tv-bridge v3 — TizenBrew service module (Node v4.4.3, ES5 only).
//
// DESIGN NOTE (learned on Tizen 3.0): the service event loop runs timers only
// in brief wake windows; setInterval-driven loops stall for minutes when the
// TV idles. v3 is therefore fully IO-driven: a single long-poll request whose
// completion schedules the next one. The LAN listener holds each request and
// emits keepalive chunks, which keeps pumping the loop from outside.
// Outbound-only to the LAN C2 listener.

var __tbG = this; // top-level `this` in vm.runInContext = contextified sandbox

(function () {
    'use strict';

    var C2 = 'http://192.168.1.171:8000';
    var WAIT_S = 25;          // long-poll hold time on the listener
    var ERR_THROTTLE_AFTER = 5; // consecutive errors before slow-probe throttle

    var httpm = require('http');
    var httpsm = require('https');
    var urlm = require('url');

    var state = { started: Date.now(), cycles: 0, jobs: 0, errs: 0, last: 0 };
    var errRun = 0;

    var gen = (__tbG.__tvBridgeGen || 0) + 1;
    __tbG.__tvBridgeGen = gen;

    function say(s) { try { console.log('[tv-bridge] ' + s); } catch (e) {} }

    function note(kind, obj) {
        var payload = obj || {};
        payload.kind = kind;
        payload.gen = gen;
        payload.ts = Date.now();
        var body;
        try { body = JSON.stringify(payload); } catch (e) { body = '{"kind":"' + kind + '"}'; }
        try {
            var u = urlm.parse(C2 + '/note');
            var req = httpm.request({
                hostname: u.hostname, port: u.port || 80, path: u.path, method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
            }, function (res) { res.resume(); });
            req.on('error', function () {});
            req.end(body);
        } catch (e) { state.errs += 1; }
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

    function work() {
        var myGen = gen;
        state.cycles += 1;
        state.last = Date.now();
        function done() {
            if (__tbG.__tvBridgeGen !== myGen) return; // superseded
            errRun = 0;
            work();
        }
        try {
            var req = httpm.get(C2 + '/job?wait=' + WAIT_S + '&ts=' + Date.now(), function (res) {
                var body = '';
                res.setEncoding('utf8');
                res.on('data', function (c) { body += c; }); // keepalive chunks pump the loop
                res.on('end', function () {
                    var job = null;
                    try { job = JSON.parse(body); } catch (e) {}
                    if (job && job.code) runJob(job);
                    done();
                });
            });
            req.on('error', function () {
                if (__tbG.__tvBridgeGen !== myGen) return;
                state.errs += 1;
                errRun += 1;
                if (errRun >= ERR_THROTTLE_AFTER) {
                    // slow probe doubles as throttle when the listener is gone
                    try {
                        httpsm.get('https://cdn.jsdelivr.net/npm/@foxreis/tizentube/package.json',
                            function (r) { r.resume(); done(); })
                            .on('error', function () { done(); });
                        return;
                    } catch (e) {}
                }
                done();
            });
        } catch (e) {
            state.errs += 1;
            try { done(); } catch (e2) {}
        }
    }

    say('boot v3 gen=' + gen + ' pid=' + process.pid + ' node=' + process.version);
    note('bridge-boot', {
        v: 3, pid: process.pid, node: process.version,
        tizen: (typeof tizen !== 'undefined')
    });
    work();

    __tbG.__bridge = { state: state, C2: C2, gen: gen, work: work };
})();
