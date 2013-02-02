// Copyright (c) 2012, Mark Cavage. All rights reserved.

var EventEmitter = require('events').EventEmitter;

var mod_pool = require('../lib');

if (require.cache[__dirname + '/helper.js'])
        delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');



///--- Globals

var after = helper.after;
var before = helper.before;
var test = helper.test;

var POOL;

var IDLE_TIMEOUT = 30;
var MAX_CLIENTS = 10;
var POOL_NAME = 'pool_test';
var REAP_INTERVAL = 15;



///--- Tests

before(function setup(callback) {
        var id = 0;
        try {
                POOL = mod_pool.createPool({
                        checkInterval: REAP_INTERVAL,
                        log: helper.log,
                        max: MAX_CLIENTS,
                        maxIdleTime: IDLE_TIMEOUT,
                        name: POOL_NAME,

                        check: function check(client, cb) {
                                if ((client.id % 2) !== 0) {
                                        cb(new Error(client.id + ' % 2 != 0'));
                                        return;
                                }

                                cb();
                        },

                        create: function create(cb) {
                                var client = new EventEmitter();
                                client.id = ++id;
                                cb(null, client);
                        },

                        destroy: function destroy(client) {
                                client.killed = true;
                        }
                });
        } catch (e) {
                console.error(e.stack);
                callback(e);
                return;
        }

        callback();
});


after(function teardown(callback) {
        if (POOL) {
                POOL.shutdown(callback);
        } else {
                callback();
        }
});


test('check pool ok', function (t) {
        t.ok(POOL);
        t.equal(POOL.checkInterval, REAP_INTERVAL);
        t.ok(POOL.log);
        t.equal(POOL.max, MAX_CLIENTS);
        t.equal(POOL.maxIdleTime, IDLE_TIMEOUT);
        t.equal(POOL.name, POOL_NAME);
        t.end();
});


test('acquire and release ok', function (t) {
        POOL.acquire(function (err, client) {
                t.ifError(err);
                t.ok(client);
                t.equal(client.id, 1);
                POOL.release(client);
                t.equal(POOL.available.length, 1);
                t.end();
        });
});


test('acquire with queue', function (t) {
        var finished = 0;
        var clients = [];
        for (var i = 0; i <= MAX_CLIENTS; i++) {
                POOL.acquire(function (err, client) {
                        t.ifError(err);
                        clients.push(client);
                        if (finished++ === MAX_CLIENTS) {
                                t.equal(1, client.id);
                                clients.forEach(function (c) {
                                        POOL.release(c);
                                });
                                t.end();
                        }
                });
        }

        t.equal(POOL.queue.length, 1);
        t.equal(POOL.resources.length, MAX_CLIENTS);
        POOL.release(clients.shift());
});


test('acquire after releasing (no queue)', function (t) {
        var clients = [];

        for (var i = 0; i < MAX_CLIENTS; i++) {
                POOL.acquire(function (err, client) {
                        t.ifError(err);
                        clients.push(client);
                });
        }

        t.equal(POOL.available.length, 0);
        t.equal(POOL.resources.length, MAX_CLIENTS);
        t.equal(POOL.queue.length, 0);

        clients.reverse();
        clients.forEach(function (c) {
                POOL.release(c);
        });

        t.equal(POOL.available.length, MAX_CLIENTS);
        POOL.acquire(function (err, client) {
                t.ifError(err);
                t.equal(client.id, MAX_CLIENTS);
                POOL.release(client);
                t.end();
        });
});


test('health check reaping', function (t) {
        var killed = 0;
        POOL.on('death', function (client) {
                t.ok(client);
                t.ok(client.killed);
                if (++killed === 5)
                        t.end();
        });

        for (var i = 0; i < MAX_CLIENTS; i++) {
                POOL.acquire(function (err, client) {
                        t.ifError(err);
                        process.nextTick(function () {
                                POOL.release(client);
                        });
                });
        }
});


test('onError reaping (while acquired)', function (t) {
        for (var i = 0; i < MAX_CLIENTS; i++) {
                POOL.acquire(function (err, client) {
                        t.ifError(err);
                        process.nextTick(function () {
                                POOL.release(client);
                        });
                });
        }

        POOL.on('death', function (client) {
                t.ok(client);
                t.ok(client.killed);
                t.end();
        });

        POOL.acquire(function (err, client) {
                t.ifError(err);
                client.emit('error', new Error());
        });
});


test('onError reaping (while idle)', function (t) {
        for (var i = 0; i < MAX_CLIENTS; i++) {
                POOL.acquire(function (err, client) {
                        t.ifError(err);
                        process.nextTick(function () {
                                POOL.release(client);
                        });
                });
        }

        POOL.on('death', function (client) {
                t.ok(client);
                t.ok(client.killed);
                t.end();
        });

        process.nextTick(function () {
                // This is a little icky reaching in, but meh.
                POOL.available[0].client.emit('error', new Error());
        });
});


test('drain event', function (t) {
        for (var i = 0; i < MAX_CLIENTS; i++) {
                POOL.acquire(function (err, client) {
                        t.ifError(err);
                        process.nextTick(function () {
                                POOL.release(client);
                        });
                });
        }

        POOL.on('drain', function () {
                t.end();
        });
});


test('shutdown blocks acquire', function (t) {
        for (var i = 0; i < MAX_CLIENTS; i++) {
                POOL.acquire(function (err, client) {
                        t.ifError(err);
                        process.nextTick(function () {
                                POOL.release(client);
                        });
                });
        }

        POOL.shutdown(function () {
                t.end();
        });

        POOL.acquire(function (err) {
                t.ok(err);
        });
});


test('shutdown kills all clients', function (t) {
        POOL.acquire(function (err, client) {
                t.ifError(err);
                t.ok(client);
                t.equal(client.id, 1);

                POOL.acquire(function (err2, client2) {
                        t.ifError(err2);
                        t.ok(client2);
                        t.equal(client2.id, 2);

                        POOL.release(client);
                        POOL.release(client2);

                        t.equal(POOL.available.length, 2);
                        POOL.shutdown(function () {
                                t.equal(POOL.resources.length, 0);
                                t.end();
                        });
                });
        });
});



// test('long run: queue + remove', function (t) {
//         var acquired = 0;
//         var clients = [];
//         var total = MAX_CLIENTS * 3;

//         function creat(i) {
//                 POOL.acquire(function (err, client) {
//                         t.ifError(err);
//                         if (err)
//                                 return;

//                         t.ok(client);
//                         if (i % 10 === 0) {
//                                 POOL.remove(client);
//                         } else {
//                                 clients.push(client);
//                         }

//                         acquired++;
//                 });
//         }

//         function next() {
//                 console.log(POOL.toString());
//                 clients.forEach(POOL.release.bind(POOL));
//                 process.nextTick(function () {
//                         console.log(POOL.toString());
//                         process.nextTick(function () {
//                                 console.log(POOL.toString());
//                                 console.log(acquired)
//                                 end();
//                         });
//                 });

//         }

//         function end() {
//                 process.nextTick(function () {
//                         console.log(require('util').inspect(POOL));
//                         POOL.shutdown(function () {
//                                 t.end();
//                         });
//                 });

//         }

//         for (var i = 0; i < total; i++)
//                 creat(i);

//         process.nextTick(next);

//         // t.(POOL.queue.length, 1);
//         // t.equal(POOL.resources.length, MAX_CLIENTS);

//         // process.nextTick(function () {

//         //         POOL.release(clients.shift());
//         //         process.nextTick(function () {
//         //                 clients.forEach(function (c) {
//         //                         POOL.release(c);
//         //                 });
//         //         });

//         // });

// });
