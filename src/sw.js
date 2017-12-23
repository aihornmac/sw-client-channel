import uuidv4 from 'uuid/v4';
import { ChannelPrototype } from './common';

class SWChannel extends ChannelPrototype {
  constructor (options) {
    super(options);
    // init clients
    this._clients = {};

    // create sw id
    this._sw_id = uuidv4();

    // bind message event to self
    global.addEventListener('message', this._on_message);
  }

  destroy () {
    // remove message event to self
    global.removeEventListener('message', this._on_message);

    // reject promises
    for (const { reject } of Object.values(this._promises)) {
      reject(new Error(`channel closed`));
    }

    // send destory action
    for (const id of Object.keys(this._clients)) {
      this._send_action(id, 'destroy');
    }

    // invoke parent destroy
    super.destroy();
  }

  request (clientId, name, args, transferList) {
    // check if client exists
    if (!this._client_id[clientId]) return new Promise.reject(
      new Error(`client is not registered`)
    );

    // make request data
    const id = uuidv4();
    const data = { id, name, args };

    // send request action
    this._send_action(clientId, 'request', data, transferList);

    return new Promise((resolve, reject) => {
      // put promise resolver in map
      this._promises[id] = { resolve, reject };
    });
  }

  emit (clientId, name, args, transferList) {
    // check if event name is valid (unpreserved)
    if (!this._is_event_valid(name)) {
      if (process.env.NODE_ENV !== 'production') {
        throw new Error(`event name ${name} is preserved`);
      }
      return;
    }

    // get client and check if event is registered
    const client = this._clients[clientId];
    if (!client) return;
    if (!client.events[name]) return;

    // push event into queue
    client.pendingEvents.push([name, args, transferList]);

    // if there has been a promise waiting for a port, return it
    if (client.sendEventsPromise) return client.sendEventsPromise;

    const { ports } = client;

    // if there are ports, send directly
    if (ports.length) {
      const events = client.pendingEvents;
      client.pendingEvents = [];
      return this._send_events_with_port(ports.shift(), events);
    }

    // create a promise waiting for a port
    return client.sendEventsPromise = new Promise((resolve, reject) => {
      client.portsQueue.push({ resolve, reject });
    }).then(port => {
      client.sendEventsPromise = null;
      const events = client.pendingEvents;
      client.pendingEvents = [];
      this._send_events_with_port(port, events);
    });
  }

  broadcast (name, args) {
    return Promise.all(
      Object.keys(this._clients).map(id =>
        this.emit(id, name, args)
      )
    );
  }

  on (event, listener) {
    for (const id of Object.keys(this._clients)) {
      this._send_action(id, 'changeEvent', { type: 'on', name: event });
    }
    this._events.on(event, listener);
  }

  off (event, listener) {
    for (const id of Object.keys(this._clients)) {
      this._send_action(id, 'changeEvent', { type: 'off', name: event });
    }
    this._events.off(event, listener);
  }

  _dispatch (event, action) {
    if (action.type === 'handshake') {
      this._on_handshake(event, action);
    }
    if (event.ports.length) {
      const port = event.ports[0];
      const client = this._clients[action.clientId];
      if (!client) {
        return this._on_unexpected(event, action);
      }
      const queue = client.portsQueue;
      if (queue.length) {
        // if there are promises awaiting port, fulfill one
        const { resolve } = queue.shift();
        resolve(port);
      } else {
        // save ports
        client.ports.push(port);
      }
    }
    super._dispatch(event, action);
  }

  _on_handshake (event, action) {
    // create and set client
    const { clientId } = action;
    this._clients[clientId] = {
      id: clientId,
      events: action.data.events,
      ports: [],
      portsQueue: [],
      pendingEvents: [],
      nativeId: event.source.id,
    };

    // send handshake action
    const events = this._events.eventNames();
    this._send_action(clientId, 'handshake', { events });

    // emit event
    this._events.emit('handshake', clientId);

    // invoke parent
    super._on_handshake(event, action);
  }

  _on_unexpected (event, action) {
    const port = event.ports[0];
    const payload = this._make_payload('unexpected', action);
    port.postMessage(payload);
  }

  async _on_request (event, action) {
    // inject clientId as first argument
    const { clientId } = action;
    const data = {
      ...action.data,
      args: action.data.args ? [clientId, ...action.data.args] : [clientId],
    };

    // execute request and send response
    const [result, transferList] = await this._exec(data);
    return this._send_action(clientId, 'response', result, transferList);
  }

  _on_emit (event, action) {
    // inject clientId as first argument and emit
    const { clientId } = action;
    const { args = [] } = action.data;
    this._events.emit(action.name, clientId, ...args);
  }

  _on_change_event (event, action) {
    const client = this._clients[action.clientId];
    if (!client) return;

    const { type, name } = action.data;
    if (type === 'on') {
      client.events[name] = true;
    } else if (type === 'off') {
      delete client.events[name];
    }
  }

  async _send (clientId, payload, transferList) {
    const client = this._clients[clientId];
    const { ports } = client;
    let port;
    if (ports.length) {
      port = ports.shift();
    } else {
      port = await new Promise((resolve, reject) => {
        client.portsQueue.push({ resolve, reject });
      });
    }
    transferList = transferList || [];
    port.postMessage(payload, transferList);
  }

  _send_events_with_port (port, _events) {
    const events = [];
    const transferList = [];
    for (const args of _events) {
      events.push([args[0], args[1]]);
      if (args[2] && args[2].length) {
        transferList.push(...args[2]);
      }
    }
    const payload = this._make_payload('emit', { events });
    port.postMessage(payload, transferList);
  }

  _send_action (clientId, action, data, transferList) {
    const payload = this._make_payload(action, data);
    return this._send(clientId, payload, transferList);
  }

  _make_payload (type, data) {
    return super._make_payload({ type, data });
  }
}

export default new SWChannel();
