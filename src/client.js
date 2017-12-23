import uuidv4 from 'uuid/v4';
import { ChannelPrototype } from './common';

export default class ClientChannel extends ChannelPrototype {
  get hasHandshaken () {
    return this._has_handshaken;
  }

  constructor (options) {
    super(options);
    // init registered events
    this._registered_events = {};

    // init actions queue
    this._actions_queue = [];

    // bind message event to worker
    this._worker = options.worker;
    this._worker.addEventListener('message', this._on_message);

    // create client id
    this._client_id = uuidv4();

    // handshake
    this._handshaking = true;
    this._has_handshaken = false;
    this._handshake_promise = new Promise(resolve => {
      this._handshake_promise_resolve = resolve;
    });
    this._handshake();
  }

  destroy () {
    // clear handshake timer if exists
    clearTimeout(this._handshake_timer);

    // remove message event from worker
    this._worker.removeEventListener('message', this._on_message);

    // reject promises
    for (const { reject } of Object.values(this._promises)) {
      reject(new Error(`channel closed`));
    }

    // send destroy action if handshake had finished
    if (this._has_handshaken) {
      this._send_action('destroy');
    }

    // invoke parent destory
    super.destroy();
  }

  request (name, args, transferList) {
    // make request data
    const id = uuidv4();
    const data = { id, name, args };

    // if handshake finished, send directly, otherwise push into queue,
    // and be sent later when handshake finish
    if (this._has_handshaken) {
      this._send_action('request', data, transferList);
    } else {
      this._actions_queue.push(['request', data, transferList]);
    }

    return new Promise((resolve, reject) => {
      // put promise resolver in map
      this._promises[id] = { resolve, reject };
    });
  }

  emit (name, args, transferList) {
    // check if event name is valid (unpreserved)
    if (!this._is_event_valid(name)) {
      if (process.env.NODE_ENV !== 'production') {
        throw new Error(`event name ${name} is preserved`);
      }
      return;
    }

    // check if worker has listened on such event
    if (!this._registered_events[name]) return;

    // send emit without port
    const payload = this._make_payload('emit', { name, args });
    this._send_raw(payload, transferList);
  }

  on (event, listener) {
    this._send_raw(this._make_payload('changeEvent', { type: 'on', name: event }));
    this._events.on(event, listener);
  }

  off (event, listener) {
    this._send_raw(this._make_payload('changeEvent', { type: 'off', name: event }));
    this._events.off(event, listener);
  }

  _handshake () {
    // clear handshake timer
    clearTimeout(this._handshake_timer);

    // send handshake
    const events = this._events.eventNames();
    this._send_action('handshake', { events });

    // set next try timer
    this._handshake_timer = setTimeout(() => this._handshake_timer, 1000);
  }

  _dispatch (event, action) {
    if (action.type === 'handshake') {
      this._on_handshake(event, action);
    }
    if (action.type === 'unexpected') {
      this._on_unexpected(event, action);
    }
    super._dispatch(event, action);
  }

  _on_handshake (event, action) {
    // clear handshake timer
    clearTimeout(this._handshake_timer);

    // send first port
    this._send_action('port');

    // reset registered events
    const events = this._registered_events = {};
    for (const name of action.data.events) {
      events[name] = true;
    }

    // set handshake state and emit event
    this._handshaking = false;
    this._has_handshaken = true;
    this._events.emit('handshake', undefined);

    // send queued actions and empty the queue
    for (const args of this._actions_queue) {
      this._send_action(...args);
    }
    this._actions_queue = [];

    // invoke parent
    super._on_handshake(event, action);

    // resolve promise
    const resolve = this._handshake_promise_resolve;
    this._handshake_promise = null;
    this._handshake_promise_resolve = null;
    resolve();
  }

  _on_unexpected (event, action) {
    // trigger handshake again
    if (!this._handshaking) {
      this._handshaking = true;
      this._has_handshaken = false;
      this._handshake_promise = new Promise(resolve => {
        this._handshake_promise_resolve = resolve;
      });
      this._handshake();
    }

    action = action.data;

    if (action.type === 'request') {
      this._on_response(event, {
        type: 'response',
        data: {
          id: action.data.id,
          error: new Error(`client is unexpected in sw`),
        }
      });
    }
  }

  async _on_request (event, action) {
    // execute request and send response
    const [result, transferList] = await this._exec(action.data);
    return this._send_action('response', result, transferList);
  }

  _on_emit (event, action) {
    // send back a port
    this._send_action('port');

    // emit events
    const { events } = action.data;
    for (const [name, _args] of events) {
      const args = _args && _args.length ? _args : [undefined];
      this._events.emit(name, ...args);
    }
  }

  _on_change_event (event, action) {
    const { type, name } = action.data;
    if (type === 'on') {
      this._registered_events[name] = true;
    } else if (type === 'off') {
      delete this._registered_events[name];
    }
  }

  _get_port () {
    // create a channel and return the port
    const channel = new MessageChannel();
    channel.port1.addEventListener('message', this._on_message);
    channel.port1.start();
    return channel.port2;
  }

  _send (payload, transferList) {
    const worker = this._worker;
    if (worker.state === 'redundant') return;
    if (this._is_destroyed) return;

    // create a port and post message to worker with it
    transferList = transferList || [];
    const port = this._get_port();
    worker.postMessage(payload, [port, ...transferList]);
  }

  _send_raw (payload, transferList) {
    const worker = this._worker;
    if (worker.state === 'redundant') return;
    if (this._is_destroyed) return;

    // post message to worker without a port
    transferList = transferList || [];
    worker.postMessage(payload, transferList);
  }

  _send_action (action, data, transferList) {
    // a helper to make payload
    const payload = this._make_payload(action, data);
    return this._send(payload, transferList);
  }

  _make_payload (type, data) {
    return super._make_payload({ type, data, clientId: this._client_id });
  }
}
