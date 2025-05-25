const osc = require('node-osc');

class OSCManager {
    constructor(config) {
        this.config = config;
        this.senders = new Map();
        this.messageHandlers = new Set();
    }

    createSender(port, host = this.config?.osc?.local?.ip || '127.0.0.1') {
        try {
            const client = new osc.Client(host, port);
            this.senders.set(port, client);
            return client;
        } catch (err) {
            console.error('[Client] Failed to create OSC sender:', err);
            throw err;
        }
    }

    send(port, address, ...args) {
        if (!port) {
            console.error('[Client] OSC send error: No port specified');
            return;
        }
        let sender = this.senders.get(port);
        if (!sender) {
            sender = this.createSender(port);
        }
        if (sender) {
            if (this.config?.logging?.osc?.outgoing) {
                console.log(`[Client] | Sending OSC to port ${port}: ${address} | [${args.join(', ')}]`);
            }
            sender.send(address, ...args);
        }
    }

    onMessage(handler) {
        this.messageHandlers.add(handler);
    }
}

module.exports = OSCManager;
