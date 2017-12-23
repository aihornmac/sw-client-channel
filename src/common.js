import EventEmitter from 'eventemitter3';

export const DEFAULT_UUID = '904a8e57aa9142909c425a6f86514632';

export class ChannelPrototype {
  constructor (options) {
    options = options || {};
    this._commands = {};
    this._promises = {};
    this._uuid = options.uuid || DEFAULT_UUID;
    this._on_message = this._on_message.bind(this);
    this._events = new EventEmitter();
    this._is_destroyed = false;
  }

  request () {}

  respond (name, fn, transferable = false) {
    const commands = this._commands;
    if (process.env.NODE_ENV !== 'production') {
      if (typeof fn !== 'function') {
        throw new Error(`fn should be a function, ${typeof fn} given`);
      }
      if (commands[name]) {
        throw new Error(`${name}() has been added`);
      }
    }
    commands[name] = { fn, transferable: Boolean(transferable) };
  }

  destroy () {
    this._is_destroyed = true;
    this._events.emit('destroy');
    this._events.removeAllListeners();
  }

  _on_message (event) {
    const { data } = event;
    if (data && typeof data === 'object') {
      const action = data[this._uuid];
      if (action && typeof action === 'object') {
        this._dispatch(event, action);
      }
    }
  }

  _dispatch (event, action) {
    if (action.type === 'emit') {
      this._on_emit(event, action);
    } else if (action.type === 'request') {
      this._on_request(event, action);
    } else if (action.type === 'response') {
      this._on_response(event, action);
    } else if (action.type === 'changeEvent') {
      this._on_change_event(event, action);
    }
  }

  _on_handshake () {
    this._has_handshaken = true;
    this._events.emit('handshake');
  }

  _on_request () {}

  _is_event_valid (event) {
    if (event === 'handshake') return false;
    if (event === 'destroy') return false;
    return true;
  }

  _on_response (event, action) {
    const { id, result, error } = action.data;
    const promises = this._promises;
    const promise = promises[id];
    if (promise) {
      delete promises[id];
      if (error) {
        promise.reject(error);
      } else {
        promise.resolve(result);
      }
    }
  }

  async _exec (action) {
    const { id, name, args = [] } = action;
    const command = this._commands[name];
    let data;
    let transferList;
    if (command) {
      const { fn, transferable } = command;
      try {
        let result;
        if (transferable) {
          [result, transferList] = await fn(...args);
        } else {
          result = await fn(...args);
        }
        data = { id, result };
      } catch (error) {
        data = { id, error: String(error) };
      }
    } else {
      data = { id, error: `function ${name} not found` };
    }
    return [data, transferList];
  }

  _make_payload (data) {
    return { [this._uuid]: data };
  }
}
