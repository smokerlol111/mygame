// Exercise shutdown without killing the test process or opening a real server.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { registerShutdown } = require('../../server/lifecycle');

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`${signal}: stop integrations, cancel room timers, notify clients, drain and retain a timeout fallback`, t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const handlers = new Map(), events = [], exits = [], fired = [];
    const originalOn = process.on;
    t.mock.method(process, 'on', function (name, handler) {
      if (name === 'SIGTERM' || name === 'SIGINT') { handlers.set(name, handler); return this; }
      return originalOn.call(this, name, handler);
    });
    t.mock.method(process, 'exit', code => { exits.push(code); });
    t.mock.method(console, 'log', () => {});
    let closed;
    const room = {
      finalTimer: setInterval(() => fired.push('final'), 1000),
      firstTurnTimer: setTimeout(() => fired.push('first-turn'), 1000),
    };
    registerShutdown({
      rooms: new Map([['fixture', room]]),
      server: { close(callback) { events.push('close'); closed = callback; } },
      io: { emit(event) { events.push(event); } },
      voice: { stop() { events.push('voice-stop'); } },
      stopPresenceMonitor() { events.push('presence-stop'); },
    });
    assert.deepEqual([...handlers.keys()].sort(), ['SIGINT', 'SIGTERM']);
    handlers.get(signal)();
    assert.deepEqual(events, ['voice-stop', 'presence-stop', 'serverRestarting', 'close']);
    t.mock.timers.tick(24999);
    assert.deepEqual(fired, [], 'room callbacks cannot run while shutdown drains connections');
    assert.deepEqual(exits, [], 'do not exit before drain completion or the deadline');
    closed();
    assert.deepEqual(exits, [0], 'successful drain exits cleanly');
    t.mock.timers.tick(1);
    assert.deepEqual(exits, [0, 0], 'if the process remains alive, the 25-second fallback also exits cleanly');
  });
}
