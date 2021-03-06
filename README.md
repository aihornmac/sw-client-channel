# sw-client-channel
A tool for communication between service worker and browser pages

## Install
```bash
npm i -S sw-client-channel
```

## Features
* Clients management
* Support transferable
* Broadcast to all clients and emit to certain client
* Request/Respond of both sides

## Usage
```js
import ClientChannel from 'sw-client-channel/client';

navigator.serviceWorker
  .register('/sw.js')
  .then(navigator.serviceWorker.ready)
  .then(registration => {
    const channel = new ClientChannel(registration.active);

    channel.on('hi', () => {
      console.log('sw says hi');
      const arrayBuffer = new ArrayBuffer();
      channel.request('transferable', [arrayBuffer], [arrayBuffer])
        .then(buffer => {
          console.log(arrayBuffer === buffer);
          channel.emit('bye');
        });
    });

    channel.on('bye', () => {
      console.log(`sw says bye`);
    });

    channel.emit('hi');
  });
```

```js
import SWChannel from 'lib/sw-client-channel/sw';

SWChannel.on('hi', clientId => {
  console.log(`client ${clientId} says hi`);
  SWChannel.emit(clientId, 'hi');
});

SWChannel.on('bye', clientId => {
  console.log(`client ${clientId} says bye`);
  channel.emit('bye');
});

SWChannel.respond('transferable', async arrayBuffer => {
  // await do sth...
  const result = arrayBuffer;
  const transferList = [arrayBuffer];
  return [result, transferList];
}, true);
```

should print

```
client <clientId> says hi
sw says hi
true
client <clientId> says bye
sw says bye
```

## API in pages
#### `constructor(options)`
* options.worker - The used service worker

#### `on(name, handler)`
Register an event listener to sw's
* `channel.broadcast(name, args)`
* `channel.emit(clientId, name, args, transferList)`

handler is executed as `handler(...args)`

##### Example
```js
channel.on('hi', (...args) => {
  console.log(...args);
});
```

#### `off(name, handler)`
Unregister and event listener

##### Example
```js
channel.on('hi', function handler () {
  channel.off('hi', handler);
});
```

#### `emit(name, args[, transferList])`
Send an request with args and optionally transferList.
It is handled by sw's
* `channel.on(name, handler)`

##### Example
```js
channel.emit('check update');

channel.emit('give me an array buffer', [arrayBuffer], [arrayBuffer]);
```

#### `request(name, args[, transferList]): Promise`
Send an request with args and optionally transferList and return a promise.
It is responeded by sw's
* `channel.respond(name, handler, transferable = false)`

##### Example
```js
channel.request('cache names', ['assets'])
  .then(console.log, console.error);
```

#### `respond(name, handler, transferable = false)`
Respond to a request from sw and return result. The handler can return a promise.
If `transferable` is `true`, you should return `[result, transferList]`
instead of `result`

##### Example
```js
// transferable = false
channel.respond('what time is it', () => {
  console.log('sw asked what time is it');
  return Date.now();
});

// transferable = true
channel.respond('give me back the array buffer I sent', async arrayBuffer => {
  // await do sth...
  return [arrayBuffer, [arrayBuffer]];
}, true);
```

#### `destroy()`
Destroy this channel

## API in service worker
#### `on(name, handler)`
Register an event listener to client's
* `channel.emit(name, args)`

handler is executed as `handler(clientId, ...args)`

##### Example
```js
channel.on('hi', (clientId, ...args) => {
  console.log(clientId, ...args);
});
```

#### `off(name, handler)`
Unregister and event listener

##### Example
```js
channel.on('hi', function handler () {
  channel.off('hi', handler);
});
```

#### `emit(clientId, name, args[, transferList])`
Send an request to certain client with args and optionally transferList.
It is handled by client's
* `channel.on(name, handler)`

##### Example
```js
channel.emit(clientId, 'reload page', [/*force = */true]);

channel.emit(clientId, 'give me an array buffer', [arrayBuffer], [arrayBuffer]);
```

#### `broadcast(name, args)`
Send an request to all clients with args. It is handled by client's
* `channel.on(name, handler)`

**NOTE: ** it doesn't accept transferList

##### Example
```js
channel.emit(clientId, 'reload page', [/*force = */true]);

channel.emit(clientId, 'give me an array buffer', [arrayBuffer], [arrayBuffer]);
```

#### `request(clientId, name, args[, transferList]): Promise`
Send an request to certain client with args and optionally transferList and return a promise.
It is responeded by clients's
* `channel.respond(name, handler, transferable = false)`

##### Example
```js
channel.request(clientId, 'initialization time')
  .then(console.log, console.error);
```

#### `respond(name, handler, transferable = false)`
Respond to a request from client and return result. The handler can return a promise.
If `transferable` is `true`, you should return `[result, transferList]`
instead of `result`

handler is executed as `handler(clientId, ...args)`

##### Example
```js
// transferable = false
channel.respond('what time is it', clientId => {
  console.log(`client ${clientId} asked what time is it`);
  return Date.now();
});

// transferable = true
channel.respond('give me back the array buffer I sent', async (clientId, arrayBuffer) => {
  // await do sth...
  return [arrayBuffer, [arrayBuffer]];
}, true);
```

#### `destroy()`
Destroy this channel
